import type { Locale } from './settings.ts';
const cs = {
  horizon: 'Přehled do {n} dní, včetně prošlých a neplatných lhůt.',
  practice: 'Praxe', matter: 'Věc', deadlines: 'Lhůty', office: 'Kancelář', search: 'Hledat', all: 'Vše',
  empty: 'Žádné záznamy v načteném rozsahu.', loading: 'Načítání…', stale: 'Údaje nejsou aktuální', loaded: 'Načteno',
  partial: 'Neúplné pokrytí — zúžte rozsah v nastavení. Chybějící věci nejsou bez lhůt.',
  diagnostics: 'Diagnostika', source: 'Náhled zdroje', open: 'Otevřít v editoru', close: 'Zavřít náhled',
  editorNotice: 'Editor umožňuje ruční zápis mimo plugin. Při změně dodržte pravidla OKF a historii záznamu.',
  readonly: 'Pouze čtení · lokálně · bez synchronizace', clients: 'Klienti', matters: 'Věci', noMatter: 'Vyberte věc v přehledu praxe.',
  confirmed: 'Potvrzené lhůty', candidates: 'Kandidáti a lhůty k ověření', invalid: 'Neplatné datum — ověřit',
  today: 'dnes', tomorrow: 'zítra', overdue: 'po lhůtě', days: 'za {n} dní', records: 'Záznamy paměti',
  tasks: 'Otevřené úkoly', parties: 'Účastníci', events: 'Historie', manual: 'Ruční stav', missing: 'Chybějící vrstvy',
  unknown: 'Aktuálnost neznámá', dated: 'Deklarované datum', outdated: 'Starší než paměť',
  roots: 'Rozsah OKF', rootsDescription: 'Jedna cesta relativní k vaultu na řádek. Tečka znamená celý vault. Nic se nepřesouvá ani nekopíruje.',
  language: 'Jazyk', save: 'Uložit nastavení', badSettings: 'Nastavení nebylo uloženo: neplatný rozsah.',
  refresh: 'Obnovit', unavailable: 'Zdroj není dostupný v povoleném rozsahu.', raw: 'Původní text bez aktivních embedů',
};
const sk: typeof cs = {
  horizon: 'Prehľad do {n} dní, vrátane uplynutých a neplatných lehôt.',
  practice: 'Prax', matter: 'Vec', deadlines: 'Lehoty', office: 'Kancelária', search: 'Hľadať', all: 'Všetko',
  empty: 'Žiadne záznamy v načítanom rozsahu.', loading: 'Načítavanie…', stale: 'Údaje nie sú aktuálne', loaded: 'Načítané',
  partial: 'Neúplné pokrytie — zúžte rozsah v nastaveniach. Chýbajúce veci nie sú bez lehôt.',
  diagnostics: 'Diagnostika', source: 'Náhľad zdroja', open: 'Otvoriť v editore', close: 'Zavrieť náhľad',
  editorNotice: 'Editor umožňuje ručný zápis mimo pluginu. Pri zmene dodržte pravidlá OKF a históriu záznamu.',
  readonly: 'Iba čítanie · lokálne · bez synchronizácie', clients: 'Klienti', matters: 'Veci', noMatter: 'Vyberte vec v prehľade praxe.',
  confirmed: 'Potvrdené lehoty', candidates: 'Kandidáti a lehoty na overenie', invalid: 'Neplatný dátum — overiť',
  today: 'dnes', tomorrow: 'zajtra', overdue: 'po lehote', days: 'o {n} dní', records: 'Záznamy pamäte',
  tasks: 'Otvorené úlohy', parties: 'Účastníci', events: 'História', manual: 'Ručný stav', missing: 'Chýbajúce vrstvy',
  unknown: 'Aktuálnosť neznáma', dated: 'Deklarovaný dátum', outdated: 'Starší než pamäť',
  roots: 'Rozsah OKF', rootsDescription: 'Jedna cesta relatívna k vaultu na riadok. Bodka znamená celý vault. Nič sa nepresúva ani nekopíruje.',
  language: 'Jazyk', save: 'Uložiť nastavenia', badSettings: 'Nastavenia neboli uložené: neplatný rozsah.',
  refresh: 'Obnoviť', unavailable: 'Zdroj nie je dostupný v povolenom rozsahu.', raw: 'Pôvodný text bez aktívnych embedov',
};
export type TextKey = keyof typeof cs;
export const tr = (locale: Locale, key: TextKey): string => (locale === 'sk' ? sk : cs)[key];
