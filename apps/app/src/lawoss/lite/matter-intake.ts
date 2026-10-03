/**
 * Přetažený nebo vybraný dokument → věc: originál do `00_K_zarazeni/IN-00N/<název>`
 * (vlastní složka na vstup, takže se nic nepřepíše) a řádek `pending` ve `VSTUPY.md`.
 * Obrazovka Dnes ho pak ukáže „K zařazení“. Nic se neodesílá, nic se nemaže.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { missing, today } from "../okf/read-model";
import { parseWorkingProfile, PROFILE_FILE } from "../../../../../lawoss/okf/src/profile";

const INTAKE_DIR = "00_K_zarazeni";
const INTAKE_SOURCE = "ruční vložení (LAWOSS)";
/** Horní mez jednoho souboru - přenáší se jako base64 v JSON. */
const MAX_INTAKE_BYTES = 50 * 1024 * 1024;

const TABLE_HEADER = "| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |";
const TABLE_RULE = "|---|---|---|---|---|---|";

/** Další volné ID vstupu: nejvyšší `IN-<číslo>` v registru + 1, tři číslice. */
export function nextInputId(intake: string | null): string {
  const numbers = [...(intake ?? "").matchAll(/\|\s*IN-(\d+)\s*\|/g)].map((m) => Number(m[1]));
  return `IN-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

/** Čas přijetí s časovým pásmem počítače, např. `2026-09-24T14:32:05+02:00`. */
export function receivedStamp(now: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${today(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${zone}`;
}

/** Název souboru bez cesty a znaků, které by rozbily cestu nebo tabulku. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f|]/g, "").trim().replace(/^\.+/, "");
  return clean || "dokument";
}

export function inputRow(id: string, received: string, original: string): string {
  return `| ${id} | ${received} | ${INTAKE_SOURCE} | ${original} | pending | |`;
}

/**
 * Přidá řádek na konec první tabulky registru (za poslední její řádek). Registr bez tabulky
 * dostane tabulku na konec; chybějící registr se založí. Ostatní text zůstává beze změny.
 */
export function appendInputRow(intake: string | null, row: string, title: string): string {
  if (intake === null) {
    return `---\ntype: input-register\ntitle: ${JSON.stringify(`${title} - Vstupy`)}\n---\n\n# Vstupy a komunikace\n\n${TABLE_HEADER}\n${TABLE_RULE}\n${row}\n`;
  }
  const lines = intake.split("\n");
  const rule = lines.findIndex((line) => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line.trim()));
  if (rule === -1) return `${intake.replace(/\n*$/, "\n")}\n${TABLE_HEADER}\n${TABLE_RULE}\n${row}\n`;
  let end = rule + 1;
  while (end < lines.length && lines[end]!.trim().startsWith("|")) end++;
  lines.splice(end, 0, row);
  return lines.join("\n");
}

type IntakeClient = Pick<LegalworkServerClient, "readWorkspaceFile" | "writeWorkspaceFile" | "writeWorkspaceBinaryFile">;
type SavedInput = { id: string; name: string; path: string };

const conflict = (error: unknown) => /\b409\b|\bconflict\b|changed since it was loaded/i.test(error instanceof Error ? error.message : String(error));
const CREATE_ONLY_UPDATED_AT = -1;
const REGISTRATION_ATTEMPTS = 2;

type IntakeRegister = { content: string; updatedAt: number } | null;

async function readRegister(client: IntakeClient, workspaceId: string, path: string): Promise<IntakeRegister> {
  try {
    return await client.readWorkspaceFile(workspaceId, path);
  } catch (error) {
    if (missing(error)) return null;
    throw error;
  }
}

function unregisteredOriginal(path: string, error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(`Pôvodný súbor bol uložený do ${path}, ale nepodarilo sa ho zapísať do registra vstupov: ${reason}`);
}

async function inboxDirectory(client: IntakeClient, workspaceId: string, matterPath: string): Promise<string> {
  const profilePath = matterPath ? `${matterPath}/${PROFILE_FILE}` : PROFILE_FILE;
  try {
    const profile = parseWorkingProfile((await client.readWorkspaceFile(workspaceId, profilePath)).content);
    const inbox = profile.roles.inbox;
    if (!inbox) throw new Error(`Pracovný profil ${PROFILE_FILE} nemá rolu inbox.`);
    return inbox;
  } catch (error) {
    // Legacy matters without a snapshot retain the historical intake directory.
    if (missing(error)) return INTAKE_DIR;
    throw error;
  }
}

/**
 * Uloží soubory do věci jeden po druhém. Registr se zapisuje s kontrolou verze
 * (`baseUpdatedAt`), takže souběžná změna jinde skončí chybou, ne přepsáním.
 */
export async function saveDocumentsToMatter(
  client: IntakeClient, workspaceId: string, matter: { path: string; title: string }, files: readonly File[], now = new Date(),
): Promise<SavedInput[]> {
  const registerPath = matter.path ? `${matter.path}/VSTUPY.md` : "VSTUPY.md";
  const inbox = await inboxDirectory(client, workspaceId, matter.path);
  const saved: SavedInput[] = [];
  for (const file of files) {
    if (file.size > MAX_INTAKE_BYTES) throw new Error(`file too large: ${file.name}`);
    let register = await readRegister(client, workspaceId, registerPath);
    const originalId = nextInputId(register?.content ?? null);
    const name = safeFileName(file.name);
    const original = `${inbox}/${originalId}/${name}`;
    const path = matter.path ? `${matter.path}/${original}` : original;
    // The raw-file endpoint only checks a supplied revision for existing files.
    // A revision that no file can have turns this into a create-only write.
    await client.writeWorkspaceBinaryFile(workspaceId, { path, data: await file.arrayBuffer(), baseUpdatedAt: CREATE_ONLY_UPDATED_AT });
    const received = receivedStamp(now);
    try {
      for (let attempt = 0; attempt < REGISTRATION_ATTEMPTS; attempt++) {
        const id = nextInputId(register?.content ?? null);
        try {
          await client.writeWorkspaceFile(workspaceId, {
            path: registerPath,
            content: appendInputRow(register?.content ?? null, inputRow(id, received, original), matter.title),
            baseUpdatedAt: register?.updatedAt ?? null,
          });
          saved.push({ id, name, path });
          break;
        } catch (error) {
          if (!conflict(error) || attempt + 1 === REGISTRATION_ATTEMPTS) throw error;
          register = await readRegister(client, workspaceId, registerPath);
        }
      }
    } catch (error) {
      throw unregisteredOriginal(path, error);
    }
  }
  return saved;
}
