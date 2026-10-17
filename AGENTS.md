# AGENTS.md

LAWOSS is a Czech and Slovak legal practice fork of LegalWork. It helps lawyers run agents, skills, and MCP connectors in a local-first desktop environment.

This file is the single source of truth for people and AI agents working in this repository. `CLAUDE.md` must always contain identical instructions.

## Repository relationship

- Product code lives in this repository.
- Decisions, ADRs, research, specifications, and planning live in [lawOSS-like-SK-CZ](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ). **Both repositories are in the same organisation since 2026-08-14**, so issues can be transferred natively between them.
- The upstream repository is [eigenweltlabs/legalwork](https://github.com/eigenweltlabs/legalwork).
- `origin` must point to `Omni-Legal-Products/lawoss` and `upstream` must point to `eigenweltlabs/legalwork`.
- Sync from upstream release tags, not from arbitrary development commits.

## From idea to implementation

Work reaches this repository **only after it has been decided elsewhere.**

| Repository | What lives there | What does **not** |
|---|---|---|
| [`lawOSS-like-SK-CZ`](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ) | ideas, ADRs, specifications, research, meeting notes — **the source of truth for decisions** | implementation issues, bug reports |
| **`lawoss`** *(this one)* | code, implementation issues and PRs, builds, releases | deciding **whether** a feature gets built |

Rules:

1. An issue here **must link back** to the spec or ADR that authorised it. An implementation issue without that link is missing its decision — open it in the coordination repository instead.
2. **Never copy a spec into this repository.** Link to it. A duplicate drifts.
3. If an issue lands in the wrong repository, do **not** re-create it — use *Issue → ⋯ → Transfer issue*. It works both ways within the organisation and preserves comments and history.
4. Creating these issues is **not automated on purpose**: it would require a PAT stored as a secret for a handful of approved items per week. A human or their agent walks the approved items after each call. Revisit if the volume grows.

## Core philosophy

- **Local-first, cloud-ready:** sensitive legal data should stay on the user's machine unless the user knowingly selects a remote model or worker.
- **Human gate:** an agent may prepare and recommend, but a lawyer must approve legally consequential actions.
- **Portable domain layer:** LAWOSS prompts, skills, templates, and MCP configuration must remain usable outside this fork where practical.
- **Upstream-first:** offer generally useful fixes and localization improvements to LegalWork upstream.
- **Small downstream diff:** prefer adding files to modifying upstream files.
- **Native UI first:** integrate LAWOSS capabilities into existing upstream views and screens wherever possible. MCP, skills, plugins, providers, and settings belong in the native Settings / Integrations flows, using their existing state, permissions, and lifecycle. Do not maintain parallel LAWOSS settings or connector management.
- **Experiments are provisional:** separate experimental screens can validate behavior, but sharing an upstream backend alone does not count as completed production UI integration. Move validated capabilities into native screens through small documented hooks; add a dedicated domain view only where upstream has no suitable surface.
- **Preserve syncability:** every change must keep future release-tag merges practical. During syncs preserve LAWOSS UI, branding, CZ/SK locales and domain behavior; adopt upstream improvements around the smallest documented downstream hooks. Verify the integrated UI, not only conflict-free text.

## Three change zones

| Zone | Scope | Rule |
|---|---|---|
| Green | `lawoss/**`, `apps/app/src/i18n/locales/sk.ts`, `apps/app/src/i18n/locales/cs.ts`, LAWOSS documentation | Preferred location for LAWOSS work. Keep CZ and SK structures explicit. |
| Yellow | Branding, icons, locale registration, and exceptional changes to upstream files | Every modified upstream file must be recorded in `PATCHES.md` in the same PR. Keep the table below ten active rows where possible. |
| Red | `legalwork-legalmemory-knowledge`, `apps/server/src/extensions/`, `opencodeVersion` in `constants.json`, history rewrites | Do not change without a new approved ADR in the coordination repository. |

## Git workflow

- The default branch is `dev`, matching upstream.
- Never push directly to `dev`. Every change goes through a pull request.
- Every PR requires at least one approval and passing required checks.
- Use short-lived branches: `feat/*`, `fix/*`, `loc/*`, `sync/*`, or `chore/*`.
- Use Slovak conventional commit messages, for example `feat: pridať založenie spisu`.
- Never force-push shared branches or rewrite published history.
- Before syncing or pushing, fetch both `origin` and `upstream`.
- Upstream sync branches use `sync/upstream-vX.Y.Z` and merge a release tag.
- Version LAWOSS releases as `v<upstream>-lawoss.<n>`.

## Pull request expectations

- Link the approved specification or ADR when the change implements a LAWOSS feature.
- Run relevant tests and report exact commands and results.
- Include a screenshot or short recording for visible UI changes.
- Update `PATCHES.md` whenever an upstream file changes.
- Keep changes focused. Do not mix cleanup or refactoring with requested work.
- Do not merge when CI is failing or when the required review is missing.

## TypeScript and package management

- Use strict TypeScript.
- Never use `any`, typecasts, or `as` unless necessary and justified.
- Prefer functional patterns, short focused functions, DRY, KISS, and YAGNI.
- Use pnpm. Never use npm or yarn.
- Pin Bun in `PATH` before running package build scripts; invoking a Bun binary by absolute path does not pin the shell commands inside `bun run`. Verify committed bundles by a second identical build.
- Bun SQLite adapters with an explicit close lifecycle should use cached `Database.query()` or explicitly finalize prepared statements; uncached statements can retain WAL/file handles after `close()`. Verify immediate removal on Windows, not just Unix cleanup.
- Server shutdown must drain accepted background work and release its owned database handles. Shared runtime caches close only after the last listener stops; preserve independent runtimes and idempotent shutdown.
- Pin the runtime DB identity while a server owns its config, including accepted asynchronous work. Centralize path resolution and release the pin after cleanup; test every fixture-owned descendant DB so Unix unlink cannot hide a leaked Windows handle.
- Use components from `@/components` when possible.
- Prefer shadcn/ui with Base UI for new components.
- Assume end users are non-technical lawyers.

## Legal and security constraints

- Never commit client data, privileged information, secrets, API keys, certificates, or signing credentials.
- Do not use upstream free models with client, privileged, or matter data.
- Treat technical validity and legal correctness as separate review gates.
- Czech and Slovak legal behavior must be modeled separately where the law differs.
- Do not silently translate Slovak legal concepts into Czech concepts or the reverse.
- Any workflow that sends, signs, files, deletes, or irreversibly changes data requires an explicit human confirmation gate.

## Upstream sync

1. Fetch upstream and tags.
2. Read the upstream release notes.
3. Create `sync/upstream-vX.Y.Z` from `dev`.
4. Merge the exact upstream release tag.
5. Resolve conflicts using `PATCHES.md` as the checklist and walk `docs/upstream-sync-checklist.md` (Eigenwelt and analytics guard, model catalog, branding).
6. Run CI and a desktop smoke test.
7. Open a PR and obtain one approval.
8. Release as `vX.Y.Z-lawoss.1` after merge.

If maintaining a downstream patch becomes disproportionately expensive, prefer removing or redesigning it as a new file or upstream contribution.

## Prompt caching

- The system prompt must not change within a conversation: providers reuse their prompt cache only as far as a request matches the previous one from the start, so one changed line costs the cache for the whole conversation.
- `experimental.chat.system.transform` hooks add fixed text only. Live app state (open files, Office panes, project details, connections) goes into the conversation as a reminder via `app-state-reminders.ts`; per-turn context from the app goes into a hidden part of the user's message (`systemReminderPart`), never the prompt's `system` field.

## Telegram notification routing

- Product repository events go to Telegram topic `LAWOSS APP GH` in group `LawOSS (SLOVAKIA | CZECHIA) + AI Frontier Labs`.
- `TELEGRAM_CHAT_ID` is the repository variable `-1003828145652`.
- `TELEGRAM_TOPIC_ID` is the repository variable `293`.
- `TELEGRAM_TOKEN` is a GitHub Actions secret. Never print, copy, commit, or document its value.
- The workflow is `.github/workflows/telegram-notify.yml`.
- Notify pull requests, issues, releases, and failed CI runs. Do not add routine push notifications without a team decision.
- The coordination repository uses a different topic, `SK Mike GH` with topic ID `2`.
- Setup and recovery instructions live in `docs/telegram-notifications.md`.

## Workspace persistence and recovery

- Treat stable workspace identity, current filesystem root, and app-owned storage key as separate persisted values. Reusing an old filesystem path must not reuse another workspace's identity or outside storage.
- Historical paths and captured session IDs are lookup metadata, never additional filesystem permission. Revalidate mappings against the current canonical root before reading a recovered project's memory or artifacts.
- Use supported engine APIs for changing session execution directories; request headers alone do not prove that tools run in the new directory. Verify with an actual tool invocation and preserve original session/message IDs. Do not edit the engine's internal database.

## Document evidence and resource bounds

- Preserve original source hashes, per-source page numbers and embedded-document provenance. Extraction completeness and pagination completion are different contracts; consumers must follow read cursors and verify current source hashes before presenting fresh evidence.
- Reserve tree-wide attachment budgets before recursive descent. Capacity admission must count actual new records after deduplication/retry planning; a full registry must still permit reuse of an existing preparation.
- Persist original-source admission independently from extraction update time. Restoring earlier bytes must select that original and its descendants after reload; legacy records retain a deterministic fallback and every selected read still verifies current bytes.
- Reuse DocumentPreparation/OCR; missing models or incomplete OCR remain partial. Optional real-model tests use an explicitly selected, pinned/hash-verified isolated cache and must not configure or download into a user profile automatically.

- Treat supplied base text as a concurrency precondition independently from mtime. Filesystem timestamps can be equal for different contents; preserve conflicts, clean merges and explicit force semantics with actual fixed-time HTTP regressions.

## Generated output identity and verification

- Bind exports to actual prepared sources and persisted project identity. Routing IDs are not legal case numbers. Absent optional reference metadata preserves explicit unknown legal fields; a present invalid reference manifest must not silently downgrade to generic mode.
- Validate visible source attribution and coverage as well as machine metadata. An invalid identity companion cannot confer verification on a dependent output, regardless of validation order. Recheck output, source and dependency hashes when displaying persisted verification.
- Parsing legacy coverage prose does not prove extraction coverage. Require verifiable current structured coverage for verified status, including truthful partial/failed results; apply the same rule when listing historical verification receipts.
- Keep file ownership separate from successful inspection. Validating an ordinary file does not authorize overwriting it; generated-output repairs require the registered current hash and caller's expected hash. Format/provenance verification never means legal approval.
- Resolve known copies and canonical aliases within the selected case before deduplicating references. Verify current selected/reference bytes and reject ambiguous official identities; an explicitly listed path with a mismatched hash must not borrow another reference.

## Native document generation

- Background source polling must not starve a user-triggered generation. Keep availability separate from verified display state, and always re-read selected sources before dispatch; failed refreshes and changed sources still fail closed.
- Every native file view that exposes generation must forward the existing scoped callback and persisted project ID; keep the runtime endpoint workspace ID separate. Verify availability on the standalone Files page as well as the chat sidebar.
- Extraction completeness requires coverage of every selected original. Failed refreshes must retract current verification even when query caches retain previously successful data.
- Recursive selection enforces the canonical selected-folder boundary as well as the workspace boundary. Require the server's exact boundary acknowledgment; older servers must not silently widen selection.
- An asynchronous prompt acknowledgment is not task completion. Retain the scoped session through native running/error/terminal states and reload; retries reuse the accepted chat. Associate source selection with ultimate-original IDs and hashes, and correlate each submitted attempt with its engine-visible user-message ID. Completed tool steps and comparisons between client/server clocks are not terminal evidence.
- Probe the captured original SDK transport for engine-directory readiness. A wrapped workspace session list can return cached metadata without proving that the engine is available.
- Release unused transports for known idle sessions. Keep background synchronization for active or waiting runs and remaining reference owners; stale idle evidence must not cancel a newer accepted prompt.
- Use explicit static translation-key maps for native status labels. The CI audit rejects runtime key construction outside the existing LAWOSS domain dictionaries; type safety alone does not prove the audit will pass.
- Starting an existing registered workspace must not recreate a missing source root. Check directory existence before runtime reuse or provisioning in either app-files mode; explicit home/new-project initialization remains a separate operation.
- Native regression must verify the engine actually selected from built resources before and after relaunch. Follow platform-target priority, validate current manifest hashes and executable/health versions, and limit fixture-link cleanup to the link the test owns.
- Native tests use the application's owner-authenticated engine proxy; serialized workspace metadata intentionally omits engine credentials. Isolated macOS fixtures must select the mock keychain before importing production startup.
- After provider configuration changes, use the application's workspace engine-reload endpoint. It awaits derived runtime configuration before rebuilding the engine; low-level instance disposal does not establish that ordering.
- Native UI fixtures explicitly emulate foreground focus on their owned renderer, including after relaunch. Preserve production foreground-only polling and assert real copy IPC, completed artifact paths and original byte hashes rather than obsolete toast text.
- Native protocol fixtures strip only complete documented engine reminder frames before strict JSON parsing and preserve raw tool receipts. Ordinary composer queue admission and direct generation acknowledgment need their own transport assertions plus actual engine terminal evidence.
- Historical engine metadata must account for native application archive timestamps of zero. Use supported archived-inclusive listing before strict directory/captured-ID filtering, while preserving each record archive state and filesystem scope.

- CI diagnostic artifacts must be an explicit bounded allowlist restricted to synthetic fixtures. Record phase/status/timing and typed counts, never raw URLs, headers, bodies, paths, error messages, profiles or source content. Preserve the primary failure across cleanup and wait for actual owned-child exit; do not signal an already-exited leader's process group.
