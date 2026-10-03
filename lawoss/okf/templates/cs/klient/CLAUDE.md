---
type: agents
title: {{KLIENT}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{KLIENT}}

Zrcadlené s `CLAUDE.md`.

Nejprve čti `{{CARD}}`, `index.md` a úplné relevantní záznamy `memory/`. Společné subjekty a prověření patří klientovi; obsah konkrétní věci do `Spisy/<vec>/memory/`. Každá věc má samostatné vstupy a úkoly. Při práci v konkrétní věci čti také její `AGENTS.md` a `BRAIN.md`. Prověření rejstříku není potvrzením právní úplnosti AML.

## Firma a průběžná podpora

Firma má jednu kartu klienta a společné podklady (např. zakladatelské dokumenty a kontakty) v klientských pracovních složkách podle `PRACOVNY-PROFIL.md`. Každá samostatná poradenská oblast má vlastní věc, např. `Spisy/Korporatni-podpora/` a `Spisy/Pracovni-pravo/`, s `matter_kind: advisory` a `mode: ongoing`. Při založení přes CLI použij `--matter-kind advisory --mode ongoing` a skutečnou jurisdikci `--sk` nebo `--cz`. Soud, spisová značka ani protistrana nejsou pro takové poradenství povinné; nevymýšlej je.

Požadavek, úkol, termín a přijatou zprávu přiřaď ke konkrétní věci. Pokud zařazení není jasné, označ je jako nevyřešené a vyžádej rozhodnutí; nevytvářej stejný úkol ve více věcech. Na společné firemní podklady z věci odkazuj, nekopíruj je do každé věci. Samostatný projekt nebo spor založ jako další věc, pokud má vlastní cíl a rozsah; průběžnou podporu tím automaticky neuzavírej. `okf render <klient>` obnoví seznam věcí v `index.md`.

<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická paměť je `memory/`, spravovaná přes `okf-memory` a jeho `BRAIN.md`. Fakt, událost, rozhodnutí, otázku, dokument a úkol ulož jako záznam s Truth, History a zdrojem. Lhůtu veď pouze v příslušném záznamu paměti; nevytvářej druhý seznam v kartě ani ruční tabulku v `_STATUS.md`. Zapisuj přes `okf-memory write` s důvodem a podle existujícího oprávnění, potom `validate` a `sync --apply`. Neobcházej schvalování zápisu.

Každý nový podklad nebo zprávu nejprve zaznamenej do `VSTUPY.md` konkrétní věci se zdrojem, časem a stavem `pending`. Teprve po zpracování celého obsahu a zápisu výsledných ID nastav `processed`. Před předáním vypiš nezpracované vstupy a chyby čtení. Přehled ani typ záznamu nenahrazuje přečtení úplného relevantního obsahu napříč typy.

`_STATUS.md`, `memory/index.md` a `memory/log.md` jsou projekce. `MEMORY.md` je starší archiv, nikoli druhá aktivní paměť. Originály a rešerše jsou pracovní podklady v příslušných složkách, nikoli archiv paměti. Při změně `AGENTS.md` udržuj `CLAUDE.md` obsahově shodný.

Odeslání, podpis nebo podání vyžaduje výslovné potvrzení člověka. Citace právních předpisů a judikatury ověřuj v dostupných MCP zdrojích; uveď zdroj a omezení. Údaje o subjektu neodhaduj.
