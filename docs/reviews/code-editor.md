# Code editor and text autosave

Code and plain-text files open directly in the existing file tabs. The editor includes language colors, line numbers, folding, indentation, bracket matching, completion, search, a diagnostic gutter and a syntax issue panel. Cmd/Ctrl+S uses the file save action.

Bundled language support covers JavaScript, JSX, TypeScript, TSX, Python, JSON, JSONC, YAML, CSS, SCSS, Sass, HTML, XML, SQL, shell and TOML. HTML retains its preview and uses the language-aware editor when Edit is selected. Diagnostics are syntax checks, not project-wide type checking or ESLint. SQL, shell and TOML have highlighting without syntax diagnostics. Editor and parser packages are imported from installed dependencies and ship in Vite's application assets, including relative assets in packaged Electron builds. No CDN, remote language server or runtime package installation is used.

The latest `dev` merges included DOCX autosave in #213. Markdown and text autosave were absent. Markdown, `.txt`, and code files now default to autosave on; explicit per-file choices persist. DOCX keeps its existing default. Saving uses the same 1.5-second debounce and 10-second continuous-typing deadline as DOCX. Read-only sources and explicit working-copy publishing flows do not autosave. Failed writes pause retries and keep the draft. Typing during a save remains dirty and is saved separately. File revisions, merge baselines, ownership handoffs and unsaved-close guards remain in use.

## Verification

- `pnpm --filter @legalwork/app test`: 1,166 passed across 181 files.
- `pnpm --filter @legalwork/app exec bun test tests/code-editor.test.ts tests/markdown-draft.test.ts tests/document-autosave.test.ts tests/document-ownership.test.ts tests/panel-side-pane.test.ts scripts/open-target.test.ts scripts/artifacts.test.ts`: 136 passed after the final handoff changes.
- `pnpm --filter legalwork-server test:artifacts`: 31 passed, including read/write round-trips for the newly supported code extensions and binary-file rejection.
- `pnpm --filter @legalwork/app typecheck`: passed.
- `pnpm --filter @legalwork/app test:i18n`: passed, 5,936 keys in both shipped languages.
- `LEGALWORK_ELECTRON_BUILD=1 pnpm build:ui`: passed. Existing warnings about large chunks and the `sax` stream import remain.
- `pnpm install --frozen-lockfile --lockfile-only`: passed with pnpm 11.4.0.

Browser verification used Chromium with disposable files and the real LegalWork read, write and stat routes. It covered default-on Markdown and text saves, typing during a delayed save, remembered opt-out, manual save, a real conflicting disk edit, paused retries, JSON diagnostics and their correction, and Python/TypeScript rendering in both themes. A two-window check also confirmed that handing off a dirty text file saves its draft before transferring ownership, even with autosave disabled. External resource requests were blocked; none were attempted during the checks. This is browser verification with an Electron-mode production build, not a packaged Electron launch.

## Reproduce

Run these from the repository root in separate terminals:

```sh
pnpm exec bun apps/server/scripts/code-editor-review.ts
PORT=5184 LEGALWORK_VISUAL_PREVIEW=1 pnpm --filter @legalwork/app dev
```

Open `http://localhost:5184/code-editor-review.html`. The server prints its disposable workspace location. To replay the browser checks from a fresh browser session:

```sh
pnpm dlx @playwright/cli --session code-editor-review open http://localhost:5184/code-editor-review.html
pnpm dlx @playwright/cli --session code-editor-review resize 1440 960
pnpm dlx @playwright/cli --session code-editor-review run-code --filename apps/app/scripts/code-editor-review-checks.js
```

The conflict scenario deliberately generates a 409 response. Use a fresh disposable server and browser session for a new replay.
