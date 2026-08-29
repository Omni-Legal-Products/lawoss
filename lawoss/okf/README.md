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
| **L2** spis | `matter`, `decision`, `subject`, `question` | agent sám |
| **L3** právo | `authority` (prameň) | iba človek |

`lesson` je samostatný typ, nie podtyp poznámky: to, čo sa model naučil zle,
je iná kategória než obsah spisu a maže sa inak.

## Tvar záznamu

```markdown
---
okf: 1
id: R-001
typ: rozhodnuti
nazev: Nenapadat mistni prislusnost
popis: Zdrzeni prevazuje nad vyhodou zmeny soudu
vrstva: L2
jurisdikce: cz
stav: platny
vznik: 2026-08-29
zmena: 2026-08-29
lhuty: ["2026-09-12"]
---

## Pravda

Miestnu príslušnosť nenapádame.

## Historie

- 2026-08-29 — rozhodnuté po porade s klientom
```

**Pravda** je aktuálny overený stav a prepisuje sa. **Historie** je append-only.
Slovenský spis nesie `lehoty`, `nazov`, `jurisdikcia` a nadpis `## História` —
rozdiel žije v jednej mapovacej tabuľke (`src/schema.ts`), nie v dvoch kópiách kódu.

## Štyri brány, ktoré nie sú v prompte

1. **Atomicita pravdy** — zápis, ktorý zmení `## Pravda` a nepridá riadok do
   `## Historie`, je odmietnutý. Zmena pravdy bez stopy je nemožná.
2. **Append-only história** — stará história musí byť doslovnou predponou novej.
   Prepísať ani skrátiť sa nedá.
3. **Human gate** — do L1, do L3 a pri mazaní kdekoľvek zapíše iba človek.
   Agent dostane `WriteDiff` a `authorize()` mu bez schválenia zápis odmietne.
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

## Čo jadro zapisuje do spisu

```
spis/
├── spis.md          ← karta veci (novy-spis) — iba čítame
├── _STATUS.md       ← ľudské rozhranie; prepisujeme LEN medzi markermi
├── BRAIN.md         ← vstupný bod pre agentov (nikdy neprepíšeme existujúci)
└── pamet/           ← `pamat/` v SK spise
    ├── INDEX.md     ← generovaný register
    └── R-001-*.md   ← záznamy
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
node bin/okf-memory.ts validate <spis>            # exit 1 pri chybe
node bin/okf-memory.ts sync     <spis> [--apply]  # projekcia do _STATUS.md a INDEX.md
node bin/okf-memory.ts init     <spis> [--sk] [--apply]
```

## Vývoj

Balíček je **bez runtime závislostí** a nie je súčasťou pnpm workspace —
inštaluje sa samostatne, aby fork nepribral ďalší uzol do upstream stromu.

```bash
pnpm install --ignore-workspace
pnpm test        # node --test, 70 testov
pnpm typecheck
```

Beží na Node 24+ (natívne spúšťanie TypeScriptu, žiadny build krok).
