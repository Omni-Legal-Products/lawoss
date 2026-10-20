import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { enforceAiBoundaries } from "./lawoss/test-support/ai-boundaries.js";
import { startServer } from "./server.js";
import { SessionMessageQueue, QueuePreparationError } from "./session-message-queue.js";
import { queueActionSchema } from "./session-queue-schema.js";
import { assertNoHostShellInterpolation } from "./agent-sandbox/proxy-gate.js";
import { openSqlite } from "./runtime-db.js";
import type { ServerConfig } from "./types.js";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) {
    await stops.pop()?.();
  }
  while (roots.length) {
    await rm(roots.pop()!, { recursive: true, force: true });
  }
});

async function createWorkspaceRoot(folderName?: string) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-session-read-"));
  const workspaceRoot = folderName ? join(root, folderName) : root;
  await mkdir(join(workspaceRoot, ".opencode"), { recursive: true });
  roots.push(root);
  return workspaceRoot;
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function startMockOpencode(input?: { sessionDirectory?: string; invalidList?: boolean; holdCommand?: Promise<void>; idle?: () => boolean; retry?: () => { type: "retry"; attempt: number; message: string; next: number } | null; commands?: () => Array<{ name: string; template: string }>; promptError?: () => { name: string; data: { message: string } } | undefined; providerId?: string; captureSessionCreate?: (headers: Headers, body: unknown) => void }) {
  const requests: Array<{ pathname: string; search: string; directory: string | null; method: string }> = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      requests.push({
        pathname: url.pathname,
        method: request.method,
        search: url.search,
        directory: request.headers.get("x-opencode-directory"),
      });

      if (url.pathname === "/session" && request.method === "POST") {
        input?.captureSessionCreate?.(request.headers, await request.json());
        return Response.json({ id: "ses_created", directory: request.headers.get("x-opencode-directory"), time: {} });
      }

      if (url.pathname === "/session") {
        if (input?.invalidList) {
          return Response.json({ nope: true });
        }
        return Response.json([
          {
            id: "ses_1",
            title: "Hostname Check",
            slug: "hostname-check",
            directory: request.headers.get("x-opencode-directory"),
            time: { created: 100, updated: 200 },
          },
        ]);
      }

      if (url.pathname === "/session/status") {
        return Response.json({ ses_1: input?.retry?.() ?? { type: input?.idle?.() ? "idle" : "busy" } });
      }
      if (url.pathname === "/session/ses_1/abort") return Response.json(true);
      if (url.pathname === "/command") return Response.json(input?.commands?.() ?? []);

      if (url.pathname === "/session/ses_1") {
        return Response.json({
          id: "ses_1",
          title: "Hostname Check",
          slug: "hostname-check",
          directory: input?.sessionDirectory ?? request.headers.get("x-opencode-directory"),
          time: { created: 100, updated: 200 },
        });
      }

      if (url.pathname === "/session/ses_1/message" && request.method === "POST") {
        return Response.json({ info: { id: "response", role: "assistant", error: input?.promptError?.() }, parts: [] });
      }

      if (url.pathname === "/session/ses_1/message") {
        return Response.json([
          {
            info: {
              id: "msg_1",
              sessionID: "ses_1",
              role: "assistant",
              providerID: input?.providerId ?? "openai",
              time: { created: 200 },
            },
            parts: [
              {
                id: "prt_1",
                messageID: "msg_1",
                sessionID: "ses_1",
                type: "text",
                text: "hostname: mock-host",
              },
            ],
          },
        ]);
      }

      if (url.pathname === "/session/ses_1/message/msg_1") {
        return Response.json({ info: { id: "msg_1", sessionID: "ses_1", role: "assistant", providerID: input?.providerId ?? "openai" }, parts: [] });
      }

      if (url.pathname === "/session/ses_1/todo") {
        return Response.json([
          {
            content: "Validate session reads",
            status: "completed",
            priority: "high",
          },
        ]);
      }

      if (url.pathname === "/session/ses_1/command" && request.method === "POST") {
        await input?.holdCommand;
        return Response.json({ ok: true });
      }

      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startLegalworkServer(input: { workspaceRoot: string; opencodeBaseUrl: string; readOnly?: boolean; agentSandboxEnabled?: boolean; aiBoundaries?: boolean }) {
  const isolated = { LEGALWORK_TOKEN_STORE: join(input.workspaceRoot, "tokens.json"), LEGALWORK_RUNTIME_DB: join(input.workspaceRoot, "runtime.sqlite"), LEGALWORK_DATA_DIR: join(input.workspaceRoot, "data") };
  const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  stops.push(() => {
    for (const key of Object.keys(isolated)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const config: ServerConfig = {
    configPath: join(input.workspaceRoot, "server.json"),
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [
      {
        id: "ws_1",
        name: "Workspace",
        path: input.workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: input.opencodeBaseUrl,
      },
    ],
    authorizedRoots: [input.workspaceRoot],
    readOnly: input.readOnly ?? true,
    agentSandboxEnabled: input.agentSandboxEnabled,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  // #168 denial expectations: „AI hranice" on explicitly (per-root runtime DB).
  if (input.aiBoundaries) await enforceAiBoundaries(config);
  return { server, token: config.token };
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let index = 0; index < 20; index++) {
    if (predicate()) return true;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return predicate();
}

describe("workspace session read APIs", () => {
  test("persistent retry stops once bounded and its reason survives transcript reload", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    let attempt = 2;
    const mock = startMockOpencode({ retry: () => ({ type: "retry", attempt, message: "Service unavailable", next: 1000 }) });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1`;
    const headers = auth(legalwork.token);
    expect(await fetch(`${base}/retry-stop`, { method: "POST", headers }).then(response => response.json())).toEqual({ stopped: false });
    expect(mock.requests.filter(request => request.pathname.endsWith("/abort"))).toHaveLength(0);
    attempt = 3;
    expect(await fetch(`${base}/retry-stop`, { method: "POST", headers }).then(response => response.json())).toEqual({ stopped: true });
    expect(mock.requests.filter(request => request.pathname.endsWith("/abort"))).toHaveLength(1);
    const snapshot = await fetch(`${base}/snapshot`, { headers }).then(response => response.json());
    expect(snapshot.item.messages[0].info.error.data.message).toContain("Automatic retries stopped");
    const messages = await fetch(`${base}/messages`, { headers }).then(response => response.json());
    expect(messages.items[0].info.error.data.message).toBe(snapshot.item.messages[0].info.error.data.message);
  });

  test("request admission details survive snapshot and transcript reads, and malformed details are rejected", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    // Start with the provider-only table shipped before admission details.
    const db = await openSqlite(join(workspaceRoot, "runtime.sqlite"));
    db.exec("CREATE TABLE session_usage_limits (workspace_id TEXT NOT NULL, session_id TEXT NOT NULL, message_id TEXT NOT NULL, provider_id TEXT NOT NULL, PRIMARY KEY(workspace_id,session_id,message_id))");
    db.run("INSERT INTO session_usage_limits VALUES (?,?,?,?)", ["ws_1", "ses_1", "msg_1", "openai"]);
    const mock = startMockOpencode({ providerId: "eigenwelt" });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1`;
    const headers = { ...auth(legalwork.token), "Content-Type": "application/json" };
    const legacy = await fetch(`${base}/snapshot`, { headers }).then(response => response.json());
    expect(legacy.item.messages[0].info.error.data.message).toBe("LegalWork provider usage limit: openai");
    const limit = { reason: "organization_limit", requiredMicros: 200000, availableMicros: 90000 };
    const response = await fetch(`${base}/usage-limit`, { method: "POST", headers, body: JSON.stringify({ messageId: "msg_1", limit }) });
    expect(response.status).toBe(200);
    const snapshot = await fetch(`${base}/snapshot`, { headers }).then(response => response.json());
    const text = snapshot.item.messages[0].info.error.data.message;
    expect(decodeURIComponent(text.split(" ").at(-1))).toBe(JSON.stringify(limit));
    const messages = await fetch(`${base}/messages`, { headers }).then(response => response.json());
    expect(messages.items[0].info.error.data.message).toBe(text);
    const malformed = await fetch(`${base}/usage-limit`, { method: "POST", headers, body: JSON.stringify({ messageId: "msg_1", limit: { ...limit, reason: "unknown" } }) });
    expect(malformed.status).toBe(400);
  });
  test("a stopped quota turn stays actionable in subsequent snapshots and message reads", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1`;
    const response = await fetch(`${base}/usage-limit`, { method: "POST", headers: { ...auth(legalwork.token), "Content-Type": "application/json" }, body: JSON.stringify({ messageId: "msg_1" }) });
    expect(response.status).toBe(200);
    const snapshot = await fetch(`${base}/snapshot`, { headers: auth(legalwork.token) }).then(response => response.json());
    expect(snapshot.item.messages[0].info.error.data.message).toBe("LegalWork provider usage limit: openai");
    const messages = await fetch(`${base}/messages`, { headers: auth(legalwork.token) }).then(response => response.json());
    expect(messages.items[0].info.error).toEqual(snapshot.item.messages[0].info.error);
    const wrongTurn = await fetch(`${base}/usage-limit`, { method: "POST", headers: { ...auth(legalwork.token), "Content-Type": "application/json" }, body: JSON.stringify({ messageId: "does-not-exist" }) });
    expect(wrongTurn.status).not.toBe(200);
  });

  test("lists sessions and returns session details, messages, and snapshot", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const base = `http://127.0.0.1:${legalwork.server.port}`;

    const listResponse = await fetch(`${base}/workspace/ws_1/sessions?roots=true&limit=1&search=host&start=10`, {
      headers: auth(legalwork.token),
    });
    expect(listResponse.status).toBe(200);
    const listBody = await listResponse.json();
    expect(listBody).toEqual({
      items: [
        {
          id: "ses_1",
          title: "Hostname Check",
          slug: "hostname-check",
          directory: workspaceRoot,
          time: { created: 100, updated: 200 },
        },
      ],
    });

    const detailResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1`, {
      headers: auth(legalwork.token),
    });
    expect(detailResponse.status).toBe(200);
    const detailBody = await detailResponse.json();
    expect(detailBody.item.id).toBe("ses_1");
    expect(detailBody.item.directory).toBe(workspaceRoot);

    const messagesResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1/messages?limit=5`, {
      headers: auth(legalwork.token),
    });
    expect(messagesResponse.status).toBe(200);
    const messagesBody = await messagesResponse.json();
    expect(messagesBody.items).toHaveLength(1);
    expect(messagesBody.items[0]?.info.id).toBe("msg_1");
    expect(messagesBody.items[0]?.parts[0]?.text).toBe("hostname: mock-host");

    const snapshotResponse = await fetch(`${base}/workspace/ws_1/sessions/ses_1/snapshot?limit=5`, {
      headers: auth(legalwork.token),
    });
    expect(snapshotResponse.status).toBe(200);
    const snapshotBody = await snapshotResponse.json();
    expect(snapshotBody.item.session.id).toBe("ses_1");
    expect(snapshotBody.item.messages).toHaveLength(1);
    expect(snapshotBody.item.todos).toEqual([
      {
        content: "Validate session reads",
        status: "completed",
        priority: "high",
      },
    ]);
    expect(snapshotBody.item.status).toEqual({ type: "busy" });

    const listRequest = mock.requests.find((request) => request.pathname === "/session");
    expect(listRequest?.directory).toBe(workspaceRoot);
    expect(listRequest?.search).toContain("roots=true");
    expect(listRequest?.search).toContain("limit=1");
    expect(listRequest?.search).toContain("search=host");
    expect(listRequest?.search).toContain("start=10");

  });

  test("accepts guest-side rem_ workspace aliases for session reads", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/rem_ws_1/sessions`, {
      headers: auth(legalwork.token),
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.items[0]?.id).toBe("ses_1");
    expect(body.items[0]?.directory).toBe(workspaceRoot);
    expect(mock.requests.find((request) => request.pathname === "/session")?.directory).toBe(workspaceRoot);
  });

  test("encodes non-ASCII workspace directory headers for session reads", async () => {
    const workspaceRoot = await createWorkspaceRoot("项目");
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(legalwork.token),
    });

    expect(response.status).toBe(200);
    const listRequest = mock.requests.find((request) => request.pathname === "/session");
    const encodedDirectory = encodeURIComponent(workspaceRoot);
    expect(listRequest?.directory).toBe(encodedDirectory);
    expect(listRequest?.search).toContain(`directory=${encodedDirectory}`);
  });

  test("encodes non-ASCII workspace directory headers for opencode proxy requests", async () => {
    const workspaceRoot = await createWorkspaceRoot("项目");
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/opencode/session`, {
      headers: auth(legalwork.token),
    });

    expect(response.status).toBe(200);
    const proxyRequest = mock.requests.find((request) => request.pathname === "/session");
    expect(proxyRequest?.directory).toBe(encodeURIComponent(workspaceRoot));
  });

  test("returns 404 when the upstream session is missing", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_missing/snapshot`, {
      headers: auth(legalwork.token),
    });
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      code: "session_not_found",
      message: "Session not found",
    });

  });

  test("with AI boundaries on, protected session commands fail promptly without contacting the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const command = deferred();
    const mock = startMockOpencode({ holdCommand: command.promise });
    const legalwork = await startLegalworkServer({ workspaceRoot, readOnly: false, aiBoundaries: true, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}` });
    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/opencode/session/ses_1/command`, {
      method: "POST", headers: { ...auth(legalwork.token), "Content-Type": "application/json" }, body: JSON.stringify({ command: "review", arguments: "" }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "ai_transfer_denied" });
    expect(mock.requests.some(request => request.pathname === "/session/ses_1/command")).toBe(false);
    command.resolve();
  });

  test("keeps legacy /w workspace opencode proxy alias", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/w/ws_1/opencode/session`, {
      headers: auth(legalwork.token),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(Array.isArray(body)).toBe(true);
    expect(mock.requests.some((request) => request.pathname === "/session")).toBe(true);
  });

  test("forwards sandbox-rewritten session creation without a stale content length", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    let forwarded: { headers: Headers; body: unknown } | undefined;
    const mock = startMockOpencode({ captureSessionCreate: (headers, body) => { forwarded = { headers, body }; } });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, agentSandboxEnabled: true, readOnly: false });
    const body = JSON.stringify({ title: "Synthetic Č", tools: { bash: false } });
    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/opencode/session`, {
      method: "POST", headers: { ...auth(legalwork.token), "Content-Type": "application/json", "Content-Length": String(Buffer.byteLength(body)) }, body,
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ id: "ses_created" });
    expect(forwarded?.body).toMatchObject({ title: "Synthetic Č", tools: { bash: false, legalwork_shell: false } });
    // The receiver's HTTP stack computes length for the actual rewritten bytes;
    // it must never receive the smaller caller-supplied pre-rewrite length.
    expect(Number(forwarded?.headers.get("content-length"))).not.toBe(Buffer.byteLength(body));
    expect(mock.requests.filter(request => request.method === "POST").map(request => request.pathname)).toEqual(["/session"]);
  });

  test("returns 502 when OpenCode returns an invalid session list payload", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ invalidList: true });
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(legalwork.token),
    });
    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toMatchObject({
      code: "opencode_invalid_response",
      message: "OpenCode returned invalid session list",
    });

  });

  test("reports an unreachable OpenCode engine as unavailable", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("ok") });
    const port = probe.port;
    await probe.stop(true);
    const legalwork = await startLegalworkServer({
      workspaceRoot,
      opencodeBaseUrl: `http://127.0.0.1:${port}`,
    });

    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions`, {
      headers: auth(legalwork.token),
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: "opencode_unavailable",
      message: "OpenCode engine is not ready",
    });
  });
});


describe("shared session queue API", () => {
  test("with AI boundaries on, queued execution cannot bypass the protected shell or interpolate host commands", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ idle: () => true, commands: () => [
      { name: "review", template: "Review these files" },
      { name: "unsafe", template: "Inspect !`echo unexpected-host-execution`" },
    ] });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false, aiBoundaries: true, agentSandboxEnabled: true });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1/queue`;
    const headers = { ...auth(legalwork.token), "Content-Type": "application/json" };
    const enqueue = (execution: unknown) => fetch(base, { method: "POST", headers, body: JSON.stringify({
      type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text: "queue check", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } }, execution,
    }) });
    const command = { kind: "command", command: "review", arguments: "", model: "test/test" };
    for (const execution of [
      { kind: "shell", command: "echo unexpected-host-execution" },
      { ...command, arguments: "!`echo unexpected-host-execution`" },
      { ...command, command: "unsafe" },
    ]) {
      const rejected = await enqueue(execution);
      expect(rejected.status).toBe(403);
    }
    expect((await fetch(base, { headers }).then(response => response.json())).entries).toEqual([]);
    expect(mock.requests.some(request => /\/(shell|command)$/.test(request.pathname) && request.method === "POST")).toBe(false);
    const protectedCommand = await enqueue(command);
    expect(protectedCommand.status).toBe(403);
    expect(await protectedCommand.json()).toMatchObject({ code: "ai_transfer_denied" });
    expect((await fetch(base, { headers }).then(response => response.json())).entries).toEqual([]);
    expect(mock.requests.some(request => request.method === "POST")).toBe(false);
  });
  test("a queued shortcut is checked again through its owned transport when its definition changes", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    let template = "Review these files", deliveries = 0;
    const queue = new SessionMessageQueue(join(workspaceRoot, "owned-queue"), {
      idle: async () => true,
      send: async () => { try { assertNoHostShellInterpolation(template); } catch (error) { throw new QueuePreparationError(error instanceof Error ? error.message : "Invalid shortcut"); } deliveries++; },
    });
    stops.push(() => queue.stop());
    await queue.act("ws_1", "ses_1", { type: "pause", paused: true });
    await queue.act("ws_1", "ses_1", queueActionSchema.parse({ type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text: "queue check", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } }, execution: { kind: "command", command: "review", arguments: "", model: "test/test" } }));
    template = "Inspect !`echo unexpected-host-execution`";
    await queue.act("ws_1", "ses_1", { type: "pause", paused: false });
    expect(await waitUntil(() => deliveries > 0)).toBe(false);
    const failed = await queue.read("ws_1", "ses_1");
    expect(failed.paused).toBe(true);
    expect(failed.entries[0].status).toBe("failed");
    expect(failed.entries[0].error).toContain("Shell interpolation");
    expect(deliveries).toBe(0);
  });

  test("a globally visible chat from another project cannot be read or changed through this project's queue", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const otherRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ sessionDirectory: otherRoot });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1/queue`;
    const headers = { ...auth(legalwork.token), "Content-Type": "application/json" };
    for (const url of [base, `${base}?revision=0`]) expect((await fetch(url, { headers })).status).toBe(404);
    for (const action of [
      { type: "pause", paused: true },
      { type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text: "wrong project", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } }, execution: { kind: "shell", command: "echo wrong" } },
    ]) expect((await fetch(base, { method: "POST", headers, body: JSON.stringify(action) })).status).toBe(404);
    expect(mock.requests.some(request => request.method === "POST" || request.method === "PATCH")).toBe(false);
  });
  test("an owned aborted delivery completes once and follow-ups resume without resending it", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    let aborted = true;
    const deliveries: string[] = [];
    const queue = new SessionMessageQueue(join(workspaceRoot, "owned-queue"), {
      idle: async () => true,
      send: async (_workspace, _session, entry) => { deliveries.push(entry.id); if (aborted) return { pause: true, reason: "stop" }; },
    });
    stops.push(() => queue.stop());
    const first = queueActionSchema.parse({ type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text: "first", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } }, execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text: "first" }] } });
    const second = queueActionSchema.parse({ ...first, id: crypto.randomUUID() });
    if (first.type !== "enqueue" || second.type !== "enqueue") throw new Error("Expected enqueue fixture");
    await queue.act("ws_1", "ses_1", { type: "pause", paused: true });
    await queue.act("ws_1", "ses_1", first); await queue.act("ws_1", "ses_1", second);
    await queue.act("ws_1", "ses_1", { type: "pause", paused: false });
    for (let attempt = 0; attempt < 100 && !(await queue.read("ws_1", "ses_1")).paused; attempt++) await Bun.sleep(5);
    const stopped = await queue.read("ws_1", "ses_1");
    expect(stopped.paused).toBe(true); expect(stopped.completedIds).toContain(first.id);
    expect(stopped.entries.map(entry => [entry.id, entry.status])).toEqual([[second.id, "queued"]]);
    aborted = false;
    await queue.act("ws_1", "ses_1", { type: "pause", paused: false });
    for (let attempt = 0; attempt < 100 && (await queue.read("ws_1", "ses_1")).entries.length; attempt++) await Bun.sleep(5);
    expect((await queue.read("ws_1", "ses_1")).entries).toEqual([]);
    await queue.act("ws_1", "ses_1", first);
    expect(deliveries).toEqual([first.id, second.id]);
  });

  test("with AI boundaries on, both HTTP windows observe unchanged empty queues after a denied enqueue", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode({ idle: () => true });
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}`, readOnly: false, aiBoundaries: true });
    const base = `http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1/queue`;
    const headers = { ...auth(legalwork.token), "Content-Type": "application/json" };
    const before = await fetch(base, { headers }).then(response => response.json());
    const input = { type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text: "synthetic queue check", parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } }, execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text: "synthetic queue check" }] } };
    const response = await fetch(base, { method: "POST", headers, body: JSON.stringify(input) });
    expect(response.status).toBe(403); expect(await response.json()).toMatchObject({ code: "ai_transfer_denied" });
    const readA = await fetch(base, { headers }).then(response => response.json());
    const readB = await fetch(base, { headers }).then(response => response.json());
    expect(readA).toEqual(readB); expect(readB).toEqual(before); expect(readB.entries).toEqual([]);
    expect(await fetch(`${base}?revision=${readB.revision}`, { headers }).then(response => response.json())).toBeNull();
    expect(mock.requests.some(request => request.method === "POST" || request.method === "PATCH")).toBe(false);
    expect((await fetch(base)).status).toBe(401);
  });

  test("read-only servers never accept executable queue changes", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const mock = startMockOpencode();
    const legalwork = await startLegalworkServer({ workspaceRoot, opencodeBaseUrl: `http://127.0.0.1:${mock.server.port}` });
    const response = await fetch(`http://127.0.0.1:${legalwork.server.port}/workspace/ws_1/sessions/ses_1/queue`, { method: "POST", headers: { ...auth(legalwork.token), "Content-Type": "application/json" }, body: JSON.stringify({ type: "pause", paused: false }) });
    expect(response.status).toBe(403);
  });
});
