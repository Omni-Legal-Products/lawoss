import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir, readFile, lstat, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import { resolveServerConfig } from "./config.js";
import { auditLogPath } from "./audit.js";
import { renameRegisteredWorkspace } from "./routes/workspaces.js";
import { workspaceIdForPath } from "./workspaces.js";
import type { ServerConfig } from "./types.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";

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
  const register = (folderPath: string, registerExisting: unknown = true, token = "host", extra: Record<string, unknown> = {}) => fetch(`http://127.0.0.1:${server.port}/workspaces/local`, { method: "POST", headers: { "x-legalwork-host-token": token, "content-type": "application/json" }, body: JSON.stringify({ folderPath, name: "Same title", preset: "starter", registerExisting, ...extra }) });
  return { base, url: `http://127.0.0.1:${server.port}`, config, office, matter, register };
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
test("outside app files persist and activation does not bootstrap an existing client folder", async () => {
  const f = await fixture(), before = await snapshot(f.matter);
  const response = await f.register(f.matter, true, "host", { appFiles: "outside" });
  expect(response.status).toBe(201);
  const id = workspaceIdForPath(f.matter);
  expect((await response.json()).workspaces.find((entry: { id: string }) => entry.id === id)).toMatchObject({ appFiles: "outside" });

  const activated = await fetch(`${f.url}/workspaces/${id}/activate?persist=true`, {
    method: "POST",
    headers: { "x-legalwork-host-token": "host" },
  });
  expect(activated.status).toBe(200);
  expect((await activated.json()).workspace).toMatchObject({ appFiles: "outside" });
  const repeated = await f.register(f.matter);
  expect(repeated.status).toBe(201);
  expect((await repeated.json()).workspaces.find((entry: { id: string }) => entry.id === id)).toMatchObject({ appFiles: "outside" });
  expect(await snapshot(f.matter)).toEqual(before);
  expect(JSON.parse(await readFile(f.config.configPath!, "utf8")).workspaces.find((entry: { id: string }) => entry.id === id)).toMatchObject({ appFiles: "outside" });
  const restarted = await resolveServerConfig({ configPath: f.config.configPath, workspaces: [] });
  expect(restarted.workspaces.find((entry) => entry.id === id)).toMatchObject({ appFiles: "outside" });
  expect((await f.register(f.matter, false)).status).toBe(400);
  expect(await snapshot(f.matter)).toEqual(before);
});
test("outside workspace HTTP config, skill, and command writes use app-owned storage", async () => {
  const f = await fixture(), before = await snapshot(f.matter);
  expect((await f.register(f.matter, true, "host", { appFiles: "outside" })).status).toBe(201);
  const id = workspaceIdForPath(f.matter);
  const headers = { authorization: "Bearer client", "content-type": "application/json" };

  const configWrite = await fetch(`${f.url}/workspace/${id}/opencode-config`, {
    method: "POST", headers, body: JSON.stringify({ scope: "project", content: '{"model":"test/model"}' }),
  });
  expect(configWrite.status).toBe(200);
  const skillWrite = await fetch(`${f.url}/workspace/${id}/skills`, {
    method: "POST", headers,
    body: JSON.stringify({ name: "outside-skill", description: "External workspace skill", content: "External skill body." }),
  });
  expect(skillWrite.status).toBe(200);
  const commandWrite = await fetch(`${f.url}/workspace/${id}/commands`, {
    method: "POST", headers,
    body: JSON.stringify({ name: "outside-command", description: "External workspace command", template: "External command body." }),
  });
  expect(commandWrite.status).toBe(200);

  const [configRead, skillsRead, commandsRead] = await Promise.all([
    fetch(`${f.url}/workspace/${id}/opencode-config?scope=project`, { headers: { authorization: "Bearer client" } }),
    fetch(`${f.url}/workspace/${id}/skills`, { headers: { authorization: "Bearer client" } }),
    fetch(`${f.url}/workspace/${id}/commands`, { headers: { authorization: "Bearer client" } }),
  ]);
  expect((await configRead.json()).content).toContain('"test/model"');
  expect((await skillsRead.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "outside-skill" })]));
  expect((await commandsRead.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "outside-command" })]));

  const workspace = f.config.workspaces.find((entry) => entry.id === id)!;
  const appFilesRoot = externalAppFilesRoot(f.config, workspace);
  expect(await readFile(join(appFilesRoot, ".opencode", "opencode.jsonc"), "utf8")).toContain('"test/model"');
  expect(await readFile(join(appFilesRoot, ".opencode", "skills", "outside-skill", "SKILL.md"), "utf8")).toContain("External skill body.");
  expect(await readFile(join(appFilesRoot, ".opencode", "commands", "outside-command.md"), "utf8")).toContain("External command body.");
  expect(await snapshot(f.matter)).toEqual(before);

  const restartedConfig = await resolveServerConfig({ configPath: f.config.configPath, workspaces: [] });
  const restartedServer = await startServer(restartedConfig);
  cleanups.push(async () => { await restartedServer.stop(); });
  const restartedUrl = `http://127.0.0.1:${restartedServer.port}`;
  const restartedConfigRead = await fetch(`${restartedUrl}/workspace/${id}/opencode-config?scope=project`, {
    headers: { authorization: `Bearer ${restartedConfig.token}` },
  });
  const restartedSkillsRead = await fetch(`${restartedUrl}/workspace/${id}/skills`, { headers: { authorization: `Bearer ${restartedConfig.token}` } });
  const restartedCommandsRead = await fetch(`${restartedUrl}/workspace/${id}/commands`, { headers: { authorization: `Bearer ${restartedConfig.token}` } });
  expect((await restartedConfigRead.json()).content).toContain('"test/model"');
  expect((await restartedSkillsRead.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "outside-skill" })]));
  expect((await restartedCommandsRead.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "outside-command" })]));
  expect(await snapshot(f.matter)).toEqual(before);
});
test("re-registering an existing matter retains its user-selected display name", async () => {
  const f = await fixture(), before = await snapshot(f.matter);
  const first = await f.register(f.matter);
  expect(first.status).toBe(201);
  const id = workspaceIdForPath(f.matter);

  expect(await renameRegisteredWorkspace(f.config, id, "Client matter, renamed by lawyer")).toBe(true);

  const repeated = await f.register(f.matter);
  expect(repeated.status).toBe(201);
  const result = await repeated.json();
  expect(result.workspaces.find((entry: { id: string }) => entry.id === id)).toMatchObject({
    name: "Client matter, renamed by lawyer",
    displayName: "Client matter, renamed by lawyer",
  });
  const persisted = JSON.parse(await readFile(f.config.configPath!, "utf8"));
  expect(persisted.workspaces.find((entry: { id: string }) => entry.id === id)).toMatchObject({
    name: "Client matter, renamed by lawyer",
    displayName: "Client matter, renamed by lawyer",
  });
  expect(await snapshot(f.matter)).toEqual(before);
});
test("changing app-files policy moves lazy bootstrap commands outside the client folder", async () => {
  const f = await fixture();
  await f.register(f.matter, true, "host", { appFiles: "outside" });
  const id = workspaceIdForPath(f.matter);
  const commands = () => fetch(`${f.url}/workspace/${id}/commands`, { headers: { authorization: "Bearer client" } });
  expect((await commands()).status).toBe(200);
  expect((await snapshot(f.matter)).some(entry => entry.path.startsWith(".opencode/"))).toBe(false);
  expect((await f.register(f.matter, true, "host", { appFiles: "inside" })).status).toBe(201);
  expect((await commands()).status).toBe(200);
  expect((await snapshot(f.matter)).some(entry => entry.path.startsWith(".opencode/"))).toBe(true);
});
test("existing registration rejects missing/file/relative/invalid flag and retains host/read-only gates", async () => {
  const f = await fixture(), before = await snapshot(f.office);
  expect((await f.register(f.matter, true, "client")).status).toBe(401);
  for (const path of [join(f.office, "absent"), join(f.matter, "matter.md"), "relative"]) expect((await f.register(path)).status).toBe(400);
  expect((await f.register(f.matter, "true")).status).toBe(400);
  expect((await f.register(f.matter, true, "host", { appFiles: "external" })).status).toBe(400);
  expect((await f.register(f.matter, false, "host", { appFiles: "outside" })).status).toBe(400);
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


test("existing matter registration rejects project initialization options before any filesystem change", async () => {
  const f = await fixture();
  f.config.projectsDirectory = join(f.base, "default-projects");
  const before = await snapshot(f.office);
  for (const extra of [
    { folderMode: "default" },
    { projectFields: [] },
    { remoteFolders: [] },
    { initializeFromFolders: true },
    { fromRemoteFolder: true },
  ]) {
    expect((await f.register(f.matter, true, "host", extra)).status).toBe(400);
    expect(await snapshot(f.office)).toEqual(before);
    expect((await readdir(f.base)).includes("default-projects")).toBe(false);
    expect(f.config.workspaces).toHaveLength(1);
  }
});
