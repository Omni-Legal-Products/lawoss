/**
 * LAWOSS: prepnutie zdroja LegalWork za behu, bez zmeny upstream súborov.
 *
 * `app/constants.ts` počíta `MCP_QUICK_CONNECT` (filter cez `isHiddenQuickConnect`) a
 * `LEGALWORK_EXTENSION_CATALOG` raz pri načítaní. Všetci spotrebitelia (store pripojení,
 * Integrácie, composer, @App zmienky, prihlásenie k MCP) držia odkaz na tieto dve polia,
 * preto ich po zmene voľby prepíšeme na mieste (rovnaké pole, nový obsah) a vyšleme
 * upstream udalosť `LEGALWORK_EXTENSION_STATE_CHANGED`, na ktorú sa Integrácie a composer
 * prekreslia. Žiadne sieťové volanie: položky sa len zobrazia alebo skryjú, pripojenie
 * stále začína až kliknutím advokáta.
 *
 * Stráž `lawoss/scripts/check-no-eigenwelt.mjs` overuje, že `constants.ts` obe polia
 * stále vystavuje ako meniteľné a filtrované cez `isHiddenQuickConnect`.
 */
import { LEGALWORK_EXTENSION_CATALOG, MCP_QUICK_CONNECT, MCP_QUICK_CONNECT_ALL } from "@/app/constants";
import { isHiddenQuickConnect } from "@/lawoss/feature-flags";
import { LEGALWORK_EXTENSION_STATE_CHANGED } from "@/react-app/domains/settings/extension-state";

import { setLegalworkSourceEnabled } from "./legalwork-source";

/** Zosúladí katalógy rýchleho pripojenia s aktuálnou voľbou zdroja. */
export function applyLegalworkSource(): void {
  const visible = MCP_QUICK_CONNECT_ALL.filter((entry) => !isHiddenQuickConnect(entry.serverName ?? ""));
  MCP_QUICK_CONNECT.splice(0, MCP_QUICK_CONNECT.length, ...visible);
  LEGALWORK_EXTENSION_CATALOG.splice(
    0,
    LEGALWORK_EXTENSION_CATALOG.length,
    ...visible.filter((entry) => entry.kind === "extension"),
  );
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(new CustomEvent(LEGALWORK_EXTENSION_STATE_CHANGED, { detail: { id: "lawoss:legalwork-source" } }));
  }
}

/** Voľba advokáta v Integráciách: uloží ju a hneď ju premietne do katalógov. */
export function setLegalworkSource(enabled: boolean): void {
  setLegalworkSourceEnabled(enabled);
  applyLegalworkSource();
}
