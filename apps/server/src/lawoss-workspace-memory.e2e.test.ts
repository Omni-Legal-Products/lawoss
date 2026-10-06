import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir, readFile, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { startServer } from "./server.js";
import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import type { WorkspaceMemoryStatus } from "../../../lawoss/okf-handoff/workspace-memory-status.mjs";
import { externalAppFilesRoot, externalMemoryProfilePath } from "./lawoss/workspace-app-files.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); for (const root of roots.splice(0)) await removeTestDir(root); if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData; if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens; });
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-status-"))); roots.push(base);
  const root = join(base, "matter"), vault = join(base, "vault"); await mkdir(root); await mkdir(vault); await mkdir(join(root, ".lawoss"));
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await writeFile(join(vault, "memory.md"), "SYNTHETIC-ANCHOR SECRET-SOURCE-BODY");
  await writeFile(join(root, ".lawoss/memory-profile.json"), JSON.stringify({ version: 1, matterId: "synthetic", roots: [{ id: "vault", path: vault }], sources: [{ id: "memory", root: "vault", path: "memory.md", role: "case_memory", required: true, writable: false, anchors: ["SYNTHETIC-ANCHOR"] }] }));
  await writeFile(join(root, "opencode.json"), JSON.stringify({ permission: { external_directory: { [`${vault}/*`]: "allow" } } }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "synthetic", name: "Synthetic", preset: "starter", path: root, workspaceType: "local" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const url = `http://127.0.0.1:${server.port}/workspace/synthetic`, headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  const status = async (): Promise<WorkspaceMemoryStatus> => { const response = await fetch(`${url}/lawoss/memory`, { headers }); expect(response.status).toBe(200); const text = await response.text(); expect(text).not.toContain("SECRET-SOURCE-BODY"); expect(text).not.toContain("SYNTHETIC-ANCHOR"); expect(text).not.toContain('"content"'); return JSON.parse(text); };
  return { config, url, headers, status, vault, root };
}
test("authenticated status ignores file grants; native grant and revocation affect the next read", async () => {
  const f = await fixture();
  for (const path of ["/lawoss/memory", "/lawoss/memory/grants"]) expect((await fetch(f.url + path)).status).toBe(401);
  expect((await fetch(f.url.replace("synthetic", "unknown") + "/lawoss/memory", { headers: f.headers })).status).toBe(404);
  expect((await f.status()).complete).toBe(false);
  const untrusted = await (await fetch(`${f.url}/authorized-folders`, { headers: f.headers })).json(); expect(untrusted.folders).toEqual([f.vault.replaceAll(sep, "/")]);
  const grants = await (await fetch(`${f.url}/lawoss/memory/grants`, { headers: f.headers })).json(); expect(grants.folders).toEqual([]); expect(grants.authority).toBe("runtime");
  expect((await fetch(`${f.url}/authorized-folders`, { method: "PUT", headers: f.headers, body: JSON.stringify({ folders: [f.vault] }) })).status).toBe(200);
  const loaded = await f.status(); expect(loaded.complete).toBe(true); expect(loaded.sources[0]?.status).toBe("loaded"); expect(loaded.sources[0]?.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect((await fetch(`${f.url}/authorized-folders`, { method: "PUT", headers: f.headers, body: JSON.stringify({ folders: [] }) })).status).toBe(200);
  const revoked = await f.status(); expect(revoked.complete).toBe(false); expect(revoked.sources[0]?.sha256).toBeNull();
});
test("runtime broad allow cannot bypass narrow deny/custom or invalid grants", async () => {
  const f = await fixture();
  for (const rules of [{ [`${f.vault}/*`]: "allow", [`${f.vault}/private/*`]: "deny" }, { [`${f.vault}/*`]: "allow", custom: "allow" }, { "relative/*": "allow" }]) {
    await writeRuntimeOpencodeConfig(f.config, "synthetic", () => ({ permission: { external_directory: rules } }));
    const status = await f.status(); expect(status.complete).toBe(false); expect(status.grants.folders).toEqual([]); expect(status.grants.hiddenCount).toBeGreaterThan(0); expect(status.sources[0]?.sha256).toBeNull();
  }
});

test("outside workspace reads its host-owned mapped profile across restart without changing the client tree", async () => {
  const f = await fixture();
  f.config.workspaces[0]!.appFiles = "outside";
  await rm(join(f.root, ".lawoss", "memory-profile.json"));
  await writeFile(join(f.root, "mapped-memory.md"), "MAPPED-ANCHOR client source");
  const profilePath = externalMemoryProfilePath(f.config, f.config.workspaces[0]!);
  if (!profilePath) throw new Error("outside workspace did not resolve a host profile path");
  await mkdir(join(profilePath, ".."), { recursive: true });
  await writeFile(profilePath, JSON.stringify({ version: 1, matterId: "mapped", roots: [{ id: "client", path: "." }], sources: [{ id: "memory", root: "client", path: "mapped-memory.md", role: "case_memory", required: true, writable: true, anchors: ["MAPPED-ANCHOR"] }] }));
  const before = await workspaceSnapshot(f.root);
  expect((await f.status()).complete).toBe(true);
  expect(await workspaceSnapshot(f.root)).toEqual(before);
  for (const stop of stops.splice(0)) await stop();
  const restarted = await startServer(f.config); stops.push(() => restarted.stop());
  const response = await fetch(`http://127.0.0.1:${restarted.port}/workspace/synthetic/lawoss/memory`, { headers: f.headers });
  expect(response.status).toBe(200); expect((await response.json() as WorkspaceMemoryStatus).complete).toBe(true);
  expect(await workspaceSnapshot(f.root)).toEqual(before);
});

test("mapped production hook checkpoints outside the client and preserves it across restart", async () => {
  const f = await fixture(); f.config.workspaces[0]!.appFiles = "outside";
  await rm(join(f.root, ".lawoss", "memory-profile.json")); await writeFile(join(f.root, "mapped-memory.md"), "MAPPED-HOOK-ANCHOR source");
  const profilePath = externalMemoryProfilePath(f.config, f.config.workspaces[0]!); const appRoot = externalAppFilesRoot(f.config, f.config.workspaces[0]!);
  if (!profilePath) throw new Error("missing host profile path");
  await mkdir(appRoot, { recursive: true }); await mkdir(join(profilePath, ".."), { recursive: true });
  await writeFile(profilePath, JSON.stringify({ version: 1, matterId: "mapped-hook", roots: [{ id: "client", path: "." }], sources: [{ id: "memory", root: "client", path: "mapped-memory.md", role: "case_memory", required: true, writable: false, anchors: ["MAPPED-HOOK-ANCHOR"] }] }));
  const before = await workspaceSnapshot(f.root), previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN };
  try {
    process.env.LEGALWORK_SERVER_URL = new URL(f.url).origin; process.env.LEGALWORK_SERVER_TOKEN = "synthetic-client";
    const { LawossOkfHandoff } = await import("./opencode-plugins/lawoss-okf-handoff.js");
    const first = { system: [] as string[] }; await (await LawossOkfHandoff({ directory: f.root }))["experimental.chat.system.transform"]!({ sessionID: "mapped" }, first); expect(first.system[0]).not.toContain("FAILED");
    const checkpoint = join(appRoot, ".lawoss", "handoff", "mapped.md"); expect((await readdir(appRoot, { recursive: true })).map(entry => entry.replaceAll(sep, "/"))).toContain(".lawoss/handoff/mapped.md"); const good = await readFile(checkpoint, "utf8"); expect(good).toContain("MAPPED-HOOK-ANCHOR"); expect(await workspaceSnapshot(f.root)).toEqual(before);
    for (const stop of stops.splice(0)) await stop(); const restarted = await startServer(f.config); stops.push(() => restarted.stop()); process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${restarted.port}`;
    const fresh = { system: [] as string[] }; await (await LawossOkfHandoff({ directory: f.root }))["experimental.chat.system.transform"]!({ sessionID: "mapped" }, fresh); expect(fresh.system[0]).not.toContain("FAILED"); const afterRestart = await readFile(checkpoint, "utf8"); expect(afterRestart).toContain("MAPPED-HOOK-ANCHOR");
    await rm(profilePath); const revoked = { system: [] as string[] }; await (await LawossOkfHandoff({ directory: f.root }))["experimental.chat.system.transform"]!({ sessionID: "mapped" }, revoked); expect(revoked.system[0]).toContain("FAILED"); expect(await readFile(checkpoint, "utf8")).toBe(afterRestart);
  } finally { if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url; if (previous.token === undefined) delete process.env.LEGALWORK_SERVER_TOKEN; else process.env.LEGALWORK_SERVER_TOKEN = previous.token; }
});

test("production plugin resolves real HTTP grants on each hook and preserves revoked checkpoint", async () => {
  const f = await fixture();
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN, grants: process.env.LAWOSS_MEMORY_ALLOWED_ROOTS };
  try {
    process.env.LEGALWORK_SERVER_URL = new URL(f.url).origin; process.env.LEGALWORK_SERVER_TOKEN = "synthetic-client";
    process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]);
    const { LawossOkfHandoff } = await import("./opencode-plugins/lawoss-okf-handoff.js");
    const hooks = await LawossOkfHandoff({ directory: f.root });
    const first = { system: [] as string[] }; await hooks["experimental.chat.system.transform"]!({ sessionID: "host_live" }, first); expect(first.system[0]).toContain("FAILED");
    await fetch(`${f.url}/authorized-folders`, { method: "PUT", headers: f.headers, body: JSON.stringify({ folders: [f.vault] }) });
    const second = { system: [] as string[] }; await hooks["experimental.chat.system.transform"]!({ sessionID: "host_live" }, second); expect(second.system[0]).not.toContain("FAILED");
    const { readFile } = await import("node:fs/promises"); const checkpoint = join(f.root, ".lawoss/handoff/host_live.md"); const good = await readFile(checkpoint, "utf8"); expect(good).toContain("SECRET-SOURCE-BODY");
    await fetch(`${f.url}/authorized-folders`, { method: "PUT", headers: f.headers, body: JSON.stringify({ folders: [] }) });
    const last = { system: [] as string[] }; await hooks["experimental.chat.system.transform"]!({ sessionID: "host_live" }, last); expect(last.system[0]).toContain("FAILED"); expect(await readFile(checkpoint, "utf8")).toBe(good);
  } finally {
    for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: previous.url, LEGALWORK_SERVER_TOKEN: previous.token, LAWOSS_MEMORY_ALLOWED_ROOTS: previous.grants })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  }
});

test("status and grants reject remote workspaces before reading local paths", async () => {
  for (const path of ["/lawoss/memory", "/lawoss/memory/grants"]) {
    const f = await fixture(); f.config.workspaces[0]!.workspaceType = "remote";
    const before = await workspaceSnapshot(f.root);
    const response = await fetch(f.url + path, { headers: f.headers }); expect(response.status).toBe(400); expect(await response.text()).not.toContain("SECRET-SOURCE-BODY");
    expect(await workspaceSnapshot(f.root)).toEqual(before);
  }
});

async function workspaceSnapshot(root: string) {
  const paths = (await readdir(root, { recursive: true })).sort();
  return Promise.all(paths.map(async path => {
    const stat = await lstat(join(root, path));
    return { path: path.replaceAll(sep, "/"), directory: stat.isDirectory(), bytes: stat.isFile() ? (await readFile(join(root, path))).toString("hex") : null };
  }));
}

for (const endpoint of ["/lawoss/memory", "/lawoss/memory/grants"]) {
  for (const granted of [false, true]) for (const oldCore of [false, true]) {
    test(`first ${endpoint} leaves writable workspace unchanged (grant=${granted}, oldCore=${oldCore})`, async () => {
      const f = await fixture();
      if (granted) await writeRuntimeOpencodeConfig(f.config, "synthetic", () => ({ permission: { external_directory: { [`${f.vault}/*`]: "allow" } } }));
      if (oldCore) {
        await mkdir(join(f.root, ".opencode/commands"), { recursive: true });
        await writeFile(join(f.root, ".opencode/.legalwork-core"), "synthetic-old-bundled-stamp");
        await writeFile(join(f.root, ".opencode/legalwork.json"), JSON.stringify({ synthetic: true }));
        await writeFile(join(f.root, ".opencode/commands/synthetic.md"), "Synthetic existing command bytes\n");
      }
      const before = await workspaceSnapshot(f.root);
      const response = await fetch(f.url + endpoint, { headers: f.headers }); expect(response.status).toBe(200);
      const body = await response.json();
      if (endpoint.endsWith("grants")) expect(body.folders).toEqual(granted ? [f.vault] : []);
      else expect(body.complete).toBe(granted);
      expect(await workspaceSnapshot(f.root)).toEqual(before);
    });
  }
  for (const rejected of ["unauthenticated", "unknown", "unauthorized"]) {
    test(`first ${endpoint} retains ${rejected} rejection without workspace writes`, async () => {
      const f = await fixture(), before = await workspaceSnapshot(f.root);
      if (rejected === "unauthorized") f.config.authorizedRoots = [f.vault];
      const url = rejected === "unknown" ? f.url.replace("synthetic", "unknown") : f.url;
      const response = await fetch(url + endpoint, rejected === "unauthenticated" ? {} : { headers: f.headers });
      expect(response.status).toBe(rejected === "unauthenticated" ? 401 : rejected === "unknown" ? 404 : 403);
      expect(await workspaceSnapshot(f.root)).toEqual(before);
    });
  }
  test(`first ${endpoint} supports registry alias without suppressing later normal bootstrap`, async () => {
    const f = await fixture(), before = await workspaceSnapshot(f.root);
    const response = await fetch(f.url.replace("synthetic", "rem_synthetic") + endpoint, { headers: f.headers });
    expect(response.status).toBe(200); expect(await workspaceSnapshot(f.root)).toEqual(before);
    expect((await fetch(f.url + "/authorized-folders", { headers: f.headers })).status).toBe(200);
    expect((await workspaceSnapshot(f.root)).some(entry => entry.path === ".opencode/.legalwork-core")).toBe(true);
  });
}
