# D1 na zabalenej appke, 4. až 5. 10. 2026

Akceptačný beh alfy 1 s vetvou `feat/dnes-prehlad` ([lawoss#109](https://github.com/Omni-Legal-Products/lawoss/pull/109)). Pravidlá pohľadov z OKF zapisuje [ADR 0014](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/89).

## Prostredie

- macOS arm64, `LAWOSS.app` zo `electron-builder --dir`, ad-hoc podpis (`-c.mac.identity=-`), `codesign --verify --deep --strict` OK.
- Každý beh na čistom profile: vlastné `HOME`, `XDG_*` a `LEGALWORK_ELECTRON_USERDATA`. Skutočné `~/.config/legalwork`, `~/.config/opencode` a `~/.legalwork` ostali po každom behu bez zmeny.
- Iba vymyslené údaje (klienti „Testovací klient s. r. o.“, „Vzorový klient D2 s. r. o.“, syntetická faktúra 2026-071).
- Modely: Ollama na 127.0.0.1 (`qwen2.5:7b`, `gemma4:12b-mlx`) a OpenAI cez ChatGPT účet (`gpt-5.6-luna`).

## Prejdené cesty

| Cesta | Výsledok |
|---|---|
| Prvé spustenie otvorí onboarding | OK |
| Onboarding s OKF: identita, voľba OKF so vzatím na vedomie, kancelária, klient, vec | OK; klient dostane skilly `novy-spis`, `okf-pamat`, `usporiadaj-spis` |
| Onboarding bez OKF s pracovným priečinkom | OK; Dnes a Klienti vysvetlia, že organizácia vecí je vypnutá, a ponúknu zapnutie |
| Zapnutie OKF neskôr z bočného panela | OK; náhľad zmien sa posunie do okna, priečinok `Klienti` sa predvyplní |
| Nová vec k už otvorenému klientovi | OK; vec v `Spisy/`, `klient:` a odkaz na kartu klienta |
| Lehota zapísaná do `memory/` | ukáže sa bez obnovenia v Dnes, súhrne, páse 14 dní, detaile veci, u klienta a v bočnom paneli |
| Klient bez vecí | má vlastnú kartu v Klientoch a veciach |
| AI Providers | bez účtu a modelov Eigenwelt; Ollama aj OpenAI sa dajú pripojiť |
| Otázka nad dokumentom | `gemma4:12b-mlx` a `gpt-5.6-luna` odpovedali správne a po slovensky; brána povolení zastavila prístup mimo priečinka |
| Menu macOS | „About / Hide / Quit LAWOSS“ |
| „What's new“ po čistom onboardingu | neukáže sa |

## Nájdené a opravené v lawoss#109

| Priorita | Nález | Commit |
|---|---|---|
| P0 | Prvé spustenie v Lite neotvorilo onboarding | `d1762345` |
| P1 | Onboarding sa nedal posúvať, potvrdenie bolo pod okrajom okna | `7a5e73f8` |
| P1 | AI Providers ukazovali účet Eigenwelt a modely SystemOne | `c6572b6c` |
| P1 | Krok AI pred prvým priečinkom posielal do nastavení, ktoré hlásili chybu | `bad572b6` |
| P1 | Bez OKF ukazovali Dnes a Klienti „žiadne veci“ a „Skúsiť znova“ | `407d7a05` |
| P1 | Stav OKF sa pri štarte čítal bez adresy servera, po reštarte „OKF vypnuté“ | `99f24fc8` |
| P1 | K otvorenému klientovi sa nedala pridať vec (symlinky v `.opencode/node_modules/.bin`) | `5eea22c7` |
| P1 | Opakované dokončenie onboardingu spadlo na obnove skillov (415 na `okf.js`) | `1ee95bc7` |
| P1 | Nainštalované skilly OKF sa po prvej inštalácii už nikdy neaktualizovali a ukazovali falošné „obsahuje vaše úpravy“ (riadený blok zdrojov v `SKILL.md`) | `2f225f0f` |
| P2 | Jazyky ako kódy, jurisdikcia vždy po anglicky | `fe27af33` |
| P2 | Klient bez vecí v Klientoch chýbal | `36f9b4c4` |
| P2 | Vec z onboardingu v `<klient>/<oblasť>/` s prázdnym `klient:` | `02453d32` |
| P2 | Nový spis nevidel meno advokáta z onboardingu | `fa72b4e6` |
| P2 | Nový používateľ videl dialóg „What's new“ | `a883a2f2` |
| P2 | Lokálny model: OpenCode zrušil prvú požiadavku po 5 minútach | `6e048670` |
| P3 | Predvyplnenie priečinka Klienti, žargón v texte kancelárie | `132295ea` |
| P3 | Rozporné texty kroku AI, posunutý ďalší krok | `d7140364` |
| P3 | Menu a tray „LegalWork“ | `43c643ce` |

## Mimo lawoss#109

- **Lokálne modely sú pomalé.** Prvá požiadavka má okolo 40 tisíc tokenov, hlavne popisy nástrojov pribalených pluginov upstreamu (Word, Excel, PowerPoint, úlohy, projekty, recenzie). `gemma4:12b-mlx` na MacBooku potrebuje na prvú odpoveď asi 7 minút, ďalšie kolá sekundy. `qwen2.5:7b` nástroje nezvláda. Obmedziť nástroje pre lokálne modely je samostatné rozhodnutie.
- **OpenAI cez ChatGPT účet:** rýchly výber modelov ponúka `gpt-5.4` a `gpt-5.3-codex-spark`, ktoré tento typ účtu odmietne (400 „not supported when using Codex with a ChatGPT account“). Funguje napríklad `gpt-5.6-luna` z „All models“. Zoznam pochádza z katalógu OpenCode.
- **Jednotnosť UI:** onboarding, nastavenia a Home používajú iné prvky a písmo ako pohľady z OKF. Rieši sa samostatne.

## Windows: inštalácia a aktualizácie (pre testerov)

Akceptačný beh D1 vyššie prebehol na macOS. Postup pre Windows x64 vychádza z workflowu `alpha-windows-x64.yml`, z konfigurácie a šablón `electron-builder` 26.16.1 a z kódu appky. Štruktúru releasov sme overili cez GitHub API 5. 10. 2026. Body označené *neoverené na skutočnom Windows* zatiaľ nikto neprešiel na skutočnom počítači s Windows; hláste, ak sa líšia.

### Kde stiahnuť inštalátor

1. [Releasy forku](https://github.com/Omni-Legal-Products/lawoss/releases) → prerelease `alpha-windows-v<základ>-alpha.<beh>-<sha>`, napríklad `alpha-windows-v0.2.1-alpha.4-1a2b3c4` (ilustračné). Každý beh alfy má vlastný.
2. Stiahnite `lawoss-win-x64-<verzia>.exe`, napríklad `lawoss-win-x64-0.2.1-alpha.4.g1a2b3c4.exe`. Súbory `.blockmap` a `latest.yml` sú pre updater.
3. Release `alpha-windows-latest` inštalátor nemá. Obsahuje len `latest.yml`, podľa ktorého updater hľadá najnovšiu alfu.
4. Kontrolný súčet SHA-256 je v popise releasu. V PowerShelli v priečinku so stiahnutým súborom: `Get-FileHash .\lawoss-win-x64-<verzia>.exe` a hodnotu `Hash` porovnajte s popisom.

Verejné binárky budú len podpísané (rozhodnutie Q06/U6). Nepodpísaný build workflow vydá len ako **koncept (draft)**: vidia ho len členovia s právom zápisu do forku, názov začína **„NEPODPÍSANÉ – len interný tím“** a ukazovateľ `alpha-windows-latest` sa neposunie, takže ho updater nikomu neponúkne. Ďalej ho nešírte a nepracujte v ňom s klientskymi ani inými dôvernými údajmi.

Releasy vytvorené pred zavedením tejto brány (názov „LegalWork Alpha …“, napríklad verejný prerelease `alpha-windows-v0.1.15-alpha.2-65ba399`) sú tiež nepodpísané a nemajú SHA-256 v popise; platí pre ne to isté: len interný tím, žiadne klientske údaje. Ukazovateľ `alpha-windows-latest` k 5. 10. 2026 mieri práve na tento build (overené cez GitHub API 5. 10. 2026).

Testovací build bez releasu (spustený s vypnutým `publish`) je v behu workflowu „Alpha Channel (Windows x64)“ na záložke Actions, časť Artifacts: `lawoss-alpha-windows-<verzia>`. Je to ZIP s inštalátorom, vydrží 7 dní a updater ho neponúka. Repo je verejné, takže ho po prihlásení do GitHubu stiahne ktokoľvek; workflow preto takto uloží len podpísaný build.

### SmartScreen

Kým inštalátor nie je podpísaný, Windows SmartScreen pri spustení ukáže „Windows protected your PC“. Kliknite na **More info** → **Run anyway**. V slovenskom a českom Windows sú tlačidlá preložené; presné znenie je *neoverené na skutočnom Windows*.

### Inštalácia

- Inštalátor je jednokrokový NSIS a inštaluje len pre prihláseného používateľa, bez práv správcu. `electron-builder.yml` nemení predvolené `oneClick` ani `perMachine` a šablóna inštalátora má pre tento režim `RequestExecutionLevel user`.
- Predvolený priečinok podľa pravidiel `electron-builder` 26.16.1 je `%LOCALAPPDATA%\Programs\@legalworkdesktop`. Názov sa odvodzuje z balíka `@legalwork/desktop`, nie z „LAWOSS“. Spúšťací súbor je `LAWOSS.exe`. *Neoverené na skutočnom Windows.*
- Po inštalácii sa appka sama spustí a pridá skratku „LAWOSS“ na plochu a do ponuky Štart. *Neoverené na skutočnom Windows.*
- Nastavenia a dáta appky sú v `%APPDATA%\com.eigenweltlabs.legalwork` (`userData` v `apps/desktop/electron/main.mjs`). *Neoverené na skutočnom Windows.*

### Aktualizácie

Nastavenia → Aktualizácie → **Kanál vydaní: Alpha**. Build z alfa workflowu (verzia `X.Y.Z-alpha.N.g<sha>`) na kanáli Alpha zostáva sám (`isAlphaBuild` v `apps/desktop/electron/updater.mjs`), prepínač len skontrolujte. V tej istej časti je Aktuálna verzia; uveďte ju pri hlásení chyby. Updater číta `latest.yml` z `alpha-windows-latest`. Stiahnutie a inštalácia aktualizácie sú *neoverené na skutočnom Windows*.

### Odinštalovanie

Nastavenia systému Windows → Aplikácie → Nainštalované aplikácie → LAWOSS → Odinštalovať. Ak ste používali doplnok pre Word, Excel alebo PowerPoint, odinštalátor zruší aj jeho registráciu a odstráni lokálnu certifikačnú autoritu „LegalWork Local CA“; Windows sa pri tom raz opýta na odstránenie certifikátu (`apps/desktop/build/installer.nsh`). Pracovné priečinky klientov ani `%APPDATA%\com.eigenweltlabs.legalwork` nemaže. *Neoverené na skutočnom Windows.*

## Ako pripojiť model (pre testerov)

Nastavenia → AI Providers → Add provider. Model sa potom vyberá dole v okne chatu.

- **Cloud** (OpenAI, Anthropic, OpenRouter, …): vybrať providera a prihlásiť sa alebo vložiť vlastný API kľúč. V alfe len vymyslené alebo verejné údaje.
- **Lokálny model:** Local model → Ollama alebo LM Studio → Fetch from endpoint → vybrať model. Bez kľúča. Odporúčame aspoň `gemma4:12b`; prvá odpoveď trvá minúty.

## Klienti, veci a skilly (pre testerov)

Platí pri zapnutom OKF. V alfe len vymyslené alebo verejné údaje.

### Nová vec

1. Klienti → „+ Nová vec“ (alebo ikona „Nová vec“ v bočnom paneli).
2. Formulár ukáže, pod ktorým klientom vec vznikne. Predvolený je klient práve otvoreného pracovného priestoru, inak naposledy použitý. Iného klienta vyberiete v poli „Iný klient (priečinok)“ a tlačidlom „Použiť tohto klienta“.
3. Vyplňte názov, oblasť a druh veci → „Náhľad zmien“ → skontrolujte zoznam → „Potvrdiť a vykonať“. Vec vznikne v `Spisy/` u klienta.

### Pripojenie existujúceho priečinka klienta

1. Klienti → „Pripojiť existujúci priečinok klienta“ (v bočnom paneli ikona s rovnakým názvom, aj v Nastaveniach → Prispôsobenie).
2. Vyberte pôvodný priečinok klienta a zvoľte, čo sa s ním stane:
   - **Skúšobný klon** (predvolený): LAWOSS vytvorí kópiu s menom `<priečinok> (trial <dátum>)`, predvolene vedľa originálu, a pracuje len v nej. Originál ostane nedotknutý.
   - **Bezpečne doplniť**: LAWOSS zapíše priamo do originálu. Doplní chýbajúce súbory (karta klienta, pokyny pre asistenta, pamäť), existujúce súbory neprepíše, nepresunie ani nezmaže. Treba výslovne potvrdiť zápis do originálu.
3. Potvrďte, že priečinok patrí jednému klientovi → „Náhľad zmien“ → „Potvrdiť a vykonať“.
4. Kontrola priečinka má limity: najviac 1 GiB obsahu, 10 000 položiek a hĺbka 32 úrovní. Väčší alebo hlbší priečinok sa nepripojí; vyskúšajte menší výber.

### Rýchle akcie a skilly

- Rýchle akcie vo veci aj skilly potrebujú pripojený model (pozri vyššie). Bez modelu asistent neodpovie.
- Pri otvorení klienta appka doplní chýbajúce skilly `novy-spis`, `okf-pamat`, `usporiadaj-spis` a `roztried-spis`. Vaše úpravy skillu neprepíše a raz na ne upozorní.
- **Usporiadanie dokumentov:** v okne chatu napíšte `/`, vyberte `usporiadaj-spis` a uveďte, ktoré dokumenty sa majú pomenovať. Skill pripraví plán s náhľadom; nič sa nepremenuje ani neskopíruje bez vášho schválenia.

### Automatické roztriedenie dokumentov

Funguje **len v skúšobnom klone**. Originál klienta sa nikdy nemení.

1. Pripojte existujúci priečinok klienta ako **Skúšobný klon** (pozri vyššie).
2. Klienti → **Roztriediť dokumenty**. Appka hneď ukáže návrh podľa názvov súborov: počet dokumentov, koľko sa zaradí, koľko ostane na zatriedenie a ktoré veci vzniknú. V tabuľke vidíte pri každom dokumente, odkiaľ a kam pôjde, prečo a s akou istotou. Dokument môžete nechať na zatriedenie.
3. **Spresniť s modelom** (potrebuje pripojený model): zaškrtnite súhlas, že celý text dokumentov ide k poskytovateľovi modelu, → **Otvoriť rozhovor s modelom** → odošlite pripravenú správu. Model prečíta dokumenty, navrhne veci (napríklad podľa spisovej značky a protistrany) a zaradí dokumenty. Nič nepresunie.
4. Vráťte sa na **Roztriediť dokumenty** → **Použiť návrh modelu**. Skontrolujte nové veci a tabuľku.
5. **Potvrdiť a roztriediť**. Appka založí veci v `Spisy/` a presunie dokumenty do pracovných priečinkov klienta a vecí. Nič neprepíše ani nezmaže.
6. Celý beh vrátite tlačidlom **Vrátiť roztriedenie** (aj neskôr v paneli „Posledné roztriedenie“). Klon sa vráti presne do pôvodného stavu.

Obmedzenia v alfe:

- Bez modelu sa triedi len podľa názvov; súbory typu „sken001.pdf“ ostanú na zatriedenie a veci vzniknú len vtedy, keď spisovú značku nesú v názve aspoň dva súbory.
- Z `.msg`, `.zfo`, `.asice` a obrázkov appka text nečíta; zaradí ich podľa názvu a súvislostí.
- Veci založené len podľa názvov dostanú dnešný dátum; náhľad to označí.
- Pôvodné, po roztriedení prázdne priečinky ostávajú.

Overené 5. 10. 2026 na vymyslenom klientovi (34 dokumentov, dve konania a jedna nesporová vec) s predplatným ChatGPT a modelom GPT-6 Luna:

| | Len podľa názvov | S modelom |
|---|---|---|
| Zaradené | 25 | 34 |
| Na zatriedenie | 9 | 0 |
| Nové veci | 0 | 3 (15, 11 a 2 dokumenty) |
| Čas modelu | nie | asi 3 až 5 minút |

Model zaradil správne aj skeny bez výpovedného názvu podľa spisovej značky v texte a spoločné dokumenty (plnomocenstvo, výpis z registra, zmluvu o právnych službách) nechal u klienta. Po vrátení boli všetky súbory klona zhodné so stavom pred roztriedením.

## Oficiálne odkazy na DPA

Zoznam je abecedný podľa poskytovateľa a bez poradia podľa vhodnosti. Odkaz sám osebe nepotvrdzuje, že DPA pokrýva konkrétny plán, účet, spôsob prihlásenia, API, model alebo účel. Pred použitím overte podmienky zvoleného produktu a účtu. V alfe používajte iba vymyslené alebo verejné údaje.

| Poskytovateľ | Oficiálne dokumenty | Rozsah, ktorý treba overiť |
| --- | --- | --- |
| Anthropic | [Data Processing Addendum](https://www.anthropic.com/legal/data-processing-addendum) | DPA je súčasťou komerčných podmienok alebo inej zmluvy, ktorá naň odkazuje; overte konkrétnu zmluvu a produkt. |
| OpenAI | [Data Processing Addendum](https://openai.com/policies/data-processing-addendum/) | DPA dopĺňa OpenAI Services Agreement; overte, či sa táto zmluva vzťahuje na konkrétny účet a službu. |
| OpenRouter | [Data Processing Agreement](https://openrouter.ai/data-processing-agreement) · [Terms of Service](https://openrouter.ai/terms) | Podmienky začleňujú DPA pri organizačnom alebo komerčnom použití. Pri poskytovateľovi modelu treba overiť aj jeho vlastné podmienky. |
