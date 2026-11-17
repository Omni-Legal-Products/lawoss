import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCloudPlugin, readInstalledCloudPlugins, writeInstalledCloudPlugins } from "../cloud-plugins.js";
import { resolveClaudePluginBundle } from "../claude-plugin-bundle.js";
import { addMcp, removeMcp, runtimeMcpMapForWorkspace, setMcpEnabled } from "../mcp.js";
import { GLOBAL_MCP_ID, readRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { availableUpdates, installGlobalPlugin, missingMcp, moveWorkspacePlugin, pluginFileChanges, removeGlobalPlugin, updateGlobalPlugin, workspaceTarget } from "./marketplace-global.js";
import { marketplaceStatePath, readUpdateState, runMarketplaceCheck, updateUpdateState } from "./marketplace-updates.js";
import { globalPluginTarget } from "./plugin-install-target.js";
import { BUNDLED_MARKETPLACE_REF } from "./marketplace-bundled-ref.js";
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
    expect(result.item.lawossProvenance).toEqual({ source: { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: SHA1, dir: "plugins/demo" }, version: "1.0.0" });
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

  test("#436: pripojenie odstránené v Nastaveniach: doplnok nie je nainštalovaný a opätovná inštalácia ho vráti bez prepísania úpravy", async () => {
    const config = serverConfig(root);
    const installed = await installGlobalPlugin(config, url(SHA1));
    expect(await missingMcp(config, installed.item)).toEqual([]);
    await writeFile(skillPath(), "Moja úprava.\n");
    // Settings › Integrations › register › Remove (DELETE /workspace/:id/mcp/:name) removes the shared connection only.
    expect(await removeMcp(config, "ws_a", "demo")).toEqual(["global"]);
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo).toBeUndefined();
    const record = (await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]!;
    expect(await missingMcp(config, record)).toEqual(["demo"]);
    const again = await installGlobalPlugin(config, url(SHA1));
    expect(again.status).toBe("installed");
    expect(await missingMcp(config, again.item)).toEqual([]);
    for (const workspaceId of ["ws_a", "ws_b"]) expect((await runtimeMcpMapForWorkspace(config, workspaceId)).demo).toBeDefined();
    expect(await readFile(skillPath(), "utf8")).toBe("Moja úprava.\n");
    // With the connection in place it stays an ordinary repeated install.
    expect((await installGlobalPlugin(config, url(SHA1))).status).toBe("already_installed");
  });

  test("#441: opätovná inštalácia po odstránenom pripojení ponechá vypnutého súrodenca vypnutého s jeho nastavením a nainštalovanú verziu", async () => {
    const SHA3 = "3".repeat(40), SHA4 = "4".repeat(40);
    const pair = (version: string) => ({
      "plugins/dvojica/.claude-plugin/plugin.json": JSON.stringify({ name: "dvojica", version, description: "Vymyslený plugin s dvoma pripojeniami" }),
      "plugins/dvojica/.mcp.json": JSON.stringify({ mcpServers: { alfa: { command: "node", args: ["scripts/run.mjs", "alfa"] }, beta: { command: "node", args: ["scripts/run.mjs", "beta"] } } }),
      "plugins/dvojica/scripts/run.mjs": `// runtime ${version}\n`,
      "plugins/dvojica/skills/dvojica/SKILL.md": `---\nname: dvojica\ndescription: Vymyslený skill\n---\nVerzia ${version}.\n`,
    });
    repo[SHA3] = pair("1.0.0");
    repo[SHA4] = pair("2.0.0");
    const pairUrl = (sha: string) => `https://github.com/${OWNER_REPO}/tree/${sha}/plugins/dvojica`;
    const config = serverConfig(root);
    await installGlobalPlugin(config, pairUrl(SHA3));
    // The lawyer adds a setting to beta, turns beta off and removes alfa in Settings › Integrations.
    const beta = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers?.beta;
    expect(beta).toBeDefined();
    await addMcp(config, "ws_a", "beta", { ...beta!, environment: { ADVOKAT_NASTAVENIE: "moje" } }, "global");
    await setMcpEnabled(config, "ws_a", "beta", false);
    expect(await removeMcp(config, "ws_a", "alfa")).toEqual(["global"]);
    const before = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers?.beta;
    if (!before) throw new Error("beta is missing");
    expect(before).toMatchObject({ environment: { ADVOKAT_NASTAVENIE: "moje" } });

    // The catalog now offers 2.0.0; the install button brings back alfa at the installed 1.0.0.
    const again = await installGlobalPlugin(config, pairUrl(SHA4));
    expect(again.status).toBe("installed");
    expect(again.item.lawossProvenance).toEqual({ source: { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: SHA3, dir: "plugins/dvojica" }, version: "1.0.0" });
    expect(await missingMcp(config, again.item)).toEqual([]);
    const after = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers ?? {};
    expect(after.beta).toEqual(before);
    for (const workspaceId of ["ws_a", "ws_b"]) {
      const mcp = await runtimeMcpMapForWorkspace(config, workspaceId);
      expect(mcp.alfa).toBeDefined();
      expect(mcp.alfa?.disabled).not.toBe(true);
      expect(mcp.beta?.disabled === true || mcp.beta?.enabled === false).toBe(true);
    }
    expect(await readFile(join(root, "config", "opencode", "skills", "dvojica-plugin", "dvojica", "SKILL.md"), "utf8")).toContain("Verzia 1.0.0.");
  });

  test("#441: aktualizácia ponechá nastavenie pripojení advokáta aj vypnuté pripojenie", async () => {
    const SHA3 = "3".repeat(40), SHA4 = "4".repeat(40);
    const twoMcp = (version: string, body: string) => ({
      ...pluginFiles(version, body),
      "plugins/demo/.mcp.json": JSON.stringify({ mcpServers: { demo: { command: "node", args: ["scripts/run.mjs", "mcp"] }, druhy: { command: "node", args: ["scripts/run.mjs", "druhy"] } } }),
    });
    repo[SHA3] = twoMcp("1.0.0", "Verzia jedna.");
    repo[SHA4] = twoMcp("1.1.0", "Verzia dva.");
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA3));
    const [first, second] = Object.keys(await runtimeMcpMapForWorkspace(config, "ws_a")).sort() as [string, string];
    // The lawyer saves their own setup on both connections and turns the second one off.
    const shared = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers ?? {};
    await addMcp(config, "ws_a", first, { ...shared[first], environment: { DEMO_TOKEN: "prve" } }, "global");
    await addMcp(config, "ws_a", second, { ...shared[second], environment: { DEMO_TOKEN: "druhe" } }, "global");
    await setMcpEnabled(config, "ws_a", second, false);

    const state = { lastCheckedAt: Date.now(), lastCheck: { status: "ok", release: { tag: "v0.4.0", sha: SHA4, publishedAt: null, source: "release", plugins: [{ name: "demo", version: "1.1.0", path: "plugins/demo" }] } } } as unknown as Parameters<typeof updateGlobalPlugin>[2];
    const updated = await updateGlobalPlugin(config, PLUGIN_ID, state, {});
    expect(updated.status).toBe("updated");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia dva.");
    const after = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers ?? {};
    expect(after[first]).toMatchObject({ environment: { DEMO_TOKEN: "prve" } });
    expect(after[first]?.disabled).not.toBe(true);
    expect(after[second]).toMatchObject({ disabled: true, environment: { DEMO_TOKEN: "druhe" } });
  });

  // #420, #421: katalóg dodáva runtime registra ako jeden zbalený súbor (slovlex 6,25 MB + 2,08 MB).
  test("pribalený runtime nad 1 MiB sa nainštaluje aj aktualizuje celý a nie je uložený v zázname inštalácie", async () => {
    const MIB = 1024 * 1024;
    const SHA3 = "3".repeat(40);
    const SHA4 = "4".repeat(40);
    const big = (version: string, size: number) => `// ${version}\n${"x".repeat(size - version.length - 4)}`;
    repo[SHA3] = { ...pluginFiles("1.0.0", "Verzia jedna."), "plugins/demo/dist/index.js": big("1.0.0", 6 * MIB), "plugins/demo/dist/pdf.worker.mjs": big("1.0.0", 2 * MIB) };
    repo[SHA4] = { ...pluginFiles("1.2.0", "Verzia dva."), "plugins/demo/dist/index.js": big("1.2.0", 6.5 * MIB), "plugins/demo/dist/pdf.worker.mjs": big("1.2.0", 2 * MIB) };
    const config = serverConfig(root);
    const resourceDir = join(root, "config", "opencode", "plugin-resources", "demo-plugin");
    const runtime = async (version: string) => {
      for (const digest of await readdir(resourceDir)) {
        const content = await readFile(join(resourceDir, digest, "dist", "index.js"), "utf8").catch(() => "");
        if (content.startsWith(`// ${version}\n`)) return { digest, bytes: Buffer.byteLength(content) };
      }
      return null;
    };
    const recordBytes = async () => JSON.stringify(await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).length;

    // #420: SHA3 nie je commit pribaleného katalógu; vyšší limit dostane len ako SHA vydania, ktoré zistila vlastná kontrola.
    const failure = await installGlobalPlugin(config, url(SHA3)).catch((error: unknown) => error);
    expect(failure).toMatchObject({ code: "unsupported_plugin_resources", message: "Plugin resource is binary or exceeds 1 MiB" });
    await updateUpdateState(marketplaceStatePath(config), (current) => ({
      ...current,
      lastCheckedAt: Date.now(),
      lastCheck: { status: "ok", release: { tag: "v0.3.0", sha: SHA3, publishedAt: null, source: "release", plugins: [{ name: "demo", version: "1.0.0", path: "plugins/demo" }] } },
    }));
    const installed = await installGlobalPlugin(config, url(SHA3));
    expect(installed.status).toBe("installed");
    expect(await runtime("1.0.0")).toMatchObject({ digest: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 6 * MIB });
    // Záznam inštalácie (configJson v runtime.sqlite) a odpoveď trasy nesú len cesty a hash, nie obsah.
    expect(JSON.stringify(installed.item).length).toBeLessThan(64 * 1024);
    expect(await recordBytes()).toBeLessThan(64 * 1024);

    const checked = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    if (checked.lastCheck?.status !== "ok") throw new Error("expected ok check");
    const state = { ...checked, lastCheck: { ...checked.lastCheck, release: { ...checked.lastCheck.release, sha: SHA4, plugins: [{ name: "demo", version: "1.2.0", path: "plugins/demo" }] } } };
    const updated = await updateGlobalPlugin(config, PLUGIN_ID, state, {});
    expect(updated.status).toBe("updated");
    expect(await runtime("1.2.0")).toMatchObject({ bytes: 6.5 * MIB });
    expect(await recordBytes()).toBeLessThan(64 * 1024);
  });

  // #441: the reinstall after a removed connection fetches the installed commit again. That commit passed the importer
  // under the higher limit when the app trusted it; after a newer release it is no longer the release commit, yet its
  // own bytes may be fetched again. Any other commit stays at 1 MiB.
  test("#441: opätovná inštalácia veľkého runtime z nainštalovaného commitu po novšom vydaní; iný commit ostane pri 1 MiB", async () => {
    const MIB = 1024 * 1024;
    const SHA5 = "5".repeat(40), SHA6 = "6".repeat(40), SHA7 = "7".repeat(40);
    const big = (version: string) => `// ${version}\n${"x".repeat(2 * MIB)}`;
    repo[SHA5] = { ...pluginFiles("1.0.0", "Verzia jedna."), "plugins/demo/dist/index.js": big("1.0.0") };
    repo[SHA6] = { ...pluginFiles("1.1.0", "Verzia dva."), "plugins/demo/dist/index.js": big("1.1.0") };
    repo[SHA7] = { ...pluginFiles("1.0.0", "Verzia jedna."), "plugins/demo/dist/index.js": big("fork") };
    const config = serverConfig(root);
    const release = (sha: string, version: string) => updateUpdateState(marketplaceStatePath(config), (current) => ({ ...current, lastCheckedAt: Date.now(),
      lastCheck: { status: "ok", release: { tag: `v${version}`, sha, publishedAt: null, source: "release", plugins: [{ name: "demo", version, path: "plugins/demo" }] } } }));
    await release(SHA5, "1.0.0");
    // A commit that is neither the release nor installed stays at 1 MiB.
    await expect(installGlobalPlugin(config, url(SHA7))).rejects.toMatchObject({ code: "unsupported_plugin_resources" });
    const first = await installGlobalPlugin(config, url(SHA5));
    expect(first.status).toBe("installed");
    // The record says the server trusted this commit (the release SHA its own check resolved).
    expect(first.item.lawossProvenance?.trustedRef).toBe(true);
    await release(SHA6, "1.1.0");
    expect(await removeMcp(config, "ws_a", "demo")).toEqual(["global"]);
    const again = await installGlobalPlugin(config, url(SHA6));
    expect(again.status).toBe("installed");
    expect(again.item.lawossProvenance?.source.ref).toBe(SHA5);
    expect(again.item.lawossProvenance?.trustedRef).toBe(true);
    expect(await missingMcp(config, again.item)).toEqual([]);

    // A record without the flag (an older install, or a commit that came only from a request URL) gets the generic
    // limits on reinstall: the large runtime is refused and nothing changes.
    await writeInstalledCloudPlugins(config, globalPluginTarget().recordId, (current) => {
      const plugin = current.plugins[PLUGIN_ID]!;
      const { trustedRef: _dropped, ...provenance } = plugin.lawossProvenance!;
      return { ...current, plugins: { ...current.plugins, [PLUGIN_ID]: { ...plugin, lawossProvenance: provenance } } };
    });
    expect(await removeMcp(config, "ws_a", "demo")).toEqual(["global"]);
    await expect(installGlobalPlugin(config, url(SHA6))).rejects.toMatchObject({ code: "unsupported_plugin_resources" });
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo).toBeUndefined();
  });

  test("#441: commit len z URL požiadavky sa v zázname neoznačí ako dôveryhodný", async () => {
    const config = serverConfig(root);
    const installed = await installGlobalPlugin(config, url(SHA1));
    expect(installed.item.lawossProvenance?.source.ref).toBe(SHA1);
    expect(installed.item.lawossProvenance?.trustedRef).toBeUndefined();
    const stored = (await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID];
    expect(stored?.lawossProvenance?.trustedRef).toBeUndefined();
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
    expect(availableUpdates(installed, state)).toEqual([{ pluginId: PLUGIN_ID, name: "demo", installed: "1.0.0", available: "1.1.0", path: "plugins/demo", source: "release", ref: SHA2 }]);

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
    expect(kept.item.lawossProvenance?.version).toBe("1.1.0");
    // Úprava ostáva rozpoznaná aj voči novej verzii.
    expect(await pluginFileChanges(globalPluginTarget(), kept.item)).toHaveLength(1);
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.disabled).toBe(true);
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
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]?.lawossProvenance?.version).toBe("1.0.0");
  });

  test("zlyhanie GitHubu pri aktualizácii nič nezmení", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    fake.failures.trees = true;
    await expect(updateGlobalPlugin(config, PLUGIN_ID, state, {})).rejects.toThrow();
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia jedna.");
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]?.lawossProvenance?.version).toBe("1.0.0");
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

  test("failed destination publication preserves edited workspace installation and supports explicit retry", async () => {
    const config = serverConfig(root);
    const bundle = await resolveClaudePluginBundle({ url: url(SHA1) });
    const workspaceRoot = join(root, "a"), target = workspaceTarget("ws_a", workspaceRoot);
    await installCloudPlugin({ serverConfig: config, workspaceId: "ws_a", workspaceRoot, marketplaceId: null, resolved: bundle.resolved, provenance: { source: bundle.preview.source, version: bundle.preview.version } });
    const path = ".opencode/skills/demo-plugin/demo/SKILL.md", legacySkill = join(workspaceRoot, path);
    const edited = "Synthetic user edit must survive a refused move.\n";
    await writeFile(legacySkill, edited);
    await setMcpEnabled(config, "ws_a", "demo", false);
    await addMcp(config, "ws_a", "unrelated", { type: "remote", url: "https://synthetic.invalid/mcp", disabled: false }, "global");
    const registryBefore = await readInstalledCloudPlugins(config, "ws_a");
    const workspaceBefore = await readRuntimeOpencodeConfig(config, "ws_a");
    const sharedBefore = await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID);
    const blocker = join(globalPluginTarget().root, "skills", "demo-plugin");
    await mkdir(join(globalPluginTarget().root, "skills"), { recursive: true });
    await writeFile(blocker, "Ordinary destination-parent blocker");
    await expect(moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), { [path]: "keep" })).rejects.toThrow();
    expect(await readFile(legacySkill, "utf8")).toBe(edited);
    expect(await readInstalledCloudPlugins(config, "ws_a")).toEqual(registryBefore);
    expect(await readRuntimeOpencodeConfig(config, "ws_a")).toEqual(workspaceBefore);
    expect(await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).toEqual(sharedBefore);
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]).toBeUndefined();
    expect(await readFile(blocker, "utf8")).toBe("Ordinary destination-parent blocker");
    await rm(blocker);
    const retry = await moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), { [path]: "keep" });
    expect(retry.status).toBe("moved");
    expect(await readFile(skillPath(), "utf8")).toBe(edited);
    await expect(readFile(legacySkill, "utf8")).rejects.toThrow();
    expect((await readInstalledCloudPlugins(config, "ws_a")).plugins[PLUGIN_ID]).toBeUndefined();
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]).toBeDefined();
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.disabled).toBe(true);
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).unrelated).toEqual({ type: "remote", url: "https://synthetic.invalid/mcp", disabled: false });
  });

  test("failed carried-edit backup preserves an existing global installation and the source", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const bundle = await resolveClaudePluginBundle({ url: url(SHA1) });
    const workspaceRoot = join(root, "a"), target = workspaceTarget("ws_a", workspaceRoot);
    await installCloudPlugin({ serverConfig: config, workspaceId: "ws_a", workspaceRoot, marketplaceId: null, resolved: bundle.resolved, provenance: { source: bundle.preview.source, version: bundle.preview.version } });
    const path = ".opencode/skills/demo-plugin/demo/SKILL.md", legacySkill = join(workspaceRoot, path);
    await writeFile(legacySkill, "Synthetic local edit\n");
    await writeFile(skillPath(), "Synthetic existing global edit\n");
    await setMcpEnabled(config, globalPluginTarget().recordId, "demo", false);
    const sharedBefore = await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID);
    const workspaceBefore = await readRuntimeOpencodeConfig(config, "ws_a");
    const globalBefore = await readInstalledCloudPlugins(config, globalPluginTarget().recordId);
    const blocker = join(globalPluginTarget().root, "lawoss-zalohy");
    await writeFile(blocker, "Ordinary backup-parent blocker");
    await expect(moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), { [path]: "keep" })).rejects.toThrow();
    expect(await readFile(legacySkill, "utf8")).toBe("Synthetic local edit\n");
    expect(await readFile(skillPath(), "utf8")).toBe("Synthetic existing global edit\n");
    expect(await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).toEqual(sharedBefore);
    expect(await readRuntimeOpencodeConfig(config, "ws_a")).toEqual(workspaceBefore);
    expect(await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).toEqual(globalBefore);
    expect((await readInstalledCloudPlugins(config, "ws_a")).plugins[PLUGIN_ID]).toBeDefined();
    await rm(blocker);
    const retried = await moveWorkspacePlugin(config, target, PLUGIN_ID, url(SHA1), { [path]: "keep" });
    if (retried.status !== "moved") throw new Error("Expected successful explicit retry");
    expect(await readFile(retried.backups[0]!, "utf8")).toBe("Synthetic local edit\n");
    expect(await readFile(skillPath(), "utf8")).toBe("Synthetic existing global edit\n");
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.disabled).toBe(true);
    expect((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID]).toEqual(globalBefore.plugins[PLUGIN_ID]);
    expect((await readInstalledCloudPlugins(config, "ws_a")).plugins[PLUGIN_ID]).toBeUndefined();
  });

  test("late failed move never publishes a disabled source connector as enabled", async () => {
    const originalFiles = repo[SHA1];
    const savedParent = join(root, "saved-destination-skills");
    const blocker = join(globalPluginTarget().root, "skills", "demo-plugin");
    let injected = false;
    let primaryFailure: { error: unknown } | undefined;
    try {
      repo[SHA1] = { ...originalFiles };
      for (let index = 0; index < 64; index++) repo[SHA1]![`plugins/demo/skills/padding-${index}/SKILL.md`] = `---\nname: padding-${index}\ndescription: Synthetic padding\n---\nFixture.\n`;
      const config = serverConfig(root), workspaceRoot = join(root, "a");
      const bundle = await resolveClaudePluginBundle({ url: url(SHA1) });
      await installCloudPlugin({ serverConfig: config, workspaceId: "ws_a", workspaceRoot, marketplaceId: null, resolved: bundle.resolved, provenance: { source: bundle.preview.source, version: bundle.preview.version } });
      const path = ".opencode/skills/demo-plugin/demo/SKILL.md", legacySkill = join(workspaceRoot, path);
      const edited = "Synthetic disabled connector move edit\n";
      await writeFile(legacySkill, edited);
      await setMcpEnabled(config, "ws_a", "demo", false);
      let settled = false;
      const moving = moveWorkspacePlugin(config, workspaceTarget("ws_a", workspaceRoot), PLUGIN_ID, url(SHA1), { [path]: "keep" })
        .then(() => ({ failed: false }), () => ({ failed: true })).finally(() => { settled = true; });
      const observedEnabled: unknown[] = [];
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline && !settled) {
        const global = (await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers?.demo;
        // Engine v2: a turned-off connector is `disabled: true`.
        if (global) observedEnabled.push(global.disabled !== true);
        const published = (await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[PLUGIN_ID];
        if (published && readFileSync(skillPath(), "utf8") !== edited) {
          renameSync(blocker, savedParent);
          writeFileSync(blocker, "Ordinary carried-edit parent blocker");
          injected = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
      const outcome = await moving;
      expect(injected).toBe(true); // Refuse a missed failure boundary rather than treating it as product evidence.
      expect(outcome.failed).toBe(true);
      expect(await readFile(legacySkill, "utf8")).toBe(edited);
      expect((await readRuntimeOpencodeConfig(config, "ws_a")).mcp?.servers?.demo?.disabled).toBe(true);
      expect((await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID)).mcp?.servers?.demo?.disabled).toBe(true);
      expect(observedEnabled.length).toBeGreaterThan(0);
      expect(observedEnabled.every((enabled) => enabled === false)).toBe(true);
      await rm(blocker); await rename(savedParent, blocker); injected = false;
      const retried = await moveWorkspacePlugin(config, workspaceTarget("ws_a", workspaceRoot), PLUGIN_ID, url(SHA1), { [path]: "keep" });
      expect(retried.status).toBe("moved");
      expect(await readFile(skillPath(), "utf8")).toBe(edited);
      expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.disabled).toBe(true);
    } catch (error) {
      primaryFailure = { error };
      throw error;
    } finally {
      try {
        if (injected) { await rm(blocker); await rename(savedParent, blocker); }
      } catch (cleanupError) {
        if (primaryFailure) throw new AggregateError([primaryFailure.error, cleanupError], "Move fixture and cleanup failed");
        throw cleanupError;
      } finally {
        repo[SHA1] = originalFiles;
      }
    }
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
  // #510: the app bundles a catalog pinned to a commit newer than the last marketplace release.
  const bundledCatalog = (version: string) => ({ ref: BUNDLED_MARKETPLACE_REF, plugins: [{ name: "demo", version, path: "plugins/demo" }] });
  const installedList = async (config: ServerConfig) => Object.values((await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins);

  test("#510: pribalený katalóg novší ako vydanie: aktualizácia z pribaleného commitu, vypnuté pripojenie ostane vypnuté", async () => {
    repo[BUNDLED_MARKETPLACE_REF] = pluginFiles("1.2.0", "Verzia z appky.");
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    expect(state.lastCheck).toMatchObject({ status: "ok", release: { sha: SHA2 } });
    const bundled = bundledCatalog("1.2.0");
    expect(availableUpdates(await installedList(config), state, bundled)).toEqual([
      { pluginId: PLUGIN_ID, name: "demo", installed: "1.0.0", available: "1.2.0", path: "plugins/demo", source: "bundled", ref: BUNDLED_MARKETPLACE_REF },
    ]);
    await setMcpEnabled(config, "ws_a", "demo", false);

    const updated = await updateGlobalPlugin(config, PLUGIN_ID, state, {}, new Date(), bundled);
    if (updated.status !== "updated") throw new Error("expected update");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia z appky.");
    expect(updated.item.lawossProvenance).toEqual({ source: { owner: "Omni-Legal-Products", repo: "lawoss-marketplace", ref: BUNDLED_MARKETPLACE_REF, dir: "plugins/demo" }, version: "1.2.0", trustedRef: true });
    expect((await runtimeMcpMapForWorkspace(config, "ws_b")).demo?.disabled).toBe(true);
    // Vydanie 1.1.0 je staršie ako nainštalovaná 1.2.0: nič ďalšie sa neponúkne.
    expect(availableUpdates([updated.item], state, bundled)).toEqual([]);
  });

  test("#510: novšie vydanie (aj pri rovnakej verzii) má prednosť pred pribaleným katalógom", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const state = await runMarketplaceCheck(marketplaceStatePath(config), "manual");
    const installed = await installedList(config);
    const fromRelease = [{ pluginId: PLUGIN_ID, name: "demo", installed: "1.0.0", available: "1.1.0", path: "plugins/demo", source: "release" as const, ref: SHA2 }];
    expect(availableUpdates(installed, state, bundledCatalog("1.0.5"))).toEqual(fromRelease);
    expect(availableUpdates(installed, state, bundledCatalog("1.1.0"))).toEqual(fromRelease);
    // Nečíselná verzia v pribalenom katalógu vydanie neprebije.
    expect(availableUpdates(installed, state, bundledCatalog("1.2.0-beta"))).toEqual(fromRelease);
    const updated = await updateGlobalPlugin(config, PLUGIN_ID, state, {}, new Date(), bundledCatalog("1.0.5"));
    if (updated.status !== "updated") throw new Error("expected update");
    expect(updated.item.lawossProvenance?.source.ref).toBe(SHA2);
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia dva.");
  });

  test("#510: rovnaká alebo staršia verzia v pribalenom katalógu nič neponúkne", async () => {
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    const installed = await installedList(config);
    const unchecked = await readUpdateState(marketplaceStatePath(config));
    expect(availableUpdates(installed, unchecked, bundledCatalog("1.0.0"))).toEqual([]);
    expect(availableUpdates(installed, unchecked, bundledCatalog("0.9.0"))).toEqual([]);
    await expect(updateGlobalPlugin(config, PLUGIN_ID, unchecked, {}, new Date(), bundledCatalog("1.0.0"))).rejects.toMatchObject({ code: "no_update" });
    const installedAgain = await installGlobalPlugin(config, url(SHA1), bundledCatalog("1.0.0"));
    expect(installedAgain.status).toBe("already_installed");
    expect(installedAgain.update).toBeUndefined();
  });

  test("#510: bez úspešnej kontroly vydaní (offline) sa aktualizuje z pribaleného katalógu; inštalácia povie, že je novšia verzia", async () => {
    repo[BUNDLED_MARKETPLACE_REF] = pluginFiles("1.2.0", "Verzia z appky.");
    const config = serverConfig(root);
    await installGlobalPlugin(config, url(SHA1));
    await updateUpdateState(marketplaceStatePath(config), (state) => ({ ...state, lastCheck: { status: "error", message: "offline" } }));
    const state = await readUpdateState(marketplaceStatePath(config));
    const bundled = bundledCatalog("1.2.0");
    const again = await installGlobalPlugin(config, url(SHA1), bundled);
    expect(again).toMatchObject({ status: "already_installed", update: { installed: "1.0.0", available: "1.2.0", source: "bundled" } });
    // Inštalácia nainštalovanú verziu nemení; to robí len aktualizácia.
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia jedna.");
    const updated = await updateGlobalPlugin(config, PLUGIN_ID, state, {}, new Date(), bundled);
    expect(updated.status).toBe("updated");
    expect(await readFile(skillPath(), "utf8")).toContain("Verzia z appky.");
  });
});
