/**
 * LAWOSS #415: jurisdikcia kancelárie pre CLI `okf` nezávisle od prostredia procesu.
 *
 * Príkazy agenta (`legalwork_shell`) spúšťa server, nie engine, a v chránenom režime bežia v izolovanom prostredí,
 * takže premenná prostredia enginu sa k nim nedostane. Kancelária z onboardingu appky nemusí mať `okf.config`
 * a karty klientov jurisdikciu nenesú. Preto appka vedľa každého pribaleného `okf.js` klienta
 * (`.opencode/skills/<skill>/resources/`, priečinok appky, nie štandard OKF) drží malý `.office.json` len
 * s jurisdikciou kancelárie; CLI ho číta ako poslednú možnosť. Bez osobných údajov a tajomstiev. Meno začína bodkou,
 * aby ho zoznam prostriedkov skillu (`skill-resources.ts`) nebral ako prílohu advokáta (blok v SKILL.md, Nastavenia).
 *
 * Zapisuje sa po uložení profilu kancelárie, pri štarte servera pre všetkých lokálnych klientov a po zápise
 * `okf.js` do skillu. Klient mimo praxe kancelárie (alebo bez profilu) súbor nemá; starý sa odstráni. Keď sa
 * skutočná cesta kancelárie alebo klienta nedá zistiť (odpojený disk), súbor ostane, ako je.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { officeProfilePath } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";
import { practiceRootOf } from "./unadopted-clients.js";
import { workspaceAppFilesRoot } from "./workspace-app-files.js";

export const OKF_CLI_FILE = "okf.js";
export const OFFICE_FACTS_FILE = ".office.json";
/** Meno, ktoré appka písala predtým; viditeľné v zozname prostriedkov skillu, preto sa odstráni. */
export const LEGACY_OFFICE_FACTS_FILE = "office.json";
/** Rozpísaný dočasný súbor (`.office.json.<uuid>.tmp`), ktorý po páde ostal; mladší môže práve zapisovať iný beh. */
const LEFTOVER = /^\.office\.json\.[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.tmp$/;
const LEFTOVER_AGE_MS = 60_000;
export type Jurisdiction = "sk" | "cz";

const missing = (error: unknown) => error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
const realDirectory = async (path: string) => { try { const stat = await lstat(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch (error) { if (missing(error)) return false; throw error; } };
const regularFile = async (path: string) => { try { const stat = await lstat(path); return stat.isFile() && !stat.isSymbolicLink(); } catch (error) { if (missing(error)) return false; throw error; } };

/** Obsah `.office.json` presne ako ho appka píše. */
export const officeFactsContent = (jurisdiction: Jurisdiction): string => `${JSON.stringify({ jurisdiction })}\n`;

/** Starý `office.json`, len ak je to presne obsah, ktorý appka písala (`{"jurisdiction":"sk"|"cz"}`). */
async function appWrittenLegacy(path: string): Promise<boolean> {
  if (!await regularFile(path)) return false;
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
    const keys = Object.keys(raw), jurisdiction: unknown = Reflect.get(raw, "jurisdiction");
    return keys.length === 1 && (jurisdiction === "sk" || jurisdiction === "cz");
  } catch { return false; }
}

/** Po zápise (alebo odstránení) `.office.json`: starý `office.json` appky a staré dočasné súbory preč. */
async function sweepLeftovers(resources: string, now: number): Promise<number> {
  let changed = 0;
  const legacy = join(resources, LEGACY_OFFICE_FACTS_FILE);
  if (await appWrittenLegacy(legacy)) { await rm(legacy, { force: true }); changed++; }
  for (const entry of await readdir(resources, { withFileTypes: true })) {
    if (!entry.isFile() || !LEFTOVER.test(entry.name)) continue;
    const path = join(resources, entry.name);
    const stat = await lstat(path).catch(() => null);
    if (stat?.isFile() && now - stat.mtimeMs > LEFTOVER_AGE_MS) { await rm(path, { force: true }); changed++; }
  }
  return changed;
}

/**
 * Do `resources/` každého skillu s `okf.js` pod `<appFilesRoot>/.opencode/skills` zapíše `.office.json`
 * s jurisdikciou (bez `jurisdiction` ho odstráni). Odkazy (symlinky) preskočí, súbor nahradí premenovaním.
 * Starý `office.json` appky a staré dočasné súbory odstráni. Vráti počet zmenených súborov.
 */
export async function writeOfficeFacts(appFilesRoot: string, jurisdiction: Jurisdiction | undefined): Promise<number> {
  const skills = join(appFilesRoot, ".opencode", "skills");
  if (!await realDirectory(join(appFilesRoot, ".opencode")) || !await realDirectory(skills)) return 0;
  let changed = 0;
  for (const entry of await readdir(skills, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const resources = join(skills, entry.name, "resources");
    if (!await realDirectory(join(skills, entry.name)) || !await realDirectory(resources) || !await regularFile(join(resources, OKF_CLI_FILE))) continue;
    const target = join(resources, OFFICE_FACTS_FILE);
    const exists = await lstat(target).then(() => true, (error: unknown) => { if (missing(error)) return false; throw error; });
    if (!jurisdiction) {
      if (exists) { await rm(target, { force: true }); changed++; }
    } else {
      const content = officeFactsContent(jurisdiction);
      if (!exists || !await regularFile(target) || await readFile(target, "utf8").catch(() => "") !== content) {
        const temporary = join(resources, `${OFFICE_FACTS_FILE}.${randomUUID()}.tmp`);
        await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
        try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
        changed++;
      }
    }
    changed += await sweepLeftovers(resources, Date.now());
  }
  return changed;
}

/**
 * Jurisdikcia z profilu kancelárie pre klienta pod jej praxou; `undefined` bez profilu alebo mimo praxe; `null`, keď
 * sa skutočná cesta kancelárie či klienta nedá zistiť (odpojený disk): vtedy sa nič nemení. Porovnávajú sa skutočné
 * cesty (`realpath`, ako CLI), takže odkaz ani iná veľkosť písmen v uloženej ceste súbor neodstráni.
 */
export async function officeJurisdictionFor(config: ServerConfig, workspace: WorkspaceInfo): Promise<Jurisdiction | undefined | null> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(officeProfilePath(config), "utf8")); } catch { return undefined; }
  if (!raw || typeof raw !== "object") return undefined;
  const officeRoot: unknown = Reflect.get(raw, "officeRoot"), jurisdiction: unknown = Reflect.get(raw, "jurisdiction");
  if (typeof officeRoot !== "string" || (jurisdiction !== "sk" && jurisdiction !== "cz") || !workspace.path) return undefined;
  const office = await realpath(officeRoot).catch(() => null), client = await realpath(workspace.path).catch(() => null);
  if (!office || !client) return null;
  return isPathWithin(practiceRootOf(office), client) ? jurisdiction : undefined;
}

/** `.office.json` pre jedného klienta podľa aktuálneho profilu. */
export async function refreshOfficeFacts(config: ServerConfig, workspace: WorkspaceInfo): Promise<number> {
  const jurisdiction = await officeJurisdictionFor(config, workspace);
  return jurisdiction === null ? 0 : writeOfficeFacts(workspaceAppFilesRoot(config, workspace), jurisdiction);
}

/** Pre všetkých klientov (bez wiki), jeden po druhom; chyba jedného klienta ostatných nezastaví. */
export async function refreshAllOfficeFacts(config: ServerConfig): Promise<void> {
  for (const workspace of config.workspaces) {
    if (workspace.preset === "wiki" || !workspace.path) continue;
    await refreshOfficeFacts(config, workspace).catch((error: unknown) => {
      console.warn("[lawoss] .office.json", workspace.id, error instanceof Error ? error.message : String(error));
    });
  }
}
