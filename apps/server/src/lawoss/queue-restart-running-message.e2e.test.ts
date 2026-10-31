import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, CHAT_NOT_REGISTERED, ensureWikiAgentToken } from "../wiki/agent-access.js";

// N-A7-17 (regression 30. 10.): in the app every message goes through the queue, so the running
// first message is itself a queue entry in delivery ("sending") when LAWOSS quits. After the restart
// it is restored as "uncertain" and the queue pauses for that. Once the engine confirms the first
// message, that pause lifted itself and the waiting second message was delivered without the lawyer,
// with no registered chat. The waiting message must keep waiting for "Resume queue".

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

const messageId = (id: string) => `msg_${id.replaceAll("-", "")}`;

function engine(chat: { id: string; directory: string }) {
  const state = { phase: "before" as "before" | "after", busy: false, delivered: [] as string[], accepted: new Set<string>() };
  const info = { id: chat.id, title: "Stav prípadov", slug: chat.id, directory: chat.directory, time: { created: 100, updated: 200, archived: 0 } };
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/session/status") return Response.json(state.busy ? { [chat.id]: { type: "busy" } } : {});
    if (pathname === "/session") return Response.json(decodeURIComponent(request.headers.get("x-opencode-directory") ?? "") === chat.directory ? [info] : []);
    if (pathname === "/command") return Response.json([]);
    if (pathname === `/session/${chat.id}/message` && request.method === "POST") {
      const body = await request.json() as { messageID?: string };
      const id = body.messageID ?? "";
      state.accepted.add(id);
      if (state.phase === "before") {
        // The first message runs until LAWOSS quits; the old engine never answers it.
        state.busy = true;
        return new Promise<Response>(() => {});
      }
      state.delivered.push(id);
      return Response.json({ info: { id: "msg_reply", sessionID: chat.id, role: "assistant", time: { created: 1, completed: 2 }, finish: "stop" }, parts: [] });
    }
    const stored = pathname.match(new RegExp(`^/session/${chat.id}/message/([^/]+)$`));
    if (stored) {
      // The engine database keeps the interrupted first message across the restart.
      if (!state.accepted.has(stored[1]!)) return new Response("not found", { status: 404 });
      return Response.json({ info: { id: stored[1], sessionID: chat.id, role: "user", time: { created: 1 } }, parts: [] });
    }
    if (pathname === `/session/${chat.id}`) return Response.json(info);
    return Response.json({});
  } });
  cleanups.push(() => server.stop(true));
  return { state, url: `http://127.0.0.1:${server.port}` };
}

async function practice() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-queue-running-")));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  const client = join(base, "Prax", "Klienti", "C001-klient");
  await mkdir(join(client, ".opencode"), { recursive: true });
  const isolated = { LEGALWORK_TOKEN_STORE: join(base, "tokens.json"), LEGALWORK_RUNTIME_DB: join(base, "runtime.sqlite"), LEGALWORK_DATA_DIR: join(base, "data") };
  const previous = Object.fromEntries(Object.keys(isolated).map(key => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  cleanups.push(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const fake = engine({ id: "ses_a", directory: client });
  const config = (): ServerConfig => ({ configPath: join(base, "server.json"), host: "127.0.0.1", port: 0, token: "owt_test_token", hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_a", name: "C001 Klient", path: client, preset: "starter", workspaceType: "local", baseUrl: fake.url }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false });
  return { client, fake, config };
}

function queueApi(port: number) {
  const url = `http://127.0.0.1:${port}/workspace/ws_a/sessions/ses_a/queue`;
  const post = (body: unknown) => fetch(url, { method: "POST", headers: { Authorization: "Bearer owt_test_token", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return {
    enqueue: (id: string, text: string) => post({ type: "enqueue", id, draft: { mode: "prompt", text, parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text }] } }),
    resume: () => post({ type: "pause", paused: false }),
    read: async () => (await fetch(url, { headers: { Authorization: "Bearer owt_test_token" } })).json() as Promise<{ paused: boolean; pauseReason?: string; restartPause?: string; completedIds: string[]; entries: Array<{ id: string; status: string }> }>,
  };
}

async function toolAccess(config: ServerConfig, directory: string) {
  const request = new Request("http://127.0.0.1/workspaces", { headers: {
    "x-legalwork-wiki-agent-token": await ensureWikiAgentToken(config), "x-legalwork-wiki-agent-session": "ses_a", "x-legalwork-wiki-agent-directory": encodeURIComponent(directory),
  } });
  return authenticateWikiAgentRequest(config, request).catch((error: unknown) => error);
}

async function until(check: () => boolean | Promise<boolean>) {
  for (let attempt = 0; attempt < 300 && !(await check()); attempt++) await Bun.sleep(20);
  return check();
}

test("after a restart during a run, the message waiting behind it waits for the lawyer even once the first one is confirmed", async () => {
  const setup = await practice();
  const first = await startServer(setup.config());
  const running = crypto.randomUUID(), waiting = crypto.randomUUID();
  const before = queueApi(first.port);
  // The lawyer's first message starts the run through the queue, as the app sends it.
  expect((await before.enqueue(running, "Prejdi všetky prípady klienta")).status).toBe(200);
  expect(await until(() => setup.fake.state.busy)).toBe(true);
  // During the run the lawyer queues a second message.
  expect((await before.enqueue(waiting, "Na záver to zhrň do troch odrážok")).status).toBe(200);
  expect((await before.read()).entries).toEqual([expect.objectContaining({ id: running, status: "sending" }), expect.objectContaining({ id: waiting, status: "queued" })]);
  await first.stop();

  // LAWOSS restarts; the new engine is idle and has the interrupted first message.
  setup.fake.state.phase = "after";
  setup.fake.state.busy = false;
  const config = setup.config();
  const second = await startServer(config);
  cleanups.push(() => second.stop());
  const queue = queueApi(second.port);
  expect(await until(async () => (await queue.read()).completedIds.includes(running))).toBe(true);
  // Several dispatcher ticks after the first message is reconciled.
  await Bun.sleep(1_500);
  expect(setup.fake.state.delivered).toEqual([]);
  // The app shows why: "Front je pozastavený po reštarte aplikácie. Prvá úloha bola prerušená, …".
  expect(await queue.read()).toMatchObject({ paused: true, pauseReason: "stop", restartPause: "interrupted", entries: [{ id: waiting, status: "queued" }] });
  expect(await toolAccess(config, setup.client)).toMatchObject({ code: "wiki_agent_session_unknown", message: CHAT_NOT_REGISTERED });

  // "Obnoviť front" registers the chat and only then delivers the waiting message.
  expect((await queue.resume()).status).toBe(200);
  expect(await until(() => setup.fake.state.delivered.length === 1)).toBe(true);
  expect(setup.fake.state.delivered).toEqual([messageId(waiting)]);
  expect((await queue.read()).restartPause).toBeUndefined();
  expect(await toolAccess(config, setup.client)).toMatchObject({ workspaceId: "ws_a" });
});
