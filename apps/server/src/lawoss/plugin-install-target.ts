/**
 * LAWOSS: cieľ inštalácie pluginu (rozhodnutie MČ 5. 10. 2026, ADR 0015 bod 4).
 *
 * Upstream inštaluje plugin do jedného workspace: súbory pod `<workspace>/.opencode/…`,
 * záznam v `runtime.sqlite` pod id workspace a MCP v riadku workspace. LAWOSS inštaluje
 * pluginy z LAWOSS Marketplace raz pre advokáta: súbory do globálneho priečinka OpenCode
 * (`$XDG_CONFIG_HOME/opencode`, rovnaký, z ktorého engine číta globálne skilly pre každý
 * workspace), MCP do spoločného riadku (`addMcp(..., "global")`, ADR 0013) a záznam pôvodu
 * pod vlastným id. Logická cesta v zázname ostáva `.opencode/…`, aby odinštalovanie, názvy
 * MCP a appka fungovali rovnako; skutočné umiestnenie počíta `installLocation`.
 */
import { resolve } from "node:path";

import { globalOpencodeConfigDir } from "../workspace-files.js";

/** Id záznamu globálnych pluginov v `cloud_plugin_install_configs`. Nie je to id workspace ani `GLOBAL_MCP_ID`. */
export const GLOBAL_PLUGIN_RECORD_ID = "__lawoss_global_plugins__";

export type PluginInstallTarget = {
  /** Kľúč záznamu inštalácie (id workspace alebo `GLOBAL_PLUGIN_RECORD_ID`). */
  recordId: string;
  /** Koreň workspace alebo globálny priečinok OpenCode. */
  root: string;
  global: boolean;
};

export function globalPluginTarget(): PluginInstallTarget {
  return { recordId: GLOBAL_PLUGIN_RECORD_ID, root: globalOpencodeConfigDir(), global: true };
}

/**
 * Skutočná cesta súboru s logickou cestou `.opencode/…`. Vo workspace je to `<root>/.opencode/…`,
 * globálne `<root>/…` (globálny priečinok OpenCode už je obdobou `.opencode`).
 */
export function installLocation(root: string, normalized: string, global: boolean): string {
  return resolve(root, global ? normalized.slice(".opencode/".length) : normalized);
}
