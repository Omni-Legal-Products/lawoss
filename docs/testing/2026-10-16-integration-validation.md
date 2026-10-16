# Ověření integrace bezpečnosti a spolehlivosti — 16. 10. 2026

Tento záznam doplňuje [implementační plán](../superpowers/plans/2026-10-13-isir-native-reliability.md) a [regresní kritéria](../../lawoss/testing/isir/native-reliability-acceptance.md). Popisuje lokální ověření konkrétního zdroje; nenahrazuje výsledky CI nebo přijetí aplikace uživatelem.

## Změny

- Integrační commit `c4c50b74a760457b96be4ab9f687edc7637bfb90` zachovává spolehlivost z `26a2e345` a bezpečnostní změny [PR142](https://github.com/Omni-Legal-Products/lawoss/pull/142) z `5909e96d`.
- Sanitizované veřejné workspace odpovědi již neposkytují přihlašovací údaje enginu. Desktop je získává soukromě z aktuálního vlastněného serverového handle podle identity workspace. Regrese skutečného runtime/vestavěného serveru před opravou vracela u čerstvého managed i external spuštění HTTP401, po opravě HTTP200; veřejné odpovědi nadále údaje neobsahují.
- Samostatný testovací commit `8ec71e8b63d7966bf9ba8cd3edd0939e5c502b06` zachovává původní chybu při souběžném selhání úklidu, nezávisle uzavírá listener, obnovuje prostředí a odstraní jen očekávaný hluk z logů. Produkční zdroj nemění.
- Commit `98801ce7d3dd3a52f82307b3dc8d6e18e8ccc934` připojuje [PR159](https://github.com/Omni-Legal-Products/lawoss/pull/159), přesný dev `0e67695c`. Oprávnění viewer pro vyhledávání, obsah projektu a připravené vstupy zůstávají uvnitř řízené životnosti požadavku. Zachováno je rušení proxy, uvolnění SQLite, ověřování zdrojů a exportů i soukromé přihlášení.

## Lokální kontroly

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

- Nové CI na přesném publikovaném headu, skutečné Windows ADS/SQLite uvolnění a plný nativní desktop/start/relaunch průchod.
- Nový uživatelský build, deset veřejných spisů ISIR přes GUI, restart/persistence a skutečný autorizovaný provider. Lokální inertní engine ani syntetické CI nejsou tyto uživatelské akceptační testy.
- Skutečné nezávislé GitHub approval a zelené požadované kontroly před merge do dev. Agentí source review tuto podmínku nenahrazuje.
- Produkční volání samostatného SDK dependency helperu zůstává nezapojené; před případným zapojením platí původní runtime a notice gates. Doctor hardening je samostatná plánovaná změna, nikoli tvrzená oprava příčiny předchozích native selhání.

Do repozitáře nebyly vloženy reálné spisy, klientské údaje, provider klíče ani soukromé logy. Nové placené výstupy v rámci těchto kontrol:0.
