import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { writeRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";
import type { WorkspaceMemoryStatus } from "../../../lawoss/okf-handoff/workspace-memory-status.mjs";
const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => { for (const stop of stops.splice(0)) await stop(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData; if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens; });
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
  const untrusted = await (await fetch(`${f.url}/authorized-folders`, { headers: f.headers })).json(); expect(untrusted.folders).toEqual([f.vault]);
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
  const f = await fixture(); f.config.workspaces[0]!.workspaceType = "remote";
  for (const path of ["/lawoss/memory", "/lawoss/memory/grants"]) {
    const response = await fetch(f.url + path, { headers: f.headers }); expect(response.status).toBe(400); expect(await response.text()).not.toContain("SECRET-SOURCE-BODY");
  }
});
