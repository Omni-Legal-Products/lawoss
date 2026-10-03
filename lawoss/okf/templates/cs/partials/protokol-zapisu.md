<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická paměť je `memory/`, spravovaná přes `okf-memory` a jeho `BRAIN.md`. Fakt, událost, rozhodnutí, otázku, dokument a úkol ulož jako záznam s Truth, History a zdrojem. Lhůtu veď pouze v příslušném záznamu paměti; nevytvářej druhý seznam v kartě ani ruční tabulku v `_STATUS.md`. Zapisuj přes `okf-memory write` s důvodem a podle existujícího oprávnění, potom `validate` a `sync --apply`. Neobcházej schvalování zápisu.

Každý nový podklad nebo zprávu nejprve zaznamenej do `VSTUPY.md` konkrétní věci se zdrojem, časem a stavem `pending`. Teprve po zpracování celého obsahu a zápisu výsledných ID nastav `processed`. Před předáním vypiš nezpracované vstupy a chyby čtení. Přehled ani typ záznamu nenahrazuje přečtení úplného relevantního obsahu napříč typy.

`_STATUS.md`, `memory/index.md` a `memory/log.md` jsou projekce. `MEMORY.md` je starší archiv, nikoli druhá aktivní paměť. Originály a rešerše jsou pracovní podklady v příslušných složkách, nikoli archiv paměti. Při změně `AGENTS.md` udržuj `CLAUDE.md` obsahově shodný.
