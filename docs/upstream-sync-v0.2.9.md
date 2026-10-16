# Upstream sync v0.2.9

Zlúčenie upstream release `v0.2.9` do LAWOSS `dev` (`34df1a4f`, po syncu v0.2.4 a #161). Druhý krok k aktuálnemu LegalWorku po `docs/upstream-sync-v0.2.4.md`; rozhodnutia o wiki, OpenUI a súvisiacich plochách sú v návrhu spec 0017 v koordinačnom repe (PR #97). Dokument zaznamenáva merge a lokálne overenie pre review. Nevydáva release, nenasadzuje službu ani nemení inštalované pluginy.

## Čo prináša upstream v0.2.5 až v0.2.9

| Oblasť | Upstream | V LAWOSS |
|---|---|---|
| Wiki a OpenUI | #274, #281, #283: lokálna wiki (Markdown s frontmatterom a index), pohľady a návrhy na schválenie | Kód prevzatý, v alfe **skryté a zablokované** (spec 0017, časť 8.1): plugin wiki sa nenačíta, nástroje `wiki_*` a `view_*` sú zamietnuté, navigácia a trasy skryté |
| Kalendár, výpočty lehôt, plánované úlohy | #197, #217, #249 | Kód prevzatý, v alfe skryté; zapisujúce nástroje zamietnuté (lehoty ostávajú v OKF) |
| Šablóny metadát projektu, Shared Projects | #268 | Šablóny prevzaté s anglickou šablónou pre SK a CS (`currentTemplateLocale()`), nástroj `legalwork_project_set_metadata` zamietnutý; Shared Projects (cez platformu) skryté |
| Konektory | #272, #277 natívne Google a Microsoft, #173 Vaquill, #284 Patent, #274 Actaport, Open Computer Use | Prevzaté pod bránou zdroja LegalWork (aj natívne úložiská); spravované prihlásenie Nango (broker na platforme Eigenwelt) sa neponúka |
| Sandbox | #227, #242, #254, #258: izolovaný spravovaný engine, voliteľné spúšťanie príkazov vo VM, sieťové režimy | Prevzaté; skills LAWOSS idú do `skills.paths` izolovaného enginu |
| Firemné politiky | #209 Follow the firm, Knowledge Hub | Prevzaté, plochy za `firm-hub`, bez Eigenweltu nečinné |
| Katalóg modelov | #223, #230 zrkadlo Eigenweltu a relé pri štarte | **Neprevzaté do behu**: server relé neregistruje, nastavenie je vždy vypnuté, engine a obnova modelov čítajú pribalený katalóg; orchestrator bez predvoleného katalógu Eigenweltu |
| Cache promptu | #220, #249, #259 | Prevzaté; plugin OKF handoff má stály systémový text |
| Dokumenty | #213 split view a autosave DOCX, #245 editor kódu a autosave Markdownu, #282 natívne Word workflow | Prevzaté; oprava Undo s pôvodnými bajtmi (#90) presunutá do nového publikovania |
| Téma | #214 Dark a Blackout | Prevzaté; LAWOSS ostáva predvolene tmavý |
| Desktop a vydania | #221 Windows štart a ARM64, #233 SignPath, #279, #287, #288, #289, #290 kontroly štartu zabalenej appky | Prevzaté s politikou podpisu a vydaní LAWOSS (`lawoss-*`, feedy forku) |

## Riešenie konfliktov

85 konfliktných súborov (266 blokov). Bloky bez prekrytia sa zlúčili po tokenoch, zvyšok sa riešil po skupinách (server, appka a relácie, nastavenia a lokalizácia, desktop a CI) podľa `PATCHES.md`. Nové a zmenené adaptácie sú v sekcii „Upstream sync v0.2.9“ na konci `PATCHES.md`, vrátane riadkov, ktoré sync zrušil.

Najdôležitejšie rozhodnutia:

- **Marketplace:** upstream vypne každý MCP s `${...}` v konfigurácii; `${CLAUDE_PLUGIN_ROOT}` sa preto nahrádza pred normalizáciou, inak by sa lokálne MCP z LAWOSS Marketplace inštalovali vypnuté. Id záznamu globálnych pluginov LAWOSS ostáva.
- **Bezpečnosť:** hranice z #142 a #159 ostávajú vo vnútri nových upstream zámkov zápisu a v zjednotených trasách.
- **Natívne generovanie dokumentov:** postavené nanovo na upstream odosielaní správ (fronta, výber modelu pri odoslaní).

## Stráže

- `check-no-eigenwelt.mjs` rozšírený o tri štrukturálne pravidlá: `embedded.ts` bez relé katalógu, `server.ts` bez relé a bez sieťovej obnovy katalógu, orchestrator bez predvoleného katalógu. Upstream sieťová funkcia obnovy katalógu ostáva v `ALLOWED` ako nevolaný kód.
- `opencodeVersion` bez zmeny (`v1.18.29`).

## Overenie

macOS arm64, Node 24.19.0, pnpm 11.4.0, Bun 1.4.3. Testy bežali s izolovaným `HOME` a `XDG_*` (inak sa načítajú skilly a nastavenia z reálneho profilu vývojára).

| Príkaz | Výsledok |
|---|---|
| `pnpm install` (pregenerovaný `pnpm-lock.yaml`) | prešlo |
| `pnpm typecheck` v `apps/app` a `apps/server`, `pnpm --filter @legalwork/desktop typecheck:electron` | prešlo |
| `bun test src` v `apps/server` | 2 596 pass, 69 skip, 0 fail |
| `bun test tests/` v `apps/app` | 2 387 pass, 2 skip, 0 fail |
| `pnpm --filter @legalwork/desktop test` | 404 pass, 6 skip, 0 fail |
| `pnpm --filter @lawoss/okf test`, `@lawoss/okf-pamat test`, `bun test lawoss/okf-handoff` | 375, 676 a 50 pass, 0 fail |
| `pnpm --filter legalwork-server build`, `pnpm --filter @legalwork/app build` | prešlo |
| `test:i18n`, `i18n-audit --ci` | prešlo, 7 733 kľúčov, sk/cs úplné |
| `check-no-eigenwelt.mjs`, `check-branding.mjs` + testy | prešlo |

Pri prvom behu neizolovaných sád padalo niekoľko testov len zo zaťaženia (sandbox host, studený štart shellu); samostatne prechádzajú. Server build pri lokálnom Bun 1.4.3 pregeneruje `apps/server/src/calendar/calculator-code.ts` inak; commitnutá je upstream verzia, CI používa pinnutý Bun 1.4.2. Desktop smoke na zabalenej appke sa nerobil; `Package and launch` v CI ho pokrýva po krok Native ISIR, ktorý padá na `dev` od #156.

Testy, ktoré bolo treba prispôsobiť upstream zmenám (zrušený Computer Use, katalóg relé, izolovaný engine, `QueryClientProvider`, predvolená tmavá téma, skryté plochy Eigenweltu), sú vymenované v `PATCHES.md`. Skutočná chyba nájdená testami: skripty prvého vykreslenia (`index.html`, `overlay.html`, `live-overlay.html`, `taskpane.html`) mali svetlú predvolenú tému, opravené.

## Známe otvorené body

- Prehliadačový test Markdown editora (`apps/app/tests/markdown-clean-open.browser.js`, ručne cez Playwright) klikal na ovládanie, ktoré upstream odstránil; selektory treba prepísať (režimy cez ponuku, Undo a Redo klávesnicou). Správanie pristine je pokryté jednotkovými testami.
- Balenie desktopu (`ci-desktop-packaging.yml`) upstream spúšťa len cez `workflow_call`; LAWOSS vrátil spúšťanie na PR a push do `dev`, lebo „Package and launch“ sú povinné kontroly.
- Upstream vstup `signing_test` vo Windows alfe neprevzatý (natvrdo SignPath projekt LegalWorku); SignPath v3 vyžaduje vo forku nastavený `SIGNPATH_ARTIFACT_CONFIGURATION_SLUG` a politiku `release-signing`.
- Téma a jazyk sú v Nastaveniach dvakrát (Appearance aj Customization) kvôli Lite.
- V paneli súborov je vedľa upstream checkboxu hromadných akcií aj LAWOSS výber zdrojov pre generovanie dokumentov.
- Token servera v prostredí enginu platí pre všetky priečinky; rieši samostatný PR po tomto syncu.
- Metadáta projektu (`.legalwork/project.json`) sa zapisujú do `workspace.path` aj v režime outside; samostatný PR.
- Preklady 1 428 nových kľúčov SK a CS sú strojové s terminológiou existujúcich slovníkov; treba jazykovú kontrolu.
