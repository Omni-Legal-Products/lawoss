# OKF scaffold

`okf plan/apply klient|spis|projekt` vytvára karty `client.md`, `matter.md`, `project.md`. Názvy príkazov a pôvodné polia kariet ostávajú kompatibilné; toto nie je hromadná migrácia dátového modelu.

Rozhodnutie o anglických názvoch: [zápis 11. 9. 2026](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-09-11-zapis-sync-call.md).

Pri existujúcej `klient.md`, `spis.md` alebo `projekt.md` plán zachová tento názov aj obsah a nevytvorí kanonického dvojníka. `detect`, `validate`, `render` a natívny náhľad poznajú oba názvy. Dve karty rovnakého typu zastavia plán; najprv treba obsahovo vyriešiť konflikt. Zmena alebo odstránenie názvu karty medzi plánom a zápisom vyžaduje nový plán.

Odkazy v novej karte veci smerujú na skutočne nájdenú nadradenú kartu klienta. Ak ju CLI nenájde, uvedie pokyn otvoriť kartu v klientskom priečinku a nevymyslí cestu. UI používa skutočnú cestu načítanej karty, vrátane starého názvu.

Automatické premenovanie existujúcich klientskych súborov nie je súčasťou `apply`. Existujúce AGENTS/CLAUDE sa zachovávajú; nové dvojice sú obsahovo zhodné. Reálny migračný pilot potrebuje výslovne určenú kópiu spisu.

Ručný stav používa `manual_updated` a je opísaný v [pamäťovom jadre](../okf-pamat/README.md#ručný-stav-a-aktuálnosť).

## Jazyk generovaných dokumentov

Jazyk dokumentov je samostatný údaj `language: cs|sk|en` v novej karte klienta, veci alebo projektu. Nie je to jurisdikcia: česká jurisdikcia ostáva `jurisdiction: cz`, slovenská `jurisdiction: sk`. Anglický dokument môže patriť do ktorejkoľvek z nich. UI odovzdáva vybraný jazyk explicitne; CLI používa `--language cs|sk|en`:

```sh
okf plan spis /cesta/k/veci --title "Nová vec" --cz --language cs --json
# Po potvrdení plánu použite apply s rovnakými argumentmi.
okf plan klient /cesta/ku/klientovi --title "Klient" --language en --json
```

Prednosť má explicitný jazyk, potom jazyk existujúcej karty pri dopĺňaní štruktúry, potom jurisdikcia (`cz` → `cs`, `sk` → `sk`). Bez jazyka aj jurisdikcie ostáva pôvodný slovenský default pre starších volajúcich. `cz` nie je platný jazyk. Chýbajúca hodnota, nepodporovaný jazyk alebo opakovaný `--language` sa odmietnu pred zápisom. `render` číta jazyk karty pre odvodený index; `--language` ho môže pre tento render explicitne zmeniť bez zmeny karty.

Prekladajú sa nové karty, AGENTS/CLAUDE, archívna pamäť, ručný stav, vstupný a komunikačný register, klientsky index a opis pracovného profilu. Nový predvolený profil má české alebo anglické pracovné priečinky podľa jazyka; napríklad `03_Navrhy`, resp. `03_Drafts`, a `05_Komunikace/Dulezita_posta`, resp. `05_Communication/Important_mail`. Stabilné roly ako `drafts`, názvy vyhradených súborov, priečinok `Spisy`, markery projekcií a strojový token `bez-datumu` sa nemenia. Výslovne nakonfigurované priečinky/roly/naming a existujúci snapshot profilu majú vždy prednosť pred jazykovým defaultom.

`plan`/`apply` neprekladajú ani neprepisujú existujúce súbory a nepresúvajú ich. Zmena jazyka preto nie je migrácia už založeného spisu. Taká oprava vyžaduje samostatný porovnávací plán: odlíšiť nezmenené generované šablóny od klientskych údajov, zachovať originály a ručné úpravy a presuny skontrolovať podľa uložených rolí. Jazykové varianty šablón nemenia právny režim veci. Text používateľa a zdrojové dokumenty sa automaticky neprekladajú.

Pre priamych volajúcich je určené `PlanInput.language` a `LOCALIZED_TEMPLATES` (CLI) alebo zodpovedajúca sada v aplikácii. `planEntity` stále prijíma aj pôvodný `TemplateSet` ako už vybranú vlastnú sadu; jej jazyk musí zabezpečiť volajúci. Konzolové diagnostiky CLI nie sú súčasťou prekladu uložených dokumentov.

### Kancelársky profil v aplikácii

V natívnych **Nastavenia → Prispôsobenie** je kancelársky profil vybraného lokálneho workspace. Upravuje pracovné priečinky, priradenie rolí, vzor názvu dokumentov a voliteľný `client_path` v `Office/okf.config` (alebo existujúcom `_kancelaria/okf.config`). Ostatné položky vrátane trvalého oprávnenia zostanú zachované. Pri súbežnej zmene sa uloženie odmietne; načítajte profil znova a zopakujte úpravu. Otvorený klient či vec nie je koreň kancelárie — editor vtedy vyzve otvoriť kancelársky workspace.

Meno z existujúceho nastavenia **Meno advokáta a autor dokumentov** sa odovzdá do náhľadu aj CLI cez `--advokat`. Používa sa pre nové karty a nové zmeny v DOCX editore, neprepisuje existujúce dokumenty a samo neudeľuje oprávnenie na zápis. Predvolené označenie editora `LegalWork` sa nevydáva za meno advokáta. Natívne komentáre a revízie vo Worde naďalej identifikuje Word podľa Office konta.

Zmena kancelárskeho profilu sa prejaví pri nových veciach. Existujúci `PRACOVNY-PROFIL.md` sa nemení a žiadne súbory sa automaticky nepresúvajú.

## Bezpečné pomenovanie vybraných dokumentov

[Schválená špecifikácia a plán](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83), Task 4. Prenosný skill `/usporiadaj-spis` používa rovnaký offline bundle `resources/okf.js`; natívny OKF balík inštaluje `/novy-spis`, `/okf-pamat` a `/usporiadaj-spis`. Tok založenia novej veci naďalej potrebuje iba prvé dva skilly.

```sh
node bundle/okf.js naming /physical/matter --manifest /outside/request.json --out /outside/plan.json --json
# Až po explicitnom schválení presného plánu človekom:
node bundle/okf.js naming /physical/matter --plan /outside/plan.json --apply --json
```

Preview nezapisuje do spisu. Voliteľné `--out` vytvorí **nový súbor mimo spisu**, s exclusive create; nesmie prepísať ani iný externý súbor. Relatívne `--out` sa vyhodnocuje voči aktuálnemu pracovnému priečinku procesu. Manifest a plán môžu obsahovať citlivé cesty a metadáta; sú lokálne artefakty. CLI nepovažuje ich existenciu za doklad ľudského súhlasu. SHA-256 fingerprint viaže presný obsah a zachytí zmenu plánu; nie je tajný podpis. Zmenený alebo nanovo vytvorený plán potrebuje nové schválenie.

Manifest v1:

```json
{
  "schema": "lawoss.document-naming.request/v1",
  "operationId": "naming-001",
  "documents": [{
    "id": "doc-001",
    "path": "03_Drafty/pracovny.docx",
    "treatment": "rename-working",
    "destinationRole": "drafts",
    "metadata": { "date": "bez-datumu", "description": "navrh-zmluvy", "version": "01" }
  }],
  "markdownFiles": ["poznamky/odkazy.md"]
}
```

Autoritou je uložený `PRACOVNY-PROFIL.md` konkrétneho spisu, vrátane `naming` a rolí. Chýbajúci alebo neplatný profil odmietne operáciu. `date` musí byť explicitný platný kalendárny ISO dátum alebo `bez-datumu`; mtime, príjem, názov ani OCR nie sú zdrojom právneho dátumu. Každý ďalší použitý placeholder (`kind`, `client`, `description`, `version`) vyžaduje hodnotu. Normalizácia nahradí oddeľovače/riadiace znaky a whitespace pomlčkou, zachová NFC Unicode a ukáže vstup aj výsledok. Verziu nikdy neinkrementuje. Prípona vrátane veľkosti písmen ostáva zachovaná.

`copy-original-to-drafts` zachová originál aj jeho pôvodný názov a vytvorí byte-identickú kópiu výhradne v uloženej roli `drafts`. `rename-working` je len pre explicitne klasifikované pracovné dokumenty. Najprv vytvorí overenú exclusive kópiu, potom upraví vybrané odkazy a až následne odstráni nezmenený pracovný zdroj. Existujúce ciele sa neprepisujú; kolízia vyžaduje nové explicitné metadáta a nový plán.

Nástroj kontroluje len explicitné dokumenty, vybrané Markdowny, profil a voliteľný `.lawoss/memory-profile.json`, presné rodičovské/cieľové adresáre a vlastný journal. Nerobí rekurzívny scan. Shallow kontrola mien v konkrétnom adresári je ohraničená na 20 000 položiek. Limity: 64 dokumentov, 32 Markdownov, 100 MiB/dokument, 5 MiB/Markdown, 1 GiB vstupov spolu, 4 MiB JSON manifest/plán. Veľmi hustý Markdown nad 4096 prepisov alebo 20 000 kontrolovaných odkazov rozdeľte na menší výber. Symlinky v ktoromkoľvek komponente, hardlinky, drive/UNC/backslash relatívne cesty, traversal, Windows reserved názvy, kolízie po normalizácii veľkosti písmen, source/target prekrývanie, systémové/identifikačné súbory a mapované zdroje pamäte sú odmietnuté. Absolútny fyzický koreň CLI môže byť platformová Windows drive/UNC cesta. Externé mapované vaulty sa neotvárajú; ich mapovanie slúži len na ochranu zdrojov v tomto spise. Aj zmena prítomnosti memory profilu ruší plán.

Podporované relatívne inline/image/reference/wiki odkazy vo vybraných Markdownoch zachovajú fragment, query, label a angle-bracket zápis. Markdown cieľové cesty sa URI-kódujú oddelene od fragmentu a query. Wiki cieľ s `#`, `%`, hranatými zátvorkami, `^` alebo `|` sa konzervatívne odmietne; jeho escapovanie závisí od aplikácie. Pri presúvaní dokumentov sa relatívny odkaz s HTML entitou (napr. `&#46;`, `&#x2e;`, `&period;`) odmietne ako nejednoznačný, aj keď by mohol odkazovať na iný súbor. Aj entity v zvyšnej nepodporovanej syntaxi sa odmietajú, aby skrátený či chybný odkaz nemohol obísť kontrolu. Upravte vybraný odkaz na jednoznačnú relatívnu cestu alebo zvoľte vhodné metadáta a získajte nový plán. Odkazy na originály sa nemenia. Vybrané Markdowny sa nesmú zároveň premenúvať. Dotknutá nepodporovaná syntax, nejednoznačný Obsidian basename/extensionless odkaz, duplicitná reference definícia či zmienka o presúvanom názve v kóde alebo voľnom texte odmietne plán konzervatívne. **Nevybrané odkazy neboli overené**; CLI nikdy netvrdí úplnú referenčnú integritu spisu.

Apply overí schému/fingerprint aj novú deriváciu presného plánu, fyzický koreň, profil, vybrané zdroje a absent ciele. `.lawoss/naming-history/apply.lock` vylúči ďalšie spolupracujúce apply. `.lawoss/naming-history/<operationId>/` drží nemenný `journal.json` s plánom, byte snapshoty, zámery operácií a po úspechu `committed.json` s finálnymi hashmi a fyzickými identitami. Súbory sú flushnuté cez fsync; nejde o všeobecnú garanciu atomickej transakcie pri strate napájania. Snapshoty sa automaticky nemažú a môžu zabrať ďalší objem približne ako vybrané vstupy. Na lokálnom disku preto treba miesto pre snapshoty aj cieľové kópie.

Výstupy: `applied`, `already-applied` (overené finálne stavy rovnakej operácie), `conflict` alebo `recovery-required`. Exit 0 = preview/success/replay, 1 = konflikt/obnova/I/O (aj zmenený fingerprint), 2 = chybná schéma/použitie. Nečitateľný či skrátený existujúci journal alebo committed receipt vracia `recovery-required` s cestou k journalu a zachová dôkazy; úplný záznam iného fingerprintu je konflikt. Rovnaké operationId s iným fingerprintom sa odmietne. Neúplný journal sa automaticky nereštartuje. Rollback obnovuje iba preukázané vlastné zmeny; novšie cudzie úpravy neprepíše a pri neistej obnove zachová kópie, ktoré môžu potrebovať novšie odkazy. Pri páde môže zostať lock: pred akýmkoľvek ručným zásahom overte, že proces už nebeží, posúďte journal/snapshoty/aktuálne hashe a získajte osobitné schválenie obnovy. Neexistuje `--force`.

Bezpečnostná hranica je lokálny nástroj pre spolupracujúce procesy. Opakované lstat/FD identity/hash CAS kontrolujú súbežné zmeny, ale portable Node path operácie nie sú sandbox ani OS atomický compare-and-swap proti útočníkovi prehadzujúcemu rodičovské adresáre medzi syscallmi. Výsledok nedokazuje právnu správnosť, podpis, odoslanie ani doručenie.
