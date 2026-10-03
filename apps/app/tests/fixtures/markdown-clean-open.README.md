# Markdown clean-open browser regression

This exercises the actual `ArtifactMarkdownEditor`, MDXEditor 4.2.3 and
`ArtifactMarkdownPanel`, including React Query refetch. All data is handwritten
and synthetic. File reads and saves use an in-memory client; no workspace,
model, image upload or real file is connected.

The original bug is reproduced by plain `www.example.org` or an email address.
MDXEditor's AutoLink plugin performs a second normalization after the initial
normalization callback, making the unchanged file dirty. The production fix
disables that automatic conversion while retaining explicit links and CreateLink.

## Run

Use Node and pnpm as required by the repository. From `apps/app`, start the
existing Vite configuration in one terminal:

```sh
LEGALWORK_VISUAL_PREVIEW=1 pnpm exec vite --host 127.0.0.1 --port 55183
```

In another terminal, also in `apps/app`, open a **new, dedicated** browser
session. Do not attach to the user's Electron or reuse their browser session.
`pnpm dlx` obtains the Playwright CLI without adding a project dependency.

```sh
set -euo pipefail
pnpm dlx @playwright/cli --session lawoss-markdown-regression open \
  http://127.0.0.1:55183/tests/fixtures/markdown-clean-open.html
LAWOSS_MARKDOWN_REPORT="$(mktemp)"
pnpm dlx @playwright/cli --session lawoss-markdown-regression run-code \
  "$(cat tests/markdown-clean-open.browser.js)" > "$LAWOSS_MARKDOWN_REPORT"
node --input-type=module - "$LAWOSS_MARKDOWN_REPORT" <<'JS'
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
const output = readFileSync(process.argv[2], "utf8");
const match = /^### Result\r?\n([^\r\n]+)/m.exec(output);
assert.ok(match, "No completed browser result; CLI exit 0 alone is not a PASS");
const result = JSON.parse(match[1]);
assert.equal(result.checks, 18, "All 18 regression assertions must finish");
assert.equal(result.results.length, 18);
console.log(JSON.stringify(result, null, 2));
JS
pnpm dlx @playwright/cli --session lawoss-markdown-regression close
```

Stop only the Vite process started above with Ctrl-C. Keep the temporary report
as evidence. If a command fails, close the dedicated browser session explicitly.
The script rejects pages outside this localhost fixture and handles beforeunload
only while moving between its independent synthetic scenarios.

## Expected results and limits

The current fix passes **18 assertions**: exact clean open; explicit links;
focus, toolbar Tab navigation, source/rich switching and prop refresh; real
typing, undo/redo content protection and save; CreateLink; exact source whitespace
edits and restoration; read-only behavior; full-panel open, focus refetch,
external updates, draft preservation and source save.

**Known limitation, not a passing clean-state assertion:** after real rich-text
editing, Undo can restore canonical Markdown rather than the original byte
representation. Original bullet formatting, bracket escaping and final blank
lines can therefore leave `dirty=true`. This predates and is separate from
the automatic-link clean-open bug, tracked in [issue #90](https://github.com/Omni-Legal-Products/lawoss/issues/90). The JSON result records it under
`knownLimitations`; it must not be described as successful exact-byte undo.
Restoring the exact original text in Source mode does return to clean.

To reproduce that separate limitation as a failing assertion, open the same
fixture with `?strictUndo=1` in the dedicated session and run the same script.
It must currently fail with `Known limitation: undo leaves canonical Markdown
dirty instead of restoring exact original bytes`.

Tab inside editable rich text can insert an actual tab character. The clean
navigation assertion therefore uses toolbar Tab navigation; real text input
continues to produce a dirty draft. Browser checks use animation frames to
settle rendering, not a timer-based suppression of changes.

These checks are opt-in and are not part of `bun test tests/`. They verify real
browser components with an in-memory file boundary, not the live Electron,
network authorization, file locking or real persistence. The existing
`pnpm exec bun test tests/markdown-draft.test.ts` covers draft/refetch/save races.
