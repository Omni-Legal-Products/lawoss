import { runtimeDbHandles } from "./test-support/runtime-db-handles.js";
import { closeOrgPolicyRuntime } from "./org-policy.js";
import { runtimeDbPath } from "./runtime-db-lifecycle.js";
import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addMcp, listMcp, setMcpEnabled } from "./mcp.js";
import { buildLegalworkRuntimeSettings } from "./legalwork-runtime-config.js";
import { readLegalworkWorkspaceConfig } from "./legalwork-workspace-config-store.js";
import { addPlugin, listPlugins, removePlugin } from "./plugins.js";
import {
  applyGlobalToolPermissions,
  GLOBAL_PROVIDERS_ID,
  bootstrapRuntimeOpencodeConfig,
  GLOBAL_TOOL_PERMISSIONS_ID,
  readGlobalMcpMap,
  readGlobalToolPermissions,
  readRuntimeOpencodeConfig,
  onRuntimeOpencodeConfigWrite,
  writeRuntimeOpencodeConfig,
  type RuntimeOpencodeConfig,
} from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import { externalAppFilesRoot } from "./lawoss/workspace-app-files.js";
import { buildLegalworkRuntimeConfig } from "./legalwork-runtime-config.js";
import type { ServerConfig } from "./types.js";

const WORKSPACE_ID = "ws_runtime_test";

type Served = {
  port: number;
  stop: (closeActiveConnections?: boolean) => void | Promise<void>;
};

function serverConfig(root: string, dbPath: string): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 },
    corsOrigins: [],
    workspaces: [{ id: WORKSPACE_ID, name: "Test", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  } satisfies ServerConfig;
}

async function withWorkspace(fn: (input: { root: string; config: ServerConfig }) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-runtime-config-"));
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  const dbPath = join(root, "runtime.sqlite");
  process.env.LEGALWORK_RUNTIME_DB = dbPath;
  const config = serverConfig(root, dbPath);
  const path = runtimeDbPath(config);
  const errors: unknown[] = [];
  try {
    await fn({ root, config });
  } catch (error) { errors.push(error); }
  finally {
    try {
      try {
        await closeOrgPolicyRuntime(config, path);
        expect(await runtimeDbHandles(path)).toBe(0);
      } catch (error) { errors.push(error); }
      try { await rm(root, { recursive: true, force: true }); } catch (error) { errors.push(error); }
    } finally {
      if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
      else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    }
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length) throw new AggregateError(errors, "Fixture body and cleanup failed");
}

async function expectMissing(path: string): Promise<void> {
  await expect(stat(path)).rejects.toThrow();
}

describe("runtime OpenCode config store", () => {
  test("parallel settings updates preserve each other's changes", async () => {
    await withWorkspace(async ({ config }) => {
      await Promise.all(Array.from({ length: 30 }, (_, index) => writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({
        ...current, mcp: { ...current.mcp, servers: { ...current.mcp?.servers, [`connector_${index}`]: { type: "remote", url: `https://connector-${index}.example/mcp` } } },
      }))));
      expect(Object.keys((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).mcp?.servers ?? {})).toHaveLength(30);
    });
  });
  test("stores MCP changes in the LegalWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "mcp": { "servers": {\n    "project": { "type": "remote", "url": "https://project.example/mcp" }\n  } }\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", disabled: false });
      await setMcpEnabled(config, WORKSPACE_ID, "runtime", false);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "legalwork.json"));
      expect((await readGlobalMcpMap(config)).runtime?.disabled).toBe(true);

      const items = await listMcp(config, WORKSPACE_ID, root);
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("project:config.project");
      expect(items.map((item) => `${item.name}:${item.source}`)).toContain("runtime:config.remote");
    });
  });

  test("stores plugin changes in the LegalWork runtime DB without rewriting workspace files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      const opencode = '{\n  "plugins": ["project-plugin"]\n}\n';
      await writeFile(opencodePath, opencode, "utf8");

      expect(await addPlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await removePlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);
      expect(await addPlugin(config, WORKSPACE_ID, "runtime-plugin")).toBe(true);

      expect(await readFile(opencodePath, "utf8")).toBe(opencode);
      await expectMissing(join(root, ".opencode", "legalwork.json"));
      expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).plugins).toEqual(["runtime-plugin"]);

      const result = await listPlugins(config, WORKSPACE_ID, root, false);
      expect(result.items.map((item) => item.spec)).toEqual(["project-plugin", "runtime-plugin"]);

      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", disabled: false });
      const runtimeConfig = (await buildLegalworkRuntimeSettings(config, WORKSPACE_ID)).configuration;
      expect(runtimeConfig.plugins).toContain("runtime-plugin");
      expect(runtimeConfig.mcp?.servers?.runtime?.type).toBe("remote");
      expect(runtimeConfig.mcp?.servers?.runtime).toMatchObject({ url: "https://runtime.example/mcp" });
    });
  });

  test("malformed user opencode config does not block runtime config reads", async () => {
    await withWorkspace(async ({ root, config }) => {
      await writeFile(join(root, "opencode.jsonc"), '{ "mcp": {\n}\n}\n}\n', "utf8");
      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp", disabled: false });
      await addPlugin(config, WORKSPACE_ID, "runtime-plugin");

      const mcpItems = await listMcp(config, WORKSPACE_ID, root);
      const pluginItems = await listPlugins(config, WORKSPACE_ID, root, false);

      expect(mcpItems.map((item) => item.name)).toContain("runtime");
      expect(pluginItems.items.map((item) => item.spec)).toContain("runtime-plugin");
    });
  });

  test("stores LegalWork-owned workspace config in the runtime DB without writing legacy files", async () => {
    await withWorkspace(async ({ root, config }) => {
      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({
            legalwork: {
              cloudImports: {
                plugins: {
                  plugin_1: { pluginId: "plugin_1", name: "productivity", files: [] },
                },
              },
            },
          }),
        });
        expect(response.status).toBe(200);

        const legacyLegalworkPath = join(root, ".opencode", "legalwork.json");
        const legacyLegalwork = await readFile(legacyLegalworkPath, "utf8").catch(() => "");
        expect(legacyLegalwork).not.toContain("productivity");
        expect(legacyLegalwork).not.toContain("cloudImports");
        expect((await readLegalworkWorkspaceConfig(config, WORKSPACE_ID)).cloudImports).toEqual({
          plugins: {
            plugin_1: { pluginId: "plugin_1", name: "productivity", files: [] },
          },
        });

        const configResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(configResponse.status).toBe(200);
        expect(await configResponse.json()).toMatchObject({
          legalwork: {
            cloudImports: {
              plugins: {
                plugin_1: { pluginId: "plugin_1", name: "productivity", files: [] },
              },
            },
          },
        });
      } finally {
        await server.stop(true);
      }
    });
  });

  test("redirects project OpenCode writes to external app files while runtime settings remain available", async () => {
    await withWorkspace(async ({ root, config }) => {
      config.workspaces[0]!.appFiles = "outside";
      const projectConfigPath = join(root, ".opencode", "opencode.jsonc");
      const originalProjectConfig = '{ "original": true }\n';
      await mkdir(join(root, ".opencode"), { recursive: true });
      await writeFile(projectConfigPath, originalProjectConfig, "utf8");
      await writeFile(join(root, "client-record.txt"), "original client record", "utf8");
      const appFilesRoot = externalAppFilesRoot(config, config.workspaces[0]!);

      const server = await startServer(config) as Served;
      try {
        // Upstream v0.3.0: raw OpenCode configuration is host-only; skills and commands stay client routes.
        const request = (path: string, body: Record<string, unknown>) => fetch(`http://127.0.0.1:${server.port}${path}`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, ...(path.endsWith("/opencode-config") ? { "x-legalwork-host-token": config.hostToken } : {}), "content-type": "application/json" },
          body: JSON.stringify(body),
        });

        const [configResponse, skillResponse, commandResponse] = await Promise.all([
          request(`/workspace/${WORKSPACE_ID}/opencode-config`, { scope: "project", content: '{ "changed": true }' }),
          request(`/workspace/${WORKSPACE_ID}/skills`, { name: "external-skill", description: "External skill", content: "# external" }),
          request(`/workspace/${WORKSPACE_ID}/commands`, { name: "external-command", description: "External command", template: "External" }),
        ]);
        for (const response of [configResponse, skillResponse, commandResponse]) expect(response.status).toBe(200);

        const [configRead, commandList, skillList] = await Promise.all([
          fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/opencode-config?scope=project`, { headers: { authorization: `Bearer ${config.token}`, "x-legalwork-host-token": config.hostToken } }),
          fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/commands`, { headers: { authorization: `Bearer ${config.token}` } }),
          fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/skills`, { headers: { authorization: `Bearer ${config.token}` } }),
        ]);
        expect((await configRead.json()).content).toContain('"changed": true');
        expect((await commandList.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "external-command" })]));
        expect((await skillList.json()).items).toEqual(expect.arrayContaining([expect.objectContaining({ name: "external-skill" })]));
        expect(await readFile(join(appFilesRoot, ".opencode", "opencode.jsonc"), "utf8")).toContain('"changed": true');
        expect(await readFile(join(appFilesRoot, ".opencode", "commands", "external-command.md"), "utf8")).toContain("External");
        expect(await readFile(join(appFilesRoot, ".opencode", "skills", "external-skill", "SKILL.md"), "utf8")).toContain("# external");

        expect(await readFile(projectConfigPath, "utf8")).toBe(originalProjectConfig);
        expect(await readFile(join(root, "client-record.txt"), "utf8")).toBe("original client record");
        await expectMissing(join(root, ".opencode", "skills"));
        await expectMissing(join(root, ".opencode", "commands"));

        const previousConfigHome = process.env.XDG_CONFIG_HOME;
        process.env.XDG_CONFIG_HOME = join(root, "global-config");
        try {
          const globalResponse = await request(`/workspace/${WORKSPACE_ID}/opencode-config`, {
            scope: "global",
            content: '{ "global": true }',
          });
          expect(globalResponse.status).toBe(200);
          expect(await readFile(join(root, "global-config", "opencode", "opencode.jsonc"), "utf8")).toBe('{ "global": true }\n');
        } finally {
          if (previousConfigHome === undefined) delete process.env.XDG_CONFIG_HOME;
          else process.env.XDG_CONFIG_HOME = previousConfigHome;
        }

        const runtimeResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          method: "PATCH",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
          body: JSON.stringify({ opencode: { providers: { synthetic: { name: "Synthetic" } } } }),
        });
        expect(runtimeResponse.status).toBe(200);
        // LAWOSS: providers are shared across workspaces, while this workspace's
        // application files still live outside the client directory.
        expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).providers).toEqual({
          synthetic: { name: "Synthetic" },
        });
        expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).providers ?? {}).toEqual({});
        const effectiveResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(effectiveResponse.status).toBe(200);
        const effective: { opencode?: { providers?: Record<string, unknown> } } = await effectiveResponse.json();
        expect(effective.opencode?.providers?.synthetic).toMatchObject({ name: "Synthetic" });
        const engineConfig: { providers?: Record<string, unknown> } = JSON.parse(await buildLegalworkRuntimeConfig(config, WORKSPACE_ID));
        expect(engineConfig.providers?.synthetic).toMatchObject({ name: "Synthetic" });
        expect(await readFile(projectConfigPath, "utf8")).toBe(originalProjectConfig);
        expect(await readFile(join(root, "client-record.txt"), "utf8")).toBe("original client record");
      } finally {
        await server.stop(true);
      }
    });
  });

  test("patches tool permissions globally while external_directory stays workspace-scoped", async () => {
    await withWorkspace(async ({ config }) => {
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, (current) => ({
        ...current,
        permissions: [{ action: "external_directory", resource: "/tmp/shared/*", effect: "allow" }],
      }));

      const server = await startServer(config) as Served;
      try {
        const patch = async (toolPermissionRules: Record<string, NonNullable<RuntimeOpencodeConfig["permissions"]> | null>) => {
          const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
            method: "PATCH",
            headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
            body: JSON.stringify({ legalwork: { toolPermissionRules } }),
          });
          expect(response.status).toBe(200);
        };

        // Tool keys land in the reserved GLOBAL row, not the workspace row.
        await patch({ edit: [{ action: "edit", resource: "*", effect: "ask" }], shell: [{ action: "shell", resource: "git *", effect: "allow" }, { action: "shell", resource: "*", effect: "ask" }] });
        expect((await readRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID)).permissions).toEqual([
          { action: "edit", resource: "*", effect: "ask" }, { action: "shell", resource: "git *", effect: "allow" }, { action: "shell", resource: "*", effect: "ask" },
        ]);
        expect((await readRuntimeOpencodeConfig(config, WORKSPACE_ID)).permissions).toEqual([
          { action: "external_directory", resource: "/tmp/shared/*", effect: "allow" },
        ]);

        // A typed action removal leaves the other global actions untouched.
        await patch({ shell: null });
        expect((await readRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID)).permissions).toEqual([
          { action: "edit", resource: "*", effect: "ask" },
        ]);

        // GET returns the merged view: global tool keys + workspace folders.
        const configResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(configResponse.status).toBe(200);
        expect(await configResponse.json()).toMatchObject({
          opencode: {
            // LAWOSS: an unset shell rule asks by default (lawoss/tool-permission-defaults.ts).
            permissions: [
              { action: "shell", resource: "*", effect: "ask" },
              { action: "edit", resource: "*", effect: "ask" },
              { action: "external_directory", resource: "/tmp/shared/*", effect: "allow" },
            ],
            $legalworkReadOnlyProjection: true,
          },
        });
      } finally {
        await server.stop(true);
      }
    });
  });

  test("legacy workspace-row tool permissions are ignored in favor of the global row", async () => {
    await withWorkspace(async ({ config }) => {
      // A row written before permissions went global: stale tool keys + folders.
      const path = process.env.LEGALWORK_RUNTIME_DB;
      if (!path) throw new Error("Synthetic runtime DB is required");
      const legacy = new Database(path);
      try {
        legacy.run("CREATE TABLE IF NOT EXISTS runtime_opencode_configs (workspace_id TEXT PRIMARY KEY NOT NULL, config_json TEXT NOT NULL, updated_at INTEGER NOT NULL)");
        legacy.run("INSERT INTO runtime_opencode_configs VALUES (?, ?, ?)", [WORKSPACE_ID, JSON.stringify({ permission: { external_directory: { "/tmp/shared/*": "allow" }, bash: "allow", edit: "allow" } }), 1]);
        legacy.run("INSERT INTO runtime_opencode_configs VALUES (?, ?, ?)", [GLOBAL_TOOL_PERMISSIONS_ID, JSON.stringify({ permission: { bash: "ask" } }), 1]);
      } finally { legacy.close(); }

      await bootstrapRuntimeOpencodeConfig(config);
      const merged = applyGlobalToolPermissions(
        await readRuntimeOpencodeConfig(config, WORKSPACE_ID),
        await readGlobalToolPermissions(config),
      );
      // Stale workspace `bash`/`edit` do not leak through; folders survive.
      // LAWOSS: the unset global `edit` is the default "ask" (lawoss/tool-permission-defaults.ts), not the stale allow.
      expect(merged.permissions).toEqual([
        { action: "edit", resource: "*", effect: "ask" },
        { action: "shell", resource: "*", effect: "ask" },
        { action: "external_directory", resource: "/tmp/shared/*", effect: "allow" },
      ]);
    });
  });

  test("explicitly migrates legacy LegalWork runtime config into the runtime DB", async () => {
    await withWorkspace(async ({ root, config }) => {
      await mkdir(join(root, ".opencode"), { recursive: true });
      const legalworkPath = join(root, ".opencode", "legalwork.json");
      await writeFile(legalworkPath, JSON.stringify({
        version: 1,
        workspace: { name: "Test" },
        plugin: ["legacy-plugin"],
        mcp: { legacy: { type: "remote", url: "https://legacy.example/mcp" } },
        permission: { external_directory: { "/legacy/*": "allow" } },
        provider: { legacy: { npm: "legacy-provider" } },
      }, null, 2) + "\n", "utf8");

      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config/migrate`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          migrated: true,
          keys: ["plugin", "mcp", "permission", "provider"],
        });

        const runtime = await readRuntimeOpencodeConfig(config, WORKSPACE_ID);
        expect(runtime.plugins).toEqual(["legacy-plugin"]);
        // Connectors are shared by every workspace: the migrated MCP lands in the shared row.
        expect((await readGlobalMcpMap(config)).legacy?.url).toBe("https://legacy.example/mcp");
        expect(runtime.mcp?.servers?.legacy).toBeUndefined();
        expect(runtime.permissions).toContainEqual({ action: "external_directory", resource: "/legacy/*", effect: "allow" });
        expect(runtime.providers?.legacy).toMatchObject({ package: "legacy-provider" });

        const legalwork = JSON.parse(await readFile(legalworkPath, "utf8")) as Record<string, unknown>;
        expect(legalwork.version).toBe(1);
        expect(legalwork.workspace).toEqual({ name: "Test" });
        expect(legalwork.plugin).toBeUndefined();
        expect(legalwork.mcp).toBeUndefined();
        expect(legalwork.permission).toBeUndefined();
        expect(legalwork.provider).toBeUndefined();

        const statusResponse = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(statusResponse.status).toBe(200);
        const status = await statusResponse.json() as {
          effectiveRuntime: Record<string, unknown>;
          sources: Record<string, { exists?: boolean; keys: string[]; config?: Record<string, unknown> }>;
        };
        // The migrated MCP lives in the shared connector row, so it is absent
        // from this workspace's own row but present in what the engine gets.
        expect(status).toMatchObject({
          runtimeKeys: ["plugins", "permissions", "providers"],
          sources: {
            projectOpencode: { exists: false, keys: [] },
            runtimeDatabase: { keys: ["plugins", "permissions", "providers"] },
          },
          legacyLegalwork: { keys: [] },
          userOpencode: { exists: false, keys: [] },
        });
        // Diagnostics are read-only metadata; full MCP definitions stay in the
        // private store and the connector settings API provides presence only.
        expect(status.effectiveRuntime.mcp).toBeUndefined();
        expect(status.effectiveRuntime.agents).toMatchObject({ legalwork: { mode: "primary" } });
        expect(status.effectiveRuntime.providers).toMatchObject({ legacy: { package: "legacy-provider" } });
        expect(status.sources.injected.config?.agents).toMatchObject({ legalwork: { mode: "primary" } });
        expect(status.sources.injected.keys).toContain("providers");
        expect(status.sources.globalOpencode).toHaveProperty("path");
      } finally {
        await server.stop(true);
      }
    });
  });

  test("runtime config status tolerates malformed legacy LegalWork metadata", async () => {
    await withWorkspace(async ({ root, config }) => {
      await mkdir(join(root, ".opencode"), { recursive: true });
      await writeFile(join(root, ".opencode", "legalwork.json"), "{ invalid\n", "utf8");
      // The status reports this workspace's own row, so give it an entry of its own.
      await addMcp(config, WORKSPACE_ID, "runtime", { type: "remote", url: "https://runtime.example/mcp" }, "workspace");

      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config`, {
          headers: { authorization: `Bearer ${config.token}` },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          runtimeKeys: ["mcp"],
          legacyLegalwork: { keys: [], error: "Failed to parse legalwork.json" },
        });
      } finally {
        await server.stop(true);
      }
    });
  });

  test("explicitly migrates safe LegalWork-managed keys from user opencode config", async () => {
    await withWorkspace(async ({ root, config }) => {
      const opencodePath = join(root, "opencode.jsonc");
      await writeFile(opencodePath, JSON.stringify({
        $schema: "https://opencode.ai/config.json",
        default_agent: "legalwork",
        plugin: ["opencode-chrome-devtools", "user-plugin"],
        provider: { local: { npm: "@ai-sdk/openai-compatible" } },
        agent: { reviewer: { mode: "subagent", model: "opencode/big-pickle" } },
        disabled_providers: ["old-provider"],
        custom_user_key: true,
      }, null, 2) + "\n", "utf8");

      const server = await startServer(config) as Served;
      try {
        const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${WORKSPACE_ID}/runtime-config/migrate`, {
          method: "POST",
          headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json" },
        });
        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({
          migrated: true,
          userOpencodeKeys: ["default_agent", "plugin", "disabled_providers", "provider", "agent"],
        });

        const runtime = await readRuntimeOpencodeConfig(config, WORKSPACE_ID);
        expect(runtime.default_agent).toBe("legalwork");
        expect(runtime.plugins).toEqual(["user-plugin"]);
        expect(runtime.providers?.local).toMatchObject({ package: "@opencode/ai/providers/openai-compatible" });
        expect(runtime.agents?.reviewer).toMatchObject({ mode: "subagent", model: { providerID: "opencode", model: "big-pickle" } });
        expect(runtime.policies).toContainEqual({ action: "provider.use", resource: "old-provider", effect: "deny" });

        const opencode = JSON.parse(await readFile(opencodePath, "utf8")) as Record<string, unknown>;
        expect(opencode.$schema).toBe("https://opencode.ai/config.json");
        expect(opencode.custom_user_key).toBe(true);
        expect(opencode.default_agent).toBeUndefined();
        expect(opencode.plugin).toBeUndefined();
        expect(opencode.provider).toBeUndefined();
        expect(opencode.agent).toBeUndefined();
        expect(opencode.disabled_providers).toBeUndefined();
      } finally {
        await server.stop(true);
      }
    });
  });
});


test("config notifications skip exact no-ops but retain mutation and permission rule ordering", async () => {
  await withWorkspace(async ({ config }) => {
    await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, () => ({ permissions: [{ action: "read", resource: "*", effect: "allow" }, { action: "read", resource: "*.secret", effect: "deny" }] }));
    const changes: string[] = [];
    const stop = onRuntimeOpencodeConfigWrite((source, workspace) => { if (source === config) changes.push(workspace); });
    try {
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => current);
      expect(changes).toEqual([]);
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => {
        current.permissions = [{ action: "read", resource: "*.secret", effect: "deny" }, { action: "read", resource: "*", effect: "allow" }];
        return current;
      });
      expect(changes).toEqual([WORKSPACE_ID]);
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => {
        current.permissions = [{ action: "read", resource: "*", effect: "deny" }];
        return current;
      });
      expect(changes).toEqual([WORKSPACE_ID, WORKSPACE_ID]);
    } finally { stop(); }
  });
});

test("policy-change notifications distinguish provider edits from in-place and agent permission edits", async () => {
  await withWorkspace(async ({ config }) => {
    await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, () => ({ agents: { reviewer: { system: "Before", permissions: [{ action: "*", resource: "*", effect: "deny" }] } } }));
    const changes: boolean[] = [];
    const stop = onRuntimeOpencodeConfigWrite((source, workspace, change) => { if (source === config && workspace === WORKSPACE_ID && change) changes.push(change.permissionsChanged); });
    try {
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, providers: { fixture: { name: "Provider" } } }));
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, agents: { reviewer: { ...current.agents?.reviewer, system: "After" } } }));
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => { current.permissions = [{ action: "shell", resource: "*", effect: "ask" }]; return current; });
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, agents: { reviewer: { ...current.agents?.reviewer, permissions: [{ action: "*", resource: "*", effect: "ask" }] } } }));
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, projectPermissionApprovals: [{ id: "psv_fixture", action: "external_directory", resources: ["/shared/*"], createdAt: 1 }] }));
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, projectPermissionApprovals: [{ id: "psv_renamed", action: "external_directory", resources: ["/shared/*"], createdAt: 2, updatedAt: 3 }] }));
      await writeRuntimeOpencodeConfig(config, WORKSPACE_ID, current => ({ ...current, projectPermissionApprovals: [] }));
      expect(changes).toEqual([false, false, true, true, true, false, true]);
    } finally { stop(); }
  });
});
