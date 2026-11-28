# LAWOSS: návod pre alfa testerov

> [!IMPORTANT]
> Toto je alfa verzia LAWOSS na testovanie. Skúšajte ju na syntetických dátach alebo na kópii priečinka. Pozvaní alfa testeri používajú výlučne syntetické alebo verejné údaje.

Tento návod je pre právnikov, ktorí skúšajú alfu. Technické časti sú až na konci, v časti „Pre technických testerov“.

Ak vám pomáha vlastný AI agent, dajte mu [postup pre agenta testera](tester-agent.md). Pripraví samostatný testovací spis a koncept hlásenia.

## 1. Alfa, nie hotový produkt

- Appka sa môže zmeniť alebo spadnúť. Chyby sú očakávané a hlásenie je presne to, čo od vás chceme.
- Na skúšanie používajte syntetické dáta z časti 3. Ak skúšate priečinok s povolenými údajmi, použite jeho kópiu. Originál nechajte nedotknutý.
- Do appky nevkladajte klientske údaje, ktoré nesmiete poslať poskytovateľovi modelu. Text dokumentov, na ktoré sa pýtate, ide k poskytovateľovi, ktorého ste pripojili.
- Kľúč od poskytovateľa nevkladajte do rozhovoru, snímok obrazovky ani hlásení.

## 2. Stiahnutie appky

Osobný odkaz z pozvánky ponúka hotový inštalátor pre váš systém. Stačí prehliadač. Na Macu vyberte súbor DMG pre Apple Silicon, na Windowse inštalátor EXE pre x64 alebo ARM64. Odkaz si nechajte pre seba. Aktuálna alfa pre pozvaných testerov zo zdrojového commitu `bd7737a99` má na Macu verziu `0.2.1-alpha.27.gbd7737a` a na Windowse `0.2.1-alpha.29.gbd7737a`. Obsah appky je rovnaký, čísla sa líšia len poradím behov. Všetky tri inštalátory pochádzajú z alfa workflowov GitHub Actions a majú koncept vydania na GitHube. Mac DMG bolo overené na izolovanom profile vrátane diagnostiky hlásenia z appky. Na Macu má podpis ad hoc bez notarizácie a na Windowse je bez podpisu vydavateľa. Oproti alfe `a780d001c` pribudlo okno **Nahlásiť chybu alebo nápad** priamo v appke (časť 7). Oproti `f12658d76` diagnostika v hlásení skrýva aj priečinky klientov mimo domovského priečinka.

- **macOS s Apple Silicon (arm64).** Otvorte súbor `.dmg` a pretiahnite LAWOSS do priečinka Aplikácie. Ak Gatekeeper zablokuje prvé spustenie zostavy stiahnutej z vašej pozvánky, na macOS 15 a novšom zatvorte okno tlačidlom Hotovo. V **Nastaveniach systému → Súkromie a bezpečnosť** nájdite LAWOSS, zvoľte **Napriek tomu otvoriť** a potvrďte heslom alebo Touch ID. Na macOS 14 a staršom použite pravý klik na LAWOSS → **Otvoriť** → **Otvoriť**.
- **Windows x64 a ARM64.** V **Nastaveniach → Systém → Informácie** skontrolujte typ systému a stiahnite príslušný inštalátor `.exe`. Ak SmartScreen zobrazí varovanie pri inštalátore z vašej pozvánky, zvoľte **Ďalšie informácie → Spustiť aj tak**. Ak počítač spravuje organizácia a táto možnosť chýba, obráťte sa na jej správcu. Podrobný postup je v [návode na inštaláciu a aktualizácie pre Windows](lawoss-d1-zabalena-appka-2026-10-05.md#windows-inštalácia-a-aktualizácie-pre-testerov).

Pri prvom otvorení vyberte testovací priečinok. Ak si systém vypýta prístup k jeho súborom, potvrďte ho. Prístup k mikrofónu alebo k nahrávaniu obrazovky povoľujte pri použití funkcie, ktorá ho potrebuje.

Verziu appky nájdete v Nastaveniach, v časti Aktualizácie. Uveďte ju pri každom hlásení chyby.

Technickí testeri si overujú presný balíček podľa časti „Overenie konkrétneho desktop balíčka“ nižšie.

## 3. Syntetické dáta na skúšanie

Syntetické dáta sú vymyslené kancelárie, klienti a veci. Nie sú v nich skutoční ľudia ani skutočné spisy. Terminál ani žiadne príkazy na to nepotrebujete.

### Slovenská kancelária

1. Otvorte [SYNTHETIC_DATA.md](../SYNTHETIC_DATA.md) a kliknite na odkaz „Complete dataset ZIP“. Stiahne sa jeden súbor ZIP (asi 164 MB).
2. Dvojklikom ho rozbaľte do **nového, prázdneho priečinka**. Rozbalené dáta sú vaša skúšobná kópia. Ak ju pokazíte, zmažte priečinok a rozbaľte balík znova.
3. V rozbalenom balíku otvorte **jeden priečinok klienta** (nie celú kancelársku zložku):
   - na skúšku pripojenia a usporiadania: jeden klient v `01_Neusporiadana_kancelaria`,
   - na skúšku už usporiadanej kancelárie: jeden klient v `02_OKF_kancelaria/Klienti`.
4. Nikdy nepripájajte celú zložku kancelárie ani koreň balíka (`LAWOSS-SK-synthetic-v1`). Najmä nikdy nepripájajte priečinok `ground-truth/`. Obsahuje správne odpovede a skúška by bola nepoužiteľná.
5. Dátumy úloh a lehôt v dátach sú pevne nastavené na október 2026. Niektoré úlohy sa preto môžu ukázať ako po lehote. To je v poriadku a očakávané, nie je to chyba.

Kontrolný súčet balíka a posun dátumov k dnešku sú pre technických testerov. Nájdete ich nižšie v časti „Syntetické dáta: kontrolný súčet a posun dátumov“.

### Česká sada

Česká syntetická sada pre technických testerov je v repozitári v `lawoss/testing/fixtures/cz-workflow-derived-v1`.

## 4. Pripojenie modelu

Cesty 1 a 3 v ďalšej časti potrebujú pripojený model. Pripojte ho ešte pred nimi. Pripojíte ho v Nastaveniach, v časti Poskytovatelia AI, a potom ho vyberiete dole v okne rozhovoru.

- **Odporúčané:** predplatné ChatGPT. Po prihlásení funguje bez vlastného API kľúča.
- **Známy problém:** Gemini cez OpenRouter môže zlyhať. Ak odpoveď nepríde alebo skončí chybou, skúste iný model alebo iného poskytovateľa a chybu nám nahláste.

Ďalšie možnosti a podrobnosti sú v časti „Výber modelu a jazyk“ nižšie a v [D1](lawoss-d1-zabalena-appka-2026-10-05.md#ako-pripojiť-model-pre-testerov).

## 5. Čo skúšať

Najprv pripojte model (časť 4). Potom prejdite tieto tri cesty. Pri každej si poznačte, čo ste čakali a čo sa stalo.

### Cesta 1: pripojiť priečinok a usporiadať ho

1. Vyberte **jeden priečinok klienta** v `01_Neusporiadana_kancelaria`. Nepripájajte celú kanceláriu.
2. Pripojte ho ako skúšobný klon (Klienti a veci → Pripojiť existujúci priečinok klienta).
3. Spustite roztriedenie dokumentov a skontrolujte návrh.
4. Potvrďte roztriedenie. Potom ho skúste vrátiť.

Podrobný postup je v [D1, časť Klienti, veci a skilly](lawoss-d1-zabalena-appka-2026-10-05.md#klienti-veci-a-skilly-pre-testerov).

### Cesta 2: Dnes a Klienti a veci

1. Pripojte rovnakým postupom jeden priečinok klienta z `02_OKF_kancelaria/Klienti`.
2. V pohľade **Dnes** pozrite lehoty a úlohy. Dátumy sú z októbra 2026, takže niektoré môžu byť po lehote. To je očakávané. Sedia s kartami vecí?
3. V pohľade **Klienti a veci** otvorte klienta a jeho vec. Je tam to, čo čakáte?

### Cesta 3: otázka nad PDF a e-mailom (EML)

1. Vyberte vec a v nej jedno PDF a jeden e-mail vo formáte EML.
2. Opýtajte sa na konkrétnu vec z dokumentu, napríklad na sumu, dátum alebo strany zmluvy.
3. Skontrolujte, či odpoveď sedí s dokumentom a či ukazuje, z ktorého dokumentu je. Odpovede nie sú právne stanovisko a overujete ich vy.

### Overenie kandidáta na Windows

Pred plánovaným spustením v piatok **27. novembra 2026** má Igor Ribár vyskúšať inštalátor kandidáta na svojom Windows. Stav ručnej skúšky je otvorený. Použite kandidátsky inštalátor od tímu a v Nastaveniach porovnajte verziu a commit s jeho odovzdávacím záznamom. Osobná pozvánka na alfu 20 slúži na skúšanie staršej zostavy.

| Krok | Čo má tester vidieť |
|---|---|
| Overte architektúru počítača a SHA-256 inštalátora. Spustite ho na čistom testovacom profile. | Aplikácia sa otvorí, zobrazí svoju verziu a dovolí pripojiť syntetického klienta. V PowerShelli získate odtlačok príkazom `Get-FileHash -Algorithm SHA256 "cesta-k-instalatoru.exe"`. |
| Prejdite tri cesty z časti 5 a kontroly pilotnej zostavy nižšie. | Prípady, premenovanie, model, Fast a použité registre zodpovedajú zvolenému klientovi a chatu. |
| Otvorte nepodpísané PDF a kópiu s dvoma podpismi. Prepnite nástroje čítačky, rozšírte panel a vráťte sa do chatu. | Pri podpísanom PDF sa zobrazia obe osoby. Pri origináli sa zobrazí výsledok bez podpisu. Podpisovanie cez Chevron7 je dostupné na macOS. |
| Na x64 vyskúšajte aj spracovanie série syntetických spisov ISIR vrátane tretieho. | Zaznamenajte, pri ktorom spise sa spracovanie dokončilo alebo zastavilo. Známe pozorovanie a výsledky podľa architektúry sú v [issue 384](https://github.com/Omni-Legal-Products/lawoss/issues/384#issuecomment-7162641392). |
| Úplne ukončite LAWOSS, otvorte ho znova a potom vyskúšajte aktualizáciu na kópii staršieho testovacieho profilu. | Po reštarte ostávajú dostupné klient, prípad, názov aj dokumenty. Zaznamenajte osobitne výsledok čistej inštalácie a aktualizácie. |

Do odovzdávacieho záznamu uveďte **Windows a architektúru, verziu, commit, SHA-256, výsledok každého kroku a prípadný blokátor**. Pri chybe pridajte prvý neúspešný krok, očakávaný a skutočný výsledok a snímku zo syntetického spisu. Tím rozhodne o piatkovom spustení po vyhodnotení tejto skúšky.

### Kontroly pilotnej zostavy

Tieto kontroly patria k zostave s úpravami z 25. a 26. novembra 2026 a s kontrolou podpisov v náhľade PDF. Obsahuje ich aj alfa z osobnej pozvánky zo zdrojového commitu `bd7737a99` aj predchádzajúce `f12658d76` a `a780d001c`. Staršia alfa `0.2.1-alpha.20.g875852c` ich nemá. Zapíšte verziu, pri vlastnom builde aj commit. Vyberte si riadok, ktorý skúšate. Podrobné návody k ovládaniu sú v [slovenčine](../lawoss/user-guide/sk/index.md) aj [češtine](../lawoss/user-guide/cs/index.md).

| Čo vyskúšať na syntetických údajoch | Podľa čoho posúdiť výsledok |
| --- | --- |
| V nastaveniach AI vyberte predplatné ChatGPT. Vráťte sa späť počas prihlasovania, potom ho spustite znova. | Prvý pokus skončí. Jeho oneskorená odpoveď nesmie ohlásiť úspech druhého pokusu. Po dokončení prihlásenia vyberte model a vyžiadajte si krátku odpoveď. |
| V dvoch chatoch vyberte rovnaký základný model a rovnakú úroveň uvažovania. V prvom zapnite blesk **Fast**, prepnite na druhý a späť. Nakoniec Fast vypnite. | Mení sa rýchlosť prvého chatu. Výber modelu, úroveň uvažovania a druhý chat zostanú podľa vašej voľby. Blesk sa zobrazí len pri modeli predplatného s dostupným prednostným spracovaním. |
| V prehľade prípadu stlačte ceruzku vedľa názvu. Vyskúšajte zrušenie aj uloženie nového názvu. Otvorte ten istý prípad znova. | Uložený názov sa zobrazí pri správnom prípade. Skontrolujte pôvodnú cestu k priečinku, jeho dokumenty a súrodenecký prípad. |
| V **Integráciách** prejdite dostupné a nainštalované pripojenia, Marketplace, Google Workspace a dostupné nástroje kancelárie. V Marketplace vyhľadajte OKF a prepnite filtre. | Zoznam zodpovedá filtru. Pri OKF vidíte počet dostupných skillov z piatich alebo informáciu, že stav ešte nebol overený. Zápis pribalených kópií skúšajte iba v skúšobnom priečinku. Zápis nahradí tamojšie rovnomenné skilly. |
| Otvorte **Pridať vlastné MCP** a zrušte formulár pred uložením. V **Nastavenia → Skills** importujte miestny skúšobný balík po kontrole náhľadu. Pri Google Workspace skontrolujte stav inštalácie skillu a spustite `gog auth list --check` na vlastnom testovacom počítači. | Po zrušení nepribudne konektor. Importovaný skill sa objaví v knižnici. Voľby ChatGPT a Claude prehľadávajú miestne balíky. Stav účtu Google zistíte cez gog aj vtedy, keď už je jeho skill nainštalovaný. Do hlásenia stačí stav bez adresy účtu. |
| Nechajte agenta použiť podporovaný register na konkrétnu verejnú otázku. V kontrolovanej skúške použite aj pripojenie, ktoré vráti chybu. Ak asistent zadá podúlohu, otvorte jej chat. | Pri úspešnom kroku uvidíte použitý register pri ikone knihy, pri chybe **Neúspešné volanie zdroja** s názvom registra. Samotná zmienka v odpovedi nesmie vytvoriť štítok. Podúloha ukáže **Úloha od asistenta LAWOSS** a rozbaliteľné **Zobraziť zadanie**. |

**Ponuka modelov.** Zoznam, ktorý poskytne pripojený účet ChatGPT, má prednosť aj pri jedinom alebo novom modeli. Pri vstavanom katalógu bez údajov účtu má táto verzia náhradnú ponuku desiatich základných modelov. Engine 2.1.4 nový zoznam predplatného samostatne nesťahuje. Pri použití náhradného zoznamu sa ďalšie modely doplnia aktualizáciou LAWOSS. Režimy Fast sa do tohto počtu nezarátavajú. Výsledok pre konkrétny účet zaznamenajte podľa skutočnej odpovede modelu. Technickú skúšku s dvoma rôznymi ponukami účtov pokrýva [test enginu](../apps/server/src/lawoss/chatgpt-native-models.released.test.ts).

#### Kontrola podpisov PDF

Otvorte skúšobné PDF cez **Súbory** klienta. Na čítanie údajov o podpisoch nepotrebujete vlastný certifikát, model ani Chevron7. Agent môže štyri referenčné súbory pripraviť príkazom uvedeným nižšie.

| Vstup | Očakávaný výsledok nad stranou PDF |
| --- | --- |
| `01-original.pdf` | **V PDF sa nenašiel elektronický podpis**. |
| `02-empty-fields.pdf` | **V PDF sa nenašiel elektronický podpis**. Rozbalením zistíte počet dvoch prázdnych podpisových polí. |
| `03-one-signature.pdf` | **Elektronické podpisy (1)**. Rozbaľte údaje prvého podpisu a porovnajte osobu s označením LAWOSS Test Pilot-A. Druhé pole je ešte prázdne. |
| `04-two-signatures.pdf` | **Elektronické podpisy (2)**. V detaile vidíte Pilot-A aj Pilot-B. Porovnajte aj vydavateľa certifikátu, ak je k podpisu priradený. Dôveryhodnosť a kvalifikovanosť vyžadujú osobitnú validáciu. |
| Poškodená skúšobná kópia podpísaného súboru | Očakávajte neúplný výsledok, chybu kontroly alebo chybu náhľadu. Poškodenie sa nesmie vyhodnotiť ako potvrdená neprítomnosť podpisu. |
| Rovnaký názov PDF v dvoch klientoch | V prvom použite nepodpísaný originál, v druhom kópiu s dvomi podpismi. Otvorte ich postupne a prepnite sa späť. Počet a osoby musia zakaždým zodpovedať otvorenému súboru. |

Pri otvorenom chate rozšírte čítačku PDF a vráťte ju späť. Skontrolujte meno súboru, zlaté pero Chevron7 na Macu a ponuku súboru pod tromi bodkami. V desktope zobrazte **Nástroje PDF**, zmeňte zväčšenie a otvorte náhľad tlače. Rozbaľte podpisy, porovnajte osoby v detaile a klávesom Escape sa vráťte k dokumentu. Vyskúšajte tiež úzky panel a svetlý motív. Na obrazovke Dnes zväčšite okno za šírku stĺpca s kartami a skontrolujte plynulé pozadie za pozdravom.

Na prípravu sady spustite z koreňa zdrojového repozitára nasledujúci príkaz. Nahraďte posledný argument cestou do pracovnej kópie testovacieho klienta. Nástroj `uv` pri prvom behu potrebuje prístup k závislostiam. Vypíše názov nového priečinka `LAWOSS-PDF-…` so štyrmi súbormi. Pre poškodený variant vytvorte ďalšiu kópiu a skráťte ju na prvých desať bajtov.

```sh
uv --no-config run --no-project lawoss/testing/tester/signature_samples.py --output "<priečinok syntetického prípadu>"
```

**Podpis cez Chevron7 na Macu s Apple Silicon.** Pri lokálnom PDF zvoľte **Podpísať v Chevron7**. Najprv zrušte potvrdenie konkrétneho súboru. Potom skúste podpis na syntetickej kópii schváliť, certifikát a PIN zadajte v Chevron7. Otvorte výsledné PDF a porovnajte počet podpisov s originálom. Pri súbore z iného klienta prvá akcia iba otvorí PDF v zdrojovom klientovi. Až tam možno spustiť podpis. Bez kompatibilnej inštalácie alebo testovacieho certifikátu zaznamenajte prekážku. Skutočný podpis cez Chevron7 potvrdil používateľ na svojom Macu. Kontrolu konkrétneho nového buildu a validáciu podpisu zapisujte osobitne.

## 6. Aktualizácie

Appka vám môže sama ponúknuť novú alfu. Ponuku zatiaľ nepotvrdzujte. Novú alfu nainštalujte až vtedy, keď ju oznámime v Telegram skupine testerov LAWOSS. Otvorte znova svoj osobný odkaz z pozvánky a pred stiahnutím skontrolujte, že ponúka oznámenú verziu pre váš systém.

## 7. Kam hlásiť chyby

Chybu, nápad alebo otázku nahláste jedným z týchto spôsobov:

- **priamo v appke:** tlačidlo **Nahlásiť chybu alebo nápad** dole v bočnom paneli alebo menu **Pomocník → Nahlásiť chybu alebo nápad…** (funguje aj počas prvého nastavenia). Verziu a systém appka doplní sama. Voliteľne priloží snímku okna a technickú diagnostiku bez hesiel, kľúčov, e-mailov a názvov priečinkov klientov. Pred odoslaním si ju môžete pozrieť tlačidlom **Zobraziť, čo sa odošle**. Po odoslaní appka ukáže číslo hlásenia. Ak odoslanie zlyhá, ponúkne uloženie diagnostiky do súboru a webový formulár,
- cez formulár bez účtu na [lawoss.app/sk/alfa/hlasenie](https://lawoss.app/sk/alfa/hlasenie) (CZ: [lawoss.app/cz/alfa/hlasenie](https://lawoss.app/cz/alfa/hlasenie)), kde môžete priložiť aj snímku obrazovky,
- v [issues forku](https://github.com/Omni-Legal-Products/lawoss/issues),
- v Telegram skupine testerov LAWOSS.

Uveďte:

- kroky, ktoré chybu vyvolajú, a čo ste čakali oproti tomu, čo sa stalo,
- verziu appky (v Nastaveniach, v časti Aktualizácie, riadok Aktuálna verzia; na macOS aj v menu About LAWOSS),
- operačný systém s verziou a architektúrou (arm64 alebo x64),
- snímku obrazovky, ak v nej nie sú klientske údaje ani kľúče.

Do hlásenia nikdy nevkladajte API kľúče, heslá ani údaje skutočných klientov.

## Pre technických testerov

Nasledujúce časti sú pre tých, ktorí si appku skladajú sami alebo ladia jej beh. Právnici ich zväčša nepotrebujú.

Postup akceptačného behu s kritériami PASS/FAIL je v [alfa akceptačnom protokole](lawoss-alpha-acceptance.md); aktuálny sprievodca prvým spustením má šesť krokov (**Kancelária → Dokumenty → Toto sme našli → AI asistent → Ako agent pracuje → Pripravené**). Prejdené cesty na zabalenej appke sú v [D1](lawoss-d1-zabalena-appka-2026-10-05.md). D1 zo 4. až 5. 10. 2026 je historický snapshot iného buildu, nie dôkaz nového vydania.

### Overenie konkrétneho desktop balíčka

Inštalátory z osobnej pozvánky zo zdrojového commitu `bd7737a99` si môžete overiť podľa tabuľky. Na macOS použite `shasum -a 256` s cestou k DMG, na Windowse príkaz PowerShellu `Get-FileHash` s cestou k EXE a prepínačom `-Algorithm SHA256`.

| Inštalátor | Veľkosť v bajtoch | SHA-256 |
| --- | ---: | --- |
| `lawoss-mac-arm64-0.2.1-alpha.27.gbd7737a.dmg` | 862323444 | `62558de0685e524f9d54a113a5962056958c4b8c456afd8c31b5e847bfc7f4a2` |
| `lawoss-win-x64-0.2.1-alpha.29.gbd7737a.exe` | 812271265 | `620df67263afda01108ef8f50ab082344637890f837868383d38b5cb13c3acb8` |
| `lawoss-win-arm64-0.2.1-alpha.29.gbd7737a.exe` | 768721903 | `18cfabe7eda70355fa072556f7fc99d77e44f5b9df4c8efba61e9939feaaea12` |

V Nastaveniach → Debug prečítajte verziu, celý commit, kanál, target a stav identity.
`unavailable` znamená nedoložený pôvod staršieho balíčka. SHA z iného checkoutu ho nenahrádza.

Postup dokladovania podpisu, oboch profilov a publikácie je v [release evidence](release-evidence.md).
Draft nie je verejná distribúcia. Verejný ukazovateľ sa neposunie bez prijatej platformovej akceptácie.

### Syntetické dáta: kontrolný súčet a posun dátumov

Terminálové príkazy sú len pre technických testerov. Dataset sa sťahuje podľa [SYNTHETIC_DATA.md](../SYNTHETIC_DATA.md). Všetky príkazy nižšie spúšťajte **z koreňa repozitára** (priečinok, v ktorom je `package.json`). Príklady používajú stiahnutý súbor v `Downloads` a rozbalenie do priečinka `LAWOSS-data` v domovskom priečinku.

**1. Kontrolný súčet SHA-256.** Výsledok musí byť rovnaký ako SHA-256 v SYNTHETIC_DATA.md. Ak nie je, balík nepoužívajte.

macOS:

```bash
shasum -a 256 "$HOME/Downloads/2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip"
```

Windows (PowerShell):

```powershell
certutil -hashfile "$env:USERPROFILE\Downloads\2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip" SHA256
```

**2. Rozbalenie** do nového priečinka (dvojklikom alebo príkazom). Až po úspešnom kontrolnom súčte.

macOS:

```bash
mkdir -p "$HOME/LAWOSS-data" && python3 -m zipfile -e "$HOME/Downloads/2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip" "$HOME/LAWOSS-data"
```

Windows (PowerShell):

```powershell
py -m zipfile -e "$env:USERPROFILE\Downloads\2026-10-17-lawoss-slovak-okf-synthetic-dataset-v1.zip" "$env:USERPROFILE\LAWOSS-data"
```

**3. Verzia Pythonu.** Skript `shift_dates.py` potrebuje Python 3.11 alebo novší. Skontrolujte ju:

```bash
python3 --version
```

Na Windows:

```powershell
py --version
```

Ak je verzia nižšia než 3.11, skript skončí s kódom 2 a vypíše to. Novší Python je na python.org.

**4. Posun dátumov k dnešku** na kópii jednej kancelárie (pôvodný rozbalený balík ostane nedotknutý, cieľový priečinok nesmie existovať). Zadávajte vždy jeden priečinok kancelárie, nikdy koreň balíka.

macOS:

```bash
python3 lawoss/testing/synthetic-sk/shift_dates.py --source "$HOME/LAWOSS-data/LAWOSS-SK-synthetic-v1/02_OKF_kancelaria" --dest "$HOME/LAWOSS-data/dnes/02_OKF_kancelaria"
```

Windows (PowerShell):

```powershell
py lawoss\testing\synthetic-sk\shift_dates.py --source "$env:USERPROFILE\LAWOSS-data\LAWOSS-SK-synthetic-v1\02_OKF_kancelaria" --dest "$env:USERPROFILE\LAWOSS-data\dnes\02_OKF_kancelaria"
```

Potom v appke pripájajte klientov z kópie `dnes\02_OKF_kancelaria\Klienti`. Voľby `--as-of` a `--today` a presný rozsah posunu sú v [README skriptu](../lawoss/testing/synthetic-sk/README.md).

### Build zo zdrojov

Predpripravené inštalátory z pozvánky obsahujú aplikáciu, engine aj runtime. Ak si chcete zostaviť vlastný inštalátor, zdrojom aktuálnej alfy z pozvánky je [commit bd7737a99](https://github.com/Omni-Legal-Products/lawoss/tree/bd7737a99bb23a637df7eb31ef10501a668bde02).

**Vlastná zostava cez GitHub Actions.** Vo svojom forku povoľte Actions a vytvorte vetvu z uvedeného commitu. V karte Actions vyberte [workflow macOS](../.github/workflows/alpha-macos-aarch64.yml) alebo [workflow Windows x64 a ARM64](../.github/workflows/alpha-windows-x64.yml) a v **Run workflow** vyberte túto vetvu. Pre macOS nastavte vo forku repository variable `MACOS_NOTARIZE=false`. Pre vlastný nepodpísaný build zvoľte `allow_unsigned_internal=true`, `draft=true` a základnú verziu `0.2.1`. Vo Windows workflowe ponechajte `publish=true`, aby vytvoril koncept vydania. Workflow pripraví engine zo zdrojov, zostaví sandbox runtime a zabalí aplikáciu. Po úspešnom behu nájdete svoje DMG alebo EXE v koncepte vydania vo vlastnom forku. Číslo alfy sa odvíja od poradového čísla vášho behu.

**Lokálne zostavenie na vlastnom počítači.** Použite Git, presne Node 24.22.1 podľa `.nvmrc`, pnpm 11.4.0 a Bun 1.4.4. Balík nástrojov kontroluje aj patch verziu Node. Ak používate wrapper pnpm, nastavte `LAWOSS_BUILD_PNPM_CLI` na absolútnu cestu k skutočnému súboru `pnpm/bin/pnpm.mjs` verzie 11.4.0. Na Macu sú pre natívne moduly potrebné Xcode Command Line Tools a CMake dostupný v PATH (`cmake --version`). Na Windowse potrebujete Visual Studio Build Tools s podporou C++. Na Windowse povoľte dlhé cesty pri klonovaní (`git clone -c core.longpaths=true …`).

```sh
git clone https://github.com/Omni-Legal-Products/lawoss.git
cd lawoss
git switch --detach bd7737a99bb23a637df7eb31ef10501a668bde02
pnpm install --frozen-lockfile
```

Pred buildom pripravte sandbox runtime pre cieľovú platformu podľa [sandbox workflowu](../.github/workflows/sandbox-runtime.yml). Rovnaký archív môžete počas jeho retencie stiahnuť cez `gh run download` po prihlásení do GitHubu. Napríklad pre Mac:

```sh
gh run download 46086368789 -R Omni-Legal-Products/lawoss -n sandbox-runtime-darwin-arm64 -D .work/alpha-runtime
mkdir -p apps/server/resources/agent-sandbox/runtime
tar -xzf .work/alpha-runtime/sandbox-runtime.tgz -C apps/server/resources/agent-sandbox/runtime
node scripts/sandbox/verify-runtime.mjs
export NODE_OPTIONS=--max-old-space-size=6144
pnpm --filter @legalwork/desktop build:electron
CSC_IDENTITY_AUTO_DISCOVERY=false pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml -c.mac.identity=- --mac --arm64 --publish never
```

Na Windowse spustite príkazy v Git Bash, zvoľte beh `46086371415` a archív `sandbox-runtime-win32-x64` alebo `sandbox-runtime-win32-arm64` podľa vášho počítača. Po rozbalení, overení runtime a `build:electron` použite `pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml --win --x64 --publish never` alebo zmeňte posledný prepínač architektúry na `--arm64`. Výstup je v `apps/desktop/dist-electron`. Prvá príprava enginu potrebuje sieť a používa [recept z repozitára](../packages/opencode-release/build/README.md).

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
