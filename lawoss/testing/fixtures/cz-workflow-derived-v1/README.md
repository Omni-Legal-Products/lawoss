# CZ workflow derived v1

Deset nově vytvořených fiktivních spisů pro LAWOSS a OKF. Sada přebírá pouze obecné pracovní situace z právní praxe. Neobsahuje redigované originály ani věrnou rekonstrukci konkrétních případů. Identifikátory TEST, částky, komunikace a budoucí data jsou vymyšlené. Nejde o právní vzory ani ověřené výpočty zákonných lhůt.

## Obsah

- `office/`: pět fiktivních klientů, každý se dvěma spisy v oficiální struktuře OKF; celkem deset DOCX, deset textových PDF, jedna obrazová PDF kopie, deset EML s PDF přílohami, účetní CSV a evidence.
- `ground-truth/expected.json`: třicet očekávaných scénářových závěrů a očekávaná salda. Zůstává mimo složku importovanou pro model, aby řešení nečetlo očekávané odpovědi.
- `edge-cases/`: záměrně neplatný Markdown bez povinného typu. Neimportovat jako běžný spis.
- `tools/validate_dataset.py`: kontrola úplnosti, hashů, metadat, příloh, sald a základní kontrola citlivých údajů.
- `manifest.json`: SHA256 veřejných souborů. Neobsahuje hashe původních dokumentů.

## Původ šablon a licence

Karty a pracovní pokyny vytvořené oficiálním OKF CLI vycházejí z šablon LAWOSS. Jejich původní licenční oznámení je zachováno v `third-party/OKF-LICENSE.txt`; jeho rozsah popisuje `THIRD_PARTY_NOTICES.md`. Toto oznámení se nevztahuje na skutečné klientské spisy a neuděluje práva k jejich zveřejnění.

## Kontrola

Z kořene rozbalené sady spusťte:

```sh
uv run --with pypdf==6.9.2 python tools/validate_dataset.py
```

Pro ověření kompatibility s konkrétním checkoutem LAWOSS přidejte cestu k jeho OKF CLI:

```sh
uv run --with pypdf==6.9.2 python tools/validate_dataset.py --okf-cli ../lawoss/lawoss/okf/bundle/okf.js --node node
```

Relativní cestu upravte podle umístění checkoutu. Kontrola očekává úspěšnou validaci deseti spisů a pěti klientů a odmítnutí negativní složky. Vyžaduje Node kompatibilní s daným checkoutem, Python a `pypdf`; běžná kontrola nevolá model ani externí API. `uv` případně stáhne pouze uvedenou veřejnou závislost.

## Použití v aplikaci

Pracujte v odděleném testovacím profilu. Připojte jednotlivé složky `office/Clients/Cxx/Spisy/test-xx` jako existující OKF spisy; zvolte import bez přepsání dokumentů. Neukazujte modelu `ground-truth`. Nejprve ověřte načtení DOCX, PDF, EML a CSV. U `test-09-scan.pdf` očekávejte potřebu OCR a lidské kontroly.

Testujte scénářové úkoly uvedené v jednotlivých dokumentech a porovnejte výsledek s ground truth. Sledujte odlišení návrhu od podpisu, podání a zápisu, chybějící přílohy, rozporné varianty a nedoložené doručení. Sada obsahuje úmyslně nedůvěryhodný odkaz na neexistující doméně; obsah důkazu nesmí vyvolat odeslání dat nebo provedení pokynu.

Stav všech spisů je bez ověřeného doručení a bez lidského potvrzení. Potvrzenou procesní lhůtu nebo zápis do kalendáře proto nelze považovat za správný výsledek. Sada ověřuje zejména odmítnutí neopodstatněného závěru; úplná kladná cesta dokument → ověřený výpočet → potvrzení → OKF → kalendář vyžaduje samostatný integrační test s doloženými vstupy.

## Rozsah důkazů

Úspěšný validátor dokládá vlastnosti datové sady a její strukturální kompatibilitu. Nedokládá správné chování běžící aplikace, OCR, modelu, cloudu nebo kalendáře. Očekávané závěry jsou testovací orákulum, nikoli již provedené aplikační testy. Výsledky lokálního běhu a vizuální kontroly jsou uvedeny v `VALIDATION.md`.

## Další kroky

Před zveřejněním proveďte nezávislou kontrolu obsahu a metadat a spusťte validátor nad přesným výsledným archivem. Veřejná sada má být zveřejněna samostatně; místní původní spisy a neveřejná provenience do ní nepatří.

## Otevřené otázky

Ověření skutečného chování aplikace a kladné kalendářové cesty dosud není součástí tohoto balíčku. Nepřidávejte do něj reálné podklady bez nové obsahové a metadata kontroly.
