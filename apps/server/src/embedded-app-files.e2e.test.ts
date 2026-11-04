import { expect, test, spyOn } from "bun:test";
import * as childProcess from "node:child_process";
import { chmod, mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";

// Spravovaný engine beží od v0.2.9 v izolovanom režime (upstream #227): skills idú do `skills.paths`.
const skillPaths = (skills: string[] | { paths?: string[] } | undefined): string[] => Array.isArray(skills) ? skills : skills?.paths ?? [];

async function assertColdThenScoped(server: Awaited<ReturnType<typeof startEmbeddedServer>>, requestsPath: string, selected: string, other: string) {
  const requests = async () => (await readFile(requestsPath, "utf8")).trim().split("\n").filter(Boolean)
    .map((request) => new URL(request, "http://localhost"));
  expect((await requests()).filter((request) => request.searchParams.has("directory"))).toEqual([]);
  const workspace = server.config.workspaces.find((entry) => entry.path === selected);
  if (!workspace) throw new Error("Selected synthetic workspace is missing");
  const url = `http://127.0.0.1:${server.port}/workspace/${workspace.id}/opencode/mcp`;
  const refused = await fetch(url);
  expect(refused.status).toBe(401);
  await refused.text();
  expect((await requests()).filter((request) => request.searchParams.has("directory"))).toEqual([]);
  const responses = await Promise.all([1, 2].map(() => fetch(url, { headers: { Authorization: "Bearer client-token" } })));
  for (const response of responses) {
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({});
  }
  const scoped = (await requests()).filter((request) => request.searchParams.has("directory"));
  expect(scoped.some((request) => request.searchParams.get("directory") === selected)).toBe(true);
  expect(scoped.some((request) => request.searchParams.get("directory") === other)).toBe(false);
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
  if (request.url === "/global/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ healthy: true, version: "embedded-app-files-fixture" }));
  } else {
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({}));
  }
  fs.appendFileSync(requestsPath, request.url + "\\n");
}).listen(port, "127.0.0.1", () => {
  process.stdout.write("opencode server listening on http://127.0.0.1:" + port + "\\n");
});
process.on("SIGTERM", () => process.exit(0));
`, "utf8");
  await chmod(bin, 0o755);
  const ownedChildren: Array<{ closed: boolean }> = [];
  const originalSpawn = childProcess.spawn;
  const spawnSpy = spyOn(childProcess, "spawn");
  const observeOwnedChild = () => {
    const index = spawnSpy.mock.calls.map((args) => args[0]).lastIndexOf(bin);
    const result = spawnSpy.mock.results[index];
    if (result?.type !== "return") throw new Error("Managed fixture child was not spawned");
    const record = { closed: false };
    ownedChildren.push(record);
    result.value.once("close", () => { record.closed = true; });
  };
  let server: Awaited<ReturnType<typeof startEmbeddedServer>> | null = null;
  let primaryFailure: { error: unknown } | undefined;
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
    observeOwnedChild();
    const activeWorkspace = server.config.workspaces.find((entry) => entry.path === workspace)!;
    const expected = join(externalAppFilesRoot(server.config, activeWorkspace), ".opencode");
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual({ configDir: expected, disableProjectConfig: "true" });
    const runtimeConfig = JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-config.json"), "utf8")) as { skills?: string[] | { paths?: string[] }; instructions?: string[] };
    expect(skillPaths(runtimeConfig.skills)).toContain(join(expected, "skills"));
    expect(runtimeConfig.instructions).toContain(join(workspace, "AGENTS.md"));
    expect((await readdir(workspace)).sort()).toEqual(["AGENTS.md", "original.txt"]);
    expect(await readdir(firstWorkspace)).toEqual(["original.txt"]);
    await assertColdThenScoped(server, `${envPath}.requests`, workspace, firstWorkspace);
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
    observeOwnedChild();
    const firstEntry = server.config.workspaces.find((entry) => entry.path === firstWorkspace)!;
    const firstExpected = join(externalAppFilesRoot(server.config, firstEntry), ".opencode");
    expect(JSON.parse(await readFile(envPath, "utf8"))).toEqual({ configDir: firstExpected, disableProjectConfig: "true" });
    const restartedRuntimeConfig = JSON.parse(await readFile(join(dirname(configPath), "runtime-opencode-config.json"), "utf8")) as { skills?: string[] | { paths?: string[] } };
    expect(skillPaths(restartedRuntimeConfig.skills)).toContain(join(firstExpected, "skills"));
    expect((await readdir(workspace)).sort()).toEqual(["AGENTS.md", "original.txt"]);
    expect(await readdir(firstWorkspace)).toEqual(["original.txt"]);
    expect(await readFile(join(workspace, "original.txt"), "utf8")).toBe("Original client bytes\n");
    expect(await readFile(join(firstWorkspace, "original.txt"), "utf8")).toBe("First client bytes\n");
    expect(await readFile(join(workspace, "AGENTS.md"), "utf8")).toBe("Client instructions stay readable.\n");
    await assertColdThenScoped(server, `${envPath}.requests`, firstWorkspace, workspace);
  } catch (error) {
    primaryFailure = { error };
  } finally {
    try {
      await server?.stop();
      // stop() owns termination; observe actual pipe closure before fixture removal.
      const deadline = Date.now() + 1000;
      while (ownedChildren.some((child) => !child.closed) && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      expect(ownedChildren).toHaveLength(2);
      expect(ownedChildren.every((child) => child.closed)).toBe(true);
    } catch (cleanupError) {
      if (primaryFailure) throw new AggregateError([primaryFailure.error, cleanupError], "Embedded fixture failed and cleanup also failed");
      throw cleanupError;
    } finally {
      spawnSpy.mockRestore();
      if (originalDataDir === undefined) delete process.env.LEGALWORK_DATA_DIR;
      else process.env.LEGALWORK_DATA_DIR = originalDataDir;
      if (originalEngineEnvPath === undefined) delete process.env.FAKE_ENGINE_ENV_PATH;
      else process.env.FAKE_ENGINE_ENV_PATH = originalEngineEnvPath;
      await rm(directory, { recursive: true, force: true });
      expect(childProcess.spawn).toBe(originalSpawn);
    }
  }
  if (primaryFailure) throw primaryFailure.error;
// Two managed process launches, scoped requests and shutdown share the existing budget.
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
