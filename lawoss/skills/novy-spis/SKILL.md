---
name: novy-spis
description: Založenie alebo retrofit priečinka klienta / spisu / projektu podľa OKF cez `okf` CLI. Spúšťače (SK) - „nový spis“, „nový klient“, „založ spis“, „založ projekt“, „sprav z toho spis“, „skontroluj spis“; (CZ) - „nová věc“, „založ věc“, „udělej z toho spis“, „zkontroluj spis“; (EN) - „new matter“, „new client folder“, „scaffold“, „retrofit“.
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

`--advokat "Meno"` je ten, kto za spis zodpovedá, a má prednosť pred konfiguráciou. Bez flagu CLI predvyplní meno z nastavení kancelárie, ktoré si načíta samo. Konfiguráciu kancelárie (`okf.config` ani nič v `Office/`) sám neotváraj, nečítaj a nežiadaj k nej prístup: CLI ju nájde samo a kancelária bez nej je bežný prípad. Ak meno neprevezme, ostane `advokat: "[DOPLNIT]"` — nehádaj ho, spýtaj sa. Predvyplnenie mena neudeľuje poverenie na zápis. Prepojenie s identitou v natívnom UI a sledovaných zmenách zostáva samostatnou úlohou #6.

**Pri `spis` je `--sk` alebo `--cz` povinné** a odmietne to už `plan`. Jurisdikcia sa zapíše do karty veci ako `jurisdiction:` a `okf-memory` ju odtiaľ číta - bez nej pamäť spisu nezaloží. Nehádaj ju: ak ti ju advokát nepovedal a nemá ju ani karta klienta (`jurisdiction:` v `klient.md`/`client.md`), spýtaj sa. `country` klienta jurisdikciou veci nie je. Jazyk rozhrania ani jazyk dokumentov jurisdikciu neurčujú.

## Postup — vždy rovnaký
1. **Zisti profil.** Klient pre právne veci → `klient` (a pod ním `Spisy/<spis>` ako `spis`). Firma s priebežnou korporátnou agendou → tiež `klient`, spisy tematicky. Interná vec bez klienta → `projekt`. Daňové a účtovné veci sem nepatria.
2. **Zisti identitu a vykonaj preverenie.** Rozlišuj FO, FO-podnikateľa, PO a inú formu. Krajina registrácie/sídla, krajina pobytu, občianstvo (aj viacnásobné) a jurisdikcia veci sú samostatné údaje. Pri FO/FO-podnikateľovi ich zisti pri identifikácii; neodvodzuj občianstvo z pobytu, mena ani jazyka. Identifikátor a jeho typ zachovaj samostatne. Preverenie je súčasť inicializácie klienta, nedá sa vynechať starým prepínačom `verify`. Použi dostupný príslušný register cez MCP (ORSR/RPO pre podporované SK subjekty, ARES a verejný register pre CZ; pri ostatných štátoch národný register alebo BRIS). Ak MCP nie je dostupné, použi oficiálny zdroj a zaznamenaj spôsob získania. Názov alebo prvý výsledok vyhľadávania nie je jednoznačná zhoda; porovnaj identifikátor a krajinu. Pri FO absencia v obchodnom registri neznamená preverenie. Zapíš zdroj a podklad, identifikátor vybraného subjektu, spôsob zhody, čas získania aj čas aktuálnosti zdroja (ak dostupný). Neúplná odpoveď, výpadok alebo nejednoznačná zhoda ostávajú `registry_status: unverified` s dôvodom; nikdy netvrď, že AML je tým dokončené. História nových preverení patrí do záznamov `screening` klienta. Pri zakladaní ďalšej veci načítaj nadradenú kartu klienta a posledné preverenie; pri zmene údajov, nedostupnom podklade alebo pred úkonom závislým od aktuálneho oprávnenia ho aktualizuj. Periodicitu určujú pravidlá kancelárie, neexistuje automaticky platná univerzálna lehota. Nezamieňaj identifikačné preverenie registra s dokončeným AML. Starý `firma-from-orsr.sh` z výskumného archívu nepoužívaj na produkčný import: nevaliduje zhodu subjektu, má natvrdo advokáta a registračné údaje mieša s procesnými. Registračná vložka a registrový súd patria klientovi; súd a značka veci patria príslušnému konaniu.
3. **`okf detect <dir>`** — existujúci priečinok nikdy nezakladaj znova. Ak už má kartu, ideš do retrofitu.
4. **`okf plan … --sk|--cz` spusti raz** a **ukáž plán advokátovi** presne tak, ako ho CLI vypíše (`+` vznikne, `=` ostáva). Nič sa ešte nezapísalo. Plán nespúšťaj druhýkrát (ani s `--json`), kým sa nezmenia argumenty.
5. **Rešpektuj autorizáciu.** Ak používateľ už výslovne zadal vytvorenie tohto klienta alebo veci, po zobrazení konkrétneho plánu pokračuj v autorizovanom rozsahu. Inak získaj potvrdenie plánu pred `apply`.
6. **Zápis jedným príkazom.** Pri `spis` spusti `apply` s rovnakými argumentmi ako plán a za ním kontrolu, obnovu zoznamu klienta a pamäť spisu ako **jeden** príkaz spojený `&&`, aby advokát schvaľoval jednu kartu a pri chybe sa ďalší krok nespustil:
   ```
   node ".opencode/skills/novy-spis/resources/okf.js" apply spis "<spis>" <rovnaké flagy ako plán> && node ".opencode/skills/novy-spis/resources/okf.js" validate "<spis>" && node ".opencode/skills/novy-spis/resources/okf.js" render "<koreň klienta>" && node ".opencode/skills/okf-pamat/resources/okf-memory.js" init "<spis>" --apply && node ".opencode/skills/okf-pamat/resources/okf-memory.js" validate "<spis>"
   ```
   `<spis>` je vo všetkých krokoch ten istý reťazec (napr. `Spisy/…`), `<koreň klienta>` priečinok klienta (v chate klienta `.`). Nič iné do príkazu nepridávaj (žiadne `cd`, `;`, presmerovanie ani ďalšie príkazy). Na Windows (PowerShell bez `&&`) spusti tie isté kroky jednotlivo v tomto poradí a pri chybe sa zastav. Pri `klient` stačí `apply`, `validate` a `render`. `validate` musí byť OK; ak príkaz skončí chybou, povedz ktorým krokom a nepokračuj naslepo.
7. Pamäť spisu je tým založená (skill /okf-pamat, `okf-memory init` a `validate`); potom načítaj `BRAIN.md`. Lehoty patria do záznamov pamäte, nie do karty. Pri `advisory`/`ongoing` bez konania nežiadaj súd ani spisovú značku.
8. Vypíš vytvorené súbory, nespracované vstupy a neúplné preverenie. Ručné pridanie podkladu alebo komunikácie začína zápisom do `VSTUPY.md` so zdrojom, časom a `pending`. Používaj vytvorené pracovné priečinky a ich pravidlá pomenovania. V `KOMUNIKACNE-KANALY.md` eviduj povolený účet, konkrétny kontakt/thread a poslednú úplnú kontrolu. Vytvorenie evidencie nepovoľuje čítanie všetkých schránok ani odosielanie správ.

## Pravidlá (vždy)
- **Nový klient kancelárie** (klient, ktorý ešte nemá priečinok): ak máš nástroj `lawoss_new_client` (LAWOSS), založ klienta ním, aj z chatu iného klienta: priečinok v `Klienti/` kancelárie vznikne po jednej karte tou istou cestou ako formulár klienta. Typ klienta (`po`, `fo`, `fo-podnikatel`, `iny`) zadaj vždy; ak z mena ani zo slov advokáta nie je jasný, spýtaj sa. Neodmietaj to preto, že priečinok leží mimo tohto chatu, a nový priečinok ani kartu klienta nezakladaj ručne ani cez `okf apply klient`. Preverenie v registri pred založením je vtedy voliteľné, len keď o to advokát požiada (karta ostane `registry_status: unverified`).
- **Existujúci priečinok tohto chatu mimo štandardu kancelárie** (bez karty klienta a bez `Spisy/`): `lawoss_new_client` ho nezaloží znova (hlási existujúci priečinok). Zaveď ho na mieste: `okf detect .`, `okf plan klient . --title "…" --sk|--cz [flagy]` a po potvrdení `apply`, `validate` a `render` s `.` (postup vyššie). CLI len pridá chýbajúce súbory, dokumenty advokáta nepresúva ani neprepisuje. Ak `validate` hlási len pôvodné súbory `.md` advokáta (napr. vlastný `AGENTS.md` alebo poznámky) bez frontmatteru, povedz to, tieto súbory neupravuj a spusti ešte `render .`. Požiadavku z formulára LAWOSS s presným cieľovým priečinkom (`okf plan klient "<priečinok>"`) vykonaj podľa nej.
- Píš iba do priečinka, ktorý si práve založil alebo ktorý ti advokát určil. Súrodencov nikdy nemeň.
- `apply` neprepisuje existujúce súbory — ani keď ich obsah vyzerá zle. Ak treba zmenu v existujúcom súbore, navrhni ju a nechaj rozhodnúť človeka.
- `CLAUDE.md` je mirror `AGENTS.md`; nikdy ho neupravuj samostatne, spusti `render`.
- Ak advokát kartu so súhlasom (príkaz, prístup k priečinku, zápis) zamietne, krok nezopakuj a neskonči mlčky: povedz jednou alebo dvoma vetami, čo sa neurobilo, a ako môže pokračovať (napr. požiadať znova alebo zadať údaj sám).
- V založenom spise platí jednotný protokol `AGENTS.md` → `BRAIN.md` → `memory/`. `_STATUS.md` je generovaný prehľad, `MEMORY.md` starší archív. Podklady patria do pracovných priečinkov a ich spracovanie do `VSTUPY.md`.
