---
type: agents
title: {{TITLE}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{TITLE}}

Zrcadlené s `CLAUDE.md`.

Nejprve čti `{{CARD}}`, `BRAIN.md` (po `okf-memory init`), `_STATUS.md`, `VSTUPY.md` a úplné relevantní záznamy `memory/`. Načti také klientský `../../AGENTS.md`, kartu klienta, jeho paměť a kancelářská pravidla. Při konkrétní otázce hledej napříč všemi typy záznamů. Poradenství bez řízení nepotřebuje soud ani spisovou značku.

Před uložením souboru čti `PRACOVNY-PROFIL.md`: určuje skutečné složky, jejich role a názvy nových dokumentů. Originály neměň ani nepřepisuj; stejné názvy odděl stabilním ID vstupu. Novou verzi návrhu ulož samostatně a zachovej odkaz na originál. Důležitou zprávu označ odkazem na kanonický originál a jeho přílohy. Bez přiřazené role si vyžádej umístění, neodhaduj je.

Věc `advisory` v režimu `ongoing` může mít opakovaná zadání a termíny bez soudního řízení. Pracuj pouze s jejími úkoly a vstupy; společné firemní údaje čti z klienta. Uzavření jednoho zadání neuzavírá průběžnou věc.

<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická paměť je `memory/`, spravovaná přes `okf-memory` a jeho `BRAIN.md`. Fakt, událost, rozhodnutí, otázku, dokument a úkol ulož jako záznam s Truth, History a zdrojem. Lhůtu veď pouze v příslušném záznamu paměti; nevytvářej druhý seznam v kartě ani ruční tabulku v `_STATUS.md`. Zapisuj přes `okf-memory write` s důvodem a podle existujícího oprávnění, potom `validate` a `sync --apply`. Neobcházej schvalování zápisu.

Každý nový podklad nebo zprávu nejprve zaznamenej do `VSTUPY.md` konkrétní věci se zdrojem, časem a stavem `pending`. Teprve po zpracování celého obsahu a zápisu výsledných ID nastav `processed`. Před předáním vypiš nezpracované vstupy a chyby čtení. Přehled ani typ záznamu nenahrazuje přečtení úplného relevantního obsahu napříč typy.

`_STATUS.md`, `memory/index.md` a `memory/log.md` jsou projekce. `MEMORY.md` je starší archiv, nikoli druhá aktivní paměť. Originály a rešerše jsou pracovní podklady v příslušných složkách, nikoli archiv paměti. Při změně `AGENTS.md` udržuj `CLAUDE.md` obsahově shodný.

Odeslání, podpis nebo podání vyžaduje výslovné potvrzení člověka. Citace právních předpisů a judikatury ověřuj v dostupných MCP zdrojích; uveď zdroj a omezení. Údaje o subjektu neodhaduj.
