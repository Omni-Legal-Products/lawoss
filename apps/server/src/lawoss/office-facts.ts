/**
 * LAWOSS #415: jurisdikcia kancelárie pre CLI `okf` nezávisle od prostredia procesu.
 *
 * Príkazy agenta (`legalwork_shell`) spúšťa server, nie engine, a v chránenom režime bežia v izolovanom prostredí,
 * takže premenná prostredia enginu sa k nim nedostane. Kancelária z onboardingu appky nemusí mať `okf.config`
 * a karty klientov jurisdikciu nenesú. Preto appka vedľa každého pribaleného `okf.js` klienta
 * (`.opencode/skills/<skill>/resources/`, priečinok appky, nie štandard OKF) drží malý `office.json` len
 * s jurisdikciou kancelárie; CLI ho číta ako poslednú možnosť. Bez osobných údajov a tajomstiev.
 *
 * Zapisuje sa po uložení profilu kancelárie, pri štarte servera pre všetkých lokálnych klientov a po zápise
 * `okf.js` do skillu. Klient mimo praxe kancelárie (alebo bez profilu) súbor nemá; starý sa odstráni.
 */
import { randomUUID } from "node:crypto";
import { lstat, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { officeProfilePath } from "./linked-folders.js";
import { isPathWithin } from "./path-within.js";
import { practiceRootOf } from "./unadopted-clients.js";
import { workspaceAppFilesRoot } from "./workspace-app-files.js";

export const OKF_CLI_FILE = "okf.js";
export const OFFICE_FACTS_FILE = "office.json";
export type Jurisdiction = "sk" | "cz";

const missing = (error: unknown) => error instanceof Error && "code" in error && (error.code === "ENOENT" || error.code === "ENOTDIR");
const realDirectory = async (path: string) => { try { const stat = await lstat(path); return stat.isDirectory() && !stat.isSymbolicLink(); } catch (error) { if (missing(error)) return false; throw error; } };
const regularFile = async (path: string) => { try { const stat = await lstat(path); return stat.isFile() && !stat.isSymbolicLink(); } catch (error) { if (missing(error)) return false; throw error; } };

/** Obsah `office.json` presne ako ho appka píše. */
export const officeFactsContent = (jurisdiction: Jurisdiction): string => `${JSON.stringify({ jurisdiction })}\n`;

/**
 * Do `resources/` každého skillu s `okf.js` pod `<appFilesRoot>/.opencode/skills` zapíše `office.json`
 * s jurisdikciou (bez `jurisdiction` ho odstráni). Odkazy (symlinky) preskočí, súbor nahradí premenovaním.
 * Vráti počet zmenených súborov.
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
      continue;
    }
    const content = officeFactsContent(jurisdiction);
    if (exists && await regularFile(target) && await readFile(target, "utf8").catch(() => "") === content) continue;
    const temporary = join(resources, `.${OFFICE_FACTS_FILE}.${randomUUID()}.tmp`);
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    try { await rename(temporary, target); } catch (error) { await rm(temporary, { force: true }); throw error; }
    changed++;
  }
  return changed;
}

/** Jurisdikcia z profilu kancelárie pre klienta pod jej praxou; inak nič. */
export async function officeJurisdictionFor(config: ServerConfig, workspace: WorkspaceInfo): Promise<Jurisdiction | undefined> {
  let raw: unknown;
  try { raw = JSON.parse(await readFile(officeProfilePath(config), "utf8")); } catch { return undefined; }
  if (!raw || typeof raw !== "object") return undefined;
  const officeRoot: unknown = Reflect.get(raw, "officeRoot"), jurisdiction: unknown = Reflect.get(raw, "jurisdiction");
  if (typeof officeRoot !== "string" || (jurisdiction !== "sk" && jurisdiction !== "cz") || !workspace.path) return undefined;
  return isPathWithin(practiceRootOf(officeRoot), workspace.path) ? jurisdiction : undefined;
}

/** `office.json` pre jedného klienta podľa aktuálneho profilu. */
export async function refreshOfficeFacts(config: ServerConfig, workspace: WorkspaceInfo): Promise<number> {
  return writeOfficeFacts(workspaceAppFilesRoot(config, workspace), await officeJurisdictionFor(config, workspace));
}

/** Pre všetkých klientov (bez wiki), jeden po druhom; chyba jedného klienta ostatných nezastaví. */
export async function refreshAllOfficeFacts(config: ServerConfig): Promise<void> {
  for (const workspace of config.workspaces) {
    if (workspace.preset === "wiki" || !workspace.path) continue;
    await refreshOfficeFacts(config, workspace).catch((error: unknown) => {
      console.warn("[lawoss] office.json", workspace.id, error instanceof Error ? error.message : String(error));
    });
  }
}
