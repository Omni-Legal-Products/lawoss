// LAWOSS: nástroje LAWOSS v klientovi B po práci v klientovi A, v tom istom behu enginu v2, bez reštartu
// (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = engine 2.1.4, zostavené pluginy `pnpm --filter legalwork-server build`).
// Engine dostáva len jednorazový lístok (engine-agent-contract.ts), nikdy token servera ani tajomstvo agenta.
// Údaje sú syntetické; HOME/XDG enginu sú dočasné.
//   LEGALWORK_TEST_OPENCODE_BIN=<engine 2.1.4> pnpm --filter legalwork-server exec bun test src/lawoss/engine-agent-ticket.integration.test.ts
import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { z } from "zod";
import { listEngineMessages } from "../engine-client.js";
import { createManagedOpencodeServer, type ManagedOpencodeServer } from "../managed-opencode.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, issueWikiAgentTicket } from "../wiki/agent-access.js";
import { ENGINE_CONNECTION_REFUSED, WIKI_AGENT_TICKET_ENV, WIKI_AGENT_TICKET_PATH } from "./engine-agent-contract.js";
import { settleEngineAgentTicket } from "./engine-agent-ticket.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";
import { nativeRow } from "./test-support/native-config.js";
import { builtPlugin, directToolsPlugin, fixtureModel, toolOutput } from "./test-support/scripted-engine.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const queue = z.object({ entries: z.array(z.object({ status: z.string(), error: z.string().optional() }).passthrough()), completedIds: z.array(z.string()) }).passthrough();
const engineTest = test.skipIf(!binary || process.platform === "win32"); // MCP na výpis prostredia je `/bin/sh`.

async function harness(bin: string, pluginNames: string[]) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-agent-ticket-")));
  const clientA = join(root, "prax", "Klient_A"), clientB = join(root, "prax", "Klient_B"), home = join(root, "engine"), dumps = join(root, "dumps");
  for (const folder of [clientA, clientB, home, dumps, join(home, "config-dir")]) await mkdir(folder, { recursive: true });
  await writeFile(join(clientB, "poznamka.md"), "SYNTETICKÝ OBSAH B");
  const env = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", clientA), workspace("klient-b", clientB)],
    authorizedRoots: [clientA, clientB], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => nativeRow({ permission: { bash: "allow", read: "allow", edit: "allow", webfetch: "allow" } }));

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
  // Pred serverom počítadlo vyzdvihnutí; všetko ostatné prechádza bez zmeny.
  const redemptions: number[] = [];
  const counter = Bun.serve({ hostname: "127.0.0.1", port: 0, idleTimeout: 120, async fetch(request) {
    const url = new URL(request.url);
    const response = await fetch(`${serverUrl}${url.pathname}${url.search}`, { method: request.method, headers: request.headers, body: request.method === "GET" ? undefined : await request.arrayBuffer() });
    if (url.pathname === WIKI_AGENT_TICKET_PATH) redemptions.push(response.status);
    return response;
  } });
  // Ako appka: pravidlá a model v súbore OPENCODE_CONFIG, povinné pluginy v OPENCODE_CONFIG_CONTENT, vlastný OPENCODE_CONFIG_DIR.
  const engineConfig = join(home, "opencode.json");
  await writeFile(engineConfig, JSON.stringify({ update: "disable", ...fixtureModel(model.url.origin + "/v1"), permissions: [{ action: "*", resource: "*", effect: "allow" }],
    mcp: { servers: { dump: { type: "local", command: ["/bin/sh", "-c", `env > "${dumps}/mcp-$(basename "$PWD").txt"`], timeout: { startup: 2000 } } } } }));
  const plugins = [...pluginNames.map(builtPlugin), await directToolsPlugin(home)];

  let ticket = "";
  const startEngine = async (presented?: string): Promise<ManagedOpencodeServer> => {
    ticket = issueWikiAgentTicket(config);
    // Ako appka (embedded.ts): engine na `--stdio` (bez služby), heslo z prostredia si pri štarte odstráni sám.
    const engine = await createManagedOpencodeServer({ bin, cwd: home, inheritEnvironment: false, parentLease: true, env: {
      PATH: process.env.PATH ?? "", HOME: join(home, "home"), OPENCODE_TEST_HOME: join(home, "home"),
      XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
      OPENCODE_DB: join(home, "engine.db"), OPENCODE_CONFIG: engineConfig, OPENCODE_CONFIG_DIR: join(home, "config-dir"),
      OPENCODE_CONFIG_CONTENT: JSON.stringify({ warming: false, plugins }), OPENCODE_CONFIG_PROJECT_DISABLE: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1",
      LEGALWORK_SERVER_URL: `http://127.0.0.1:${counter.port}`, [WIKI_AGENT_TICKET_ENV]: presented ?? ticket,
    } });
    for (const entry of config.workspaces) Object.assign(entry, { baseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password, directory: entry.path });
    Object.assign(config, { opencodeBaseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password });
    return engine;
  };
  const call = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${serverUrl}${path}`, { ...init, headers: { authorization: "Bearer client", "content-type": "application/json" }, signal: AbortSignal.timeout(120_000) });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const app = (workspaceId: string) => OpenCode.make({ baseUrl: `${serverUrl}/workspace/${workspaceId}/opencode`, headers: { authorization: "Bearer client" } });
  /** Nový chat cez proxy klienta ako v appke (priečinok v rozsahu požiadavky); server si chat zapamätá. */
  const newSession = async (workspaceId: string, directory: string) =>
    (await app(workspaceId).session.create({ location: { directory } }, { headers: { "x-opencode-directory": encodeURIComponent(directory) } })).id;
  /** Pošle správu cez front servera a vráti výsledky nástrojov tejto relácie podľa volania. */
  const send = async (workspaceId: string, session: string, key: string) => {
    const id = crypto.randomUUID();
    const text = `KROK:${key}`;
    const enqueued = await call(`/workspace/${workspaceId}/sessions/${session}/queue`, { method: "POST", body: JSON.stringify({ type: "enqueue", id,
      draft: { mode: "prompt", text, parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", text, agent: "build", model: { providerID: "fixture", id: "fixture" } } }) });
    expect(enqueued.status).toBe(200);
    let state = queue.parse((await call(`/workspace/${workspaceId}/sessions/${session}/queue`)).body);
    for (let attempt = 0; attempt < 1200 && !state.completedIds.includes(id) && !state.entries.some((entry) => entry.status === "failed"); attempt++) {
      await Bun.sleep(100);
      state = queue.parse((await call(`/workspace/${workspaceId}/sessions/${session}/queue`)).body);
    }
    expect({ completed: state.completedIds.includes(id), entries: state.entries }).toEqual({ completed: true, entries: [] });
    const client = app(workspaceId);
    await client.session.wait({ sessionID: session }, { signal: AbortSignal.timeout(120_000) });
    return (await listEngineMessages(client, session)).flatMap((message) => message.type === "assistant"
      ? message.content.flatMap((item) => item.type === "tool" ? [{ name: item.name, status: item.state.status, output: toolOutput(item.state) }] : []) : []);
  };
  const asChat = (session: string, directory: string, workspaceId: string, token: string, path = "x.md") => fetch(`${serverUrl}/workspace/${workspaceId}/files/content?path=${path}`, { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": session, "x-legalwork-wiki-agent-directory": encodeURIComponent(directory) } });
  const replay = (presented: string) => fetch(`${serverUrl}${WIKI_AGENT_TICKET_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket: presented, nonce: "another-nonce" }) });
  /** Skutočný `lawoss_files`: musí prejsť cez server (plán aj zápis) a zanechať priečinok na disku; shell vypíše prostredie. */
  const useTools = async (workspaceId: string, directory: string, folder: string, session?: string) => {
    steps.set(folder, [
      { name: "lawoss_files", arguments: { operations: [{ operation: "create_folder", path: folder }] } },
      { name: "shell", arguments: { command: `env > "${dumps}/shell-${folder}.txt"`, description: "Prostredie" } },
    ]);
    const chat = session ?? await newSession(workspaceId, directory);
    const tools = await send(workspaceId, chat, folder);
    const files = tools.filter((tool) => tool.name === "lawoss_files").at(-1);
    expect({ folder, status: files?.status, output: files?.status === "completed" ? "" : files?.output }).toEqual({ folder, status: "completed", output: "" });
    await access(join(directory, folder));
    expect(tools.filter((tool) => tool.name === "shell").at(-1)?.status).toBe("completed");
    return chat;
  };
  const close = async () => {
    await server.stop();
    counter.stop(true);
    model.stop(true);
    closeRuntimeOpencodeConfig(config);
    for (const [key, value] of [["LEGALWORK_DATA_DIR", env.data], ["LEGALWORK_TOKEN_STORE", env.tokens], ["LEGALWORK_RUNTIME_DB", env.db]] as const) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    await removeTestDir(root);
  };
  return { root, config, clientA, clientB, dumps, steps, redemptions, startEngine, newSession, send, asChat, replay, useTools, close, spentTicket: () => ticket };
}

engineTest("chat v klientovi B má nástroje LAWOSS po klientovi A, po uvoľnení lokácie A aj po novom engine", async () => {
  const h = await harness(binary ?? "", ["lawoss-file-operations"]);
  const { config, clientA, clientB, dumps, asChat } = h;
  let engine = await h.startEngine();
  try {
    // Ako appka po štarte: lokácia otvoreného klienta si načíta pluginy (vyzdvihnú lístok), potom sa okno zavrie.
    await settleEngineAgentTicket(config, engine, clientA);
    const auth = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };

    // A, potom B, potom uvoľnenie lokácie A (rozpočet MCP to robí bežne, server.ts disposeEngineDirectory), potom znova A. Bez reštartu.
    const chatA = await h.useTools("klient-a", clientA, "A1");
    const chatB = await h.useTools("klient-b", clientB, "B1");
    const disposed = await fetch(`${engine.url}/api/debug/location?${new URLSearchParams({ "location[directory]": clientA })}`, { method: "DELETE", headers: auth });
    expect(disposed.ok).toBe(true);
    await h.useTools("klient-a", clientA, "A2", chatA);
    await h.useTools("klient-a", clientA, "A3");
    await h.useTools("klient-b", clientB, "B2", chatB);

    // Prostredie detí enginu (MCP, shell): bez tajomstva, lístka, hesla enginu a cesty ku konfigurácii. Engine prihlásenie vyžaduje ďalej.
    const secret = await ensureWikiAgentToken(config);
    const mcpDumps = (await readdir(dumps)).filter((name) => name.startsWith("mcp-")).sort();
    expect(mcpDumps.length).toBeGreaterThan(0);
    for (const name of [...mcpDumps, "shell-A1.txt", "shell-B1.txt", "shell-A2.txt", "shell-A3.txt", "shell-B2.txt"]) {
      const dump = await readFile(join(dumps, name), "utf8");
      expect({ name, hasPath: dump.includes("PATH="), secret: dump.includes(secret), ticket: dump.includes(WIKI_AGENT_TICKET_ENV), oldName: dump.includes("LEGALWORK_WIKI_AGENT_TOKEN"),
        password: dump.includes("OPENCODE_PASSWORD=") || dump.includes("OPENCODE_SERVER_PASSWORD=") || dump.includes(engine.password), username: dump.includes("OPENCODE_SERVER_USERNAME="), config: dump.includes("OPENCODE_CONFIG=") })
        .toEqual({ name, hasPath: true, secret: false, ticket: false, oldName: false, password: false, username: false, config: false });
    }
    // Ani MCP (aj balíky z Marketplace) nedostanú cestu k DB enginu so všetkými chatmi ani konfiguráciu (MČ 10. 11. 2026).
    for (const name of [...mcpDumps, "shell-A1.txt", "shell-B2.txt"]) {
      const dump = await readFile(join(dumps, name), "utf8");
      expect({ name, configDir: dump.includes("OPENCODE_CONFIG_DIR="), content: dump.includes("OPENCODE_CONFIG_CONTENT="), db: dump.includes("OPENCODE_DB=") }).toEqual({ name, configDir: false, content: false, db: false });
    }
    // Engine v2 bez hesla neodpovie (instance-free /api/info).
    expect((await fetch(`${engine.url}/api/info`)).status).toBe(401);
    expect((await fetch(`${engine.url}/api/info`, { headers: { authorization: `Basic ${Buffer.from(`${engine.username}:wrong`).toString("base64")}` } })).status).toBe(401);
    expect((await fetch(`${engine.url}/api/info`, { headers: auth })).status).toBe(200);

    // Lístok otvorí len jedno použitie: ako kľúč neplatí a opakovanie po uzavretí okna tajomstvo nezmení.
    const spent = h.spentTicket();
    const forged = await asChat(chatB, clientB, "klient-b", spent);
    expect(forged.status).toBe(403);
    expect(await forged.json()).toMatchObject({ code: "wiki_agent_unauthorized" });
    expect((await h.replay(spent)).status).toBe(403);
    expect(await ensureWikiAgentToken(config)).toBe(secret);
    await h.useTools("klient-b", clientB, "B3", chatB);

    // Relácia A, ktorá pomenuje priestor B, ostáva odmietnutá aj so správnym tajomstvom.
    const crossing = await asChat(chatA, clientA, "klient-b", secret);
    expect(crossing.status).toBe(403);
    expect(await crossing.json()).toMatchObject({ code: "wiki_agent_workspace_denied" });
    const crossingDirectory = await asChat(chatA, clientB, "klient-b", secret);
    expect(crossingDirectory.status).toBe(403);
    expect(await crossingDirectory.json()).toMatchObject({ code: "wiki_agent_directory_mismatch" });
    // Tajomstvo s reláciou a priečinkom B prejde: server chaty toho istého enginu nerozlíši, hranicou je, že sa tajomstvo nedostane mimo pluginov. See coordination record.
    const secretHolderAsB = await asChat(chatB, clientB, "klient-b", secret, "poznamka.md");
    expect(secretHolderAsB.status).toBe(200);
    expect(await secretHolderAsB.text()).toContain("SYNTETICKÝ OBSAH B");

    // Nový engine dostane nový lístok a tajomstvo, staré prestanú platiť.
    await engine.close();
    engine = await h.startEngine();
    await settleEngineAgentTicket(config, engine, clientB);
    await h.useTools("klient-b", clientB, "B4");
    await h.useTools("klient-a", clientA, "A4");
    const stale = await asChat(chatB, clientB, "klient-b", secret);
    expect(stale.status).toBe(403);
    expect(await stale.json()).toMatchObject({ code: "wiki_agent_unauthorized" });

    // Neplatný lístok: nástroj sa zavrie s textom pre advokáta, bez lístka a bez zmeny na disku.
    await engine.close();
    engine = await h.startEngine("synthetic-invalid-ticket");
    h.steps.set("B5", [{ name: "lawoss_files", arguments: { operations: [{ operation: "create_folder", path: "B5" }] } }]);
    const refused = (await h.send("klient-b", await h.newSession("klient-b", clientB), "B5")).filter((tool) => tool.name === "lawoss_files").at(-1);
    expect(refused?.status).toBe("error");
    expect(refused?.output).toContain(ENGINE_CONNECTION_REFUSED);
    expect(refused?.output).not.toContain("synthetic-invalid-ticket");
    expect(await access(join(clientB, "B5")).then(() => true, () => false)).toBe(false);
  } finally {
    await engine.close();
    await h.close();
  }
}, 420_000);

engineTest("dva balíky pluginov sa o lístok uchádzajú súbežne, sonda beží popri prvých chatoch ako v produkcii", async () => {
  const h = await harness(binary ?? "", ["lawoss-file-operations", "legalwork-org-policy-guard"]);
  const engine = await h.startEngine();
  try {
    // Ako embedded.ts: sonda sa nečaká a chaty A a B môžu prísť hneď.
    const settled = settleEngineAgentTicket(h.config, engine, h.clientA);
    await Promise.all([h.useTools("klient-a", h.clientA, "A1"), h.useTools("klient-b", h.clientB, "B1")]);
    await settled;
    expect(h.redemptions).toEqual([200]);
    const secret = await ensureWikiAgentToken(h.config);
    expect((await h.replay(h.spentTicket())).status).toBe(403);
    expect(await ensureWikiAgentToken(h.config)).toBe(secret);
    await h.useTools("klient-b", h.clientB, "B2");
  } finally {
    await engine.close();
    await h.close();
  }
}, 420_000);
