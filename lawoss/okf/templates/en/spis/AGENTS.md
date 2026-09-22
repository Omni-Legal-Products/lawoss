---
type: agents
title: {{TITLE}} — AGENTS
updated: {{DATE}}
---

# AGENTS.md — {{TITLE}}

Mirrored in `CLAUDE.md`.

First read `{{CARD}}`, `BRAIN.md` (after `okf-memory init`), `_STATUS.md`, `VSTUPY.md` and the complete relevant records in `memory/`. Also load the client’s `../../AGENTS.md`, client card, memory and office rules. For a specific question, search across all record types. Advisory work without proceedings does not require a court or matter reference.

Before saving a file, read `PRACOVNY-PROFIL.md`: it defines the actual folders, their roles and new document naming. Do not alter or overwrite originals; separate identical names using a stable input ID. Save each new draft version separately and retain its link to the original. Mark important messages with a link to the canonical original and its attachments. Without an assigned role, ask where to store the document instead of guessing.

An `advisory` matter in `ongoing` mode may contain recurring assignments and deadlines without court proceedings. Work only with its tasks and inputs; read shared company information from the client. Closing one assignment does not close the ongoing matter.

<!-- okf:protokol-zapisu:v2 -->
## Write protocol

Canonical memory is `memory/`, managed through `okf-memory` and its `BRAIN.md`. Store each fact, event, decision, question, document and task as a record with Truth, History and a source. Keep a deadline only in its relevant memory record; do not create another list in the card or a manual table in `_STATUS.md`. Write through `okf-memory write` with a reason and under the existing authorization, then run `validate` and `sync --apply`. Do not bypass write approval.

First register each new source document or message in the specific matter’s `VSTUPY.md`, with its source, time and `pending` status. Set `processed` only after processing the entire content and recording the resulting IDs. Before handing work over, list unprocessed inputs and read errors. An overview or record type does not replace reading the full relevant content across record types.

`_STATUS.md`, `memory/index.md` and `memory/log.md` are projections. `MEMORY.md` is a legacy archive, not a second active memory. Originals and research are working materials in their respective folders, not a memory archive. Keep `CLAUDE.md` identical to `AGENTS.md` whenever the latter changes.

Sending, signing or filing requires explicit human confirmation. Verify citations to legislation and case law using the available MCP sources; state the source and limitations. Do not guess entity details.
