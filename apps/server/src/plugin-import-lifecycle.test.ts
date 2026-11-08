import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { zipSync, strToU8 } from "fflate";
import { resolvePluginImports, discoverPluginImports, parsePluginImportRequest } from "./plugin-imports.js";
import { preparePluginImport, reviewedPluginImport, assertImportable } from "./plugin-import-checks.js";
import { installPluginImport, rollbackPluginImport } from "./plugin-import-install.js";
import { readInstalledCloudPlugins, resolveWorkspaceInstallPath } from "./cloud-plugins.js";
import type { ServerConfig } from "./types.js";

const skill = "---\nname: review\ndescription: Review documents\n---\nRead references/checklist.md.\n";
const schema = "https://agent-plugins.org/schemas/1.0.0/plugin.schema.json";
async function files(root: string, entries: Record<string, string>) { for (const [path, content] of Object.entries(entries)) { await mkdir(dirname(join(root, path)), { recursive: true }); await writeFile(join(root, path), content); } }
async function fixture(run: (root: string, config: ServerConfig) => Promise<void>) {
  const root = await mkdtemp(join(tmpdir(), "legalwork-import-lifecycle-"));
  const previous = { discovery: process.env.LEGALWORK_PLUGIN_DISCOVERY_HOME, claude: process.env.CLAUDE_CONFIG_DIR, db: process.env.LEGALWORK_RUNTIME_DB, xdg: process.env.XDG_CONFIG_HOME };
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite"); process.env.XDG_CONFIG_HOME = join(root, "global");
  process.env.LEGALWORK_PLUGIN_DISCOVERY_HOME = join(root, "home"); process.env.CLAUDE_CONFIG_DIR = join(root, "home/.claude");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "owner", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [], workspaces: [{ id: "test", name: "Test", path: root, preset: "starter", workspaceType: "local" }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
  try { await run(root, config); }
  finally { if (previous.discovery === undefined) delete process.env.LEGALWORK_PLUGIN_DISCOVERY_HOME; else process.env.LEGALWORK_PLUGIN_DISCOVERY_HOME = previous.discovery; if (previous.claude === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = previous.claude; if (previous.db === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previous.db; if (previous.xdg === undefined) delete process.env.XDG_CONFIG_HOME; else process.env.XDG_CONFIG_HOME = previous.xdg; await rm(root, { recursive: true, force: true }); }
}
async function plan(path: string, root: string) { const [value] = await resolvePluginImports({ source: { provider: "claude", path }, scope: "project" }, root); if (!value) throw new Error("No import plan"); return value; }

test("different publishers with the same name have independent identity while source edits retain identity", () => fixture(async root => {
  for (const folder of ["first", "second"]) await files(join(root, folder), { ".claude-plugin/plugin.json": '{"name":"review"}', "skills/review/SKILL.md": skill });
  const first = await plan(join(root, "first"), root); const second = await plan(join(root, "second"), root);
  const target = { workspace: root, scope: "project", current: {} } satisfies Parameters<typeof preparePluginImport>[1];
  const firstReview = await preparePluginImport(first, target); const secondReview = await preparePluginImport(second, target);
  expect(secondReview.preview.id).toBe(second.preview.id);
  expect(secondReview.preview.validationId).not.toBe(firstReview.preview.validationId);
  expect(() => reviewedPluginImport(second, target, firstReview.preview.validationId)).toThrow("review");
  expect(first.preview.id).not.toBe(second.preview.id);
  await writeFile(join(root, "first/skills/review/SKILL.md"), `${skill}\nUpdated.`);
  const changed = await plan(join(root, "first"), root);
  expect(changed.preview.id).toBe(first.preview.id); expect(changed.preview.digest).not.toBe(first.preview.digest);
}));

test("required dependencies and registered cloud apps cannot be installed as working plugins", () => fixture(async (root, config) => {
  const source = join(root, "dependency");
  await files(source, { ".claude-plugin/plugin.json": '{"name":"review","dependencies":[{"name":"missing","version":"^2.0.0"}]}', "skills/review/SKILL.md": skill });
  const pending = await preparePluginImport(await plan(source, root), { workspace: root, scope: "project", current: {}, available: [] });
  expect(pending.preview.readiness).toBe("unsupported"); expect(() => assertImportable(pending, true)).toThrow("missing");
  await expect(installPluginImport(config, "test", root, pending, false)).rejects.toThrow("missing");
  const available = { pluginId: "dependency", name: "missing", marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null, provenance: { provider: "claude", kind: "folder", location: source, root: "", digest: "source", version: "2.1.0" } } satisfies Parameters<typeof preparePluginImport>[1]["installed"];
  const checked = await preparePluginImport(await plan(source, root), { workspace: root, scope: "project", current: {}, available: [available] });
  expect(checked.preview.readiness).toBe("ready"); expect(checked.preview.requirements?.[0]?.status).toBe("satisfied");
  const app = { source: { provider: "chatgpt", zipBase64: Buffer.from(zipSync({ ".codex-plugin/plugin.json": strToU8('{"name":"app","apps":"./.app.json"}'), ".app.json": strToU8('{"apps":{"github":"plugin_asdk_app_example"}}'), "skills/review/SKILL.md": strToU8(skill) })).toString("base64") }, scope: "project" } satisfies Parameters<typeof resolvePluginImports>[0];
  const [appPlan] = await resolvePluginImports(app, root);
  expect(appPlan?.preview.readiness).toBe("unsupported"); expect(appPlan?.preview.requirements?.[0]?.kind).toBe("app");
}));

test("portable schema validation rejects unknown versions and isolates invalid connector documents", () => fixture(async root => {
  const source = join(root, "portable");
  await files(source, { "plugin.json": JSON.stringify({ $schema: schema.replace("1.0.0", "999.0.0"), name: "review" }), "skills/review/SKILL.md": skill });
  await expect(plan(source, root)).rejects.toThrow("unsupported schema");
  await writeFile(join(source, "plugin.json"), JSON.stringify({ $schema: schema, name: "review" }));
  await files(source, { "mcp.json": '{"mcpServers":{}}' });
  const checked = await plan(source, root);
  expect(checked.preview.components.map(item => item.type)).toEqual(["skill"]); expect(checked.preview.readiness).toBe("partial");
  expect(() => assertImportable(checked)).toThrow("confirm"); expect(() => assertImportable(checked, true)).not.toThrow();
}));

test("discovery skips trash, resolves canonical skill links and reports disabled install state", () => fixture(async root => {
  const home = join(root, "home"); const source = join(root, "canonical");
  await files(source, { "SKILL.md": skill }); await mkdir(join(home, ".claude/skills"), { recursive: true }); await symlink(source, join(home, ".claude/skills/review"));
  await files(join(home, ".claude/plugins/.trash/old"), { ".claude-plugin/plugin.json": '{"name":"removed"}' });
  const plugin = join(home, ".claude/plugins/cache/team/review/1");
  await files(plugin, { ".claude-plugin/plugin.json": '{"name":"review"}', "skills/review/SKILL.md": skill });
  await files(join(home, ".claude"), { "plugins/installed_plugins.json": JSON.stringify({ plugins: { "review@team": [{ installPath: plugin }] } }), "settings.json": '{"enabledPlugins":{"review@team":false}}' });
  const cached = join(home, ".claude/plugins/cache/other/review/1");
  await files(cached, { ".claude-plugin/plugin.json": '{"name":"review"}', "skills/review/SKILL.md": skill });
  await files(join(home, ".claude/plugins/cache/synced/synced-plugin/1"), { ".claude-plugin/plugin.json": '{"name":"synced-plugin"}', "skills/review/SKILL.md": skill });
  const items = await discoverPluginImports("claude", root);
  expect(items.find(item => item.path === cached)?.state).toBe("available");
  expect(items.find(item => item.name === "synced-plugin")?.state).toBe("synced");
  expect(items.some(item => item.name === "removed")).toBe(false); const canonical = await realpath(source); expect(items.some(item => item.path === canonical)).toBe(true);
  expect(items.find(item => item.path === plugin)?.state).toBe("disabled");
}));

test("discovery hides unusable packages and bundled connectors while retaining usable parts for both providers", () => fixture(async root => {
  for (const provider of ["chatgpt", "claude"] satisfies Array<"chatgpt" | "claude">) {
    const plugins = join(root, provider === "chatgpt" ? ".agents/plugins" : ".claude/plugins");
    const manifest = provider === "chatgpt" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json";
    await files(join(plugins, "contacts"), { [manifest]: '{"name":"contacts","apps":"./.app.json"}', ".app.json": '{"apps":{"contacts":"app_google_contacts"}}' });
    await files(join(plugins, "empty"), { [manifest]: '{"name":"empty"}', "README.md": "No runnable components." });
    await files(join(plugins, "unsupported"), { [manifest]: '{"name":"unsupported"}', ".mcp.json": '{"mcpServers":{"private":{"type":"sdk"}}}' });
    await files(join(plugins, "mixed"), { [manifest]: '{"name":"mixed"}', "skills/review/SKILL.md": skill, ".mcp.json": '{"mcpServers":{"private":{"type":"sdk"},"search":{"url":"https://search.example/mcp"}}}' });
    await files(join(plugins, "custom"), { [manifest]: '{"name":"custom","skills":"./custom-skills/"}', "custom-skills/review/SKILL.md": skill });
    const items = await discoverPluginImports(provider, root);
    const own = items.filter(item => item.path.startsWith(plugins));
    expect(own.filter(item => item.kind === "plugin").map(item => item.name).sort()).toEqual(["custom", "mixed"]);
    expect(own.filter(item => item.kind === "connector").map(item => item.name)).toEqual(["search"]);
    expect((await resolvePluginImports({ source: { provider, path: join(plugins, "mixed") }, scope: "project" }, root))[0]?.preview.readiness).toBe("partial");
  }
}));

test("Cowork plugin archives accept their native file extension", () => fixture(async root => {
  const path = join(root, "review.plugin");
  await writeFile(path, zipSync({ ".claude-plugin/plugin.json": strToU8('{"name":"review"}'), "skills/review/SKILL.md": strToU8(skill) }));
  expect((await plan(path, root)).preview.components).toHaveLength(1);
}));

test("generic file imports detect each package format and retain its provider identity", () => fixture(async root => {
  const entries = {
    "claude/.claude-plugin/plugin.json": '{"name":"review-claude"}',
    "claude/skills/review/SKILL.md": skill,
    "codex/.codex-plugin/plugin.json": '{"name":"review-codex"}',
    "codex/skills/review/SKILL.md": skill,
  };
  await files(root, entries);
  const source = { provider: "claude", zipBase64: Buffer.from(zipSync(Object.fromEntries(Object.entries(entries).map(([path, content]) => [path, strToU8(content)])))).toString("base64") };
  const request = parsePluginImportRequest({ source, scope: "global", detectFormat: true });
  const previews = (await resolvePluginImports(request, root)).map(plan => plan.preview);
  expect(previews.map(item => item.provenance?.provider)).toEqual(["claude", "chatgpt"]);
  expect(previews.map(item => item.format)).toEqual(["claude", "codex"]);
  expect(previews[1]?.id).toMatch(/^import:chatgpt:/);
}));

test("large document collections cannot bypass discovery compatibility checks", () => fixture(async root => {
  const plugins = join(root, ".agents/plugins");
  const documents = Object.fromEntries(Array.from({ length: 80 }, (_, index) => [`skills/review/references/${index}.md`, "Reference"]));
  await files(join(plugins, "portable"), { ".codex-plugin/plugin.json": '{"name":"portable"}', "skills/review/SKILL.md": skill, ...documents });
  await files(join(plugins, "hosted-only"), { ".codex-plugin/plugin.json": '{"name":"hosted-only","apps":"./.app.json"}', ".app.json": '{"apps":{"contacts":"app_contacts"}}', "skills/review/SKILL.md": skill, ...documents });
  await files(join(plugins, "malformed"), { ".codex-plugin/plugin.json": '{"name":"malformed","skills":"missing"}' });
  const items = (await discoverPluginImports("chatgpt", root)).filter(item => item.path.startsWith(plugins));
  expect(items.map(item => item.name)).toEqual(["portable"]);
}));

test("tracked updates preserve history and can restore complete files without overwriting local edits", () => fixture(async (root, config) => {
  const source = join(root, "source");
  await files(source, { ".claude-plugin/plugin.json": '{"name":"review","version":"1.0.0"}', "skills/review/SKILL.md": skill, "skills/review/references/checklist.md": "Version one" });
  const firstPlan = await plan(source, root);
  const first = await installPluginImport(config, "test", root, firstPlan, false);
  const data = resolveWorkspaceInstallPath(root, `${firstPlan.dataPaths![0]}/session.json`);
  await writeFile(data, "persistent user data");
  expect(first.history?.[0]?.action).toBe("installed");
  await files(source, { ".claude-plugin/plugin.json": '{"name":"review","version":"2.0.0"}', "skills/review/references/checklist.md": "Version two" });
  const second = await installPluginImport(config, "test", root, await plan(source, root), false);
  expect(second.snapshots).toHaveLength(1); expect(second.history?.map(item => item.action)).toEqual(["installed", "updated"]);
  const installedSkill = second.files.find(item => item.objectType === "skill"); if (!installedSkill) throw new Error("Missing skill");
  const reference = resolveWorkspaceInstallPath(root, `${dirname(installedSkill.path)}/references/checklist.md`);
  expect(await readFile(reference, "utf8")).toBe("Version two");
  await writeFile(reference, "Local changes");
  await expect(rollbackPluginImport(config, "test", root, second.pluginId, false)).rejects.toThrow("local changes");
  expect(await readFile(reference, "utf8")).toBe("Local changes");
  await writeFile(reference, "Version two");
  // A damaged backup must leave the entire current installation intact.
  const snapshotFile = resolveWorkspaceInstallPath(root, `${second.snapshots![0]}/snapshot.json`);
  const snapshotText = await readFile(snapshotFile, "utf8");
  const snapshot: { locations: Array<{ location: string; backup: string | null }> } = JSON.parse(snapshotText);
  snapshot.locations[1].backup = `${second.snapshots![0]}/missing`;
  await writeFile(snapshotFile, JSON.stringify(snapshot));
  await expect(rollbackPluginImport(config, "test", root, second.pluginId, false)).rejects.toThrow();
  expect(await readFile(reference, "utf8")).toBe("Version two");
  expect((await readInstalledCloudPlugins(config, "test")).plugins[first.pluginId]?.provenance?.version).toBe("2.0.0");
  await writeFile(snapshotFile, snapshotText);
  const restored = await rollbackPluginImport(config, "test", root, second.pluginId, false);
  expect(await readFile(data, "utf8")).toBe("persistent user data");
  expect(await readFile(reference, "utf8")).toBe("Version one"); expect(restored.provenance?.version).toBe("1.0.0");
  expect((await readInstalledCloudPlugins(config, "test")).plugins[first.pluginId]?.history?.at(-1)?.action).toBe("rolled_back");
}));

test("review tokens bind dependency state even for skill-only packages", () => fixture(async root => {
  const source = join(root, "source"); await files(source, { ".claude-plugin/plugin.json": '{"name":"review"}', "skills/review/SKILL.md": skill });
  const pending = await plan(source, root); const target = { workspace: root, scope: "project", current: {} } satisfies Parameters<typeof preparePluginImport>[1];
  expect(() => reviewedPluginImport(pending, target)).toThrow("review expired");
  const checked = await preparePluginImport(pending, target);
  expect(reviewedPluginImport(pending, target, checked.preview.validationId).preview.readiness).toBe("ready");
}));


test("portable connectors isolate invalid entries and reserve persistent environment variables", () => fixture(async root => {
  const source = join(root, "portable");
  await files(source, { "plugin.json": JSON.stringify({ $schema: schema, name: "review.tools", author: { email: "team@example.com" }, extensions: false }), "skills/review/SKILL.md": skill, "mcp.json": JSON.stringify({ $schema: schema.replace("plugin.schema", "mcp.schema"), mcpServers: { valid: { type: "stdio", command: "node", args: ["${PLUGIN_ROOT}/run.js"], cwd: "${PLUGIN_DATA}" }, invalid: { type: "stdio", command: "node", env: { PLUGIN_ROOT: "/other" } }, badArgs: { type: "stdio", command: "node", args: "run.js" }, notObject: true, sse: { type: "sse", url: "https://example.com/sse" } } }) });
  const checked = await plan(source, root);
  expect(checked.preview.components.filter(item => item.type === "mcp").map(item => item.name)).toEqual(["valid"]);
  expect(checked.preview.connectors?.filter(item => item.status === "blocked")).toHaveLength(4);
  const config = checked.connectorConfigs?.[checked.preview.components.find(item => item.type === "mcp")!.installedName];
  expect(config?.env).toMatchObject({ PLUGIN_ROOT: expect.stringContaining("imported-plugins"), PLUGIN_DATA: expect.stringContaining("plugin-data") });
}));


test("real bundled manifest shapes allow absent optional skills directories and expose unsupported source hosts", () => fixture(async root => {
  const source = join(root, "host-plugin");
  await files(source, { ".codex-plugin/plugin.json": JSON.stringify({ name: "host-plugin", skills: "./skills/", mcpServers: "./.mcp.json" }), ".mcp.json": JSON.stringify({ mcpServers: { desktop: { command: "node", args: ["server.mjs"], env_vars: ["CODEX_APP_TOOLS_PIPE_PATH"] } } }) });
  const [checked] = await resolvePluginImports({ source: { provider: "chatgpt", path: source }, scope: "project" }, root);
  expect(checked?.preview.readiness).toBe("unsupported");
  expect(checked?.preview.connectors?.[0]).toMatchObject({ status: "blocked", code: "source_runtime" });
  expect(checked?.preview.components).toEqual([]);
}));

test("connector tool approval rules are blocked before normalization can widen access", () => fixture(async root => {
  const source = join(root, "policy-plugin");
  await files(source, { ".claude-plugin/plugin.json": '{"name":"policy-plugin"}', ".mcp.json": JSON.stringify({ mcpServers: { restricted: { url: "https://example.com/mcp", enabled_tools: ["read"] }, approvals: { url: "https://example.com/mcp", tools: { write: { approval_mode: "prompt" } } } } }) });
  const checked = await plan(source, root);
  expect(checked.preview.connectors?.every(item => item.status === "blocked" && item.code === "tool_policy")).toBe(true);
  expect(checked.preview.readiness).toBe("unsupported");
}));

test("source-app setup commands and private artifact runtimes never appear ready", () => fixture(async root => {
  const source = join(root, "runtime-plugin");
  await files(source, { ".claude-plugin/plugin.json": '{"name":"runtime-plugin"}', "commands/setup.md": "---\ndescription: Configure the original app\n---\nRun `claude mcp add --transport http service https://example.com/mcp`.", "skills/deck/SKILL.md": "---\nname: deck\ndescription: Create slides\n---\nAuthor with `@oai/artifact-tool`." });
  const checked = await plan(source, root);
  expect(checked.preview.requirements?.map(item => item.code).sort()).toEqual(["source_app_setup", "source_runtime"]);
  expect(checked.preview.readiness).toBe("unsupported");
  expect(() => assertImportable(checked, true)).toThrow();
}));
