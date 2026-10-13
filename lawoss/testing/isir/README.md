# Testy používání příloh ve spisech — ISIR

Základ: `4fdc8dc9`, dev z 13. 10. 2026. Testovací spisy jsou oddělené od klientských dat; žádné dokumenty se neposílají modelu ani soudu.

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
