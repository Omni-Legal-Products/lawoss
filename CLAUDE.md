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
- Match verification runtimes to the active CI workflow and select exact executable paths when several versions are installed. Keep results from other local runtimes as supplemental evidence, not a substitute for the CI-matching gate.
- Pin Bun in `PATH` before running package build scripts; invoking a Bun binary by absolute path does not pin the shell commands inside `bun run`. Verify committed bundles by a second identical build.
- Bun SQLite adapters with an explicit close lifecycle should use cached `Database.query()` or explicitly finalize prepared statements; uncached statements can retain WAL/file handles after `close()`. Verify immediate removal on Windows, not just Unix cleanup.
- Embedded desktop connection credentials come from the private in-process handle matched to the public workspace ID. Public workspace serialization stays credential-free; verify fresh managed/external authentication and reuse/restart with the postbuild Node runtime seam.
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

- Capture the canonical database path and generation in its lifetime owner. Async request/producer work must keep that owner until completion; stopping one server must preserve another live server's borrowed stores, watchers and accepted pending synchronization.
- Failed native close is not released ownership. Retain the exact failed resource and both initialization/cleanup errors for explicit captured-generation recovery; close successful siblings only once and keep successor readiness blocked until cleanup succeeds.
- Verify database release using real Bun and Node drivers, own-process handles and normal directory removal while the process stays alive. A returned close call or garbage collection is not proof that retained prepared statements released their native handles.
- Propagate caller cancellation through upstream requests and bounded metadata reads without dropping their timeout. A released reader lock does not cancel an owned body: disconnect during an idle read and a response returned after disconnect both require explicit cleanup, listener removal and primary-error preservation. Keep completed responses, detached accepted work and unrelated live streams independent.
- Test fixture restoration must enclose awaited startup and survive teardown rejection. Restore shared logger/environment functions unconditionally, preserve the original setup/stop error, and prove owned listener release without letting a baseline failure hide later diagnostics.
- Real child fixtures must coordinate descendant readiness, direct exit and post-publication writes with explicit handshakes. An independent wall-clock writer can finish before a delayed driver attaches; preserve strict pipe-close assertions and bounded owned cleanup instead of increasing collector budgets.
- Windows descendant fixtures that require survival after parent exit must request detached lifetime as well as unref; unref alone only changes event-loop accounting. Keep inherited stdio and prove bounded cooperative cleanup with the same strict oracle on actual Windows.
- On Windows, compare supported separator spelling only after lstat/realpath of the original parent. Do not normalize traversal or inspect a different lexical path before physical validation; keep symlink, dot-component and file-handle identity refusals covered by actual filesystem tests.
- Manually driven sync fixtures must stop automatic project and task producers through their real disposers while retaining the runtime lifetime. A long periodic interval does not suppress change-driven debounces; timer and overlapping-owner tests must explicitly retain background owners.
- Keep authoritative session status observed only while synchronization has tracked owners. Short UI query GC must not erase idle evidence needed for final transport release; remove bounded observers on last reference/disposal, preserve normal postrelease GC, enabled UI refresh and conservative accepted/busy/unknown/error/wait guards.

- Preserve original source hashes, per-source page numbers and embedded-document provenance. Extraction completeness and pagination completion are different contracts; consumers must follow read cursors and verify current source hashes before presenting fresh evidence.
- Reserve tree-wide attachment budgets before recursive descent. Capacity admission must count actual new records after deduplication/retry planning; a full registry must still permit reuse of an existing preparation.
- Persist original-source admission independently from extraction update time. Restoring earlier bytes must select that original and its descendants after reload; legacy records retain a deterministic fallback and every selected read still verifies current bytes.
- Reuse DocumentPreparation/OCR; missing models or incomplete OCR remain partial. Optional real-model tests use an explicitly selected, pinned/hash-verified isolated cache and must not configure or download into a user profile automatically.

- Treat supplied base text as a concurrency precondition independently from mtime. Filesystem timestamps can be equal for different contents; preserve conflicts, clean merges and explicit force semantics with actual fixed-time HTTP regressions.

- Doctor probe tests must exercise the actual manager through restored builtin bindings in an isolated process. Preserve primary startup-error identity and error lifecycle; configured spawnSync timeout does not prove strict native termination or process-tree closure.

- Expected startup-failure fixtures must isolate automatic doctor probes from ambient binaries, deny unowned subprocess attempts before execution, and assert guard counts independently because diagnostics may catch the denial.

## Generated output identity and verification

- Bind exports to actual prepared sources and persisted project identity. Routing IDs are not legal case numbers. Absent optional reference metadata preserves explicit unknown legal fields; a present invalid reference manifest must not silently downgrade to generic mode.
- Export and validation selection uses original prepared IDs; descendants are included automatically and cited separately. Output parents must already exist. Return bounded typed caller errors for invalid child selection or missing requested parents; do not create directories, filter invalid sources, catch unrelated I/O or relax ownership/CAS.
- Validate visible source attribution and coverage as well as machine metadata. An invalid identity companion cannot confer verification on a dependent output, regardless of validation order. Recheck output, source and dependency hashes when displaying persisted verification.
- Parsing legacy coverage prose does not prove extraction coverage. Require verifiable current structured coverage for verified status, including truthful partial/failed results; apply the same rule when listing historical verification receipts.
- Keep file ownership separate from successful inspection. Validating an ordinary file does not authorize overwriting it; generated-output repairs require the registered current hash and caller's expected hash. Format/provenance verification never means legal approval.
- At the native model-tool boundary, missing or literal-empty expected hash means create-only absence: omit the HTTP property completely. Reject invalid nonempty hashes and null; never convert a wrong hash to absence. Verify actual advertised wire schema separately from strict tool execution and HTTP validation because engine serialization can broaden format constraints.
- Resolve known copies and canonical aliases within the selected case before deduplicating references. Verify current selected/reference bytes and reject ambiguous official identities; an explicitly listed path with a mismatched hash must not borrow another reference.

## Native document generation

- Extraction completeness requires coverage of every selected original. Failed refreshes must retract current verification even when query caches retain previously successful data.
- Recursive selection enforces the canonical selected-folder boundary as well as the workspace boundary. Require the server's exact boundary acknowledgment; older servers must not silently widen selection.
- An asynchronous prompt acknowledgment is not task completion. Retain the scoped session through native running/error/terminal states and reload; retries reuse the accepted chat. Associate source selection with ultimate-original IDs and hashes, and correlate each submitted attempt with its engine-visible user-message ID. Completed tool steps and comparisons between client/server clocks are not terminal evidence.
- Preserve selected workspace client identity across metadata refresh using the resolver's effective connection and application-owner primitives. Keep auth fallback/nullish precedence and actual token/server/workspace/classification invalidation; filesystem root stays independently current in query and execution scope. Recreated metadata must not replace same-scope query ownership or detach a pending native picker.
- Probe the captured original SDK transport for engine-directory readiness. A wrapped workspace session list can return cached metadata without proving that the engine is available.
- Release unused transports for known idle sessions. Keep background synchronization for active or waiting runs and remaining reference owners; stale idle evidence must not cancel a newer accepted prompt.
- Use explicit static translation-key maps for native status labels. The CI audit rejects runtime key construction outside the existing LAWOSS domain dictionaries; type safety alone does not prove the audit will pass.
- Starting an existing registered workspace must not recreate a missing source root. Check directory existence before runtime reuse or provisioning in either app-files mode; explicit home/new-project initialization remains a separate operation.
- Native regression must verify the engine actually selected from built resources before and after relaunch. Follow platform-target priority, validate current manifest hashes and executable/health versions, and limit fixture-link cleanup to the link the test owns.
- Historical engine metadata must account for native application archive timestamps of zero. Use supported archived-inclusive listing before strict directory/captured-ID filtering, while preserving each record archive state and filesystem scope.

- Build-time engine dependency payloads must contain genuine installed packages and a complete lock generated by the pinned installer API, never root-only compatibility metadata. Keep pnpm tooling and SDK locks separate. Compare a detached locked graph before materialization and verify physical closure afterward; offline and save:false alone do not freeze resolution. Preserve platform optional metadata, identify the native build target, and validate relocation/imports before publication. Do not infer runtime config-directory coverage from a successful artifact build. Side-effect refusal tests must fail before worker/client creation; deny network at ordinary test entry and propagate that guard into sanitized child environments. Observe owned child close before deleting its stage; process-list absence is not a close receipt.
- CI diagnostic artifacts must be an explicit bounded allowlist restricted to synthetic fixtures. Record phase/status/timing and typed counts, never raw URLs, headers, bodies, paths, error messages, profiles or source content. Preserve the primary failure across cleanup and wait for actual owned-child exit; do not signal an already-exited leader's process group.
- Freeze a native failure stage before secondary probes or cleanup. Mark response headers and JSON body completion separately; a successful status alone is not a completed read. Classify only exact source-issued failure codes, never raw error text. Preserve the primary error, request sequence and original deadlines.
- Inspect composer state only through fixed, scoped projections within the existing UI evaluation. An effect-published getter has no freshness proof: distinguish its observed draft from DOM state and actual transport. Reuse an existing send as the positive control; bounded diagnostics must add no model work and must retain unknown when evidence is missing.
- Initial UI enablement and global health do not prove selected-directory engine initialization. Consume the authenticated instance response and verify exact scope within the original absolute startup budget; do not probe a missing historical root during move recovery. Keep JSON syntax failures content-free without exposing parser cause, while preserving transport and deadline error identity.
- Native provider setup must use the authenticated host workspace reload contract for directory normalization, existing readiness and MCP restoration. Config persistence, provider catalogue discovery and actual engine tool/file execution prove different boundaries; a partial native pass does not close the whole gate.
- Ordinary Bun tests must defer native browser-only fixture imports until the native entry point. Keep mixed Bun/Node discovery separate with explicit source paths, preserving package cwd/preloads and dedicated postbuild Node gates; update finite CI selections deliberately.
- SSR fixtures must install one complete Storage object at global and window before awaited production imports, then restore descriptors even on setup failure. Persistence captures its storage adapter: byte/rehydration fixtures must explicitly own and restore the supported live adapter and restore state before releasing it. Prove test order from actual runner headers, not argv order.
- Startup diagnostics distinguish selected-instance request, headers, whole body and scope verification. Ownership diagnostics retain bounded allowlisted counts before refusal; controlled sequence adapters preserve production defaults and every individual identity recheck. Admit late process identities from the same fresh snapshot only while a verified living member anchors ownership, and give each admitted identity its own fresh per-PID signal check. Discovery, signaling and waiting share one unchanged absolute phase budget; first-seen unanchored survivors remain a refusal.
- Failure-only fixture timing must preserve original assertions, clocks, deadlines and natural cleanup. A runner-owned timeout is separate from a caught fixture error; capture incomplete state on cleanup entry and leave later unobserved continuations unknown. Never warm stores or add waits to diagnose a timing failure.
- Distinguish a fixture latency cutoff from a product SLA. After measured late-but-preserved work, behavioral tests may await the real event within the existing runner budget; prove lost scheduling still fails. Cleanup that already began must prevent late setup from installing a new waiter or starting more work.
- Isolated engine rebuild experiments must keep raw child diagnostics inside their private owned root; only a closed validated projection may reach uploader paths. A late writer after timeout must not mutate publication. Report native cleanup failures as unknown independently of direct-child exit, and keep original release failures authoritative. Separate spawn, pipe failure and direct-child exit metadata; source-shaped stderr summaries are untrusted observations, never authenticated causes or raw diagnostic content. Test bodies may continue after a runner timeout: capture the observer per body and freeze its bounded statement evidence before cleanup awaits. Preserve the original cleanup order and primary errors; a pending statement is not proof of its inner await or a product defect. Observe public-source build progress passively through fixed, separately framed stream markers without changing entry semantics; missing markers do not prove nonreach, and a successful diagnostic job does not make an unknown experiment pass.
- A compile exception monitor must first prove non-suppressing delivery on the exact pinned runtime with a real native resolver failure. Check exact entry/argv before registration, precompute canonical source identities, and emit only closed finite projections; an inherited preload must stay silent in other entries. Windows test maps must use the same canonical case convention as production maps.
- Inner invocation diagnostics preserve original await/return adoption and operation/error identity. Supply the optional observer only from the explicit test opt-in, allocate no observer wrapper when absent, and freeze a separate closed protocol at the original cleanup boundary; a pre-status checkpoint does not prove status completion.

- Fixed-environment behavioral probes must preserve the default harness and original binary, admit only current first-attempt synthetic CI, and bind producer acknowledgment separately from live environment observation. Protect reserved publication names using target-filesystem equivalence, including case aliases. Require unchanged before/after file and manifest identity for altered classifications; descendant completion and causal equivalence remain unknown.
- A separate pinned-binary runtime metadata smoke proves only executable identity and preload capability. Keep it failure-only after the primary CI gate, with synthetic home/minimal environment, bounded output and an actually exited owned child; it cannot turn failed application startup green.
- Test synthetic environment paths with host-native absolute paths and exact expected environment maps. A loader-platform argument does not change node:path semantics; a POSIX literal prefix can pass locally and fail on Windows. Treat path.win32 counterexamples as path-model evidence, not Windows execution. Convert file URLs with node:url fileURLToPath before passing script filenames to child processes; URL.pathname keeps URL syntax and escaping. Conversely, Node --import takes an ESM specifier: use pathToFileURL for native preload filenames, retain native paths for Bun preload variables, and test spaces/#/% encoding.
- Default engine-file observations are startup-failure-only and synthetic-CI-only: bind the canonical owned root after unchanged preflight, read one bounded regular file with containment/identity checks, and project strict source-verified enums/counts. Keep engine-run observations separate from selected-directory evidence; batching, missing records and unsupported filesystem identities remain unknown. A fresh-process failure diagnostic never overrides the original failed suite.
- Network diagnostics use Network monotonic timestamps and document/loader epochs. Keep bounded current and historical observations separate, report dropped correlations, and probe the actual failing/selected case; observed pending requests are not a live socket census. Helper regressions importing built server modules must run after the existing CI server build.

- Metadata-only snapshot updates are not new execution evidence. Keep existing cached execution status aligned with authoritative native publications; preserve current errors until native recovery or ordered nonreverted raw messages prove newer accepted work. Resolve authoritative message identities before UI conversion can replace them. Read-local ordering must distinguish explicit native/accepted actions, scoped validated HTTP completions and native waiting/compaction guards from manual hydration, including initially absent records and same-status actions. Capture the producing read scope; current Query options do not prove it. Protect activity newer than a poll while preserving ordinary fresh-poll recovery without SSE. Fold status authority and activity guards separately; activity cleanup cannot erase already observed terminal status. Keep scope credentials nonserializable, release subscriptions with the read, and preserve accepted/waiting/compacting guards. Canonical and rendered history must share the proved raw/UI boundary; if both aliases coexist, cut at the earliest proved occurrence.
- Snapshot fallback reads share one original operation deadline and caller cancellation through headers and bodies. Replace only an exact active stale read when its authoritative cursor changes; initial-read deduplication belongs to the existing tracked query lifetime and must clear with it. Incomplete history needs a visible localized failure even when live transcript data exists without a successful snapshot.

- Discover engine SDK configuration roles from an immutable snapshot of the actual child environment, process cwd and native home. Match pinned source ordering, Git worktree boundaries and exact logical-string deduplication; role discovery does not grant filesystem ownership. Preserve native Windows drive-key case semantics using captured inputs, without consulting later process state. Treat cancellation or discovery-budget exhaustion as refusal rather than a non-Git fallback.

- Separate exact locked-artifact acquisition from dependency resolution and offline replay. Validate the complete URL/integrity allowlist before any request, reject redirects/retries and preserve one absolute acquisition deadline. Cross-runtime import evidence must identify the consumer executable separately from the Node-bound producer receipt.

- A dependency stream close does not prove that backing asynchronous cache writes have settled. Use a supported awaited completion API for publication and cancellation, retain the primary error and hold owned admission until known writes settle.

- Build-tool installation must verify its tools-local manifest/version through the same resolver context used by the consumer; an ancestor package or zero installer exit alone is insufficient. On Windows capture exactly the first native application before environment sanitization: Get-Command with CommandType can enumerate several paths even without All. Retain PATHEXT and require a fresh native exit status. A launcher path does not pin its nested interpreter; where an exact Node is required, validate the genuine package CLI and invoke it with that captured Node. Pass generic pnpm config values as one quoted --config.key=value argument; a separated value can become an unintended package operand. Verify the complete native argv in offline reproductions, including absence of leftover positional values.

- A helper running under a different executable must preserve the engine npm constructor context explicitly: captured environment, cwd, engine execPath/argv and npmPath. Config.load completion alone does not prove every source layer loaded; distinguish ordinary missing files from recorded read/validation failures before mutating dependencies.
- Tests must compare ambient process environment using content-free booleans; deep-equality diagnostics can disclose credentials on failure. A truncation after buffered subprocess capture is not a streaming resource bound; preserve that distinction in validation reports.
- Shared dependency leases use the engine exact logical key, not a private realpath mutex. Retain the lease until owned work settles and heartbeat writes drain; preserve both the primary I/O error and a simultaneous handle-close failure instead of masking it in finally.
- Prepare existing dependency targets under the shared lease, retain bounded original and observed metadata privately, and verify the actual required SDK graph after reify. A successful installer return is insufficient; never restore metadata blindly over concurrent changes.
- HTTP-cache validation must use the consumer exact metadata representations and genuine offline readback. Join the disposable writer process before passing its cache to tests or removing its owned root; retain failures when metadata drifts.
- Managed-engine readiness must validate the registered instance-free API health payload under the original absolute startup budget. A UI fallback, arbitrary HTTP response or headers alone cannot establish readiness.
- Preserve completed phase receipts when later work fails, and bind finite failure diagnostics to the actual phase and positively closed child. Mixed stderr or absent receipts must remain unknown rather than becoming guessed causes or success.

- Tool-version checks through Corepack shims can bootstrap downloads under a new HOME. For offline validation, verify the genuine cached package CLI and invoke it with the captured exact Node executable and network bootstrap disabled.

- Validate packaged dependency closures from a relocated owned tree with the original stage unavailable and physical module resolutions confined to the relocated tree. Preserve all package files and notices; generated CLI shims are separate from dependency contents.

- A failed required check holds the commit, including a run with missing build prerequisites. Restore the CI-matching setup and obtain a covering PASS first; report failures outside ownership before committing.
