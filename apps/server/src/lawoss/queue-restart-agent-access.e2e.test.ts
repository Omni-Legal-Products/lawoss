import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, CHAT_NOT_REGISTERED, ensureWikiAgentToken } from "../wiki/agent-access.js";

// N-A7-17: a message waiting in the queue when LAWOSS quits is delivered by the next server
// without any request from the lawyer. Its tools must still reach this client's files, and an
// unregistered chat must get a refusal the model can relay without codes.

const cleanups: Array<() => unknown> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });

function engine(root: string) {
  const state = { idle: false, delivered: [] as string[] };
  const session = () => ({ id: "ses_1", title: "Stav prípadov", slug: "stav", directory: root, time: { created: 100, updated: 200, archived: 0 } });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const { pathname } = new URL(request.url);
    if (pathname === "/session/status") return Response.json({ ses_1: { type: state.idle ? "idle" : "busy" } });
    if (pathname === "/session") return Response.json([session()]);
    if (pathname === "/session/ses_1") return Response.json(session());
    if (pathname === "/command") return Response.json([]);
    if (pathname === "/session/ses_1/message" && request.method === "POST") {
      const body = await request.json() as { messageID?: string };
      state.delivered.push(body.messageID ?? "");
      return Response.json({ info: { id: "msg_reply", sessionID: "ses_1", role: "assistant", time: { created: 1, completed: 2 }, finish: "stop" }, parts: [] });
    }
    if (pathname.startsWith("/session/ses_1/message/")) return new Response("not found", { status: 404 });
    return Response.json({});
  } });
  cleanups.push(() => server.stop(true));
  return { state, url: `http://127.0.0.1:${server.port}` };
}

function serverConfig(base: string, client: string, engineUrl: string): ServerConfig {
  return { configPath: join(base, "server.json"), host: "127.0.0.1", port: 0, token: "owt_test_token", hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "C001 Klient", path: client, preset: "starter", workspaceType: "local", baseUrl: engineUrl }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
}

async function until(check: () => boolean) {
  for (let attempt = 0; attempt < 300 && !check(); attempt++) await Bun.sleep(20);
  return check();
}

test("a queued message delivered after a restart keeps its chat's access to the client's files", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-queue-restart-")));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  const client = join(base, "Prax", "Klienti", "C001-klient");
  await mkdir(join(client, ".opencode"), { recursive: true });
  const isolated = { LEGALWORK_TOKEN_STORE: join(base, "tokens.json"), LEGALWORK_RUNTIME_DB: join(base, "runtime.sqlite"), LEGALWORK_DATA_DIR: join(base, "data") };
  const previous = Object.fromEntries(Object.keys(isolated).map(key => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  cleanups.push(() => { for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  const fake = engine(client);

  // Before the restart: the chat is running, the lawyer queues a second message.
  const first = await startServer(serverConfig(base, client, fake.url));
  const id = crypto.randomUUID();
  const queued = await fetch(`http://127.0.0.1:${first.port}/workspace/ws_1/sessions/ses_1/queue`, {
    method: "POST", headers: { Authorization: "Bearer owt_test_token", "Content-Type": "application/json" },
    body: JSON.stringify({ type: "enqueue", id, draft: { mode: "prompt", text: "Potom napíš len slovo koniec", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text: "Potom napíš len slovo koniec" }] } }),
  });
  expect(queued.status).toBe(200);
  expect(fake.state.delivered).toEqual([]);
  await first.stop();

  // After the restart: a new server process delivers the stored message on its own.
  const config = serverConfig(base, client, fake.url);
  const second = await startServer(config);
  cleanups.push(() => second.stop());
  fake.state.idle = true;
  expect(await until(() => fake.state.delivered.length === 1)).toBe(true);
  expect(fake.state.delivered).toEqual([`msg_${id.replaceAll("-", "")}`]);

  // The delivered turn's tools, as the engine plugin calls them.
  const token = await ensureWikiAgentToken(config);
  const toolRequest = (session: string) => new Request("http://127.0.0.1/workspaces", { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": session, "x-legalwork-wiki-agent-directory": encodeURIComponent(client),
  } });
  expect((await authenticateWikiAgentRequest(config, toolRequest("ses_1")))?.workspaceId).toBe("ws_1");

  // A chat nobody confirmed since the start is refused in words the model can pass on.
  const refusal = await authenticateWikiAgentRequest(config, toolRequest("ses_other")).catch((error: unknown) => error);
  expect(refusal).toMatchObject({ code: "wiki_agent_session_unknown", message: CHAT_NOT_REGISTERED });
  expect(CHAT_NOT_REGISTERED).not.toMatch(/LegalWork|wiki|403/i);
});
