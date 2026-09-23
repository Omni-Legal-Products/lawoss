/** Trasy LAWOSS-lite. Věc se vybírá parametrem `?vec=<cesta>` jako u pro detailu spisu. */
export const LITE_TODAY_PATH = "/dnes";
export const LITE_CLIENTS_PATH = "/klienti";
export const LITE_MATTER_PATH = "/vec";
export const NEW_MATTER_PATH = "/experimenty/novy-spis";

export const liteMatterLink = (path: string): string => `${LITE_MATTER_PATH}?vec=${encodeURIComponent(path)}`;
