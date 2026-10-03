import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEmbeddedServer } from "./embedded.js";

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
  } finally {
    await server?.stop();
    if (originalDataDir === undefined) delete process.env.LEGALWORK_DATA_DIR;
    else process.env.LEGALWORK_DATA_DIR = originalDataDir;
    if (originalConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = originalConfigHome;
    await rm(directory, { recursive: true, force: true });
  }
});
