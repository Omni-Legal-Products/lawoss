# Základ OKF a alfa pre testerov: plán MČ (19. až 24. 10. 2026)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Pri každej **Bráne MČ** sa zastav, zhrň stav a čakaj na výslovný pokyn MČ.

**Cieľ:** Do soboty 24. 10. vydať alfu, v ktorej advokát pripojí nový alebo existujúci priečinok, ten sa usporiada do OKF, dashboard ho ukáže a nad dokumentom sa dá pýtať. Rozhranie má byť jednoznačné a bez technických slov.

**Architektúra:** Najprv sa zlúčia Vojtove opravy zo scenárov (#170, #171, #173, #174, potom #177), lebo posúvajú základ a menia súbory, na ktoré nadväzujeme. Potom MČ v krátkych vetvách z aktuálneho `dev` opraví OKF validáciu, zjednotí nastavenia, sidebar, tok onboardingu a triedenie a pripraví alfu s návodom. Rozšírenia (Obsidian, Google kalendár, OpenCode 2, časová os komunikácie, náhľad EML, OpenUI) sú mimo tohto plánu.

**Tech stack:** TypeScript, React (`apps/app`), Bun 1.4.2 (testy, `lawoss/okf`), pnpm 11.4.0, Electron (`apps/desktop`), Python 3.11+ (nástroj k syntetickým dátam), GitHub Actions (alfa workflowy), `gh`.

**Spec:**
- [Zápis callu MČ a VŘ 19. 10. 2026](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-10-19-zapis-call-mc-vr.md) (koordinačné repo, `main` `11aec9a0`), body Z1 až Z6, rozhodnutia A1 až F2 a akčné body MČ.
- [Spec onboardingu cez pripojenie priečinka](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/specs/2026-10-08-onboarding-pripojit-priecinok.md) (prijatý 13. 10.).
- Stav kódu: `dev` `310cb34e`. Prieskum 19. 10. je zhrnutý v časti „Východiská“.

---

## Rozhodnutia pred štartom

Každé rozhodnutie má odporúčanú voľbu. Ak MČ plán schváli bez zmeny, platí odporúčanie.

| # | Otázka | Odporúčanie |
|---|---|---|
| R1 | Kto tento týždeň mení súbory, ktoré upravuje aj #168? | **MČ.** #168 sa aj tak rozdelí a ide až po alfe (C1). VŘ ho potom zosúladí s `dev`. Zoznam súborov je v časti „Hranice s VŘ“. |
| R2 | Robiť pred usporiadaním existujúceho priečinka automatickú zálohu? | **Nie v alfe.** Presun už teraz overuje hash, zachováva bajty a dá sa vrátiť. Pridá sa jasné odporúčanie zálohy a skúšky na kópii (Úloha 6). Automatická záloha až po alfe, ak ju testeri budú chcieť. |
| R3 | Dovoliť vlastný názov namiesto `Office` a `Klienti`? | **Nie v alfe.** `Office` je natvrdo v desiatke detektorov. Vlastný priečinok klientov už ide cez `client_path` v nastaveniach. Po alfe samostatný spec. |
| R4 | Starý formulár „Klient“ so skúšobným klonom popri obrazovke „Toto som našiel“? | **Ponechať**, lebo skúšobný klon je bezpečná práca na kópii (rozhodnutie MČ 5. 10.). Odstrániť z neho technické slová (Úloha 6). Zjednotenie oboch tokov až po alfe. |
| R5 | Vypnúť v alfe automatickú kontrolu aktualizácií? | **Nie.** Kontrola len upozorní, stiahnutie aj inštalácia potrebujú súhlas (`autoDownload=false`). Testerom to vysvetlí návod (Úloha 10). |
| R6 | Má `okf validate` hlásiť aj karty rôznych typov v jednom priečinku (`client.md` a `matter.md`)? | **Áno**, rovnako ako `okf render`. |
| R7 | Ako riešiť veľkého klienta (nad 1 GiB alebo 10 000 položiek), ktorého dnes nejde usporiadať? | **Pre alfu zvýšiť limit usporiadania na 4 GiB a 20 000 položiek** a pridať zrozumiteľnú hlášku s náhradnou cestou (Úloha 7). Sken, ktorý hashuje len presúvané súbory, až po alfe. |
| R8 | Kto schvaľuje PR MČ, keď `dev` vyžaduje jedno schválenie? | **VŘ.** Admin bypass len po výslovnom pokyne MČ pri konkrétnom PR. |

---

## Hranice s VŘ: aby sme si neliezli do kapusty

**VŘ tento týždeň:** zosúladí #170, #171, #173 a #174 so základom, preverí providerov (Gemini cez OpenRouter, predplatné ChatGPT), overí alfu na čistom Macu, otestuje opravu balenia v #168 a rozdelí ho (po alfe) a navrhne české skilly a MCP do `lawoss-marketplace`.

**MČ tento týždeň:** review a merge opráv VŘ, OKF validácia, nastavenia, sidebar, onboarding a triedenie, návod pre testerov a vydanie alfy.

**Súbory, kde sa prekrývame a ktoré tento týždeň mení MČ (R1).** VŘ ich do vydania alfy nemení. #168 ich po alfe zosúladí s `dev`.

| Súbor | Otvorené PR VŘ | Kedy ho MČ mení |
|---|---|---|
| `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` | #168 | Úloha 6 |
| `apps/app/src/lawoss/domains/onboarding/entry-actions.tsx` | #168 | Úlohy 5 a 8 |
| `apps/app/src/lawoss/lite/lite-nav.tsx` | #168 | Úloha 5 (len pri voľbe R1 v Bráne G2) |
| `apps/app/src/lawoss/i18n/shell.ts` | #168 | Úlohy 6 a 7 |
| `apps/app/src/i18n/locales/sk.ts` | #168, #177 | Úloha 3 (jeden riadok, zelená zóna; ak #177 ešte nie je zlúčený, zosúladí ho VŘ) |
| `apps/app/src/react-app/shell/session-route.tsx` | #168, #174 | Úloha 3, až po zlúčení #174 |
| `docs/lawoss-build-pre-testerov.md`, `README.md` | #168 | Úloha 10 |
| `PATCHES.md` | všetky | iba pridanie riadkov na koniec tabuľky, nikdy nie úprava cudzích riadkov |

**MČ nemení:** `apps/app/src/lawoss/okf/read-model.ts` (#168, #175, #176), `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` a `preview.tsx` (#177), `apps/server/src/lawoss/onboarding.ts` (#168), `SYNTHETIC_DATA.md` (#172), `lawoss/testing/fixtures/**` (#172), `scripts/release/**` ani alfa workflowy (#168). Výnimkou je Úloha 11, ktorá workflowy len spúšťa. Úplný zoznam súborov PR VŘ: `gh pr diff <číslo> --name-only`.

**Správa pre VŘ (odošle MČ v Bráne G0 do Telegramu, topic Meetings | Transcripts, a ako komentár k #168):**

> Vojta, plán na tento týždeň podľa callu 19. 10.: najprv zlúčim tvoje #170, #171, #173, #174 (a #177 po preretargetovaní). Potom do soboty robím OKF validáciu, jedno ozubené koliesko, sidebar, onboarding a triedenie a návod pre testerov. Kvôli tomu do alfy mením aj súbory, ktoré upravuje #168: lawoss-welcome-page.tsx, entry-actions.tsx, lite-nav.tsx, lawoss/i18n/shell.ts, locales/sk.ts, session-route.tsx a návod pre testerov. #168 prosím rozdeľ a zosúlaď s dev až po alfe. Do read-model.ts, artifact-panel.tsx, onboarding.ts na serveri ani do release skriptov nesiahnem. Moje PR ti pošlem na review. Ak niečo z toho koliduje s tým, čo práve robíš, napíš mi a dohodneme sa.

---

## Brány MČ

Autonómny beh sa pri každej bráne zastaví a pokračuje až po výslovnom pokyne MČ.

| Brána | Kedy | Čo MČ rozhodne |
|---|---|---|
| G0 | pred prvou úlohou | schváli plán a rozhodnutia R1 až R8. Plán sa pushne ako draft PR do `lawoss`, aby naň správa pre VŘ mohla odkázať a VŘ mohol komentovať prekryvy. Potom MČ odošle správu pre VŘ. |
| G1 | po review #170, #171, #173, #174 | schváli review a merge (memory: najprv zhodnotiť a odpovedať, potom merge, len merge commit) |
| G1b | po review #177 na `dev` | schváli merge #177 |
| G2 | po screenshotoch sidebaru (Úloha 4) | vyberie variant sidebaru |
| G3 | po zelených testoch na `dev` | spustí alfa build a jeho zverejnenie |
| G4 | po overení alfy (VŘ na čistom Macu, Windows tester) | schváli oznámenie testerom |

Každý PR MČ ide na review VŘ (R8). Merge PR MČ bez schválenia VŘ len po pokyne MČ pri danom PR.

**Čo robiť počas čakania.** VŘ má tento týždeň pojednávanie, review nemusí prísť v ten istý deň. Beh preto nečaká na celé reťaze:
- Úlohy 2, 4, 6, 9 a 10 idú hneď, každá vo vlastnej vetve z `dev`.
- Úloha 3 čaká len na zlúčenie #174 (`session-route.tsx`). Všetko ostatné v nej môže ísť skôr.
- Úlohy 7 a 8 menia `lawoss/okf/src/triage/scan.ts`, preto idú za sebou: najprv 7, Úloha 8 sa vetví z vetvy 7 alebo z `dev` po jej zlúčení.
- Úloha 5 čaká na G2 a Úloha 11 na zlúčenie všetkého.
- Ak PR čaká na review dlhšie ako jeden pracovný deň, pripomeň ho VŘ komentárom v PR a nahlás to MČ. Nemerguj.

---

## Harmonogram

| Deň | Práca |
|---|---|
| Po 19. 10. | G0, Úloha 1 (review), Úloha 2 (validácia) |
| Ut 20. 10. | G1 a merge, Úloha 3 (koliesko), Úloha 4 (screenshoty), G2 |
| St 21. 10. | Úloha 5 (sidebar), Úloha 6 (onboarding) |
| Št 22. 10. | Úlohy 7 a 8 (triedenie), Úloha 9 (upozornenie na alfu), Úloha 10 (návod) |
| Pi 23. 10. | Úloha 12 (sync v0.2.10), review PR MČ s VŘ, Úloha 11 (testy na `dev`), G3, build, overenie VŘ |
| So 24. 10. | opravy po overení, G4, oznámenie testerom |

MČ je od 25. 10. do 13. 11. preč a dostupný len sporadicky.

---

## Východiská z prieskumu kódu (19. 10., `dev` `310cb34e`)

- **OKF validácia.** Chyba „Viac kariet entity“ vzniká len v `existingCard()` (`lawoss/okf/src/core.ts:107-111`) a v `render()` (`lawoss/okf/src/fs.ts:212-213`). `validate()` (`fs.ts:139-158`) ju nevolá. Kanonické karty sú `client.md`, `matter.md`, `project.md` a staršie `klient.md`, `spis.md`, `projekt.md` (`core.ts:101-104`). Chyba má tvar `{ path, message }` (`core.ts:208`).
- **Ozubené kolieska.** Všetky sú v upstream súboroch, takže každá zmena potrebuje riadok v `PATCHES.md`. Jediné koliesko, ktoré ostáva, je `SettingsButton` v `eigenwelt-account-menu.tsx:31` dole v lište.
- **Sidebar.** Oproti upstreamu v0.2.9 (`e6269d1c`) pridáva LAWOSS značku, `LawossNav` (v Pro „Experimenty“, v Lite LiteNav), riadok s ikonami onboardingu (`app-sidebar.tsx:875`) a v Lite skrýva sekcie rozhovorov. Náhľad bez Electronu: `session-inbox-preview.html`, ktorý však natvrdo nastavuje angličtinu (`src/session-inbox-preview.tsx:29`).
- **Onboarding.** Na prázdny priečinok funguje „Začať nanovo“. Na existujúci priečinok funguje „Nie, len pridaj OKF súbory“ aj pri veľkom priečinku. „Áno, usporiadaj“ zlyhá nad 1 GiB alebo 10 000 položiek (`classify.ts:236-240`). Súbory v `00_Na_zatriedenie` vnútri veci sa netriedia (`scan.ts:270`, `in_matter`). Opakované triedenie ide znova cez konverziu. `clientsFolderOf()` (`lawoss-welcome-page.tsx:70`) predpokladá cestu `.../Office`, ale tok „nanovo“ a tok praxe ukladajú koreň praxe, takže predvyplní `../Klienti` mimo praxe. V slovenských textoch sú technické slová (`found-text.ts:6`, `:40`, `okf-notice.tsx`).
- **Alfa.** Workflowy `alpha-macos-aarch64.yml` (vstup `draft`) a `alpha-windows-x64.yml` (`allow_unsigned_internal`) sa spúšťajú ručne. Updater nič nestiahne bez súhlasu. Upozornenie na alfu v appke chýba. Návod je v `docs/lawoss-build-pre-testerov.md`.

---

## Global Constraints

- Pracuj v novom worktree z aktuálneho `origin/dev`, každá úloha vo vlastnej vetve `fix/*`, `feat/*` alebo `chore/*`. Nikdy force-push, nikdy priamo do `dev`.
- Commity po slovensky, formát `typ: čo`, s riadkom `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. PR popis končí `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Bun 1.4.2 musí byť v `PATH` pred `bun run build`. Commitnutý `lawoss/okf/bundle/okf.js` musí po druhom identickom builde dať prázdny `git diff --exit-code bundle/`.
- Každý zmenený upstream súbor dostane v tom istom PR riadok v `PATCHES.md`, pridaný na koniec tabuľky.
- Texty v appke píš v jazyku advokáta. V slovenčine ani češtine nesmú byť názvy nástrojov (Claude Code, Codex), názvy súborov (`AGENTS.md`, `CLAUDE.md`, `memory/`) ani anglické slová. Pri každom novom kľúči doplň `sk`, `cs`, `en` aj `de` a over `pnpm --filter @legalwork/app test:i18n` aj `node scripts/i18n-audit.mjs --ci`. V nemeckých reťazcoch sa nepoužíva dlhá pomlčka.
- Len syntetické dáta. Dataset sa sťahuje podľa `SYNTHETIC_DATA.md` do ignorovaného `.work/synthetic-sk/`. Zápisové testy bež na jeho kópii a `ground-truth/` nikdy nedávaj modelu.
- Nemeň súbory zo zoznamu „MČ nemení“. Súbory z tabuľky prekryvu meň až po splnení podmienky v stĺpci „Kedy“.
- Pred každým PR spusti testy dotknutej časti a do popisu PR napíš presné príkazy a výsledky.
- PR MČ sa nesmú biť navzájom. Po každom merge do `dev` zlúč `origin/dev` do každej otvorenej vetvy MČ pred ďalším pushom (`git merge`, nie rebase ani force-push). V `apps/app/src/lawoss/i18n/shell.ts` pridáva každá úloha kľúče do bloku svojej domény (`lawoss.onboarding.*`, `lawoss.triage.*`, `lawoss.alpha.*`, `lawoss.lite.*`), nie na koniec súboru. Riadky `PATCHES.md` sa pridávajú na koniec tabuľky. Pri konflikte ponechaj oba riadky.
- `apps/app/src/i18n/locales/sk.ts` a `cs.ts` sú zelená zóna a nepotrebujú riadok v `PATCHES.md`.

## Review Focus

1. **Vec s jedinou staršou kartou (`spis.md`) aj klient s `klient.md` musia validáciou prejsť bez chyby.** Test je v Úlohe 2.
2. **Windows cesty v `clientsFolderOf`.** Pre `C:\\Prax\\Office` aj `C:\\Prax` musí vyjsť `C:\\Prax\\Klienti`. Test je v Úlohe 6.
3. **Súbor z priečinka na zatriedenie vo veci, ktorý má rovnaké meno ako súbor v cieľovom priečinku veci,** sa nesmie prepísať. Návrh musí kolíziu ukázať alebo súbor premenovať. Test je v Úlohe 8.
4. **Zamknutý súbor (otvorený vo Worde) pri usporiadaní väčšieho klienta po zvýšení limitov** sa ďalej len preskočí a nahlási. Test je v Úlohe 7.
5. **Posun dátumov v syntetických dátach musí zachovať BOM a CRLF** a binárne súbory nechať bajtovo rovnaké. Test je v Úlohe 10.

---

### Príprava (raz, pred Úlohou 1)

- [ ] Vytvor worktree: `git -C ~/Projects/LAWOSS-PROJECT/lawoss worktree add ../.worktrees/lawoss-alfa-mc origin/dev`. Nainštaluj závislosti (`pnpm install --frozen-lockfile`) a over `bun --version` = 1.4.2.
- [ ] Stiahni a over SK dataset podľa `SYNTHETIC_DATA.md` do `.work/synthetic-sk/` (overená kópia je aj v scratchpade sedenia 19. 10.).

### Úloha 1: Review a merge opráv VŘ (#170, #171, #173, #174, #172, potom #177)

**Súbory:** žiadne zmeny kódu. Výstup je review komentár ku každému PR (zatiaľ ako koncept v `.work/review/<číslo>.md`).

- [ ] **Krok 1:** Pre každé z #170, #171, #173 a #174: `git fetch origin pull/<n>/head:refs/vr/<n>`, worktree na `refs/vr/<n>`, `pnpm install --frozen-lockfile`. Spusti testy, ktoré PR uvádza v popise, a k nim `pnpm --filter @legalwork/app test` a pre serverové PR `cd apps/server && bun test <dotknuté súbory testov>`. Očakávaný výsledok: 0 FAIL.
- [ ] **Krok 2:** #171 over na SK e-maile. Spusti zamerané testy, ktoré PR uvádza (príprava dokumentov a EML na serveri). Potom v rovnakom teste, aký PR pridáva pre EML, nahraď vstup kópiou `02_OKF_kancelaria/Klienti/C001-…/Spisy/M001-…/01_Podklady/IN-006/Re podklady.eml` (len lokálne, necommitovať). Očakáva sa neprázdne telo a práve jedna príloha PDF, ktorej SHA-256 sa rovná hashu `01_Podklady/IN-003/Podklady.pdf` tej istej veci (dataset to garantuje).
- [ ] **Krok 3:** Prečítaj diff každého PR so zreteľom na Z2 a Z3 a na slovenské dáta. Do konceptu review napíš výsledok testov, nálezy (blokujúce a neblokujúce) a odporúčanie.
- [ ] **Krok 4 — Brána G1:** Ukáž MČ koncepty review. Po pokyne ich zverejni (`gh pr review <n> --approve|--comment --body-file …`) a zlúč v poradí #170, #173, #174, #171 cez `gh pr merge <n> --merge`.
- [ ] **Krok 4b:** #172 (česká testovacia sada, B2): spusti `node lawoss/testing/fixtures/verify.mjs` podľa popisu PR a prezri tri náhodné dokumenty. Do review napíš otázku na nezávislú kontrolu súkromia. Merge až po odpovedi VŘ a pokyne MČ (Brána G1).
- [ ] **Krok 5:** Po zlúčení #171 preretarguj #177 (`gh pr edit 177 --base dev`). Pozor: po zmene základne sa workflowy samy znova nespustia. Požiadaj VŘ, aby do vetvy #177 zlúčil `dev` (spustí CI), alebo chýbajúce joby spusti lokálne nad preretargetovanou hlavou a uveď to v review. Potom zopakuj kroky 1 a 3. **Brána G1b**, potom merge.

### Úloha 2: `okf validate` hlási viac kariet v jednom priečinku

**Súbory:**
- Upraviť: `lawoss/okf/src/fs.ts` (`validate()`, približne riadky 139-158)
- Test: `lawoss/okf/test/card-compatibility.test.ts`, `lawoss/okf/test/okf.test.ts`
- Prebudovať: `lawoss/okf/bundle/okf.js`

**Interfaces:** Produkuje `validate(root: string): Promise<ValidationError[]>` (signatúra sa nemení) s novou chybou `{ path: "<relatívny priečinok, koreň = \"\">", message: "Viac kariet entity: <a.md>, <b.md>. Najprv zosúlaď ich obsah." }`. Názvy kariet sú zoradené abecedne.

- [ ] **Krok 1: Testy, ktoré zlyhajú.** V `card-compatibility.test.ts` pre každý riadok cyklu `{type, canonical, legacy}` pridaj: priečinok s `canonical` aj `legacy` → `validate(root)` vráti práve jednu chybu, ktorej `message` obsahuje `"Viac kariet entity"`. Ďalší test: priečinok so `client.md` a `matter.md` → jedna chyba s `"Viac kariet entity: client.md, matter.md"` (R6). Regresia: priečinok len so `spis.md` a priečinok len s `klient.md` → `[]`. V `okf.test.ts` v štýle riadkov 115-120: `run(["validate", root])` nad priečinkom s `matter.md` a `spis.md` → exit 1.
- [ ] **Krok 2:** `cd lawoss/okf && bun test test/card-compatibility.test.ts test/okf.test.ts`. Očakáva sa FAIL na nových testoch.
- [ ] **Krok 3:** Uprav `validate()`. Zozbieraj priečinky entít (koreň a priečinky všetkých nájdených `.md`), v každom spočítaj prítomné názvy z `CARD_FILE` a `CARD_ALIASES` a pri viac ako jednom pridaj chybu.
- [ ] **Krok 4:** `cd lawoss/okf && pnpm typecheck && bun test test/`. Očakáva sa PASS.
- [ ] **Krok 5:** `bun run build && bun run build && git diff --exit-code bundle/` (po prvom builde je zmena, po druhom identickom už žiadna). Over aj scenár E011 z datasetu: `node bundle/okf.js validate <kópia 03_Edge_cases/E011/…>` → exit 1.
- [ ] **Krok 6:** Commit `fix: okf validate hlási viac kariet v jednom priečinku` a PR `fix/okf-validate-karty` s review od VŘ.

### Úloha 3: Ozubené koliesko len pre nastavenia appky (D1)

Závisí od zlúčenia #174 a #177 (Úloha 1).

**Súbory** (cesty pod `apps/app/src/`):
- Upraviť: `react-app/domains/session/sidebar/app-sidebar.tsx:870`, `react-app/domains/session/chat/session-page.tsx:1469`, `components/model-select.tsx:306`, `react-app/domains/session/surface/composer/tool-menu.tsx:91`, `react-app/domains/workspace/project-home.tsx:164,185`, `react-app/domains/reviews/project-reviews.tsx:158,160`, `react-app/domains/session/panel/workspace-window-button.tsx:55`, `react-app/shell/session-route.tsx` (`statusBar`), `i18n/locales/sk.ts` (`projects.configure_fields`), `PATCHES.md`
- Test: nový `apps/app/tests/lawoss-single-settings-icon.test.ts`

| Miesto | Zmena |
|---|---|
| hlavička sidebaru, „Prispôsobiť navigáciu“ | ikona `PencilLine` |
| `session-route.tsx` | `statusBar={{ …, showSettingsButton: false }}` (druhé koliesko v stavovom riadku zmizne) |
| úvod rozhovoru, „Pripojiť rozšírenie“ | ikona `Plug` |
| výber modelu, „Všetky modely“ | ikona `List` |
| menu skladania, „Nastaviť“ | bez ikony, len text |
| domov veci, úprava polí | ikona `PencilLine`, SK text „Upraviť polia“ |
| revízie, nastavenia revízie | tlačidlo s textom bez ikony (158) a režim bez ikony (160) |
| okno pracovného priestoru, „Zmeniť zapamätanú voľbu“ | ikona `RotateCcw` |

Nemeniť: `eigenwelt-account-menu.tsx:31` (jediné koliesko), ikony vnútri Nastavení, `SlidersHorizontal` pre filtre a zobrazenie a skryté funkcie (nahrávač, wiki).

- [ ] **Krok 1: Test, ktorý zlyhá.** `lawoss-single-settings-icon.test.ts` načíta zdrojový text súborov z tabuľky a overí, že žiadny z nich neimportuje z `lucide-react` `Settings`, `Settings2` ani `Cog`. Zároveň overí, že `eigenwelt-account-menu.tsx` `Settings` importuje a že `session-route.tsx` obsahuje `showSettingsButton: false`.
- [ ] **Krok 2:** `cd apps/app && bun test tests/lawoss-single-settings-icon.test.ts`. Očakáva sa FAIL.
- [ ] **Krok 3:** Zmeny podľa tabuľky a riadok v `PATCHES.md` so zoznamom upstream súborov (bez `sk.ts`, ten je zelená zóna) a dôvodom „jedno ozubené koliesko = nastavenia appky (zápis 19. 10., D1)“.
- [ ] **Krok 4:** `pnpm --filter @legalwork/app test`, `pnpm --filter @legalwork/app test:i18n`, `pnpm typecheck` a `node lawoss/scripts/check-branding.mjs`. Očakáva sa PASS. Pozor: `tests/lawoss-hidden-upstream-surfaces.test.tsx:117-118` kontroluje presné riadky v `app-sidebar.tsx`, nepreformátuj ich.
- [ ] **Krok 5:** Commit `fix: ozubené koliesko len pre nastavenia appky` a PR `fix/jedno-koliesko`.

### Úloha 4: Screenshoty sidebaru na rozhodnutie (D2, Brána G2)

**Súbory:**
- Upraviť: `apps/app/src/session-inbox-preview.tsx:29`, aby čítal `?locale=` (predvolene `en`)
- Výstup: HTML porovnanie ako claude.ai artefakt pre MČ (nie do repa)

- [ ] **Krok 1:** `session-inbox-preview.tsx` číta jazyk z `new URLSearchParams(location.search).get("locale")`. Povolené sú `sk|cs|en|de`, inak `en`.
- [ ] **Krok 2:** Spusti `pnpm exec bun scripts/preview-scheduled-tasks.ts` (fixture API na porte 8798) a `pnpm dev:ui` (port 5173). V Browser pane urob screenshoty `http://127.0.0.1:5173/session-inbox-preview.html?locale=sk&theme=dark` v režime Lite a Pro (`localStorage.setItem("lawoss.uiMode","pro")`), bežne a s `&narrow`.
- [ ] **Krok 3:** Pre porovnanie spusti ten istý náhľad z upstreamu v0.2.9 (`git worktree add … e6269d1c`, `pnpm install`). Ak sa ho nepodarí rozbehnúť do 20 minút, porovnaj podľa kódu (`git diff e6269d1c HEAD -- apps/app/src/react-app/domains/session/sidebar/`).
- [ ] **Krok 4:** Publikuj artefakt s dnešným stavom, upstreamom a tromi variantmi (nižšie) a čakaj na **Bránu G2**.
  - **V1:** ikony onboardingu (riadok `app-sidebar.tsx:875`) presunúť zo sidebaru do LiteNav ako jednu položku „Pridať priečinok“ a do stránky Klienti.
  - **V2:** v Pro pre alfu skryť položku „Experimenty“.
  - **V3:** v Lite zobraziť sekcie Projekty a Nedávne ako upstream.
  - **Odporúčanie:** V1 a V2.
- [ ] **Krok 5:** Commit zmeny náhľadu (`chore: náhľad sidebaru v zvolenom jazyku`) ide do PR Úlohy 5.

### Úloha 5: Sidebar podľa rozhodnutia G2

**Rozhodnutie MČ (G2, 19. 10.):**
- **V1:** riadok ikon onboardingu zo sidebaru preč, namiesto neho položka „Pridať priečinok“.
- **V2:** panel Experimenty preč úplne, nielen v Pokročilom režime.
- **Jedna appka** (R3, #163): bežný režim aj Pokročilé majú tú istú navigáciu LAWOSS (Dnes, Klienti a veci, Opýtať sa, Posledné veci). Pokročilé len pridá sekcie z upstreamu (Nový chat, Projekty, Nedávne sesie).
- **Dnes je to zle:** Pokročilý režim ukazuje namiesto navigácie LAWOSS len Experimenty (overené na screenshote 19. 10.).
- **Odložené:** V3 aj vnorený strom klient → veci → prehľad, lehoty a rozhovory (návrh „Domov veci nad OKF“, R5) až po tom, čo MČ prejde appku so syntetickými dátami.

**Súbory:**
- Upraviť: `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx:875` (odstrániť `OnboardingEntryActions compact` z riadku, `OkfWorkspaceSkillSync` ponechať)
- Upraviť: `apps/app/src/lawoss/shell/layout.tsx` (`LawossNav`: vždy `LiteNav`, `ExperimentsNav` odstrániť z navigácie; experimentálne trasy ostávajú v kóde, len bez vstupu v sidebare)
- Upraviť: `apps/app/src/lawoss/lite/lite-nav.tsx` (položka „Pridať priečinok“ s odkazom `ADD_FOLDER_PATH` z `onboarding/links.ts`)
- Upraviť podľa potreby: `apps/app/src/lawoss/feature-flags.ts`, `apps/app/src/lawoss/i18n/shell.ts` (`lawoss.lite.add_folder`)
- Test: `apps/app/tests/lawoss-lite-shell.test.tsx` a súvisiace testy shellu
- `PATCHES.md` pri `app-sidebar.tsx`

- [ ] **Krok 1: Testy, ktoré zlyhajú.**
  - (a) V bežnom aj Pokročilom režime sidebar vykreslí položky Dnes, Klienti a veci, Opýtať sa a „Pridať priečinok“ s odkazom na `ADD_FOLDER_PATH`.
  - (b) V žiadnom režime sa nevykreslí „Experimenty“ (`data-lawoss-nav="experiments"`) ani štyri ikonové tlačidlá onboardingu v riadku pod značkou.
  - (c) Pokročilý režim navyše vykreslí sekcie Projekty a Nedávne. V bežnom režime ostávajú skryté ako dnes.
- [ ] **Krok 2:** `cd apps/app && bun test tests/lawoss-lite-shell.test.tsx`. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia a kľúč `lawoss.lite.add_folder` („Pridať priečinok“) v `sk/cs/en/de`.
- [ ] **Krok 4:** Celé testy appky, i18n, typecheck. Nové screenshoty bežného aj Pokročilého režimu cez náhľad z Úlohy 4 (`?locale=sk`) do PR.
- [ ] **Krok 5:** Commit `feat: jedna navigácia LAWOSS v oboch režimoch, bez Experimentov` a PR `feat/sidebar-alfa`. Vetva už obsahuje commit Úlohy 4.

### Úloha 6: Onboarding: cesta ku klientom a texty bez technických slov

**Súbory:**
- Upraviť: `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` (`clientsFolderOf` na riadku 70; SK texty 141-170 a zodpovedajúce CS, EN, DE), `apps/app/src/lawoss/domains/onboarding/found-text.ts`, `apps/app/src/lawoss/domains/onboarding/okf-notice.tsx`, `apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx:34`, `apps/app/src/lawoss/i18n/shell.ts` (`lawoss.triage.*`)
- Test: `apps/app/tests/lawoss-onboarding-welcome.test.tsx`, nový `apps/app/tests/lawoss-onboarding-copy.test.ts`

**Interfaces:** `clientsFolderOf(officeRoot: string | undefined): string` (signatúra sa nemení). Pre koreň končiaci `Office` alebo `_kancelaria` vráti `<rodič>/Klienti`, pre koreň praxe `<koreň>/Klienti`, pre `undefined` doterajšie správanie. Oddeľovač zachová podľa vstupu (`\` alebo `/`).

**Nové SK texty** (CS, EN a DE preložiť rovnako, CS skontroluje VŘ v review):

| Kľúč | Text |
|---|---|
| `folderLead` | „LAWOSS pracuje priamo s priečinkami vo vašom počítači. Pripojte existujúci priečinok alebo začnite nanovo.“ |
| `freshDone` | „Priečinok je pripravený. Kancelária je v priečinku Office a klienti budú v priečinku Klienti.“ |
| `freshHowTo` | „Klientov sem skopírujte (pôvodné priečinky ostanú nedotknuté) a v bočnom paneli zvoľte Pridať priečinok. Každého klienta potom môžete usporiadať.“ |
| `reorganizeQuestion` | „Môžem priečinok usporiadať?“ |
| `okfNotice` | „Do priečinka pridám niekoľko pomocných súborov. Vďaka nim AI vie, čo v priečinku je. Žiadny váš súbor sa neprepíše ani nezmaže.“ |
| `answerNo` / `answerNoHint` | „Nie, nechaj ho tak, ako je“ / „Pridám len pomocné súbory, nič sa nepohne.“ |
| `answerYesHint` | „Najprv pridám pomocné súbory, potom ukážem, kam navrhujem dokumenty presunúť. Presun sa dá vrátiť. Odporúčam mať zálohu priečinka a prvý raz to vyskúšať na kópii alebo na syntetických dátach.“ |
| `working` | „Pridávam pomocné súbory: {done} z {total}“ |
| `filesTitle` | „Zoznam pomocných súborov“ (zoznam v `OkfNotice` sa zbalí do `<details>`) |

Staré texty formulára „Klient“ (`lawoss-welcome-page.tsx:141-170`) prepíš takto: „Režim pripojenia“ → „Ako pripojiť priečinok“, „Skúšobný klon“ → „Vyskúšať na kópii (odporúčané)“, „Doplniť OKF súbory“ alebo `convert` → „Pridať pomocné súbory do priečinka“. Technické polia („Relatívna cesta k existujúcej pamäti“, „Text identity“) patria k režimu `map`, ktorý je v alfe skrytý. Ak sa ešte vykresľujú, skry ich rovnakým príznakom.

V `triage-page.tsx:34` sa kód `not_trial_clone` mapuje na nový kľúč `lawoss.triage.not_client_folder`: „Usporiadať sa dá len priečinok klienta. Vyberte priečinok konkrétneho klienta.“ Nesurové chybové hlášky servera vo `lawoss-welcome-page.tsx` nahraď všeobecnou vetou `lawoss.onboarding.error_generic` a kód pošli do konzoly.

- [ ] **Krok 1: Testy, ktoré zlyhajú.**
  - Vo `lawoss-onboarding-welcome.test.tsx`: `clientsFolderOf("/x/Prax")` → `"/x/Prax/Klienti"`, `clientsFolderOf("/x/Prax/Office")` → `"/x/Prax/Klienti"`, `clientsFolderOf("C:\\Prax")` → `"C:\\Prax\\Klienti"`, `clientsFolderOf("C:\\Prax\\Office")` → `"C:\\Prax\\Klienti"`.
  - `lawoss-onboarding-copy.test.ts`: pre jazyky `sk` a `cs` žiadny text vo `found-text.ts` ani text `lawoss.triage.*` neobsahuje `Claude Code`, `Codex`, `AGENTS.md`, `CLAUDE.md`, `memory/`, `klon` ani `clone`.
- [ ] **Krok 2:** `cd apps/app && bun test tests/lawoss-onboarding-welcome.test.tsx tests/lawoss-onboarding-copy.test.ts`. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia podľa Interfaces a tabuľky textov.
- [ ] **Krok 4:** `pnpm --filter @legalwork/app test`, `test:i18n`, `i18n-audit --ci`, `pnpm typecheck`. Očakáva sa PASS.
- [ ] **Krok 5:** Commit `fix: onboarding bez technických slov a so správnou cestou ku klientom` a PR `fix/onboarding-texty`.

### Úloha 7: Usporiadanie väčšieho klienta (R7)

**Súbory:**
- Upraviť: `lawoss/okf/src/triage/scan.ts` (konštanta a hláška), `apps/server/src/lawoss/triage.ts:158` (odovzdať limity), `apps/app/src/lawoss/i18n/shell.ts` (`lawoss.triage.error_too_large`), `apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx` (mapovanie kódu)
- Test: `lawoss/okf/test/triage-in-place.test.ts`, `apps/server/src/lawoss-triage.e2e.test.ts`
- Prebudovať: `lawoss/okf/bundle/okf.js` a ďalšie generované výstupy `lawoss/okf`, ktoré server importuje cez `onboarding-runtime.ts`, ak sú generované (over v `package.json` a CI)

**Interfaces:** Produkuje `export const TRIAGE_INSPECTION_LIMITS: InspectionLimits = { maxBytes: 4 * 1024 ** 3, maxEntries: 20_000 }` v `scan.ts`. `scanTriage` ich použije, keď volajúci limity nezadá. Pri `byte_limit` alebo `entry_limit` vyhodí `Error` s `code = "triage_too_large"` a SK správou „Priečinok klienta je príliš veľký na usporiadanie naraz (viac ako 4 GB alebo 20 000 súborov). Zvoľte „Nie, nechaj ho tak, ako je“ alebo usporiadajte menší podpriečinok.“ Server ju vráti ako `ApiError(413, "triage_too_large", …)`.

- [ ] **Krok 1: Testy, ktoré zlyhajú.** V `triage-in-place.test.ts`:
  - `scanTriage(root, { limits: { maxBytes: 10 } })` nad klientom s 1 KB súborom zlyhá chybou s `code === "triage_too_large"`.
  - Bez limitov sa použijú `TRIAGE_INSPECTION_LIMITS`: vytvor riedky súbor `fs.truncate(path, 2 * 1024 ** 3)` (vznikne okamžite, hash 2 GB núl trvá sekundy). `scanTriage` bez zadaných limitov ho prečíta bez chyby, kým so starým limitom `{ maxBytes: 1024 ** 3 }` zlyhá s `triage_too_large`.
  - Review Focus 4: zamknutý súbor (cez existujúci háčik `lockedForWrite`) sa aj s novými limitmi preskočí s dôvodom `locked`.
  - V `lawoss-triage.e2e.test.ts`: odpoveď 413 s kódom `triage_too_large`.
- [ ] **Krok 2:** `cd lawoss/okf && bun test test/triage-in-place.test.ts` a `cd apps/server && bun test src/lawoss-triage.e2e.test.ts`. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia a nový kľúč `lawoss.triage.error_too_large` v `sk/cs/en/de` s rovnakým zmyslom ako SK správa.
- [ ] **Krok 4:** `cd lawoss/okf && pnpm typecheck && bun test test/`, serverový test, testy appky, i18n a rebuild bundlu s prázdnym diffom po druhom builde.
- [ ] **Krok 5:** Commit `fix: usporiadanie väčšieho klienta a zrozumiteľná hláška` a PR `fix/triedenie-limity`.

### Úloha 8: Triedenie nových súborov vo veci a opakované triedenie

**Súbory:**
- Upraviť: `lawoss/okf/src/triage/scan.ts` (reťazec dôvodov okolo riadku 270), podľa potreby `lawoss/okf/src/triage/plan.ts` (cieľ pre dokument s priradenou vecou), `apps/app/src/lawoss/domains/onboarding/found-flow.ts` (nová funkcia), `apps/app/src/lawoss/domains/onboarding/found-screen.tsx` (použitie), `apps/app/src/lawoss/domains/onboarding/entry-actions.tsx` (text akcie pre klienta, ktorý už má kartu)
- Test: `lawoss/okf/test/triage-in-place.test.ts`, `apps/app/tests/lawoss-onboarding-found-flow.test.ts`
- Prebudovať: bundle `lawoss/okf`

**Interfaces:**
- `scanTriage` zaradí súbor pod `<vec>/<matter.roles.inbox>/` medzi dokumenty s `matter: <id veci>`, namiesto preskočenia s dôvodom `in_matter`. Ostatné súbory vo veci ostávajú `in_matter`.
- `export async function reorganizeExistingClient(client: TriageClient, root: string): Promise<TriagePreview>` vo `found-flow.ts` volá rovnaké `triageGrant` a `triagePlan` ako `startReorganize` a nevolá `planOnboarding` ani konverziu. Obrazovka „Toto som našiel“ ju použije, keď návrh hlási klienta, ktorý už má kartu klienta.
- Akcia v `entry-actions.tsx` pre klienta s kartou má text `lawoss.onboarding.sort_new_files` („Roztriediť nové súbory“).

- [ ] **Krok 1: Testy, ktoré zlyhajú.**
  - V `triage-in-place.test.ts` je klient so `Spisy/2026-01 Spor/matter.md` a `Spisy/2026-01 Spor/00_Na_zatriedenie/zmluva.pdf`.
    - Inventár obsahuje `zmluva.pdf` s `matter` = id veci.
    - Plán ho presúva do role `client_documents` veci (napríklad `Spisy/2026-01 Spor/01_Podklady/zmluva.pdf`).
    - Review Focus 3: ak v cieľovom priečinku už `zmluva.pdf` existuje, plán ju neprepíše. Presun dostane nové meno, alebo sa zobrazí ako kolízia podľa doterajšieho správania plánu.
    - Súbor priamo vo `Spisy/2026-01 Spor/01_Podklady/` ostáva `in_matter`.
  - V `lawoss-onboarding-found-flow.test.ts` falošné API overí, že `reorganizeExistingClient` zavolá `triageGrant` a `triagePlan` a nezavolá `planOnboarding`.
- [ ] **Krok 2:** Spusti oba testy. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia podľa Interfaces a nový kľúč `lawoss.onboarding.sort_new_files` v `sk/cs/en/de`.
- [ ] **Krok 4:** `bun test test/` v `lawoss/okf`, testy appky, i18n, typecheck a rebuild bundlu. Ručne na kópii SK datasetu: do `00_Na_zatriedenie` jednej veci z `02_OKF_kancelaria` vlož `.pdf`. „Roztriediť nové súbory“ ho navrhne presunúť do tej veci a vrátenie presunu funguje.
- [ ] **Krok 5:** Commit `feat: triedenie nových súborov vo veci bez opätovnej konverzie` a PR `feat/triedenie-novych-suborov`.

### Úloha 9: Viditeľné upozornenie, že ide o alfu

**Súbory:**
- Vytvoriť: `apps/app/src/lawoss/alpha/alpha-notice.tsx`
- Upraviť: `apps/app/src/lawoss/feature-flags.ts` (`ALPHA_NOTICE = true`), `apps/app/src/lawoss/shell/layout.tsx` (pripojenie), `apps/app/src/lawoss/domains/onboarding/folder-step.tsx` (rovnaký text nad voľbami), `apps/app/src/lawoss/i18n/shell.ts` (`lawoss.alpha.notice`, `lawoss.alpha.dismiss`)
- Test: nový `apps/app/tests/lawoss-alpha-notice.test.tsx`

**Text (SK):** „Toto je alfa verzia LAWOSS na testovanie. Skúšajte ju na syntetických dátach alebo na kópii priečinka. Vlastné spisy len na vlastné riziko.“ Tlačidlo „Rozumiem“ skryje pruh do najbližšieho spustenia (`sessionStorage`, čítanie aj zápis v try/catch). V kroku Priečinok sa text zobrazí vždy, bez možnosti skryť.

- [ ] **Krok 1:** Test: pri `ALPHA_NOTICE = true` layout aj `FolderStep` vykreslia text kľúča `lawoss.alpha.notice`. Po kliknutí na „Rozumiem“ pruh v layoute zmizne, v `FolderStep` ostane.
- [ ] **Krok 2:** Spusti test. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia a kľúče v `sk/cs/en/de`.
- [ ] **Krok 4:** Testy appky, i18n, typecheck.
- [ ] **Krok 5:** Commit `feat: upozornenie na alfa verziu` a PR `feat/upozornenie-alfa`.

### Úloha 10: Návod pre testerov a posun dátumov v syntetických dátach

**Súbory:**
- Vytvoriť: `lawoss/testing/synthetic-sk/shift_dates.py`, `lawoss/testing/synthetic-sk/test_shift_dates.py`, `lawoss/testing/synthetic-sk/README.md`
- Upraviť: `docs/lawoss-build-pre-testerov.md`

**Interfaces:** `python lawoss/testing/synthetic-sk/shift_dates.py --source <priečinok kancelárie> --dest <neexistujúci priečinok> [--as-of 2026-10-17] [--today RRRR-MM-DD]` skopíruje strom. Vo všetkých `.md` súboroch posunie každý dátum `RRRR-MM-DD` o `today - as_of` dní. Ostatné súbory skopíruje bajtovo rovnaké. Existujúci `--dest` odmietne s exit 2. Len štandardná knižnica Pythonu.

- [ ] **Krok 1: Testy, ktoré zlyhajú** (`unittest`):
  - `due: 2026-10-20` sa pri `as_of 2026-10-17` a `today 2026-10-24` zmení na `due: 2026-10-27`.
  - Dátum v riadku histórie `- 2026-09-01 [request]` sa posunie rovnako.
  - `.md` s BOM a CRLF si oba zachová (Review Focus 5).
  - `.pdf` a `.docx` ostanú bajtovo rovnaké.
  - Existujúci `--dest` skončí exit 2.
  - Text `SYN-M001/2026` ostane nezmenený.
- [ ] **Krok 2:** `python -m unittest lawoss/testing/synthetic-sk/test_shift_dates.py`. Očakáva sa FAIL.
- [ ] **Krok 3:** Implementácia. Ak záznam pamäte nesie `truth_digest` (návrh VŘ, validátor ho kontroluje v `lawoss/okf-pamat/src/validate.ts:742`), posuň len dátumy vo frontmatteri a v časti `## History`, telo `## Truth` nechaj. Inak by validácia zlyhala na nezhode odtlačku. Doplň na to test so záznamom s `truth_digest`. Dataset v1 `truth_digest` nemá (overené 19. 10.), posunie sa celý text. Na skutočnej kópii `02_OKF_kancelaria` potom over `node lawoss/okf-pamat/bundle/okf-memory.js validate` na troch veciach. Očakáva sa exit 0 len so zámernými varovaniami.
- [ ] **Krok 4:** Prepíš `docs/lawoss-build-pre-testerov.md` na tieto časti:
  1. Upozornenie, že ide o alfu (text z Úlohy 9).
  2. Stiahnutie z releasov forku (macOS, Windows nepodpísaný len pre interný tím).
  3. Syntetické dáta: SK release podľa `SYNTHETIC_DATA.md` a posun dátumov k dnešku, CZ sada z #172 po jej zlúčení.
  4. Tri cesty na test: pripojiť priečinok a usporiadať ho, Dnes a Vec, otázka nad PDF a EML.
  5. Provideri: odporúčané je predplatné ChatGPT, Gemini cez OpenRouter má známy problém.
  6. Aktualizácie: appka nový build len ponúkne, inštalovať až po oznámení.
  7. Kam hlásiť chyby.
- [ ] **Krok 5:** Commit `chore: návod pre testerov alfy a posun dátumov syntetických dát` a PR `chore/navod-alfa`.

### Úloha 12: Sync na upstream LegalWork v0.2.10 (doplnené 19. 10. na pokyn MČ)

Dôvod: v0.2.10 (vydané 19. 10.) opravuje obídenie autorizácie osobných konektorov pri ID s medzerami ([#296](https://github.com/eigenweltlabs/legalwork/pull/296)), obnovu vzdialených MCP po výpadku siete a timeout OAuth ([#293](https://github.com/eigenweltlabs/legalwork/pull/293)), prístup k zdieľaným skill resources, pozíciu Word dokumentu a Markdown na celú obrazovku vo Windows. Rozsah je 3 commity a 20 súborov. Upstream PR #303 (MCP OAuth cez lokálnu bránu) a #304 (jednotný import pluginov) nie sú vydané a sync sa ich netýka.

Závisí od zlúčenia #173, #174 a #171 (Úloha 1). v0.2.10 mení `apps/app/src/app/lib/legalwork-server.ts`, ktorý mení aj #177, a `apps/server/src/agent-sandbox/*`, ktorý mení #168. Sync ide pred retarget #177 alebo hneď po jeho zlúčení, nikdy nie súbežne.

**Súbory:** podľa `git diff v0.2.9 v0.2.10 --stat` v upstreame. Konflikty rieš podľa `PATCHES.md`.

- [ ] **Krok 1:** `git fetch upstream --tags` a over, že tag `v0.2.10` ukazuje na commit z release. Z aktuálneho `origin/dev` založ vetvu `sync/upstream-v0.2.10` a spusti `git merge v0.2.10` (bežný merge, žiadny rebase).
- [ ] **Krok 2:** Vyrieš konflikty. Každý dotknutý súbor zo zoznamu `PATCHES.md` musí po merge zachovať LAWOSS úpravu. Prejdi `docs/upstream-sync-checklist.md`: stráž Eigenweltu a analytiky (`node lawoss/scripts/check-no-eigenwelt.mjs`), katalóg modelov, značka (`node lawoss/scripts/check-branding.mjs`).
- [ ] **Krok 3:** Testy: `pnpm --filter @legalwork/app test`, `test:i18n`, `node scripts/i18n-audit.mjs --ci`, `pnpm typecheck`, `cd apps/server && bun test src/connectors src/mcp-recovery.test.ts src/agent-sandbox`, `cd lawoss/okf && bun test test/`. Očakáva sa 0 FAIL.
- [ ] **Krok 4:** Desktopový smoke na izolovanom profile: appka sa spustí, pripojí sa priečinok, otvorí sa rozhovor a MCP konektor (ak je nastavený) sa po vypnutí a zapnutí siete obnoví bez nového prihlásenia.
- [ ] **Krok 5:** Commit merge `sync: upstream LegalWork v0.2.10` a PR `sync/upstream-v0.2.10` s review od VŘ. Do popisu daj zoznam zmien z release notes a výsledky testov. Vydanie `v0.2.10-lawoss.N` sa nerobí, alfa sa stavia v Úlohe 11.

### Úloha 11: Overenie `dev` a vydanie alfy (Brány G3 a G4)

**Súbory:** žiadne zmeny kódu, ak testy nenájdu chybu.

- [ ] **Krok 1:** Po zlúčení PR z úloh 2 až 10 a 12 (merge po review VŘ alebo po pokyne MČ, R8) aktualizuj worktree na `origin/dev` a spusti:
  - `pnpm --filter @legalwork/app test`
  - `pnpm --filter @legalwork/app test:i18n`
  - `node scripts/i18n-audit.mjs --ci`
  - `pnpm typecheck`
  - `cd lawoss/okf && bun test test/`
  - `cd lawoss/okf-pamat && pnpm test`
  - serverové testy onboardingu a triedenia

  Over aj, že CI na poslednom commite `dev` je zelené (`gh run list --branch dev --limit 5`).
- [ ] **Krok 2:** Ručná akceptačná cesta na čistom profile (izolované `HOME`/`XDG_*`/`LEGALWORK_ELECTRON_USERDATA`) s lokálnym buildom:
  1. Prejsť onboarding a vidieť upozornenie na alfu.
  2. „Začať nanovo“ do prázdneho priečinka.
  3. Pripojiť kópiu `01_Neusporiadana_kancelaria/C001…` a usporiadať ju.
  4. Dnes a Vec ukážu úlohy z posunutých dát.
  5. Otázka nad `Vyjadrenie protistrany.pdf` s jedným providerom.
  6. Vložiť súbor do priečinka na zatriedenie vo veci a roztriediť ho.

  Pri každom kroku poznač PASS alebo FAIL do `.work/akceptacia-alfa.md` a urob screenshot.
- [ ] **Krok 3 — Brána G3:** Ukáž MČ výsledky. Po pokyne spusti `gh workflow run alpha-macos-aarch64.yml -f draft=false` a `gh workflow run alpha-windows-x64.yml -f allow_unsigned_internal=true` (presné názvy vstupov over v YAML), sleduj behy a zapíš odkazy na releasy.
- [ ] **Krok 4:** Pošli VŘ odkaz na overenie na čistom Macu. MČ pošle Windows build externému testerovi (mimo agenta).
- [ ] **Krok 5 — Brána G4:** Priprav oznámenie testerom (HTML pre `tg-post`): odkazy na stiahnutie, návod, upozornenie na alfu a čo testovať. Najprv `--dry-run`, potom odoslanie len po pokyne MČ a do topicu, ktorý MČ určí.

---

## Mimo tohto plánu (po alfe)

| Téma | Vlastník | Poznámka ku koordinácii |
|---|---|---|
| Náhľad EML a systém náhľadov v appke | MČ a VŘ | Až po zlúčení #177, ktorý mení `artifact-panel.tsx` a `preview.tsx`. Parser buď `postal-mime` v `apps/app`, alebo serverová cesta spoločná s #171. |
| Časová os komunikácie vo veci v OKF | MČ a VŘ | Najprv spec v koordinačnom repe. |
| OpenUI a open komentáre VŘ v marketplace | VŘ, MČ | Najprv dokončiť OKF. |
| Rozdelenie #168 (dashboardy, AI hranica, lehoty do ICS, dôkazy vydania) | VŘ | Zosúladiť s `dev` po alfe. Súbory z tabuľky prekryvu už budú zmenené. |
| Dataset v2 (chaotická kancelária, obsahová pamäť, AML preverenie, rozptýlené termíny, rovnaká štruktúra SK a CZ, generátor v `lawoss/testing/synthetic-sk/`) | MČ | Podľa kontroly datasetu z 19. 10. (zápis, doplnok). |
| Sken bez hashovania celého klienta (dvojfázový) | MČ | Nadväzuje na R7. |
| Vlastný názov hlavného priečinka a automatická záloha | MČ | Nadväzuje na R2 a R3. Samostatný spec. |
| České skilly a MCP v `lawoss-marketplace`, obnova snapshotu `marketplace-snapshot.json` | VŘ, potom MČ | `node lawoss/scripts/update-marketplace-snapshot.mjs --from <checkout> --ref <SHA>` |
| Podpis Windows buildu | MČ, IR | Pred betou. |
