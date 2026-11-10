/**
 * LAWOSS test support (engine v2): tests written against v1 runtime rows describe their fixtures in the
 * v1 shape (`permission` maps, `provider` blocks with `npm`/`options`). They are converted through the
 * same upstream upgrade the app uses for saved v1 rows, so a fixture never invents its own v2 mapping.
 */
import { upgradeRuntimeConfigRecord } from "../../runtime-config-upgrade.js";
import type { RuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";

/** `host` keeps tool rules (global rows); `workspace` keeps only folder grants, like a saved workspace row. */
export function nativeRow(v1: Record<string, unknown>, scope: "host" | "workspace" = "host"): RuntimeOpencodeConfig {
  return { ...upgradeRuntimeConfigRecord(v1, { scope }).configuration };
}

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" };

/** Native rules as a v1-like map for assertions: last rule per action wins; a `*`-only action reads as its effect. */
export function v1Permissions(rules: readonly Rule[] | undefined): Record<string, unknown> {
  const map: Record<string, Record<string, string>> = {};
  for (const rule of rules ?? []) {
    const entry = map[rule.action] ?? {};
    delete entry[rule.resource];
    entry[rule.resource] = rule.effect;
    delete map[rule.action];
    map[rule.action] = entry;
  }
  return Object.fromEntries(Object.entries(map).map(([action, entry]) => {
    const keys = Object.keys(entry);
    return [action, keys.length === 1 && keys[0] === "*" ? entry["*"] : entry];
  }));
}

import { readFile } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { buildLegalworkRuntimeSettings } from "../../legalwork-runtime-config.js";
import { legalworkPluginPath } from "../../legalwork-extensions-plugin-path.js";
import type { ServerConfig } from "../../types.js";

/** Engine v2: the complete built configuration of one workspace (rules, agents, plugin specs) as the engine receives it. */
export async function engineSettings(config: ServerConfig, workspaceId: string) {
  return (await buildLegalworkRuntimeSettings(config, workspaceId)).configuration;
}

/** Engine v2 plugin specs are content-addressed directories; a bundle is identified by its built source. */
export async function hasBundledPlugin(plugins: readonly unknown[] | undefined, name: string): Promise<boolean> {
  const original = await readFile(legalworkPluginPath(name), "utf8");
  const targets = (plugins ?? []).flatMap(plugin => typeof plugin === "string" ? [plugin]
    : plugin && typeof plugin === "object" && "package" in plugin && typeof plugin.package === "string" ? [plugin.package] : []);
  for (const target of targets.filter(item => isAbsolute(item))) {
    if (await readFile(join(target, "index.js"), "utf8").then(source => source === original, () => false)) return true;
  }
  return false;
}
