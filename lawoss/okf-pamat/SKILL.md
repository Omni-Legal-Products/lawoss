---
name: okf-pamat
description: Use when reading or writing case memory in an OKF matter folder (spis) — recording facts, decisions, deadlines, subjects, lessons or legal authorities, and projecting them into _STATUS.md. Triggers (SK) — "zapíš do pamäte", "čo vieme o spise", "aktualizuj _STATUS", "skontroluj pamäť spisu", "povýš poznatok"; (CZ) — "zapiš do paměti", "co víme o spisu", "aktualizuj _STATUS", "zkontroluj paměť spisu", "povyš poznatek"; (EN) — "matter memory", "case memory", "record decision".
---

# okf-pamat — pamäť spisu

## Kde je CLI

V aplikácii LAWOSS je skill nainštalovaný do `.opencode/skills/okf-pamat/` aj s CLI
`resources/okf-memory.js` (jeden súbor, bez závislostí). Všade, kde je nižšie
`okf-memory …`, spúšťaj:
```
node "<cesta k tomuto skillu>/resources/okf-memory.js" <príkaz> …
```
Kancelária je priečinok `Office/` s `okf.config` (trvalé poverenie advokáta);
`AK/<písmeno>/<klient>/Spisy/<vec>` je predvolený profil. Klienta určuje karta
`client.md` / `klient.md` v nadradenom priečinku alebo `client_path` v konfigurácii.
Skill aj CLI fungujú nad obyčajnými Markdown súbormi bez LAWOSS aj bez Obsidianu. Návrh
záznamu (`--file`) píš mimo spis (napr. do `/tmp`) alebo ho po zápise zmaž — do
spisu patrí iba to, čo prešlo bránou. Ak `node` nie je k dispozícii, **zastav sa
a povedz to**.

## Vstup do spisu (vždy v tomto poradí)

1. `BRAIN.md` — protokol pamäte tohto spisu
2. `_STATUS.md` — **Fáza** a **Ďalší krok** hore
3. `okf-memory read <spis>` — plný obsah záznamov všetkých typov v rozsahu veci, klienta a kancelárie; obsahuje aj `VSTUPY.md`, ak existuje
4. `VSTUPY.md` — nespracované riadky `pending`, zdroje a odkazy na výsledné záznamy
5. `memory/index.md` — pomocná mapa; originálne dokumenty otváraj podľa úlohy a zdrojových odkazov

Typ ani opis záznamu nerozhoduje o tom, či jeho obsah môže obsahovať dôležitý
pokyn alebo termín. Pri odovzdaní kontextu nepouži iba index či `_STATUS.md`.
Citáciu do výstupu overuj proti originálu dokumentu. Výstup `read` maskuje len
vybrané štruktúrované polia; voľný text môže obsahovať citlivé údaje.

`read` a `aml` vrátia pri neúplnom čítaní kód **1** a vypíšu dostupný obsah aj
problémy. Nevykladaj čiastočný výstup ako „nič ďalšie neexistuje“. `sync` pri
nečitateľnej pamäti alebo duplicitnom ID v rozsahu odmietne prepísanie projekcií.
Uveď konkrétny problém, oprav príčinu a zopakuj čítanie a validáciu; neodstraňuj
zdrojový záznam len preto, aby kontrola prešla.

## Kam čo patrí

| Čo sa objavilo | Typ záznamu | Vrstva |
|---|---|---|
| stav veci, fakty, chronológia | `matter` (spis) | L2 |
| taktické rozhodnutie („takto áno / takto nie") | `decision` | L2 |
| strana, protistrana, overený subjekt | `subject` | L2 |
| otvorená otázka bez odpovede | `question` | L2 |
| kto čo tvrdí a či je to preukázané | `claim` | L2 |
| listina alebo iný dôkazný prostriedok | `evidence` | L2 |
| úloha so záväzkom a termínom | `task` | L2 |
| identifikácia klienta alebo protistrany (§ 8) | `subject` | L2, **u klienta** |
| AML preverenie k dátumu | `screening` | L2, **u klienta** |
| pracovné pravidlo, preferencia kancelárie | `rule` | **L1** |
| poučenie z chyby, čo nabudúce inak | `lesson` | **L1** |
| judikát, ustanovenie, argumentačný vzor | `authority` | **L3** |

## Povinné polia záznamu

Každý záznam je markdown s YAML hlavičkou a dvoma sekciami `## Truth` a `## History`.
Bez ktoréhokoľvek z týchto **desiatich** polí CLI návrh odmietne (vypíše všetky chýbajúce naraz):

| Pole | Hodnota |
|---|---|
| `okf` | `1` |
| `id` | `S-001`, `M-001`, `D-001`, `T-001`, `Q-001`, `SC-001`, `C-001`, `E-001`, `R-001`, `L-001`, `A-001` — prefix podľa typu, číslo trojmiestne |
| `type` | `subject` · `matter` · `decision` · `task` · `question` · `screening` · `claim` · `evidence` · `rule` · `lesson` · `authority` |
| `title`, `description` | jedna veta; opis bez citlivých údajov |
| `layer` | `L2` (spis) · `L1` (`rule`, `lesson`) · `L3` (`authority`) — určuje ho typ |
| `jurisdiction` | `cz` alebo `sk` — nikdy predvolene |
| `status` | `active` · `superseded` · `void` |
| `created`, `updated` | ISO dátum; pri zmene obsahu vrátane metadát aktualizuj `updated`, nikdy ho neposúvaj späť. Opakovaný zápis v dnešný deň môže ponechať dnešný dátum. |

Najmenší platný záznam (spis, CZ):

```markdown
---
okf: 1
id: T-001
type: task
title: Stáhnout poslední dokument z ISIR
description: Oddíl B, událost z 2026-09-11.
layer: L2
jurisdiction: cz
status: active
created: 2026-09-11
updated: 2026-09-11
state: pending
assignee: VŘ
deadlines: ["2026-09-25"]
---

## Truth

Nezahájeno.

## History

- 2026-09-11 — Úkol založen.
```

Polia podľa typu (hodnoty z výpočtu, inak `UNKNOWN_VALUE`): `subject` → `role` (`client`, `counterparty`, `representative`, `ubo`), `person_type` (`natural_person`, `legal_person`, `sole_trader`), `registry_id` alebo `birth_number`, `registered_office`/`residence`; `matter` → `matter_ref`, `court`, `area`, `parties`; `decision` → `procedural_status` (`proposed`, `taken`), `deadlines`; `task` → `state` (`pending`, `in_progress`, `blocked`, `done`), `assignee`, `deadlines`; `question` → `legal_question`, `proof_status`; `screening` → `subject_ref`, `check_date`, `mode` (`light`, `medium`, `hard`), `risk`, `conclusion`, `valid_until`; `claim` → `claimed_by`, `proof_status`; `evidence` → `evidence_kind` (`document`, `witness`, `expert_opinion`, `party_examination`, `inspection`), `origin_date`, `sources`; `authority` → `sources` s `id` a `[^id]` v pravde, `verified`.

Druhy udalostí v `## History` (`- 2026-09-11 [decision] — …`): `delivery` · `filing` · `hearing` · `decision` · `request` · `call` · `email`. Staré slovenské hodnoty (`rozhodnutie`, `podanie`, …) sa pri čítaní prevedú, do súboru sa už píšu anglicky.

## Zápis

```bash
# Náhľad — vypíše diff a nič nezapíše
okf-memory write <spis> --file navrh.md --reason "prečo sa to mení"

# Nový záznam L2 — agent smie sám
okf-memory write <spis> --file navrh.md --reason "…" --apply

# Úprava existujúceho záznamu — revízia zachytená pred prípravou návrhu
okf-memory write <spis> --file navrh.md --reason "…" --if-revision <sha256> --apply

# Zápis do L1, L3 alebo mazanie — meno zadáva človek
okf-memory write <spis> --file navrh.md --reason "…" --apply --approve-as "JUDr. …"
```

> [!IMPORTANT]
> **`Approval` si nikdy nekonštruuj sám.** Meno v `--approve-as` zadáva do príkazu
> **človek**. Agent, ktorý si napíše `{ by: "agent" }`, bránu síce technicky prejde —
> knižnica nevie rozlíšiť, kto ju volá. CLI zaznamená schválenie do histórie.
> Zápisová cesta chráni jej existujúce riadky, priamy editor súborov však môže
> ochranu obísť. Záznam mena nie je autentifikácia ani kryptografický podpis.

Knižničné API (`planWrite` → `applyRecordWrite`) používaj iba na **čítanie diffu
a prípravu návrhu**. Vlastný zápis nechaj CLI.

**Pravidlá, ktoré nástroj vynucuje — neobchádzaj ich, zlyhá to:**

- Meníš `## Truth` alebo vecné pole (`deadlines`, `due`, stav, zdroje, overenie…)?
  Pridaj v tom istom zápise riadok do `## History`, aktualizuj `updated` a skontroluj celý diff.
- Históriu neprepisuj ani neskracuj. Iba pripájaj.
- Zápis do **L1** alebo **L3** potrebuje platné schválenie alebo existujúce trvalé
  poverenie, ktoré ho pokrýva. **Mazanie** potrebuje výslovné schválenie človeka.
  Trvalé poverenie neoprávňuje agenta potvrdiť obsah ani lehotu ako overenú človekom.
- **AML údaje patria k `klient.md`, nie do spisu.** Identifikácia sa robí raz pri vzniku
  obchodného vzťahu a archivuje 10 rokov od jeho skončenia (§ 16), nie od skončenia kauzy.
  Spis na subjekt odkazuje `[[S-001]]`; `readScope()` obe úrovne prečíta naraz.
- **Kľúče záznamu sú anglické** (`type`, `title`, `deadlines`, `## Truth`) pre obe
  jurisdikcie. Lokalizovaný je až výstup — `_STATUS.md`, hlášky, appka.
- **Povinná sada sa líši podľa jurisdikcie a neprekladá sa.** CZ (§ 5 z. 253/2008 Sb.) žiada
  miesto narodenia, vydavateľa dokladu a jeho platnosť; SK (§ 7 z. 297/2008 Z. z.) nie, zato
  žiada zápis v registri u PO. Nedopĺňaj údaj len preto, že ho žiada druhá jurisdikcia.
- **Rodné číslo ani číslo dokladu nikdy nepíš do `popis`** — popis sa renderuje do `index.md`
  a do `_STATUS.md`. Patria do poľa frontmatteru, kde sa maskujú vo výpisoch.
- Preverenie **nevykonávaj v tomto skille** — použi AML skill a MCP konektory, sem zapíš len
  výsledok ako `screening` so zdrojmi, rizikom a `platnost_do`.
- **Väzbu tvrdenie ↔ dôkaz veď z oboch strán.** Zapíšeš `supporting_evidence` do
  tvrdenia, zapíš aj `proves` do dôkazu — inak to validátor ohlási ako `LINK_ASYMMETRY`.
- **`due` na úlohe nie je procesná lehota.** Lehota patrí do `deadlines`; zmeškaný
  interný termín sa dá dohnať, zmeškaná lehota nie. Nemiešaj ich.
- **`proof_status` neodvodzuj z počtu dôkazov.** Je to hodnota, ktorú zapisuje advokát;
  „tri dôkazy = preukázané" je právna domnienka, nie výpočet.
- **Sporná udalosť je tvrdenie**, nie záznam typu udalosť. Nesporné udalosti nesie
  `## History`; keď sa udalosť stane spornou, založ `claim` a naviaž dôkazy.
- Do `authority` nikdy nedávaj meno klienta, IČO ani dátum narodenia zo spisu.
  Validátor to zachytí aj bez diakritiky a v inom formáte dátumu. Ak vráti
  `L3_LEAK_SUSPECT` (varovanie), je to krátke meno a rozhoduje človek —
  neprepisuj prameň sám, ukáž nález advokátovi.

## Konflikt zápisu

Pred úpravou spusti `read`, uchovaj riadok `Revision <ID>: <sha256>` a načítaj
pôvodný zdrojový súbor; návrh nepripravuj z maskovaného výpisu. Zachovaj
históriu. Každá úprava existujúceho záznamu, aj náhľad, vyžaduje
`--if-revision <sha256>` s touto pôvodnou revíziou. Vytvorenie nového záznamu ju
nevyžaduje. Hash pokrýva celý kanonický obsah vrátane metadát a histórie,
vynecháva odvodené `truth_digest`.

CLI odmietne nezhodu aj v ten istý deň; jadro pod zámkom opäť porovná pôvodný
obsah pred samotným zápisom. Pri konflikte načítaj nový stav, zosúlaď vecné
zmeny a priprav nový návrh aj diff. **Nevymeň iba token pri starom návrhu.**
Rovnaký deň `updated` nie je dôkazom rovnakej revízie. CLI nemá príkaz na
mazanie; knižničný delete diff podlieha rovnakému porovnaniu pôvodného obsahu
aj výslovnému schváleniu človeka.

## Overenie a potvrdenie konkrétnej lehoty

Chýbajúce `generated`, samotné `verified`, meno overovateľa, zdroj ani úspešná
validácia neznamenajú ľudské potvrdenie. V `verified` rozlišuj `type: machine`
a `type: human`; druhé zapíš iba podľa skutočného ľudského overenia.

Kokpit považuje konkrétny dátum z `deadlines` za potvrdený, len ak jedno overenie
nesie všetky tieto údaje:

```yaml
verified:
  - type: human
    by: JUDr. Príklad
    at: 2026-09-20T10:00:00Z
    deadline: 2026-09-30
    truth: "Presný aktuálny text sekcie Truth."
```

`by` musí byť neprázdne, `at` platný ISO dátum alebo čas a jeho deň nesmie byť
starší než deň `updated`. `deadline` sa musí rovnať danému termínu a `truth`
presne aktuálnemu textu Truth po parsovaní záznamu. Jeden potvrdený termín
nepotvrdzuje ďalšie dátumy v zozname. Po zmene Truth alebo termínu ponechaj
predchádzajúce overenie ako históriu a nové potvrdenie si nevymýšľaj. Staršie
záznamy bez týchto polí zostávajú čitateľné; ich lehoty sú nepotvrdené. Tieto
polia evidujú tvrdenie o overení, neoverujú totožnosť človeka.

## Pred ukončením práce v spise

- [ ] Všetko podstatné z konverzácie je v pamäti? (prejdi ju spätne)
- [ ] Každá vecná zmena má dôvod, nový riadok History a aktuálne `updated`
- [ ] `okf-memory validate <spis>` → bez chýb
- [ ] `okf-memory read <spis>` → úplný kontext, vypísané prípadné chyby a nespracované vstupy
- [ ] pri AML evidencii `okf-memory aml <spis>` → skontrolované nálezy a stav evidencie; výpis nenahrádza preverenie
- [ ] `okf-memory sync <spis> --apply` → projekcia do `_STATUS.md`, `index.md` a `log.md`
- [ ] pri spornej veci: matica `evidence_matrix` v `_STATUS.md` sedí a žiadne tvrdenie nie je bez opory
- [ ] **Fáza** a **Ďalší krok** v `_STATUS.md` zodpovedajú realite — to píše človek,
      ale ak sú zjavne zastarané, upozorni naň advokáta

## Tri úrovne pamäte

| Úroveň | Čo tam žije |
|---|---|
| `<spis>/memory/` | obsah veci — `matter`, `decision`, `claim`, `evidence`, `task`, `question` |
| `<klient>/memory/` | `subject` a `screening` — identifikácia sa robí raz na klienta |
| `Office/memory/` | `rule`, `lesson` (L1) a `authority` (L3) |

`readScope()` prečíta všetky tri naraz. **Prameň patrí kancelárii, nie spisu** —
inak sa ten istý judikát skopíruje do desiatich spisov a kontrola úniku beží
desaťkrát nad tým istým textom.

## Jediná pamäť veci

Adresár `memory/` je jediné miesto, kam sa zapisuje. Nájdeš-li vo spise `_memory.md`,
`lrd.json`, `progress.txt`, `LEARNINGS.md` alebo `facts/`, `research/`, `strategy/`
zo starších nástrojov — ak sú to staršie záznamy pamäte, **čítaj ich ako archív, nezapisuj do nich.** Originály dokumentov a aktuálne rešerše zostávajú pracovnými podkladmi bez ohľadu na názov priečinka. Dve pamäte
v jednom spise znamenajú dve pravdy a jedna z nich bude ticho zastaraná.

Mapovanie: `progress.txt` → `## History` v zázname · `LEARNINGS.md` → L1 `lesson` ·
`lrd.json` → záznamy typu `task` · `MEMORY.md` (TP/LL/OQ) → `decision` / `lesson` / `question`.

## Čo do pamäte nepatrí

Plné znenia dokumentov. Do záznamu ide jednovetová anotácia a odkaz na súbor,
nikdy kópia obsahu — inak destilát prestane byť lacný a začne amplifikovať chyby.

## Čo sa naučilo na desiatich veciach z ISIR

- **L1 a L3 smerujú do kancelárie.** `okf-memory write <spis>` zapíše poučenie
  alebo prameň do `Office/memory/`, ak kancelária existuje — vo výpise
  uvidíš `Cieľ: Office/`. Brána úniku sa pritom posudzuje voči spisu.
- **Identifikátory L1/L3 sú jedinečné v kancelárii, nie v spise.** Desať vecí
  s vlastným `A-001` skončí kolíziou; pred zápisom prameňa si pozri
  `okf-memory read Office` alebo nechaj CLI povedať voľné id — pri
  kolízii ho navrhne. `created` je nemenné: iný dátum založenia pod tým istým
  id je iný záznam, nie úprava.
- **Opakovanú lehotu zapíš ako výčet konkrétnych dátumov** v `deadlines`
  (napr. štvrťročné správy správcu: `[2026-09-23, 2026-12-23]`). Schéma
  opakovanie zámerne nemodeluje — počítanie procesných lehôt patrí lehotníku,
  nie pamäti.
- **Rodné číslo vo voľnom texte je jehla.** Výrok opísaný do Pravdy otázky
  nesmie prejsť do L3 ani vtedy, keď preň niet poľa.

## Komunikácia, aktualizácie a odovzdanie

Pri vstupoch čítaj aj `KOMUNIKACNE-KANALY.md` veci a klienta, ak existuje. Je to evidencia rozsahu a výsledku kontroly, nie prístupové poverenie. Kanál v stave `error`, `partial` alebo `not_configured` neoznač za skontrolovaný; zachovaj posledný úspešný kurzor. Spolu s každým novým podkladom udržuj `VSTUPY.md` a odkazy na výsledné ID pamäte.

Pamäť dopĺňaj po ucelenom pracovnom kroku, nie až pri závere rozhovoru. Pred poslednou odpoveďou a plánovaným odovzdaním:

1. Zapíš nové poznatky, rozhodnutia a nevyriešené otázky cez existujúcu zápisovú bránu. Pri zmene existujúceho záznamu znovu načítaj revíziu; nikdy neobíď konflikt automatickým „moja verzia vyhráva“.
2. Skontroluj nové súbory, nespracované vstupy a výsledok kontroly povolených kanálov. Zmena súboru alebo nová Git revízia neznamená, že sa poznatok už dostal do pamäte.
3. Spusti `okf-memory validate <vec>` a po úspechu `okf-memory sync <vec> --apply`. Pri chybe zaznamenaj konkrétny problém a netvrď, že odovzdanie je úplné.
4. V odovzdaní uveď aktuálny cieľ, čo je hotové, rozhodnutia s ID a zdrojmi, otvorené otázky, chyby a najbližší krok. Nezahadzuj údaj pre chybný typ záznamu. Handoff je pomôcka; nový agent znovu číta plné zdroje cez `read`.

Git je voliteľná lokálna história. Sám neaktualizuje pamäť a nespracuje vecný konflikt. Bez konkrétneho nastavenia neinicializuj repozitár a nerob `git add .`, automatický commit ani push klientskych podkladov. Pri rekonciliácii porovnaj vstupy a ich obsah s posledným spracovaným stavom, načítaj obe strany konfliktu, zachovaj provenienciu a urob zápis s aktuálnou revíziou. Zmenený originál nesmie byť potichu vyhlásený za už spracovaný iba preto, že cesta ostala rovnaká.

Teplá cache je dočasná optimalizácia enginu, nie úložisko. Pád alebo násilné ukončenie nemusí spustiť záverečný hook; preto ukladaj priebežne. Natívny checkpoint nemôže zachrániť poznatok, ktorý agent vôbec nezapísal do súborov.
