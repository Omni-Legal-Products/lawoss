---
type: klient
title: {{KLIENT}}
description: {{DESCRIPTION}}
ico: "{{KLIENT_ICO}}"
client_type: {{CLIENT_TYPE}}
country: "{{COUNTRY}}"
citizenship: "{{CITIZENSHIP}}"
residence_country: "{{RESIDENCE_COUNTRY}}"
identifier_type: "{{IDENTIFIER_TYPE}}"
identifier: "{{IDENTIFIER}}"
registry_status: unverified
registry_source: ""
registry_retrieved_at: ""
registry_current_at: ""
registry_subject_id: ""
registry_match_method: ""
registry_note: "Preverenie nebolo dokončené."
status: aktívny
tags: []
timestamp: {{DATE}}
updated: {{DATE}}
---

# {{KLIENT}}

{{DESCRIPTION}}

## Spisy
Zoznam generuje `okf render` do [`index.md`](./index.md).

Firma môže mať viac súbežných poradenských vecí v `Spisy/`, každú s vlastnými vstupmi, úlohami a rozsahom. Pre priebežnú korporátnu podporu nastav `matter_kind: advisory` a `mode: ongoing`; súd a spisová značka môžu zostať prázdne. Spoločné firemné podklady ulož podľa [`PRACOVNY-PROFIL.md`](./PRACOVNY-PROFIL.md) pri klientovi, z jednotlivých vecí na ne odkazuj.

Pri fyzickej osobe eviduj štátne občianstvo (`citizenship`) a krajinu pobytu (`residence_country`) samostatne; krajina registrácie alebo identifikátora (`country`) ich nenahrádza. Údaje nehádaj podľa jurisdikcie veci.

## Preverenie
Po založení sú údaje neoverené. Pri pokuse zapíš register, zdrojový podklad, identifikátor vybraného subjektu, spôsob zhody, čas získania a čas aktuálnosti zdroja (ak ho zdroj uvádza). Výpadok, neúplná odpoveď alebo nejednoznačná zhoda zostávajú `unverified` s dôvodom. Nové preverenie zachovaj ako ďalší záznam `screening` v pamäti klienta. Registrácia subjektu nie je potvrdením splnenia AML povinností.
