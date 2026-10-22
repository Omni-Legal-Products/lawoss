/** Onboarding errors the app localizes. Portable: no Node imports, the app reads it at build time. */
export const UNSAFE_FOLDER_NAME_MESSAGE = "A safe non-empty folder name is required.";
/**
 * Prax už má priečinok kancelárie (`Office/`, `_kancelaria/`), ktorý sa nedá dokončiť (bez obsahu OKF, odkaz,
 * dva priečinky kancelárie). Appka vysvetlí ďalší krok v jazyku rozhrania (N-14, 22. 10. 2026).
 */
export const OFFICE_EXISTS_MESSAGE = "Tento priečinok už kanceláriu má (Office/), ale nedá sa doplniť.";
/** Prefix chyby praxe vnútri existujúcej kancelárie; za ním nasleduje cesta kancelárie v zátvorke. */
export const INSIDE_OFFICE_MESSAGE_PREFIX = "Tento priečinok je už súčasťou kancelárie";
/**
 * Prefix chyby neúplnej inšpekcie so zamknutým súborom (Word, Outlook či antivírus na Windows).
 * Nasleduje zoznam „<cesta>: <kód>“ oddelený „; “; appka z neho vyberie cesty s kódom
 * `locked_file` a vysvetlí ich v jazyku rozhrania.
 */
export const LOCKED_FILES_MESSAGE_PREFIX = "Files are open in another application:";
export const LOCKED_FILE_CODE = "locked_file";

/**
 * Chyba neúplnej inšpekcie s prvými piatimi problémami „<cesta>: <kód>“ (koreň je „.“), zamknuté
 * súbory vpredu. Bez zoznamu advokát nevie, ktorý súbor náhľad zastavil.
 */
export function incompleteInspectionMessage(message: string, issues: readonly { path: string; code: string }[]): string {
  if (!issues.length) return message;
  const locked = issues.filter(issue => issue.code === LOCKED_FILE_CODE);
  const ordered = locked.length ? [...locked, ...issues.filter(issue => issue.code !== LOCKED_FILE_CODE)] : issues;
  const listed = ordered.slice(0, 5).map(issue => `${issue.path || "."}: ${issue.code}`).join("; ");
  const more = issues.length > 5 ? ` (+${issues.length - 5} more)` : "";
  return `${locked.length ? LOCKED_FILES_MESSAGE_PREFIX : message.replace(/\.$/, ":")} ${listed}${more}`;
}
