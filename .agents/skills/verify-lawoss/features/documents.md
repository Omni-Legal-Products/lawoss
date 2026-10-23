# Documents

A selected matter displays the actual document and keeps document questions tied to that matter.

## Sub-features

- `document`: open a synthetic Markdown/PDF/DOCX document, verify current bytes and provenance, then ask a question with an explicitly configured test provider.

## How to get to it (user POV)

Select a client and matter, open its Files panel and choose the document. Use its normal conversation entry point for the question.

## Driving it with native alpha runner

Preconditions: pinned synthetic documents copied into the selected matter; a tested synthetic provider for the inference part.

- Open each supported representative format. Compare a known phrase/page against the source and record selection, visible result and file hash.
- Ask a question whose answer requires the selected document. Observe a completed model response and the correct matter context.
- Attempt the same flow without a model; verify an actionable error and no fallback provider or fabricated answer.

## Gotchas

An HTTP acknowledgement is not a completed answer. Rendering one document does not prove every format; distinguish missing native viewer/OCR dependencies from a content parsing success.
