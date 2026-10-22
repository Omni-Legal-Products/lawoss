// LAWOSS: chat prípadu v appke so skutočným enginom (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = pribalený 1.18.29).
// Skutočný server LAWOSS, skutočný engine v dočasnom HOME/XDG, model na skúšku. Appka si priečinok chatu
// prípadu odvodí z jeho metadát (`effectiveSessionDirectory`), jej synchronizácia (`ensureWorkspaceSessionSync`)
// dostane udalosti chatu a otázku enginu na úpravu súboru, a odpoveď cez `replyToPermission` ju vybaví:
// zamietnutie → súbor nevznikne, povolenie → súbor vznikne. Odber s koreňom klienta tento chat nevidí.
//   LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
//     pnpm --filter @legalwork/app exec bun test tests/lawoss-matter-chat-engine.test.ts
import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { UIMessage } from "ai";
import { startServer } from "../../server/src/server";
import type { ServerConfig } from "../../server/src/types";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createClient, unwrap } from "../src/app/lib/opencode";
import type { PendingPermission } from "../src/app/types";
import { effectiveSessionDirectory } from "../src/lawoss/shell/session-directory";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { replyToPermission } from "../src/react-app/domains/session/sync/interaction-state";
import { ensureWorkspaceSessionSync, permissionKey, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;

async function until<T>(read: () => T | undefined | Promise<T | undefined>, label: string, ms = 60_000): Promise<T> {
  const deadline = Date.now() + ms;
  for (;;) {
    const value = await read();
    if (value !== undefined) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await Bun.sleep(100);
  }
}

test.skipIf(!binary)("chat prípadu: appka dostane udalosti a kartu povolenia z priečinka prípadu; zamietnutie nič nezmení, povolenie áno", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-app-matter-chat-")));
  const clientA = join(root, "prax", "Klient_A"), matterA = join(clientA, "Spisy", "M001-Úhrada"), clientB = join(root, "prax", "Klient-A");
  for (const folder of [matterA, clientB, join(root, "engine")]) await mkdir(folder, { recursive: true });
  const target = join(matterA, "zmena.txt");

  const env = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json"); process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), enginePort = reservation.port;
  reservation.stop(true);
  const engineUrl = `http://127.0.0.1:${enginePort}`;
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engineUrl });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), token: "synthetic-client", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", clientA), workspace("klient-b", clientB)],
    authorizedRoots: [clientA, clientB], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  // Model na skúšku: na každú správu advokáta zapíše súbor v priečinku chatu, po výsledku nástroja odpovie.
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body: unknown = await request.json();
    const messages = typeof body === "object" && body !== null && "messages" in body && Array.isArray(body.messages) ? body.messages : [];
    const last: unknown = messages.at(-1);
    const write = typeof last === "object" && last !== null && "role" in last && last.role === "user";
    const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    const call = { tool_calls: [{ index: 0, id: `call_${Date.now()}`, type: "function", function: { name: "write", arguments: JSON.stringify({ filePath: "zmena.txt", content: "ZMENA-PRIPADU" }) } }] };
    return new Response(chunk({ role: "assistant", ...(write ? call : { content: "Hotovo." }) }, null) + chunk({}, write ? "tool_calls" : "stop") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } });
  } });
  const server = await startServer(config);
  const engineConfig = join(root, "engine", "opencode.json");
  // Ako predvolenie úlohy A1: úprava súborov sa pýta.
  await writeFile(engineConfig, JSON.stringify({
    enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false, lsp: false, formatter: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: model.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    permission: { "*": "allow", edit: "ask" },
  }));
  const home = join(root, "engine");
  const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(enginePort)], { cwd: home, env: {
    PATH: process.env.PATH ?? "", HOME: join(home, "home"), OPENCODE_TEST_HOME: join(home, "home"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_CONFIG: engineConfig, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
  }, stdout: "ignore", stderr: "ignore" });
  const baseUrl = `http://127.0.0.1:${server.port}`, opencodeBaseUrl = `${baseUrl}/workspace/klient-a/opencode`, token = "synthetic-client";
  const legalwork = createLegalworkServerClient({ baseUrl, token });
  const releases: (() => void)[] = [];
  const abort = new AbortController();
  try {
    for (let i = 0; i < 300; i++) {
      try { if ((await fetch(`${engineUrl}/global/health`, { signal: AbortSignal.timeout(1000) })).ok) break; } catch { /* Engine štartuje. */ }
      await Bun.sleep(100);
    }

    // Chat prípadu založený ako v appke (openMatterSession): priečinok prípadu, workspace klienta.
    const session = unwrap(await createClient(opencodeBaseUrl, matterA, { token, mode: "legalwork" }).session.create({ directory: matterA }));
    const loaded = (await legalwork.getSessionSnapshot("klient-a", session.id)).item.session;
    const directory = effectiveSessionDirectory({ path: clientA, workspaceType: "local" }, loaded);
    expect(directory).toBe(matterA);
    const client = createClient(opencodeBaseUrl, directory, { token, mode: "legalwork" });

    // Synchronizácia appky v priečinku chatu; kontrolný odber s koreňom klienta (doterajšie správanie).
    const input = { workspaceId: "klient-a", baseUrl: opencodeBaseUrl, legalworkToken: token, directory };
    releases.push(ensureWorkspaceSessionSync(input), trackWorkspaceSessionSync(input, session.id));
    let rootEvents = "";
    const rootStream = await fetch(`${opencodeBaseUrl}/event?${new URLSearchParams({ directory: clientA })}`, { headers: { authorization: `Bearer ${token}` }, signal: abort.signal });
    expect(rootStream.status).toBe(200);
    void (async () => { const reader = rootStream.body!.getReader(); try { for (;;) { const chunk = await reader.read(); if (chunk.done) break; rootEvents += new TextDecoder().decode(chunk.value); } } catch { /* zrušené */ } })();
    await Bun.sleep(500);

    const cache = getReactQueryClient();
    const turn = async (reply: "reject" | "once") => {
      const id = crypto.randomUUID();
      await legalwork.updateSessionMessageQueue("klient-a", session.id, { type: "enqueue", id,
        draft: { mode: "prompt", text: "Zapíš zmenu.", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
        execution: { kind: "prompt", agent: "build", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Zapíš zmenu." }] } });
      // Karta povolenia: otázka enginu príde do stavu appky cez jej synchronizáciu.
      const permission = await until(() => cache.getQueryData<PendingPermission[]>(permissionKey("klient-a", session.id))?.find((item) => item.protocol !== "host"), `permission (${reply})`);
      expect(permission.permission).toBe("edit");
      await replyToPermission(client, permission, reply, directory);
      await until(async () => (await legalwork.sessionMessageQueue("klient-a", session.id)).completedIds.includes(id) || undefined, `delivery (${reply})`);
      await until(() => cache.getQueryData<PendingPermission[]>(permissionKey("klient-a", session.id))?.some((item) => item.id === permission.id) ? undefined : true, `permission cleared (${reply})`);
    };

    await turn("reject");
    expect(await Bun.file(target).exists()).toBe(false);
    await turn("once");
    expect(await readFile(target, "utf8")).toBe("ZMENA-PRIPADU");

    // Priebeh chatu prišiel do prepisu appky z udalostí (text asistenta aj nástroj).
    const transcript = await until(() => {
      const messages = cache.getQueryData<UIMessage[]>(transcriptKey("klient-a", session.id)) ?? [];
      const text = JSON.stringify(messages);
      return text.includes("Hotovo.") && text.includes("zmena.txt") ? messages : undefined;
    }, "streamed transcript");
    expect(transcript.some((message) => message.role === "assistant")).toBe(true);
    // Odber s koreňom klienta tento chat nevidel (preto appka musí odoberať priečinok chatu).
    expect(rootEvents).not.toContain(session.id);

    // Iný klient chat prípadu A neovláda ani cez priečinok prípadu.
    const foreign = await fetch(`${baseUrl}/workspace/klient-b/opencode/event?${new URLSearchParams({ directory: matterA })}`, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000) });
    expect(foreign.status).toBe(400);
    await foreign.body?.cancel();
  } finally {
    abort.abort();
    for (const release of releases.reverse()) release();
    engine.kill("SIGKILL");
    await engine.exited;
    await server.stop();
    model.stop(true);
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: env.data, LEGALWORK_TOKEN_STORE: env.tokens, LEGALWORK_RUNTIME_DB: env.db }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    await rm(root, { recursive: true, force: true });
  }
}, 240_000);
