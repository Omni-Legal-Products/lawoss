import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";

async function waitForEngineWorkspaces(requestsPath: string, workspaces: string[]) {
  const deadline = Date.now() + 3000;
  while (Date.now() < deadline) {
    const requests = (await readFile(requestsPath, "utf8").catch(() => "")).trim().split("\n").filter(Boolean);
    const directories = requests.map(request => new URL(request, "http://localhost").searchParams.get("directory"));
    if (workspaces.every(workspace => directories.includes(workspace))) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error("Engine fixture did not finish startup synchronization for every workspace");
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

test("managed engine receives the external OpenCode root for an outside workspace", async () => {
  const directory = await mkdtemp(join(tmpdir(), "legalwork-embedded-engine-app-files-"));
  const firstWorkspace = join(directory, "first-client");
  const workspace = join(directory, "client");
  const configPath = join(directory, "server.json");
  const envPath = join(directory, "engine-env.json");
  const bin = join(directory, "fake-opencode.mjs");
  const originalDataDir = process.env.LEGALWORK_DATA_DIR;
  const originalEngineEnvPath = process.env.FAKE_ENGINE_ENV_PATH;
  process.env.LEGALWORK_DATA_DIR = join(directory, "data");
  process.env.FAKE_ENGINE_ENV_PATH = envPath;
  await mkdir(firstWorkspace);
  await mkdir(workspace);
  await writeFile(join(firstWorkspace, "original.txt"), "First client bytes\n", "utf8");
  await writeFile(join(workspace, "original.txt"), "Original client bytes\n", "utf8");
  await writeFile(join(workspace, "AGENTS.md"), "Client instructions stay readable.\n", "utf8");
  await writeFile(bin, `#!${process.execPath}
const fs = require("node:fs");
const http = require("node:http");
fs.writeFileSync(process.env.FAKE_ENGINE_ENV_PATH, JSON.stringify({ configDir: process.env.OPENCODE_CONFIG_DIR, disableProjectConfig: process.env.OPENCODE_DISABLE_PROJECT_CONFIG }));
const port = Number(process.argv[process.argv.indexOf("--port") + 1]);
const requestsPath = process.env.FAKE_ENGINE_ENV_PATH + ".requests";
fs.writeFileSync(requestsPath, "");
http.createServer((request, response) => {
  response.end("ok");
  fs.appendFileSync(requestsPath, request.url + "\\n");
}).listen(port, "127.0.0.1", () => {
  process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
`, "utf8");
  await chmod(bin, 0o755);
  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | null = null;
  try {
    server = await startEmbeddedServer({
      host: "127.0.0.1", port: 0, configPath, workspaces: [firstWorkspace, workspace],
      token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
      manageOpencode: true, opencodeBin: bin,
      opencodeDirectory: workspace,
      hostWorkspaceAppFiles: [
        { path: firstWorkspace, appFiles: "outside" },
        { path: workspace, appFiles: "outside" },
      ],
    });
    const activeWorkspace = server.config.workspaces.find((entry) => entry.path === workspace)!;
    const expected = join(externalAppFilesRoot(server.config, activeWorkspace), ".opencode");
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual({ configDir: expected, disableProjectConfig: "true" });
    const runtimeConfig = JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-config.json"), "utf8")) as { skills?: string[]; instructions?: string[] };
    expect(runtimeConfig.skills).toContain(join(expected, "skills"));
    expect(runtimeConfig.instructions).toContain(join(workspace, "AGENTS.md"));
    expect((await readdir(workspace)).sort()).toEqual(["AGENTS.md", "original.txt"]);
    expect(await readdir(firstWorkspace)).toEqual(["original.txt"]);
    // Finish startup before terminating the engine, otherwise its retry loop leaks into later tests.
    await waitForEngineWorkspaces(`${envPath}.requests`, [firstWorkspace, workspace]);
    await server.stop();
    server = await startEmbeddedServer({
      host: "127.0.0.1", port: 0, configPath, workspaces: [firstWorkspace, workspace],
      token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
      manageOpencode: true, opencodeBin: bin,
      opencodeDirectory: firstWorkspace,
      hostWorkspaceAppFiles: [
        { path: firstWorkspace, appFiles: "outside" },
        { path: workspace, appFiles: "outside" },
      ],
    });
    const firstEntry = server.config.workspaces.find((entry) => entry.path === firstWorkspace)!;
    const firstExpected = join(externalAppFilesRoot(server.config, firstEntry), ".opencode");
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual({ configDir: firstExpected, disableProjectConfig: "true" });
    const restartedRuntimeConfig = JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-config.json"), "utf8")) as { skills?: string[] };
    expect(restartedRuntimeConfig.skills).toContain(join(firstExpected, "skills"));
    await waitForEngineWorkspaces(`${envPath}.requests`, [firstWorkspace, workspace]);
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
