# LAWOSS: slovník prekladu rozhrania

- **Platí pre:** `apps/app/src/i18n/locales/sk.ts` a `cs.ts`
- **Stav:** živý dokument; dopĺňa sa pri každej ďalšej dávke prekladu
- **Prečo:** čeština a slovenčina sú **dva nezávislé preklady z angličtiny**, nie prepis jedného do druhého. Právny pojem sa neprekladá zámenou písmen — `AGENTS.md` to zakazuje, lebo z českého „insolvenčný správca" vznikne pojem, ktorý slovenské právo nepozná.

## 1. Právne názvoslovie

| Angličtina | Čeština (ČR) | Slovenčina (SR) | Poznámka |
|---|---|---|---|
| matter, case file | spis | spis | zhodné |
| deadline | lhůta | lehota | |
| time limit for appeal | lhůta k odvolání | lehota na odvolanie | CZ o. s. ř., SK CSP |
| court | soud | súd | |
| filing, submission | podání | podanie | |
| decision, ruling | rozhodnutí | rozhodnutie | |
| service (of a document) | doručení | doručenie | |
| hearing | jednání | pojednávanie | **nie** „jednanie" |
| power of attorney | plná moc | plnomocenstvo | rozdielny pojem, nie tvar |
| data box / e-mailbox of authority | datová schránka | elektronická schránka | ČR ISDS × SR ÚPVS |
| insolvency administrator | insolvenční správce | správca konkurznej podstaty | rozdielny inštitút |
| bailiff | soudní exekutor | súdny exekútor | |
| register of companies | obchodní rejstřík | obchodný register | ČR OR × SR ORSR |
| identification number | IČO | IČO | zhodné |
| birth number | rodné číslo | rodné číslo | zhodné, obe citlivé |
| claim (in insolvency) | přihláška pohledávky | prihláška pohľadávky | |
| statement of claim | žaloba | žaloba | |
| appeal | odvolání | odvolanie | |
| attorney, lawyer | advokát | advokát | zhodné |
| bar association | Česká advokátní komora (ČAK) | Slovenská advokátska komora (SAK) | nikdy nezamieňať |

## 2. Produktové pojmy — neprekladajú sa

`Skills` · `Plugins` · `Commands` · `Sessions` · `Workflows` · `Fusion` · `MCP` · `OpenCode` · `OpenPackage` · `LegalWork` · `Word` · `Excel` · `PowerPoint` · `worker` · `sidecar` · `engine` · názvy poskytovateľov a modelov · názvy súborov, príkazov a premenných prostredia.

`LegalWork` sa v reťazcoch nechať smie: pri výdaji ho `applyBrandName()` v `apps/app/src/i18n/index.ts` nahradí za `LAWOSS`, okrem kľúčov, kde ide o cudzí produkt alebo jeho autora.

## 3. Tvar reťazcov

- **Zástupné symboly** `{name}`, `{count}`, `{app}` musia byť v preklade v tej istej množine ako v angličtine. Stráži to `apps/app/tests/i18n-parity.test.ts`.
- **Množné číslo:** čeština a slovenčina majú oproti angličtine navyše tvary `_few` (2–4) a `_many`. `_other` je tvar pre 5 a viac („modelů", „modelov"), `_few` pre dva až štyri („modely"). Bez `_few` vypadne pre dvojku tvar pre päť.
- **Tlačidlá** majú tvar originálu: `Save` → „Uložit" / „Uložiť", nie „Uloženie".
- **Vykanie** všade, aj v chybových hláškach.
- **Reťazec, ktorý je len kód alebo názov** (`OK`, `PDF`, `JSON`), ostáva.

## 4. Nástroje

```bash
bun apps/app/scripts/lawoss-i18n-missing.ts sk            # čo v slovenčine chýba
bun apps/app/scripts/lawoss-i18n-missing.ts cs settings   # len menný priestor settings
cd apps/app && bun test tests/i18n-parity.test.ts         # kľúče a zástupné symboly sedia
cd apps/app && bun scripts/i18n-check.ts                  # kontrola upstreamu
node scripts/i18n-audit.mjs --ci                          # CI audit (tvar `} as const;`)
```
