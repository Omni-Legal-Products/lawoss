import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";
import { initializesEngineMcp } from "./lawoss/engine-mcp-budget.js";
import { verifiedTestEngine } from "./opencode-candidate.test-support.js";
import { z } from "zod";
import { orgPolicyEngineDir } from "./org-policy-engine.js";
import { managedSettingsFileSchema } from "./managed-engine-settings.js";
import { OUTSIDE_CLIENTS_FILE, parseOutsideClientsMap } from "./lawoss/outside-engine-config.js";

/** Every entry under a client folder with its size and modification time. */
async function snapshot(root: string) {
  const entries = (await readdir(root, { recursive: true })).sort();
  return Object.fromEntries(await Promise.all(entries.map(async (entry) => {
    const info = await stat(join(root, entry));
    return [entry, info.isDirectory() ? "dir" : `${info.size}:${info.mtimeMs}`];
  })));
}

// Spravovaný engine beží od v0.2.9 v izolovanom režime (upstream #227): skills idú do `skills.paths`.
const skillPaths = (skills: string[] | { paths?: string[] } | undefined): string[] => Array.isArray(skills) ? skills : skills?.paths ?? [];

// LAWOSS: rozpočet RAM 2 GB (issue #367). Štart nesmie v engine spustiť MCP
// žiadneho klienta; otvorenie klienta (GET /mcp) ho spustí len v jeho priečinku.
// LAWOSS v2: an engine 2.1.4 location starts all its MCP on its first location-scoped request
// (lawoss/engine-mcp-budget.ts). Startup must not open the other client's location.
async function assertStartupLeavesMcpDormant(server: Awaited<ReturnType<typeof startEmbeddedServer>>, requestsPath: string, opened: string, other: string) {
  const scoped = async () => (await readFile(requestsPath, "utf8").catch(() => "")).trim().split("\n").filter(Boolean).map((line) => {
    const [method = "GET", target = "/"] = line.split(" ");
    const url = new URL(target, "http://localhost");
    return { method, path: url.pathname.replace(/^\/api/, ""), directory: url.searchParams.get("location[directory]") };
  }).filter((request) => request.directory !== null && initializesEngineMcp(request.method, request.path));
  await new Promise(resolve => setTimeout(resolve, 300));
  expect((await scoped()).filter((request) => request.directory === other)).toEqual([]);
  const workspace = server.config.workspaces.find((entry) => entry.path === opened);
  if (!workspace) throw new Error("Opened synthetic workspace is missing");
  const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspace.id}/opencode/api/mcp`, { headers: { Authorization: "Bearer client-token" } });
  expect(response.status).toBe(200);
  await response.arrayBuffer();
  const mcp = (await scoped()).filter((request) => request.path.startsWith("/mcp"));
  expect(mcp.some((request) => request.directory === opened)).toBe(true);
  expect((await scoped()).some((request) => request.directory === other)).toBe(false);
}

test("embedded startup applies host outside policy before seeding an unconfigured workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legalwork-embedded-app-files-"));
  const workspace = join(directory, "client");
  const configPath = join(directory, "server.json");
  const originalDataDir = process.env.LEGALWORK_DATA_DIR;
  const originalConfigHome = process.env.XDG_CONFIG_HOME;
  process.env.LEGALWORK_DATA_DIR = join(directory, "data");
  process.env.XDG_CONFIG_HOME = join(directory, "xdg");
  await mkdir(workspace);
  await writeFile(join(workspace, "original.txt"), "Original client bytes\n", "utf8");

  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | null = null;
  try {
    server = await startEmbeddedServer({
      host: "127.0.0.1",
      port: 0,
      configPath,
      workspaces: [workspace],
      token: "client-token",
      hostToken: "host-token",
      logRequests: false,
      wordAddin: false,
      manageOpencode: false,
      // A host policy on the registered parent also protects a seeded child.
      hostWorkspaceAppFiles: [{ path: directory, appFiles: "outside" }],
    });
    expect(server.config.workspaces).toEqual([
      expect.objectContaining({ path: workspace, appFiles: "outside" }),
    ]);
    expect(await readdir(workspace)).toEqual(["original.txt"]);
    expect(await readFile(join(workspace, "original.txt"), "utf8")).toBe("Original client bytes\n");
    const appFilesRoot = externalAppFilesRoot(server.config, server.config.workspaces[0]!);
    expect(await readFile(join(appFilesRoot, ".opencode", "legalwork.json"), "utf8")).toContain(workspace);
    await expect(readFile(join(workspace, ".opencode", "legalwork.json"), "utf8")).rejects.toThrow();
  } finally {
    await server?.stop();
    if (originalDataDir === undefined) delete process.env.LEGALWORK_DATA_DIR;
    else process.env.LEGALWORK_DATA_DIR = originalDataDir;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    await rm(directory, { recursive: true, force: true });
  }
});

// LAWOSS (MČ 9. 11. 2026, lawoss/outside-engine-config.ts): the engine's config root is the neutral firm-policy folder
// (the native service uses it too) and project config stays on. An outside client's external skills reach only its own
// locations through runtime-opencode-settings.json; the shared file carries no client's external folder, and nothing is
// written into either client folder at startup or on restart.
test("managed engine keeps the neutral config root and project config for outside workspaces and writes nothing into them", async () => {
  // The engine sees canonical folders (macOS /var → /private/var); compare its requests with the same spelling.
  const directory = await realpath(await mkdtemp(join(tmpdir(), "legalwork-embedded-engine-app-files-")));
  const firstWorkspace = join(directory, "first-client");
  const workspace = join(directory, "client");
  const configPath = join(directory, "server.json");
  const envPath = join(directory, "engine-env.json");
  const engineDirectory = join(directory, "engine");
  const originalDataDir = process.env.LEGALWORK_DATA_DIR;
  const originalEngineEnvPath = process.env.FAKE_ENGINE_ENV_PATH;
  process.env.LEGALWORK_DATA_DIR = join(directory, "data");
  process.env.FAKE_ENGINE_ENV_PATH = envPath;
  await mkdir(firstWorkspace);
  await mkdir(workspace);
  await mkdir(engineDirectory);
  // The released engine's bundled runtime declaration (as in embedded.test.ts).
  const sdk = join(directory, "sdk");
  await mkdir(sdk);
  await writeFile(join(sdk, "package.json"), JSON.stringify({ opencode: { version: "2.1.4", runtime: "released-cli", providedModules: ["@opencode/plugin", "effect"] } }));
  await writeFile(join(firstWorkspace, "original.txt"), "First client bytes\n", "utf8");
  await writeFile(join(workspace, "original.txt"), "Original client bytes\n", "utf8");
  await writeFile(join(workspace, "AGENTS.md"), "Client instructions stay readable.\n", "utf8");
  const trees = async () => ({ first: await snapshot(firstWorkspace), client: await snapshot(workspace) });
  const before = await trees();
  const assertOutsideSettings = async (server: Awaited<ReturnType<typeof startEmbeddedServer>>) => {
    const external = server.config.workspaces.map((entry) => ({ entry, skills: join(externalAppFilesRoot(server.config, entry), ".opencode", "skills") }));
    const settings = managedSettingsFileSchema.parse(JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-settings.json"), "utf8")));
    const runtimeConfig = z.object({ skills: z.union([z.array(z.string()), z.object({ paths: z.array(z.string()).optional() })]).optional(), instructions: z.array(z.string()).optional() }).passthrough()
      .parse(JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-config.json"), "utf8")));
    const shared = z.object({ skills: z.array(z.string()).optional() }).passthrough().parse(settings.sharedConfiguration);
    for (const { entry, skills } of external) {
      // Its own settings entry carries its external skills; the other client's does not.
      expect(skillPaths(z.object({ skills: z.array(z.string()).optional() }).passthrough().parse(settings.workspaces[entry.id]?.configuration).skills)).toContain(skills);
      for (const other of external.filter((item) => item.entry.id !== entry.id))
        expect(skillPaths(z.object({ skills: z.array(z.string()).optional() }).passthrough().parse(settings.workspaces[other.entry.id]?.configuration).skills)).not.toContain(skills);
      expect(skillPaths(runtimeConfig.skills)).not.toContain(skills);
      expect(shared.skills ?? []).not.toContain(skills);
    }
    // The client's own AGENTS.md is read by the engine's project config, not injected for every location.
    expect(runtimeConfig.instructions ?? []).not.toContain(join(workspace, "AGENTS.md"));
    expect(parseOutsideClientsMap(JSON.parse(await readFile(join(dirname(configPath), OUTSIDE_CLIENTS_FILE), "utf8")))?.clients.map((client) => client.directory).sort())
      .toEqual([firstWorkspace, workspace].sort());
  };
  // LAWOSS v2: a verified synthetic engine 2.1.4 (opencode-candidate.test-support.ts): Basic auth, /api/info
  // with its version and PID, and a ticket redeemed when the location's plugins load (/api/model).
  const { bin, candidateBuild } = await verifiedTestEngine(engineDirectory, (version) => `#!${process.execPath}
import { appendFileSync, writeFileSync } from "node:fs";
import { Database } from "bun:sqlite";
const database = new Database(process.env.OPENCODE_DB, { create: true });
database.exec("PRAGMA user_version=1");
database.close();
writeFileSync(process.env.FAKE_ENGINE_ENV_PATH, JSON.stringify({ configDir: process.env.OPENCODE_CONFIG_DIR, disableProjectConfig: process.env.OPENCODE_CONFIG_PROJECT_DISABLE }));
const requestsPath = process.env.FAKE_ENGINE_ENV_PATH + ".requests";
writeFileSync(requestsPath, "");
const ticket = process.env.LEGALWORK_WIKI_AGENT_TICKET;
delete process.env.LEGALWORK_WIKI_AGENT_TICKET;
let redemption;
const redeem = () => redemption ??= fetch(process.env.LEGALWORK_SERVER_URL + "/engine-agent/ticket", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }) }).then((response) => response.json());
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const password = process.argv.includes("--service") ? (await Bun.file(process.env.OPENCODE_CONFIG_DIR + "/service-legalwork.json").json()).password : process.env.OPENCODE_PASSWORD;
const server = Bun.serve({ hostname: "127.0.0.1", port, async fetch(request) {
  const url = new URL(request.url);
  appendFileSync(requestsPath, request.method + " " + url.pathname + url.search + "\\n");
  if (request.headers.get("authorization") !== "Basic " + Buffer.from("opencode:" + password).toString("base64")) return new Response("Unauthorized", { status: 401 });
  if (url.pathname === "/api/info") return Response.json({ version: ${JSON.stringify(version)}, pid: process.pid });
  if (url.pathname === "/api/experimental/migration/v1") return Response.json({ status: "completed", progress: { completed: 0, total: 0 } });
  if (url.pathname === "/api/model") { await redeem(); return Response.json({ data: [] }); }
  if (url.pathname === "/api/mcp") return Response.json({ data: [] });
  return Response.json({ data: [] });
} });
// The managed engine runs with a stdin parent lease: announce the URL as JSON and exit with the parent.
if (process.argv.includes("--stdio")) { console.log(JSON.stringify({ url: "http://127.0.0.1:" + server.port })); process.stdin.on("end", () => process.exit(0)); process.stdin.resume(); }
else console.log("server listening on http://127.0.0.1:" + server.port);
process.on("SIGTERM", () => process.exit(0));
`);
  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | null = null;
  try {
    server = await startEmbeddedServer({
      host: "127.0.0.1", port: 0, configPath, workspaces: [firstWorkspace, workspace],
      token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
      manageOpencode: true, opencodeBin: bin, opencodeCandidateBuild: candidateBuild, opencodeSdkDirectory: sdk,
      opencodeDirectory: workspace,
      hostWorkspaceAppFiles: [
        { path: firstWorkspace, appFiles: "outside" },
        { path: workspace, appFiles: "outside" },
      ],
    });
    const neutral = { configDir: orgPolicyEngineDir(server.config), disableProjectConfig: "" };
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual(neutral);
    await assertOutsideSettings(server);
    expect(await trees()).toEqual(before);
    await assertStartupLeavesMcpDormant(server, `${envPath}.requests`, workspace, firstWorkspace);
    await server.stop();
    server = await startEmbeddedServer({
      host: "127.0.0.1", port: 0, configPath, workspaces: [firstWorkspace, workspace],
      token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
      manageOpencode: true, opencodeBin: bin, opencodeCandidateBuild: candidateBuild, opencodeSdkDirectory: sdk,
      opencodeDirectory: firstWorkspace,
      hostWorkspaceAppFiles: [
        { path: firstWorkspace, appFiles: "outside" },
        { path: workspace, appFiles: "outside" },
      ],
    });
    // Another opened client changes nothing: one neutral root, the same per-client settings.
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual({ configDir: orgPolicyEngineDir(server.config), disableProjectConfig: "" });
    await assertOutsideSettings(server);
    expect(await trees()).toEqual(before);
    await assertStartupLeavesMcpDormant(server, `${envPath}.requests`, firstWorkspace, workspace);
  } finally {
    await server?.stop();
    if (originalDataDir === undefined) delete process.env.LEGALWORK_DATA_DIR;
    else process.env.LEGALWORK_DATA_DIR = originalDataDir;
    if (originalEngineEnvPath === undefined) delete process.env.FAKE_ENGINE_ENV_PATH;
    else process.env.FAKE_ENGINE_ENV_PATH = originalEngineEnvPath;
    await rm(directory, { recursive: true, force: true });
  }
// Two process starts, two bounded 3s synchronization waits, and shutdown exceed the default 5s budget.
}, 15_000);

test("fresh desktop seed preserves host ID, persisted registry wins on restart", async () => {
  const root = await mkdtemp(join(tmpdir(), "reconnect-bootstrap-"));
  const folder = join(root, "matter"); const configPath = join(root, "server.json");
  await mkdir(folder);
  const oldData = process.env.LEGALWORK_DATA_DIR; const oldConfig = process.env.XDG_CONFIG_HOME;
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.XDG_CONFIG_HOME = join(root, "xdg");
  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | undefined;
  const hostEntry = { id: "stable-desktop", name: "Matter", path: folder, preset: "starter", workspaceType: "local" as const, appFiles: "outside" as const };
  try {
    server = await startEmbeddedServer({ host: "127.0.0.1", port: 0, configPath, workspaces: [folder], hostWorkspaces: [hostEntry], token: "client", hostToken: "host", logRequests: false, wordAddin: false, manageOpencode: false });
    expect(server.config.workspaces[0]?.id).toBe("stable-desktop"); await server.stop(); server = undefined;
    await writeFile(configPath, JSON.stringify({ workspaces: [{ ...hostEntry, id: "persisted-id" }], authorizedRoots: [folder] }));
    server = await startEmbeddedServer({ host: "127.0.0.1", port: 0, configPath, workspaces: [], hostWorkspaces: [hostEntry], token: "client", hostToken: "host", logRequests: false, wordAddin: false, manageOpencode: false });
    expect(server.config.workspaces[0]?.id).toBe("persisted-id");
  } finally {
    await server?.stop();
    if (oldData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = oldData;
    if (oldConfig === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = oldConfig;
    await rm(root, { recursive: true, force: true });
  }
});
