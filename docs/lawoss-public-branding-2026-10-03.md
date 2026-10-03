# PR #44: public distribution branding

Decision: [ADR 0004](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/decisions/0004-ako-rozsirit-legalwork.md).

Updated on 2026-10-03 in the isolated `LAWOSS-pr-044` worktree. Existing PR history is preserved by merging `origin/dev` at `39a277479c1bc7c3726715be311954fb1eb89d97`.

## Changes

- Preserve current dynamic updater selection, stable/alpha boundaries, appId, deep-link scheme, package identifiers, LICENSE, NOTICE and explicit copyright.
- Resolve `main.mjs` and `PATCHES.md` conflicts. Public help links use the fork's release overview because GitHub `/latest` can select an orchestrator release.
- Publish Linux x64 AppImage links with `x86_64`, consistent with Electron packaging and the current updater.
- Require both explicit `LAWOSS_POSTHOG_KEY` and `LAWOSS_POSTHOG_HOST`. Missing or blank configuration exits successfully before any HTTP. Legacy settings and upstream defaults are ignored, including the legacy statistics token alias in the workflow. No repository variables or secrets were changed.
- Test the statistics CLI with synthetic HTTP only. No real statistics were sent.

## Verification

Node v24.19.0, pnpm 11.4.0. Dependencies installed offline with `pnpm install --frozen-lockfile --ignore-scripts --offline`.

- Regression reproduction: 7 expected failures before fixing Linux links and statistics defaults.
- `node --test scripts/release/*.test.mjs`: 16 passed.
- `pnpm --filter @legalwork/desktop test`: 248 passed, 0 failed, 1 platform-specific test skipped on macOS.
- `pnpm --filter @legalwork/desktop typecheck:electron`: passed.
- `node --check apps/desktop/electron/main.mjs` and `bash -n apps/opencode-router/install.sh`: passed.
- Prettier 3.6.2 applied to the changed release test and statistics scripts; `git diff --check origin/dev` passed. The full merge index relative to the old PR head reports three inherited blank EOF lines in `todo-panel.tsx`, `eigenwelt-intake.test.ts` and `inapp-document-bridge.ts`; those unrelated dev files remain unchanged.
- Root `AGENTS.md` and `CLAUDE.md` remain identical.

Safari MCP rendered the real `WebUnavailableSurface` component with application CSS in a temporary Vite fixture. Checked its accessible disabled content, public link href/target/rel, wide and narrow layouts, console errors and recorded failed requests. After adding a fixture favicon to remove its initial unrelated 404, the final check had no console errors or recorded failed requests. Clicking the link opened `https://github.com/Omni-Legal-Products/lawoss/releases`. Temporary fixture files were removed.

Screenshots: [wide](evidence/pr-044/desktop-link-safari.png), [narrow](evidence/pr-044/desktop-link-safari-narrow.png). This is a component smoke test, not a full application or packaged desktop flow.

Live read-only checks: the release overview and raw router install script returned HTTP 200. GitHub API confirmed `alpha-macos-latest/latest-mac.yml`, `alpha-windows-latest/latest.yml`, and the existing orchestrator v0.1.14 sidecar manifest. Future release assets were not published or downloaded by this task. Legacy `latest.json` compatibility endpoints were not exercised as an active updater flow.

## Remaining integration gates

The coordinating chat owns final integration after #103/#104, the full app/server and packaging CI matrix, review approval and serial merge. None of those approvals or merges is claimed here. No release, deployment, statistics submission or production configuration change was performed.
