# LAWOSS: návod pre alfa testerov

Jediný návod pre testerov je [D1 na zabalenej appke](lawoss-d1-zabalena-appka-2026-10-05.md):
prejdené cesty, pripojenie modelu, klienti, veci a skilly, automatické roztriedenie
dokumentov a odkazy na DPA. Dokument prichádza do `dev` s
[lawoss#109](https://github.com/Omni-Legal-Products/lawoss/pull/109). Postup
akceptačného behu s kritériami PASS/FAIL je v
[alfa akceptačnom protokole](lawoss-alpha-acceptance.md).

Nižšie je len to, čo D1 zatiaľ nemá. Po presune do D1 ostane z tohto súboru
iba odkaz.

## Build zo zdrojov

Potrebné len vtedy, keď si appku staviate sami.

- Node 24: `.nvmrc` a `engines.node` v `package.json` (`>=24.0.0 <25.0.0`).
  S nástrojmi ako `nvm` stačí `nvm use` v koreni repozitára.
- pnpm 11.4.0, vynútené cez `packageManager`.
- Bun 1.4.2: server sa zostavuje cez `bun build` (aj v `package:electron`) a
  testy `apps/app` bežia v Bune.
- macOS: Xcode Command Line Tools (`xcode-select --install`) pre prípad, že
  natívny `better-sqlite3` treba skompilovať zo zdroja.

Windows x64 (CI to robí na `windows-2022`; na vlastnom počítači s Windows
*neoverené*):

- Dlhé cesty v gite ešte pred `git clone`: `git config --global core.longpaths true`
  (rovnako ako workflowy na `windows-2022`).
- Node 24, `node --version` musí ukázať `v24.x`.
- pnpm 11.4.0, napríklad `npm install -g pnpm@11.4.0`.
- Bun 1.4.2: potrebný aj na build balíčka (server sa zostavuje cez `bun build`),
  nielen na testy.
- Pre prípad, že natívny modul treba skompilovať zo zdroja: Visual Studio Build
  Tools s „Desktop development with C++“.

```bash
git clone https://github.com/Omni-Legal-Products/lawoss.git
cd lawoss
pnpm install
pnpm --filter @legalwork/desktop package:electron
```

`pnpm build` (aj `build:electron` v `apps/desktop`) zostaví len server,
rozhranie a pomocné súbory pre Electron, balíček nevytvorí. Ten vytvorí až
`package:electron` z `apps/desktop/package.json`: spustí ten istý build a potom
`electron-builder` pre váš systém (macOS `.dmg` a `.zip`, Windows inštalátor
NSIS `.exe`, Linux AppImage a `.tar.gz`). Rýchlejší `package:electron:dir`
vytvorí len rozbalenú appku bez inštalátora. Výsledok je v
`apps/desktop/dist-electron`.

Vlastný build nie je podpísaný, takže ho systém pri prvom spustení zablokuje
alebo varuje. Na macOS ho otvoríte pravým klikom a voľbou Otvoriť, alebo v
Nastaveniach systému, časť Súkromie a bezpečnosť. Na Windows cez SmartScreen
More info → Run anyway (pozri časť Windows v D1).

Vlastný build má verziu `0.0.0` a kontrolu aktualizácií zámerne preskakuje
(`isUnstampedLocalBuild` v `apps/desktop/electron/updater.mjs`). Novú verziu
získate novým `git pull`, `pnpm install` a
`pnpm --filter @legalwork/desktop package:electron`.

## Konektory samostatného `opencode` CLI

Ak používate aj samostatný `opencode` CLI, appka pri každom spustení presunie MCP
konektory z `~/.config/opencode/opencode.json` (aj z `opencode.json` v pracovných
priečinkoch) do vlastnej databázy v `~/.config/legalwork/` a z pôvodného súboru
ich zmaže. Pred prvým presunom uloží kópiu dotknutého súboru ako
`<súbor>.bak-<dátum>`. Súbor si napriek tomu pred prvým spustením zálohujte sami
a konektory odvtedy pridávajte v appke. Návrat na starší build opisuje
[rollback-v0.1.21.md](rollback-v0.1.21.md).

## Výber modelu a jazyk

Doplnok k časti „Ako pripojiť model“ v D1.

- Pri **jednom** pripojenom poskytovateľovi appka vyberie jeho predvolený model,
  ak vie volať nástroje, inak prvý chatový model s nástrojmi. Obrázkové, hlasové,
  prepisovacie a embedding modely preskočí. Pri **viacerých** poskytovateľoch
  model nevyberie; zvoľte ho dole v okne chatu.
- Chyba `No endpoints found that support tool use` znamená, že vybraný model
  alebo jeho endpoint nevie volať nástroje. Vyberte iný model.
- Anthropic: odporúčané je pripojenie API kľúčom. Pri prihlásení cez Claude
  Pro/Max appka upozorní na spotrebiteľské podmienky Anthropic; túto cestu sme
  neoverili. Kľúč nevkladajte do rozhovoru, snímok obrazovky ani hlásení.
- Jazyk prepnete v hlavičke rozhovoru alebo v Nastaveniach; obe miesta zdieľajú
  jednu voľbu. Na výber je slovenčina, čeština, angličtina a nemčina, predvolený
  je jazyk systému.

## Čo hlásiť a kam

Chyby patria do [issues vo forku](https://github.com/Omni-Legal-Products/lawoss/issues),
nie do Telegramu. Uveďte:

- kroky, ktoré chybu vyvolajú, a čo ste čakali oproti tomu, čo sa stalo,
- verziu appky (na macOS v menu About LAWOSS, všade v Nastaveniach →
  Aktualizácie → Aktuálna verzia); pri vlastnom builde s verziou
  `0.0.0` aj výstup `git rev-parse HEAD` a `git branch --show-current`,
- operačný systém s verziou a architektúrou (arm64 alebo x64), pri vlastnom
  builde aj verziu Node,
- ak padol `pnpm install` alebo `package:electron`, celý výpis chyby.

## Ladiaci port Electronu

Od upstream syncu v0.2.1 je aplikačný CDP port predvolene vypnutý.
Zabalená aplikácia ho nepovolí ani pri nastavenej premennej. Nezabalený
vývojový beh ho otvorí iba na výslovne zadanom porte. Kto sa na CDP pripojí,
riadi okno aplikácie aj jej session.

Hodnota `LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT=off` ostáva kompatibilná,
ale pre predvolené vypnutie už nie je potrebná.

Konkrétny port pre ladenie nastavíte takto:

```bash
LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT=9823 pnpm dev
```

Skript `scripts/legalwork-debug.sh` si port nastavuje sám.
