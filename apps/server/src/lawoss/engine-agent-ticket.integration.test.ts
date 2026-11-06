// LAWOSS: nástroje LAWOSS v klientovi B po práci v klientovi A, v tom istom behu enginu, bez reštartu
// (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = pribalený engine). Údaje sú syntetické; HOME/XDG enginu sú dočasné.
//   LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
//     pnpm --filter legalwork-server exec bun test src/lawoss/engine-agent-ticket.integration.test.ts
import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "../managed-opencode.js";
import { ENGINE_CONNECTION_REFUSED, WIKI_AGENT_TICKET_ENV, WIKI_AGENT_TICKET_PATH } from "./engine-agent-contract.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, issueWikiAgentTicket } from "../wiki/agent-access.js";
import { settleEngineAgentTicket } from "./engine-agent-ticket.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const toolPart = z.object({ type: z.literal("tool"), tool: z.string(), state: z.object({ status: z.string(), output: z.string().optional(), error: z.string().optional() }).passthrough() }).passthrough();
const messages = z.array(z.object({ parts: z.array(z.object({ type: z.string() }).passthrough()) }));
const queue = z.object({ entries: z.array(z.object({ status: z.string(), error: z.string().optional() }).passthrough()), completedIds: z.array(z.string()) }).passthrough();

// MCP na výpis prostredia je `/bin/sh`; na Windows sa zatiaľ nespúšťa.
test.skipIf(!binary || process.platform === "win32")("chat v klientovi B má nástroje LAWOSS po klientovi A, po uvoľnení inštancie A aj po novom engine", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-agent-ticket-")));
  const clientA = join(root, "prax", "Klient_A"), clientB = join(root, "prax", "Klient_B"), home = join(root, "engine"), dumps = join(root, "dumps");
  for (const folder of [clientA, clientB, home, dumps]) await mkdir(folder, { recursive: true });

  const env = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", clientA), workspace("klient-b", clientB)],
    authorizedRoots: [clientA, clientB], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { bash: "allow", read: "allow", edit: "allow", webfetch: "allow" } }));

  // Model na skúšku: na správu zavolá nástroje, ktoré pomenuje značka `KROK:<kľúč>`; po ich výsledkoch skončí.
  const steps = new Map<string, Array<{ name: string; arguments: Record<string, unknown> }>>();
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.text();
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(JSON.parse(body));
    const key = [...body.matchAll(/KROK:(\w+)/g)].at(-1)?.[1] ?? "";
    const calls = (input.messages.at(-1)?.role === "tool" ? [] : steps.get(key) ?? []).map((call, index) => ({ index, id: `call_${index}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } }));
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...(calls.length ? { tool_calls: calls } : { content: "Hotovo." }) }, null) + chunk({}, calls.length ? "tool_calls" : "stop") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } });
  const server = await startServer(config);
  const serverUrl = `http://127.0.0.1:${server.port}`;
  const build = await Bun.build({ entrypoints: [join(import.meta.dir, "..", "opencode-plugins", "lawoss-file-operations.ts")], outdir: join(root, "plugin"), target: "node", format: "esm" });
  expect(build.success).toBe(true);
  const engineConfig = join(home, "opencode.json");
  await Bun.write(engineConfig, JSON.stringify({
    enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 1000 } } } } },
    plugin: [pathToFileURL(build.outputs[0]!.path).href], permission: { "*": "allow" },
    mcp: { dump: { type: "local", command: ["/bin/sh", "-c", `env > "${dumps}/mcp-$(basename "$PWD").txt"`], enabled: true, timeout: 2000 } },
  }));

  let ticket = "";
  const startEngine = async (presented?: string): Promise<ManagedOpencodeServer> => {
    ticket = issueWikiAgentTicket(config);
    const engine = await createManagedOpencodeServer({ bin: binary, cwd: home, inheritEnvironment: false, env: {
      PATH: process.env.PATH ?? "", HOME: join(home, "home"), OPENCODE_TEST_HOME: join(home, "home"),
      XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
      OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      LEGALWORK_SERVER_URL: serverUrl, [WIKI_AGENT_TICKET_ENV]: presented ?? ticket,
    } });
    for (const entry of config.workspaces) Object.assign(entry, { baseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password, directory: entry.path });
    Object.assign(config, { opencodeBaseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password });
    return engine;
  };

  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${serverUrl}${path}`, { ...init, headers: { authorization: "Bearer client", "content-type": "application/json" }, signal: AbortSignal.timeout(120_000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const newSession = async (id: string, directory: string) => {
    const created = await call(`/workspace/${id}/opencode/session?${new URLSearchParams({ directory })}`, { method: "POST", body: "{}" });
    expect(created.status).toBe(200);
    return z.object({ id: z.string() }).parse(created.body).id;
  };
  /** Pošle správu cez front servera a vráti výsledky nástrojov tejto relácie podľa volania. */
  const send = async (workspaceId: string, directory: string, session: string, key: string) => {
    const id = crypto.randomUUID();
    const text = `KROK:${key}`;
    const enqueued = await call(`/workspace/${workspaceId}/sessions/${session}/queue`, { method: "POST", body: JSON.stringify({ type: "enqueue", id,
      draft: { mode: "prompt", text, parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text }] } }) });
    expect(enqueued.status).toBe(200);
    let state = queue.parse((await call(`/workspace/${workspaceId}/sessions/${session}/queue`)).body);
    for (let attempt = 0; attempt < 1200 && !state.completedIds.includes(id) && !state.entries.some((entry) => entry.status === "failed"); attempt++) {
      await Bun.sleep(100);
      state = queue.parse((await call(`/workspace/${workspaceId}/sessions/${session}/queue`)).body);
    }
    expect({ completed: state.completedIds.includes(id), entries: state.entries }).toEqual({ completed: true, entries: [] });
    const read = await call(`/workspace/${workspaceId}/opencode/session/${session}/message?${new URLSearchParams({ directory })}`);
    expect(read.status).toBe(200);
    return messages.parse(read.body).flatMap((message) => message.parts).flatMap((part) => { const parsed = toolPart.safeParse(part); return parsed.success ? [parsed.data] : []; });
  };
  const steal = (session: string, directory: string, workspaceId: string, token: string) => fetch(`${serverUrl}/workspace/${workspaceId}/files/content?path=x.md`, { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": session, "x-legalwork-wiki-agent-directory": encodeURIComponent(directory) } });

  /** Skutočný `lawoss_files`: musí prejsť cez server (plán aj zápis) a zanechať priečinok na disku. */
  const useTools = async (workspaceId: string, directory: string, folder: string, session?: string) => {
    steps.set(folder, [
      { name: "lawoss_files", arguments: { operations: [{ operation: "create_folder", path: folder }] } },
      { name: "bash", arguments: { command: `env > "${dumps}/shell-${folder}.txt"`, description: "Prostredie" } },
    ]);
    const chat = session ?? await newSession(workspaceId, directory);
    const tools = await send(workspaceId, directory, chat, folder);
    const files = tools.filter((tool) => tool.tool === "lawoss_files").at(-1);
    expect({ folder, status: files?.state.status, error: files?.state.error }).toEqual({ folder, status: "completed", error: undefined });
    await access(join(directory, folder));
    expect(tools.filter((tool) => tool.tool === "bash").at(-1)?.state.status).toBe("completed");
    return chat;
  };

  let engine = await startEngine();
  try {
    await settleEngineAgentTicket(config, engine, join(root, "probe"));

    // A, potom B, potom uvoľnenie A (rozpočet MCP to robí bežne), potom znova A. Bez reštartu.
    const chatA = await useTools("klient-a", clientA, "A1");
    const chatB = await useTools("klient-b", clientB, "B1");
    const disposed = await fetch(`${engine.url}/instance/dispose?${new URLSearchParams({ directory: clientA })}`, { method: "POST", headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
    expect(disposed.ok).toBe(true);
    await useTools("klient-a", clientA, "A2", chatA);
    await useTools("klient-a", clientA, "A3");
    await useTools("klient-b", clientB, "B2", chatB);

    // Tajomstvo nie je v prostredí MCP procesu ani shellu a lístok tam už nie je.
    const secret = await ensureWikiAgentToken(config);
    const childEnvironments = ["mcp-Klient_A.txt", "mcp-Klient_B.txt", "shell-A1.txt", "shell-B1.txt", "shell-A2.txt", "shell-A3.txt", "shell-B2.txt"];
    for (const name of childEnvironments) {
      const dump = await readFile(join(dumps, name), "utf8");
      expect({ name, hasPath: dump.includes("PATH="), secret: dump.includes(secret), ticket: dump.includes(WIKI_AGENT_TICKET_ENV), oldName: dump.includes("LEGALWORK_WIKI_AGENT_TOKEN") })
        .toEqual({ name, hasPath: true, secret: false, ticket: false, oldName: false });
    }

    const spent = ticket;
    // Lístok otvorí len jedno použitie: ako kľúč neplatí a opakovanie po uzavretí okna tajomstvo nezmení.
    const forged = await steal(chatB, clientB, "klient-b", spent);
    expect(forged.status).toBe(403);
    expect(await forged.json()).toMatchObject({ code: "wiki_agent_unauthorized" });
    const replay = await fetch(`${serverUrl}${WIKI_AGENT_TICKET_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: spent }) });
    expect(replay.status).toBe(403);
    expect(await ensureWikiAgentToken(config)).toBe(secret);
    await useTools("klient-b", clientB, "B3", chatB);

    // Relácia A, ktorá pomenuje priestor B, ostáva odmietnutá aj so správnym tajomstvom.
    const crossing = await steal(chatA, clientA, "klient-b", secret);
    expect(crossing.status).toBe(403);
    expect(await crossing.json()).toMatchObject({ code: "wiki_agent_workspace_denied" });

    // Nový engine dostane nový lístok a tajomstvo, staré prestanú platiť.
    await engine.close();
    engine = await startEngine();
    await settleEngineAgentTicket(config, engine, join(root, "probe"));
    await useTools("klient-b", clientB, "B4");
    await useTools("klient-a", clientA, "A4");
    const stale = await steal(chatB, clientB, "klient-b", secret);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "wiki_agent_unauthorized" });

    // Neplatný lístok: nástroj sa zavrie s textom pre advokáta, bez lístka a bez zmeny na disku.
    await engine.close();
    engine = await startEngine("synthetic-invalid-ticket");
    steps.set("B5", [{ name: "lawoss_files", arguments: { operations: [{ operation: "create_folder", path: "B5" }] } }]);
    const refused = (await send("klient-b", clientB, await newSession("klient-b", clientB), "B5")).filter((tool) => tool.tool === "lawoss_files").at(-1);
    expect(refused?.state.status).toBe("error");
    expect(refused?.state.error).toContain(ENGINE_CONNECTION_REFUSED);
    expect(refused?.state.error).not.toContain("synthetic-invalid-ticket");
    expect(await access(join(clientB, "B5")).then(() => true, () => false)).toBe(false);
  } finally {
    await engine.close();
    await server.stop();
    model.stop(true);
    closeRuntimeOpencodeConfig(config);
    for (const [key, value] of [["LEGALWORK_DATA_DIR", env.data], ["LEGALWORK_TOKEN_STORE", env.tokens], ["LEGALWORK_RUNTIME_DB", env.db]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await removeTestDir(root);
  }
}, 420_000);
