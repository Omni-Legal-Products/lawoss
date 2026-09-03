# OKF pamäťové jadro (`@lawoss/okf-pamat`)

Pamäť spisu, ktorú vie čítať aj zapisovať agent, a ktorú zároveň otvorí
a upraví advokát. Žiadna databáza, žiadny index, žiadne embeddingy —
markdown v spise, presne tam, kde spis leží.

Implementuje pamäťovú časť [spec 0002 — OKF](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/specs/0002-okf-operacny-system-praxe.md).
Štruktúru spisu (profily A/B/C, karty, retrofit) **nezakladá ani nemení** —
to zostáva skillu `novy-spis`. Toto jadro vlastní iba pamäť.

## Tri vrstvy

| Vrstva | Typy záznamov | Kto smie zapísať |
|---|---|---|
| **L1** kancelária | `rule` (pravidlo), `lesson` (poučenie) | iba človek |
| **L2** spis | `matter`, `decision`, `subject`, `question`, `screening`, `claim`, `evidence`, `task` | agent sám |
| **L3** právo | `authority` (prameň) | iba človek |

`lesson` je samostatný typ, nie podtyp poznámky: to, čo sa model naučil zle,
je iná kategória než obsah spisu a maže sa inak.

## Dôkazná vrstva — `claim` a `evidence`

`claim` (tvrdenie) nesie, **kto čo tvrdí a či je to preukázané**; `evidence` (dôkaz)
nesie listinu alebo iný dôkazný prostriedok a to, čo má preukazovať. Väzba je
**obojsmerná** a validátor ju stráži: jednosmerne vedená väzba sa po pár mesiacoch
rozíde a matica potom ukáže dôkaz, ktorý k tvrdeniu nevedie.

```
C-001  tvrzení   „Pohledávka P42 je zjištěná"   supporting_evidence: ["E-001"]
E-001  důkaz     Protokol B-148                 proves: ["C-001"]
```

Druh dôkazu je kanonická hodnota, **právne ukotvenie je jurisdikčné**:

| `evidence_kind` | 🇨🇿 ustanovenie |
|---|---|
| `document` | § 129 zák. č. 99/1963 Sb. |
| `witness` | § 126 |
| `expert_opinion` | § 127 (§ 127a pri posudku predloženom účastníkom) |
| `inspection` | § 130 |
| `party_examination` | § 131 |

> [!WARNING]
> **Dve rozšírené nepresnosti, overené 2. 9. 2026 v plnom znení.** § 125 **nie je**
> listina — je to demonštratívny výpočet dôkazných prostriedkov („zejména… a jiné
> listiny"). Listinu upravuje **§ 129**, ohliadku **§ 130** (nie § 129).
>
> Slovenské ukotvenie zámerne chýba: Civilný sporový poriadok nebol overený
> a domýšľať ho by bolo tiché prekladanie právnych pojmov.

### Matica tvrdenie × dôkaz

Blok `evidence_matrix` premietne dôkaznú vrstvu do `_STATUS.md`. Je **marker-only** —
renderuje sa iba tam, kde si ho advokát vyžiadal.

```
| Tvrzení | E-001 | E-002 | E-003 | Stav |
|---|---|---|---|---|
| C-001 | ✓✓ | – | – | prokázáno |
| C-002 | – | ✓✓ | ~ | prokázáno |

_✓✓ přímý a spolehlivý · ✓ podpůrný · ~ nepřímý · ✗ vyvrací · – nesouvisí_

**Důkazní břemeno**

| Tvrzení | Břemeno nese | Stav | Věrohodnost |
|---|---|---|---|
| C-001 | S-002 | prokázáno | vysoká |
```

Značka v bunke je **zobrazenie dvoch zapísaných hodnôt** (`evidence_strength`
a `reliability`), nie právny záver.

> [!IMPORTANT]
> **`proof_status` nástroj neodvodzuje.** Je to hodnota, ktorú zapisuje advokát;
> tvrdenie s tromi podpornými dôkazmi môže byť „neprokázáno" a matica to takto
> ukáže. „Tri dôkazy = preukázané" je právna domnienka, nie výpočet — a test to
> stráži, aby to niekto v budúcnosti neoptimalizoval.

## AML evidencia

`subject` nesie identifikačné údaje podľa **§ 5 ods. 1 zák. č. 253/2008 Sb.** (CZ) a **§ 7 ods. 1 zák. č. 297/2008 Z. z.** (SK) — rodné číslo,
miesto narodenia, pohlavie, občianstvo, trvalý pobyt, doklad totožnosti; pri právnickej
osobe právnu formu, sídlo, zápis v registri, konajúce osoby a skutočného majiteľa.

`screening` (CZ `provereni`, SK `preverenie`) je **úkon v čase, nie vlastnosť osoby**:
dátum, režim `light`/`medium`/`hard`, prehľadané registre, výsledok PEP a sankcií,
pôvod prostriedkov, riziková kategória, záver a platnosť. Každé preverenie je vlastný
záznam — archivovateľný 10 rokov podľa § 16 a opakovateľný podľa § 9.

### Kde to leží

Identifikácia sa robí raz pri vzniku obchodného vzťahu, nie pri každej kauze. Preto
`subject` a `screening` žijú v **zložke klienta** a spis na ne odkazuje `[[S-001]]`.
`readScope()` prečíta oboje naraz; zložku klienta hľadá podľa `client.md` (aj legacy `klient.md`) až štyri
úrovne nad spisom, takže MČ profil A (klient → oblasť → spis) sedí.

### Citlivé údaje

Rodné číslo, číslo dokladu, trvalý pobyt a dátum narodenia sú v tabuľke označené
`sensitive`. To má dva dôsledky, oba automatické:

1. **Maskujú sa** vo výstupoch pre človeka — `750101/••••`, `12•••••••`. Nikdy sa
   nemaskuje uložený súbor; záznam je dôkazný materiál a musí zostať úplný.
2. **Sú jehlami detektora úniku.** Nové citlivé pole je tým pádom strážené hneď,
   ako sa pridá do tabuľky — nedá sa pridať údaj a zabudnúť rozšíriť bránu.

> [!WARNING]
> Maskovanie nie je bezpečnostné opatrenie. Kto má prístup k adresáru spisu, má
> prístup k plným údajom. Šifrovanie úložiska je samostatná vec, ktorú toto nerieši.

### Kontroly

| Kód | Kedy | Nález |
|---|---|---|
| `SENSITIVE_IN_SUMMARY` | rodné číslo alebo iný citlivý údaj v `popis`, ktorý ide do `index.md` a projekcie | **chyba** |
| `UNKNOWN_VALUE` | hodnota mimo výpočet (`role`, `person_type`, `mode`, `state`, druh udalosti…) — kontroly viazané na pole sa nevykonajú | varovanie |
| `DEADLINE_PASSED` | lehota v `deadlines` je v minulosti a záznam je stále `active` | varovanie |
| `CITATION_UNRESOLVED` | `[^id]` v texte bez položky v `sources` — veta vyzerá podložene a nie je | **chyba** |
| `SOURCE_ID_DUPLICATE` | to isté `id` prameňa dvakrát | **chyba** |
| `AML_MISSING` | subjekt v role `klient` nemá žiadne preverenie | varovanie |
| `AML_EXPIRED` | `platnost_do` preverenia je v minulosti (§ 9) | varovanie |
| `AML_INCOMPLETE` | FO, PO alebo podnikateľ nemá kompletnú sadu podľa predpisu svojej jurisdikcie | varovanie |
| `AML_RULESET_UNVERIFIED` | jurisdikcia nemá overenú povinnú sadu | varovanie |
| `PARSE` | súbor sa nedá prečítať — vypíše sa a preskočí, zvyšok spisu sa načíta | **chyba** |

### Dve jurisdikcie, dve sady — a naozaj sa líšia

Overené proti doslovnému zneniu 31. 8. 2026: CZ z [§ 5 zák. č. 253/2008 Sb.](https://krajta.slv.cz/2008/253/par_5),
SK z [§ 7 zák. č. 297/2008 Z. z.](https://www.slov-lex.sk/ezbierky/pravne-predpisy/SK/ZZ/2008/297/) (znenie k 17. 8. 2026).

| Údaj o fyzickej osobe | 🇨🇿 § 5 | 🇸🇰 § 7 |
|---|---|---|
| miesto narodenia | **áno** | nie |
| pohlavie | len ak **nebolo pridelené rodné číslo** | nie |
| orgán, ktorý doklad vydal, a platnosť dokladu | **áno** | nie |
| označenie registra a číslo zápisu u právnickej osoby | nie | **áno** |
| adresa skutočného miesta výkonu činnosti | nie | **áno, ak je odlišná** |

Preto dve sady, nie jedna preložená. Ten istý záznam prejde slovenskou kontrolou
a v českej mu chýbajú tri polia — a naopak. Rodné číslo má v oboch predpisoch
náhradu, ale rôznu: CZ „datum narození **a pohlaví**", SK len dátum narodenia.

> [!NOTE]
> `AML_REQUIRED` v `src/schema.ts` vynucuje **zákonné minimum**, nie kancelárske zvyklosti.
> Identifikačný formulár kancelárie môže žiadať viac (napr. rodné priezvisko) — také polia
> zostávajú voliteľné. Jurisdikcia bez overenej sady sa nekontroluje českými pravidlami;
> validátor to ohlási ako `AML_RULESET_UNVERIFIED`.

Jadro **preverenie nevykonáva** — nesie jeho výsledok a stráži lehotu. Volanie registrov,
PEP a sankcií patrí skillom a MCP konektorom; miešať to sem by z pamäte spravilo sieťový nástroj.

## Tvar záznamu

Jeden kanonický tvar pre obe jurisdikcie — **jadro stojí na anglických kľúčoch**.

```markdown
---
okf: 1
id: D-001
type: decision
title: Nenapadat mistni prislusnost
description: Zdrzeni prevazuje nad vyhodou zmeny soudu
layer: L2
jurisdiction: cz
status: active
created: 2026-09-01
updated: 2026-09-01
deadlines: ["2026-09-12"]
---

## Truth

Miestnu príslušnosť nenapádame.

## History

- 2026-09-01 — rozhodnuté po porade s klientom
```

**Truth** je aktuálny overený stav a prepisuje sa. **History** je append-only.

### Prečo anglicky

Perzistencia je anglická, **rozhranie lokalizované**. Dôsledky:

- **Nová krajina je nový locale, nie tretia kolónka schémy a migrácia dát.** Pri lokalizovanej perzistencii by Poľsko znamenalo tretiu sadu kľúčov, tretie nadpisy, tretí názov priečinka a testovú maticu 3×.
- **Spis prenesený medzi jurisdikciami sa neprepisuje.** Česká pobočka otvorí slovenský spis a číta ho; český a slovenský záznam môžu ležať v jednom priečinku.
- **Jurisdikcia je hodnota poľa, nie názov adresára** — jeden `memory/` namiesto `pamet/` × `pamat/`.

Stĺpce `cz` a `sk` v `src/schema.ts` **zostávajú**, ale prestali byť kľúčmi — sú z nich
popisky pre človeka. Používa ich validátor v hláškach („chýba: místo narození") a appka
pri zobrazení. Renderované tabuľky v `_STATUS.md` aj hlášky CLI zostávajú v jazyku
používateľa; markery sú kanonické.

> [!NOTE]
> Kde sa právo medzi jurisdikciami naozaj líši, riešením **nie je jeden kľúč s dvomi
> prekladmi, ale dve kanonické polia s odlišným významom.** Preklad rieši jazyk,
> nie rozdiel v práve — preto sú AML povinné sady CZ a SK dve, nie jedna preložená.

## Štyri brány, ktoré nie sú v prompte

1. **Atomicita pravdy** — zápis, ktorý zmení `## Pravda` a nepridá riadok do
   `## Historie`, je odmietnutý. Zmena pravdy bez stopy je nemožná.
2. **Append-only história** — stará história musí byť doslovnou predponou novej.
   Prepísať ani skrátiť sa nedá.
3. **Human gate** — do L1, do L3 a pri mazaní kdekoľvek zapíše iba človek.
   Agent dostane `WriteDiff` a `authorize()` mu bez schválenia zápis odmietne.
   Schválenie musí niesť meno a **platný časový údaj** a zapíše sa do append-only
   histórie záznamu — kto ho vydal, zostane trvalo viditeľné. Je to hranica
   **procesná, nie kryptografická**: knižnica nevie rozlíšiť, kto ju volá, ale
   podpis sa nedá zmazať. Zápisy preto veď cez `okf-memory write`, nie cez API.
4. **Zákaz úniku L2 → L3** — právny prameň nesmie obsahovať identifikátor
   klienta zo subjektov spisu. Hľadá sa aj v histórii záznamu, bez ohľadu na
   diakritiku a veľkosť písmen, a **podľa sily zhody** — falošný poplach
   a únik nemajú rovnakú cenu:

   | Sila | Čo to je | Nález |
   |---|---|---|
   | `hard` | IČO (aj písané „291 396 43"), dátum narodenia (ISO aj `11. 4. 1975`) | **chyba** — blokuje |
   | `strong` | celé meno alebo obchodná firma, aj bez právnej formy | **chyba** — blokuje |
   | `weak` | samotné krátke priezvisko | varovanie na revíziu, neblokuje |

   Zhoda musí sedieť na hranicu slova — „Rada" nechytí „porada". Meno kratšie
   než 4 znaky sa nehľadá vôbec, takže „Lex s.r.o." nespustí poplach nad
   slovom „lexikón". Prahy sú v `src/validate.ts` pomenované konštantami —
   sú to vedomé rozhodnutia, nie technické detaily.

Zápis vedie výhradne cez `planWrite() → applyRecordWrite()`. Iná cesta na disk nie je.

### Zhoda s Open Knowledge Format

Priečinok `memory/` je **bundle podľa [Open Knowledge Format](https://github.com/GoogleCloudPlatform/open-knowledge-format) v0.2** — vendor-neutrálnej
špecifikácie Google Cloud pre agentmi čitateľné znalosti. Znamená to, že spis
prečíta ktorýkoľvek nástroj, ktorý OKF pozná, bez nášho SDK.

- `index.md` a `log.md` sú **rezervované názvy** (malými písmenami); všetko
  ostatné v bundle je koncept s povinným poľom `type`
- koreňový `index.md` nesie `okf_version`
- odkazy sú **markdown cesty**, nie `[[…]]`
- neznáme kľúče vo frontmatteri sa **zachovajú**, dokument sa neodmieta
- `sources[]` so stabilným `id` a **atribúcia tvrdenia** poznámkou `[^id]`;
  `verified[]` ako zoznam overení

Dve odchýlky sú vedomé a sú v [`OKF-ZHODA.md`](OKF-ZHODA.md) aj s dôvodmi:
rozbitý odkaz a neznámy `type` u nás nie sú tolerované, lebo v spise nejde
o „nedopísanú znalosť", ale o vadu.

### Napojenie na existujúci Obsidian vault

Pamäť je markdown v priečinku spisu, vault je priečinok markdownu — napojenie
je preto konfigurácia, nie most. Stačí `_kancelaria/memory/` v koreni vaultu
a jeden riadok `client_path: AK/*/*` v `okf.config`; karty `klient.md` sa doň
nesypú. `[[wiki-odkazy]]` v projekcii fungujú natívne a graf ukáže pamäť spisu.

Overené na vaulte s 88 908 súbormi. Podrobne: [`OBSIDIAN-VAULT.md`](OBSIDIAN-VAULT.md).

### Keď sa zo zápisu má stať agentná práca

Human gate sa dá **udeliť vopred** namiesto klikania pri každom zázname:
advokát napíše do `_kancelaria/okf.config` trvalé poverenie s menom, rozsahom,
dôvodom a dátumom konca. Zápisy do jeho `scope` potom prejdú bez `--approve-as`
a v histórii záznamu sa objaví, že ich kryje poverenie a do kedy platí.

Poverenie **nevypína** mazanie, zákaz úniku do L3 ani atomicitu pravdy —
schvaľuje zápis, nič iné. Podrobne: [`AGENTNI-ZAPISY.md`](AGENTNI-ZAPISY.md).

## Čo jadro zapisuje do spisu

```
_kancelaria/
└── memory/          ← L1 pravidlá a poučenia + L3 právne pramene

klient/
├── client.md
├── memory/          ← subjekty a AML preverenia
└── <oblasť>/spis/
    ├── spis.md      ← karta veci (novy-spis) — iba čítame
├── _STATUS.md       ← ľudské rozhranie; prepisujeme LEN medzi markermi
├── BRAIN.md         ← vstupný bod pre agentov (nikdy neprepíšeme existujúci)
    ├── _STATUS.md   ← ľudské rozhranie; prepisujeme LEN medzi markermi
    ├── BRAIN.md     ← vstupný bod pre agentov
    └── memory/      ← obsah veci (L2)
        ├── index.md ← generovaný register
        └── D-001-*.md
```

V `_STATUS.md` sa prepisuje výlučne obsah medzi `<!-- okf:render:*:start -->`
a `<!-- okf:render:*:end -->`. Fáza, Ďalší krok a vlastné sekcie advokáta
prechádzajú nedotknuté. Opakované spustenie nič nezmení.

Markery nesú kanonické názvy (`deadlines`, `timeline`, `records`), takže spis,
ktorý zmení jazyk, si projekciu neroztrhá.

## CLI

Bez `--apply` je každý príkaz iba náhľad.

```bash
node bin/okf-memory.ts read     <spis>
node bin/okf-memory.ts aml      <spis>            # subjekty a stav preverenia
node bin/okf-memory.ts validate <spis>            # exit 1 pri chybe
node bin/okf-memory.ts sync     <spis> [--apply]  # projekcia do _STATUS.md a index.md
node bin/okf-memory.ts init     <spis> [--sk] [--apply]

# Zápis záznamu — jediná zápisová hranica pre agenta
node bin/okf-memory.ts write <spis> --file navrh.md --reason "…" [--apply] [--approve-as "meno"]
```

## Vývoj

Balíček je **bez runtime závislostí** a nie je súčasťou pnpm workspace —
inštaluje sa samostatne, aby fork nepribral ďalší uzol do upstream stromu.

```bash
pnpm install --ignore-workspace
pnpm test        # node --test, 318 testov
pnpm typecheck
```

Beží na Node 24+ (natívne spúšťanie TypeScriptu, žiadny build krok).
