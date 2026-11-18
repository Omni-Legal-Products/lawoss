import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveServerConfig } from "../config.js";
import { startEmbeddedServer } from "../embedded.js";

// #553: poškodený server.json nesmie potichu vyzerať ako prázdna kancelária ani byť potichu prepísaný.
const CODE = "LAWOSS_SERVER_CONFIG_DAMAGED";
const cli = (configPath: string) => ({ configPath, workspaces: [], token: "client", hostToken: "host", port: 0, logRequests: false });

async function office() {
  const root = await mkdtemp(join(tmpdir(), "lawoss-553-"));
  const folder = join(root, "SYN Tatran");
  await mkdir(folder);
  const entry = { id: "ws_tatran", name: "SYN Tatran", path: folder, preset: "starter", workspaceType: "local" as const, appFiles: "inside" as const };
  const valid = JSON.stringify({ workspaces: [entry], authorizedRoots: [folder] }, null, 2);
  return { root, folder, entry, valid, configPath: join(root, "server.json") };
}

const backups = async (root: string) => (await readdir(root)).filter(name => name.startsWith("server.json.poskodeny-"));
const exists = (path: string) => readFile(path).then(() => true, () => false);

test("orezaný server.json sa odloží bajt po bajte, štart nahlási kód a zápisy už neblokuje", async () => {
  const { root, valid, configPath } = await office();
  const damaged = valid.slice(0, 40);
  await writeFile(configPath, damaged);
  try {
    const config = await resolveServerConfig(cli(configPath));
    const [backup] = await backups(root);
    expect(backup).toBeDefined();
    expect(await readFile(join(root, backup!), "utf8")).toBe(damaged);
    expect(await exists(configPath)).toBe(false);
    expect(config.workspaces).toEqual([]);
    expect(config.workspaceWarnings).toEqual([`${CODE}|reset|${join(root, backup!)}`]);

    const again = await resolveServerConfig(cli(configPath));
    expect(again.workspaceWarnings).toEqual([]);
    expect(await backups(root)).toEqual([backup!]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("neplatný koniec za celým JSON objektom sa opraví ako v Electrone a klienti ostanú", async () => {
  const { root, entry, valid, configPath } = await office();
  const damaged = `${valid}\n}garbage\u0000`;
  await writeFile(configPath, damaged);
  try {
    const config = await resolveServerConfig(cli(configPath));
    const [backup] = await backups(root);
    expect(await readFile(join(root, backup!), "utf8")).toBe(damaged);
    expect(JSON.parse(await readFile(configPath, "utf8"))).toEqual(JSON.parse(valid));
    expect(config.workspaces.map(workspace => workspace.id)).toEqual([entry.id]);
    expect(config.workspaceWarnings).toEqual([`${CODE}|repaired|${join(root, backup!)}`]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("platný server.json nevytvorí zálohu ani varovanie", async () => {
  const { root, valid, configPath } = await office();
  await writeFile(configPath, valid);
  try {
    const config = await resolveServerConfig(cli(configPath));
    expect(config.workspaceWarnings).toEqual([]);
    expect(await backups(root)).toEqual([]);
    expect(await readFile(configPath, "utf8")).toBe(valid);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("keď sa poškodený súbor nedá odložiť, ostane nedotknutý a štart to nahlási", async () => {
  const { root, valid, configPath } = await office();
  const damaged = valid.slice(0, 40);
  await writeFile(configPath, damaged);
  await chmod(root, 0o555);
  try {
    const config = await resolveServerConfig(cli(configPath));
    expect(await readFile(configPath, "utf8")).toBe(damaged);
    expect(config.workspaceWarnings).toEqual([`${CODE}|kept|${configPath}`]);
  } finally {
    await chmod(root, 0o755);
    await rm(root, { recursive: true, force: true });
  }
});

test("desktop: neopraviteľný server.json obnoví klientov zo zoznamu appky s ich id a appka dostane varovanie", async () => {
  const { root, entry, valid, configPath } = await office();
  await writeFile(configPath, valid.slice(0, 40));
  const oldData = process.env.LEGALWORK_DATA_DIR; const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.XDG_CONFIG_HOME = join(root, "xdg");
  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | undefined;
  try {
    server = await startEmbeddedServer({ host: "127.0.0.1", port: 0, configPath, workspaces: [], hostWorkspaces: [entry], token: "client", hostToken: "host", logRequests: false, wordAddin: false, manageOpencode: false });
    const [backup] = await backups(root);
    const response = await fetch(`${server.url}/workspaces`, { headers: { Authorization: "Bearer client" } });
    const list = await response.json() as { items: { id: string; path: string }[]; warnings: string[] };
    expect(list.items.map(item => [item.id, item.path])).toEqual([[entry.id, entry.path]]);
    expect(list.warnings).toEqual([`${CODE}|restored|${join(root, backup!)}`]);
  } finally {
    await server?.stop();
    if (oldData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = oldData;
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    await rm(root, { recursive: true, force: true });
  }
}, 15_000);
