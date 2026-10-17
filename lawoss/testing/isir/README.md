# Testy používání příloh ve spisech — ISIR

Základ: `4fdc8dc9`, dev z 13. 10. 2026. Testovací spisy jsou oddělené od klientských dat; výchozí automatické běhy posílají syntetické podklady pouze lokálnímu protokolovému poskytovateli. Žádný běh nepodává dokumenty soudu.

## Automatické spuštění

Z kořene repozitáře s Node 24 a Bun:

```sh
pnpm test:isir
```

Offline běh používá deset smyšlených spisů a platná malá PDF. Nevyžaduje síť ani účet a je zařazený do CI. Serverové testy používají standardní izolační preload, samostatnou konfiguraci, tokeny a databázi.

Pro skutečná veřejná PDF:

```sh
python3 lawoss/testing/isir/prepare-corpus.py --output /absolutni/cesta/k/novemu-snapshotu
LAWOSS_ISIR_CORPUS=/absolutni/cesta/k/novemu-snapshotu/corpus.json pnpm test:isir
```

Na Windows nastavte `LAWOSS_ISIR_CORPUS` v PowerShellu před spuštěním testů. Příprava používá oficiální SOAP službu ISIR, vybere právnické osoby s IČO a stáhne dvě dostupná původní PDF pro každé z deseti řízení. Manifest obsahuje odkazy, datum, velikosti a SHA-256. Chyby stahování jsou zaznamenané; neúplná sada končí chybou. Existující snapshot se nepřepisuje. Živý obsah ukládejte do soukromé místní složky mimo Git.

## Plán a kritéria přijetí

| ID | Scénář | Očekávaný výsledek | Ověření |
| --- | --- | --- | --- |
| ISIR-01 | Připojit deset existujících složek | Samostatné workspace, uložené cesty, nezměněné originály | Serverové e2e |
| ISIR-02 | Dvě PDF do každého spisu | Dvacet zápisů do správných složek, shodné bajty a SHA-256 | Server + skutečný snapshot |
| ISIR-03 | Výpis a stažení příloh | Správná jména a obsah PDF | Serverové e2e |
| ISIR-04 | Stejný název v různých spisech; přepínání | Každý spis vrací svou vlastní přílohu | Serverové e2e |
| ISIR-05 | Přidat soubor dvakrát | Druhá kopie má jiné jméno, první i originál zůstanou | Desktopová kopírovací hranice |
| ISIR-06 | Diakritika, mezery, závorky a binární PDF | Použitelné jméno a nezměněný obsah | Obě transportní cesty |
| ISIR-07 | Složka spisu zmizí | Výslovná chyba, žádná náhradní prázdná složka nebo zápis jinam | Server + desktop |
| ISIR-08 | Nepřihlášený uživatel nebo cesta mimo spis | Odmítnutí, existující příloha se nezmění | Serverové e2e |
| ISIR-09 | Pouze pro čtení | Příloha se nezapíše | Serverové e2e |
| ISIR-10 | Selže upload nebo odeslání prvního dotazu | Žádný odkaz na chybějící soubor, bezpečné opakování | Frontendové testy |
| ISIR-11 | Výběr souboru tlačítkem / nabídkou | Native picker předá soubor do správného spisu | Ruční GUI |
| ISIR-12 | Přetažení na podsložku | Správná cílová podsložka, sousední spisy beze změny | Ruční GUI |
| ISIR-13 | Příloha rozepsané zprávy | Odkaz a náhled po dokončení uploadu; zrušení nemění zprávu | Ruční GUI bez odeslání |
| ISIR-14 | Zavření a znovuotevření aplikace | Cesty a dokumenty zůstávají dostupné z trvalé složky | Ruční GUI |

## Ruční průchod v aplikaci

1. Vyberte označený **ISIR test** ve složce mimo `/tmp`.
2. V panelu souborů otevřete `Dokumenty`. Pravým tlačítkem na složce zvolte nahrání a vyberte původní PDF ze `source/case-XX` snapshotu.
3. Ověřte oznámení o kopii, výpis a otevření PDF. Opakujte se stejným souborem; původní kopie se nesmí přepsat.
4. Přetáhněte druhé PDF na jinou testovací podsložku. Zkontrolujte její obsah a sousední spis.
5. V novém rozhovoru stejného spisu přidejte PDF sponkou. Ověřte odkaz a náhled, zprávu neposílejte vzdálenému modelu.
6. Přepněte na druhý testovací spis a zpět. Každý musí ukazovat vlastní dokumenty.
7. Aplikaci restartujte po uložení rozepsaných dokumentů; přílohy musí zůstat dostupné.

Zaznamenejte verzi, OS, soubor, cílový spis/podsložku, očekávání, výsledek a důkaz. Kontrolní součet porovnejte s manifestem. Test kopírovací funkce sám neprokazuje funkčnost native pickeru nebo přetažení v GUI.

## Zjištění z reprodukce

Vybraný workspace `ws-gui` odkazoval na `/private/tmp/okf-test/ws-gui`. Složka již nebyla dostupná a aplikace vracela `project_folder_unavailable`. Testovací sada proto používá trvalé místní adresáře. Závěr vysvětluje ověřený vybraný projekt; nevylučuje jinou závadu u ostatních spisů.

Testy ověřují přenos a umístění příloh, nikoli právní správnost, OCR či odpověď modelu. Bezpečnostní balík PR #142 je samostatná změna, kterou tento základ nezahrnuje.

## Produkční nativní regrese

```sh
pnpm --filter legalwork-server build
pnpm --filter @legalwork/app build
pnpm test:isir:native
```

Vyžaduje Node 24, běžnou instalaci závislostí včetně skutečného Electron binary a desktop sidecar OpenCode **1.18.29**. Desktop `build:electron` připraví server, sestavený renderer, pluginy a sidecar v CI. Nativní test servíruje hotové UI přes loopback `vite preview`; chybějící `dist/index.html` ukončí běh bez fallbacku na vývojový kompilátor. Na Linuxu spusťte příkaz přes `xvfb-run -a`; potřebný je Xvfb a systémové knihovny Electronu. Windows potřebuje podporu NTFS junctionů; macOS místní GUI session. Chybějící předpoklad ukončí běh chybou, nezpůsobí přeskočení testu. Výslovné místní cesty `LAWOSS_ISIR_NATIVE_ELECTRON` a `LAWOSS_ISIR_NATIVE_ENGINE` dovolují použít již existující binary bez instalace do uživatelského profilu. Verze se kontroluje také u skutečně spuštěného enginu.

Deset syntetických spisů má třicet referenčních PDF a jednu nevyjmenovanou shodnou kopii. Běh používá samostatný profil, HOME/XDG, autentizaci, databáze, procesy a explicitní loopback CDP/Vite porty. Nikdy se nepřipojuje k uživatelské aplikaci. Registry je vstupní fixture; nativní opětovné připojení přesunuté složky následně prochází produkční transakcí se zachováním ID a historie.

Skutečný Electron renderer se sestaveným UI provede výběr souborů přes OS-backed HTML input a přetažení, produkční preload/IPC kopii, přípravu a čtení celé složky, výběr modelu a varianty, generování přes skutečný SDK a engine, skutečné dokumentové nástroje a mounted server/storage. Simulovaná je pouze transportní odpověď lokálního modelového poskytovatele. Poskytovatel žádné nástroje nevolá a žádné výstupy nezapisuje. Runner ověří skutečné CSV/Markdown bajty, SHA-256, korelaci messageID/parentID, okamžité 204 a nativní SSE lifecycle; všechny projekty zpracuje bez reloadů mezi spisy. Zahrnuje přílohu chatu, kolizi názvů, částečné čtení, neplatnou identitu, editovaný výstup a odmítnutí cizího pracovního adresáře. Aplikaci skutečně zavře, přesune složku, znovu spustí se stejným profilem a přes nativní chooser obnoví projekt, historii a ověřené soubory. V původní relaci odešle nový dotaz, provede skutečné čtení dokumentu a skutečný `pwd` (na Windows `node -p "process.cwd()"`), jehož výstup musí odpovídat přesunuté složce.

Testovací entry poskytne cestu obnovovacího chooseru z vlastní fixture a pasivně zaznamená původní argumenty/výsledek kopírovacího handleru. Nenahrazuje produkční IPC ani výsledek operace. CDP ovládání není důkaz skutečného ručního/CUA ovládání systémového chooseru. Běh používá dev aplikaci; ochrana zakazující CDP v distribuované aplikaci zůstává zapnutá. Živý poskytovatel, placený účet, uživatelský profil, packaged build a následná CUA akceptace zůstávají samostatné gates.

`LAWOSS_ISIR_CORPUS=/absolutni/cesta/corpus.json pnpm test:isir:native` načte místní snapshot, ale stále použije lokální modelovou simulaci. Skutečný obsah ani autentizaci neukládejte do Gitu. Runner kontroluje originály i výsledné kopie; protokolové receipts se zapisují pouze pro syntetický režim. Diagnostika zůstává ve vypsané soukromé dočasné složce mimo checkout. `pnpm test:isir` zůstává rychlý offline transportní/helper balík, který sám nativní renderer neprokazuje.

Diagnostický `node scripts/test-isir-native.mjs --debug-case-pair` provede pouze skutečné spisy 1 a 10. Receipt má `fullMatrix: false`; tento příkaz je v CI odmítnut a nenahrazuje závěrečný průchod všech deseti spisů.

Bootstrap enginu sleduje vlastní loopback OTLP receiver. Z dokončených spanů uchová jen 15 pevných názvů, číselnou dobu a stav (nejvýše 8 záznamů na název); resource metadata, atributy, události, ID a texty chyb zahazuje. Chybějící dokončený span sám neprokazuje vstup do fáze. Při selhání se omezená projekce vypíše až po ukončení vlastněných procesů.

Globální health endpoint ani aktivní UI akce nepotvrzují dokončený bootstrap pracovního prostoru. Před konfigurací syntetického poskytovatele runner proto vyžaduje skutečný owner-auth `GET /workspace/:id/opencode/mcp`, stav 200 a úplný JSON objekt v samostatném pětiminutovém cold-start limitu odpovídajícím čekání na instalační zámky připnutého enginu. Teprve potom provede PATCH/auth a původní produkční reload s jeho vlastním 90sekundovým limitem. Překročený limit či chybný cold start stále selže; všech deset předem uložených spisů, pluginy a celý nativní scénář zůstávají.

Workflow `ci-windows-portable.yml` má navíc ruční `workflow_dispatch` s povinným `runtime_run_id`. Doplnkový Windows x64 job použije artefakt desktopového buildu ze stejného repozitáře a větve, jehož SHA je předkem vybraného refu. Běžná kontrola manifestu a celý syntetický nativní scénář zůstávají; pouze se znovu nesestavuje QEMU. Tento job nenahrazuje povinné PR/source/package kontroly.
