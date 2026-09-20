---
type: agents
title: {{TITLE}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{TITLE}}

Zrkadlené s `CLAUDE.md`.

Najprv čítaj `spis.md`, `BRAIN.md` (po `okf-memory init`), `_STATUS.md`, `VSTUPY.md` a plné relevantné záznamy `memory/`. Načítaj aj klientsky `../../AGENTS.md`, kartu klienta, jeho pamäť a kancelárske pravidlá. Pri cielenej otázke hľadaj naprieč všetkými typmi záznamov. Poradenstvo bez konania nepotrebuje súd ani spisovú značku.

Pred uložením súboru čítaj `PRACOVNY-PROFIL.md`: určuje skutočné priečinky, ich roly a názvy nových dokumentov. Originály nemeň ani neprepisuj; rovnaké názvy oddeľ stabilným ID vstupu. Novú verziu draftu ulož samostatne a zachovaj odkaz na originál. Dôležitú správu označ odkazom na kanonický originál a jeho prílohy. Bez priradenej roly si vyžiadaj umiestnenie, nehádaj ho.

Vec `advisory` v režime `ongoing` môže mať opakované zadania a termíny bez súdneho konania. Pracuj len s jej úlohami a vstupmi; spoločné firemné údaje čítaj z klienta. Uzavretie jedného zadania neuzatvára priebežnú vec.

<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická pamäť je `memory/`, riadená cez `okf-memory` a jeho `BRAIN.md`. Fakt, udalosť, rozhodnutie, otázku, dokument a úlohu ulož ako záznam s Truth, History a zdrojom. Lehotu veď len v príslušnom zázname pamäte; nevytváraj druhý zoznam v karte ani ručnú tabuľku v `_STATUS.md`. Zápis rob cez `okf-memory write` s dôvodom a podľa existujúceho oprávnenia, potom `validate` a `sync --apply`. Neobchádzaj brány zápisu.

Každý nový podklad alebo správu najprv zaznamenaj do `VSTUPY.md` konkrétnej veci so zdrojom, časom a stavom `pending`. Až po spracovaní celého obsahu a zápise výsledných ID nastav `processed`. Pred odovzdaním vypíš nespracované vstupy a chyby čítania. Prehľad ani typ záznamu nenahrádza prečítanie plného relevantného obsahu naprieč typmi.

`_STATUS.md`, `memory/index.md` a `memory/log.md` sú projekcie. `MEMORY.md` je starší archív, nie druhá aktívna pamäť. Originály a rešerše sú pracovné podklady v príslušných priečinkoch, nie archív pamäte. Pri zmene `AGENTS.md` udržuj `CLAUDE.md` obsahovo zhodný.

Odoslanie, podpis alebo podanie vyžaduje výslovné potvrdenie človeka. Citácie právnych predpisov a judikatúry overuj v dostupných MCP zdrojoch; uveď zdroj a limity. Údaje o subjekte nehádaj.
