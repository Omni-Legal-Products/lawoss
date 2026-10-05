/**
 * LAWOSS: základný balík pre alfu (rozhodnutie MČ 5. 10. 2026).
 *
 * - Vždy zapnuté, bez siete: DOCX Redline a PDF Tools (pribalené pluginy appky) a skilly OKF
 *   (`okfSkillPack`, pri OKF klientovi ich doplní `OkfWorkspaceSkillSync`).
 * - Predvolene zapnuté podľa jurisdikcie kancelárie z onboardingu: pluginy z `lawoss-marketplace`
 *   nižšie. Inštalácia ich sťahuje z GitHubu, preto sa nespúšťa potichu: v Integráciách sú
 *   predvolene zaškrtnuté a nainštalujú sa po jednom kliknutí advokáta na „Inštalovať“.
 * - Všetko ostatné z katalógu sa pridá ručne, bez ohľadu na jurisdikciu.
 *
 * Jediné miesto, kde sa balík mení.
 */
import type { Jurisdiction } from "../onboarding/api";
import { MARKETPLACE_CATALOG, type MarketplaceEntry } from "./catalog";

export const BASE_PACK: Readonly<Record<Jurisdiction, readonly string[]>> = {
  sk: ["slovlex", "orsr", "judikaty", "kalkulacky", "ruz", "rpo"],
  // Predbežné: čaká na schválenie VŘ.
  cz: ["cz-agents", "eurlex-celex"],
};

/** Ktoré jurisdikcie majú balík zatiaľ len predbežný (UI to povie). */
export const PROVISIONAL_BASE_PACK: ReadonlySet<Jurisdiction> = new Set<Jurisdiction>(["cz"]);

/** Položky katalógu v poradí balíka; neznáme id sa vynechá (test stráži, že žiadne nie je). */
export function basePackEntries(jurisdiction: Jurisdiction, catalog: readonly MarketplaceEntry[] = MARKETPLACE_CATALOG): MarketplaceEntry[] {
  return BASE_PACK[jurisdiction].flatMap((id) => catalog.filter((entry) => entry.id === id && entry.install.action === "plugin"));
}
