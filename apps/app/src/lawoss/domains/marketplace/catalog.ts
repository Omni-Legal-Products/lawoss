export type MarketplaceKind = "mcp" | "skill" | "cli" | "workflow";
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
    action: "preview-only";
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
    id: "slov-lex",
    name: "Slov-Lex",
    description: "Overené znenia právnych predpisov Slovenskej republiky cez read-only MCP konektor.",
    kind: "mcp",
    channel: "stable",
    jurisdictions: ["SK"],
    source: { repository: "Omni-Legal-Products/lawoss-registry", ref: "v1.2.0" },
    dependencies: [],
    capabilities: ["read-only", "network"],
    verification: { status: "verified", checkedAt: "2026-09-01" },
    humanGate: "Výsledok musí advokát overiť proti účinnému zneniu a citácii.",
    install: { scope: "workspace", action: "preview-only" },
  },
  {
    id: "lawoss-source-coverage",
    name: "Source Coverage",
    description: "Kontrolovaný právny výskum so stopou zdrojov, jurisdikcie a dátumu overenia.",
    kind: "skill",
    channel: "stable",
    jurisdictions: ["SK", "CZ", "EU"],
    source: { repository: "Omni-Legal-Products/lawoss", ref: "lawoss-legal@v1" },
    dependencies: ["Slov-Lex", "Judikatúra SR alebo ČR"],
    capabilities: ["read-only"],
    verification: { status: "verified", checkedAt: "2026-09-02" },
    humanGate: "Právny záver zostáva návrhom; advokát schvaľuje použité autority.",
    install: { scope: "workspace", action: "preview-only" },
  },
  {
    id: "okf-cli",
    name: "OKF workspace tools",
    description: "Lokálne založenie, validácia a kontrola čerstvosti štruktúrovaného spisu.",
    kind: "cli",
    channel: "stable",
    jurisdictions: ["SK", "CZ"],
    source: { repository: "Omni-Legal-Products/lawoss", ref: "okf@v0.1" },
    dependencies: ["OKF workspace"],
    capabilities: ["local-write"],
    verification: { status: "verified", checkedAt: "2026-09-03" },
    humanGate: "Pred zápisom do spisu sa zobrazí plán a vyžaduje potvrdenie advokáta.",
    install: { scope: "workspace", action: "preview-only" },
  },
  {
    id: "docx-redline-workflow",
    name: "DOCX Redline",
    description: "Workflow pre čítanie, úpravu a kontrolu zmien v dokumentoch Word.",
    kind: "workflow",
    channel: "stable",
    jurisdictions: ["SK", "CZ", "EU"],
    source: { repository: "Omni-Legal-Products/lawoss", ref: "lawoss-legal@v1" },
    dependencies: ["docx-edit skill", "lokálny DOCX editor"],
    capabilities: ["local-write"],
    verification: { status: "verified", checkedAt: "2026-09-03" },
    humanGate: "Pôvodný dokument zostáva zachovaný; advokát kontroluje a prijíma zmeny.",
    install: { scope: "workspace", action: "preview-only" },
  },
  {
    id: "zako-engine",
    name: "ZaKo engine",
    description: "Experimentálny konektor pre napojenie schváleného právneho registra alebo engine.",
    kind: "mcp",
    channel: "lab",
    jurisdictions: ["SK"],
    source: { repository: "Omni-Legal-Products/lawoss-registry", ref: "zako-engine@next" },
    dependencies: ["schválený OAuth klient", "ZaKo endpoint"],
    capabilities: ["network", "external-action"],
    verification: { status: "review", checkedAt: "2026-08-28" },
    humanGate: "Konektor sa smie aktivovať až po schválení registrácie, scopes a dátového toku.",
    install: { scope: "workspace", action: "preview-only" },
  },
  {
    id: "isds-community",
    name: "ISDS datová schránka",
    description: "Komunitný návrh na čítanie českých doručeniek; zatiaľ nie je overený LAWOSS tímom.",
    kind: "mcp",
    channel: "community",
    jurisdictions: ["CZ"],
    source: { repository: "community/unverified-isds", ref: "main" },
    dependencies: ["posúdenie prevádzkovateľa", "vlastná autentizácia"],
    capabilities: ["network", "external-action"],
    verification: { status: "unverified", checkedAt: "2026-08-20" },
    humanGate: "Nepoužívať v klientskom spise bez samostatného bezpečnostného a právneho posúdenia.",
    install: { scope: "workspace", action: "preview-only" },
  },
] as const;

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
