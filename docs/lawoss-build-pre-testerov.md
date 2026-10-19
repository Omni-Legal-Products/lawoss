# LAWOSS: návod pre alfa testerov

> [!IMPORTANT]
> Toto je alfa verzia LAWOSS na testovanie. Skúšajte ju na syntetických dátach alebo na kópii priečinka. Vlastné spisy len na vlastné riziko.

Tento návod je pre právnikov, ktorí skúšajú alfu. Technické časti sú až na konci, v časti „Pre technických testerov“.

## 1. Alfa, nie hotový produkt

- Appka sa môže zmeniť alebo spadnúť. Chyby sú očakávané a hlásenie je presne to, čo od vás chceme.
- Na skúšanie používajte syntetické dáta z časti 3. Ak chcete vyskúšať vlastný priečinok, použite jeho kópiu. Originál nechajte nedotknutý.
- Do appky nevkladajte klientske údaje, ktoré nesmiete poslať poskytovateľovi modelu. Text dokumentov, na ktoré sa pýtate, ide k poskytovateľovi, ktorého ste pripojili.
- Kľúč od poskytovateľa nevkladajte do rozhovoru, snímok obrazovky ani hlásení.

## 2. Stiahnutie appky

Hotové verzie sú v [releasoch forku](https://github.com/Omni-Legal-Products/lawoss/releases). Stiahnite si najnovšiu alfu. Sami nič neskladáte.

- **macOS (Apple Silicon, arm64):** stiahnite alfu pre macOS. Ak ju macOS pri prvom spustení zablokuje, otvorte ju pravým klikom a voľbou Otvoriť, alebo v Nastaveniach systému v časti Súkromie a bezpečnosť.
- **Windows (x64):** alfa pre Windows je **nepodpísaná** a je len pre interný tím. Windows pri inštalácii varuje, že appku nepozná. Postup pri varovaní a pri inštalácii je v [Windows: inštalácia a aktualizácie](lawoss-d1-zabalena-appka-2026-10-05.md#windows-inštalácia-a-aktualizácie-pre-testerov). Ak nepatríte do interného tímu, na Windows alfu zatiaľ neinštalujte.

Verziu appky nájdete v Nastaveniach, v časti Aktualizácie. Uveďte ju pri každom hlásení chyby.

## 3. Syntetické dáta na skúšanie

Syntetické dáta sú vymyslené kancelárie, klienti a veci. Nie sú v nich skutoční ľudia ani skutočné spisy.

### Slovenská kancelária

1. Otvorte [SYNTHETIC_DATA.md](../SYNTHETIC_DATA.md). Je tam odkaz na stiahnutie a kontrolný súčet.
2. Stiahnite balík a overte kontrolný súčet SHA-256. Ak nesedí, balík nepoužívajte.
3. Rozbaľte ho do nového, prázdneho priečinka.
4. V balíku zvoľte jednu kancelársku zložku:
   - `01_Neusporiadana_kancelaria` na skúšku pripojenia a usporiadania neusporiadaných dokumentov,
   - `02_OKF_kancelaria` na skúšku už usporiadanej kancelárie.
5. Priečinok `ground-truth/` nikdy nepripájajte ani nedávajte modelu. Obsahuje správne odpovede a skúška by bola nepoužiteľná.
6. Dátumy v balíku sú zamrazené k 17. 10. 2026, takže lehoty sa v appke ukážu ako uplynuté. Posuňte ich k dnešku na **kópii** skriptom `shift_dates.py`. Postup je v [README skriptu](../lawoss/testing/synthetic-sk/README.md). Stručne:

```bash
python3 lawoss/testing/synthetic-sk/shift_dates.py \
  --source <rozbalený balík>/02_OKF_kancelaria \
  --dest <nový priečinok>/02_OKF_kancelaria
```

Cieľový priečinok nesmie existovať. Pôvodný balík ostane nedotknutý. Skript potrebuje Python 3.11 alebo novší a kópiu repozitára. Ak ich nemáte, požiadajte o pomoc kolegu z technického tímu.

### Česká sada

Česká syntetická sada (`lawoss/testing/fixtures/cz-workflow-derived-v1`) bude dostupná po zlúčení [PR #172](https://github.com/Omni-Legal-Products/lawoss/pull/172).

## 4. Čo skúšať

Prejdite tieto tri cesty. Pri každej si poznačte, čo ste čakali a čo sa stalo.

### Cesta 1: pripojiť priečinok a usporiadať ho

1. Vezmite kópiu kancelárie `01_Neusporiadana_kancelaria`.
2. Pripojte priečinok klienta ako skúšobný klon (Klienti a veci → Pripojiť existujúci priečinok klienta).
3. Spustite roztriedenie dokumentov a skontrolujte návrh.
4. Potvrďte roztriedenie. Potom ho skúste vrátiť.

Podrobný postup je v [D1, časť Klienti, veci a skilly](lawoss-d1-zabalena-appka-2026-10-05.md#klienti-veci-a-skilly-pre-testerov).

### Cesta 2: Dnes a Klienti a veci

1. Otvorte kópiu `02_OKF_kancelaria` s posunutými dátumami.
2. V pohľade **Dnes** skontrolujte lehoty v nasledujúcich dňoch. Sedia s kartami vecí?
3. V pohľade **Klienti a veci** otvorte klienta a jeho vec. Je tam to, čo čakáte?

### Cesta 3: otázka nad PDF a e-mailom (EML)

1. Vyberte vec a v nej jedno PDF a jeden e-mail vo formáte EML.
2. Opýtajte sa na konkrétnu vec z dokumentu, napríklad na sumu, dátum alebo strany zmluvy.
3. Skontrolujte, či odpoveď sedí s dokumentom a či ukazuje, z ktorého dokumentu je. Odpovede nie sú právne stanovisko a overujete ich vy.

## 5. Poskytovateľ modelu

Appka potrebuje pripojený model. Pripojíte ho v Nastaveniach, v časti AI Providers, a potom ho vyberiete dole v okne rozhovoru.

- **Odporúčané:** predplatné ChatGPT. Po prihlásení funguje bez vlastného API kľúča.
- **Známy problém:** Gemini cez OpenRouter môže zlyhať. Ak odpoveď nepríde alebo skončí chybou, skúste iný model alebo iného poskytovateľa a chybu nám nahláste.

Ďalšie možnosti a podrobnosti sú v časti „Výber modelu a jazyk“ nižšie a v [D1](lawoss-d1-zabalena-appka-2026-10-05.md#ako-pripojiť-model-pre-testerov).

## 6. Aktualizácie

Appka vám môže sama ponúknuť novú alfu. Ponuku zatiaľ nepotvrdzujte. Novú alfu nainštalujte až vtedy, keď ju oznámime v kanáli testerov. Stiahnete ju z [releasov forku](https://github.com/Omni-Legal-Products/lawoss/releases), rovnako ako prvú.

## 7. Kam hlásiť chyby

Chybu nahláste jedným z dvoch spôsobov:

- v [issues forku](https://github.com/Omni-Legal-Products/lawoss/issues),
- v Telegrame, v skupine testerov.

Uveďte:

- kroky, ktoré chybu vyvolajú, a čo ste čakali oproti tomu, čo sa stalo,
- verziu appky (v Nastaveniach, v časti Aktualizácie, riadok Aktuálna verzia; na macOS aj v menu About LAWOSS),
- operačný systém s verziou a architektúrou (arm64 alebo x64),
- snímku obrazovky, ak v nej nie sú klientske údaje ani kľúče.

Do hlásenia nikdy nevkladajte API kľúče, heslá ani údaje skutočných klientov.

## Pre technických testerov

Nasledujúce časti sú pre tých, ktorí si appku skladajú sami alebo ladia jej beh. Právnici ich zväčša nepotrebujú.

Postup akceptačného behu s kritériami PASS/FAIL je v [alfa akceptačnom protokole](lawoss-alpha-acceptance.md). Prejdené cesty na zabalenej appke sú v [D1](lawoss-d1-zabalena-appka-2026-10-05.md).

### Build zo zdrojov

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

### Hlásenie chýb pri vlastnom builde

Okrem údajov z časti 7 uveďte:

- pri vlastnom builde s verziou `0.0.0` výstup `git rev-parse HEAD` a `git branch --show-current`,
- verziu Node,
- celý výpis chyby, ak padol `pnpm install` alebo `package:electron`.

### Konektory samostatného `opencode` CLI

Ak používate aj samostatný `opencode` CLI, appka pri každom spustení presunie MCP
konektory z `~/.config/opencode/opencode.json` (aj z `opencode.json` v pracovných
priečinkoch) do vlastnej databázy v `~/.config/legalwork/` a z pôvodného súboru
ich zmaže. Pred prvým presunom uloží kópiu dotknutého súboru ako
`<súbor>.bak-<dátum>`. Súbor si napriek tomu pred prvým spustením zálohujte sami
a konektory odvtedy pridávajte v appke. Návrat na starší build opisuje
[rollback-v0.1.21.md](rollback-v0.1.21.md).

### Výber modelu a jazyk

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

### Ladiaci port Electronu

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
