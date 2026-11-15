---
name: novy-spis
description: Založení nebo retrofit složky klienta / spisu / projektu podle OKF přes `okf` CLI. Spouštěče (CZ) - „nový spis“, „nová věc“, „nový klient“, „založ spis“, „založ věc“, „založ projekt“, „udělej z toho spis“, „zkontroluj spis“; (SK) - „nový spis“, „založ spis“, „skontroluj spis“; (EN) - „new matter“, „new client folder“, „scaffold“, „retrofit“.
---

# novy-spis - spis podle OKF přes `okf` CLI (LAWOSS, Fáze A)

Tento skill nic neimplementuje. Rozhoduje, **co** se má stát, a volá `okf` CLI, které dělá skutečnou práci.
Pravidla formátu žijí v CLI, ne tady - aby je Claude Code, Codex, opencode i LAWOSS měly stejná.

## Kde je CLI
`resources/okf.js` vedle tohoto souboru (jeden soubor, bez závislostí). Spouštěj:
```
node "<cesta k tomuto skillu>/resources/okf.js" <příkaz> …    # nebo bun místo node
```
Pokud není k dispozici `node` ani `bun`, **zastav se a řekni to** - nesnaž se složku vyrobit ručně.

## Pět příkazů
| Příkaz | Dělá | Zapíše |
|---|---|---|
| `okf detect <dir>` | co ve složce je a co chybí | nic |
| `okf plan <typ> <dir> --title "…" [--sk\|--cz] [flagy]` | přesný seznam, co by vzniklo | nic |
| `okf apply <typ> <dir> --title "…" [--sk\|--cz] [flagy]` | vytvoří **jen chybějící** soubory | ano |
| `okf validate <dir>` | pravidla OKF v0.1; exit 1 při chybě | nic |
| `okf render <dir>` | přegeneruje `index.md` a `CLAUDE.md` mirror | jen odvozené |

`<typ>` ∈ `klient` · `spis` · `projekt`. Flagy: `--ico`, `--klient`, `--protistrana`, `--protistrana-ico`, `--oblast`, `--desc`, `--spzn`, `--sud`, `--advokat`, `--client-type fo|fo-podnikatel|po|iny`, `--country ISO-kód`, `--citizenship ISO-kódy`, `--residence-country ISO-kód`, `--identifier-type`, `--identifier`, `--matter-kind dispute|advisory|transaction|other`, `--mode bounded|ongoing`. Přidej `--json`, když potřebuješ výstup zpracovat.

`--advokat "Jméno"` je ten, kdo za spis odpovídá, a má přednost před konfigurací. Bez flagu CLI předvyplní jméno z nastavení kanceláře, které si načte samo. Konfiguraci kanceláře (`okf.config` ani nic v `Office/`) sám neotvírej, nečti a nežádej k ní přístup: CLI ji najde samo a kancelář bez ní je běžný případ. Pokud jméno nepřevezme, zůstane `advokat: "[DOPLNIT]"` - nehádej ho, zeptej se. Předvyplnění jména neuděluje pověření k zápisu. Propojení s identitou v nativním UI a sledovaných změnách zůstává samostatným úkolem #6.

**Na jurisdikci u `spis` (`sk`/`cz`) se advokáta neptej.** Bez přepínače ji CLI doplní samo z karty klienta (`jurisdiction:`) nebo z nastavení kanceláře; `--sk`/`--cz` přidej jen tehdy, když ti ji advokát řekl nebo věc zjevně patří do druhé jurisdikce (např. řízení před slovenským soudem v české kanceláři). Zeptej se jednou, jen když `plan` odmítne, že jurisdikce chybí. Zapíše se do karty věci jako `jurisdiction:` a `okf-memory` ji odtud čte - bez ní paměť spisu nezaloží. `country` klienta jurisdikcí věci není. Jazyk rozhraní ani jazyk dokumentů jurisdikci neurčují.

## Postup - vždy stejný
1. **Zjisti profil.** Klient pro právní věci → `klient` (a pod ním `Spisy/<spis>` jako `spis`). Firma s průběžnou korporátní agendou → také `klient`, spisy tematicky. Interní věc bez klienta → `projekt`. Daňové a účetní věci sem nepatří.
2. **Zjisti identitu a proveď ověření.** Rozlišuj FO, FO-podnikatele, PO a jinou formu. Země registrace/sídla, země pobytu, občanství (i vícenásobné) a jurisdikce věci jsou samostatné údaje. U FO/FO-podnikatele je zjisti při identifikaci; neodvozuj občanství z pobytu, jména ani jazyka. Identifikátor a jeho typ zachovej samostatně. Ověření je součástí inicializace klienta, nelze ho vynechat starým přepínačem `verify`. Použij dostupný příslušný rejstřík přes MCP (ARES a veřejný rejstřík pro CZ, ORSR/RPO pro podporované SK subjekty; u ostatních států národní rejstřík nebo BRIS). Pokud MCP není k dispozici, použij oficiální zdroj a zaznamenej způsob získání. Název ani první výsledek vyhledávání není jednoznačná shoda; porovnej identifikátor a zemi. U FO nepřítomnost v obchodním rejstříku neznamená ověření. Zapiš zdroj a podklad, identifikátor vybraného subjektu, způsob shody, čas získání i čas aktuálnosti zdroje (je-li k dispozici). Neúplná odpověď, výpadek nebo nejednoznačná shoda zůstávají `registry_status: unverified` s důvodem; nikdy netvrď, že je tím AML dokončeno. Historie nových ověření patří do záznamů `screening` klienta. Při zakládání další věci načti nadřazenou kartu klienta a poslední ověření; při změně údajů, nedostupném podkladu nebo před úkonem závislým na aktuálním oprávnění ho aktualizuj. Periodicitu určují pravidla kanceláře, žádná automaticky platná univerzální lhůta neexistuje. Nezaměňuj identifikační ověření v rejstříku s dokončeným AML. Starý `firma-from-orsr.sh` z výzkumného archivu nepoužívej pro produkční import: nevaliduje shodu subjektu, má natvrdo advokáta a registrační údaje míchá s procesními. Zápis v obchodním rejstříku (oddíl a vložka) a rejstříkový soud patří klientovi; soud a spisová značka věci patří příslušnému řízení.
3. **`okf detect <dir>`** - existující složku nikdy nezakládej znovu. Pokud už má kartu, jdeš do retrofitu.
4. **`okf plan …` spusť jednou** a **ukaž plán advokátovi** přesně tak, jak ho CLI vypíše (`+` vznikne, `=` zůstává). Nic se ještě nezapsalo. Plán nespouštěj podruhé (ani s `--json`), dokud se nezmění argumenty.
5. **Respektuj autorizaci.** Pokud uživatel už výslovně zadal vytvoření tohoto klienta nebo věci, po zobrazení konkrétního plánu pokračuj v autorizovaném rozsahu. Jinak získej potvrzení plánu před `apply`.
6. **Zápis jedním příkazem.** U `spis` spusť `apply` se stejnými argumenty jako plán a za ním kontrolu, obnovu seznamu klienta a paměť spisu jako **jeden** příkaz spojený `&&`, aby advokát schvaloval jednu kartu a při chybě se další krok nespustil:
   ```
   node ".opencode/skills/novy-spis/resources/okf.js" apply spis "<spis>" <stejné flagy jako plán> && node ".opencode/skills/novy-spis/resources/okf.js" validate "<spis>" && node ".opencode/skills/novy-spis/resources/okf.js" render "<kořen klienta>" && node ".opencode/skills/okf-pamat/resources/okf-memory.js" init "<spis>" --apply && node ".opencode/skills/okf-pamat/resources/okf-memory.js" validate "<spis>"
   ```
   `<spis>` je ve všech krocích tentýž řetězec (např. `Spisy/…`), `<kořen klienta>` složka klienta (v chatu klienta `.`). Nic jiného do příkazu nepřidávej (žádné `cd`, `;`, přesměrování ani další příkazy). Na Windows (PowerShell bez `&&`) spusť tytéž kroky jednotlivě v tomto pořadí a při chybě se zastav. U `klient` stačí `apply`, `validate` a `render`. `validate` musí být OK; pokud příkaz skončí chybou, řekni kterým krokem a nepokračuj naslepo.
7. Paměť spisu je tím založena (skill /okf-pamat, `okf-memory init` a `validate`); potom načti `BRAIN.md`. Lhůty patří do záznamů paměti, ne do karty. U `advisory`/`ongoing` bez řízení nežádej soud ani spisovou značku.
8. Vypiš vytvořené soubory, nezpracované vstupy a neúplné ověření. Ruční přidání podkladu nebo komunikace začíná zápisem do `VSTUPY.md` se zdrojem, časem a `pending`. Používej vytvořené pracovní složky a jejich pravidla pojmenování. V `KOMUNIKACNE-KANALY.md` eviduj povolený účet, konkrétní kontakt/vlákno a poslední úplnou kontrolu. Vytvoření evidence nepovoluje čtení všech schránek ani odesílání zpráv.

## Pravidla (vždy)
- **Nový klient kanceláře** (klient, který ještě nemá složku): pokud máš nástroj `lawoss_new_client` (LAWOSS), založ klienta jím, i z chatu jiného klienta: složka v `Klienti/` kanceláře vznikne po jedné kartě stejnou cestou jako formulář klienta. Typ klienta (`po`, `fo`, `fo-podnikatel`, `iny`) zadej vždy; pokud z názvu ani ze slov advokáta není jasný, zeptej se. Neodmítej to proto, že složka leží mimo tento chat, a novou složku ani kartu klienta nezakládej ručně ani přes `okf apply klient`. Ověření v rejstříku před založením je pak volitelné, jen když o něj advokát požádá (karta zůstane `registry_status: unverified`).
- **Existující složka tohoto chatu mimo standard kanceláře** (bez karty klienta a bez `Spisy/`): `lawoss_new_client` ji znovu nezaloží (hlásí existující složku). Zaveď ji na místě: `okf detect .`, `okf plan klient . --title "…" --sk|--cz [flagy]` a po potvrzení `apply`, `validate` a `render` s `.` (postup výše). CLI jen přidá chybějící soubory, dokumenty advokáta nepřesouvá ani nepřepisuje. Pokud `validate` hlásí jen původní soubory `.md` advokáta (např. vlastní `AGENTS.md` nebo poznámky) bez frontmatteru, řekni to, tyto soubory neupravuj a spusť ještě `render .`. Požadavek z formuláře LAWOSS s přesnou cílovou složkou (`okf plan klient "<složka>"`) proveď podle něj.
- Piš jen do složky, kterou jsi právě založil nebo kterou ti advokát určil. Sourozence nikdy neměň.
- `apply` nepřepisuje existující soubory - ani když jejich obsah vypadá špatně. Pokud je potřeba změna v existujícím souboru, navrhni ji a nech rozhodnout člověka.
- `CLAUDE.md` je mirror `AGENTS.md`; nikdy ho neupravuj samostatně, spusť `render`.
- Pokud advokát kartu se souhlasem (příkaz, přístup ke složce, zápis) zamítne, krok nezopakuj a neskonči mlčky: řekni jednou nebo dvěma větami, co se neudělalo a jak může pokračovat (např. požádat znovu nebo zadat údaj sám).
- V založeném spisu platí jednotný protokol `AGENTS.md` → `BRAIN.md` → `memory/`. `_STATUS.md` je generovaný přehled, `MEMORY.md` starší archiv. Podklady patří do pracovních složek a jejich zpracování do `VSTUPY.md`.
