import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir, readFile, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { auditLogPath } from "./audit.js";
import { workspaceIdForPath } from "./workspaces.js";
import type { ServerConfig } from "./types.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-register-")));
  cleanups.push(() => rm(base, { recursive: true, force: true }));
  const office = join(base, "office"), matter = join(office, "AK/S/A/Spisy/A");
  await mkdir(join(matter, ".lawoss"), { recursive: true });
  await writeFile(join(matter, "matter.md"), "Synthetic existing matter\n");
  await writeFile(join(matter, ".lawoss/memory-profile.json"), "preserved synthetic profile bytes\n");
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "office", name: "Office", preset: "starter", path: office, workspaceType: "local" }], authorizedRoots: [office], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); cleanups.push(async () => { await server.stop(); });
  const register = (folderPath: string, registerExisting: unknown = true, token = "host") => fetch(`http://127.0.0.1:${server.port}/workspaces/local`, { method: "POST", headers: { "x-legalwork-host-token": token, "content-type": "application/json" }, body: JSON.stringify({ folderPath, name: "Same title", preset: "starter", registerExisting }) });
  return { base, config, office, matter, register };
}
async function snapshot(root: string) {
  return Promise.all((await readdir(root, { recursive: true })).sort().map(async path => ({ path, bytes: (await lstat(join(root, path))).isFile() ? (await readFile(join(root, path))).toString("hex") : null })));
}
test("host registers exact existing child with deterministic ID, persistence, audit and zero matter changes", async () => {
  const f = await fixture(), before = await snapshot(f.matter);
  const response = await f.register(f.matter); expect(response.status).toBe(201);
  const result = await response.json(), id = workspaceIdForPath(f.matter);
  expect(result.activeId).toBe(id); expect(result.persisted).toBe(true);
  expect(result.workspaces.find((entry: { id: string }) => entry.id === id).path).toBe(f.matter);
  expect(await snapshot(f.matter)).toEqual(before);
  expect(JSON.parse(await readFile(f.config.configPath!, "utf8")).workspaces[0].id).toBe(id);
  expect(await readFile(auditLogPath(id), "utf8")).toContain('"action":"workspace.create"');
  expect((await f.register(f.matter)).status).toBe(201);
  expect(f.config.workspaces.filter(entry => entry.id === id)).toHaveLength(1);
  expect(await snapshot(f.matter)).toEqual(before);
});
test("existing registration rejects missing/file/relative/invalid flag and retains host/read-only gates", async () => {
  const f = await fixture(), before = await snapshot(f.office);
  expect((await f.register(f.matter, true, "client")).status).toBe(401);
  for (const path of [join(f.office, "absent"), join(f.matter, "matter.md"), "relative"]) expect((await f.register(path)).status).toBe(400);
  expect((await f.register(f.matter, "true")).status).toBe(400);
  expect(await snapshot(f.office)).toEqual(before);
  f.config.readOnly = true; expect((await f.register(f.matter)).status).toBe(403);
  expect(await snapshot(f.office)).toEqual(before);
});
test("ordinary local workspace creation retains starter initialization", async () => {
  const f = await fixture(), fresh = join(f.base, "fresh");
  expect((await f.register(fresh, false)).status).toBe(201);
  expect((await snapshot(fresh)).some(entry => entry.path.startsWith(".opencode/"))).toBe(true);
});

const symlinksAvailable = await (async () => {
  const base = await mkdtemp(join(tmpdir(), "lawoss-symlink-probe-"));
  try { await mkdir(join(base, "target")); await symlink(join(base, "target"), join(base, "link"), "dir"); return true; }
  catch (error) {
    if (error instanceof Error && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) {
      console.warn("Skipping existing-registration symlink case: filesystem does not permit symlink creation."); return false;
    }
    throw error;
  } finally { await rm(base, { recursive: true, force: true }); }
})();
test.skipIf(!symlinksAvailable)("existing registration rejects a symlink alias without modifying the target", async () => {
  const f = await fixture(), before = await snapshot(f.matter), alias = join(f.base, "alias");
  await symlink(f.matter, alias, "dir");
  expect((await f.register(alias)).status).toBe(400);
  expect(await snapshot(f.matter)).toEqual(before);
});
