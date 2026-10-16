# Ověření integrace bezpečnosti a spolehlivosti — 16. 10. 2026

Tento záznam doplňuje [implementační plán](../superpowers/plans/2026-10-13-isir-native-reliability.md) a [regresní kritéria](../../lawoss/testing/isir/native-reliability-acceptance.md). Popisuje lokální ověření konkrétního zdroje; nenahrazuje výsledky CI nebo přijetí aplikace uživatelem.

## Změny

- Integrační commit `c4c50b74a760457b96be4ab9f687edc7637bfb90` zachovává spolehlivost z `26a2e345` a bezpečnostní změny [PR142](https://github.com/Omni-Legal-Products/lawoss/pull/142) z `5909e96d`.
- Sanitizované veřejné workspace odpovědi již neposkytují přihlašovací údaje enginu. Desktop je získává soukromě z aktuálního vlastněného serverového handle podle identity workspace. Regrese skutečného runtime/vestavěného serveru před opravou vracela u čerstvého managed i external spuštění HTTP401, po opravě HTTP200; veřejné odpovědi nadále údaje neobsahují.
- Samostatný testovací commit `8ec71e8b63d7966bf9ba8cd3edd0939e5c502b06` zachovává původní chybu při souběžném selhání úklidu, nezávisle uzavírá listener, obnovuje prostředí a odstraní jen očekávaný hluk z logů. Produkční zdroj nemění.
- Commit `98801ce7d3dd3a52f82307b3dc8d6e18e8ccc934` připojuje [PR159](https://github.com/Omni-Legal-Products/lawoss/pull/159), přesný dev `0e67695c`. Oprávnění viewer pro vyhledávání, obsah projektu a připravené vstupy zůstávají uvnitř řízené životnosti požadavku. Zachováno je rušení proxy, uvolnění SQLite, ověřování zdrojů a exportů i soukromé přihlášení.

## Integrace dev v0.2.4 a následné opravy

Commit `a3a6968758a19bab87c7c0e0efd7f9bed9fd68a3` spojuje opravy s přesným dev `34df1a4f` ([PR160](https://github.com/Omni-Legal-Products/lawoss/pull/160), upstream v0.2.4, a PR161). Zachovává bezpečnostní opravy PR142/159, soukromé přihlášení, paměť a provenance zdrojů, i nové kalendáře, instrukce a limity použití.

- Skutečný kalendářový HTTP test před opravou po zastavení posledního serveru naměřil jeden otevřený SQLite handle. Kalendář nyní využívá existující generační vlastnictví; dva servery, uvolnění, odstranění složky za běhu a opětovné připojení ověřuje Bun i skutečně sestavený Node server.
- Samostatný callback instrukcí funguje i po uvolnění předchozího vlastníka databáze. Chyba limitu použití a následné nativní idle ve stejném časovém taktu již nezadržují nepoužívaný stream; novější chyby, čekání, aktivní práce a jiný scope nadále uvolnění brání.
- `f4871a15` omezuje dvě synchronní diagnostické sondy na timeout 2000 ms a výstup 1 MiB. Jde o omezení diagnostiky, nikoli prokázanou opravu příčiny startu. Testy izolují skutečný diagnostický vstup od ambientních binárek; starší běhy se dvěma ambientními sondami zůstávají historickým záznamem.
- `c1e9e599` upravuje testovací POSIX relaunch: nejprve požádá aplikaci o běžné ukončení, pak stále vyžaduje přísné ověření úklidu. Windows zachovává původní pořadí zavření CDP a stop. Potvrzení požadavku ani ukončení leaderu samo o sobě nepovoluje přesun složky. Kontrolované helpery:226PASS; skutečné platformní ukončení tím prokázané není.
- Nezávislá kontrola integrace odhalila zápis metadat obnovování poskytovatele před odmítnutím konfliktní změny HTTP409. Oprava `4ff3a6a7` přesouvá existující zápis za ověření konfliktu, před přijatou změnu. 31 cílených PASS;1852PASS/33SKIP/0FAIL server;15Node+5auth PASS;262importů; types/build exit0. Odmítnutí musí zachovat i metadata, nikoli jen řádky poskytovatelů.

| Zdroj | Kontrola | Výsledek |
| --- | --- | --- |
| `a3a69687` | server / app / desktop unit suites |1850PASS+33SKIP /1771PASS+2SKIP /346PASS+4SKIP;0FAIL |
| `a3a69687` | typecheck server/app/Electron; build types/server/app |exit0 |
| `a3a69687` | skutečný postbuild Node lifecycle/proxy / soukromé přihlášení / importy |15PASS /5PASS /262 importováno,264 staticky zkontrolováno |
| `a3a69687` | i18n a audit; synthetic ISIR |6371 klíčů en/de/sk/cs;21Node+6server+2desktop+14app PASS |
| `a3a69687` | generovaný kalkulátor |dvě skutečná sestavení,512 shodných hashů;78 offline porovnání původního/nového výstupu a kernelu PASS |
| `4ff3a6a7` | HTTP provider/config regrese; server typecheck/build; Node/auth/import; celá serverová sada |31 cílených PASS;1852PASS/33SKIP/0FAIL server;15Node+5auth PASS;262importů; types/build exit0 |

Po závěrečných opravách testů se u `a3a69687` změnily jen tři sestavené testovací moduly; produkční graf pro uvedené Node konzumenty zůstal shodný. Regenerovaný kalkulátor vychází ze skutečného Bun1.4.2; testovaná technická ekvivalence není univerzální důkaz ani nové ověření právních pravidel. Dvě původní mezery v přesných upstream souborech jsou evidované výjimky; kontrola autorského overlay je zelená. Nezávislé review Task53 nejprve ImportantI1 / Changes required, po opravě scoped I1ADDRESSED / SPEC PASS / QUALITY Approved, bez nového nálezu; přesné zdroje, příkazy, chyby a výsledky jsou uchované odděleně od historických běhů.

## Historické lokální kontroly před integrací v0.2.4

Použité nástroje: Node24.21.0, skutečné pnpm11.4.0 a Bun1.4.2. Žádná regenerace locků ani náhrada skutečných balíčků mockem. Před Node konzumenty byl skutečně sestaven server.

| Zdroj | Kontrola | Výsledek |
| --- | --- | --- |
| `98801ce7` | `pnpm --filter legalwork-server typecheck` a `build` | exit0 |
| `98801ce7` | `pnpm --filter legalwork-server test` | 1675PASS,33SKIP,0FAIL;207souborů |
| `98801ce7` | `node --test apps/server/scripts/runtime-db-lifecycle.node.test.mjs apps/server/scripts/opencode-proxy-cancellation.node.test.mjs` |14PASS,0SKIP,0FAIL |
| `98801ce7` | `node --test apps/desktop/electron/runtime-embedded-auth.node.test.mjs` |5PASS,0SKIP,0FAIL |
| Task46, odpovídající nezměněné moduly | app / desktop / router / orchestrator |1696PASS+2SKIP /342PASS+4SKIP /32PASS /6PASS |
| Task46, nezměněné helpery a opravené fixtures | package / native helpery |13PASS /204PASS,0FAIL |
| Task46 a fix1 | typecheck app/server/Electron, build serveru |exit0 |

Výsledky Task46 nejsou novým spuštěním těchto sad na `98801ce7`: shodu nezměněných zdrojů ověřuje Git identity audit. Na novém společném serverovém zdroji proběhly první čtyři řádky znovu. Nová sada serveru obsahuje všech deset požadovaných bezpečnostních/import/preparation/export souborů; Windows ADS kontrola patří mezi platformní skips na macOS.

Nezávislé SPEC a QUALITY review: integrační Task46 i následná oprava testu schváleny; Task48 SPEC PASS / QUALITY Approved, bez nových blokujících nálezů. Původní RED výsledky a chyby přípravy jsou zachovány samostatně. Historický Task38 package12 běžel na Node22; nový package13 na přesném Node24.21.0. Dva skutečné process fixtures nyní používají nezměněný produkční cleanup default; helper ani jeho timeout nebyl rozšířen.

## Otevřené ověření

- Nové CI na přesném publikovaném headu, skutečné Windows ADS/SQLite uvolnění a plný nativní desktop/start/relaunch průchod. Historický head `983ad434` měl10SUCCESS/3FAILURE/2SKIP: Windows source, Windows package a macOS package selhaly; nový zdroj jejich nápravu musí ověřit znovu.
- Actual-engine `app:test:e2e`, plný lokální nativní build a mounted calendar navigace nebyly v source fázi spuštěné. Nový uživatelský build, deset veřejných spisů ISIR přes GUI, restart/persistence a skutečný autorizovaný provider. Lokální inertní engine ani syntetické CI nejsou tyto uživatelské akceptační testy.
- Skutečné nezávislé GitHub approval a zelené požadované kontroly před merge do dev. Agentí source review tuto podmínku nenahrazuje.
- Produkční volání samostatného SDK dependency helperu zůstává nezapojené; před případným zapojením platí původní runtime a notice gates. Omezení doctor sond je implementované v `f4871a15`; příčina předchozích native selhání tím prokázaná není. Přesný notice text pro `@npmcli/agent@4.0.2` zůstává neověřený; připnutí metadat samo o sobě tento release gate neuzavírá.

Do repozitáře nebyly vloženy reálné spisy, klientské údaje, provider klíče ani soukromé logy. Nové placené výstupy v rámci těchto kontrol:0.
