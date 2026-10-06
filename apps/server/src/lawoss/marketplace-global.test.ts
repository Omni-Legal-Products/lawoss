import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCloudPlugin, readInstalledCloudPlugins } from "../cloud-plugins.js";
import { resolveClaudePluginBundle } from "../claude-plugin-bundle.js";
import { runtimeMcpMapForWorkspace, setMcpEnabled } from "../mcp.js";
import type { ServerConfig } from "../types.js";
import { availableUpdates, installGlobalPlugin, moveWorkspacePlugin, pluginFileChanges, removeGlobalPlugin, updateGlobalPlugin, workspaceTarget } from "./marketplace-global.js";
import { marketplaceStatePath, readUpdateState, runMarketplaceCheck } from "./marketplace-updates.js";
import { globalPluginTarget } from "./plugin-install-target.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const SHA1 = "1".repeat(40);
const SHA2 = "2".repeat(40);
const OWNER_REPO = "Omni-Legal-Products/lawoss-marketplace";
const PLUGIN_ID = `github:${OWNER_REPO}#plugins/demo`;
const url = (sha: string) => `https://github.com/${OWNER_REPO}/tree/${sha}/plugins/demo`;

/** Vymyslený plugin s lokálnym MCP (bundled Node) a jedným skillom v dvoch verziách. */
function pluginFiles(version: string, skillBody: string): Record<string, string> {
  return {
    "plugins/demo/.claude-plugin/plugin.json": JSON.stringify({ name: "demo", version, description: "Vymyslený plugin" }),
    "plugins/demo/.mcp.json": JSON.stringify({ mcpServers: { demo: { command: "node", args: ["scripts/run.mjs", "mcp"] } } }),
    "plugins/demo/runtime-config.json": JSON.stringify({ name: "demo", entrypoint: "dist/index.js" }),
    "plugins/demo/scripts/run.mjs": `// runtime ${version}\n`,
    "plugins/demo/skills/demo/SKILL.md": `---\nname: demo\ndescription: Vymyslený skill\n---\n${skillBody}\n`,
  };
}

type FakeRepo = Record<string, Record<string, string>>;

function startFakeGithub(repo: FakeRepo, release: { tag: string | null; sha?: string; tags?: string[] }) {
  const failures = { trees: false };
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const { pathname } = new URL(request.url);
      const api = `/api/repos/${OWNER_REPO}/`;
      if (pathname.startsWith(api)) {
        const rest = pathname.slice(api.length);
        if (rest === "releases/latest") return release.tag ? Response.json({ tag_name: release.tag, published_at: "2026-10-05T10:00:00Z" }) : new Response("{}", { status: 404 });
        if (rest === "tags") return Response.json((release.tags ?? []).map((name) => ({ name })));
        if (rest.startsWith("commits/")) return release.sha ? Response.json({ sha: release.sha }) : new Response("{}", { status: 404 });
        if (rest.startsWith("git/trees/")) {
          const files = repo[decodeURIComponent(rest.slice("git/trees/".length))];
          if (failures.trees) return new Response("boom", { status: 500 });
          return files ? Response.json({ tree: Object.keys(files).map((path) => ({ path, sha: `blob-${path.length}`, type: "blob" })) }) : new Response("{}", { status: 404 });
        }
        return new Response("{}", { status: 404 });
      }
      const raw = `/raw/${OWNER_REPO}/`;
      if (pathname.startsWith(raw)) {
        const [sha, ...parts] = pathname.slice(raw.length).split("/");
        const content = repo[sha ?? ""]?.[parts.map(decodeURIComponent).join("/")];
        return content === undefined ? new Response("missing", { status: 404 }) : new Response(content);
      }
      return new Response("unexpected", { status: 418 });
    },
  });
  return { server, failures };
}

function serverConfig(root: string): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, token: "token", hostToken: "host-token", configPath: join(root, "legalwork", "server.json"),
    approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [
      { id: "ws_a", name: "Klient A", path: join(root, "a"), preset: "starter", workspaceType: "local" },
      { id: "ws_b", name: "Klient B", path: join(root, "b"), preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated",
    logFormat: "pretty", logRequests: false,
  } satisfies ServerConfig;
}

const ENV_KEYS = ["XDG_CONFIG_HOME", "LEGALWORK_RUNTIME_DB", "LEGALWORK_GITHUB_API_BASE", "LEGALWORK_GITHUB_RAW_BASE"] as const;

describe("LAWOSS Marketplace: inštalácia raz pre advokáta a aktualizácie", () => {
  let root = "";
  let saved: Record<string, string | undefined> = {};
  let fake: ReturnType<typeof startFakeGithub>;
  const repo: FakeRepo = {
    [SHA1]: { ...pluginFiles("1.0.0", "Verzia jedna."), ".claude-plugin/marketplace.json": JSON.stringify({ plugins: [{ name: "demo", version: "1.0.0", source: "./plugins/demo" }] }) },
    [SHA2]: { ...pluginFiles("1.1.0", "Verzia dva."), ".claude-plugin/marketplace.json": JSON.stringify({ plugins: [{ name: "demo", version: "1.1.0", source: "./plugins/demo" }] }) },
  };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "lawoss-marketplace-"));
    saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
    fake = startFakeGithub(repo, { tag: "v0.2.0", sha: SHA2 });
    process.env.XDG_CONFIG_HOME = join(root, "config");
    process.env.LEGALWORK_RUNTIME_DB = join(root, "legalwork", "runtime.sqlite");
    process.env.LEGALWORK_GITHUB_API_BASE = `http://127.0.0.1:${fake.server.port}/api`;
    process.env.LEGALWORK_GITHUB_RAW_BASE = `http://127.0.0.1:${fake.server.port}/raw`;
  });

  afterEach(async () => {
    fake.server.stop(true);
    for (const key of ENV_KEYS) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    // Windows: runtime.sqlite ostáva otvorená do konca procesu (test-support/remove-test-dir.ts).
    await removeTestDir(root);
  });

  const skillPath = () => join(root, "config", "opencode", "skills", "demo-plugin", "demo", "SKILL.md");

  test("globálna inštalácia: skill v globálnom priečinku OpenCode, MCP v spoločnom riadku pre všetky priečinky", async () => {
    const config = serverConfig(root);
    const result = await installGlobalPlugin(config, url(SHA1));
    expect(result.status).toBe("installed");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia jedna.");
    expect(result.item.provenance).toEqual({ source: { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: SHA1, dir: "plugins/demo" }, version: "1.0.0" });
    for (const workspaceId of ["ws_a", "ws_b"]) {
      const mcp = await runtimeMcpMapForWorkspace(config, workspaceId);
      // Bez JSON.stringify: ten na Windows zdvojí každé `\` a cesta by sa nikdy nenašla.
      expect([mcp.demo?.command ?? []].flat().join(" ")).toContain(join(root, "config", "opencode", "plugin-resources", "demo-plugin"));
    }
    // V priečinkoch klientov nič nevzniklo.
    expect(await readdir(join(root, "a")).catch(() => [])).toEqual([]);
    // Opakovaná inštalácia nič neprepíše ani nevráti na starú verziu.
    expect((await installGlobalPlugin(config, url(SHA2))).status).toBe("already_installed");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia jedna.");
  });

  test("globálne sa inštaluje len z LAWOSS Marketplace na pripnutom commite", async () => {
    const config = serverConfig(root);
    await expect(installGlobalPlugin(config, "https://github.com/someone/else/tree/main/plugins/demo")).rejects.toThrow();
    await expect(installGlobalPlugin(config, `https://github.com/${OWNER_REPO}/tree/main/plugins/demo`)).rejects.toThrow();
  });

  test("aktualizácia: upravený súbor sa bez opýtania neprepíše; ponechanie, záloha, vypnuté MCP ostane vypnuté", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const statePath = marketplaceStatePath(config);
    const state = await runMarketplaceCheck(statePath, "manual");
    expect(state.lastCheck).toMatchObject({ status: "ok", release: { tag: "v0.2.0", sha: SHA2 } });
    const installed = Object.values((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins);
    expect(availableUpdates(installed, state)).toEqual([{ pluginId: PLUGIN_ID, name: "demo", installed: "1.0.0", available: "1.1.0", path: "plugins/demo" }]);

    await setMcpEnabled(config, "ws_a", "demo", false);
    const mine = "---\nname: demo\ndescription: Moja úprava\n---\nMoja vlastná úprava.\n";
    await writeFile(skillPath(), mine);

    const asked = await updateGlobalPlugin(config, PLUGIN_ID, state, {});
    expect(asked).toEqual({ status: "needs_decision", changes: [{ path: ".opencode/skills/demo-plugin/demo/SKILL.md", title: "demo", state: "modified" }] });
    expect(await readFile(skillPath(), "utf8")).toBe(mine);

    const kept = await updateGlobalPlugin(config, PLUGIN_ID, state, { ".opencode/skills/demo-plugin/demo/SKILL.md": "keep" });
    expect(kept.status).toBe("updated");
    expect(await readFile(skillPath(), "utf8")).toBe(mine);
    if (kept.status !== "updated") throw new Error("expected update");
    expect(kept.item.provenance?.version).toBe("1.1.0");
    // Úprava ostáva rozpoznaná aj voči novej verzii.
    expect(await pluginFileChanges(globalPluginTarget(), kept.item)).toHaveLength(1);
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.enabled).toBe(false);
    expect(availableUpdates([kept.item], await readUpdateState(statePath))).toEqual([]);
  });

  test("aktualizácia so zálohou uloží moju úpravu bokom a prevezme novú verziu", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    await writeFile(skillPath(), "Moja úprava.\n");
    const result = await updateGlobalPlugin(config, PLUGIN_ID, state, { ".opencode/skills/demo-plugin/demo/SKILL.md": "backup" }, new Date("2026-10-05T12:00:00Z"));
    if (result.status !== "updated") throw new Error("expected update");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia dva.");
    expect(result.backups).toHaveLength(1);
    expect(result.backups[0]).toContain(join("config", "opencode", "lawoss-zalohy"));
    expect(result.backups[0]).toEndWith("SKILL.moja-uprava.md");
    expect(await readFile(result.backups[0]!, "utf8")).toBe("Moja úprava.\n");
  });

  test("zlyhanie zálohy zastaví aktualizáciu pred prepísaním úpravy", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    await writeFile(skillPath(), "Moja úprava.\n");
    // Na mieste priečinka záloh je súbor, záloha sa nedá vytvoriť.
    await writeFile(join(root, "config", "opencode", "lawoss-zalohy"), "blokuje");
    await expect(updateGlobalPlugin(config, PLUGIN_ID, state, { ".opencode/skills/demo-plugin/demo/SKILL.md": "backup" })).rejects.toThrow();
    expect(await readFile(skillPath(), "utf8")).toBe("Moja úprava.\n");
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]?.provenance?.version).toBe("1.0.0");
  });

  test("zlyhanie GitHubu pri aktualizácii nič nezmení", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    fake.failures.trees = true;
    await expect(updateGlobalPlugin(config, PLUGIN_ID, state, {})).rejects.toThrow();
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia jedna.");
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]?.provenance?.version).toBe("1.0.0");
  });

  test("presun doterajšej inštalácie z priečinka: úprava sa prenesie, kópia v priečinku zmizne až po rozhodnutí", async () => {
    const config = serverConfig(root);
    const bundle = await resolveClaudePluginBundle({ url: url(SHA1) });
    const workspaceRoot = join(root, "a");
    await installCloudPlugin({ serverConfig: config, workspaceId: "ws_a", workspaceRoot, marketplaceId: null, resolved: bundle.resolved, provenance: { source: bundle.preview.source, version: bundle.preview.version } });
    const legacySkill = join(workspaceRoot, ".opencode", "skills", "demo-plugin", "demo", "SKILL.md");
    await writeFile(legacySkill, "Moja úprava v priečinku.\n");
    const target = workspaceTarget("ws_a", workspaceRoot);

    const asked = await moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), {});
    expect(asked.status).toBe("needs_decision");
    expect(await readFile(legacySkill, "utf8")).toBe("Moja úprava v priečinku.\n");

    const moved = await moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), { ".opencode/skills/demo-plugin/demo/SKILL.md": "keep" });
    expect(moved.status).toBe("moved");
    expect(await readFile(skillPath(), "utf8")).toBe("Moja úprava v priečinku.\n");
    expect(await readFile(legacySkill, "utf8").catch(() => null)).toBeNull();
    expect((await readInstalledCloudPlugins(config, "ws_a")).plugins[PLUGIN_ID]).toBeUndefined();
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo).toBeDefined();
  });

  test("odinštalovanie: upravený súbor sa bez rozhodnutia nevymaže, predvolene ide do zálohy", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    await writeFile(skillPath(), "Moja úprava.\n");
    expect((await removeGlobalPlugin(config, PLUGIN_ID, {})).status).toBe("needs_decision");
    const removed = await removeGlobalPlugin(config, PLUGIN_ID, { ".opencode/skills/demo-plugin/demo/SKILL.md": "backup" });
    if (removed.status !== "removed") throw new Error("expected removal");
    expect(await readFile(removed.backups[0]!, "utf8")).toBe("Moja úprava.\n");
    expect((await runtimeMcpMapForWorkspace(config, "ws_a")).demo).toBeUndefined();
  });
});
