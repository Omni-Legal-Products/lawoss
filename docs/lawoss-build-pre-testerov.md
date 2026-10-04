# LAWOSS: build pre alfa testerov

Tento návod je pre externých testerov alfa verzie LAWOSS. Krok po kroku popisuje, ako si appku sami skompilovať, spustiť a čo hlásiť naspäť.

## 1. Načo to je

LAWOSS je v alfa fáze. Build **nie je notarizovaný** — nemá platný Apple/Microsoft podpis. Keby sme ho poslali ako hotový `.dmg`/`.exe`, macOS aj Windows by pri prvom spustení ukázali varovanie "neznámy vývojár" alebo appku rovno zablokovali. Kým to nevyriešime, alfu nedistribuujeme ako podpísaný súbor — každý tester si ju skompiluje sám zo zdrojového kódu na svojom počítači.

## 2. Známe obmedzenie: Node 26 a `better-sqlite3`

Toto je prvá vec, na ktorú pravdepodobne narazíte.

LAWOSS desktop appka používa `better-sqlite3` — natívny Node modul (kompiluje sa cez `node-gyp` do binárky pre váš konkrétny Node). Na Node **v26.7.0** `pnpm install` pri kompilácii `better-sqlite3@11.10.0` **spoľahlivo padá**. Skutočná chyba, ktorú `node-gyp` vypíše:

```
error: no member named 'This' in 'v8::PropertyCallbackInfo<v8::Value>'
...
gyp ERR! build error
gyp ERR! stack Error: `make` failed with exit code: 2
gyp ERR! node -v v26.7.0
gyp ERR! node-gyp -v v12.3.0
```

**Čo to znamená:** Node v26 je veľmi čerstvý major a mení internú V8 API (metóda `info.This()` v tejto verzii V8 už neexistuje). `better-sqlite3@11.10.0` má natívny C++ kód napísaný proti staršej V8 API a proti tomuto Node ešte nemá predpripravenú (prebuilt) binárku, takže `node-gyp` skúša kompilovať zo zdrojov — a tá kompilácia zlyhá. Nejde o chybu v LAWOSS kóde ani o chýbajúci krok v návode; je to nekompatibilita medzi `better-sqlite3@11.10.0` a Node v26 V8 hlavičkami.

**Ako to obísť:**

- Ak potrebujete iba overiť kód (typecheck, testy, UI build) bez spúšťania desktopovej appky s lokálnou databázou, použite `pnpm install --ignore-scripts` — vynechá natívny build a tieto kroky prejdú aj na Node v26.7.0 (overené, pozri krok 3 nižšie).
- Ak potrebujete appku naozaj spustiť (`pnpm dev:electron`, plný `pnpm build`), `better-sqlite3` sa musí skompilovať. **Použite Node 24** — repozitár má `.nvmrc` s hodnotou `24` a všetky CI a release workflowy (vrátane `.github/workflows/alpha-macos-aarch64.yml`, ktorý stavia macOS alfa buildy s natívnym `better-sqlite3`) bežia na `actions/setup-node` s `node-version: 24`. Toto je overená a reálne používaná kombinácia, nie odhad. Na macOS budete navyše potrebovať nainštalované Xcode Command Line Tools (`xcode-select --install`), aby `node-gyp` mal čím kompilovať, ak by aj na Node 24 chýbala predpripravená binárka pre vašu platformu.
- Ak už máte `nvm`, `fnm`, `volta` alebo podobné, prepnite Node verziu iba pre tento projekt (napr. `nvm use` prečíta `.nvmrc` automaticky) namiesto zmeny systémového Node.
- Táto verzia je teraz deklarovaná aj v koreňovom `package.json` (`engines.node`), takže si ju viete overiť aj bez otvárania `.nvmrc`.

## 3. Čo potrebuješ

| Nástroj | Čo je overené | Čo overené nie je |
|---|---|---|
| **Node.js** | 24 — presne táto verzia beží vo všetkých CI a release workflowoch tohto repozitára (`.nvmrc`, `actions/setup-node` v `.github/workflows/*`), vrátane buildu macOS alfa balíčkov s natívnym `better-sqlite3`. Node v26.7.0 sme tiež overili: `pnpm install --ignore-scripts`, `pnpm typecheck`, `bun test tests/` a `pnpm build:ui` na ňom prešli | Node v26.7.0 s plným `pnpm install`/`pnpm build` (natívny `better-sqlite3`) — pozri sekciu 2 |
| **pnpm** | 11.4.0 (repozitár vyžaduje presne túto verziu cez `packageManager` v `package.json`) | — |
| **bun** | 1.4.2, na spúšťanie `apps/app` testov. Od upstream v0.1.21 je `bun-version: 1.4.2` pinnutá v `ci-tests.yml`, alfa aj release workflowoch a README upstreamu vyžaduje Bun 1.4.2+ | `ci-docx.yml` bun verziu nepinuje (inštaluje najnovšiu) |
| **Git** | akákoľvek bežná verzia na klonovanie repozitára | — |
| **Xcode Command Line Tools** (macOS) | potrebné pre kompiláciu `better-sqlite3` zo zdroja, ak pre vašu platformu chýba predpripravená binárka — `xcode-select --install` | či ich CI runner reálne potrebuje (má vlastný predpripravený image) |

Nepíšeme sem "najnovší Node": najnovší dostupný major (v26) je práve to, čo `pnpm install` láme na `better-sqlite3`. Použite Node 24 a `pnpm@11.4.0` (repozitár to vynucuje cez `packageManager`).

## 4. Postup

Každý príkaz na vlastnom riadku, s tým, čo (približne) vypíše.

```bash
git clone https://github.com/Omni-Legal-Products/lawoss.git
cd lawoss
```

Naklonuje repozitár do priečinka `lawoss` a prepne sa doň.

```bash
node --version
pnpm --version
```

Skontrolujte, že máte `pnpm 11.4.0` (repozitár to vyžaduje) a poznačte si svoju verziu Node — budete ju uvádzať pri hlásení (krok 6).

```bash
pnpm install
```

Nainštaluje závislosti pre celý monorepo (10 workspace balíkov) a skompiluje natívne moduly vrátane `better-sqlite3`. **Ak tu padne s chybou z `node-gyp`/`better-sqlite3`, prečítajte si sekciu 2 vyššie** — nejde o zlyhanie tohto návodu, ale o známe obmedzenie voči vašej Node verzii. Skúste inú Node verziu podľa sekcie 2 a `pnpm install` zopakujte.

```bash
pnpm build
```

Zostaví appku pre desktop (spustí `apps/desktop` build cez electron-builder). Očakávaný výsledok: build prejde bez zásahu do kódu a v `apps/desktop/dist-electron` pribudne výsledný balíček pre váš operačný systém (na macOS `.app`/`.dmg`, na Windows inštalátor). Tento krok potrebuje úspešne skompilovaný `better-sqlite3` z predchádzajúceho kroku.

**Tento krok (plný `pnpm build` s natívnym `better-sqlite3`) sme pri príprave tohto návodu priamo neoverili** — mali sme k dispozícii iba Node v26.7.0, na ktorom `pnpm install` padá skôr, ako sa k tomuto kroku vôbec dostane (sekcia 2). Je to však presne to, čo pri každom alfa release robí CI na Node 24 (`.github/workflows/alpha-macos-aarch64.yml`) — na tejto verzii by mal krok prejsť.

```bash
pnpm typecheck
```

Voliteľné, ale užitočné pred hlásením problému — overí, že TypeScript kód sedí. Nemal by vypísať žiadne chyby.

**Prvé spustenie appky** — otvorte vygenerovaný balíček z `apps/desktop` (na macOS `.app` z výstupnej zložky buildu, na Windows `.exe`/inštalátor). Keďže build nie je podpísaný, OS pri prvom spustení zobrazí varovanie — to je očakávané (pozri sekciu 1), appku treba explicitne povoliť (na macOS napr. cez pravý klik → Otvoriť, alebo Nastavenia systému → Súkromie a bezpečnosť).

## 5. Prvé spustenie

1. **Pripojte model.** V appke choďte na **Settings → AI Providers** a pripojte AI model, ktorý chcete používať (vlastný API kľúč alebo iný podporovaný spôsob pripojenia). Appka bez pripojeného modelu nemá s čím pracovať. Kým model nie je pripojený, odosielanie je zamknuté a nad poľom na písanie je lišta s tlačidlom **Connect a provider**. LAWOSS žiadne predplatné nepredáva: tlačidlá na skúšobnú verziu alebo prihlásenie (Eigenwelt, dodávateľ upstreamu) nepoužívajte.

   > Pozor, ak používate aj samostatný `opencode` CLI: build od upstream v0.1.21 pri každom spustení presunie MCP konektory z `~/.config/opencode/opencode.json` (aj z `opencode.json` v pracovných priečinkoch) do vlastnej databázy v `~/.config/legalwork/` a z pôvodného súboru ich zmaže. Server si pred prvým presunom uloží kópiu každého dotknutého súboru ako `<súbor>.bak-<dátum>` vedľa neho; napriek tomu si ho pred prvým spustením zálohujte aj sami a konektory odvtedy pridávajte v appke. Starší LAWOSS build po návrate konektory neuvidí — postup obnovy je v [docs/rollback-v0.1.21.md](rollback-v0.1.21.md).
2. **Pripravte testovací priečinok.** Použite nový, prázdny priečinok mimo reálnych spisov. **Nepoužívajte skutočné klientske dáta** (dôvod je v sekcii 7). Onboarding (voľba OKF, kancelária, AI, klient a vec) prejdite podľa sekcie 5b.
3. **Prepnite jazyk.** Prepínač jazyka je v hlavičke rozhovoru aj v **Settings** (obe miesta zdieľajú jednu voľbu). Zvoľte slovenčinu, češtinu alebo angličtinu; predvolený je jazyk systému.
4. Vyskúšajte appku na neškodnej úlohe — napríklad nechajte ju zhrnúť testovací dokument, ktorý ste sami vložili do testovacieho priečinka.

## 5a. Pripojenie modelu

LAWOSS nemá vlastný model ani vlastný kľúč. Svojho poskytovateľa pripojíte cez
**Settings → AI Providers**; názov položky sa môže líšiť podľa jazyka rozhrania.

### Anthropic

Odporúčaný postup podľa [ADR 0003](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/decisions/0003-legal-work-ako-zaklad.md)
je **API kľúč** z [Anthropic Console](https://console.anthropic.com/).
V dialógu poskytovateľa zvoľte pripojenie kľúčom a zadajte ho do určeného poľa.
Kľúč nevkladajte do rozhovoru, screenshotov ani hlásenia chyby.

Ak engine ponúkne prihlásenie cez **Claude Pro/Max**, aplikácia pri tejto voľbe
zobrazuje upozornenie na podmienky spotrebiteľského predplatného. Tento návod
nepotvrdzuje úspešné prihlásenie ani odpoveď modelu cez túto možnosť. Pri príprave
tejto dokumentácie sa živý test Anthropicu nevykonal.

### OpenRouter, OpenAI, ostatní

V tej istej obrazovke vyberte poskytovateľa a dostupný spôsob pripojenia.
Pri API pripojení vložte jeho kľúč; ďalšie ponúkané spôsoby závisia od enginu
a poskytovateľa. OpenRouter sprostredkuje výber viacerých modelov.

### Výber modelu

Ak je pripojený **presne jeden poskytovateľ**, automatický výber použije jeho
predvolený model, ak podporuje nástroje; inak prvý vhodný chatový model z jeho
katalógu. Obrázkové, hlasové, prepisovacie a embedding modely tento výber vylúči.
Pri **viacerých pripojených poskytovateľoch** tento automatický výber model
neurčí. Skontrolujte uloženú voľbu alebo vyberte poskytovateľa a model v lište
nad vstupným poľom. Ak vhodný model chýba, doplňte poskytovateľa, ktorý ho ponúka.

> Pri chybe `No endpoints found that support tool use` overte, či vybraný model
> a jeho endpoint podporujú nástroje, a skúste vhodný model v pickeri.

### Ladiaci port

Aplikačný CDP port je od upstream syncu v0.2.1 **predvolene vypnutý**.
V zabalenom builde zostáva vypnutý aj pri nastavenej premennej prostredia.
Vývojové zapnutie na explicitnom porte opisuje [Ladiaci port Electronu](#ladiaci-port-electronu).

## 5b. Smoke scenár alfy

Krátka verzia [alfa akceptačného protokolu](lawoss-alpha-acceptance.md), ktorý
obsahuje preflight, maticu poskytovateľov a kritériá PASS/FAIL. Onboarding
z #103, #104, #106 a #108 je súčasťou `dev` od 4. 10. 2026. Použite syntetické
údaje, zaznamenajte commit buildu aj režim Lite/Pro a odchýlku hláste podľa sekcie 6.

| # | Krok | Očakávaný výsledok |
|---|---|---|
| 1 | Vy a voľba OKF | „Nastavte svoju prax“ → vymyslené meno, jurisdikcia, jazyk. V kroku „Organizácia spisov“ nie je nič predvolené. Pri „Používať OKF“ sa pokračuje až po zaškrtnutí „Beriem na vedomie…“; text nehovorí o súhlase. |
| 2 | Kancelária | Nová kancelária v testovacom priečinku. Pred zápisom „Náhľad zmien“, potom „Potvrdiť a vykonať“. Vznikne `okf.config`, kancelária nie je pracovný priestor. |
| 3 | Dáta a AI | Krok výslovne uvedie stav modelu („Model je pripojený:“ alebo „Zatiaľ nemáte pripojený model“). Poskytovateľa pripojte podľa sekcie 5a. Analytika je predvolene vypnutá. Bez modelu tlačidlo znie „Pokračovať bez modelu“. |
| 4 | Klient a vec | Klient s bodkami (`Testovací klient s. r. o.`) prejde, priečinok je bez koncovej bodky. **Klient je workspace**, vec jeho podpriečinok so skillmi `novy-spis`, `okf-pamat`, `usporiadaj-spis`. |
| 5 | Dokument, pamäť a nový rozhovor | Otázka k syntetickému dokumentu uvedie zdroj. Uložená testovacia informácia (lehota alebo zapojený subjekt) sa zobrazí v detaile veci a rozsah pamäte uvedie vec, klienta aj kanceláriu. Nový rozhovor tej istej veci ju pozná, iná vec nie. |
| 6 | Reštart | Klient, vec, model, jazyk aj uložená informácia ostávajú. |

Kratšiu cestu **bez OKF** (voľba „Zatiaľ bez OKF“ → AI → voliteľný pracovný
priečinok, bez štruktúry a skillov OKF, v bočnom paneli „Zapnúť OKF“) opisuje
protokol v sekcii 2a. Hranice lokálneho alfa buildu sú v sekcii 7.

## 6. Čo hlásiť a kam

Chyby patria do **issues vo forku** (`https://github.com/Omni-Legal-Products/lawoss/issues`), nie do Telegramu.

Pri hlásení uveďte:

- **Reprodukovateľné kroky** — čo presne ste urobili, v akom poradí, a čo ste očakávali oproti tomu, čo sa stalo.
- **Verziu z `package.json`.** Poznámka: lokálny build z tohto návodu má `version: "0.0.0"` (appka toto číslo stampuje až pri oficiálnom release, lokálny build ho zámerne necháva neoznačený — pozri `apps/desktop/electron/updater.mjs`, `isUnstampedLocalBuild`). Namiesto/popri tom preto priložte aj commit, z ktorého ste stavali: `git rev-parse HEAD` a názov vetvy (`git branch --show-current`).
- **Operačný systém** a jeho verziu (napr. macOS 15.x, Windows 11), architektúru (arm64/x64) a verziu Node, ktorú ste použili.
- Ak padol `pnpm install` alebo `pnpm build`, priložte celý výpis chyby, nielen posledný riadok.

## 7. Čo alfa nerobí

- **Nie je notarizovaná.** OS pri spustení ukáže varovanie; to nie je chyba appky.
- **Nemá automatické aktualizácie.** Nový build znamená nové klonovanie a nový `pnpm install && pnpm build`. Updater má vlastnú logiku pre budúce release buildy, ale lokálny nestampnutý build (`0.0.0`) kontrolu aktualizácií preskakuje zámerne.
- **Nepatria do nej skutočné klientske dáta.** Je to testovací build bez bezpečnostného auditu produkčnej prevádzky — nepoužívajte ho so spismi, osobnými údajmi klientov ani inak citlivým obsahom. Na testovanie použite vymyslené alebo verejne dostupné dokumenty.

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
