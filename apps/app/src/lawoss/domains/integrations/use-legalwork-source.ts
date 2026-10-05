import { useSyncExternalStore } from "react";

import { isLegalworkSourceEnabled, subscribeLegalworkSource } from "./legalwork-source";

/** Voľba zdroja LegalWork; prekreslí sa, keď ju advokát prepne. Bez úložiska je vypnutá. */
export function useLegalworkSource(): boolean {
  return useSyncExternalStore(subscribeLegalworkSource, isLegalworkSourceEnabled, isLegalworkSourceEnabled);
}
