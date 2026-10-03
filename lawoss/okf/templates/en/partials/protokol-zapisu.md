<!-- okf:protokol-zapisu:v2 -->
## Write protocol

Canonical memory is `memory/`, managed through `okf-memory` and its `BRAIN.md`. Store each fact, event, decision, question, document and task as a record with Truth, History and a source. Keep a deadline only in its relevant memory record; do not create another list in the card or a manual table in `_STATUS.md`. Write through `okf-memory write` with a reason and under the existing authorization, then run `validate` and `sync --apply`. Do not bypass write approval.

First register each new source document or message in the specific matter’s `VSTUPY.md`, with its source, time and `pending` status. Set `processed` only after processing the entire content and recording the resulting IDs. Before handing work over, list unprocessed inputs and read errors. An overview or record type does not replace reading the full relevant content across record types.

`_STATUS.md`, `memory/index.md` and `memory/log.md` are projections. `MEMORY.md` is a legacy archive, not a second active memory. Originals and research are working materials in their respective folders, not a memory archive. Keep `CLAUDE.md` identical to `AGENTS.md` whenever the latter changes.
