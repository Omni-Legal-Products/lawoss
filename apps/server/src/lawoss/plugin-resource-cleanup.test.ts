import { expect, test } from "bun:test";
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPluginDestination, installCloudPlugin, readInstalledCloudPlugins, removeCloudPlugin, type CloudPluginResolved } from "../cloud-plugins.js";
import { GLOBAL_MCP_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { GLOBAL_PLUGIN_RECORD_ID } from "./plugin-install-target.js";
import { prunePluginResourceNamespace, referencedResourceEntriesInConfig } from "./plugin-resource-cleanup.js";

// #357: po aktualizácii doplnku ostávala stará verzia runtime v `.opencode/plugin-resources/<namespace>/<sha256>`.

const NAMESPACE = "resource-plugin";
const HEX = /^[a-f0-9]{64}$/;

function bundle(version: string, options: { id?: string; extraPath?: string } = {}): CloudPluginResolved {
  const resources = [["scripts/run.mjs", `console.log('${version}');`], ["runtime-config.json", JSON.stringify({ version })]];
  if (options.extraPath) resources.push([options.extraPath, "extra"]);
  return {
    plugin: { id: options.id ?? "resource-plugin", name: "Resource Plugin", description: null, updatedAt: null },
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
  const root = await mkdtemp(join(tmpdir(), "resource-cleanup-"));
  const saved = { db: process.env.LEGALWORK_RUNTIME_DB, xdg: process.env.XDG_CONFIG_HOME };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  process.env.XDG_CONFIG_HOME = join(root, "config");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test", hostToken: "test", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], authorizedRoots: [root],
    workspaces: [{ id: "workspace", name: "Test", path: join(root, "ws"), preset: "starter", workspaceType: "local" }],
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  try { await run(root, config); }
  finally {
    for (const [key, value] of [["LEGALWORK_RUNTIME_DB", saved.db], ["XDG_CONFIG_HOME", saved.xdg]] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    await rm(root, { recursive: true, force: true });
  }
}

/** Digest adresára runtime z cesty zaznamenaného súboru. */
function digestOf(plugin: { files: Array<{ path: string }> }): string {
  const digest = plugin.files.find((file) => file.path.startsWith(`.opencode/plugin-resources/${NAMESPACE}/`))?.path.split("/")[3];
  expect(digest).toMatch(HEX);
  return digest!;
}

async function entries(path: string): Promise<string[]> {
  return (await readdir(path)).sort();
}

const exists = (path: string) => lstat(path).then(() => true, () => false);

test("aktualizácia ponechá len aktuálnu verziu runtime a nesiahne na iné doplnky", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const resources = join(ws, ".opencode", "plugin-resources");
    const other = join(resources, "other-plugin", "a".repeat(64));
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "run.mjs"), "other");

    const first = await install(bundle("v1"));
    const second = await install(bundle("v2"));
    expect(digestOf(second)).not.toBe(digestOf(first));
    expect(await entries(join(resources, NAMESPACE))).toEqual([digestOf(second)]);
    expect(await readFile(join(other, "run.mjs"), "utf8")).toBe("other");
    // Rovnaká verzia znova: žiadna zmena, runtime ostáva.
    await install(bundle("v2"));
    expect(await entries(join(resources, NAMESPACE))).toEqual([digestOf(second)]);
  });
});

test("staging po páde sa po inštalácii odstráni, čerstvý staging súbežnej inštalácie ostane", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    await install(bundle("v1"));
    const stale = join(namespaceDir, `${"b".repeat(64)}.staging-AbC123`);
    const fresh = join(namespaceDir, `${"c".repeat(64)}.staging-XyZ789`);
    for (const dir of [stale, fresh]) {
      await mkdir(join(dir, "scripts"), { recursive: true });
      await writeFile(join(dir, "scripts", "run.mjs"), "partial");
    }
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await utimes(stale, old, old);
    const second = await install(bundle("v2"));
    expect(await entries(namespaceDir)).toEqual([digestOf(second), `${"c".repeat(64)}.staging-XyZ789`].sort());
  });
});

test("neúspešná aktualizácia nechá doterajší runtime nedotknutý", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    const first = await install(bundle("v1"));
    await expect(install(bundle("v2", { extraPath: `later/${"a".repeat(300)}.js` }))).rejects.toThrow();
    expect(await entries(namespaceDir)).toEqual([digestOf(first)]);
    expect(await readFile(join(namespaceDir, digestOf(first), "scripts", "run.mjs"), "utf8")).toBe("console.log('v1');");
  });
});

test("doplnky so spoločným namespace si runtime navzájom nezmažú", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    const otherSource = await install(bundle("other", { id: "github:someone/else#plugins/resource" }));
    await install(bundle("v1"));
    const second = await install(bundle("v2"));
    expect(await entries(namespaceDir)).toEqual([digestOf(otherSource), digestOf(second)].sort());
  });
});

test("globálne: aktualizácia v jednom zázname ponechá runtime, ktorý používa druhý globálny záznam", async () => {
  await workspace(async (root, config) => {
    const globalRoot = join(root, "config", "opencode");
    const namespaceDir = join(globalRoot, "plugin-resources", NAMESPACE);
    const install = (recordId: string, resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: recordId, workspaceRoot: globalRoot, marketplaceId: null, resolved, global: true });
    // Import z priečinka (`GLOBAL_MCP_ID`) a LAWOSS Marketplace (`GLOBAL_PLUGIN_RECORD_ID`) zdieľajú globálny koreň.
    const shared = await install(GLOBAL_MCP_ID, bundle("shared", { id: "github:someone/else#plugins/resource" }));
    await install(GLOBAL_PLUGIN_RECORD_ID, bundle("v1"));
    const second = await install(GLOBAL_PLUGIN_RECORD_ID, bundle("v2"));
    expect(await entries(namespaceDir)).toEqual([digestOf(shared), digestOf(second)].sort());
    await removeCloudPlugin({ serverConfig: config, workspaceId: GLOBAL_PLUGIN_RECORD_ID, workspaceRoot: globalRoot, pluginId: "resource-plugin", global: true });
    expect(await entries(namespaceDir)).toEqual([digestOf(shared)]);
  });
});

test("verzia, na ktorú ukazuje uložené nastavenie MCP, sa nezmaže", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    const first = await install(bundle("v1"));
    // Engine v2: connectors live under `mcp.servers`.
    await writeRuntimeOpencodeConfig(config, "workspace", (current) => ({ ...current, mcp: { ...current.mcp, servers: { ...current.mcp?.servers,
      custom: { type: "local", command: ["node", join(namespaceDir, digestOf(first), "scripts", "run.mjs"), "--custom"], disabled: false } } } }));
    const second = await install(bundle("v2"));
    expect(await entries(namespaceDir)).toEqual([digestOf(first), digestOf(second)].sort());
  });
});

test("odkaz na verziu v nastavení MCP rozpozná aj cestu z Windows", () => {
  const digest = "f".repeat(64);
  expect([...referencedResourceEntriesInConfig({ a: { command: ["node", `C:\\Users\\x\\.opencode\\plugin-resources\\${NAMESPACE}\\${digest}\\scripts\\run.mjs`] } }, NAMESPACE)]).toEqual([digest]);
  expect([...referencedResourceEntriesInConfig({ a: { command: ["node", `/x/plugin-resources/other-${NAMESPACE}/${digest}/run.mjs`] } }, NAMESPACE)]).toEqual([]);
});

test("odinštalovanie odstráni priečinok runtime doplnku, iné doplnky ostanú", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const resources = join(ws, ".opencode", "plugin-resources");
    const other = join(resources, "other-plugin", "a".repeat(64));
    await mkdir(other, { recursive: true });
    await writeFile(join(other, "run.mjs"), "other");
    await installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved: bundle("v1") });
    await removeCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, pluginId: "resource-plugin" });
    expect(await exists(join(resources, NAMESPACE))).toBe(false);
    expect(await readFile(join(other, "run.mjs"), "utf8")).toBe("other");
    expect((await readInstalledCloudPlugins(config, "workspace")).plugins["resource-plugin"]).toBeUndefined();
  });
});

test("odkaz medzi verziami runtime sa nesleduje ani nemaže", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const outside = join(root, "outside");
    await mkdir(outside, { recursive: true });
    await writeFile(join(outside, "keep.txt"), "keep");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    await install(bundle("v1"));
    const link = join(ws, ".opencode", "plugin-resources", NAMESPACE, "d".repeat(64));
    await symlink(outside, link, "dir");
    await install(bundle("v2"));
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readFile(join(outside, "keep.txt"), "utf8")).toBe("keep");
  });
});

test("priečinok namespace ako odkaz sa nesleduje", async () => {
  await workspace(async (root) => {
    const ws = join(root, "ws");
    const outside = join(root, "outside");
    const victim = join(outside, "e".repeat(64));
    await mkdir(victim, { recursive: true });
    await writeFile(join(victim, "keep.txt"), "keep");
    await mkdir(join(ws, ".opencode", "plugin-resources"), { recursive: true });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    await symlink(outside, namespaceDir, "dir");
    const warnings: string[] = [];
    await prunePluginResourceNamespace({
      namespaceDir,
      assertSafe: () => assertPluginDestination(ws, `.opencode/plugin-resources/${NAMESPACE}`),
      referenced: new Set(),
      warn: (message) => warnings.push(message),
    });
    expect(await readFile(join(victim, "keep.txt"), "utf8")).toBe("keep");
    expect((await lstat(namespaceDir)).isSymbolicLink()).toBe(true);
    expect(warnings.length).toBe(1);
  });
});

test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("nezmazateľná stará verzia (napr. zamknutá na Windows) inštaláciu nezhodí", async () => {
  await workspace(async (root, config) => {
    const ws = join(root, "ws");
    const install = (resolved: CloudPluginResolved) => installCloudPlugin({ serverConfig: config, workspaceId: "workspace", workspaceRoot: ws, marketplaceId: null, resolved });
    const namespaceDir = join(ws, ".opencode", "plugin-resources", NAMESPACE);
    const first = await install(bundle("v1"));
    const locked = join(namespaceDir, digestOf(first), "scripts");
    await chmod(locked, 0o555);
    try {
      const second = await install(bundle("v2"));
      expect(digestOf((await readInstalledCloudPlugins(config, "workspace")).plugins["resource-plugin"]!)).toBe(digestOf(second));
      expect(await entries(namespaceDir)).toContain(digestOf(second));
    } finally {
      await chmod(locked, 0o755);
    }
    // Ďalšia inštalácia nepoužívanú verziu doupratuje.
    const third = await install(bundle("v3"));
    expect(await entries(namespaceDir)).toEqual([digestOf(third)]);
  });
});
