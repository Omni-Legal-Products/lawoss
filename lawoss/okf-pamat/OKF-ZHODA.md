# Zhoda s Open Knowledge Format v0.2

Priečinok `memory/` je **bundle podľa [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format)**, vendor-neutrálnej špecifikácie Google Cloud pre agentmi čitateľné znalosti.

Dôvod je praktický: spis potom prečíta ktorýkoľvek nástroj, ktorý OKF pozná — bez nášho SDK, bez servera, bez pluginu. Vrátane referenčného vizualizéra, ktorý z bundle spraví graf v jednom HTML súbore.

> Overené proti [spec v0.2](https://github.com/GoogleCloudPlatform/knowledge-catalog/blob/main/okf/SPEC.md) v plnom znení 2.–3. 9. 2026.

---

## Čo je bundle

**Bundle je `memory/`.** Nie priečinok spisu.

```
Prodej vozidla/           ← spis, nie bundle
├── _STATUS.md            ← ľudské rozhranie, mimo bundle
├── BRAIN.md              ← vstupný bod pre agenta, mimo bundle
└── memory/               ← BUNDLE
    ├── index.md          ← rezervované: navigácia + okf_version
    ├── log.md            ← rezervované: chronológia
    └── S-001-…​.md        ← koncept, povinné pole `type`
```

`_STATUS.md` a `BRAIN.md` sú zámerne **mimo** bundle. Sú to dokumenty pre človeka, nie koncepty — keby ležali vnútri, museli by niesť `type` a stali by sa z nich záznamy pamäte, čím by prestali byť tým, čím sú.

## Mapovanie polí

| OKF | u nás | |
|---|---|---|
| `type` (**povinné**) | `type` | ✅ vrstva sa z neho odvodzuje |
| `title` | `title` | ✅ |
| `description` | `description` | ✅ *(do 3. 9. sa volalo `summary`)* |
| `tags` | `tags` | ✅ |
| `okf_version` v koreňovom `index.md` | `okf_version: "0.2"` | ✅ |
| `sources[]` s `id`, `title`, `resource`, `author`, `last_modified` | `sources[]` | ✅ + atribúcia tvrdenia `[^id]` |
| `verified: [{by, at}]` | `verified[]` | ✅ zoznam; `verified_at`/`verified_against` zostávajú ako naša stopa *proti čomu* |
| `status` | `status` | ≈ iné hodnoty, ten istý zmysel |
| `stale_after` | `valid_until`, `effective_to` | ≈ vecne to isté |

Staré spisy fungujú ďalej: **`summary` sa číta ako `description`**, len sa už nezapisuje.

## Odkazy

Markdown cesty, nie `[[…]]`:

```markdown
* [S-001](./S-001-eva-novakova.md) — subjekt — klientka, predávajúca
```

Wiki-odkaz na holý identifikátor v Obsidiane **nikdy nesadol** — súbor nesie v názve aj slug titulku, takže `[[S-001]]` visel v grafe ako osirelý. Markdown odkaz mieri na skutočný súbor, funguje v Obsidiane aj mimo neho a zhoduje sa s OKF. Cesty sa berú z disku, nie z `slug(title)`: po premenovaní titulku si súbor ponechá pôvodný názov a dopočítaná cesta by mierila vedľa.

## Dve vedomé odchýlky

Spec je pri čítaní zámerne zhovievavá. Dve jej pravidlá **nedodržiavame** a je to rozhodnutie, nie opomenutie.

### 1. Rozbitý odkaz je u nás chyba

> „Consumers MUST tolerate broken links — a link whose target doesn't exist in the bundle is not malformed; it may simply represent knowledge not yet written."

V katalógu dát to sedí. **V spise nie.** Tvrdenie, ktoré sa odvoláva na dôkaz `E-007`, a ten dôkaz v spise nie je, nie je nedopísaná znalosť — je to vada, ktorú protistrana nájde skôr než my. `BROKEN_LINK` preto zostáva **chybou**.

### 2. Neznámy `type` sa nečíta ako koncept

> „Consumers MUST NOT reject a bundle because of… Unknown `type` values."

Vrstva (L1/L2/L3) sa u nás **odvodzuje z typu**. Neznámy typ teda nemá kam patriť a nedá sa preň rozhodnúť, či ho smie agent zapísať sám. Súbor sa preskočí a ohlási ako nečitateľný.

**Bundle sa tým neodmieta** — zvyšok pamäte sa načíta a funguje. Odmieta sa jeden dokument, nie celý priečinok, čo je práve to, čo spec chráni.

## Čo dodržiavame aj tam, kde by sa nám to nehodilo

> „Consumers MUST preserve unknown keys on round-trip and MUST NOT reject documents with unrecognized fields."

Toto sme predtým porušovali a stálo to viac, než sa zdalo. Advokát si v Obsidiane pridal `tags:` — čo je v OKF dokonca odporúčané pole — a **celý záznam vypadol zo store, aj z jehiel detektora únikov**. Pridanie tagu k subjektu teda ticho oslepilo bránu pre toho klienta.

Neznáme kľúče sa odteraz zachovajú a prežijú round-trip. `tags` sa navyše stalo riadnym poľom schémy.

## Pramene a atribúcia tvrdenia

OKF v0.2 vedie provenienciu ako zoznam záznamov a atribúciu **jednotlivého tvrdenia** cez markdownovú poznámku pod čiarou, ktorej návestie je `sources[].id`:

```yaml
sources:
  - id: ns-22-cdo-2886-2023
    title: NS 22 Cdo 2886/2023
    author: Nejvyšší soud
    resource: https://…
    last_modified: 2023-11-14
```
```markdown
Súhlas vlastníka pozemku nie je titulom k stavbe.[^ns-22-cdo-2886-2023]
```

**Pre právnu prax je to najcennejšia vec v celej ich špecifikácii** — presne to robí advokát v každom podaní. Dovtedy `sources` viselo na celom zázname a nedalo sa povedať, ktorá veta stojí na čom.

Spec to odôvodňuje presne tak, ako to potrebujeme: *„Labels are keyed rather than positional because agents constantly rewrite these documents: a positional index misattributes silently."*

### Dve kontroly, ktoré z toho plynú

| Nález | Závažnosť | Prečo |
|---|---|---|
| `CITATION_UNRESOLVED` — `[^id]` v Pravde alebo Histórii bez položky v `sources` | **chyba** | veta vyzerá podložene a nie je. Je to tá istá trieda chýb, kvôli ktorej vznikol zákaz neoverených prameňov. Kontroluje sa na **každom** type záznamu, nie len na prameni. |
| `SOURCE_ID_DUPLICATE` — to isté `id` dvakrát | **chyba** | poznámka by nevedela, na ktorý prameň mieri |

Starý tvar `sources: ["§ 129 o. s. ř."]` sa ďalej **číta** — každý reťazec sa stane prameňom s `title` a bez `id`. Po prvom prepísaní je záznam v novom tvare.

### Parser nie je YAML — a je to zámer

Jadro má nulové závislosti. Namiesto YAML knižnice číta frontmatter vlastný čítač, ktorý rozumie **presne tvarom, ktoré OKF používa**:

```yaml
sources:            verified:            tags:              generated: { by: a, at: b }
  - id: x             - by: a              - klient
    title: y            at: b              - vozidlo
```

Čokoľvek iné — hlbšie vnorenie, zoznam v zozname, zmes skalárov a mapovaní, nerovnaké odsadenie — skončí **chybou s číslom riadku**. Nie preto, že by sa to nedalo prečítať, ale preto, že by sa to mohlo prečítať *nejako*. V právnom dokumente je tichý omyl v citácii horší než odmietnutý súbor; test `hlbsie vnorenie je chyba s cislom riadku` drží presne prípad, keď parser pôvodne `meta:\n  deep: y` potichu zploštil na dve polia.

Cudzie štruktúrované kľúče (napr. OKF `generated`) prežijú round-trip v `extra` bez straty.

## Overenie

```bash
node --test 'tests/okf-konformita.test.ts'
```

Drží povinné aj odporúčané polia, alias `summary`, rezervované názvy, tvar `index.md` a `log.md` a migráciu starého `INDEX.md` — tá má na macOS vlastnú pascu: case-insensitive filesystém vráti `existsSync("INDEX.md")` true aj na práve zapísaný `index.md`, takže sa starý súbor musí mazať **pred** zápisom, nie po ňom.

```bash
node --test 'tests/okf-pramene.test.ts'
```

Drží pramene, atribúciu tvrdenia oboma kontrolami, `verified` ako zoznam, čítanie starého tvaru — a hlasné zlyhanie parsera na cudzí tvar.
