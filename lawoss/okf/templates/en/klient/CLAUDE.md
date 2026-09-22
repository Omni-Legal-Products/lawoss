---
type: agents
title: {{KLIENT}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{KLIENT}}

Mirrored in `CLAUDE.md`.

First read `{{CARD}}`, `index.md` and the complete relevant records in `memory/`. Shared entities and screening records belong to the client; specific matter content belongs in `Spisy/<matter>/memory/`. Each matter has separate inputs and tasks. When working on a specific matter, also read its `AGENTS.md` and `BRAIN.md`. Checking a register does not establish legal completeness of AML screening.

## Company and ongoing support

A company has one client card and shared materials (for example, incorporation documents and contacts) in the client’s working folders defined by `PRACOVNY-PROFIL.md`. Each separate advisory area has its own matter, for example `Spisy/Corporate-support/` and `Spisy/Employment-law/`, with `matter_kind: advisory` and `mode: ongoing`. When creating it through the CLI, use `--matter-kind advisory --mode ongoing` and the actual jurisdiction, `--sk` or `--cz`. A court, matter reference and opposing party are not required for this advisory work; do not invent them.

Assign each request, task, deadline and incoming message to a specific matter. If the allocation is unclear, mark it unresolved and request a decision; do not create the same task in multiple matters. Link to shared company documents rather than copying them into every matter. Create a separate project or dispute as another matter when it has its own objective and scope; this does not automatically close ongoing support. `okf render <klient>` refreshes the matter list in `index.md`.

<!-- okf:protokol-zapisu:v2 -->
## Write protocol

Canonical memory is `memory/`, managed through `okf-memory` and its `BRAIN.md`. Store each fact, event, decision, question, document and task as a record with Truth, History and a source. Keep a deadline only in its relevant memory record; do not create another list in the card or a manual table in `_STATUS.md`. Write through `okf-memory write` with a reason and under the existing authorization, then run `validate` and `sync --apply`. Do not bypass write approval.

First register each new source document or message in the specific matter’s `VSTUPY.md`, with its source, time and `pending` status. Set `processed` only after processing the entire content and recording the resulting IDs. Before handing work over, list unprocessed inputs and read errors. An overview or record type does not replace reading the full relevant content across record types.

`_STATUS.md`, `memory/index.md` and `memory/log.md` are projections. `MEMORY.md` is a legacy archive, not a second active memory. Originals and research are working materials in their respective folders, not a memory archive. Keep `CLAUDE.md` identical to `AGENTS.md` whenever the latter changes.

Sending, signing or filing requires explicit human confirmation. Verify citations to legislation and case law using the available MCP sources; state the source and limitations. Do not guess entity details.
