import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts } from "pdf-lib";
import { z } from "zod";
import { DocumentPreparation } from "../document-preparation/service.js";
import { ApiError } from "../errors.js";
import { OcrManager } from "../ocr/manager.js";
import { closeRuntimeOpencodeConfig, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { LawossDocuments } from "./documents/service.js";
import { documentLinkedFolders, writeLinkedFoldersMap } from "./linked-folders.js";
import { WIKI_AGENT_TICKET_PATH } from "./engine-agent-contract.js";
import { startScriptedEngine } from "./test-support/scripted-engine.js";
import { nativeRow } from "./test-support/native-config.js";

/**
 * LAWOSS alfa2 A3 (N-18, N-19) v pribalenom engine v2 (2.1.4): klient A má pripojený priečinok s PDF, klient B nie.
 * Produkčné pluginy (`legalwork-managed-config`, `lawoss-linked-folders`, `legalwork-project-tools`) zostavené
 * `pnpm --filter legalwork-server build`, produkčné pravidlá (`test-support/scripted-engine.ts`), mapa a pravidlá servera, skutočná `LawossDocuments` s produkčným
 * `documentLinkedFolders`. Server je nahradený malým prípravkom, ktorý volá tú istú službu dokumentov (autorizácia
 * chatu cez token agenta je mimo tohto testu, pozri úlohu A2).
 * - Chat klienta A aj chat jeho prípadu: pripomienka so zoznamom pripojených priečinkov; príprava a čítanie PDF bez karty.
 * - Chat klienta B: pripomienka bez priečinka A; príprava odmietnutá bez obsahu, bez mena A a bez záznamu; natívne
 *   čítanie vyvolá kartu `external_directory`, ktorú možno zamietnuť.
 * Karta je otázka enginu (`permission.request.list`), na ktorú plugin neodpovedal; test ju zaznamená a zamietne.
 *   LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/linked-folders-documents.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
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
  await writeRuntimeOpencodeConfig(config, "ws_a", (current) => ({ ...current, ...nativeRow({ permission: { external_directory: { [`${linkedA}/*`]: "allow" } } }) }));
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
    if (new URL(request.url).pathname === WIKI_AGENT_TICKET_PATH) return Response.json({ secret: "fixture" });
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
  const nativeRead: Step = () => ({ name: "read", args: { path: pdfPath } });

  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  let chat: (directory: string) => ReturnType<Awaited<ReturnType<typeof startScriptedEngine>>["chat"]> = () => { throw new Error("Engine not started"); };
  /** Jeden nový chat v `directory` so skriptom `plan`; vráti karty, požiadavky na model a nástroje. */
  const attempt = async (directory: string, plan: Step[]) => {
    steps = plan;
    modelRequests.length = 0;
    const session = await chat(directory);
    const cards = await session.turn("Prečítaj dokumenty v pripojenom priečinku.");
    const tools = await session.tools();
    return { prompts: cards.map((card) => card.action), model: modelRequests.join("\n"), tools: tools.map((tool) => ({ tool: tool.name, status: tool.status, output: tool.output })) };
  };

  await writeLinkedFoldersMap(config);
  try {
    const engine = await startScriptedEngine({ binary, config, workspaceId: "ws_a", home: join(root, "engine"), cleanups, managedConfig: true,
      plugins: ["lawoss-linked-folders", "legalwork-project-tools"], pluginIds: ["lawoss.linked-folders", "legalwork.project"],
      serverUrl: fixture.url.origin, modelUrl: fixture.url.origin + "/v1" });
    chat = engine.chat;

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
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    fixture.stop(true);
    await documents.stop(); preparation.stop(); ocr.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 300000);
