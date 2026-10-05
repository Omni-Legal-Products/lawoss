# Pohľady z pamäte OKF: pravidlá (4. 10. 2026)

Pokyn MČ zo 4. 10. 2026: pohľady poskladané z OKF súborov musia byť **dynamické a vždy konzistentné, vždy čerpať z OKF súborov**. Do koordinačného repozitára ho treba ešte zapísať ako rozhodnutie.

## Jediný zdroj

- Všetky pohľady Lite (Dnes, Klienti a veci, detail veci, posledné veci v bočnom paneli, počet v názve okna) čítajú ten istý dotaz `okf-overview` (`apps/app/src/lawoss/okf/read-model.ts`). Na obrazovke nie je nič napevno ani demo; okrem dátumu a pozdravu všetko pochádza zo súborov.
- Obnova: pri návrate do okna a ticho na pozadí každých 15 s, pri pomalom čítaní až 2 min. Prekreslí sa len pri inom obsahu. Zlyhané obnovenie nechá posledné údaje a indikátor povie, z kedy sú.

## Spoločné pravidlá: `apps/app/src/lawoss/okf/view-rules.ts`

| Pravidlo | Funkcia | Význam |
|---|---|---|
| Okno prehľadu | `HORIZON_DAYS`, `inHorizon` | 14 dní dopredu, po lehote a neplatné dátumy vždy |
| Naliehavosť | `urgencyOf` | priamo z `deadlineTier` vrstvy OKF: po lehote, dnes, zajtra = horí; do 7 dní = blízko; inak pokoj; neplatný alebo nemožný dátum horí |
| Text lehoty | `deadlineText` | text za dátumom zápisu, inak názov záznamu, inak ID |
| Slovný termín | `dueText`, `dueTextFromDays` | dnes, zajtra, o N dní, po lehote, overiť dátum |
| Kľúč lehoty | `deadlineKey` | dve rovnaké lehoty v jeden deň ostanú dve |

Ďalej: klienta veci určuje `clientOf` (`lite/today-model.ts`), naliehavosť veci `matterUrgency` (`lite/live.tsx`, lehoty kancelárie sa nepočítajú), hotová úloha nenesie lehotu (`recordDeadlines`).

## Nový pohľad

1. Údaje len z `OkfPage` (render prop `data`, `meta`), nič nečítať bokom.
2. Farby, okno, texty lehôt a termíny len cez `view-rules`; nič nepočítať po svojom.
3. Sekciu ukázať len vtedy, keď má obsah; vlastné typy agenta zoskupiť, nie zahodiť.
4. Pridať test do `apps/app/tests/lawoss-okf-views-dynamic.test.tsx`, ktorý z toho istého OKF záznamu porovná nový pohľad s Dnes.
