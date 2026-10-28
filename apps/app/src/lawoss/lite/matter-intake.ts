import { OkfDiagnostic } from "../../../../../lawoss/okf/diagnostics";
/**
 * Přetažený nebo vybraný dokument → věc: originál do `00_K_zarazeni/IN-00N/<název>`
 * (vlastní složka na vstup, takže se nic nepřepíše) a řádek `pending` ve `VSTUPY.md`.
 * Dnes ho pak započítá „K zařazení“ (soubor je ve složce na nezařazené, `inputs-model.ts`). Nic se neodesílá, nic se nemaže.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { missing } from "../okf/read-model";
import { appendInputRow, inputRow, nextInputId, receivedStamp, safeFileName } from "../../../../../lawoss/okf/inputs";
import { parseWorkingProfile, PROFILE_FILE } from "../../../../../lawoss/okf/src/profile";

const INTAKE_DIR = "00_K_zarazeni";
/** Horní mez jednoho souboru - přenáší se jako base64 v JSON. */
const MAX_INTAKE_BYTES = 50 * 1024 * 1024;

// Řádek a registr zapisuje i server po přesunu z nezařazených (`lawoss_files`, N-A7-6): jedna sdílená implementace.
export { appendInputRow, inputRow, nextInputId, receivedStamp, safeFileName };

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
  return new OkfDiagnostic("okf.intake_unregistered", { path }, `Pôvodný súbor bol uložený do ${path}, ale nepodarilo sa ho zapísať do registra vstupov: ${reason}`);
}

async function inboxDirectory(client: IntakeClient, workspaceId: string, matterPath: string): Promise<string> {
  const profilePath = matterPath ? `${matterPath}/${PROFILE_FILE}` : PROFILE_FILE;
  try {
    const profile = parseWorkingProfile((await client.readWorkspaceFile(workspaceId, profilePath)).content);
    const inbox = profile.roles.inbox;
    if (!inbox) throw new OkfDiagnostic("okf.inbox_missing", { path: PROFILE_FILE }, `Pracovný profil ${PROFILE_FILE} nemá rolu inbox.`);
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
    if (file.size > MAX_INTAKE_BYTES) throw new OkfDiagnostic("okf.file_too_large", { path: file.name }, `file too large: ${file.name}`);
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
