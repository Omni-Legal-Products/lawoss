# LAWOSS OKF — Obsidian desktop pilot

[Spec 0018 a primárne zdroje](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/dcd7661/specs/0018-obsidian-okf-plugin.md). Autor nápadu MČ; implementácia na zadanie VŘ. Verzia 0.1.0, Obsidian >= 1.14.4, desktop macOS/Windows. Tímová revízia, CI, natívna akceptácia a publikovanie sú oddelené stavy.

## Čo číta

Prax, vec, lehoty a kancelárska pamäť nad rovnakými OKF Markdown súbormi. Kanonické karty aj legacy aliasy; vlastné typy a neznáme polia zostávajú čitateľné. `_STATUS.md` je ručný stav aj projekcia, nie ďalší zdroj potvrdených lehôt. Potvrdenie vychádza zo spoločného cockpit pravidla pre konkrétny dátum a obsah Truth.

## Príprava a inštalácia

Z koreňa repozitára, Node 24 a pnpm 11.4.0:

```sh
pnpm install --frozen-lockfile --ignore-scripts --filter @lawoss/obsidian-plugin --filter @lawoss/okf-reader
pnpm --filter @lawoss/obsidian-plugin typecheck
pnpm --filter @lawoss/obsidian-plugin lint
pnpm --filter @lawoss/obsidian-plugin test
pnpm --filter @lawoss/obsidian-plugin build
pnpm --filter @lawoss/obsidian-plugin package
```

ZIP a SHA-256 sú v `artifacts/`. Build zahŕňa samostatný browserový dôkaz readeru a kontrolu tranzitívnych importov. ZIP sa neinštaluje automaticky, nevytvára GitHub release a neposiela dáta do katalógu LAWOSS MCP pluginov.

1. Začnite nad syntetickým alebo lokálne skopírovaným vaultom, bez synchronizácie.
2. Skontrolujte SHA-256 ZIPu. Priečinok `lawoss-okf` z neho vložte do `<konfigurácia vaultu>/plugins/` (predvolene `.obsidian/plugins/`).
3. V Obsidiane povoľte tento plugin. Jeho príkazy a ikona váh otvoria pohľady.
4. V nastaveniach LAWOSS OKF vyberte relatívne korene, jednu cestu na riadok; `.` znamená celý vault. Vyberte češtinu/slovenčinu a uložte.
5. Pri „neúplnom pokrytí“ zúžte rozsah. Dnešný reader má limit 200 vecí, 1000 objavovaných priečinkov, hĺbku 16; adaptér najviac 2000 položiek adresára a 2 MiB textu. Neúplný prehľad neznamená absenciu lehôt.

Obnova beží na udalosti po 250 ms, pri návrate do okna a počas aktívneho okna podľa spoločnej politiky 15–120 s. Výsledok z predošlej generácie sa nepublikuje. Pri zlyhaní zostáva posledný výsledok s viditeľnou chybou a časom.

## Hranice

Plugin nemení OKF obsah. Uloženie nastavení zapisuje iba `data.json` pluginu cez Obsidian API. Náhľad je inertný text; odkazy sa otvárajú až po kliknutí a len lokálne v povolenom rozsahu. Otvorenie pôvodného editoru je výslovné a umožňuje ručné zmeny mimo pluginu — dodržte pravidlá OKF a históriu. Obsidian samotný a iné pluginy môžu zapisovať; neexistuje platformové oprávnenie read-only.

Prvá verzia vyžaduje lokálny desktopový vault. Fyzická kontrola odmieta symlinky a únik mimo vaultu. Len tento hostiteľský guard používa Node `lstat/realpath`; dáta číta Vault API. Kontrola nie je obrana proti úmyselnému súbežnému prepisovaniu filesystemu privilegovaným procesom. Jadro zostáva browser-safe. Externé zložky, mobil a komunitný katalóg nie sú podporované týmto pilotom.

Plugin nemá sieť, telemetriu, AI, MCP ani synchronizáciu. Žiadne kľúče. Voľba Obsidian Sync/iCloud/Git potrebuje samostatné posúdenie mlčanlivosti kancelárie; technické E2EE nie je právne schválenie. Nekombinujte synchronizačné služby nad tým istým vaultom. Zdrojový GitHub repozitár pluginu nie je miesto pre klientske dáta.

## Ďalšie kroky a otvorené otázky

Tímové review, source CI a natívny pilot na oboch desktopových platformách pred odporúčaním pre živé dáta. Mobil, komunitný katalóg, zápisové operácie a akákoľvek cloudová konfigurácia vyžadujú ďalší návrh. Odstránenie pluginu neodstraňuje ani nemigruje OKF súbory.

Konkrétne source a natívne dôkazy, vrátane snímok, sú v [docs/PILOT.md](docs/PILOT.md).
