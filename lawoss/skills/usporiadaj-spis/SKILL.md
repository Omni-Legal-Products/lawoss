---
name: usporiadaj-spis
description: Bezpečné pomenovanie výslovne vybraných pracovných dokumentov a kópií originálov podľa uloženého pracovného profilu, s náhľadom a schválením presného plánu.
---

# Usporiadaj vybrané dokumenty

Použi prenosné CLI `resources/okf.js` vedľa tohto skillu: `node "<skill>/resources/okf.js" naming …` (alebo Bun). Ak runtime alebo resource chýba, zastav sa a oznám to. Shell `mv`/`cp`, nový správca súborov ani serverová náhrada nie sú povolený fallback.

1. Over presnú cestu vybraného spisu a načítaj jeho uložený `PRACOVNY-PROFIL.md`. Je autoritatívny pre názvy a roly; neskorší kancelársky profil ho nenahrádza. Chýbajúci alebo neplatný snapshot najprv vyrieš s človekom.
2. Vyžiadaj explicitný zoznam súborov a pri každom klasifikáciu `rename-working` (výslovne pracovný dokument) alebo `copy-original-to-drafts` (prijatý originál). Neodvodzuj klasifikáciu z názvu. Originál musí zachovať meno a byte-identický obsah, pracovná kópia patrí do uloženej roly `drafts`. Nevykonávaj rekurzívny scan spisu ani vaultu.
3. Zisti chýbajúce metadáta podľa placeholderov uloženého vzoru. `date` je vždy explicitný platný dátum dokumentu `YYYY-MM-DD` alebo `bez-datumu`. Nikdy neodvodzuj právny dátum z mtime, času prijatia, OCR ani názvu. `version` dodá človek; nikdy automaticky neinkrementuj. Vyžiadaj aj presný zoznam Markdown súborov, v ktorých sa majú preveriť odkazy.
4. Vytvor manifest a plán ako nové lokálne artefakty mimo spisu. Napríklad:

```json
{
  "schema": "lawoss.document-naming.request/v1",
  "operationId": "naming-001",
  "documents": [{
    "id": "doc-001",
    "path": "03_Drafty/pracovny.docx",
    "treatment": "rename-working",
    "destinationRole": "drafts",
    "metadata": {"date": "bez-datumu", "description": "navrh-zmluvy", "version": "01"}
  }],
  "markdownFiles": ["poznamky/odkazy.md"]
}
```

```sh
node "<skill>/resources/okf.js" naming "<spis>" --manifest "<mimo-spisu>/request.json" --out "<mimo-spisu>/plan.json" --json
```

5. Ukáž človeku **presný plán**: fyzický priečinok, operationId a fingerprint, pôvodné/cieľové cesty, klasifikáciu, pôvodné a normalizované metadáta, uložený profil, hashe zdrojov, vybrané Markdown súbory a zmeny odkazov. Výslovne povedz: nevybrané odkazy neboli overené. Plán môže obsahovať citlivé cesty; neposielaj ho mimo lokálneho prostredia. Počkaj na explicitné ľudské schválenie tohto presného plánu pred `--apply`. Všeobecná požiadavka „uprataj spis“ toto schválenie nenahrádza. Ak sa plán zmení, vyžiadaj schválenie nového plánu. Fingerprint je kontrola integrity, nie tajný podpis ani dôkaz súhlasu.
6. Aplikuj iba presný schválený uložený plán:

```sh
node "<skill>/resources/okf.js" naming "<spis>" --plan "<mimo-spisu>/plan.json" --apply --json
```

Pri `conflict` vytvor nový náhľad po vyriešení príčiny; kolíziu nikdy neobchádzaj prepísaním, `--force` ani automatickou verziou. Pri `recovery-required` zachovaj `.lawoss/naming-history/<operationId>/` aj existujúci lock, ak ostal po páde; nevykonávaj automatický retry, mazanie journalu ani ručnú zmenu súborov bez posúdenia a osobitného súhlasu. `already-applied` znamená overený finálny stav tej istej operácie.

Limity: 64 dokumentov, 32 Markdownov, 100 MiB/dokument, 5 MiB/Markdown a 1 GiB vstupných bajtov spolu. CLI odmieta symlinky, hardlinky, neprenosné cesty, systémové/identifikačné súbory a mapované zdroje pamäte. Upravuje len podporované jednoznačné relatívne inline/image/reference/wiki odkazy vo vybraných Markdownoch; dotknutá nepodporovaná syntax (aj zmienky v kóde) vyžaduje ručné posúdenie. Pracovný Markdown nemožno zároveň zaradiť medzi dokumenty na premenovanie a súbory na údržbu odkazov. Nové názvy nesmú prekrývať vybrané zdroje.

Preview nezapisuje do spisu. `--out` je nový súbor mimo spisu, relatívna cesta sa vyhodnocuje voči aktuálnemu pracovnému priečinku procesu. Apply používa lokálny lock, kontrolu revízií a journal so snapshotmi. Ide o ochranu pri spolupracujúcich procesoch, nie o sandbox proti útočníkovi meniacemu adresáre medzi systémovými volaniami. Výsledok pomenovania nedokazuje podpis, odoslanie, doručenie ani právnu správnosť dokumentu.
