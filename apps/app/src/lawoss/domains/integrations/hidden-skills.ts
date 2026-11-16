import { useEffect, useState } from "react";

import { LEGALWORK_EXTENSION_STATE_CHANGED, isLegalWorkExtensionHidden } from "@/react-app/domains/settings/extension-state";

/**
 * Nastavenia → Workflows → Skills ukazujú len skilly, ktoré nie sú skryté (#514).
 * Rovnaká voľba ako v katalógu integrácií a v ponuke „/“: balíky lehôt LegalWorku sú
 * predvolene skryté (`isSkillHiddenByDefault`, N-A3-4) a advokát ich môže v katalógu odkryť.
 */
export function visibleSettingsSkills<T extends { name: string }>(skills: readonly T[]): T[] {
  return skills.filter((skill) => !isLegalWorkExtensionHidden(`skill:${skill.name}`));
}

/** Verzia, ktorá sa zvýši pri každej zmene skrytia v katalógu, aby sa zoznam prepočítal. */
export function useExtensionHiddenVersion(): number {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const refresh = () => setVersion((value) => value + 1);
    window.addEventListener(LEGALWORK_EXTENSION_STATE_CHANGED, refresh);
    window.addEventListener("storage", refresh);
    return () => {
      window.removeEventListener(LEGALWORK_EXTENSION_STATE_CHANGED, refresh);
      window.removeEventListener("storage", refresh);
    };
  }, []);
  return version;
}
