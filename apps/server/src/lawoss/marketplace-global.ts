/**
 * LAWOSS: pluginy z LAWOSS Marketplace nainštalované raz pre advokáta (rozhodnutie MČ 5. 10. 2026,
 * ADR 0015 body 4, 5 a 7).
 *
 * - Inštalácia ide cez upstream importér (`resolveClaudePluginBundle` + `installCloudPlugin`)
 *   s globálnym cieľom (`plugin-install-target.ts`): skilly v globálnom priečinku OpenCode,
 *   MCP v spoločnom riadku, záznam pôvodu pod `GLOBAL_PLUGIN_RECORD_ID`.
 * - Doterajšie inštalácie do jedného priečinka ostávajú funkčné. Presun je výslovná akcia:
 *   najprv sa stiahne balík (pri chybe sa nič nezmení), potom sa podľa voľby advokáta zálohujú
 *   alebo prenesú jeho úpravy, odstráni sa kópia v priečinku a plugin sa nainštaluje globálne.
 * - Aktualizácia porovná SHA-256 súborov so záznamom pôvodu. Upravený alebo odstránený súbor
 *   bez rozhodnutia advokáta vráti `needs_decision`; nič sa neprepíše bez opýtania.
 *   Voľby: `keep` (ponechať moju úpravu), `replace` (prevziať novú verziu), `backup`
 *   (prevziať novú a moju úpravu uložiť bokom do `lawoss-zalohy/`).
 * - Vypnuté MCP ostane po aktualizácii alebo presune vypnuté.
 */
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import { resolveClaudePluginBundle, type ClaudePluginBundle } from "../claude-plugin-bundle.js";
import { installCloudPlugin, readInstalledCloudPlugins, removeCloudPlugin, type CloudImportedPlugin } from "../cloud-plugins.js";
import { ApiError } from "../errors.js";
import { addMcp, setMcpEnabled } from "../mcp.js";
import { GLOBAL_MCP_ID, readRuntimeOpencodeConfig, runtimeMcpMap } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { contentSha256 } from "./plugin-provenance.js";
import { globalPluginTarget, installLocation, type PluginInstallTarget } from "./plugin-install-target.js";
import { MARKETPLACE_OWNER, MARKETPLACE_REPO, marketplacePluginUrl, type MarketplaceUpdateState } from "./marketplace-updates.js";

export type FileResolution = "keep" | "replace" | "backup";
export type FileChange = { path: string; title: string; state: "modified" | "missing" };
export type PluginUpdate = { pluginId: string; name: string; installed: string | null; available: string; path: string };

const MCP_PATH_PREFIX = "opencode.jsonc#mcp.";
const MARKETPLACE_ID_PREFIX = `github:${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}#`;
const PLUGIN_URL = new RegExp(`^https://github\\.com/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/tree/[a-f0-9]{40}/plugins/[a-z0-9-]+$`);

export function isMarketplacePlugin(plugin: Pick<CloudImportedPlugin, "pluginId">): boolean {
  return plugin.pluginId.startsWith(MARKETPLACE_ID_PREFIX);
}

/** Globálne sa inštaluje len z LAWOSS Marketplace, z pripnutého commitu. */
export function assertMarketplaceUrl(url: string): void {
  if (!PLUGIN_URL.test(url)) throw new ApiError(400, "invalid_marketplace_url", "Only LAWOSS Marketplace plugins pinned to a commit can be installed for all clients.");
}

export function workspaceTarget(workspaceId: string, root: string): PluginInstallTarget {
  return { recordId: workspaceId, root, global: false };
}

function mcpNames(plugin: CloudImportedPlugin): string[] {
  return plugin.files.flatMap((file) => (file.objectType === "mcp" && file.path.startsWith(MCP_PATH_PREFIX) ? [file.path.slice(MCP_PATH_PREFIX.length)] : []));
}

async function readText(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch {
    return null;
  }
}

/** Súbory, ktoré advokát po inštalácii upravil alebo odstránil (porovnanie SHA-256 so záznamom). */
export async function pluginFileChanges(target: PluginInstallTarget, plugin: CloudImportedPlugin): Promise<FileChange[]> {
  const changes: FileChange[] = [];
  for (const file of plugin.files) {
    if (!file.contentSha256 || !file.path.startsWith(".opencode/")) continue;
    const content = await readText(installLocation(target.root, file.path, target.global));
    if (content === null) changes.push({ path: file.path, title: file.title, state: "missing" });
    else if (contentSha256(content) !== file.contentSha256) changes.push({ path: file.path, title: file.title, state: "modified" });
  }
  return changes;
}

export async function listInstalled(config: ServerConfig, recordId: string): Promise<CloudImportedPlugin[]> {
  return Object.values((await readInstalledCloudPlugins(config, recordId)).plugins);
}

/** Dostupné aktualizácie globálnych pluginov podľa posledného vydania marketplace (bez siete). */
export function availableUpdates(plugins: readonly CloudImportedPlugin[], state: MarketplaceUpdateState): PluginUpdate[] {
  if (state.lastCheck?.status !== "ok") return [];
  const release = state.lastCheck.release;
  return plugins.flatMap((plugin) => {
    if (!isMarketplacePlugin(plugin)) return [];
    const dir = plugin.provenance?.source.dir ?? plugin.pluginId.slice(MARKETPLACE_ID_PREFIX.length);
    const next = release.plugins.find((item) => item.path === dir);
    if (!next || next.version === (plugin.provenance?.version ?? null)) return [];
    return [{ pluginId: plugin.pluginId, name: plugin.name, installed: plugin.provenance?.version ?? null, available: next.version, path: next.path }];
  });
}

function backupName(path: string): string {
  const name = basename(path);
  const extension = extname(name);
  return `${extension ? name.slice(0, -extension.length) : name}.moja-uprava${extension}`;
}

/** Úpravu advokáta uloží bokom do `lawoss-zalohy/<čas>/…` v globálnom priečinku (mimo priečinkov skillov). */
async function backupFiles(source: PluginInstallTarget, paths: readonly string[], stamp: string): Promise<string[]> {
  const root = join(globalPluginTarget().root, "lawoss-zalohy", stamp);
  const saved: string[] = [];
  for (const path of paths) {
    const from = installLocation(source.root, path, source.global);
    const relative = path.slice(".opencode/".length);
    const to = join(root, dirname(relative), backupName(relative));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(from, to).then(() => saved.push(to)).catch(() => undefined);
  }
  return saved;
}

function unresolved(changes: readonly FileChange[], resolutions: Readonly<Record<string, FileResolution>>): FileChange[] {
  return changes.filter((change) => !resolutions[change.path]);
}

function provenanceOf(bundle: ClaudePluginBundle) {
  return { source: bundle.preview.source, version: bundle.preview.version };
}

/** `enabled: false` MCP z daného riadku, aby ho reinštalácia znova nezapla. */
async function disabledMcp(config: ServerConfig, rowId: string, names: readonly string[]): Promise<string[]> {
  const map = runtimeMcpMap(await readRuntimeOpencodeConfig(config, rowId));
  return names.filter((name) => map[name]?.enabled === false);
}

async function restoreDisabled(config: ServerConfig, names: readonly string[]): Promise<void> {
  const target = globalPluginTarget();
  for (const name of names) await setMcpEnabled(config, target.recordId, name, false).catch(() => false);
}

async function installGlobal(config: ServerConfig, bundle: ClaudePluginBundle, preserve?: ReadonlySet<string>): Promise<CloudImportedPlugin> {
  const target = globalPluginTarget();
  return installCloudPlugin({
    serverConfig: config,
    workspaceId: target.recordId,
    workspaceRoot: target.root,
    marketplaceId: null,
    resolved: bundle.resolved,
    provenance: provenanceOf(bundle),
    global: true,
    preserve,
  });
}

export type InstallOutcome = { status: "installed" | "already_installed"; item: CloudImportedPlugin };

/**
 * Nová globálna inštalácia z LAWOSS Marketplace. Už nainštalovaný plugin sa tu nemení
 * (ani neprepíše, ani nevráti na staršiu verziu); mení ho len `updateGlobalPlugin`.
 */
export async function installGlobalPlugin(config: ServerConfig, url: string): Promise<InstallOutcome> {
  assertMarketplaceUrl(url);
  const pluginId = `${MARKETPLACE_ID_PREFIX}${url.replace(/^.*\/tree\/[a-f0-9]{40}\//, "")}`;
  const existing = (await readInstalledCloudPlugins(config, globalPluginTarget().recordId)).plugins[pluginId];
  if (existing) return { status: "already_installed", item: existing };
  return { status: "installed", item: await installGlobal(config, await resolveClaudePluginBundle({ url })) };
}

export type UpdateOutcome =
  | { status: "needs_decision"; changes: FileChange[] }
  | { status: "updated"; item: CloudImportedPlugin; backups: string[]; kept: string[] };

/** Aktualizácia globálneho pluginu na verziu z posledného vydania marketplace. */
export async function updateGlobalPlugin(
  config: ServerConfig,
  pluginId: string,
  state: MarketplaceUpdateState,
  resolutions: Readonly<Record<string, FileResolution>>,
  now: Date = new Date(),
): Promise<UpdateOutcome> {
  const target = globalPluginTarget();
  const installed = (await readInstalledCloudPlugins(config, target.recordId)).plugins[pluginId];
  if (!installed) throw new ApiError(404, "plugin_not_installed", "This plugin is not installed for all clients.");
  const update = availableUpdates([installed], state)[0];
  if (!update || state.lastCheck?.status !== "ok") throw new ApiError(409, "no_update", "No update is available for this plugin. Check for updates first.");
  const changes = await pluginFileChanges(target, installed);
  if (unresolved(changes, resolutions).length) return { status: "needs_decision", changes };
  // Sieť (GitHub) pred akoukoľvek zmenou na disku: pri chybe ostane všetko, ako bolo.
  const bundle = await resolveClaudePluginBundle({ url: marketplacePluginUrl(state.lastCheck.release.sha, update.path) });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backups = await backupFiles(target, changes.filter((change) => change.state === "modified" && resolutions[change.path] === "backup").map((change) => change.path), stamp);
  const kept = changes.filter((change) => resolutions[change.path] === "keep").map((change) => change.path);
  const disabled = await disabledMcp(config, GLOBAL_MCP_ID, mcpNames(installed));
  const item = await installGlobal(config, bundle, new Set(kept));
  await restoreDisabled(config, disabled);
  return { status: "updated", item, backups, kept };
}

/** Odinštalovanie globálneho pluginu. Upravené súbory bez rozhodnutia nevymaže (`needs_decision`). */
export async function removeGlobalPlugin(
  config: ServerConfig,
  pluginId: string,
  resolutions: Readonly<Record<string, FileResolution>>,
  now: Date = new Date(),
): Promise<{ status: "removed"; item: CloudImportedPlugin; backups: string[] } | { status: "needs_decision"; changes: FileChange[] }> {
  const target = globalPluginTarget();
  const installed = (await readInstalledCloudPlugins(config, target.recordId)).plugins[pluginId];
  if (!installed) throw new ApiError(404, "plugin_not_installed", "This plugin is not installed for all clients.");
  const changes = (await pluginFileChanges(target, installed)).filter((change) => change.state === "modified");
  if (unresolved(changes, resolutions).length) return { status: "needs_decision", changes };
  const backups = await backupFiles(target, changes.filter((change) => resolutions[change.path] !== "replace").map((change) => change.path), now.toISOString().replace(/[:.]/g, "-"));
  const item = await removeCloudPlugin({ serverConfig: config, workspaceId: target.recordId, workspaceRoot: target.root, pluginId, global: true });
  return { status: "removed", item, backups };
}

export type MoveOutcome =
  | { status: "needs_decision"; changes: FileChange[] }
  | { status: "moved"; item: CloudImportedPlugin; backups: string[]; carried: string[] };

/**
 * Presun inštalácie z jedného priečinka (doterajší spôsob) na všetkých klientov. Voľby pri
 * upravenom súbore: `keep` prenesie úpravu do globálneho súboru, `backup` ju uloží bokom,
 * `replace` použije verziu z marketplace.
 */
export async function moveWorkspacePlugin(
  config: ServerConfig,
  workspace: PluginInstallTarget,
  pluginId: string,
  url: string,
  resolutions: Readonly<Record<string, FileResolution>>,
  now: Date = new Date(),
): Promise<MoveOutcome> {
  assertMarketplaceUrl(url);
  const legacy = (await readInstalledCloudPlugins(config, workspace.recordId)).plugins[pluginId];
  if (!legacy) throw new ApiError(404, "plugin_not_installed", "This plugin is not installed in this folder.");
  const changes = (await pluginFileChanges(workspace, legacy)).filter((change) => change.state === "modified");
  if (unresolved(changes, resolutions).length) return { status: "needs_decision", changes };

  const target = globalPluginTarget();
  const existing = (await readInstalledCloudPlugins(config, target.recordId)).plugins[pluginId];
  // Sieť len vtedy, keď plugin pre všetkých klientov ešte nie je; pri chybe sa nič nezmení.
  const bundle = existing ? null : await resolveClaudePluginBundle({ url });
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const backups = await backupFiles(workspace, changes.filter((change) => resolutions[change.path] === "backup").map((change) => change.path), stamp);
  const carriedContent = new Map<string, string>();
  for (const change of changes.filter((item) => resolutions[item.path] === "keep")) {
    const content = await readText(installLocation(workspace.root, change.path, false));
    if (content !== null) carriedContent.set(change.path, content);
  }

  const names = mcpNames(legacy);
  const sharedBefore = runtimeMcpMap(await readRuntimeOpencodeConfig(config, GLOBAL_MCP_ID));
  const disabled = [...await disabledMcp(config, workspace.recordId, names), ...await disabledMcp(config, GLOBAL_MCP_ID, names)];
  // removeCloudPlugin ruší MCP v oboch riadkoch; spoločné záznamy iných inštalácií sa hneď vrátia.
  await removeCloudPlugin({ serverConfig: config, workspaceId: workspace.recordId, workspaceRoot: workspace.root, pluginId });
  let item: CloudImportedPlugin;
  if (bundle) {
    item = await installGlobal(config, bundle);
  } else {
    for (const name of names) {
      const entry = sharedBefore[name];
      if (entry) await addMcp(config, target.recordId, name, entry, "global");
    }
    item = existing!;
  }
  await restoreDisabled(config, [...new Set(disabled)]);

  // Prenesená úprava: prepíše globálny súbor, len ak ho advokát globálne neupravil; inak ide bokom.
  const globalChanged = new Set((await pluginFileChanges(target, item)).map((change) => change.path));
  const carried: string[] = [];
  for (const [path, content] of carriedContent) {
    if (bundle || !globalChanged.has(path)) {
      const location = installLocation(target.root, path, true);
      await mkdir(dirname(location), { recursive: true });
      await writeFile(location, content, "utf8");
      carried.push(path);
    } else {
      const to = join(target.root, "lawoss-zalohy", stamp, dirname(path.slice(".opencode/".length)), backupName(path));
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, content, "utf8");
      backups.push(to);
    }
  }
  return { status: "moved", item, backups, carried };
}
