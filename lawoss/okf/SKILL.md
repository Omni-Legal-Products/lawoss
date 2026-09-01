---
name: okf-pamat
description: Use when reading or writing case memory in an OKF matter folder (spis) — recording facts, decisions, deadlines, subjects, lessons or legal authorities, and projecting them into _STATUS.md. Triggers (SK) — "zapíš do pamäte", "čo vieme o spise", "aktualizuj _STATUS", "skontroluj pamäť spisu", "povýš poznatok"; (CZ) — "zapiš do paměti", "co víme o spisu", "aktualizuj _STATUS", "zkontroluj paměť spisu", "povyš poznatek"; (EN) — "matter memory", "case memory", "record decision".
---

# okf-pamat — pamäť spisu

## Vstup do spisu (vždy v tomto poradí)

1. `BRAIN.md` — protokol pamäte tohto spisu
2. `_STATUS.md` — **Fáza** a **Ďalší krok** hore
3. `pamet/INDEX.md` (SK: `pamat/INDEX.md`) — register; odtiaľ cielene na záznam

**Nikdy nečítaj celý spis „pre istotu".** Register je mapa, dokumenty sú prameň.
Citáciu do výstupu overuj vždy proti originálu dokumentu, nikdy proti pamäti.

## Kam čo patrí

| Čo sa objavilo | Typ záznamu | Vrstva |
|---|---|---|
| stav veci, fakty, chronológia | `matter` (spis) | L2 |
| taktické rozhodnutie („takto áno / takto nie") | `decision` | L2 |
| strana, protistrana, overený subjekt | `subject` | L2 |
| otvorená otázka bez odpovede | `question` | L2 |
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

- Meníš `## Pravda`? Pridaj v tom istom zápise riadok do `## Historie`.
- Históriu neprepisuj ani neskracuj. Iba pripájaj.
- Zápis do **L1** alebo **L3** a **mazanie** čohokoľvek → najprv ukáž
  `diff.lines` advokátovi a vyžiadaj si schválenie. Bez neho zápis odmietne
  `ApprovalRequiredError`.
- **AML údaje patria k `klient.md`, nie do spisu.** Identifikácia sa robí raz pri vzniku
  obchodného vzťahu a archivuje 10 rokov od jeho skončenia (§ 16), nie od skončenia kauzy.
  Spis na subjekt odkazuje `[[S-001]]`; `readScope()` obe úrovne prečíta naraz.
- **Povinná sada sa líši podľa jurisdikcie a neprekladá sa.** CZ (§ 5 z. 253/2008 Sb.) žiada
  miesto narodenia, vydavateľa dokladu a jeho platnosť; SK (§ 7 z. 297/2008 Z. z.) nie, zato
  žiada zápis v registri u PO. Nedopĺňaj údaj len preto, že ho žiada druhá jurisdikcia.
- **Rodné číslo ani číslo dokladu nikdy nepíš do `popis`** — popis sa renderuje do `INDEX.md`
  a do `_STATUS.md`. Patria do poľa frontmatteru, kde sa maskujú vo výpisoch.
- Preverenie **nevykonávaj v tomto skille** — použi AML skill a MCP konektory, sem zapíš len
  výsledok ako `screening` so zdrojmi, rizikom a `platnost_do`.
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
- [ ] **Fáza** a **Ďalší krok** v `_STATUS.md` zodpovedajú realite — to píše človek,
      ale ak sú zjavne zastarané, upozorni naň advokáta

## Čo do pamäte nepatrí

Plné znenia dokumentov. Do záznamu ide jednovetová anotácia a odkaz na súbor,
nikdy kópia obsahu — inak destilát prestane byť lacný a začne amplifikovať chyby.
