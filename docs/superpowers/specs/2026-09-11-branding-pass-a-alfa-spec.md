# LAWOSS — branding pass a alfa build pre externých testerov

- **Autor:** MČ (s AI asistenciou) · 2026-09-11
- **Vychádza z:** [zápis sync callu 11. 9.](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-09-11-zapis-sync-call.md)
- **Stav:** návrh na schválenie

## Cieľ

Pripraviť fork na alfa testovanie externými testermi tak, aby v aplikácii nezostali stopy po LegalWorku ani po jeho komerčných plochách, aby rozhranie bolo kompletne po slovensky a česky — a aby fork **zostal synchronizovateľný s upstreamom**. Posledná podmienka je tvrdá a určuje tvar celého riešenia.

## Východiská (overené v `dev` 11. 9. 2026)

| Zistenie | Číslo |
|---|---|
| Súbory obsahujúce `legalwork` | 557 — drvivá väčšina sú strojové identifikátory |
| Používateľsky viditeľné reťazce s `LegalWork` | **229, takmer všetky v `apps/app/src/i18n/locales/en.ts`** |
| Prekladové kľúče v `en.ts` | 3 468 |
| Prekladové kľúče v `sk.ts` a `cs.ts` | 288 v každom → **chýba 3 210 v každom jazyku** |
| Zdrojové súbory ich LegalMemory | ~25 |
| Hotová časť brandingu | `appName`, `sidebarBrandName`, `<title>`, `productName`, ikony — zapísané v `PATCHES.md` |
| Nehotová časť | názvy release artefaktov — release z 11. 9. vyšiel ako **„LegalWork v0.1.14"** s assetmi `legalwork-*` |
| Build | `pnpm@11.4.0`, `node scripts/build.mjs` |

## Zásada, ktorá drží upstream sync

Platí zónový model z `PATCHES.md`:

- 🟢 **nové LAWOSS súbory** — žiadny konflikt, nikdy
- 🟡 **hodnotové zmeny v upstream súboroch** — povinný riadok v `PATCHES.md`
- 🔴 **štrukturálne zásahy do upstream kódu** — v tomto zadaní **nepoužívame**

Pravidlo, ktoré z toho plynie a ktoré je v celom dokumente rozhodujúce: **skrývame, nemažeme, a nahrádzame na jednom mieste, nie na dvesto miestach.**

---

## A. Branding

### A1. Substitučná vrstva namiesto prepisovania reťazcov

Do `apps/app/src/i18n/index.ts` pribudne jeden krok: funkcia `t()` pred vrátením hodnoty nahradí výskyt `LegalWork` za `LAWOSS`.

**Prečo takto a nie prepísaním `en.ts`:** jedna 🟡 zmena pokryje všetkých 229 reťazcov naraz a **pokryje aj tie, ktoré upstream pridá neskôr**. Prepísanie 229 hodnôt v `en.ts` by vytvorilo 229 miest, ktoré sa budú konfliktovať pri každom syncu — presne to, čomu sa zónový model vyhýba.

Nahrádza sa **iba presný tvar `LegalWork`**. Identifikátory ako `legalwork-server` alebo `LEGALWORK_DEV_MODE` ostávajú nedotknuté; tie sa v UI nezobrazujú a ich premenovanie by rozbilo beh.

### A2. Názvy release artefaktov a názov vydania

`productName` je LAWOSS, ale šablóna `artifactName` v `apps/desktop/electron-builder.yml` skladá názvy súborov z názvu balíka — odtiaľ `legalwork-mac-arm64-0.1.14.dmg`. Šablóna sa upraví na `lawoss-*` a rovnako sa zosúladí názov vydania v release workflowe. Existujúce vydanie `v0.1.14`, ktoré je dnes stabilné a nesie meno „LegalWork", sa zároveň preklopí na pre-release alebo premenuje — inak ostáva najnovším vydaním forku pod cudzím menom.

### A3. `appId` ostáva `com.eigenweltlabs.legalwork`

Zmena mení identitu bundle na macOS — keychain, Launchpad, TCC povolenia — a existujúce profily by prestali byť viditeľné. Ostáva tak, ako to už `PATCHES.md` deklaruje. **Je to vedomý dlh, evidovaný v otvorených položkách nižšie.**

### A4. Strojové identifikátory sa nedotýkame

Názvy balíkov (`@legalwork/app`, `legalwork-server`), premenné prostredia `LEGALWORK_*` a cesty. Používateľ ich nevidí; ich premenovanie by rozbilo sync natrvalo.

---

## B. Skrytie komerčných plôch a ich pamäte

Pribudne jeden 🟢 súbor s prepínačmi vlastnenými LAWOSS-om a minimálne guardy na miestach, kde sa dané plochy renderujú. **Upstream kód ostáva na disku a nedotknutý** — len sa nezobrazí.

Rozsah:

- **LegalMemory** — celý subsystém (~25 súborov) sa skryje
- **účtový systém** a prihlasovacie plochy
- **recorder**
- **komerčné položky Premium a Maximum**

Prvý krok je **inventarizácia**: presne zistiť, kde sa každá z týchto plôch renderuje. LegalMemory je zmapovaný, ostatné tri nie.

> **Poznámka k LegalMemory.** Skrytie neznamená, že ho zahadzujeme ako zdroj poznania. Ich riešenie grafu, kariet zdrojov a citácií je použiteľná inšpirácia pre naše OKF rozhranie a stojí za samostatné prezretie. **Základ ale zostáva to, čo sme postavili my** — `okf-pamat` a `okf` CLI.

---

## C. Preklad SK a CZ, kompletne

Rozsah: **3 210 kľúčov v každom jazyku, spolu 6 420 reťazcov.**

Postup: skript vytiahne z `en.ts` kľúče, ktoré v cieľovom jazyku chýbajú; preklad prebieha po dávkach a zapisuje sa priamo do `sk.ts` a `cs.ts`. **Sú to naše vlastné súbory, teda 🟢 zóna a nulový konflikt pri syncu.**

Pravidlá prekladu:

1. **Zástupné znaky ostávajú nedotknuté** — `{name}`, `{count}` a spol. musia prežiť doslova.
2. **Produktové termíny sa neprekladajú** — Skills, Plugins, Commands, Sessions, OpenCode, MCP.
3. **`LegalWork` → `LAWOSS`**, aj v našich prekladoch. Dnes sa v `sk.ts` nachádza aspoň jeden reťazec, ktorý ešte hovorí o serveri LegalWork.
4. **Slovenská a česká právna terminológia sa nepreklápa ticho jedna do druhej** — požiadavka z `AGENTS.md`. Český text nie je poslovenčená slovenčina.
5. Chýbajúci kľúč naďalej padá cez `t()` na angličtinu; fallback sa neruší.

Kontrola: existujúci `apps/app/scripts/i18n-check.ts` a CI job `i18n Audit`.

---

## D. Alfa build — vlastná kompilácia testerom

Notarizácia sa odkladá. **Tester si aplikáciu skompiluje sám**, čím odpadá podpisovanie aj Gatekeeper. Z toho vyplýva, že produktom balíka D **nie je artefakt, ale spoľahlivá a zdokumentovaná build cesta**.

Obsah:

- **Návod na zostavenie** pre macOS a Windows: požadované verzie nástrojov, `pnpm install`, build príkaz, prvý štart. Jeden dokument, bez predpokladu, že tester pozná monorepo.
- **Overenie na cudzom stroji** — Windows preverí IR, macOS niekto z tímu na čistom profile. Cieľ je, aby build zbehol bez zásahu do kódu.
- **Vstupná podmienka alfy** (z callu 11. 9.): funkčné pripojenie Anthropic · dokončený preklad · skryté komerčné plochy · OKF dostupné v aplikácii v rozsahu, ktorý dnes existuje pod Experimentmi (skill `/novy-spis`, `okf` CLI a stránka *Nový spis*), teda bez čakania na dokončenie pamäťového kontraktu.
- Vydania v repozitári ostávajú **pre-release** a pod názvom LAWOSS.

---

## Čo nie je v rozsahu

- zmena `appId`
- notarizácia a Apple Developer účet
- prepojenie LegalMemory rozhrania na `okf-pamat` ako backend
- premenovanie strojových identifikátorov a názvov balíkov

## Otvorené položky, ktoré z tohto zadania vypadli a nesmú sa stratiť

| Položka | Prečo je odložená | Čo ju odomkne |
|---|---|---|
| **`appId` `com.eigenweltlabs.legalwork` → vlastné** | zmena rozbije kontinuitu keychainu, profilu a TCC povolení | samostatné ADR s migračným plánom pre existujúce inštalácie |
| **Notarizácia macOS a podpis Windows** | Apple Developer účet zatiaľ nie je zriadený | zriadenie účtu; do tej doby testeri kompilujú sami |
| **Čo si vziať z LegalMemory pre OKF** | subsystém sa v alfe skrýva, nie zahadzuje | samostatné prezretie ich grafu, kariet zdrojov a citácií ako inšpirácie pre OKF rozhranie |

## Overenie

1. `i18n-check` a CI job `i18n Audit` — po každej prekladovej dávke
2. existujúce sady testov aplikácie a desktopu
3. smoke scenár: onboarding → pripojenie modelu → založenie spisu → zápis → reštart aplikácie
4. **kontrola po syncu:** po najbližšom merge z upstreamu musia všetky 🟡 riadky v `PATCHES.md` naďalej sedieť; substitučná vrstva sa overí tým, že nové upstream reťazce s `LegalWork` sa zobrazia ako LAWOSS bez ďalšieho zásahu

## Riziká

- **Substitučná vrstva môže zasiahnuť reťazec, kde má `LegalWork` zostať** — napríklad odkaz na upstream projekt v licenčnej alebo atribučnej hláške. Ošetrí sa zoznamom výnimiek podľa kľúča, nie podľa obsahu.
- **Objem prekladu** — 6 420 reťazcov je desiatky dávok; riziko je nekonzistentná terminológia naprieč dávkami. Ošetrí sa slovníkom kľúčových pojmov, ktorý sa drží od prvej dávky.
- **Skrývanie namiesto mazania znamená, že kód ďalej existuje** — ak sa prepínač niekde obíde, plocha sa zobrazí. Pokryje sa smoke scenárom.
