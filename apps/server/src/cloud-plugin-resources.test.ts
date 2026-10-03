import { expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCloudPlugin, readInstalledCloudPlugins, type CloudPluginResolved } from "./cloud-plugins.js";
import { readRuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import type { ServerConfig } from "./types.js";

function bundle(version: string, extraPath?: string): CloudPluginResolved {
  const resources = [["scripts/run.mjs", `console.log('${version}');`], ["runtime-config.json", JSON.stringify({ version })]];
  if (extraPath) resources.push([extraPath, "extra"]);
  return {
    plugin: { id: "resource-plugin", name: "Resource Plugin", description: null, updatedAt: null },
    memberships: [
      ...resources.map(([path = "", content = ""]) => ({
        configObjectId: path,
        configObject: { id: path, objectType: "resource" as const, title: path, description: null,
          currentRelativePath: path, status: "active", updatedAt: null,
          latestVersion: { id: version, rawSourceText: content, normalizedPayloadJson: null } },
      })),
      { configObjectId: "mcp", configObject: {
        id: "mcp", objectType: "mcp", title: "MCP", description: null, currentRelativePath: null,
        status: "active", updatedAt: null, latestVersion: { id: version, rawSourceText: null,
          normalizedPayloadJson: { mcpServers: { resource: { command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/scripts/run.mjs"] } } },
        },
      } },
    ],
  };
}

async function workspace(run: (root: string, config: ServerConfig) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "resource-install-"));
  const previous = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "test", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], authorizedRoots: [root],
    workspaces: [{ id: "workspace", name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  try { await run(root, config); }
  finally {
    if (previous === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
    else process.env.LEGALWORK_RUNTIME_DB = previous;
    await rm(root, { recursive: true, force: true });
  }
}

test("failed resource update preserves the installed executable and registry", async () => {
  await workspace(async (root, config) => {
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: root, marketplaceId: null, resolved });
    const first = await install(bundle("v1"));
    const entrypoint = first.files.find((file) => file.path.endsWith("scripts/run.mjs"));
    expect(entrypoint).toBeDefined();
    const beforeConfig = await readRuntimeOpencodeConfig(config, "workspace");
    const beforeRegistry = await readInstalledCloudPlugins(config, "workspace");
    // Safe relative path, but too long for the filesystem: failure occurs after earlier resources were written.
    await expect(install(bundle("v2", `later/${"a".repeat(300)}.js`))).rejects.toThrow();
    expect(await readFile(join(root, entrypoint!.path), "utf8")).toBe("console.log('v1');");
    expect(await readInstalledCloudPlugins(config, "workspace")).toEqual(beforeRegistry);
    expect(await readRuntimeOpencodeConfig(config, "workspace")).toEqual(beforeConfig);
    const second = await install(bundle("v2"));
    expect(second.files.find((file) => file.path.endsWith("scripts/run.mjs"))?.path).not.toBe(entrypoint!.path);
    expect(await readFile(join(root, entrypoint!.path), "utf8")).toBe("console.log('v1');");
  });
});

test("all resource paths are validated before installing any files", async () => {
  await workspace(async (root, config) => {
    await expect(installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: root,
      marketplaceId: null, resolved: bundle("v1", "../outside.js") })).rejects.toThrow();
    expect((await readdir(root)).filter((name) => name === ".opencode")).toEqual([]);
  });
});
