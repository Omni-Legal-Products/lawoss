# D1 onboardingu cez pripojenie priečinka, 9. 10. 2026

Akceptačný beh plánu C2 (úloha 9) na zabalenej appke z vetvy `feat/onboarding-c2`. Spec: [lawOSS-like-SK-CZ#92](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/92). Plány A, B, C1 a C2: [lawoss#134](https://github.com/Omni-Legal-Products/lawoss/pull/134).

## Prostredie

- macOS arm64, `LAWOSS.app` z `pnpm --filter @legalwork/desktop package:electron:dir`.
- Každý beh na čistom profile: vlastné `HOME`, `XDG_*` a `LEGALWORK_ELECTRON_USERDATA` v scratchpade, `LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1`. Všetky procesy LAWOSS mali `HOME` v scratchpade.
- Po každom behu: `pgrep -fl "MacOS/LAWOSS"` vypísal „nič nebeží“ a `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer marker` bol prázdny. Skutočný profil ostal nedotknutý.
- Appka sa zatvárala iba cez `osascript -e 'tell application id "com.eigenweltlabs.legalwork" to quit'`, nikdy cez `pkill`.
- Iba vymyslené údaje: `Prax/` so 6 klientmi (`Alfa s. r. o.`, `Beta a. s.`, `Gama s.r.o.`, `Delta k. s.`, `Novák Ján/2024-03 Kúpna zmluva`, `Zamknutý klient`), `Samostatný klient/` s 8 dokumentmi a vecou `2025-01 Spor/Žaloba.pdf`, prázdny `Nová prax/`.
- Bez modelu (krok AI preskočený cez „Pokračovať bez modelu“).

## Prvé spustenie

| Profil | Build | Timeouty pri štarte (`failed after`) | Výsledok |
|---|---|---|---|
| e-dev | `origin/dev` `c7490d4f` | 0 | PASS, onboarding |
| e-b | B samotné (`feat/ai-bez-priecinka` `4be9f64e`) | 0 | PASS, onboarding |
| d1 | C2 `b4a40a4c` | 7 | **FAIL.** Dnes v lite s hláškou „Your matters could not be loaded“, aj po View > Reload. ![d1](assets/d1-onboarding-priecinok-2026-10/01-d1-dnes-bez-onboardingu.jpg) |
| d2 | C2 + presmerovanie z úvodnej stránky | 0 | **FAIL.** `/welcome` s „LAWOSS server is unavailable“, aj po znovunačítaní, hoci server počúval a odpovedal. Presmerovanie prebehne skôr, než boot zverejní server, a stránka sa pripájala jediný raz. ![d2](assets/d1-onboarding-priecinok-2026-10/02-d2-welcome-server-unavailable.jpg) |
| d3 | C2 + presmerovanie + `/welcome` čaká na server | 15 | **PASS.** Onboarding sa otvoril krokom 1 a prešli všetky tri cesty. ![d3](assets/d1-onboarding-priecinok-2026-10/03-d3-onboarding-krok-1.jpg) |

Oprava sú dva commity na `feat/onboarding-c2` (pôvodne [lawoss#144](https://github.com/Omni-Legal-Products/lawoss/pull/144), zatvorený): úvodné stránky `/dnes` a `/home` povolia presmerovanie na `/welcome` pri prvom spustení (`firstRunRedirect`) a `/welcome` čaká na udalosť `legalwork-server-settings-changed` (`lawoss/domains/onboarding/server-connection.ts`). Na `dev` ani v B sa chyba neprejavila. Mechanizmus pri C2 nie je určený. Behy C2 mali pri prvom štarte 7 až 15 timeoutov, `dev` a B ani jeden. Ponechávam to ako nález pre tím.

Ukončenie appky skončilo SIGTRAP (exit 133) vo všetkých behoch B a C, `dev` sa ukončil čisto (exit 0). Príčina je opravená na `dev` v [lawoss#141](https://github.com/Omni-Legal-Products/lawoss/pull/141) (`c7490d4f`, stráž navigácie volala `stop()` počas shutdown obrazovky). Vetvy A, B a C sú staršie ako táto oprava a dostanú ju po aktualizácii z `dev`.

## Cesta 1: Klient (profil d3)

Ty a jurisdikcia → Dáta a AI (Pokračovať bez modelu) → Priečinok → Pripojiť existujúci → `Samostatný klient`.

| Krok | Výsledok |
|---|---|
| „Toto som našiel“: návrh „klient“ | PASS ![klient](assets/d1-onboarding-priecinok-2026-10/04-klient-toto-som-nasiel.jpg) |
| „Áno, usporiadaj“: OKF súbory vzniknú pred náhľadom | PASS: `AGENTS.md`, `CLAUDE.md`, `client.md`, `memory/` a štruktúra `00_` až `05_` |
| `_STATUS.md` z riadku „Pribudne“ | **FAIL:** súbor nevznikol, hoci ho obrazovka sľubuje |
| Vložený panel náhľadu presunov | PASS: 9 dokumentov, dôvod, istota, „Nechať na zatriedenie“ a lišta „Potvrdiť a roztriediť“. Stĺpec Dokument je úzky a lame názvy uprostred slova. ![náhľad](assets/d1-onboarding-priecinok-2026-10/05-klient-nahlad-presunov.jpg) |
| Tlačidlo pod náhľadom | V prvom spustení je to „Dokončiť“. „Zrušiť“ je iba v toku z bočného panela (pozri nižšie). ![spodok](assets/d1-onboarding-priecinok-2026-10/06-klient-nahlad-spodok.jpg) |
| Potvrdiť a roztriediť | PASS: dokumenty sú v `01_Podklady`, `03_Drafty`, `04_Vystupy`, `05_Komunikacia` a `05_Komunikacia/Dolezita_posta`; klient je zaregistrovaný ako workspace |
| Vec `2025-01 Spor` | **FAIL (P1, na rozhodnutie MČ):** `Žaloba.pdf` sa presunula z priečinka veci do `04_Vystupy` klienta a priečinok veci ostal prázdny. Klienti a veci potom ukazujú „Zatiaľ bez vecí“. Usporiadanie tak rozpustí existujúcu vec. |
| Appka po dokončení | Otvorí Domov s vybraným projektom „Samostatný klient“, nie stránku klienta |
| „Vrátiť“ na stránke Roztriedenie | **FAIL:** stránka nemá v lite pri usporiadaní na mieste žiadny vstup. `TriageEntry` sa ukáže iba pre skúšobný klon (`profile.trial`), hoci lišta náhľadu píše „Presun sa dá vrátiť na stránke Roztriedenie“. |

## Tok z bočného panela

| Krok | Výsledok |
|---|---|
| „Usporiadať podľa OKF“ pri už usporiadanom klientovi | Otvorí „Toto som našiel“ bez „Zrušiť“. Päta je počas tejto obrazovky zámerne skrytá (`lawoss-welcome-page.tsx`). Východ vedie cez „Vybrať iný priečinok“ na krok Priečinok a až tam je „Zrušiť“, teda na dve kliknutia. |
| „Zrušiť“ na kroku Priečinok | PASS: vráti na Klienti a veci |

## Cesta 2: Prax (profil d3)

Bočný panel → Pridať priečinok → Pripojiť existujúci → `Prax`.

| Krok | Výsledok |
|---|---|
| Návrh „celá prax: 6 klientov“, predvolené „Každý klient zvlášť“ | PASS ![prax](assets/d1-onboarding-priecinok-2026-10/07-prax-toto-som-nasiel.jpg) |
| Odznačiť `Zamknutý klient` → „Nie, len pridaj OKF súbory“ | PASS: súhrn „Hotovo: 5 z 5“ ![5 z 5](assets/d1-onboarding-priecinok-2026-10/08-prax-hotovo-5-z-5.jpg) |
| Súbory na disku | PASS: 5 klientov má `AGENTS.md`, `client.md`, `memory/`. `Zamknutý klient` ostal nedotknutý. Vznikol `Prax/Office/` a `Prax/AGENTS.md` neobsahuje mená klientov. |
| 5 klientov v appke | **FAIL:** zaregistrovaný je iba `Alfa s. r. o.`. `found-screen.tsx` po dávke volá `onDone(firstWorkspaceResult(...))` a `welcome-route` natívne zaregistruje len tento jeden workspace. Klienti a veci ukazujú iba Alfu. ![iba Alfa](assets/d1-onboarding-priecinok-2026-10/09-prax-klienti-len-alfa.jpg) |
| `lawoss-domov` | PASS: nikde v UI |

## Cesta 3: Začať nanovo (profil d3)

Bočný panel → Pridať priečinok → Začať nanovo → `Nová prax`.

| Krok | Výsledok |
|---|---|
| Zápis kancelárie | PASS: `AGENTS.md`, `CLAUDE.md`, `Office/` (`okf.config`, `memory/`), `Klienti/` |
| Návod na migráciu | PASS: „Klientov sem skopírujte… a v bočnom paneli zvoľte Pridať priečinok“. Po dokončenom zápise ostáva viditeľné aj „Zrušiť“. ![návod](assets/d1-onboarding-priecinok-2026-10/10-nanovo-navod.jpg) |
| Karta Začať nanovo | Riadok „Pribudne“ vypisuje súbory klienta (`client.md`), nie kancelárie (známa odložená drobnosť) |
| Skopírovať `Samostatný klient` do `Nová prax/Klienti/` → Pridať priečinok → klient → „Nie“ | PASS: pribudli OKF súbory, nič sa nepohlo (`Žaloba.pdf` ostala v `2025-01 Spor`) a klient je zaregistrovaný |
| Názvy workspace | Dva rôzne priečinky majú rovnaký názov „Samostatný klient“ a v UI sa nedajú rozlíšiť |

## Súhrn nálezov

| Priorita | Nález | Stav |
|---|---|---|
| P0 | Čistá inštalácia neotvorí onboarding (d1, d2) | Opravené na `feat/onboarding-c2`, overené v d3 |
| P1 | Usporiadanie klienta rozpustí existujúcu vec (`2025-01 Spor`) | Na rozhodnutie MČ |
| P1 | Prax „Každý klient zvlášť“ zaregistruje iba prvého klienta | Otvorené |
| P1 | „Vrátiť“ po usporiadaní na mieste nemá v lite vstup | Otvorené |
| P2 | `_STATUS.md` sľúbený, ale nevznikne | Otvorené |
| P2 | „Usporiadať podľa OKF“ z bočného panela bez priameho „Zrušiť“ | Otvorené |
| P2 | Pomalý prvý štart buildov C (7 až 15 timeoutov, `dev` a B 0) | Na diagnostiku |
| P3 | Úzky stĺpec Dokument v náhľade, „Zrušiť“ po dokončenom zápise, rovnaké názvy workspace | Otvorené |
