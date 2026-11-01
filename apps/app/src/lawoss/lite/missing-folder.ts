/**
 * N-A7-14 (rozhodnutie MČ 30. 10. 2026): v chate klienta agent žiadal `external_directory` pre cestu, ktorá neexistuje
 * (`…/Klienti/<kód bez zvyšku názvu>`), a karta „Pristúpiť k externému priečinku?“ to nepovedala. Karta teraz povie,
 * že priečinok neexistuje. Overuje to hlavný proces desktopu (`lawossFolderState`); odpoveď vidí len okno appky,
 * agent z nej nič nezistí. V prehliadači sa nič neoveruje a karta ostane ako doteraz. Iba zobrazenie.
 */
import { useEffect, useState } from "react";
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";
import { desktopBridge } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/lib/runtime-env";

export type FolderState = "dir" | "other" | "missing" | null;
export type FolderStat = (path: string) => Promise<FolderState>;

/** Ako `UNCERTAIN_CHARS` na serveri a v `other-client-folder.ts`, plus znaky vzoru `*` a `?`: taký rozsah sa neoveruje. */
const NOT_A_PATH = /[*?[\]{}$`]/;
const ABSOLUTE = /^(?:\/|[A-Za-z]:[\\/]|\\\\)/;

/** Priečinky rozsahu `<priečinok>/*` (tvar otázky enginu), ktoré sú obyčajnou absolútnou cestou. */
export function checkedFolders(patterns: readonly string[]): string[] {
  return [...new Set(patterns.flatMap((pattern) => {
    if (!/[\\/]\*$/.test(pattern)) return [];
    const folder = pattern.slice(0, -2);
    return folder && ABSOLUTE.test(folder) && !NOT_A_PATH.test(folder) ? [folder] : [];
  }))];
}

const desktopStat: FolderStat = async (path) => isDesktopRuntime() ? desktopBridge.lawossFolderState(path).catch(() => null) : null;

/** Výsledok pre otázku (podľa `id`), aby ho karta mala hneď aj po prekreslení. */
const known = new Map<string, boolean>();

/** Neexistuje niektorý z priečinkov otázky `external_directory`? Výsledok si zapamätá pre kartu. */
export async function loadMissingFolder(permission: Pick<PendingPermission, "id" | "permission" | "patterns">, stat: FolderStat = desktopStat): Promise<boolean> {
  if (permission.permission !== "external_directory") return false;
  const folders = checkedFolders(permission.patterns);
  const missing = folders.length > 0 && (await Promise.all(folders.map((folder) => stat(folder).catch(() => null)))).includes("missing");
  if (known.size > 100) known.clear();
  known.set(permission.id, missing);
  return missing;
}

/** Veta karty `external_directory`, keď priečinok neexistuje; inak `null`. */
export function useMissingFolderText(permission: Pick<PendingPermission, "id" | "permission" | "patterns">): string | null {
  const [missing, setMissing] = useState(() => known.get(permission.id) ?? false);
  const external = permission.permission === "external_directory";
  const key = permission.patterns.join("\u0000");
  useEffect(() => {
    if (!external) return;
    let current = true;
    void loadMissingFolder(permission).then((value) => { if (current) setMissing(value); });
    return () => { current = false; };
    // Rozsah otázky sa nemení; `key` stráži len zmenu otázky pod tým istým `id`.
  }, [permission.id, external, key]);
  return external && missing ? t("lawoss.permission_card.missing_folder") : null;
}
