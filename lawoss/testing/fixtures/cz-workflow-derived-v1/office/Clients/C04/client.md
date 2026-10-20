---
type: klient
title: "TEST-KLIENT-04"
description: ""
ico: ""
client_type: iny
country: ""
citizenship: ""
residence_country: ""
identifier_type: ""
identifier: ""
registry_status: unverified
registry_source: ""
registry_retrieved_at: ""
registry_current_at: ""
registry_subject_id: ""
registry_match_method: ""
registry_note: "Prověření nebylo dokončeno."
status: aktivní
tags: []
timestamp: 2026-10-18
updated: 2026-10-18
language: cs
---

# TEST-KLIENT-04



## Spisy
Seznam generuje `okf render` do [`index.md`](./index.md).

Firma může mít více souběžných poradenských věcí v `Spisy/`, každou s vlastními vstupy, úkoly a rozsahem. Pro průběžnou korporátní podporu nastav `matter_kind: advisory` a `mode: ongoing`; soud a spisová značka mohou zůstat prázdné. Společné firemní podklady ulož podle [`PRACOVNY-PROFIL.md`](./PRACOVNY-PROFIL.md) u klienta, z jednotlivých věcí na ně odkazuj.

U fyzické osoby eviduj státní občanství (`citizenship`) a zemi pobytu (`residence_country`) samostatně; země registrace nebo identifikátoru (`country`) je nenahrazuje. Údaje neodhaduj podle jurisdikce věci.

## Prověření
Po založení jsou údaje neověřené. Při pokusu zapiš rejstřík, zdrojový podklad, identifikátor vybraného subjektu, způsob shody, čas získání a čas aktuálnosti zdroje (pokud jej zdroj uvádí). Výpadek, neúplná odpověď nebo nejednoznačná shoda zůstávají `unverified` s důvodem. Nové prověření zachovej jako další záznam `screening` v paměti klienta. Registrace subjektu není potvrzením splnění AML povinností.
