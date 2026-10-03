# Upstream sync v0.2.1

Prepared merge of upstream release `v0.2.1` (`2019dc65b45860fdd76ff3addf7a1524bbf3c6a6`) into LAWOSS baseline `dev` (`8858366578b506bc3c83f39072e3c0a2ddbbee00`). All 32 textual conflicts were resolved. This document records the merge and local validation for PR review. It does not publish a release, deploy a service, install a plugin, or change a production MCP service.

## Resolution policy

The release is adopted as the product baseline. LAWOSS keeps its local-first legal behavior, branding, UI languages, OKF flows, native integrations, and commercial-surface guards. Upstream project creation, Home, projects, reviews, workflows, search, storage, document tooling, and desktop runtime improvements are retained where they do not replace a downstream decision.

| Area | Resolved behavior |
|---|---|
| Branding and routes | LAWOSS mark, wordmark, theme, sidebar navigation, and `LAWOSS_ROUTES` remain. Experiment routes render through the shared SessionRoute shell. `preserveRoute` prevents session restoration or first-run redirects from replacing an experiment URL. |
| Welcome and projects | The branded LAWOSS welcome and language switcher remain. Its start action opens upstream `CreateProjectModal`, uses named project creation and registration, starts the local engine on desktop, and continues to project Home. `additionalContent` keeps the native OKF panel reachable from the project modal. |
| Settings and integrations | Appearance and language remain visible. The native Extensions surface still contains the LAWOSS file-memory card, NativeCatalog, existing MCP actions, and the OKF skill installation flow. The office profile stays in Personalisation. |
| Commercial boundaries | Upstream account, recorder, AI-plan, firm-sharing, trial, and premium paths remain guarded by the existing LAWOSS flags. The audio and AI onboarding stages advance when their hidden upstream surfaces would otherwise block completion. |
| Local legal workflows | `lawoss/**`, OKF, workspace-memory runtime hooks, document author preference, safe file-write controls, and portable CLI bundles remain downstream-owned. |
| Locales | EN and DE retain the catalog fallback used by upstream. SK and CS keep LAWOSS UI dictionaries and locale registration. Switching UI language does not rewrite existing matter data or change jurisdiction and grants. The existing OKF language selection for newly generated files remains. Built-in review prompt libraries support EN/DE; SK/CS UI selects the English library catalog without changing the UI locale. |

## Upstream v0.2.1 features retained

- Home and project-centric navigation, named projects, source folders, project metadata, notes, recordings, remote folders, sync views, and project files.
- Workflows, tabular review, search, task and notification improvements, document structure and review artifacts, OCR and office editor additions.
- Storage providers, workspace sync events, safe downloads, richer tool presentations, browser and desktop runtime improvements.
- Updated Electron packaging and updater plumbing, release checksums, server search and SystemOne routes, and shared type contracts.

## Conflict inventory

The 32 conflicts cover CI and package metadata, README and locale catalogs, renderer shells and sidebar/settings surfaces, desktop packaging/runtime, server workspace/files/skills/runtime paths, and the lockfile. The resolution keeps the upstream implementation where it supplies a new platform capability and reapplies only the existing LAWOSS seams documented in `PATCHES.md`.

The active downstream adaptations that changed shape in this release are listed in the table appended to `PATCHES.md`. In particular, the upstream workspace dialog became `CreateProjectModal`; its `additionalContent` seam now carries the existing native OKF panel. Historical entries remain as history rather than being removed.

## Verification status

Local validation on macOS arm64 with Node 24.19.0, pnpm 11.4.0 and Bun 1.4.2:

| Command/check | Result |
|---|---|
| `pnpm install --frozen-lockfile` | Passed. The lockfile retains upstream resolutions and only adds LAWOSS font/OKF entries. |
| `pnpm typecheck`; server, OKF and memory `typecheck`; desktop `typecheck:electron` | Passed. |
| `pnpm --filter @legalwork/app test` | 1,001 passed, 0 failed. |
| `pnpm --filter legalwork-server test` | 1,344 passed, 15 skipped, 0 failed. Skips require optional storage services or native OCR installations. |
| `pnpm --filter @legalwork/desktop test` | 248 passed, 1 skipped, 0 failed. The skip checks non-macOS behavior while this run is on macOS. |
| `pnpm --filter @lawoss/okf test` | 154 passed, 0 failed. |
| `pnpm --filter @lawoss/okf-pamat test` | 603 passed, 0 failed. |
| LAWOSS handoff tests | 38 passed, 0 failed. |
| Both portable CLI builds | Passed and byte-identical to the baseline bundles. |
| `pnpm test:e2e` | Passed with the pinned real OpenCode v1.18.29 engine in an isolated HOME/XDG profile. Includes sessions, switch, filesystem engine and browser-entry flows. |
| `pnpm --filter @legalwork/app test:i18n`; `node scripts/i18n-audit.mjs --ci` | Passed: 5,593 English keys; EN/DE/SK/CS complete, matching placeholders. New SK/CS text also received a language correction pass. This is not a professional linguistic certification. |
| `pnpm build` | Full renderer, Office pane, server/plugin and desktop resource build passed. Renderer (`LEGALWORK_ELECTRON_BUILD=1 pnpm build:ui`) and Word pane were rebuilt after the final locale and entitlement guard changes. |
| `pnpm --filter @legalwork/desktop test:preview-security` | Passed in Electron: interactive HTML and blob workers work; desktop and outbound access remain isolated; normal PDF preview works. |
| `node --test scripts/release/*.test.mjs` | 3 passed, 0 failed. |
| Python report evidence and report-from-reviews tests | 7 + 14 passed. |
| Governance and diff checks | AGENTS.md equals CLAUDE.md; no conflict markers; downstream whitespace check clean (two EOF blank lines inherited from v0.2.1 remain); pinned OpenCode and LegalMemory plugin are unchanged. |

### Desktop and Safari smoke

An isolated Electron profile under `/tmp/lawoss-sync-qa` created the synthetic `LAWOSS Sync QA` project through the branded welcome and native project modal. Office onboarding was skipped, permissions were acknowledged, and no Eigenwelt login or subscription was required. Anonymous analytics was false on welcome and remained false in Privacy.

A custom OpenAI-compatible provider at loopback was added through the native UI. Its deterministic local test endpoint returned a streamed assistant answer in a real session. This proves provider configuration and engine transport, not external model quality or a paid provider credential. A local stdio MCP was added through Integrations and reached Ready. The native LAWOSS catalog installed all three bundled OKF skills into this disposable project. The file-memory mapping card and Personalisation/office entry remain present.

Safari MCP checked the built renderer welcome, live language switching, disabled analytics, project modal opening, and wide/narrow layouts. The standalone preview intentionally had no connected backend: project submission was disabled and the UI displayed its connection error. Its repeated localhost connection warnings are recorded as this test limitation, not a successful Safari backend workflow. Full project creation/model/MCP flows were exercised in Electron.

The Electron smoke had no renderer page exceptions. Observed network noise included a transient local analytics identity connection refusal during startup, canceled event streams during route/engine transitions, and an optional `/env/keys` host-token 401 in Integrations. Core custom model, MCP and OKF installation flows succeeded. These warnings are not evidence of external analytics submission; renderer request inspection found no external request during the tested setup and mock-chat sequence.

### Remaining review and release gates

The initial Windows packaging CI built `LAWOSS.exe` successfully, then failed because the inherited smoke matrix looked for `LegalWork.exe`. The matrix now uses the actual LAWOSS product name. A fresh GitHub run must verify the full packaged startup and security steps with this correction.

- PR CI and one human approval are required before merging. Local test results do not substitute for those gates.
- A signed/notarized installer, Windows/Linux UI, real external provider authentication/inference, live cloud storage and native OCR model downloads were not exercised.
- The built-in review prompt library remains EN/DE content with English fallback for SK/CS UI.
- No original profile, production provider configuration, source matter or installed production plugin was changed by the disposable smoke.

No release, deploy, signed installer, updater publication, plugin installation, or production service migration is included in this sync.

### Visual evidence

- [Electron: native LAWOSS catalog and Slovak settings](reviews/upstream-v0.2.1/desktop-integrations-sk.png)
- [Electron: local test provider conversation](reviews/upstream-v0.2.1/desktop-chat-sk.png)
- [Safari: Slovak welcome](reviews/upstream-v0.2.1/safari-welcome-sk.png)
- [Safari: Czech welcome](reviews/upstream-v0.2.1/safari-welcome-cs.png)
- [Safari: narrow Czech layout](reviews/upstream-v0.2.1/safari-welcome-cs-narrow.png)
