/**
 * LAWOSS: odporúčané balíky (rozhodnutie MČ 5. 10. 2026).
 *
 * - Vždy zapnuté, bez siete: DOCX Redline a PDF Tools (pribalené pluginy appky) a skilly OKF
 *   (`okfSkillPack`, pri OKF klientovi ich doplní `OkfWorkspaceSkillSync`).
 * - Odporúčané balíky (`SK základ`, `CZ základ`) sú definované v LAWOSS Marketplace
 *   (`lawoss-catalog.json`, pole `bundles`), nie v kóde appky. Balík jurisdikcie kancelárie
 *   je predvolene zaškrtnutý; dá sa odškrtnúť alebo pridať balík inej jurisdikcie.
 * - Inštalácia sťahuje z GitHubu, preto až po kliknutí advokáta, nikdy potichu.
 */
import type { Jurisdiction } from "../onboarding/api";
import { MARKETPLACE_CATALOG, MARKETPLACE_SNAPSHOT, type MarketplaceEntry, type MarketplaceSnapshot } from "./catalog";

export type RecommendedBundle = MarketplaceSnapshot["bundles"][number];

export function recommendedBundles(snapshot: MarketplaceSnapshot = MARKETPLACE_SNAPSHOT): RecommendedBundle[] {
  return snapshot.bundles.filter((bundle) => bundle.recommended === true);
}

/** Balíky jurisdikcie kancelárie (z onboardingu). */
export function officeBundles(jurisdiction: Jurisdiction, snapshot: MarketplaceSnapshot = MARKETPLACE_SNAPSHOT): RecommendedBundle[] {
  return recommendedBundles(snapshot).filter((bundle) => bundle.jurisdiction === jurisdiction.toUpperCase());
}

/** Položky katalógu v poradí balíka. */
export function bundleEntries(bundle: RecommendedBundle, catalog: readonly MarketplaceEntry[] = MARKETPLACE_CATALOG): MarketplaceEntry[] {
  return bundle.plugins.flatMap((id) => catalog.filter((entry) => entry.id === id && entry.install.action === "plugin"));
}
