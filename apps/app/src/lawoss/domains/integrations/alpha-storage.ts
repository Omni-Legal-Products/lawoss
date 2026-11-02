/**
 * LAWOSS: úložiská v alfe (rozhodnutie MČ 2. 11. 2026). Advokát pripája lokálne priečinky,
 * aj tie, ktoré synchronizuje OneDrive, Dropbox alebo Google Drive. Pripojenia cloudových
 * a sieťových úložísk sú v dialógu „Pridať úložisko“ vidieť, ale vyblednuté a nedajú sa zvoliť.
 * Natívne úložiská upstreamu (Google Drive, OneDrive, SharePoint) sa ukážu aj bez zdroja LegalWork.
 */
export const ALPHA_STORAGE_CONNECTIONS_DISABLED = true;

/** Vlastnosti karty poskytovateľa v dialógu: v alfe neaktívna, inak bez zmeny. */
export function alphaStorageCard(className: string): { className: string; disabled?: true; "aria-disabled"?: true } {
  if (!ALPHA_STORAGE_CONNECTIONS_DISABLED) return { className };
  return { className: `${className} cursor-not-allowed opacity-50 hover:bg-transparent`, disabled: true, "aria-disabled": true };
}
