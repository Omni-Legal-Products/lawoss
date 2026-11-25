# Ako previesť advokáta testom LAWOSS

Tento postup je určený agentovi, ktorému tester dal odkaz na verejný repozitár. Veď ho v jeho jazyku. Po každom kroku zaznamenaj skutočný výsledok. Na štart stačí veta **„Pomôž mi vyskúšať LAWOSS na mojom počítači.“**

## 1. Zisti, kde bude aplikácia bežať

Skontroluj systém a typ procesora na **testerovom počítači**. Ak máš iba webový prístup alebo bežíš v cloude, opýtaj sa testera na jeho OS, procesor a či chce hotovú appku alebo vlastnú kompiláciu. Pri osobnej pozvánke stačí, ak ju otvorí vo svojom prehliadači. Do chatu patrí platforma a číslo verzie. Prístupový odkaz, prihlasovanie k poskytovateľovi a systémové heslo ostávajú u testera.

| Situácia | Postup agenta |
| --- | --- |
| macOS s Apple Silicon alebo Windows x64/ARM64, osobná pozvánka | Otvor s testerom inštalátor pre jeho architektúru. Pozvánka obsahuje obrázkový návod aj údaje o verzii. Pri prvom štarte ho veď cez dialóg konkrétnej aplikácie. |
| Záujemca bez pozvánky | Na [prihláške](https://lawoss.app/sk/alfa) si zvolí jazyk. Kým dostane pozvánku, môžete pripraviť lokálne testovacie dáta. Na jeho žiadosť pokračuj vlastnou kompiláciou. |
| Tester chce kompilovať | Použi [Build zo zdrojov](lawoss-build-pre-testerov.md#build-zo-zdrojov). Pri reprodukcii alfy použi uvedený presný commit v samostatnom checkoute. Rozlišuj ho od revízie, z ktorej čítaš tento návod. |
| Iný systém alebo Mac s Intelom | Pre tento pilot ponúka pozvánka tri uvedené architektúry. Ponúkni prípravu testu na podporovanom počítači. |

**Pri kompilácii** si ponechaj tento návod otvorený z predvolenej vetvy. Zisti požadované verzie podľa pripnutého zdroja a workflowu. Skontroluj Node vrátane patch verzie, pnpm, Bun a nástroje platformy. Spusti `node scripts/alpha-preflight.mjs --strict`, nainštaluj závislosti podľa lockfile, priprav a over sandbox runtime a dokonči build podľa prepojeného postupu. Pri expirovanom artefakte použi workflow z vlastného forku alebo zostav runtime podľa návodu. Výstup skontroluj v `apps/desktop/dist-electron`. Na rovnakom systéme spusti `node apps/desktop/scripts/packaged-startup-regression.mjs "<cesta k zabalenému spustiteľnému súboru>"`. Na Macu ide o `LAWOSS.app/Contents/MacOS/LAWOSS`, na Windows o `LAWOSS.exe` v rozbalenom adresári buildu. Až po úspechu odovzdaj cestu k DMG/EXE, architektúru, commit a výsledok štartu. Pri chybe uveď posledný úspešný krok a konkrétny dôvod. Vlastné buildy môžu uvádzať verziu `0.0.0`.

## 2. Priprav samostatnú skúšku a formulár

V čerstvom checkoute predvolenej vetvy spusti nasledujúci príkaz. Miesto výstupu má byť mimo pracovných spisov. Skript používa štandardnú knižnicu Pythonu, pracuje offline a pri každom behu vytvorí novú skúšku. Pre Windows nahraď `python3` za `py -3`.

```sh
python3 lawoss/testing/tester/prepare.py --output "../LAWOSS-testy" --locale sk
```

Podporované jazyky formulára sú `sk`, `cz` a `en`. Ak už poznáš verziu z Nastavení, doplň `--version`. Pri príprave na inom počítači zadaj systém aj procesor cieľa, napríklad `--os win32 --arch arm64`. Výstup je JSON s cestou k izolovanému klientovi, konceptu hlásenia a odkazu na formulár. Testovací klient C01 je malá česká syntetická sada s PDF, DOCX a EML. Na skúšku slovenskej kancelárie a triedenia použi [slovenskú sadu so SHA-256](../SYNTHETIC_DATA.md). Ak tester nemá Python, skopíruj priečinok [C01](../lawoss/testing/fixtures/cz-workflow-derived-v1/office/Clients/C01) do nového priečinka, ponechaj vedľa neho licenčné oznámenie a priprav hlásenie podľa bodu 4.

## 3. Prejdi s testerom jednu skutočnú úlohu

1. Nechaj testera otvoriť aplikáciu a dokončiť sprievodcu. Pripoj len pracovnú kópiu klienta z poľa `open_in_lawoss`. Vlastný účet k modelu si tester pripojí sám. Oprávnenia povoľuje pri funkcii, ktorú práve skúša.
2. Otvorte klienta a vec `Spisy/test-02`. V prehľade skontrolujte, že aplikácia pracuje s touto vecou. Otvorte jeden PDF a jeden EML. Nech sa tester opýta na údaj z dokumentu a vyžiada si zdroj. Porovnajte odpoveď s pôvodným súborom.
3. Reštartujte appku a overte, že tester znovu nájde rovnakého klienta. Zaznamenaj, čo sa podarilo, čo zlyhalo a čo ste preskočili. Pri odpojenom modeli sa dá overiť inštalácia a otvorenie súborov. Otázka nad dokumentom potrebuje pripojený model.
4. Bežný pilot používa syntetické alebo verejné dáta. Stav špecializovaného chráneného režimu [ISIR](https://github.com/Omni-Legal-Products/lawoss/issues/384) posudzuj podľa samostatného natívneho testu.

## 4. Odovzdaj výsledok a priprav spätnú väzbu

Do `feedback.md` doplň platformu, skutočnú verziu (pri vlastnej zostave aj commit), kroky, očakávanie, pozorovanie a opakovateľnosť. Uveď len zistenia z tohto behu. Získanú odpoveď skontroluj spolu s testerom. Prípadné snímky nech skontroluje pred odoslaním. Formulár prijíma najviac tri prílohy po 10 MB. Do hlásenia patria syntetické reprodukčné údaje.

Otvor `feedback_form` alebo v aplikácii zvoľ **Pomocník → Nahlásiť chybu alebo nápad**. Pred odoslaním ukáž testerovi konečné znenie a prílohy. Po potvrdení zapíš číslo prijatého hlásenia. Ak sa odoslanie nepodarí, ponechaj koncept a označ ho ako neodoslaný. Na konci odovzdaj testerovi cestu k aplikácii, ku skúšobnému klientovi a k výsledkom. Pri ďalšom spustení môže s agentom nadviazať priamo v priečinku svojej skúšky.
