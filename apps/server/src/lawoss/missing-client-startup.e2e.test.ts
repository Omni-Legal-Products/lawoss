// LAWOSS: an app start with one registered client folder missing on disk (moved or deleted).
// The folder stays registered for reconnect (workspace-reconnect.e2e.test.ts), the other clients start.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer } from "../embedded.js";
import { verifiedTestEngine } from "../opencode-candidate.test-support.js";
import { removeSyntheticTestDir } from "./test-support/inspect-cleanup.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-missing-client-")));
  cleanup.push(() => removeSyntheticTestDir(root));
  const environment = { LEGALWORK_DATA_DIR: process.env.LEGALWORK_DATA_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, OPENCODE_DB: process.env.OPENCODE_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  process.env.XDG_CONFIG_HOME = join(root, "xdg");
  // The managed start sets OPENCODE_DB for this process; an earlier test file's value must not select its removed database.
  delete process.env.OPENCODE_DB;
  cleanup.push(async () => {
    for (const [key, value] of Object.entries(environment)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  const present = join(root, "Klient A");
  const missing = join(root, "Klient B");
  await mkdir(present);
  await writeFile(join(present, "zmluva.txt"), "Syntetická zmluva\n", "utf8");
  const engineDirectory = join(root, "engine");
  await mkdir(engineDirectory);
  const sdk = join(root, "sdk");
  await mkdir(sdk);
  await writeFile(join(sdk, "package.json"), JSON.stringify({ opencode: { version: "2.1.4", runtime: "released-cli", providedModules: ["@opencode/plugin", "effect"] } }));
  const engine = await verifiedTestEngine(engineDirectory, (version) => `#!${process.execPath}
import { Database } from "bun:sqlite";
const database = new Database(process.env.OPENCODE_DB, { create: true });
database.exec("PRAGMA user_version=1");
database.close();
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const password = process.argv.includes("--service") ? (await Bun.file(process.env.OPENCODE_CONFIG_DIR + "/service-legalwork.json").json()).password : process.env.OPENCODE_PASSWORD;
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  if (request.headers.get("authorization") !== "Basic " + Buffer.from("opencode:" + password).toString("base64")) return new Response("Unauthorized", { status: 401 });
  if (url.pathname === "/api/info") return Response.json({ version: ${JSON.stringify(version)}, pid: process.pid });
  if (url.pathname === "/api/experimental/migration/v1") return Response.json({ status: "completed", progress: { completed: 0, total: 0 } });
  return Response.json({ data: [] });
} });
if (process.argv.includes("--stdio")) { console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.port })); process.stdin.on("end", () => process.exit(0)); process.stdin.resume(); }
else console.log("server listening on http://127.0.0.1:" + server.port);
process.on("SIGTERM", () => process.exit(0));
`);
  return { root, present, missing, configPath: join(root, "server.json"), engine, sdk };
}

const missingOnDisk = (path: string) => stat(path).then(() => false, (error: NodeJS.ErrnoException) => error.code === "ENOENT");

const start = (f: Awaited<ReturnType<typeof fixture>>, workspaces: string[], appFiles: "outside" | "inside") => startEmbeddedServer({
  host: "127.0.0.1", port: 0, configPath: f.configPath, workspaces,
  token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
  manageOpencode: true, opencodeBin: f.engine.bin, opencodeCandidateBuild: f.engine.candidateBuild, opencodeSdkDirectory: f.sdk,
  opencodeDirectory: f.present,
  hostWorkspaceAppFiles: appFiles === "outside" ? [{ path: f.present, appFiles }, { path: f.missing, appFiles }] : [],
});

for (const appFiles of ["outside", "inside"] as const) {
  test(`chýbajúci neaktívny klient z hostiteľa nezablokuje štart ani sa nevytvorí (${appFiles})`, async () => {
    const f = await fixture();
    const server = await start(f, [f.present, f.missing], appFiles);
    cleanup.push(() => server.stop());
    expect(server.config.workspaces.map(workspace => workspace.path)).toEqual([f.present, f.missing]);
    expect(await missingOnDisk(f.missing)).toBe(true);
    await server.stop();
    expect(await missingOnDisk(f.missing)).toBe(true);
    expect(await readFile(join(f.present, "zmluva.txt"), "utf8")).toBe("Syntetická zmluva\n");
  }, 15_000);

  // The reported sequence: both clients worked, one folder disappeared, the registry is server.json
  // (the desktop then passes no workspaces, seedWorkspacePathsForEmbeddedServer in runtime.mjs).
  test(`klient zmiznutý medzi dvoma štartmi s uloženým server.json (${appFiles})`, async () => {
    const f = await fixture();
    await mkdir(join(f.missing, ".opencode", "skills", "zmluvy"), { recursive: true });
    await writeFile(join(f.missing, ".opencode", "skills", "zmluvy", "SKILL.md"), "---\nname: zmluvy\ndescription: Syntetický skill\n---\nText\n", "utf8");
    await writeFile(join(f.missing, "podanie.txt"), "Syntetické podanie\n", "utf8");
    const entry = (id: string, path: string) => ({ id, name: id, path, preset: "starter", workspaceType: "local", ...(appFiles === "outside" ? { appFiles } : {}) });
    await writeFile(f.configPath, JSON.stringify({ workspaces: [entry("klient-a", f.present), entry("klient-b", f.missing)], authorizedRoots: [f.present, f.missing] }));
    const first = await start(f, [], appFiles);
    cleanup.push(() => first.stop());
    expect(first.config.workspaces.map(workspace => workspace.id)).toEqual(["klient-a", "klient-b"]);
    await first.stop();
    await rm(f.missing, { recursive: true });
    const second = await start(f, [], appFiles);
    cleanup.push(() => second.stop());
    expect(second.config.workspaces.map(workspace => [workspace.id, workspace.path])).toEqual([["klient-a", f.present], ["klient-b", f.missing]]);
    expect(await missingOnDisk(f.missing)).toBe(true);
    await second.stop();
    expect(await missingOnDisk(f.missing)).toBe(true);
  }, 20_000);
}
