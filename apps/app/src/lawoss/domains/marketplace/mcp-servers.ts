/**
 * LAWOSS: konektory (MCP) doplnkov z LAWOSS Marketplace podľa mena servera. Konektory ich bez toho ukazovali ako
 * „slovlex · Vlastný konektor“ a chat krok `slovlex_get_law` ako „Čítanie súborov“ (test inštalácie 3. 11. 2026).
 * Kľúče sú mená serverov z `.mcp.json` doplnkov v lawoss-marketplace na `ref` snapshotu; meno doplnku sa od mena
 * servera môže líšiť (`fs-opendata-mcp` → `fs_opendata_mcp`, `cz-agents` má osem serverov `cz_*`).
 */
import { currentLocale, type Language } from "@/i18n";
import { MARKETPLACE_SNAPSHOT } from "./catalog";

const SERVER_PLUGINS: Readonly<Record<string, string>> = {
  slovlex: "slovlex",
  orsr: "orsr",
  judikaty: "judikaty",
  kalkulacky: "kalkulacky",
  ruz: "ruz",
  rpo: "rpo",
  crz: "crz",
  ov: "ov",
  rpvs: "rpvs",
  ru: "ru",
  disq: "disq",
  fs_opendata_mcp: "fs-opendata-mcp",
  uvo: "uvo",
  eurlex_celex: "eurlex-celex",
  cz_ares: "cz-agents",
  cz_cnb: "cz-agents",
  cz_sanctions: "cz-agents",
  cz_isir: "cz-agents",
  cz_adis: "cz-agents",
  cz_dd: "cz-agents",
  cz_realestate: "cz-agents",
  "cz_eu-registry": "cz-agents",
};

export const MARKETPLACE_MCP_SERVERS: readonly string[] = Object.keys(SERVER_PLUGINS);

export type MarketplaceConnector = { plugin: string; title: string; summary: string };

/** Konektor doplnku z LAWOSS Marketplace podľa mena MCP servera, inak `null`. */
export function marketplaceConnector(server: string, locale: Language = currentLocale()): MarketplaceConnector | null {
  const plugin = Object.hasOwn(SERVER_PLUGINS, server) ? SERVER_PLUGINS[server] : undefined;
  const entry = plugin ? MARKETPLACE_SNAPSHOT.plugins.find((item) => item.name === plugin) : undefined;
  return entry ? { plugin: entry.name, title: entry.title[locale], summary: entry.summary[locale] } : null;
}

/** Engine pomenúva nástroje MCP `<server>_<nástroj>`; najdlhší zhodný server vyhrá. */
export function marketplaceToolConnector(toolName: string, locale: Language = currentLocale()): MarketplaceConnector | null {
  const server = MARKETPLACE_MCP_SERVERS
    .filter((name) => toolName.startsWith(`${name}_`))
    .sort((left, right) => right.length - left.length)[0];
  return server ? marketplaceConnector(server, locale) : null;
}
