import { currentLocale, t, type Language } from "@/i18n";

import snapshotJson from "./marketplace-snapshot.json";

/**
 * LAWOSS Marketplace (rozhodnutie MČ 5. 10. 2026): kanonický katalóg je repozitár
 * `Omni-Legal-Products/lawoss-marketplace`. Zoznam pluginov, kategórie, jurisdikcie,
 * balíky a ich názvy appka v kóde nedrží; číta pribalenú kópiu
 * `marketplace-snapshot.json` (obnovuje ju `lawoss/scripts/update-marketplace-snapshot.mjs`).
 * V kóde ostáva len OKF, ktoré je súčasťou aplikácie.
 */

type MarketplaceKind = "mcp" | "skill" | "cli" | "workflow" | "plugin";
type MarketplaceChannel = "stable" | "lab" | "community" | "private";
type MarketplaceRisk = "read-only" | "local-write" | "network" | "external-action";
type MarketplaceVerificationStatus = "verified" | "review" | "unverified";
type LocalizedText = Record<Language, string>;
export type CatalogJurisdiction = "SK" | "CZ" | "EU";
export type CatalogCategoryKind = "jurisdiction" | "general" | "bundles";

export type MarketplaceSnapshot = {
  schemaVersion: 1;
  name: string;
  repository: string;
  /** Jeden pripnutý commit marketplace, z ktorého sa inštaluje. */
  ref: string;
  /** Commit, z ktorého sú metadáta (kategórie, balíky, texty). */
  metadataRef: string;
  categories: Array<{ id: string; kind: CatalogCategoryKind; jurisdiction?: CatalogJurisdiction; title: LocalizedText }>;
  plugins: Array<{
    name: string;
    version: string;
    path: string;
    /** `null`: plugin na spoločnom SHA ešte nie je (čaká na push), inštalácia sa odmietne. */
    ref: string | null;
    kind: "mcp-skill-cli" | "skill-only";
    category: string;
    jurisdictions: CatalogJurisdiction[];
    title: LocalizedText;
    summary: LocalizedText;
  }>;
  bundles: Array<{
    id: string;
    category: string;
    jurisdiction: CatalogJurisdiction;
    recommended?: boolean;
    provisional?: boolean;
    plugins: string[];
    title: LocalizedText;
    summary: LocalizedText;
  }>;
};

// JSON sa načíta ako široký typ; tvar stráži `update-marketplace-snapshot.mjs --check` a test.
export const MARKETPLACE_SNAPSHOT: MarketplaceSnapshot = snapshotJson as MarketplaceSnapshot;

export type MarketplaceEntry = {
  id: string;
  name: string;
  description: string;
  kind: MarketplaceKind;
  channel: MarketplaceChannel;
  /** Kategória z marketplace (`sk`, `cz`, `general`); OKF je `bundled`. */
  category: string;
  jurisdictions: readonly CatalogJurisdiction[];
  /** Verzia v katalógu; porovnáva sa s nainštalovanou (`provenance.version`). */
  version: string | null;
  source: {
    repository: string;
    ref: string;
  };
  dependencies: readonly string[];
  capabilities: readonly MarketplaceRisk[];
  verification: {
    status: MarketplaceVerificationStatus;
    checkedAt: string;
  };
  humanGate: string;
  install: {
    scope: "workspace" | "global";
    action: "preview-only" | "plugin" | "okf";
    path?: string;
  };
};

/** Hodnota v `source.ref`, keď plugin na pripnutom SHA ešte nie je. Nie je to SHA. */
export const PENDING_REF = "caka-na-push";

const OKF_ENTRY: MarketplaceEntry = {
  id: "okf", name: "OKF: klienti, veci a pamäť", kind: "plugin", channel: "lab", category: "bundled",
  description: "Lokálne skilly s pribalenými nástrojmi.",
  jurisdictions: ["SK", "CZ"], version: null, source: { repository: "Omni-Legal-Products/lawoss", ref: "súčasť tejto aplikácie" },
  dependencies: ["Node.js 24"], capabilities: ["local-write"],
  verification: { status: "review", checkedAt: "2026-09-20" },
  humanGate: "Zápisy do veci sa vykonajú po potvrdení zobrazeného plánu.",
  install: { scope: "workspace", action: "okf" },
};

function snapshotEntry(plugin: MarketplaceSnapshot["plugins"][number], snapshot: MarketplaceSnapshot): MarketplaceEntry {
  const skillOnly = plugin.kind === "skill-only";
  return {
    id: plugin.name, name: plugin.title.sk, description: plugin.summary.sk,
    kind: skillOnly ? "skill" : "plugin", channel: "lab", category: plugin.category,
    jurisdictions: plugin.jurisdictions, version: plugin.version,
    source: { repository: snapshot.repository, ref: plugin.ref ?? PENDING_REF },
    dependencies: skillOnly ? [] : ["Node.js 22.14+", "npm", "internet"],
    capabilities: skillOnly ? ["read-only", "network", "external-action"] : ["read-only", "network", "local-write"],
    verification: { status: "review", checkedAt: "2026-10-05" },
    humanGate: skillOnly
      ? "Inštalácia uloží len skilly. Odoslanie alebo zmena len po výslovnom potvrdení advokáta."
      : "Inštalácia uloží a spustí lokálny MCP. Výsledok registra alebo rešerše posúďte podľa zdroja a dátumu.",
    install: { scope: "workspace", action: "plugin", path: plugin.path },
  };
}

export function catalogFromSnapshot(snapshot: MarketplaceSnapshot = MARKETPLACE_SNAPSHOT): readonly MarketplaceEntry[] {
  return [OKF_ENTRY, ...snapshot.plugins.map((plugin) => snapshotEntry(plugin, snapshot))];
}

export const MARKETPLACE_CATALOG: readonly MarketplaceEntry[] = catalogFromSnapshot();

function localizedPlugin(id: string, locale: Language) {
  const plugin = MARKETPLACE_SNAPSHOT.plugins.find((item) => item.name === id);
  return plugin ? { name: plugin.title[locale], description: plugin.summary[locale], skillOnly: plugin.kind === "skill-only" } : null;
}

/** Resolve display copy at render time; immutable install identities stay unchanged. */
export function getMarketplaceCatalog(locale: Language = currentLocale()): readonly MarketplaceEntry[] {
  return MARKETPLACE_CATALOG.map((entry) => {
    if (entry.install.action === "okf") {
      return {
        ...entry,
        name: t("lawoss.integrations.catalog.okf_name", locale),
        description: t("lawoss.integrations.catalog.okf_description", locale),
        humanGate: t("lawoss.integrations.catalog.okf_gate", locale),
        source: { ...entry.source, ref: t("lawoss.integrations.catalog.bundled", locale) },
      };
    }
    const copy = localizedPlugin(entry.id, locale);
    return {
      ...entry,
      name: copy?.name ?? entry.name,
      description: copy?.description ?? entry.description,
      humanGate: t(copy?.skillOnly ? "lawoss.integrations.catalog.skill_only_gate" : "lawoss.integrations.catalog.plugin_gate", locale),
      dependencies: copy?.skillOnly
        ? [t("lawoss.integrations.catalog.skill_only_requires", locale)]
        : ["Node.js 22.14+", t("lawoss.integrations.catalog.npm", locale), t("lawoss.integrations.catalog.internet", locale)],
    };
  });
}

/** Kategórie z marketplace v poradí katalógu, s názvom v jazyku appky. */
export function marketplaceCategories(locale: Language = currentLocale()) {
  return MARKETPLACE_SNAPSHOT.categories.map((category) => ({ ...category, label: category.title[locale] }));
}
