// LAWOSS: chat prípadu v skutočnom engine v2 (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = engine 2.1.4, zostavené pluginy
// `pnpm --filter legalwork-server build`). Chat založený pod prípadom (podpriečinok klienta) cez proxy klienta (ako
// appka) dostane prvú správu cez front servera a jeho nástroje bežia v priečinku prípadu: vstavaný `read` s relatívnou
// cestou aj spravovaný shell (`legalwork_shell` cez server, s lístkom enginu namiesto tokenu servera). Chat klienta beží
// v koreni klienta. Údaje sú syntetické; HOME/XDG enginu sú dočasné.
//   LEGALWORK_TEST_OPENCODE_BIN=<engine 2.1.4> pnpm --filter legalwork-server exec bun test src/lawoss/matter-chat-engine.integration.test.ts
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { z } from "zod";
import { listEngineMessages } from "../engine-client.js";
import { startServer } from "../server.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { settleEngineAgentTicket } from "./engine-agent-ticket.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";
import { nativeRow } from "./test-support/native-config.js";
import { scriptedCompletion, startEngineForServer, toolOutput } from "./test-support/scripted-engine.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

test.skipIf(!binary)("chat prípadu prijme prvú správu cez front a jeho nástroje bežia v priečinku prípadu; chat klienta v koreni klienta", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-matter-chat-")));
  cleanups.push(() => removeTestDir(root));
  const clientA = join(root, "prax", "Klient_A"), matterA = join(clientA, "Spisy", "M001-Úhrada"), clientB = join(root, "prax", "Klient-A");
  for (const folder of [matterA, clientB]) await mkdir(folder, { recursive: true });
  await writeFile(join(matterA, "podklad.txt"), "OBSAH-PRIPADU");
  await writeFile(join(clientA, "podklad.txt"), "OBSAH-KLIENTA");

  const env = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  cleanups.push(() => {
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: env.data, LEGALWORK_TOKEN_STORE: env.tokens, LEGALWORK_RUNTIME_DB: env.db }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", clientA), workspace("klient-b", clientB)],
    authorizedRoots: [clientA, clientB], agentSandboxEnabled: true, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  cleanups.push(() => closeRuntimeOpencodeConfig(config));
  // Advokát povolil príkazy a čítanie bez otázky; ide o priečinok, nie o povolenia.
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => nativeRow({ permission: { bash: "allow", read: "allow", edit: "allow", webfetch: "allow" } }));

  // Model na skúšku: v prvom kroku zavolá spravovaný shell (`pwd`) a `read` s relatívnou cestou, potom odpovie.
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const input = z.object({ messages: z.array(z.object({ role: z.string() })) }).parse(await request.json());
    const first = input.messages.every((message) => message.role !== "tool");
    if (!first) return scriptedCompletion(undefined, "Hotovo.");
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const calls = [
      { index: 0, id: "call_pwd", type: "function", function: { name: "legalwork_shell", arguments: JSON.stringify({ command: "pwd", description: "Pracovný priečinok" }) } },
      { index: 1, id: "call_read", type: "function", function: { name: "read", arguments: JSON.stringify({ path: "podklad.txt" }) } },
    ];
    return new Response(chunk({ role: "assistant", tool_calls: calls }, null) + chunk({}, "tool_calls") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  cleanups.push(() => model.stop(true));
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const { engine } = await startEngineForServer({ binary, config, serverPort: server.port, home: join(root, "engine"), cleanups, plugins: ["legalwork-sandbox"], modelUrl: model.url.origin + "/v1" });
  // Ako appka po štarte: pluginy otvoreného klienta si vyzdvihnú lístok, potom sa okno zavrie.
  await settleEngineAgentTicket(config, engine, clientA);

  const base = `http://127.0.0.1:${server.port}`;
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${base}${path}`, { ...init, headers: { authorization: "Bearer client", "content-type": "application/json" }, signal: AbortSignal.timeout(90_000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  // Klient appky cez proxy klienta A: proxy pripne priečinok a server si zapamätá chat a jeho priečinok.
  const app = OpenCode.make({ baseUrl: `${base}/workspace/klient-a/opencode`, headers: { authorization: "Bearer client" } });
  const queue = z.object({ entries: z.array(z.object({ status: z.string(), error: z.string().optional() }).passthrough()), completedIds: z.array(z.string()) }).passthrough();

  /** Založí chat v `directory` cez proxy klienta A (ako appka), pošle prvú správu cez front a vráti výsledky nástrojov. */
  const chat = async (directory: string) => {
    // Ako appka (lawoss/okf/connection.ts): proxy berie priečinok chatu z rozsahu požiadavky, nie z tela.
    const session = await app.session.create({ location: { directory } }, { headers: { "x-opencode-directory": encodeURIComponent(directory) } });
    expect(session.location.directory).toBe(directory);
    const id = crypto.randomUUID();
    const enqueued = await call(`/workspace/klient-a/sessions/${session.id}/queue`, { method: "POST", body: JSON.stringify({ type: "enqueue", id,
      draft: { mode: "prompt", text: "Kde si?", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", text: "Kde si?", agent: "build", model: { providerID: "fixture", id: "fixture" } } }) });
    expect(enqueued.status).toBe(200);
    let state = queue.parse((await call(`/workspace/klient-a/sessions/${session.id}/queue`)).body);
    for (let attempt = 0; attempt < 600 && !state.completedIds.includes(id) && !state.entries.some((entry) => entry.status === "failed"); attempt++) {
      await Bun.sleep(100);
      state = queue.parse((await call(`/workspace/klient-a/sessions/${session.id}/queue`)).body);
    }
    expect({ completed: state.completedIds.includes(id), entries: state.entries }).toEqual({ completed: true, entries: [] });
    // Doručenie neznamená koniec ťahu; história sa číta cez proxy klienta (vlastníctvo chatu) po dokončení.
    await app.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(90_000) });
    const tools = (await listEngineMessages(app, session.id)).flatMap((message) => message.type === "assistant"
      ? message.content.flatMap((item) => item.type === "tool" ? [[item.name, { status: item.state.status, output: toolOutput(item.state) }] as const] : []) : []);
    return { id: session.id, tools: Object.fromEntries(tools) };
  };

  const matter = await chat(matterA);
  expect(matter.tools.legalwork_shell?.status).toBe("completed");
  expect(matter.tools.legalwork_shell?.output.trim()).toBe(matterA);
  expect(matter.tools.read).toEqual({ status: "completed", output: expect.stringContaining("OBSAH-PRIPADU") });

  const client = await chat(clientA);
  expect(client.tools.legalwork_shell?.status).toBe("completed");
  expect(client.tools.legalwork_shell?.output.trim()).toBe(clientA);
  expect(client.tools.read).toEqual({ status: "completed", output: expect.stringContaining("OBSAH-KLIENTA") });

  // Klient B (súrodenec `Klient-A`) chat prípadu klienta A nevidí ani neriadi. Vo v2 je cudzí chat aj pre nastavenia
  // spúšťania na nerozoznanie od neexistujúceho (`sessionLineage` v server.ts), ako na každej trase vlastníctva chatu.
  expect((await call(`/workspace/klient-b/sessions/${matter.id}/queue`)).status).toBe(404);
  const foreign = await call(`/workspace/klient-b/sandbox/session/${matter.id}`);
  expect({ status: foreign.status, body: foreign.body }).toMatchObject({ status: 404, body: { code: "session_not_found" } });
}, 240_000);
