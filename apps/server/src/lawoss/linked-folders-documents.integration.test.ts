import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { DocumentPreparation } from "../document-preparation/service.js";
import { ApiError } from "../errors.js";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { OcrManager } from "../ocr/manager.js";
import { closeRuntimeOpencodeConfig, runtimeStorageDir, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { LawossDocuments } from "./documents/service.js";
import { documentLinkedFolders, writeLinkedFoldersMap } from "./linked-folders.js";

/**
 * LAWOSS alfa2 A3 (N-18, N-19) v pribalenom engine 1.18.29: klient A má pripojený priečinok s PDF, klient B nie.
 * Produkčné pluginy (`legalwork-project-tools`, `lawoss-linked-folders`) zostavené z tohto stromu, produkčné
 * oprávnenia (`buildLegalworkRuntimeConfigObject`), mapa a pravidlá servera, skutočná `LawossDocuments` s produkčným
 * `documentLinkedFolders`. Server je nahradený malým prípravkom, ktorý volá tú istú službu dokumentov (autorizácia
 * chatu cez token agenta je mimo tohto testu, pozri úlohu A2).
 * - Chat klienta A aj chat jeho prípadu: pripomienka so zoznamom pripojených priečinkov; príprava a čítanie PDF bez karty.
 * - Chat klienta B: pripomienka bez priečinka A; príprava odmietnutá bez obsahu, bez mena A a bez záznamu; natívne
 *   čítanie vyvolá kartu `external_directory`, ktorú možno zamietnuť.
 *   LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/linked-folders-documents.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const toolPartsSchema = z.array(z.object({ parts: z.array(z.object({ tool: z.string().optional(),
  state: z.object({ status: z.string(), input: z.unknown().optional(), output: z.string().optional(), error: z.string().optional() }).optional() })) }));
type ToolCall = { name: string; args: Record<string, unknown> };
type Step = (previousToolOutput: string) => ToolCall | null;

async function pdf(text: string) {
  const doc = await PDFDocument.create(); const font = await doc.embedFont(StandardFonts.Helvetica);
  doc.addPage().drawText(text, { font }); return doc.save();
}

test.skipIf(!binary)("pripojený priečinok: chat klienta aj prípadu čítajú PDF bez karty; chat iného klienta obsah nedostane", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-docs-")));
  const clientA = join(root, "prax", "Klienti", "Tatran SYN");
  const matterA = join(clientA, "Spisy", "M001 Úhrada");
  const clientB = join(root, "prax", "Klienti", "Hron SYN");
  const linkedA = join(root, "pripojeny-A");
  for (const folder of [matterA, clientB, linkedA]) await mkdir(folder, { recursive: true });
  const pdfPath = join(linkedA, "Podklady.pdf");
  await writeFile(pdfPath, await pdf("SYN obsah pripojeneho podkladu 4711"));
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspaces: WorkspaceInfo[] = [
    { id: "ws_a", name: "Tatran SYN", path: clientA, preset: "starter", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "a-storage" },
    { id: "ws_b", name: "Hron SYN", path: clientB, preset: "starter", workspaceType: "local", appFiles: "outside", appFilesStorageKey: "b-storage" },
  ];
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces, authorizedRoots: [clientA, clientB], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  // Klient A má pripojený priečinok (natívny zápis riadku klienta); B nie.
  await writeRuntimeOpencodeConfig(config, "ws_a", (current) => ({ ...current, permission: { external_directory: { [`${linkedA}/*`]: "allow" } } }));
  const ocr = new OcrManager(join(root, "private", "ocr"));
  const preparation = new DocumentPreparation(ocr, {});
  const documents = new LawossDocuments(config, preparation, (workspace) => documentLinkedFolders(config, workspace));
  const settle = async (workspace: WorkspaceInfo) => {
    for (let i = 0; i < 500; i++) {
      if ((await documents.list(workspace)).every((record) => !["uploaded", "preparing"].includes(record.status))) return;
      await Bun.sleep(20);
    }
  };

  let steps: Step[] = [];
  const modelRequests: string[] = [];
  const fail = (error: unknown) => error instanceof ApiError
    ? Response.json({ code: error.code, message: error.message }, { status: error.status })
    : Response.json({ code: "failed", message: error instanceof Error ? error.message : String(error) }, { status: 500 });
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const url = new URL(request.url), path = url.pathname;
    if (path === "/workspaces") return Response.json({ items: workspaces.map(({ id, path }) => ({ id, path })) });
    const route = /^\/workspace\/([^/]+)\/(.+)$/.exec(path);
    if (route) {
      const workspace = workspaces.find((entry) => entry.id === route[1]);
      if (!workspace) return Response.json({ code: "unknown_workspace" }, { status: 404 });
      try {
        if (route[2] === "lawoss/documents/prepare") {
          const body = z.object({ paths: z.array(z.string()) }).parse(await request.json());
          // Prípravok počká na dokončenie, aby skriptovaný model nemusel opakovať zoznam.
          const prepared = await documents.prepare(workspace, body.paths);
          await settle(workspace);
          return Response.json({ documents: prepared, untrusted: true });
        }
        if (route[2] === "lawoss/documents") return Response.json({ documents: await documents.list(workspace), nextOffset: null, untrusted: true });
        const read = /^lawoss\/documents\/([^/]+)\/read$/.exec(route[2]);
        if (read) return Response.json(await documents.read(workspace, read[1]!));
      } catch (error) { return fail(error); }
      return Response.json({ code: "not_found" }, { status: 404 });
    }
    const raw = await request.text();
    modelRequests.push(raw);
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown().optional() })), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() }).parse(JSON.parse(raw));
    const tools = input.tools?.map((tool) => tool.function.name) ?? [];
    const toolMessages = input.messages.filter((message) => message.role === "tool");
    const last = toolMessages.at(-1);
    const previous = typeof last?.content === "string" ? last.content : JSON.stringify(last?.content ?? "");
    const next = steps[toolMessages.length]?.(previous) ?? null;
    const call = next && tools.includes(next.name) ? next : undefined;
    const delta = call ? { tool_calls: [{ index: 0, id: `call_${toolMessages.length}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: "Hotovo." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  const pluginDir = join(root, "plugins");
  const build = await Bun.build({ entrypoints: ["legalwork-project-tools", "lawoss-linked-folders"].map((name) => join(import.meta.dir, "..", "opencode-plugins", `${name}.ts`)), outdir: pluginDir, target: "node", format: "esm" });
  expect(build.success).toBe(true);

  const prepare: Step = () => ({ name: "lawoss_documents_prepare", args: { paths: [pdfPath] } });
  const readPrepared: Step = (output) => {
    const id = /"id":"([0-9a-f-]{36})"/.exec(output)?.[1];
    return id ? { name: "lawoss_documents_read", args: { id } } : null;
  };
  const nativeRead: Step = () => ({ name: "read", args: { filePath: pdfPath } });

  let engineBase = "";
  const at = (directory: string, path: string) => `${engineBase}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(directory)}`;
  /** Jeden chat v `directory`: otázka enginu, ktorá visí ≥ 3 s, je karta pre používateľa (zamietne sa); plugin odpovedá hneď. */
  const attempt = async (directory: string, plan: Step[]) => {
    steps = plan;
    modelRequests.length = 0;
    const json = { "content-type": "application/json" };
    const created = z.object({ id: z.string() }).parse(await (await fetch(at(directory, "/session"), { method: "POST", headers: json, body: "{}" })).json());
    const accepted = await fetch(at(directory, `/session/${created.id}/prompt_async`), { method: "POST", headers: json,
      body: JSON.stringify({ agent: "legalwork", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Prečítaj dokumenty v pripojenom priečinku." }] }) });
    expect(accepted.ok).toBe(true);
    const firstSeen = new Map<string, number>();
    const prompts: string[] = [];
    for (let i = 0; i < 900; i++) {
      const pending = z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(at(directory, "/permission"))).json());
      for (const ask of pending) {
        const seen = firstSeen.get(ask.id);
        if (seen === undefined) { firstSeen.set(ask.id, Date.now()); continue; }
        if (Date.now() - seen < 3000) continue;
        prompts.push(ask.permission);
        await fetch(at(directory, `/permission/${ask.id}/reply`), { method: "POST", headers: json, body: JSON.stringify({ reply: "reject" }) });
      }
      const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(at(directory, "/session/status"))).json());
      if (i > 5 && pending.length === 0 && (status[created.id]?.type ?? "idle") === "idle") break;
      await Bun.sleep(100);
    }
    const parts = toolPartsSchema.parse(await (await fetch(at(directory, `/session/${created.id}/message`))).json()).flatMap((message) => message.parts).filter((part) => part.tool);
    return { prompts, model: modelRequests.join("\n"), tools: parts.map((part) => ({ tool: part.tool, status: part.state?.status, output: part.state?.output ?? part.state?.error ?? "" })) };
  };

  const production = await buildLegalworkRuntimeConfigObject(config, "ws_a");
  await writeLinkedFoldersMap(config);
  const engineConfig = join(runtimeStorageDir(config), "config-linked-documents.json");
  await writeFile(engineConfig, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: build.outputs.map((output) => pathToFileURL(output.path).href), permission: production.permission, agent: production.agent, lsp: false, formatter: false }));
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port;
  reservation.stop(true);
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: clientA, env: {
    ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "fixture",
  }, stdout: "ignore", stderr: "pipe" });
  const logs = new Response(engine.stderr).text();
  engineBase = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready && engine.exitCode === null; i++) {
      try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
    }
    if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));

    const reminder = '<system-reminder topic=\\"linked-folders\\">';
    for (const directory of [clientA, matterA]) {
      const run = await attempt(directory, [prepare, readPrepared]);
      expect(run.model).toContain(reminder);
      expect(run.model).toContain(`- pripojeny-A: ${linkedA}`);
      expect(run.prompts).toEqual([]);
      expect(run.tools.map((part) => [part.tool, part.status])).toEqual([["lawoss_documents_prepare", "completed"], ["lawoss_documents_read", "completed"]]);
      expect(run.tools[1]?.output).toContain("SYN obsah pripojeneho podkladu 4711");
    }

    const other = await attempt(clientB, [prepare, readPrepared]);
    // Cestu pozná len z vlastného volania nástroja (skript); pripomienka B priečinok A nemá (B žiadny nemá).
    expect(other.model).not.toContain(reminder);
    expect(other.model).not.toContain("- pripojeny-A:");
    expect(other.model).not.toContain("SYN obsah pripojeneho podkladu");
    expect(other.prompts).toEqual([]);
    expect(other.tools.map((part) => [part.tool, part.status])).toEqual([["lawoss_documents_prepare", "completed"]]);
    expect(other.tools[0]?.output).toContain("document_folder_not_linked");
    expect(other.tools[0]?.output).not.toContain("Tatran");
    expect(await documents.list(workspaces[1]!)).toEqual([]);

    // Natívne čítanie v chate B: karta, ktorú možno zamietnuť; obsah nepríde.
    const native = await attempt(clientB, [nativeRead]);
    expect(native.prompts).toEqual(["external_directory"]);
    expect(native.tools.map((part) => part.status)).toEqual(["error"]);
    expect(native.model).not.toContain("SYN obsah pripojeneho podkladu");
    console.log(JSON.stringify({ clientRead: "ok", otherClient: { prepare: other.tools[0]?.output.slice(0, 300), nativePrompts: native.prompts } }, null, 1));
  } finally {
    engine.kill("SIGKILL"); await engine.exited;
    fixture.stop(true);
    await documents.stop(); preparation.stop(); ocr.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 300000);
