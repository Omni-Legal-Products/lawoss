// LAWOSS: `bun test` spúšťa všetky súbory v jednom procese a jazyk appky (src/i18n) je globálny stav modulu.
// Testy obnovujú voľbu „Systém“, ktorá bez `navigator.languages` v Bune znamená slovenčinu, nie počiatočnú
// angličtinu, a poradie súborov sa líši podľa stroja. Preto každý test začína a končí v počiatočnom stave.
import { afterEach, beforeEach } from "bun:test";
import { resetLocaleForTests } from "./src/i18n";

beforeEach(resetLocaleForTests);
afterEach(resetLocaleForTests);
