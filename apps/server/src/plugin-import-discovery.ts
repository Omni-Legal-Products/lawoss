import { lstat, readFile, realpath } from "node:fs/promises";
import { join, resolve } from "node:path";
import { parse as toml } from "smol-toml";
import type { PluginImportCandidate, PluginImportProvider } from "@legalwork/types/plugin-import";

const object = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === "object" && !Array.isArray(value);
async function read(path: string): Promise<Record<string, unknown>> {
  const info = await lstat(path).catch(() => null);
  if (!info?.isFile() || info.isSymbolicLink() || info.size > 1024 * 1024) return {};
  try { const value: unknown = path.endsWith(".toml") ? toml(await readFile(path, "utf8")) : JSON.parse(await readFile(path, "utf8")); return object(value) ? value : {}; } catch { return {}; }
}

/** Distinguish available cache/catalog entries from actual installed state. */
export async function sourceInstallationStates(provider: PluginImportProvider, root: string, codex: string, claude: string) {
  const installed = new Map<string, string>();
  const enabled: Record<string, unknown> = {};
  if (provider === "claude") {
    const registry = await read(join(claude, "plugins/installed_plugins.json"));
    if (object(registry.plugins)) for (const [id, entries] of Object.entries(registry.plugins)) if (Array.isArray(entries)) for (const entry of entries) if (object(entry) && typeof entry.installPath === "string") { const path = entry.installPath; installed.set(resolve(path), id); installed.set(await realpath(path).catch(() => resolve(path)), id); }
    for (const path of [join(claude, "settings.json"), join(root, ".claude/settings.json"), join(root, ".claude/settings.local.json")]) {
      const settings = await read(path);
      if (object(settings.enabledPlugins)) Object.assign(enabled, settings.enabledPlugins);
    }
  } else {
    for (const path of [join(codex, "config.toml"), join(root, ".codex/config.toml")]) {
      const settings = await read(path);
      if (object(settings.plugins)) for (const [id, entry] of Object.entries(settings.plugins)) if (object(entry) && typeof entry.enabled === "boolean") enabled[id] = entry.enabled;
    }
  }
  return (candidate: PluginImportCandidate): PluginImportCandidate => {
    const id = installed.get(candidate.path);
    const configuredId = id || (provider === "chatgpt" ? Object.keys(enabled).find(key => key.split("@")[0] === candidate.name && (!key.includes("@") || candidate.path.replace(/\\/g, "/").includes(`/${key.split("@")[1]}/`))) : undefined);
    const synced = /(?:^|[\\/])(?:plugins|skills)[\\/](?:cache[\\/])?synced[\\/]/.test(candidate.path);
    const state = configuredId && enabled[configuredId] === false ? "disabled" : synced ? "synced" : id || configuredId ? "installed" : candidate.kind === "skill" || candidate.kind === "connector" && !candidate.bundledIn ? "installed" : "available";
    return { ...candidate, state };
  };
}
