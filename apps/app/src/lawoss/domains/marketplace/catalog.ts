import { currentLocale, t, type Language } from "@/i18n";

export type MarketplaceKind = "mcp" | "skill" | "cli" | "workflow" | "plugin";
export type MarketplaceChannel = "stable" | "lab" | "community" | "private";
export type MarketplaceRisk = "read-only" | "local-write" | "network" | "external-action";
export type MarketplaceVerificationStatus = "verified" | "review" | "unverified";

export type MarketplaceEntry = {
  id: string;
  name: string;
  description: string;
  kind: MarketplaceKind;
  channel: MarketplaceChannel;
  jurisdictions: readonly string[];
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

export type MarketplaceFilters = {
  kind?: MarketplaceKind | "all";
  channel?: MarketplaceChannel | "all";
};

export type InstallationPreview = {
  scope: MarketplaceEntry["install"]["scope"];
  source: string;
  capabilities: readonly MarketplaceRisk[];
  humanGate: string;
  status: "preview-only";
};

export const MARKETPLACE_CATALOG: readonly MarketplaceEntry[] = [
  {
    id: "okf", name: "OKF — klienti, veci a pamäť", kind: "plugin", channel: "lab",
    description: "Dva lokálne skilly s pribalenými nástrojmi: založenie veci a trvalá pamäť so zdrojmi a históriou.",
    jurisdictions: ["SK", "CZ"], source: { repository: "Omni-Legal-Products/lawoss", ref: "súčasť tejto aplikácie" },
    dependencies: ["Node.js 24"], capabilities: ["local-write"],
    verification: { status: "review", checkedAt: "2026-09-20" },
    humanGate: "Zápisy do veci sa vykonajú po potvrdení zobrazeného plánu.",
    install: { scope: "workspace", action: "okf" },
  },
  ...[
    { id: "orsr", name: "Obchodný register SR", description: "Lokálne MCP a skill na čítanie verejných údajov ORSR." },
    { id: "slovlex", name: "Slov-Lex", description: "Lokálne MCP a skill na čítanie slovenských právnych predpisov." },
  ].map((item): MarketplaceEntry => ({
    ...item, kind: "plugin", channel: "lab", jurisdictions: ["SK"],
    source: { repository: "Omni-Legal-Products/lawoss-marketplace", ref: "deff09cf87c6e81bfbeebadf675a67b698920be6" },
    dependencies: ["Node.js 22.14+", "npm pre prvý štart", "internet pre verejné zdroje"],
    capabilities: ["read-only", "network", "local-write"],
    verification: { status: "review", checkedAt: "2026-09-20" },
    humanGate: "Inštalácia uloží a spustí lokálny MCP. Výsledok registra alebo rešerše posúďte podľa zdroja a dátumu.",
    install: { scope: "workspace", action: "plugin", path: `plugins/${item.id}` },
  })),
];

/** Resolve display copy at render time; immutable install identities stay unchanged. */
export function getMarketplaceCatalog(locale: Language = currentLocale()): readonly MarketplaceEntry[] {
  return MARKETPLACE_CATALOG.map((entry) => ({
    ...entry,
    name: entry.id === "slovlex" ? entry.name : t(`lawoss.integrations.catalog.${entry.id}_name`, locale),
    description: t(`lawoss.integrations.catalog.${entry.id}_description`, locale),
    humanGate: t(entry.install.action === "okf" ? "lawoss.integrations.catalog.okf_gate" : "lawoss.integrations.catalog.plugin_gate", locale),
    source: entry.install.action === "okf" ? { ...entry.source, ref: t("lawoss.integrations.catalog.bundled", locale) } : entry.source,
    dependencies: entry.install.action === "okf" ? entry.dependencies : ["Node.js 22.14+", t("lawoss.integrations.catalog.npm", locale), t("lawoss.integrations.catalog.internet", locale)],
  }));
}

export function filterMarketplaceEntries(
  entries: readonly MarketplaceEntry[],
  filters: MarketplaceFilters,
): MarketplaceEntry[] {
  const kind = filters.kind && filters.kind !== "all" ? filters.kind : undefined;
  const channel = filters.channel && filters.channel !== "all" ? filters.channel : undefined;

  return entries.filter((entry) => {
    if (kind && entry.kind !== kind) return false;
    if (channel && entry.channel !== channel) return false;
    return true;
  });
}

export function installationPreview(entry: MarketplaceEntry): InstallationPreview {
  return {
    scope: entry.install.scope,
    source: `${entry.source.repository}@${entry.source.ref}`,
    capabilities: entry.capabilities,
    humanGate: entry.humanGate,
    status: "preview-only",
  };
}
