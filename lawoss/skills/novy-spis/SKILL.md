---
name: novy-spis
description: Založenie alebo retrofit priečinka klienta / spisu / projektu podľa OKF cez `okf` CLI. Spúšťače (SK) — „nový spis“, „nový klient“, „založ spis“, „založ projekt“, „sprav z toho spis“, „skontroluj spis“; (CZ) — „nová věc“, „založ věc“, „udělej z toho spis“, „zkontroluj spis“; (EN) — „new matter“, „new client folder“, „scaffold“, „retrofit“.
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
| `okf plan <typ> <dir> --title "…" --sk\|--cz [flagy]` | presný zoznam, čo by vzniklo | nič |
| `okf apply <typ> <dir> --title "…" --sk\|--cz [flagy]` | vytvorí **iba chýbajúce** súbory | áno |
| `okf validate <dir>` | pravidlá OKF v0.1; exit 1 pri chybe | nič |
| `okf render <dir>` | pregeneruje `index.md` a `CLAUDE.md` mirror | iba odvodené |

`<typ>` ∈ `klient` · `spis` · `projekt`. Flagy: `--ico`, `--klient`, `--protistrana`, `--protistrana-ico`, `--oblast`, `--desc`, `--spzn`, `--sud`, `--advokat`, `--client-type fo|fo-podnikatel|po|iny`, `--country ISO-kód`, `--citizenship ISO-kódy`, `--residence-country ISO-kód`, `--identifier-type`, `--identifier`, `--matter-kind dispute|advisory|transaction|other`, `--mode bounded|ongoing`. Pridaj `--json`, keď potrebuješ výstup spracovať.

`--advokat "Meno"` je ten, kto za spis zodpovedá, a má prednosť pred konfiguráciou. Bez flagu CLI predvyplní meno z `standing_authorization` v najbližšom nadradenom `Office/okf.config`; ak chýba alebo je neplatné, ostane `advokat: "[DOPLNIT]"` — nehádaj ho, spýtaj sa. Predvyplnenie mena neudeľuje poverenie na zápis. Prepojenie s identitou v natívnom UI a sledovaných zmenách zostáva samostatnou úlohou #6.

**Pri `spis` je `--sk` alebo `--cz` povinné** a odmietne to už `plan`. Jurisdikcia sa zapíše do karty veci ako `jurisdiction:` a `okf-memory` ju odtiaľ číta — bez nej pamäť spisu nezaloží. Nehádaj ju: ak ti ju advokát nepovedal, spýtaj sa. Jazyk rozhrania ani jazyk dokumentov jurisdikciu neurčujú.

## Postup — vždy rovnaký
1. **Zisti profil.** Klient pre právne veci → `klient` (a pod ním `Spisy/<spis>` ako `spis`). Firma s priebežnou korporátnou agendou → tiež `klient`, spisy tematicky. Interná vec bez klienta → `projekt`. Daňové a účtovné veci sem nepatria.
2. **Zisti identitu a vykonaj preverenie.** Rozlišuj FO, FO-podnikateľa, PO a inú formu. Krajina registrácie/sídla, krajina pobytu, občianstvo (aj viacnásobné) a jurisdikcia veci sú samostatné údaje. Pri FO/FO-podnikateľovi ich zisti pri identifikácii; neodvodzuj občianstvo z pobytu, mena ani jazyka. Identifikátor a jeho typ zachovaj samostatne. Preverenie je súčasť inicializácie klienta, nedá sa vynechať starým prepínačom `verify`. Použi dostupný príslušný register cez MCP (ORSR/RPO pre podporované SK subjekty, ARES a verejný register pre CZ; pri ostatných štátoch národný register alebo BRIS). Ak MCP nie je dostupné, použi oficiálny zdroj a zaznamenaj spôsob získania. Názov alebo prvý výsledok vyhľadávania nie je jednoznačná zhoda; porovnaj identifikátor a krajinu. Pri FO absencia v obchodnom registri neznamená preverenie. Zapíš zdroj a podklad, identifikátor vybraného subjektu, spôsob zhody, čas získania aj čas aktuálnosti zdroja (ak dostupný). Neúplná odpoveď, výpadok alebo nejednoznačná zhoda ostávajú `registry_status: unverified` s dôvodom; nikdy netvrď, že AML je tým dokončené. História nových preverení patrí do záznamov `screening` klienta. Pri zakladaní ďalšej veci načítaj nadradenú kartu klienta a posledné preverenie; pri zmene údajov, nedostupnom podklade alebo pred úkonom závislým od aktuálneho oprávnenia ho aktualizuj. Periodicitu určujú pravidlá kancelárie, neexistuje automaticky platná univerzálna lehota. Nezamieňaj identifikačné preverenie registra s dokončeným AML. Starý `firma-from-orsr.sh` z výskumného archívu nepoužívaj na produkčný import: nevaliduje zhodu subjektu, má natvrdo advokáta a registračné údaje mieša s procesnými. Registračná vložka a registrový súd patria klientovi; súd a značka veci patria príslušnému konaniu.
3. **`okf detect <dir>`** — existujúci priečinok nikdy nezakladaj znova. Ak už má kartu, ideš do retrofitu.
4. **`okf plan … --sk|--cz`** a **ukáž plán advokátovi** presne tak, ako ho CLI vypíše (`+` vznikne, `=` ostáva). Nič sa ešte nezapísalo.
5. **Rešpektuj autorizáciu.** Ak používateľ už výslovne zadal vytvorenie tohto klienta alebo veci, po zobrazení konkrétneho plánu pokračuj v autorizovanom rozsahu. Inak získaj potvrdenie plánu pred `apply`.
6. **`okf apply …`** s rovnakými argumentmi ako plán. Potom **`okf validate <dir>`** — musí byť OK. Potom **`okf render <koreň klienta>`**.
7. Pri spise spusti skill /okf-pamat: `okf-memory init <spis> --apply`, načítaj `BRAIN.md` a over `okf-memory validate <spis>`. Lehoty patria do záznamov pamäte, nie do karty. Pri `advisory`/`ongoing` bez konania nežiadaj súd ani spisovú značku. Zoznam klienta obnov cez `okf render <klient>`.
8. Vypíš vytvorené súbory, nespracované vstupy a neúplné preverenie. Ručné pridanie podkladu alebo komunikácie začína zápisom do `VSTUPY.md` so zdrojom, časom a `pending`. Používaj vytvorené pracovné priečinky a ich pravidlá pomenovania. V `KOMUNIKACNE-KANALY.md` eviduj povolený účet, konkrétny kontakt/thread a poslednú úplnú kontrolu. Vytvorenie evidencie nepovoľuje čítanie všetkých schránok ani odosielanie správ.

## Pravidlá (vždy)
- Píš iba do priečinka, ktorý si práve založil alebo ktorý ti advokát určil. Súrodencov nikdy nemeň.
- `apply` neprepisuje existujúce súbory — ani keď ich obsah vyzerá zle. Ak treba zmenu v existujúcom súbore, navrhni ju a nechaj rozhodnúť človeka.
- `CLAUDE.md` je mirror `AGENTS.md`; nikdy ho neupravuj samostatne, spusti `render`.
- V založenom spise platí jednotný protokol `AGENTS.md` → `BRAIN.md` → `memory/`. `_STATUS.md` je generovaný prehľad, `MEMORY.md` starší archív. Podklady patria do pracovných priečinkov a ich spracovanie do `VSTUPY.md`.
