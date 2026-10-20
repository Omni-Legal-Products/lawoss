/** Trasy LAWOSS-lite. Věc se vybírá parametrem `?vec=<cesta>` jako u pro detailu spisu. */
export const LITE_TODAY_PATH = "/dnes";
export const LITE_CLIENTS_PATH = "/klienti";
export const LITE_MATTER_PATH = "/vec";
/** Nová vec cez ten istý formulár s náhľadom a potvrdením ako bočný panel (nie technický Nový spis). */
export const NEW_MATTER_PATH = "/welcome?continue=matter";
/** Nový klient cez ten istý tok ako úvodná obrazovka; viditeľné tlačidlo „Pridať klienta“ na stránke Klienti. */
export const NEW_CLIENT_PATH = "/welcome?continue=client";
/** Pripojiť priečinok (klient, prax, vec) cez obrazovku „Toto som našiel“ (spec 2026-10-08). */
export const ADD_FOLDER_PATH = "/welcome?continue=folder";
/** Staré meno pre tlačidlá „Pripojiť existujúci priečinok klienta“; vedie na ten istý tok. */
export const ATTACH_EXISTING_CLIENT_PATH = ADD_FOLDER_PATH;
/** „Usporiadať podľa OKF“ pre už pripojený priečinok: rovno obrazovka „Toto som našiel“. */
export const organizeFolderLink = (root: string): string => `${ADD_FOLDER_PATH}&root=${encodeURIComponent(root)}`;

export const liteMatterLink = (path: string): string => `${LITE_MATTER_PATH}?vec=${encodeURIComponent(path)}`;

/** Prehľad jedného klienta na stránke Klienti a veci (`?klient=<kľúč skupiny>`, kľúč z `groupByClient`). */
export const clientOverviewLink = (key: string): string => `${LITE_CLIENTS_PATH}?klient=${encodeURIComponent(key)}`;

/** Odkaz na konkrétnu lehotu v detaile veci: otvorí vec, posunie sa na lehotu a krátko ju zvýrazní. */
export const liteDeadlineLink = (path: string, recordId: string, date: string): string =>
  `${liteMatterLink(path)}&lehota=${encodeURIComponent(`${recordId}@${date}`)}`;

/** Register lehôt (`/lehoty`); `?klient=<id priečinka>` ho obmedzí na veci jedného klienta (bočný panel, Domov klienta). */
export const LEHOTY_PATH = "/lehoty";
export const clientDeadlinesLink = (workspaceId: string): string => `${LEHOTY_PATH}?klient=${encodeURIComponent(workspaceId)}`;
