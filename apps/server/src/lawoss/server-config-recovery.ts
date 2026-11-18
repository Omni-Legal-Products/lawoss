/**
 * #553: poškodený server.json. Predtým ho `readJsonFile` potichu zmenil na `{}` a appka vyzerala ako nová
 * inštalácia, pričom každý zápis nastavení skončil 422 `invalid_json`. Teraz sa poškodený súbor odloží vedľa
 * (`server.json.poskodeny-<čas>`, nikdy sa nemaže ani neprepisuje), obsah sa podľa možnosti obnoví a štart
 * pridá do `workspaceWarnings` kódované varovanie, ktoré appka preloží (`apps/app/src/lawoss/domains/workspaces/server-config-warning.ts`).
 */
import { constants } from "node:fs";
import { copyFile, readFile, rename, rm, unlink, writeFile } from "node:fs/promises";
import type { ServerConfig, WorkspaceConfig } from "../types.js";
import { buildWorkspaceInfos } from "../workspaces.js";

/** Formát varovania: `LAWOSS_SERVER_CONFIG_DAMAGED|<druh>|<cesta>`; cesta je posledná, môže obsahovať aj `|`. */
export const SERVER_CONFIG_DAMAGED = "LAWOSS_SERVER_CONFIG_DAMAGED";

/**
 * - `repaired`: za celým objektom bol neplatný koniec, objekt sa zapísal späť; cesta je záloha.
 * - `reset`: nedal sa obnoviť, server.json je odložený a štart je bez jeho obsahu; cesta je záloha.
 * - `restored`: ako `reset`, ale klienti sa obnovili zo zoznamu desktopovej appky; cesta je záloha.
 * - `kept`: súbor sa nepodarilo odložiť, ostal nedotknutý; cesta je server.json.
 */
export type ServerConfigDamage = "repaired" | "reset" | "restored" | "kept";

const warning = (kind: ServerConfigDamage, path: string) => `${SERVER_CONFIG_DAMAGED}|${kind}|${path}`;

const isPlainObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(raw);
    return isPlainObject(value) ? value : null;
  } catch { return null; }
}

/** Prvý celý JSON objekt v texte (rovnaké pravidlo ako `parseFirstJsonObject` v `apps/desktop/electron/workspace-store.mjs`). */
export function firstJsonObject(raw: string): Record<string, unknown> | null {
  let inString = false, escaped = false, depth = 0, start = -1;
  for (let index = 0; index < raw.length; index += 1) {
    const char = raw[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === "\"") inString = false;
      continue;
    }
    if (char === "\"") inString = true;
    else if (char === "{") { if (depth === 0) start = index; depth += 1; }
    else if (char === "}") {
      depth -= 1;
      if (depth === 0 && start >= 0) return parseObject(raw.slice(start, index + 1));
    }
  }
  return null;
}

const stamp = (now: Date) => now.toISOString().replace(/[:.]/g, "-");

/** Kópia bez prepísania existujúcej zálohy; `null`, keď sa nedá vytvoriť. */
async function backUp(configPath: string, now: Date): Promise<string | null> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const backupPath = `${configPath}.poskodeny-${stamp(now)}${attempt ? `-${attempt}` : ""}`;
    try {
      await copyFile(configPath, backupPath, constants.COPYFILE_EXCL);
      return backupPath;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) return null;
    }
  }
  return null;
}

async function writeAtomic(path: string, value: Record<string, unknown>): Promise<void> {
  const temp = `${path}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(temp, path);
  } finally { await rm(temp, { force: true }); }
}

export type LoadedServerConfig<T> = { config: T | null; warning: string | null };

/**
 * Načíta server.json. Chýbajúci alebo nečitateľný súbor je `null` ako doteraz; neplatný JSON sa odloží,
 * opraví (neplatný koniec) alebo uvoľní (server.json sa po zálohe odstráni, aby ďalšie zápisy nastavení prešli).
 */
export async function loadServerConfigFile<T extends object>(configPath: string, now = new Date()): Promise<LoadedServerConfig<T>> {
  let raw: string;
  try { raw = await readFile(configPath, "utf8"); } catch { return { config: null, warning: null }; }
  const parsed = parseObject(raw);
  // Platný súbor ostáva typovo taký, ako ho čítal pôvodný `readJsonFile`.
  if (parsed) return { config: parsed as T, warning: null };

  const backupPath = await backUp(configPath, now);
  if (!backupPath) return { config: null, warning: warning("kept", configPath) };
  const recovered = firstJsonObject(raw);
  if (recovered) {
    await writeAtomic(configPath, recovered).catch(() => undefined);
    return { config: recovered as T, warning: warning("repaired", backupPath) };
  }
  // Záloha má presne pôvodné bajty; ostane len ona.
  await unlink(configPath).catch(() => undefined);
  return { config: null, warning: warning("reset", backupPath) };
}

/**
 * Desktop: keď sa server.json nedal obnoviť, klientov vráti zoznam desktopovej appky (`legalwork-workspaces.json`)
 * s ich id a kľúčmi úložiska. Ostatné nastavenia servera ostanú predvolené.
 */
export function restoreClientsFromHost(config: ServerConfig, hostWorkspaces: readonly WorkspaceConfig[] | undefined): void {
  const prefix = `${SERVER_CONFIG_DAMAGED}|reset|`;
  const warnings = config.workspaceWarnings ?? [];
  const reset = warnings.find(item => item.startsWith(prefix));
  if (reset === undefined || config.workspaces.length || !hostWorkspaces?.length) return;
  config.workspaces = buildWorkspaceInfos([...hostWorkspaces], process.cwd());
  config.workspaceWarnings = warnings.map(item => item === reset ? warning("restored", reset.slice(prefix.length)) : item);
}
