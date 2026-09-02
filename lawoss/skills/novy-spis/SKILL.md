---
name: novy-spis
description: Založenie alebo retrofit priečinka klienta / spisu / projektu podľa OKF cez `okf` CLI. Spúšťače (SK) — „nový spis“, „nový klient“, „založ spis“, „založ projekt“, „sprav z toho spis“, „skontroluj spis“; (EN) — „new matter“, „new client folder“, „scaffold“, „retrofit“.
---

# novy-spis — spis podľa OKF cez `okf` CLI (LAWOSS, Fáza A)

Tento skill nič neimplementuje. Rozhoduje, **čo** sa má stať, a volá `okf` CLI, ktoré robí skutočnú prácu.
Pravidlá formátu žijú v CLI, nie tu — aby ich Claude Code, Codex, opencode aj LAWOSS mali rovnaké.

## Kde je CLI
`resources/okf.js` vedľa tohto súboru (jeden súbor, bez závislostí). Spúšťaj:
```
node "<cesta k tomuto skillu>/resources/okf.js" <príkaz> …    # alebo bun namiesto node
```
Ak `node` ani `bun` nie sú k dispozícii, **zastav sa a povedz to** — nesnaž sa priečinok vyrobiť ručne.

## Päť príkazov
| Príkaz | Robí | Zapíše |
|---|---|---|
| `okf detect <dir>` | čo v priečinku je a čo chýba | nič |
| `okf plan <typ> <dir> --title "…" [flagy]` | presný zoznam, čo by vzniklo | nič |
| `okf apply <typ> <dir> --title "…" [flagy]` | vytvorí **iba chýbajúce** súbory | áno |
| `okf validate <dir>` | pravidlá OKF v0.1; exit 1 pri chybe | nič |
| `okf render <dir>` | pregeneruje `index.md` a `CLAUDE.md` mirror | iba odvodené |

`<typ>` ∈ `klient` · `spis` · `projekt`. Flagy: `--ico`, `--klient`, `--protistrana`, `--protistrana-ico`, `--oblast`, `--desc`, `--spzn`, `--sud`. Pridaj `--json`, keď potrebuješ výstup spracovať.

## Postup — vždy rovnaký
1. **Zisti profil.** Klient pre právne veci → `klient` (a pod ním `Spisy/<spis>` ako `spis`). Firma s priebežnou korporátnou agendou → tiež `klient`, spisy tematicky. Interná vec bez klienta → `projekt`. Daňové a účtovné veci sem nepatria.
2. **Over subjekt** cez MCP (`orsr_*`, `rpo_*`): IČO, sídlo, štatutár, stav. Žiadne údaje „z hlavy“. Zahraničná firma → oficiálny register krajiny alebo web, do karty zapíš zdroj.
3. **`okf detect <dir>`** — existujúci priečinok nikdy nezakladaj znova. Ak už má kartu, ideš do retrofitu.
4. **`okf plan …`** a **ukáž plán advokátovi** presne tak, ako ho CLI vypíše (`+` vznikne, `=` ostáva). Nič sa ešte nezapísalo.
5. **Čakaj na potvrdenie.** Bez výslovného „áno“ od človeka `apply` nespúšťaj. Toto je brána a nedá sa preskočiť.
6. **`okf apply …`** s rovnakými argumentmi ako plán. Potom **`okf validate <dir>`** — musí byť OK. Potom **`okf render <koreň klienta>`**.
7. Vypíš, čo vzniklo, a navrhni ďalší krok (doplniť `spis.md` frontmatter: `spisova_znacka`, `sud`, `oblast_prava`, `lehoty`).

## Pravidlá (vždy)
- Píš iba do priečinka, ktorý si práve založil alebo ktorý ti advokát určil. Súrodencov nikdy nemeň.
- `apply` neprepisuje existujúce súbory — ani keď ich obsah vyzerá zle. Ak treba zmenu v existujúcom súbore, navrhni ju a nechaj rozhodnúť človeka.
- `CLAUDE.md` je mirror `AGENTS.md`; nikdy ho neupravuj samostatne, spusti `render`.
- V založenom spise plať zápisová disciplína z `AGENTS.md` toho spisu: fakt → `_STATUS.md`, lehota → `spis.md` + `_STATUS.md`, taktické rozhodnutie → `MEMORY.md`.
