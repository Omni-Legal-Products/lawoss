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
| `sources` | `sources` ako zoznam reťazcov | ⚠️ viď nižšie |
| `verified: [{by, at}]` | `verified_at`, `verified_against` | ⚠️ viď nižšie |
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

## Čo ešte nemáme

### `sources[]` so stabilnými identifikátormi ⭐

OKF v0.2 má provenienciu ako zoznam záznamov a atribúciu **jednotlivého tvrdenia** cez markdownovú poznámku pod čiarou:

```yaml
sources:
  - id: ns-22-cdo-2886-2023
    title: NS 22 Cdo 2886/2023
    author: Nejvyšší soud
```
```markdown
Súhlas vlastníka pozemku nie je titulom k stavbe.[^ns-22-cdo-2886-2023]
```

**Pre právnu prax je to najcennejšia vec v celej ich špecifikácii** — presne to robí advokát v každom podaní. Naše `sources` visí na celom zázname, takže sa nedá povedať, ktorá veta stojí na čom. Je to zároveň priama obrana proti vymysleným prameňom.

**Prečo to tu ešte nie je:** náš čítač frontmatteru je riadkový (`kľúč: hodnota`) a zoznam mapovaní vyžaduje skutočný YAML. Pridať závislosť by porušilo pravidlo nulových závislostí; napísať vlastný mini-parser znamená riskovať tiché preparsovanie citácie, čo je v právnom dokumente to najhoršie, čo sa môže stať. **Je to rozhodnutie pre tím, nie vec, ktorú treba potichu dopísať** — [coord#69](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/69), bod 2.

### `verified` ako zoznam

Máme jedno overenie (`verified_at`). Prameň sa pritom overuje opakovane, po každej novele — zoznam je vecne správnejší. Malá, spätne kompatibilná zmena; čaká na to isté rozhodnutie.

## Overenie

```bash
node --test 'tests/okf-konformita.test.ts'
```

Drží povinné aj odporúčané polia, alias `summary`, rezervované názvy, tvar `index.md` a `log.md` — a migráciu starého `INDEX.md`, ktorá má na macOS vlastnú pascu (case-insensitive filesystém: `existsSync("INDEX.md")` vráti true aj na práve zapísaný `index.md`, takže sa starý súbor musí mazať **pred** zápisom, nie po ňom).
