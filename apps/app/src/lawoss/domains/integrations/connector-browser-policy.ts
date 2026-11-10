/**
 * LAWOSS pravidlá pre upstream prehliadač integrácií podľa kategórií (v0.3.9, `connector-browser.tsx`).
 * Upstream ukazuje natívne konektory, úložiská a tímové položky vždy; LAWOSS ich riadi rovnako
 * ako predtým v záložkách integrácií:
 * - natívne konektory pošty a kalendára (Gmail, Outlook, …) len so zdrojom LegalWork,
 * - natívne a ostatné úložiská sú v alfe viditeľné, ale vyblednuté (`alpha-storage.ts`),
 * - tímové položky firmy (firemný hub Eigenwelt) sa neukážu, kým je plocha `firm-hub` skrytá.
 * Existujúce pripojenie sa ukáže vždy, aby ho advokát mohol spravovať alebo odstrániť.
 */
import { ALPHA_STORAGE_CONNECTIONS_DISABLED } from "./alpha-storage";
import { isLegalworkSourceEnabled } from "./legalwork-source";
import { isCommercialSurfaceHidden } from "@/lawoss/feature-flags";

/** Natívny konektor sa v katalógu ponúkne? Úložiská áno (v alfe vyblednuté), pošta a kalendár len so zdrojom LegalWork. */
export function isNativeConnectorOffered(kind: string, installed: boolean): boolean {
  return installed || kind === "files" || isLegalworkSourceEnabled();
}

/** Nové pripojenie úložiska (natívneho aj iného) sa v alfe nedá zvoliť. Existujúce ostáva spravovateľné. */
export function isNewStorageDisabled(isStorage: boolean, existing: boolean): boolean {
  return ALPHA_STORAGE_CONNECTIONS_DISABLED && isStorage && !existing;
}

/** Tímové položky firemného hubu (Eigenwelt) bez zapnutej plochy `firm-hub` nezobrazovať. */
export function areFirmItemsHidden(): boolean {
  return isCommercialSurfaceHidden("firm-hub");
}

/** Kategória „Rozšírenia Eigenwelt“ má položky len zo zdroja LegalWork; bez neho sa v navigácii neukáže. */
export function visibleConnectorCategories<T extends string>(categories: readonly T[]): T[] {
  return isLegalworkSourceEnabled() ? [...categories] : categories.filter(category => category !== "eigenwelt");
}
