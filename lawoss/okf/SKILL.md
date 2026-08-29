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
| pracovné pravidlo, preferencia kancelárie | `rule` | **L1** |
| poučenie z chyby, čo nabudúce inak | `lesson` | **L1** |
| judikát, ustanovenie, argumentačný vzor | `authority` | **L3** |

## Zápis

```ts
import { newRecord, planWrite, applyRecordWrite, readStore } from "@lawoss/okf-pamat";

const diff = planWrite(predchadzajuci, novy, "prečo sa to mení");
applyRecordWrite(spisDir, diff, schvalenie);   // schvalenie undefined pri L2
```

**Pravidlá, ktoré nástroj vynucuje — neobchádzaj ich, zlyhá to:**

- Meníš `## Pravda`? Pridaj v tom istom zápise riadok do `## Historie`.
- Históriu neprepisuj ani neskracuj. Iba pripájaj.
- Zápis do **L1** alebo **L3** a **mazanie** čohokoľvek → najprv ukáž
  `diff.lines` advokátovi a vyžiadaj si schválenie. Bez neho zápis odmietne
  `ApprovalRequiredError`.
- Do `authority` nikdy nedávaj meno klienta, IČO ani dátum narodenia zo spisu.

## Pred ukončením práce v spise

- [ ] Všetko podstatné z konverzácie je v pamäti? (prejdi ju spätne)
- [ ] `zmena:` v každom dotknutom zázname je na dnešný dátum
- [ ] `okf-memory validate <spis>` → bez chýb
- [ ] `okf-memory sync <spis> --apply` → projekcia do `_STATUS.md` a `INDEX.md`
- [ ] **Fáza** a **Ďalší krok** v `_STATUS.md` zodpovedajú realite — to píše človek,
      ale ak sú zjavne zastarané, upozorni naň advokáta

## Čo do pamäte nepatrí

Plné znenia dokumentov. Do záznamu ide jednovetová anotácia a odkaz na súbor,
nikdy kópia obsahu — inak destilát prestane byť lacný a začne amplifikovať chyby.
