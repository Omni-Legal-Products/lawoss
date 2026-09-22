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
registry_note: "Screening has not been completed."
status: active
tags: []
timestamp: {{DATE}}
updated: {{DATE}}
language: {{LANGUAGE}}
---

# {{KLIENT}}

{{DESCRIPTION}}

## Matters
`okf render` generates the list in [`index.md`](./index.md).

A company may have multiple concurrent advisory matters in `Spisy/`, each with its own inputs, tasks and scope. For ongoing corporate support, set `matter_kind: advisory` and `mode: ongoing`; the court and matter reference may remain empty. Store shared company materials at client level according to [`PRACOVNY-PROFIL.md`](./PRACOVNY-PROFIL.md), and link to them from individual matters.

For an individual, record citizenship (`citizenship`) and country of residence (`residence_country`) separately; the country of registration or identifier (`country`) does not replace them. Do not infer these details from the matter’s jurisdiction.

## Screening
Details are unverified on creation. For each attempt, record the register, source material, selected entity identifier, matching method, retrieval time and source currency time (if provided). Outages, incomplete responses and ambiguous matches remain `unverified` with a reason. Preserve new screening as another `screening` record in client memory. Entity registration does not confirm compliance with AML obligations.
