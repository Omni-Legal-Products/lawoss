import { expect, test } from "bun:test";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";

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
process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n");
http.createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1");
  if (url.pathname === "/mcp") fs.appendFileSync(process.env.FAKE_ENGINE_ENV_PATH + ".mcp", url.searchParams.get("directory") + "\\n");
  response.end("ok");
}).listen(port, "127.0.0.1");
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
    await server.stop();
    // Shutdown must join the initial sync before terminating its engine.
    expect((await readFile(envPath + ".mcp", "utf8")).trim().split("\n")).toEqual([firstWorkspace, workspace]);
    await rm(envPath + ".mcp");
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
    await server.stop();
    server = null;
    expect((await readFile(envPath + ".mcp", "utf8")).trim().split("\n")).toEqual([firstWorkspace, workspace]);
  } finally {
    await server?.stop();
    if (originalDataDir === undefined) delete process.env.LEGALWORK_DATA_DIR;
    else process.env.LEGALWORK_DATA_DIR = originalDataDir;
    if (originalEngineEnvPath === undefined) delete process.env.FAKE_ENGINE_ENV_PATH;
    else process.env.FAKE_ENGINE_ENV_PATH = originalEngineEnvPath;
    await rm(directory, { recursive: true, force: true });
  }
});
