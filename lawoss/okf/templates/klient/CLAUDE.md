---
type: agents
title: {{KLIENT}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{KLIENT}}

Zrkadlené s `CLAUDE.md`.

Najprv čítaj `{{CARD}}`, `index.md` a plné relevantné záznamy `memory/`. Spoločné subjekty a preverenia patria klientovi; obsah konkrétnej veci do `Spisy/<vec>/memory/`. Každá vec má samostatné vstupy a úlohy. Pri práci v konkrétnej veci čítaj aj jej `AGENTS.md` a `BRAIN.md`. Preverenie registra nie je potvrdením právnej úplnosti AML.

## Firma a priebežná podpora

Firma má jednu kartu klienta a spoločné podklady (napr. zakladateľské dokumenty a kontakty) v klientskych pracovných priečinkoch podľa `PRACOVNY-PROFIL.md`. Každá samostatná poradenská oblasť má vlastnú vec, napr. `Spisy/Korporatna-podpora/` a `Spisy/Pracovne-pravo/`, s `matter_kind: advisory` a `mode: ongoing`. Pri založení cez CLI použi `--matter-kind advisory --mode ongoing` a skutočnú jurisdikciu `--sk` alebo `--cz`. Súd, spisová značka ani protistrana nie sú pre také poradenstvo povinné; nevymýšľaj ich.

Požiadavku, úlohu, termín a prijatú správu priraď ku konkrétnej veci. Ak zaradenie nie je jasné, označ ho ako nevyriešené a vyžiadaj rozhodnutie; nevytváraj rovnakú úlohu vo viacerých veciach. Na spoločné firemné podklady z veci odkazuj, nekopíruj ich do každej veci. Samostatný projekt alebo spor založ ako ďalšiu vec, keď má vlastný cieľ a rozsah; priebežnú podporu tým automaticky neuzatváraj. `okf render <klient>` obnoví zoznam vecí v `index.md`.

<!-- okf:protokol-zapisu:v2 -->
## Protokol zápisu

Kanonická pamäť je `memory/`, riadená cez `okf-memory` a jeho `BRAIN.md`. Fakt, udalosť, rozhodnutie, otázku, dokument a úlohu ulož ako záznam s Truth, History a zdrojom. Lehotu veď len v príslušnom zázname pamäte; nevytváraj druhý zoznam v karte ani ručnú tabuľku v `_STATUS.md`. Zápis rob cez `okf-memory write` s dôvodom a podľa existujúceho oprávnenia, potom `validate` a `sync --apply`. Neobchádzaj brány zápisu.

Každý nový podklad alebo správu najprv zaznamenaj do `VSTUPY.md` konkrétnej veci so zdrojom, časom a stavom `pending`. Až po spracovaní celého obsahu a zápise výsledných ID nastav `processed`. Pred odovzdaním vypíš nespracované vstupy a chyby čítania. Prehľad ani typ záznamu nenahrádza prečítanie plného relevantného obsahu naprieč typmi.

`_STATUS.md`, `memory/index.md` a `memory/log.md` sú projekcie. `MEMORY.md` je starší archív, nie druhá aktívna pamäť. Originály a rešerše sú pracovné podklady v príslušných priečinkoch, nie archív pamäte. Pri zmene `AGENTS.md` udržuj `CLAUDE.md` obsahovo zhodný.

Odoslanie, podpis alebo podanie vyžaduje výslovné potvrdenie človeka. Citácie právnych predpisov a judikatúry overuj v dostupných MCP zdrojoch; uveď zdroj a limity. Údaje o subjekte nehádaj.
