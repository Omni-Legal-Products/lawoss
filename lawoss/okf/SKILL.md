---
name: okf-pamat
description: Use when reading or writing case memory in an OKF matter folder (spis) — recording facts, decisions, deadlines, subjects, lessons or legal authorities, and projecting them into _STATUS.md. Triggers (SK) — "zapíš do pamäte", "čo vieme o spise", "aktualizuj _STATUS", "skontroluj pamäť spisu", "povýš poznatok"; (CZ) — "zapiš do paměti", "co víme o spisu", "aktualizuj _STATUS", "zkontroluj paměť spisu", "povyš poznatek"; (EN) — "matter memory", "case memory", "record decision".
---

# okf-pamat — pamäť spisu

## Vstup do spisu (vždy v tomto poradí)

1. `BRAIN.md` — protokol pamäte tohto spisu
2. `_STATUS.md` — **Fáza** a **Ďalší krok** hore
3. `memory/INDEX.md` — register; odtiaľ cielene na záznam

**Nikdy nečítaj celý spis „pre istotu".** Register je mapa, dokumenty sú prameň.
Citáciu do výstupu overuj vždy proti originálu dokumentu, nikdy proti pamäti.

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

## Zápis

```bash
# Náhľad — vypíše diff a nič nezapíše
okf-memory write <spis> --file navrh.md --reason "prečo sa to mení"

# Zápis do L2 — agent smie sám
okf-memory write <spis> --file navrh.md --reason "…" --apply

# Zápis do L1, L3 alebo mazanie — meno zadáva človek
okf-memory write <spis> --file navrh.md --reason "…" --apply --approve-as "JUDr. …"
```

> [!IMPORTANT]
> **`Approval` si nikdy nekonštruuj sám.** Meno v `--approve-as` zadáva do príkazu
> **človek**. Agent, ktorý si napíše `{ by: "agent" }`, bránu síce technicky prejde —
> knižnica nevie rozlíšiť, kto ju volá — ale **schválenie sa zapisuje do append-only
> histórie záznamu** a zostane tam navždy viditeľné. Je to hranica procesná, nie
> kryptografická; drží ju to, že podpis je trvalý a dohľadateľný, nie to, že sa nedá
> napísať.

Knižničné API (`planWrite` → `applyRecordWrite`) používaj iba na **čítanie diffu
a prípravu návrhu**. Vlastný zápis nechaj CLI.

**Pravidlá, ktoré nástroj vynucuje — neobchádzaj ich, zlyhá to:**

- Meníš `## Truth`? Pridaj v tom istom zápise riadok do `## History`.
- Históriu neprepisuj ani neskracuj. Iba pripájaj.
- Zápis do **L1** alebo **L3** a **mazanie** čohokoľvek → najprv ukáž
  `diff.lines` advokátovi a vyžiadaj si schválenie. Bez neho zápis odmietne
  `ApprovalRequiredError`.
- **AML údaje patria k `klient.md`, nie do spisu.** Identifikácia sa robí raz pri vzniku
  obchodného vzťahu a archivuje 10 rokov od jeho skončenia (§ 16), nie od skončenia kauzy.
  Spis na subjekt odkazuje `[[S-001]]`; `readScope()` obe úrovne prečíta naraz.
- **Kľúče záznamu sú anglické** (`type`, `title`, `deadlines`, `## Truth`) pre obe
  jurisdikcie. Lokalizovaný je až výstup — `_STATUS.md`, hlášky, appka.
- **Povinná sada sa líši podľa jurisdikcie a neprekladá sa.** CZ (§ 5 z. 253/2008 Sb.) žiada
  miesto narodenia, vydavateľa dokladu a jeho platnosť; SK (§ 7 z. 297/2008 Z. z.) nie, zato
  žiada zápis v registri u PO. Nedopĺňaj údaj len preto, že ho žiada druhá jurisdikcia.
- **Rodné číslo ani číslo dokladu nikdy nepíš do `popis`** — popis sa renderuje do `INDEX.md`
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

## Pred ukončením práce v spise

- [ ] Všetko podstatné z konverzácie je v pamäti? (prejdi ju spätne)
- [ ] `zmena:` v každom dotknutom zázname je na dnešný dátum
- [ ] `okf-memory validate <spis>` → bez chýb
- [ ] pri AML veci `okf-memory aml <spis>` → preverenie klienta platí a je úplné
- [ ] `okf-memory sync <spis> --apply` → projekcia do `_STATUS.md` a `INDEX.md`
- [ ] pri spornej veci: matica `evidence_matrix` v `_STATUS.md` sedí a žiadne tvrdenie nie je bez opory
- [ ] **Fáza** a **Ďalší krok** v `_STATUS.md` zodpovedajú realite — to píše človek,
      ale ak sú zjavne zastarané, upozorni naň advokáta

## Tri úrovne pamäte

| Úroveň | Čo tam žije |
|---|---|
| `<spis>/memory/` | obsah veci — `matter`, `decision`, `claim`, `evidence`, `task`, `question` |
| `<klient>/memory/` | `subject` a `screening` — identifikácia sa robí raz na klienta |
| `_kancelaria/memory/` | `rule`, `lesson` (L1) a `authority` (L3) |

`readScope()` prečíta všetky tri naraz. **Prameň patrí kancelárii, nie spisu** —
inak sa ten istý judikát skopíruje do desiatich spisov a kontrola úniku beží
desaťkrát nad tým istým textom.

## Jediná pamäť veci

Adresár `memory/` je jediné miesto, kam sa zapisuje. Nájdeš-li vo spise `_memory.md`,
`lrd.json`, `progress.txt`, `LEARNINGS.md` alebo `facts/`, `research/`, `strategy/`
zo starších nástrojov — **čítaj ich ako archív, nezapisuj do nich.** Dve pamäte
v jednom spise znamenajú dve pravdy a jedna z nich bude ticho zastaraná.

Mapovanie: `progress.txt` → `## History` v zázname · `LEARNINGS.md` → L1 `lesson` ·
`lrd.json` → záznamy typu `task` · `MEMORY.md` (TP/LL/OQ) → `decision` / `lesson` / `question`.

## Čo do pamäte nepatrí

Plné znenia dokumentov. Do záznamu ide jednovetová anotácia a odkaz na súbor,
nikdy kópia obsahu — inak destilát prestane byť lacný a začne amplifikovať chyby.
