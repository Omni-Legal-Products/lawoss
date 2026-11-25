# LAWOSS: návod pre alfa testerov

> [!IMPORTANT]
> Toto je alfa verzia LAWOSS na testovanie. Skúšajte ju na syntetických dátach alebo na kópii priečinka. Pozvaní alfa testeri používajú výlučne syntetické alebo verejné údaje.

Tento návod je pre právnikov, ktorí skúšajú alfu. Technické časti sú až na konci, v časti „Pre technických testerov“.

## 1. Alfa, nie hotový produkt

- Appka sa môže zmeniť alebo spadnúť. Chyby sú očakávané a hlásenie je presne to, čo od vás chceme.
- Na skúšanie používajte syntetické dáta z časti 3. Ak skúšate priečinok s povolenými údajmi, použite jeho kópiu. Originál nechajte nedotknutý.
- Do appky nevkladajte klientske údaje, ktoré nesmiete poslať poskytovateľovi modelu. Text dokumentov, na ktoré sa pýtate, ide k poskytovateľovi, ktorého ste pripojili.
- Kľúč od poskytovateľa nevkladajte do rozhovoru, snímok obrazovky ani hlásení.

## 2. Stiahnutie appky

Osobný odkaz z pozvánky ponúka hotový inštalátor pre váš systém. Stačí prehliadač. Na Macu vyberte súbor DMG pre Apple Silicon, na Windowse inštalátor EXE pre x64 alebo ARM64. Odkaz si nechajte pre seba. Alfa `0.2.1-alpha.20` pre pozvaných testerov má na Macu podpis ad hoc bez notarizácie a na Windowse je bez podpisu vydavateľa.

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

## 6. Aktualizácie

Appka vám môže sama ponúknuť novú alfu. Ponuku zatiaľ nepotvrdzujte. Novú alfu nainštalujte až vtedy, keď ju oznámime v Telegram skupine testerov LAWOSS. Stiahnete ju z [releasov forku](https://github.com/Omni-Legal-Products/lawoss/releases), rovnako ako prvú.

## 7. Kam hlásiť chyby

Chybu, nápad alebo otázku nahláste jedným z týchto spôsobov:

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

Vyberte presný desktop release tag a súbor pre svoj systém a architektúru.
CLI orchestrátora má samostatné vydania. Odkaz `releases/latest` preto neurčuje správny desktop.
Žiadny aktuálny balíček tu nie je označený za otestovaný iba na základe názvu vydania.

Stiahnite aj `release-evidence-<platform>-<arch>.json` a porovnajte názov, veľkosť a SHA-256
inštalátora. Na macOS použite `shasum -a 256 <asset>`, na Windows
`Get-FileHash .\<asset> -Algorithm SHA256`. Nainštalujte tieto presné bytes.
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

Predpripravené inštalátory z pozvánky obsahujú aplikáciu, engine aj runtime. Ak si chcete zostaviť vlastný inštalátor, zdrojom kandidáta `alpha.20` je [commit 875852c61](https://github.com/Omni-Legal-Products/lawoss/tree/875852c61ef29754171bedd6deeb8147594090a8).

**Vlastná zostava cez GitHub Actions.** Vo svojom forku povoľte Actions a vytvorte vetvu z uvedeného commitu. V karte Actions vyberte [workflow macOS](../.github/workflows/alpha-macos-aarch64.yml) alebo [workflow Windows x64 a ARM64](../.github/workflows/alpha-windows-x64.yml) a v **Run workflow** vyberte túto vetvu. Pre macOS nastavte vo forku repository variable `MACOS_NOTARIZE=false`. Pre vlastný nepodpísaný build zvoľte `allow_unsigned_internal=true`, `draft=true` a základnú verziu `0.2.1`. Vo Windows workflowe ponechajte `publish=true`, aby vytvoril koncept vydania. Workflow pripraví engine zo zdrojov, zostaví sandbox runtime a zabalí aplikáciu. Po úspešnom behu nájdete svoje DMG alebo EXE v koncepte vydania vo vlastnom forku. Číslo alfy sa odvíja od poradového čísla vášho behu.

**Lokálne zostavenie na vlastnom počítači.** Použite Git, presne Node 24.22.1 podľa `.nvmrc`, pnpm 11.4.0 a Bun 1.4.4. Balík nástrojov kontroluje aj patch verziu Node. Ak používate wrapper pnpm, nastavte `LAWOSS_BUILD_PNPM_CLI` na absolútnu cestu k skutočnému súboru `pnpm/bin/pnpm.mjs` verzie 11.4.0. Na Macu sú pre natívne moduly potrebné Xcode Command Line Tools, na Windowse Visual Studio Build Tools s podporou C++. Na Windowse povoľte dlhé cesty pri klonovaní (`git clone -c core.longpaths=true …`).

```sh
git clone https://github.com/Omni-Legal-Products/lawoss.git
cd lawoss
git switch --detach 875852c61ef29754171bedd6deeb8147594090a8
pnpm install --frozen-lockfile
```

Pred buildom pripravte sandbox runtime pre cieľovú platformu podľa [sandbox workflowu](../.github/workflows/sandbox-runtime.yml). Rovnaký archív môžete počas jeho retencie stiahnuť cez `gh run download` po prihlásení do GitHubu. Napríklad pre Mac:

```sh
gh run download 45555531440 -R Omni-Legal-Products/lawoss -n sandbox-runtime-darwin-arm64 -D .work/alpha-runtime
mkdir -p apps/server/resources/agent-sandbox/runtime
tar -xzf .work/alpha-runtime/sandbox-runtime.tgz -C apps/server/resources/agent-sandbox/runtime
node scripts/sandbox/verify-runtime.mjs
pnpm --filter @legalwork/desktop build:electron
pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml -c.mac.identity=- --mac --arm64 --publish never
```

Na Windowse spustite príkazy v Git Bash, zvoľte beh `45555534704` a archív `sandbox-runtime-win32-x64` alebo `sandbox-runtime-win32-arm64` podľa vášho počítača. Po rozbalení, overení runtime a `build:electron` použite `pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml --win --x64 --publish never` alebo zmeňte posledný prepínač architektúry na `--arm64`. Výstup je v `apps/desktop/dist-electron`. Prvá príprava enginu potrebuje sieť a používa [recept z repozitára](../packages/opencode-release/build/README.md).

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
