import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { startServer, syncAllWorkspacesRuntimeMcpToEngine } from "./server.js";
import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

type Served = { port: number; stop: (closeActiveConnections?: boolean) => void | Promise<void> };

type EngineRequest = {
  method: string;
  pathname: string;
  search: string;
  body: unknown;
};

// Keep the engine sync retry backoff tiny so failure-path tests stay fast.
process.env.LEGALWORK_MCP_SYNC_RETRY_DELAY_MS = "10";

const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];

afterEach(async () => {
  while (stops.length) await stops.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

async function createWorkspaceRoot() {
  const root = await mkdtemp(join(tmpdir(), "legalwork-mcp-engine-sync-"));
  roots.push(root);
  return root;
}

function startMockOpencode(options?: { failMcpNames?: string[]; disconnectStatus?: number; failDisconnectDirectories?: string[]; busyDirectories?: string[] }) {
  const requests: EngineRequest[] = [];
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url);
      const body = request.method === "POST" ? await request.json().catch(() => null) : null;
      requests.push({ method: request.method, pathname: url.pathname, search: url.search, body });

      if (url.pathname === "/session/status") return Response.json(options?.busyDirectories?.includes(url.searchParams.get("directory") ?? "") ? { synthetic: { type: "busy" } } : {});
      if (url.pathname === "/instance/dispose") return Response.json({ disposed: true });
      if (url.pathname === "/mcp" && request.method === "GET") return Response.json({});
      if (url.pathname === "/mcp" && request.method === "POST") {
        const name = (body as { name?: string } | null)?.name;
        if (name && options?.failMcpNames?.includes(name)) {
          return Response.json({ code: "mcp_invalid", message: "Invalid MCP config" }, { status: 500 });
        }
        return Response.json({});
      }
      if (url.pathname.match(/^\/mcp\/[^/]+\/disconnect$/) && request.method === "POST") {
        if (options?.failDisconnectDirectories?.includes(url.searchParams.get("directory") ?? "")) {
          return Response.json({}, { status: 500 });
        }
        return Response.json({}, { status: options?.disconnectStatus ?? 200 });
      }
      return Response.json({ code: "not_found", message: "Not found" }, { status: 404 });
    },
  }) as Served;
  stops.push(() => server.stop(true));
  return { server, requests };
}

async function startLegalworkServer(workspaceRoot: string, opencodeBaseUrl: string) {
  const config: ServerConfig = {
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
        path: workspaceRoot,
        preset: "starter",
        workspaceType: "local",
        baseUrl: opencodeBaseUrl,
      },
    ],
    authorizedRoots: [workspaceRoot],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, server, config };
}

function auth(token: string) {
  return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
}

const POSTHOG_CONFIG = {
  type: "remote",
  url: "https://mcp.posthog.com/mcp",
  enabled: true,
  oauth: {},
};

async function startLegalworkServerWithWorkspaces(roots: string[], opencodeBaseUrl: string) {
  const config: ServerConfig = {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: roots.map((path, index) => ({
      id: `ws_${index + 1}`,
      name: `Workspace ${index + 1}`,
      path,
      preset: "starter",
      workspaceType: "local",
      baseUrl: opencodeBaseUrl,
    })),
    authorizedRoots: roots,
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
  const server = await startServer(config) as Served;
  stops.push(() => server.stop(true));
  return { base: `http://127.0.0.1:${server.port}`, token: config.token, server, config };
}

describe("runtime MCP engine sync", () => {
  test("skill-only Marketplace install refreshes used scopes without probing unopened directories", async () => {
    const rootA = await createWorkspaceRoot(), rootB = await createWorkspaceRoot(), rootC = await createWorkspaceRoot();
    const keys = ["LEGALWORK_RUNTIME_DB", "XDG_CONFIG_HOME", "LEGALWORK_GITHUB_API_BASE", "LEGALWORK_GITHUB_RAW_BASE"];
    const previous = keys.map((key) => process.env[key]);
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    process.env.XDG_CONFIG_HOME = join(rootA, "config");
    const sha = "1".repeat(40), repo = "Omni-Legal-Products/lawoss-marketplace";
    const files: Record<string, string> = {
      "plugins/cold-fixture/.claude-plugin/plugin.json": JSON.stringify({ name: "cold-fixture", version: "1.0.0" }),
      "plugins/cold-fixture/skills/cold-fixture/SKILL.md": "---\nname: cold-fixture\ndescription: Synthetic fixture\n---\nSynthetic only.\n",
    };
    let mirrorRequests = 0;
    const mirror = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
      mirrorRequests++;
      const path = new URL(request.url).pathname;
      if (path === `/api/repos/${repo}/git/trees/${sha}`) return Response.json({ tree: Object.keys(files).map((path) => ({ path, type: "blob", sha: `blob-${path.length}` })) });
      const prefix = `/raw/${repo}/${sha}/`;
      const content = path.startsWith(prefix) ? files[path.slice(prefix.length).split("/").map(decodeURIComponent).join("/")] : undefined;
      return content === undefined ? new Response("missing", { status: 404 }) : new Response(content);
    } });
    stops.push(() => mirror.stop(true));
    process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${mirror.port}/api`;
    process.env.LEGALWORK_GITHUB_RAW_BASE = `http://127.0.0.1:${mirror.port}/raw`;
    try {
      const mock = startMockOpencode({ busyDirectories: [rootC] });
      const app = await startLegalworkServerWithWorkspaces([rootA, rootB, rootC], `http://127.0.0.1:${mock.server.port}`);
      await writeRuntimeOpencodeConfig(app.config, "ws_3", () => ({ mcp: { busyFixture: { type: "local", command: ["synthetic-only"], enabled: true } } }));
      for (const id of ["ws_1", "ws_3"]) {
        const opened = await fetch(`${app.base}/workspace/${id}/opencode/mcp`, { headers: auth(app.token) });
        expect(opened.status).toBe(200); await opened.json();
      }
      mock.requests.length = 0;
      const install = (host: boolean) => fetch(`${app.base}/lawoss/marketplace/plugins`, {
        method: "POST", headers: { ...auth(app.token), ...(host ? { "x-legalwork-host-token": app.config.hostToken } : {}) },
        body: JSON.stringify({ url: `https://github.com/${repo}/tree/${sha}/plugins/cold-fixture` }),
      });
      const denied = await install(false);
      expect(denied.status).toBe(401); await denied.text();
      expect(mirrorRequests).toBe(0); expect(mock.requests).toEqual([]);
      const installed = await install(true);
      expect(installed.status).toBe(200);
      expect(await installed.json()).toMatchObject({ status: "installed" });
      let notification = false;
      for (let attempt = 0; attempt < 40 && !notification; attempt++) {
        const events = await fetch(`${app.base}/workspace/ws_3/events`, { headers: auth(app.token) });
        expect(events.status).toBe(200);
        notification = JSON.stringify(await events.json()).includes("LAWOSS Marketplace");
        if (!notification) await new Promise((resolve) => setTimeout(resolve, 25));
      }
      expect(notification).toBe(true);
      await app.server.stop();
      const forRoot = (root: string) => mock.requests.filter((entry) => new URLSearchParams(entry.search).get("directory") === root);
      expect(forRoot(rootB)).toEqual([]);
      expect(forRoot(rootA).some((entry) => entry.pathname === "/instance/dispose")).toBe(true);
      expect(forRoot(rootC).some((entry) => entry.pathname === "/instance/dispose")).toBe(false);
      expect(forRoot(rootC).some((entry) => entry.method === "POST" && entry.pathname === "/mcp")).toBe(true);
    } finally {
      keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    }
  });

  test("SystemOne settings refreshes used idle scopes, preserves busy scopes and never probes a cold directory", async () => {
    const rootA = await createWorkspaceRoot(), rootB = await createWorkspaceRoot(), rootC = await createWorkspaceRoot();
    const oldDb = process.env.LEGALWORK_RUNTIME_DB, oldConfig = process.env.XDG_CONFIG_HOME;
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    process.env.XDG_CONFIG_HOME = join(rootA, "config");
    try {
      const mock = startMockOpencode({ busyDirectories: [rootC] });
      const app = await startLegalworkServerWithWorkspaces([rootA, rootB, rootC], `http://127.0.0.1:${mock.server.port}`);
      for (const id of ["ws_1", "ws_3"]) {
        const opened = await fetch(`${app.base}/workspace/${id}/opencode/mcp`, { headers: auth(app.token) });
        expect(opened.status).toBe(200);
        await opened.json();
      }
      const refused = await fetch(`${app.base}/workspace/ws_2/opencode/mcp`);
      expect(refused.status).toBe(401);
      await refused.text();
      mock.requests.length = 0;
      const response = await fetch(`${app.base}/systemone/providers`, {
        method: "PUT", headers: auth(app.token),
        body: JSON.stringify({ id: "synthetic-disabled", name: "Synthetic disabled", endpoint: "http://127.0.0.1:9/v1/systemone", apiKey: "fixture-only", enabled: false, models: [] }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ ok: true });
      const settings = await fetch(`${app.base}/systemone/settings`, { headers: auth(app.token) });
      expect(settings.status).toBe(200);
      expect(JSON.stringify(await settings.json())).toContain("synthetic-disabled");
      await app.server.stop(); // Drains the accepted settings refresh before inspecting its complete request trace.
      const forRoot = (root: string) => mock.requests.filter((request) => new URLSearchParams(request.search).get("directory") === root);
      expect(forRoot(rootB)).toEqual([]);
      expect(forRoot(rootA).some((request) => request.pathname === "/instance/dispose")).toBe(true);
      expect(forRoot(rootC).some((request) => request.pathname === "/session/status")).toBe(true);
      expect(forRoot(rootC).some((request) => request.pathname === "/instance/dispose")).toBe(false);
    } finally {
      if (oldDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = oldDb;
      if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    }
  });

  test("shared local add leaves other workspaces cold and refreshes them only on scoped use", async () => {
    const rootA = await createWorkspaceRoot(), rootB = await createWorkspaceRoot(), rootC = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const app = await startLegalworkServerWithWorkspaces([rootA, rootB, rootC], `http://127.0.0.1:${mock.server.port}`);
      const add = () => fetch(`${app.base}/workspace/ws_1/mcp`, {
        method: "POST", headers: auth(app.token),
        body: JSON.stringify({ name: "shared-local", scope: "global", config: { type: "local", command: ["synthetic-fixture"], enabled: true } }),
      });
      const adds = () => mock.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect((await add()).status).toBe(200);
      expect(adds().map((entry) => new URLSearchParams(entry.search).get("directory"))).toEqual([rootA]);
      const openB = () => fetch(`${app.base}/workspace/ws_2/opencode/mcp`, { headers: auth(app.token) });
      expect((await fetch(`${app.base}/workspace/ws_2/opencode/mcp`)).status).toBe(401);
      expect(adds()).toHaveLength(1);
      expect((await openB()).status).toBe(200);
      expect(adds()).toHaveLength(2);
      expect(new URLSearchParams(adds()[1]!.search).get("directory")).toBe(rootB);
      const remote = await fetch(`${app.base}/workspace/ws_2/mcp`, {
        method: "POST", headers: auth(app.token),
        body: JSON.stringify({ name: "remote-only", scope: "workspace", config: POSTHOG_CONFIG }),
      });
      expect(remote.status).toBe(200);
      mock.requests.length = 0;
      expect((await add()).status).toBe(200);
      expect(adds()).toHaveLength(1);
      expect((await Promise.all([openB(), openB()])).map((response) => response.status)).toEqual([200, 200]);
      expect(adds()).toHaveLength(2);
      expect(adds().every((entry) => JSON.stringify(entry.body).includes('"name":"shared-local"'))).toBe(true);
      expect(mock.requests.some((entry) => new URLSearchParams(entry.search).get("directory") === rootC)).toBe(false);
      expect((await add()).status).toBe(200);
      const replaceWithRemote = await fetch(`${app.base}/workspace/ws_1/mcp`, {
        method: "POST", headers: auth(app.token),
        body: JSON.stringify({ name: "shared-local", scope: "global", config: POSTHOG_CONFIG }),
      });
      expect(replaceWithRemote.status).toBe(200);
      mock.requests.length = 0;
      expect((await openB()).status).toBe(200);
      expect(adds()).toHaveLength(0); // A queued local update cannot replay a later OAuth configuration.
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("a shared connector is hot-added into every local workspace's engine instance, and dropped from all on removal", async () => {
    const rootA = await createWorkspaceRoot();
    const rootB = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const legalwork = await startLegalworkServerWithWorkspaces([rootA, rootB], `http://127.0.0.1:${mock.server.port}`);

      const response = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG, scope: "global" }),
      });
      expect(response.status).toBe(200);
      const adds = mock.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(adds.map((entry) => new URLSearchParams(entry.search).get("directory")).sort()).toEqual([rootA, rootB].sort());
      expect(adds.every((entry) => JSON.stringify(entry.body) === JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }))).toBe(true);

      mock.requests.length = 0;
      const removal = await fetch(`${legalwork.base}/workspace/ws_2/mcp/posthog`, {
        method: "DELETE",
        headers: auth(legalwork.token),
      });
      expect(removal.status).toBe(200);
      const disconnects = mock.requests.filter((entry) => entry.pathname === "/mcp/posthog/disconnect");
      expect(disconnects.map((entry) => new URLSearchParams(entry.search).get("directory")).sort()).toEqual([rootA, rootB].sort());
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("retries a failed shared disconnect without removing another workspace's own connector", async () => {
    const rootA = await createWorkspaceRoot();
    const rootB = await createWorkspaceRoot();
    const rootC = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    const previousConfigHome = process.env.XDG_CONFIG_HOME;
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    process.env.XDG_CONFIG_HOME = join(rootA, "config");
    try {
      const options = { failDisconnectDirectories: [rootB] };
      const mock = startMockOpencode(options);
      const legalwork = await startLegalworkServerWithWorkspaces([rootA, rootB, rootC], `http://127.0.0.1:${mock.server.port}`);
      for (const [workspace, scope] of [["ws_1", "global"], ["ws_3", "workspace"]]) {
        const response = await fetch(`${legalwork.base}/workspace/${workspace}/mcp`, {
          method: "POST", headers: auth(legalwork.token),
          body: JSON.stringify({ name: "legalmemory", config: POSTHOG_CONFIG, scope }),
        });
        expect(response.status).toBe(200);
      }
      mock.requests.length = 0;
      const remove = () => fetch(`${legalwork.base}/workspace/ws_1/mcp/legalmemory`, {
        method: "DELETE", headers: auth(legalwork.token),
      });
      expect((await remove()).status).toBe(502);
      options.failDisconnectDirectories = [];
      expect((await remove()).status).toBe(200);
      const directories = mock.requests
        .filter((entry) => entry.pathname === "/mcp/legalmemory/disconnect")
        .map((entry) => new URLSearchParams(entry.search).get("directory"));
      expect(directories).toEqual([rootA, rootB, rootA, rootB]);
      const response = await fetch(`${legalwork.base}/workspace/ws_3/mcp`, { headers: auth(legalwork.token) });
      expect(await response.json()).toMatchObject({ items: [expect.objectContaining({ name: "legalmemory", config: POSTHOG_CONFIG })] });
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
      if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = previousConfigHome;
    }
  });

  test("hot-adds a runtime MCP into the running engine when added", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const response = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(response.status).toBe(200);

      const addRequest = mock.requests.find((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(addRequest).toBeDefined();
      expect(addRequest?.body).toEqual({ name: "posthog", config: POSTHOG_CONFIG });
      expect(addRequest?.search).toContain(`directory=${encodeURIComponent(workspaceRoot)}`);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("re-registers runtime MCPs with the engine after a reload", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const reloadResponse = await fetch(`${legalwork.base}/workspace/ws_1/engine/reload`, {
        method: "POST",
        headers: auth(legalwork.token),
      });
      expect(reloadResponse.status).toBe(200);

      const disposeIndex = mock.requests.findIndex((entry) => entry.pathname === "/instance/dispose");
      const syncIndex = mock.requests.findIndex((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(disposeIndex).toBeGreaterThanOrEqual(0);
      expect(syncIndex).toBeGreaterThan(disposeIndex);
      expect(mock.requests[syncIndex]?.body).toEqual({ name: "posthog", config: POSTHOG_CONFIG });
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("pushes toggled enabled state to the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const toggleResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp/posthog/enabled`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ enabled: false }),
      });
      expect(toggleResponse.status).toBe(200);

      const syncRequest = mock.requests.find((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      expect(syncRequest).toBeDefined();
      expect(syncRequest?.body).toEqual({ name: "posthog", config: { ...POSTHOG_CONFIG, enabled: false } });
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("disconnects a removed MCP from the engine", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      const addResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(addResponse.status).toBe(200);
      mock.requests.length = 0;

      const removeResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp/posthog`, {
        method: "DELETE",
        headers: auth(legalwork.token),
      });
      expect(removeResponse.status).toBe(200);

      const disconnectRequest = mock.requests.find(
        (entry) => entry.method === "POST" && entry.pathname === "/mcp/posthog/disconnect",
      );
      expect(disconnectRequest).toBeDefined();
      expect(disconnectRequest?.search).toContain(`directory=${encodeURIComponent(workspaceRoot)}`);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("reports failed disconnects and retries even after the saved entry is gone", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const options = { disconnectStatus: 500 };
      const mock = startMockOpencode(options);
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
      await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST", headers: auth(legalwork.token),
        body: JSON.stringify({ name: "legalmemory", config: POSTHOG_CONFIG }),
      });
      const remove = () => fetch(`${legalwork.base}/workspace/ws_1/mcp/legalmemory`, {
        method: "DELETE", headers: auth(legalwork.token),
      });
      expect((await remove()).status).toBe(502);
      options.disconnectStatus = 200;
      expect((await remove()).status).toBe(200);
      expect(mock.requests.filter((entry) => entry.pathname === "/mcp/legalmemory/disconnect")).toHaveLength(2);
      options.disconnectStatus = 404;
      expect((await remove()).status).toBe(200);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("does not report a successful disable when the engine rejects it", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const options: { failMcpNames: string[] } = { failMcpNames: [] };
      const mock = startMockOpencode(options);
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);
      await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST", headers: auth(legalwork.token),
        body: JSON.stringify({ name: "legalmemory", config: POSTHOG_CONFIG }),
      });
      options.failMcpNames.push("legalmemory");
      const response = await fetch(`${legalwork.base}/workspace/ws_1/mcp/legalmemory/enabled`, {
        method: "POST", headers: auth(legalwork.token), body: JSON.stringify({ enabled: false }),
      });
      expect(response.status).toBe(502);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("reload keeps registering remaining MCPs when one entry fails", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const mock = startMockOpencode({ failMcpNames: ["bad"] });
      const legalwork = await startLegalworkServer(workspaceRoot, `http://127.0.0.1:${mock.server.port}`);

      for (const [name, config] of [["bad", POSTHOG_CONFIG], ["posthog", POSTHOG_CONFIG]] as const) {
        const response = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
          method: "POST",
          headers: auth(legalwork.token),
          body: JSON.stringify({ name, config }),
        });
        expect(response.status).toBe(200);
      }
      mock.requests.length = 0;

      const reloadResponse = await fetch(`${legalwork.base}/workspace/ws_1/engine/reload`, {
        method: "POST",
        headers: auth(legalwork.token),
      });
      expect(reloadResponse.status).toBe(200);

      const syncedNames = mock.requests
        .filter((entry) => entry.method === "POST" && entry.pathname === "/mcp")
        .map((entry) => (entry.body as { name?: string } | null)?.name);
      // "bad" fails with a 500 but must not block the entries after it.
      expect(syncedNames).toContain("bad");
      expect(syncedNames).toContain("posthog");
      // 5xx entries are retried once.
      expect(syncedNames.filter((name) => name === "bad").length).toBe(2);

      // The failure is surfaced on the MCP list endpoint instead of being
      // swallowed silently.
      const listResponse = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        headers: auth(legalwork.token),
      });
      expect(listResponse.status).toBe(200);
      const listBody = await listResponse.json() as {
        engineSync?: { status: string; failures: Array<{ name: string }> } | null;
      };
      expect(listBody.engineSync?.status).toBe("failed");
      expect(listBody.engineSync?.failures.map((failure) => failure.name)).toContain("bad");
      expect(listBody.engineSync?.failures.map((failure) => failure.name)).not.toContain("posthog");
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("startup leaves unopened workspaces alone; the first authorized engine request syncs only its directory", async () => {
    const rootA = await createWorkspaceRoot();
    const rootB = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(rootA, "runtime.sqlite");
    try {
      const mock = startMockOpencode();
      const baseUrl = `http://127.0.0.1:${mock.server.port}`;
      const config: ServerConfig = {
        host: "127.0.0.1",
        port: 0,
        token: "owt_test_token",
        hostToken: "owt_host_token",
        approval: { mode: "auto", timeoutMs: 1000 },
        corsOrigins: ["*"],
        workspaces: [
          { id: "ws_1", name: "A", path: rootA, preset: "starter", workspaceType: "local", baseUrl },
          { id: "ws_2", name: "B", path: rootB, preset: "starter", workspaceType: "local", baseUrl },
          { id: "ws_offline", name: "Disconnected", path: join(rootB, "missing"), preset: "starter", workspaceType: "local", baseUrl },
        ],
        authorizedRoots: [rootA, rootB],
        readOnly: false,
        startedAt: Date.now(),
        tokenSource: "cli",
        hostTokenSource: "cli",
        logFormat: "pretty",
        logRequests: false,
      };

      await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({ ...current, mcp: { posthog: POSTHOG_CONFIG } }));
      await writeRuntimeOpencodeConfig(config, "ws_2", (current) => ({ ...current, mcp: { stripe: POSTHOG_CONFIG } }));
      await writeRuntimeOpencodeConfig(config, "ws_offline", (current) => ({ ...current, mcp: { offline: POSTHOG_CONFIG } }));

      const server = await startServer(config) as Served;
      stops.push(() => server.stop(true));
      const base = `http://127.0.0.1:${server.port}`;
      mock.requests.length = 0;
      await syncAllWorkspacesRuntimeMcpToEngine(config);
      expect(mock.requests).toEqual([]);
      expect((await fetch(`${base}/workspace/ws_2/opencode/mcp`)).status).toBe(401);
      expect((await fetch(`${base}/workspace/ws_2/opencode/mcp?directory=${encodeURIComponent(rootA)}`, { headers: auth(config.token) })).status).toBe(400);
      expect(mock.requests).toEqual([]);

      const openB = () => fetch(`${base}/workspace/ws_2/opencode/mcp`, { headers: auth(config.token) });
      expect((await Promise.all([openB(), openB()])).map((response) => response.status)).toEqual([200, 200]);
      expect((await openB()).status).toBe(200);

      const syncs = mock.requests.filter((entry) => entry.method === "POST" && entry.pathname === "/mcp");
      const byName = new Map(syncs.map((entry) => [(entry.body as { name?: string } | null)?.name, entry.search]));
      expect(syncs).toHaveLength(1);
      expect(byName.has("posthog")).toBe(false);
      expect(byName.get("stripe")).toContain(`directory=${encodeURIComponent(rootB)}`);
      expect(mock.requests.some((entry) => entry.search.includes(encodeURIComponent(join(rootB, "missing"))))).toBe(false);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });

  test("MCP add still succeeds when the engine is unreachable", async () => {
    const workspaceRoot = await createWorkspaceRoot();
    const previousDb = process.env.LEGALWORK_RUNTIME_DB;
    process.env.LEGALWORK_RUNTIME_DB = join(workspaceRoot, "runtime.sqlite");
    try {
      const legalwork = await startLegalworkServer(workspaceRoot, "http://127.0.0.1:9");

      const response = await fetch(`${legalwork.base}/workspace/ws_1/mcp`, {
        method: "POST",
        headers: auth(legalwork.token),
        body: JSON.stringify({ name: "posthog", config: POSTHOG_CONFIG }),
      });
      expect(response.status).toBe(200);
      const body = await response.json() as { items: Array<{ name: string }> };
      expect(body.items.some((item) => item.name === "posthog")).toBe(true);
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  });
});
