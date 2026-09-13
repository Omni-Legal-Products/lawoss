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
| **bun** | 1.4.0, na spúšťanie `apps/app` testov. Pinnutá verzia sa medzi CI workflowmi líši a job, ktorý reálne spúšťa `apps/app` testy (`.github/workflows/ci-tests.yml`), bun verziu nepinuje (`oven-sh/setup-bun@v2` bez `bun-version` — inštaluje najnovšiu); pin `1.3.6`/`1.3.9` je iba v alfa/release buildoch, nie v teste | či presne 1.4.0 zodpovedá tomu, čo si CI v momente vášho behu nainštaluje ako "najnovšiu" |
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

1. **Pripojte model.** V appke choďte na **Settings → AI Providers** a pripojte AI model, ktorý chcete používať (vlastný API kľúč alebo iný podporovaný spôsob pripojenia). Appka bez pripojeného modelu nemá s čím pracovať.
2. **Založte testovací priečinok.** Pri prvom spustení appka ponúkne výber pracovného priečinka. Vytvorte si na to nový, prázdny priečinok mimo akéhokoľvek reálneho spisu — **nepoužívajte priečinok so skutočnými klientskymi dátami** (dôvod je v sekcii 6).
3. **Prepnite jazyk.** V **Settings → Language** (SK/CZ lokalizácia je súčasťou LAWOSS jadra) zvoľte preferovaný jazyk rozhrania.
4. Vyskúšajte appku na neškodnej úlohe — napríklad nechajte ju zhrnúť testovací dokument, ktorý ste sami vložili do testovacieho priečinka.

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

`pnpm dev` **neotvára** ladiaci port (CDP). Kto sa naň pripojí, riadi okno
aplikácie aj jej session, takže port je od 13. 9. 2026 na vyžiadanie:

```bash
LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT=9823 pnpm dev
```

Bez premennej beží appka rovnako, len bez otvoreného portu. Skript
`scripts/legalwork-debug.sh` si port nastavuje sám.
