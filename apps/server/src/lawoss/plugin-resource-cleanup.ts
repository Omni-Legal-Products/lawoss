/**
 * LAWOSS (#357): upratanie starých verzií nemenného runtime doplnku.
 *
 * `preparePluginResources` (cloud-plugins.ts) zapisuje runtime do adresára podľa obsahu
 * `.opencode/plugin-resources/<namespace>/<sha256>`. Aktualizácia vytvorí nový adresár a starý
 * ostal navždy. Po úspešnom zápise záznamu inštalácie (alebo po odinštalovaní) sa v tom istom
 * namespace odstránia verzie, na ktoré už neodkazuje žiadny záznam, a staging po páde.
 *
 * - Maže sa len priamo v `namespaceDir` (už overenom cez `resolveWorkspaceInstallPath`),
 *   len skutočné priečinky s menom digestu alebo `<digest>.staging-*`; odkazy sa nesledujú ani nemažú.
 * - Runtime nie je súbor upraviteľný advokátom (nemá `contentSha256`), preto ho voľby
 *   ponechať/zálohovať/nahradiť z panela aktualizácií nepokrývajú.
 * - Best-effort: chyba (napr. zamknutý súbor na Windows) sa zapíše do logu a inštaláciu nezhodí;
 *   nepoužívaná verzia sa odstráni pri ďalšej inštalácii alebo odinštalovaní.
 */
import { lstat, readdir, rm, rmdir } from "node:fs/promises";
import { resolve } from "node:path";

import { GLOBAL_MCP_ID } from "../runtime-opencode-config-store.js";
import { isPathWithin } from "./path-within.js";
import { GLOBAL_PLUGIN_RECORD_ID } from "./plugin-install-target.js";

const DIGEST = /^[a-f0-9]{64}$/;
const STAGING = /^[a-f0-9]{64}\.staging-/;
/** Staging mladší ako táto hranica môže patriť súbežnej inštalácii. */
export const STALE_STAGING_MS = 15 * 60_000;

const PREFIX = ".opencode/plugin-resources/";

/**
 * Záznamy inštalácií, ktoré môžu odkazovať do toho istého koreňa. Globálny priečinok OpenCode
 * zdieľa import z priečinka (`GLOBAL_MCP_ID`) aj LAWOSS Marketplace (`GLOBAL_PLUGIN_RECORD_ID`).
 */
export function pluginResourceRecordIds(recordId: string, global: boolean): string[] {
  return [...new Set(global ? [recordId, GLOBAL_MCP_ID, GLOBAL_PLUGIN_RECORD_ID] : [recordId])];
}

/** Namespace runtime, do ktorých zapísal súbory daný záznam doplnku. */
export function pluginResourceNamespaces(files: ReadonlyArray<{ path: string }>): string[] {
  return [...new Set(files.flatMap((file) => {
    const namespace = file.path.startsWith(PREFIX) ? file.path.split("/")[2] : undefined;
    return namespace ? [namespace] : [];
  }))];
}

/** Mená položiek v `plugin-resources/<namespace>/`, na ktoré odkazuje niektorý nainštalovaný doplnok. */
export function referencedResourceEntries(plugins: Iterable<{ files: ReadonlyArray<{ path: string }> }>, namespace: string, mcpConfigs: readonly unknown[] = []): Set<string> {
  const referenced = new Set(mcpConfigs.flatMap((config) => [...referencedResourceEntriesInConfig(config, namespace)]));
  for (const plugin of plugins) {
    for (const file of plugin.files) {
      if (!file.path.startsWith(`${PREFIX}${namespace}/`)) continue;
      const entry = file.path.split("/")[3];
      if (entry) referenced.add(entry);
    }
  }
  return referenced;
}

/**
 * Verzie runtime, na ktoré ukazuje uložené nastavenie MCP (napr. príkaz, ktorý si advokát upravil
 * a ktorý aktualizácia so zachovaním nastavenia ponechala). Také verzie sa nemažú.
 */
export function referencedResourceEntriesInConfig(value: unknown, namespace: string): Set<string> {
  const text = JSON.stringify(value ?? null).replaceAll("\\\\", "/");
  const pattern = new RegExp(`plugin-resources/+${namespace.replace(/[^a-z0-9-]/g, "")}/+([a-f0-9]{64})(?![a-f0-9])`, "g");
  return new Set([...text.matchAll(pattern)].map((match) => match[1]!));
}

function errorCode(error: unknown): string {
  return error instanceof Error && "code" in error && typeof error.code === "string" ? error.code : String(error);
}

/**
 * Odstráni nepoužívané verzie runtime v jednom namespace. Nikdy nevyhodí chybu.
 * Keď na namespace nič neodkazuje (odinštalovanie), odstráni aj jeho prázdny priečinok.
 */
export async function prunePluginResourceNamespace(input: {
  namespaceDir: string;
  /** Overenie, že cesta ani jej rodičia nie sú odkaz (`assertPluginDestination`). */
  assertSafe: () => Promise<void>;
  referenced: ReadonlySet<string>;
  now?: number;
  warn?: (message: string) => void;
}): Promise<string[]> {
  const warn = input.warn ?? ((message: string) => console.warn(message));
  const now = input.now ?? Date.now();
  const removed: string[] = [];
  try {
    await input.assertSafe();
    const info = await lstat(input.namespaceDir).catch(() => null);
    if (!info || !info.isDirectory()) return removed;
    const orphaned = input.referenced.size === 0;
    for (const entry of await readdir(input.namespaceDir, { withFileTypes: true })) {
      if (input.referenced.has(entry.name) || entry.isSymbolicLink()) continue;
      const path = resolve(input.namespaceDir, entry.name);
      if (!isPathWithin(input.namespaceDir, path)) continue;
      let remove = orphaned || (entry.isDirectory() && DIGEST.test(entry.name));
      if (STAGING.test(entry.name)) {
        const stat = await lstat(path).catch(() => null);
        remove = !!stat?.isDirectory() && now - stat.mtimeMs > STALE_STAGING_MS;
      }
      if (!remove) continue;
      try {
        await rm(path, { recursive: true, force: true });
        removed.push(path);
      } catch (error) {
        warn(`[lawoss] Could not remove an unused plugin runtime ${path} (${errorCode(error)}); it will be retried on the next plugin change.`);
      }
    }
    if (orphaned) await rmdir(input.namespaceDir).catch(() => undefined);
  } catch (error) {
    warn(`[lawoss] Skipped cleanup of plugin runtimes in ${input.namespaceDir} (${errorCode(error)}).`);
  }
  return removed;
}
