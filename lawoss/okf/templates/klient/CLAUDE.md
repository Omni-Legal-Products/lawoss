---
type: agents
title: {{KLIENT}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{KLIENT}}

Zrkadlené s `CLAUDE.md`.

Najprv čítaj `klient.md`, `index.md` a plné relevantné záznamy `memory/`. Spoločné subjekty a preverenia patria klientovi; obsah konkrétnej veci do `Spisy/<vec>/memory/`. Každá vec má samostatné vstupy a úlohy. Pri práci v konkrétnej veci čítaj aj jej `AGENTS.md` a `BRAIN.md`. Preverenie registra nie je potvrdením právnej úplnosti AML.

<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická pamäť je `memory/`, riadená cez `okf-memory` a jeho `BRAIN.md`. Fakt, udalosť, rozhodnutie, otázku, dokument a úlohu ulož ako záznam s Truth, History a zdrojom. Lehotu veď len v príslušnom zázname pamäte; nevytváraj druhý zoznam v karte ani ručnú tabuľku v `_STATUS.md`. Zápis rob cez `okf-memory write` s dôvodom a podľa existujúceho oprávnenia, potom `validate` a `sync --apply`. Neobchádzaj brány zápisu.

Každý nový podklad alebo správu najprv zaznamenaj do `VSTUPY.md` konkrétnej veci so zdrojom, časom a stavom `pending`. Až po spracovaní celého obsahu a zápise výsledných ID nastav `processed`. Pred odovzdaním vypíš nespracované vstupy a chyby čítania. Prehľad ani typ záznamu nenahrádza prečítanie plného relevantného obsahu naprieč typmi.

`_STATUS.md`, `memory/index.md` a `memory/log.md` sú projekcie. `MEMORY.md` je starší archív, nie druhá aktívna pamäť. Originály a rešerše sú pracovné podklady v príslušných priečinkoch, nie archív pamäte. Pri zmene `AGENTS.md` udržuj `CLAUDE.md` obsahovo zhodný.

Odoslanie, podpis alebo podanie vyžaduje výslovné potvrdenie človeka. Citácie právnych predpisov a judikatúry overuj v dostupných MCP zdrojoch; uveď zdroj a limity. Údaje o subjekte nehádaj.
