import { currentLocale, t, type Language } from "@/i18n";

type MarketplaceKind = "mcp" | "skill" | "cli" | "workflow" | "plugin";
type MarketplaceChannel = "stable" | "lab" | "community" | "private";
type MarketplaceRisk = "read-only" | "local-write" | "network" | "external-action";
type MarketplaceVerificationStatus = "verified" | "review" | "unverified";
/** Označenie v katalógu; katalóg ukazuje všetky balíky bez ohľadu na jurisdikciu kancelárie. */
export type CatalogJurisdiction = "SK" | "CZ" | "EU";

export type MarketplaceEntry = {
  id: string;
  name: string;
  description: string;
  kind: MarketplaceKind;
  channel: MarketplaceChannel;
  jurisdictions: readonly CatalogJurisdiction[];
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

export const LAWOSS_MARKETPLACE_REPOSITORY = "Omni-Legal-Products/lawoss-marketplace";
/** Jeden pripnutý commit `lawoss-marketplace` pre všetky jeho pluginy (`origin/main` k 5. 10. 2026). */
export const LAWOSS_MARKETPLACE_REF = "deff09cf87c6e81bfbeebadf675a67b698920be6";
/**
 * Google Workspace cez gog je zatiaľ len na vetve `feat/google-workspace-gog` marketplace.
 * Zástupná hodnota (nie SHA): katalóg ju ukáže, ale inštalácia skončí hláškou „bez
 * podporovaného pripnutého balíka“, kým sa sem nedoplní SHA commitu dostupného na GitHube.
 * Po zlúčení do `main` stačí tento riadok nahradiť `LAWOSS_MARKETPLACE_REF`.
 */
export const GOOGLE_WORKSPACE_GOG_REF = "doplnit-sha-po-pushi";

/** Statické kľúče textov (i18n audit nepripúšťa kľúče skladané za behu). */
type CatalogCopy = { nameKey?: string; descriptionKey: string };

const PLUGIN_COPY: Record<string, CatalogCopy> = {
  slovlex: { descriptionKey: "lawoss.integrations.catalog.slovlex_description" },
  orsr: { nameKey: "lawoss.integrations.catalog.orsr_name", descriptionKey: "lawoss.integrations.catalog.orsr_description" },
  judikaty: { nameKey: "lawoss.integrations.catalog.judikaty_name", descriptionKey: "lawoss.integrations.catalog.judikaty_description" },
  kalkulacky: { nameKey: "lawoss.integrations.catalog.kalkulacky_name", descriptionKey: "lawoss.integrations.catalog.kalkulacky_description" },
  ruz: { nameKey: "lawoss.integrations.catalog.ruz_name", descriptionKey: "lawoss.integrations.catalog.ruz_description" },
  rpo: { nameKey: "lawoss.integrations.catalog.rpo_name", descriptionKey: "lawoss.integrations.catalog.rpo_description" },
  crz: { nameKey: "lawoss.integrations.catalog.crz_name", descriptionKey: "lawoss.integrations.catalog.crz_description" },
  ov: { nameKey: "lawoss.integrations.catalog.ov_name", descriptionKey: "lawoss.integrations.catalog.ov_description" },
  rpvs: { nameKey: "lawoss.integrations.catalog.rpvs_name", descriptionKey: "lawoss.integrations.catalog.rpvs_description" },
  ru: { nameKey: "lawoss.integrations.catalog.ru_name", descriptionKey: "lawoss.integrations.catalog.ru_description" },
  disq: { nameKey: "lawoss.integrations.catalog.disq_name", descriptionKey: "lawoss.integrations.catalog.disq_description" },
  "fs-opendata-mcp": { nameKey: "lawoss.integrations.catalog.fs_name", descriptionKey: "lawoss.integrations.catalog.fs_description" },
  uvo: { nameKey: "lawoss.integrations.catalog.uvo_name", descriptionKey: "lawoss.integrations.catalog.uvo_description" },
  "eurlex-celex": { descriptionKey: "lawoss.integrations.catalog.eurlex_description" },
  "cz-agents": { nameKey: "lawoss.integrations.catalog.cz_agents_name", descriptionKey: "lawoss.integrations.catalog.cz_agents_description" },
};

const OKF_COPY: CatalogCopy = { nameKey: "lawoss.integrations.catalog.okf_name", descriptionKey: "lawoss.integrations.catalog.okf_description" };
const GOOGLE_WORKSPACE_COPY: CatalogCopy = {
  nameKey: "lawoss.integrations.catalog.google_workspace_name",
  descriptionKey: "lawoss.integrations.catalog.google_workspace_description",
};

/** Pluginy `lawoss-marketplace` s lokálnym MCP, skillom a CLI. Poradie = poradie v katalógu. */
const MARKETPLACE_PLUGINS: ReadonlyArray<{ id: string; name: string; description: string; jurisdictions: readonly CatalogJurisdiction[] }> = [
  { id: "slovlex", name: "Slov-Lex", description: "Lokálne MCP a skill na čítanie slovenských právnych predpisov.", jurisdictions: ["SK"] },
  { id: "orsr", name: "Obchodný register SR", description: "Lokálne MCP a skill na čítanie verejných údajov ORSR.", jurisdictions: ["SK"] },
  { id: "judikaty", name: "Judikáty SR", description: "Rozhodnutia slovenských súdov, NS SR a ÚS SR.", jurisdictions: ["SK"] },
  { id: "kalkulacky", name: "Právne kalkulačky SR", description: "Súdne poplatky, trovy, úroky z omeškania.", jurisdictions: ["SK"] },
  { id: "ruz", name: "Register účtovných závierok", description: "Účtovné závierky a finančné údaje firiem.", jurisdictions: ["SK"] },
  { id: "rpo", name: "Register právnických osôb", description: "Identifikačné údaje právnických osôb.", jurisdictions: ["SK"] },
  { id: "crz", name: "Centrálny register zmlúv", description: "Zmluvy verejného sektora.", jurisdictions: ["SK"] },
  { id: "ov", name: "Obchodný vestník", description: "Oznámenia v Obchodnom vestníku.", jurisdictions: ["SK"] },
  { id: "rpvs", name: "Register partnerov verejného sektora", description: "Partneri verejného sektora a koneční užívatelia výhod.", jurisdictions: ["SK"] },
  { id: "ru", name: "Register úpadcov", description: "Konkurzy, reštrukturalizácie a oddlženia.", jurisdictions: ["SK"] },
  { id: "disq", name: "Register diskvalifikácií", description: "Diskvalifikované osoby.", jurisdictions: ["SK"] },
  { id: "fs-opendata-mcp", name: "Finančná správa", description: "Otvorené dáta Finančnej správy SR.", jurisdictions: ["SK"] },
  { id: "uvo", name: "Verejné obstarávanie", description: "Vestník a zákazky ÚVO.", jurisdictions: ["SK"] },
  { id: "eurlex-celex", name: "EUR-Lex", description: "Právo EÚ podľa CELEX a ELI.", jurisdictions: ["EU"] },
  { id: "cz-agents", name: "České registre", description: "ARES, ČNB, insolvenčný register a ďalšie české zdroje.", jurisdictions: ["CZ"] },
];

export const MARKETPLACE_CATALOG: readonly MarketplaceEntry[] = [
  {
    id: "okf", name: "OKF — klienti, veci a pamäť", kind: "plugin", channel: "lab",
    description: "Lokálne skilly s pribalenými nástrojmi: založenie veci, trvalá pamäť, usporiadanie, roztriedenie a vyhotovenie dokumentu.",
    jurisdictions: ["SK", "CZ"], source: { repository: "Omni-Legal-Products/lawoss", ref: "súčasť tejto aplikácie" },
    dependencies: ["Node.js 24"], capabilities: ["local-write"],
    verification: { status: "review", checkedAt: "2026-09-20" },
    humanGate: "Zápisy do veci sa vykonajú po potvrdení zobrazeného plánu.",
    install: { scope: "workspace", action: "okf" },
  },
  ...MARKETPLACE_PLUGINS.map((item): MarketplaceEntry => ({
    ...item, kind: "plugin", channel: "lab",
    source: { repository: LAWOSS_MARKETPLACE_REPOSITORY, ref: LAWOSS_MARKETPLACE_REF },
    dependencies: ["Node.js 22.14+", "npm pre prvý štart", "internet pre verejné zdroje"],
    capabilities: ["read-only", "network", "local-write"],
    verification: { status: "review", checkedAt: "2026-10-05" },
    humanGate: "Inštalácia uloží a spustí lokálny MCP. Výsledok registra alebo rešerše posúďte podľa zdroja a dátumu.",
    install: { scope: "workspace", action: "plugin", path: `plugins/${item.id}` },
  })),
  {
    id: "google-workspace-gog", name: "Google Workspace cez gog", kind: "skill", channel: "lab",
    description: "Skill pre Gmail, Kalendár, Disk a Dokumenty cez lokálny nástroj gog.",
    jurisdictions: ["SK", "CZ"], source: { repository: LAWOSS_MARKETPLACE_REPOSITORY, ref: GOOGLE_WORKSPACE_GOG_REF },
    dependencies: ["gog (gogcli) 0.43+", "vlastný OAuth klient Google Cloud"],
    capabilities: ["read-only", "network", "external-action"],
    verification: { status: "review", checkedAt: "2026-10-05" },
    humanGate: "Inštalácia uloží len skill. Odoslanie alebo zmena len po výslovnom potvrdení advokáta.",
    install: { scope: "workspace", action: "plugin", path: "plugins/google-workspace-gog" },
  },
];

function copyFor(entry: MarketplaceEntry): CatalogCopy | undefined {
  if (entry.install.action === "okf") return OKF_COPY;
  if (entry.id === "google-workspace-gog") return GOOGLE_WORKSPACE_COPY;
  return PLUGIN_COPY[entry.id];
}

function dependenciesFor(entry: MarketplaceEntry, locale: Language): readonly string[] {
  if (entry.install.action === "okf") return entry.dependencies;
  if (entry.id === "google-workspace-gog") {
    return [t("lawoss.integrations.catalog.google_workspace_gog", locale), t("lawoss.integrations.catalog.google_workspace_oauth", locale)];
  }
  return ["Node.js 22.14+", t("lawoss.integrations.catalog.npm", locale), t("lawoss.integrations.catalog.internet", locale)];
}

function gateFor(entry: MarketplaceEntry, locale: Language): string {
  if (entry.install.action === "okf") return t("lawoss.integrations.catalog.okf_gate", locale);
  if (entry.id === "google-workspace-gog") return t("lawoss.integrations.catalog.google_workspace_gate", locale);
  return t("lawoss.integrations.catalog.plugin_gate", locale);
}

/** Resolve display copy at render time; immutable install identities stay unchanged. */
export function getMarketplaceCatalog(locale: Language = currentLocale()): readonly MarketplaceEntry[] {
  return MARKETPLACE_CATALOG.map((entry) => {
    const copy = copyFor(entry);
    return {
      ...entry,
      name: copy?.nameKey ? t(copy.nameKey, locale) : entry.name,
      description: copy ? t(copy.descriptionKey, locale) : entry.description,
      humanGate: gateFor(entry, locale),
      source: entry.install.action === "okf" ? { ...entry.source, ref: t("lawoss.integrations.catalog.bundled", locale) } : entry.source,
      dependencies: dependenciesFor(entry, locale),
    };
  });
}
