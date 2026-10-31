import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, CHAT_NOT_REGISTERED, ensureWikiAgentToken } from "../wiki/agent-access.js";

// N-A7-17: a message waiting in the queue when LAWOSS quits must not be delivered by the next
// server on its own. Its chat is registered for tools only by the lawyer's Resume or next message,
// so a background delivery can neither fail on the client's files nor choose the client this
// process works with. An unregistered chat gets a refusal the model can relay without codes.

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

type Chat = { id: string; directory: string };

function engine(chats: Chat[]) {
  const state = { idle: false, delivered: [] as string[] };
  const info = (chat: Chat) => ({ id: chat.id, title: "Stav prípadov", slug: chat.id, directory: chat.directory, time: { created: 100, updated: 200, archived: 0 } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/session/status") return Response.json(Object.fromEntries(chats.map(chat => [chat.id, { type: state.idle ? "idle" : "busy" }])));
    if (pathname === "/session") return Response.json(chats.filter(chat => chat.directory === decodeURIComponent(request.headers.get("x-opencode-directory") ?? "")).map(info));
    if (pathname === "/command") return Response.json([]);
    const message = pathname.match(/^\/session\/([^/]+)\/message$/);
    if (message && request.method === "POST") {
      const body = await request.json() as { messageID?: string };
      state.delivered.push(`${message[1]}:${body.messageID ?? ""}`);
      return Response.json({ info: { id: "msg_reply", sessionID: message[1], role: "assistant", time: { created: 1, completed: 2 }, finish: "stop" }, parts: [] });
    }
    if (/^\/session\/[^/]+\/message\//.test(pathname)) return new Response("not found", { status: 404 });
    const chat = chats.find(item => pathname === `/session/${item.id}`);
    if (chat) return Response.json(info(chat));
    return Response.json({});
  } });
  cleanups.push(() => server.stop(true));
  return { state, url: `http://127.0.0.1:${server.port}` };
}

async function practice() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-queue-restart-")));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  const a = join(base, "Prax", "Klienti", "C001-klient"), b = join(base, "Prax", "Klienti", "C002-klient");
  await mkdir(join(a, ".opencode"), { recursive: true });
  await mkdir(join(b, ".opencode"), { recursive: true });
  const isolated = { LEGALWORK_TOKEN_STORE: join(base, "tokens.json"), LEGALWORK_RUNTIME_DB: join(base, "runtime.sqlite"), LEGALWORK_DATA_DIR: join(base, "data") };
  const previous = Object.fromEntries(Object.keys(isolated).map(key => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  cleanups.push(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const fake = engine([{ id: "ses_a", directory: a }, { id: "ses_b", directory: b }]);
  const config = (): ServerConfig => ({ configPath: join(base, "server.json"), host: "127.0.0.1", port: 0, token: "owt_test_token", hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [
      { id: "ws_a", name: "C001 Klient", path: a, preset: "starter", workspaceType: "local", baseUrl: fake.url },
      { id: "ws_b", name: "C002 Klient", path: b, preset: "starter", workspaceType: "local", baseUrl: fake.url },
    ],
    authorizedRoots: [a, b], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false });
  return { a, b, fake, config };
}

function queueApi(port: number, workspace: string, session: string) {
  const url = `http://127.0.0.1:${port}/workspace/${workspace}/sessions/${session}/queue`;
  const post = (body: unknown) => fetch(url, { method: "POST", headers: { Authorization: "Bearer owt_test_token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    enqueue: (id: string, text: string) => post({ type: "enqueue", id, draft: { mode: "prompt", text, parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text }] } }),
    resume: () => post({ type: "pause", paused: false }),
    read: async () => (await fetch(url, { headers: { Authorization: "Bearer owt_test_token" } })).json() as Promise<{ paused: boolean; pauseReason?: string; restartPause?: string; entries: Array<{ id: string; status: string }> }>,
  };
}

async function toolAccess(config: ServerConfig, session: string, directory: string) {
  const request = new Request("http://127.0.0.1/workspaces", { headers: {
    "x-legalwork-wiki-agent-token": await ensureWikiAgentToken(config), "x-legalwork-wiki-agent-session": session, "x-legalwork-wiki-agent-directory": encodeURIComponent(directory),
  } });
  return authenticateWikiAgentRequest(config, request).catch((error: unknown) => error);
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) await Bun.sleep(20);
  return check();
}

/** Before the restart: the chat in C001 is running and the lawyer queues a second message. */
async function queueBeforeRestart(setup: Awaited<ReturnType<typeof practice>>) {
  const first = await startServer(setup.config());
  const id = crypto.randomUUID();
  expect((await queueApi(first.port, "ws_a", "ses_a").enqueue(id, "Potom napíš len slovo koniec")).status).toBe(200);
  expect(setup.fake.state.delivered).toEqual([]);
  await first.stop();
  const config = setup.config();
  const second = await startServer(config);
  cleanups.push(() => second.stop());
  setup.fake.state.idle = true;
  // Several dispatcher ticks with an idle engine.
  await Bun.sleep(1_500);
  return { id, config, port: second.port };
}

test("a message queued before a restart waits; the lawyer's Resume delivers it with access to the client's files", async () => {
  const setup = await practice();
  const { id, config, port } = await queueBeforeRestart(setup);
  const queue = queueApi(port, "ws_a", "ses_a");
  expect(setup.fake.state.delivered).toEqual([]);
  // No queued delivery was running, so the app shows the shorter restart sentence.
  expect(await queue.read()).toMatchObject({ paused: true, pauseReason: "stop", restartPause: "waiting", entries: [{ id, status: "queued" }] });
  expect(await toolAccess(config, "ses_a", setup.a)).toMatchObject({ code: "wiki_agent_session_unknown", message: CHAT_NOT_REGISTERED });

  expect((await queue.resume()).status).toBe(200);
  expect(await until(() => setup.fake.state.delivered.length === 1)).toBe(true);
  expect(setup.fake.state.delivered).toEqual([`ses_a:msg_${id.replaceAll("-", "")}`]);
  expect((await queue.read()).restartPause).toBeUndefined();
  expect(await toolAccess(config, "ses_a", setup.a)).toMatchObject({ workspaceId: "ws_a" });
});

test("a message queued in another client before a restart neither runs nor takes the client the lawyer opens", async () => {
  const setup = await practice();
  const { config, port } = await queueBeforeRestart(setup);
  const next = crypto.randomUUID();
  expect((await queueApi(port, "ws_b", "ses_b").enqueue(next, "Zhrň stav prípadu")).status).toBe(200);
  expect(await until(() => setup.fake.state.delivered.length === 1)).toBe(true);
  await Bun.sleep(1_200);
  expect(setup.fake.state.delivered).toEqual([`ses_b:msg_${next.replaceAll("-", "")}`]);
  expect(await toolAccess(config, "ses_b", setup.b)).toMatchObject({ workspaceId: "ws_b" });
  expect((await queueApi(port, "ws_a", "ses_a").read()).paused).toBe(true);
  expect(await toolAccess(config, "ses_a", setup.a)).toMatchObject({ code: "wiki_agent_session_unknown" });
  expect(CHAT_NOT_REGISTERED).not.toMatch(/LegalWork|wiki|403/i);
});
