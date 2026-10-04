/** Trasy LAWOSS-lite. Věc se vybírá parametrem `?vec=<cesta>` jako u pro detailu spisu. */
export const LITE_TODAY_PATH = "/dnes";
export const LITE_CLIENTS_PATH = "/klienti";
export const LITE_MATTER_PATH = "/vec";
/** Nová vec cez ten istý formulár s náhľadom a potvrdením ako bočný panel (nie technický Nový spis). */
export const NEW_MATTER_PATH = "/welcome?continue=matter";

export const liteMatterLink = (path: string): string => `${LITE_MATTER_PATH}?vec=${encodeURIComponent(path)}`;

/** Odkaz na konkrétnu lehotu v detaile veci: otvorí vec, posunie sa na lehotu a krátko ju zvýrazní. */
export const liteDeadlineLink = (path: string, recordId: string, date: string): string =>
  `${liteMatterLink(path)}&lehota=${encodeURIComponent(`${recordId}@${date}`)}`;
