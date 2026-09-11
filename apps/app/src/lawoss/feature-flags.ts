/**
 * LAWOSS: plochy zdedené z LegalWorku, ktoré v našom produkte nedávajú zmysel.
 *
 * Zámerne **skrývame, nemažeme**. Upstream kód ostáva na disku nedotknutý,
 * takže sync z upstreamu nemá na čom konfliktovať a prípadný návrat je zmena
 * jedného riadku tu.
 */

/** Záložky nastavení, ktoré sa nezobrazia. */
export const HIDDEN_SETTINGS_TABS: ReadonlySet<string> = new Set<string>([
  // Prihlásenie, plán a fakturácia dodávateľa upstreamu.
  "account",
  // Ich lokálny prepis reči; LAWOSS použije vlastné riešenie.
  "recorder",
]);

/** Odstráni skryté záložky a poradie zvyšku zachová. */
export const hideCommercialTabs = <T extends string>(tabs: T[]): T[] =>
  tabs.filter((tab) => !HIDDEN_SETTINGS_TABS.has(tab));

/** MCP servery, ktoré sa neponúkajú v rýchlom pripojení. */
export const HIDDEN_QUICK_CONNECT_SERVERS: ReadonlySet<string> = new Set<string>([
  // LegalMemory je pamäťová appliance dodávateľa upstreamu. Naša pamäť je OKF.
  // Keď sa neponúkne na pripojenie, celý jeho subsystém ostane nečinný a
  // nemusíme strážiť ~25 miest, kde sa inak renderuje.
  "legalmemory",
]);

export const isHiddenQuickConnect = (serverName: string): boolean =>
  HIDDEN_QUICK_CONNECT_SERVERS.has(serverName);

/**
 * Komerčné plochy upstreamu, ktoré prerastajú do záložiek, ktoré si necháme.
 * `firm-hub` je platené firemné zdieľanie, `trial-notice` je výzva na
 * predplatné nad session.
 */
export type CommercialSurface = "firm-hub" | "trial-notice";

export const HIDDEN_COMMERCIAL_SURFACES: ReadonlySet<CommercialSurface> = new Set<CommercialSurface>([
  "firm-hub",
  "trial-notice",
]);

export const isCommercialSurfaceHidden = (surface: CommercialSurface): boolean =>
  HIDDEN_COMMERCIAL_SURFACES.has(surface);
