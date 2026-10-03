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

## CI follow-up and onboarding integration

The first CI run on `9cacb5883ca6ec5cdeb6a46f6c0fd9888e2bd916` completed with successful Linux/macOS source checks, Linux/Windows packaging, i18n and notification checks. DCO was skipped by the existing fork policy. The only failure was `portable-windows`, run `37145912546`, in `lawoss/okf-handoff/workspace-checkpoint.test.ts`: four unsafe-output symlink tests plus persisted-authority, live-grant revocation and final-grant refresh tests failed because checkpoint creation had already failed. The tests masked the original error by reading an undefined checkpoint path.

Per coordination, merge `7d12b178d6c4462fbaabf7c34e0c98e1a365964a` integrates the exact onboarding head `88d842b9bf088186412fbae6ef49cf94d023a698`, preserving the PR history and branding delta. Local checks on the integrated tree: 16 release tests passed; 252 desktop tests passed with one platform skip; 43 handoff tests passed; Electron typecheck passed.

A separate synthetic Node regression demonstrated an additional identity precision problem in `lawoss/okf-pamat/src/workspace-memory-fs.ts`: distinct inode values `9007199254740992` and `9007199254740993` are both returned as `9007199254740992` by numeric `fstatSync`/`lstatSync`. The memory reader compares the resulting `physical` strings for duplicate sources. The diagnostic test remains outside the repository at `/tmp/lawoss-pr-044-workspace-memory-fs.test.ts`; the shared production fix is owned by the #101 chat. This reproduces the precision defect but does not yet prove it is the only cause of the Windows checkpoint failures.

Final CI after the shared fix is still pending; the successful local checks above do not imply merge approval.

## Shared fixes applied before the final CI run

- Onboarding matter-kind fix `85505395` was cherry-picked as `e4ad4eaa`: contentious matters map to `dispute`, non-contentious matters to `other`. Five focused entity tests and the OKF typecheck passed.
- Exact Windows memory identity fix `9a880b05` was cherry-picked as `d1810609`: `fstatSync`/`lstatSync` use bigint values, including precise identity and timestamp comparisons; the generated memory bundle was included. The regression exercises a real checkpoint with synthetic large file IDs, grant revocation and an actual hardlink. All 606 memory tests, all 43 handoff tests and the memory typecheck passed on this branch.
- OCR test isolation fix `409447c3` was cherry-picked as `5173133d`: the model download test uses a local HTTP server instead of intercepting unrelated engine traffic through a global fetch mock. Both focused OCR tests passed; production download behavior is unchanged.

These are the shared commits supplied by the coordinating chats. No independent competing handoff or OCR implementation was introduced in #44. The final GitHub CI matrix, including Windows and Linux packaging, must still finish on the pushed head; its final result is recorded in the coordinating report and PR description.

The final shared test-fixture follow-up also includes `f055592a` (locally `7397a01b`) and `3e6f0630` (locally `29aec64a`). The embedded app-files fixture waits for both workspace MCP synchronizations before stopping its fake engine; its two process starts, bounded synchronization waits and shutdown receive an explicit 15-second test budget. The combined embedded/OCR run passed all four tests after this final follow-up. These changes affect tests only.
