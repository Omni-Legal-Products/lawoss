# AGENTS.md

LAWOSS is a Czech and Slovak legal practice fork of LegalWork. It helps lawyers run agents, skills, and MCP connectors in a local-first desktop environment.

This file is the single source of truth for people and AI agents working in this repository. `CLAUDE.md` must always contain identical instructions.

## Synthetic OKF test dataset

A complete prebuilt Slovak synthetic office is available for testing. **Download and reuse it; do not regenerate it for routine tests.** Read [the dataset guide](SYNTHETIC_DATA.md) for the pinned download, SHA-256, setup commands and coverage limits. The machine-readable catalog is [synthetic-dataset.json](synthetic-dataset.json).

- Use this dataset for OKF onboarding, sorting, client/matter scaffolds, document parsing, memory and edge-case tests. Select relevant fixtures; do not load the entire corpus into context.
- Reuse a checksum-verified local download. Extract under ignored `.work/synthetic-sk/`; run write tests on disposable copies.
- Keep `ground-truth/` and validation answers outside the tested model's source selection. Open a selected office/client/matter rather than the package root.
- Distinguish expected scenario results from observed application behavior. Synthetic legal content is not verified legal guidance. Record actual checks and limitations.

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
- For synchronous Word LCS alignment, materialize immutable XML-derived keys once after the size admission check. Keep revision/formatting assertions at the real DOCX comparison boundary and preserve the existing size and test-time limits.
- Static network guards must distinguish typed method declarations from calls while still scanning the complete method body. Preserve mutation regressions for real network calls when refining a classifier.
- Never use `any`, typecasts, or `as` unless necessary and justified.
- Prefer functional patterns, short focused functions, DRY, KISS, and YAGNI.
- Use pnpm. Never use npm or yarn.
- Match verification runtimes to the active CI workflow and select exact executable paths when several versions are installed. Keep results from other local runtimes as supplemental evidence, not a substitute for the CI-matching gate.
- Run filtered server Bun tests through `pnpm --filter legalwork-server exec bun test src/...` so the server bunfig/preload is loaded. Running server test paths from the repository root omits fixture-only upstream service opt-ins and can create unrelated authorization failures.
- Pin Bun in `PATH` before running package build scripts; invoking a Bun binary by absolute path does not pin the shell commands inside `bun run`. Verify committed bundles by a second identical build.
- Cross-platform Bun test commands use explicit test directories instead of shell-expanded globs. Windows workflow steps with multiple native commands need an explicit fail-fast shell so a later success cannot mask an earlier failure.
- Windows tree watchers use native recursion at the tree root; descendant directory handles can block parent renames even with delete sharing. Mutation regressions acknowledge a real nested watch event before renaming and verify subsequent events and resource bytes. Preserve unnamed-event rescans and ignore filters for every relative path component.
- Enter workspace bootstrap suppression before bundled writes and retain its config/workspace/root ownership across watcher restarts. Refresh current live baselines before release; preserve unrelated roots, config and plugin events, and release on producer failure.
- MSYS2 setup with package caching needs `pacman-contrib` explicitly installed: its cache-pruning phase invokes `paccache` before later QEMU dependency steps.
- Source-download fallbacks must serve the same pinned archive bytes and pass the existing digest check before extraction. Preserve version, target and license collection; an acquisition failure does not establish a runtime-test failure.
- Packaged security checks take the `.app` bundle root on macOS and the executable on Linux/Windows. Use the matrix security target, which also identifies packaged resources, rather than the launch executable.
- Bun SQLite adapters with an explicit close lifecycle should use cached `Database.query()` or explicitly finalize prepared statements; uncached statements can retain WAL/file handles after `close()`. Verify immediate removal on Windows, not just Unix cleanup.
- Embedded desktop connection credentials come from the private in-process handle matched to the public workspace ID. Public workspace serialization stays credential-free; verify fresh managed/external authentication and reuse/restart with the postbuild Node runtime seam.
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

- Initial and periodic background synchronization share generation-scoped admission/backoff across metadata rerenders. Pause unavailable roots until explicit reconnect or root/capability change, retain unrelated workspaces, and reject late responses from retired generations.

- Treat stable workspace identity, current filesystem root, and app-owned storage key as separate persisted values. Reusing an old filesystem path must not reuse another workspace's identity or outside storage.
- Historical paths and captured session IDs are lookup metadata, never additional filesystem permission. Revalidate mappings against the current canonical root before reading a recovered project's memory or artifacts.
- Use supported engine APIs for changing session execution directories; request headers alone do not prove that tools run in the new directory. Verify with an actual tool invocation and preserve original session/message IDs. Do not edit the engine's internal database.

## Document evidence and resource bounds

- Capture the canonical database path and generation in its lifetime owner. Async request/producer work must keep that owner until completion; stopping one server must preserve another live server's borrowed stores, watchers and accepted pending synchronization.
- Failed native close is not released ownership. Retain the exact failed resource and both initialization/cleanup errors for explicit captured-generation recovery; close successful siblings only once and keep successor readiness blocked until cleanup succeeds.
- Verify database release using real Bun and Node drivers, own-process handles and normal directory removal while the process stays alive. A returned close call or garbage collection is not proof that retained prepared statements released their native handles.
- Propagate caller cancellation through upstream requests and bounded metadata reads without dropping their timeout. A released reader lock does not cancel an owned body: disconnect during an idle read and a response returned after disconnect both require explicit cleanup, listener removal and primary-error preservation. Keep completed responses, detached accepted work and unrelated live streams independent.
- Test fixture restoration must enclose awaited startup and survive teardown rejection. Restore shared logger/environment functions unconditionally, preserve the original setup/stop error, and prove owned listener release without letting a baseline failure hide later diagnostics.
- Browser API adapters in tests must have fixture-scoped ownership: drain their scheduled callbacks and restore the exact original global descriptor before later SSR imports. A leaked animation scheduler can turn temporary SSR window state into asynchronous browser work.
- Real child fixtures must coordinate descendant readiness, direct exit and post-publication writes with explicit handshakes. An independent wall-clock writer can finish before a delayed driver attaches; preserve strict pipe-close assertions and bounded owned cleanup instead of increasing collector budgets.
- Windows descendant fixtures that require survival after parent exit must request detached lifetime as well as unref; unref alone only changes event-loop accounting. Keep inherited stdio and prove bounded cooperative cleanup with the same strict oracle on actual Windows.
- On Windows, compare supported separator spelling only after lstat/realpath of the original parent. Do not normalize traversal or inspect a different lexical path before physical validation; keep symlink, dot-component and file-handle identity refusals covered by actual filesystem tests.
- Manually driven sync fixtures must stop automatic project and task producers through their real disposers while retaining the runtime lifetime. A long periodic interval does not suppress change-driven debounces; timer and overlapping-owner tests must explicitly retain background owners.
- Keep authoritative session status observed only while synchronization has tracked owners. Short UI query GC must not erase idle evidence needed for final transport release; remove bounded observers on last reference/disposal, preserve normal postrelease GC, enabled UI refresh and conservative accepted/busy/unknown/error/wait guards. Native idle can share a clock tick with a quota error: final-reference release may use the latest nonerror native idle evidence only in its exact nonnull transport scope; preserve newer-error, accepted-work, waiting and compaction guards.

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

- Background source polling must not starve a user-triggered generation. Keep availability separate from verified display state, and always re-read selected sources before dispatch; failed refreshes and changed sources still fail closed.
- Every native file view that exposes generation must forward the existing scoped callback and persisted project ID; keep the runtime endpoint workspace ID separate. Verify availability on the standalone Files page as well as the chat sidebar.
- Extraction completeness requires coverage of every selected original. Failed refreshes must retract current verification even when query caches retain previously successful data.
- Recursive selection enforces the canonical selected-folder boundary as well as the workspace boundary. Require the server's exact boundary acknowledgment; older servers must not silently widen selection.
- An asynchronous prompt acknowledgment is not task completion. Retain the scoped session through native running/error/terminal states and reload; retries reuse the accepted chat. Associate source selection with ultimate-original IDs and hashes, and correlate each submitted attempt with its engine-visible user-message ID. Completed tool steps and comparisons between client/server clocks are not terminal evidence.
- Preserve selected workspace client identity across metadata refresh using the resolver's effective connection and application-owner primitives. Keep auth fallback/nullish precedence and actual token/server/workspace/classification invalidation; filesystem root stays independently current in query and execution scope. Recreated metadata must not replace same-scope query ownership or detach a pending native picker.
- Probe the captured original SDK transport for engine-directory readiness. A wrapped workspace session list can return cached metadata without proving that the engine is available.
- Release unused transports for known idle sessions. Keep background synchronization for active or waiting runs and remaining reference owners; stale idle evidence must not cancel a newer accepted prompt.
- Use explicit static translation-key maps for native status labels. The CI audit rejects runtime key construction outside the existing LAWOSS domain dictionaries; type safety alone does not prove the audit will pass.
- Starting an existing registered workspace must not recreate a missing source root. Check directory existence before runtime reuse or provisioning in either app-files mode; explicit home/new-project initialization remains a separate operation.
- Native regression must verify the engine actually selected from built resources before and after relaunch. Follow platform-target priority, validate current manifest hashes and executable/health versions, and limit fixture-link cleanup to the link the test owns.
- Native tests use the application's owner-authenticated engine proxy; serialized workspace metadata intentionally omits engine credentials. Isolated macOS fixtures must select the mock keychain before importing production startup.
- After provider configuration changes, use the application's workspace engine-reload endpoint. It awaits derived runtime configuration before rebuilding the engine; low-level instance disposal does not establish that ordering. Match the application client's operation-specific reload deadline instead of a generic fetch default.
- Global engine health and enabled renderer controls do not prove workspace bootstrap completion. Before mutating native fixture configuration, await an authenticated instance-scoped readiness response with a valid body and its own bounded startup deadline; retain the separate production reload contract.
- Native UI fixtures explicitly emulate foreground focus on their owned renderer, including after relaunch. Preserve production foreground-only polling and assert real copy IPC, completed artifact paths and original byte hashes rather than obsolete toast text.
- Native acceptance serves the built renderer via loopback preview, matching the UI artifact produced by desktop CI. Fail before launch if the build is missing; do not fall back to development compilation or weaken readiness assertions.
- Native protocol fixtures strip only complete documented engine reminder frames before strict JSON parsing and preserve raw tool receipts. Ordinary composer queue admission and direct generation acknowledgment need their own transport assertions plus actual engine terminal evidence.
- Historical engine metadata must account for native application archive timestamps of zero. Use supported archived-inclusive listing before strict directory/captured-ID filtering, while preserving each record archive state and filesystem scope.

- Build-time engine dependency payloads must contain genuine installed packages and a complete lock generated by the pinned installer API, never root-only compatibility metadata. Keep pnpm tooling and SDK locks separate. Compare a detached locked graph before materialization and verify physical closure afterward; offline and save:false alone do not freeze resolution. Preserve platform optional metadata, identify the native build target, and validate relocation/imports before publication. Do not infer runtime config-directory coverage from a successful artifact build. Side-effect refusal tests must fail before worker/client creation; deny network at ordinary test entry and propagate that guard into sanitized child environments. Observe owned child close before deleting its stage; process-list absence is not a close receipt.
- CI diagnostic artifacts must be an explicit bounded allowlist restricted to synthetic fixtures. Record phase/status/timing and typed counts, never raw URLs, headers, bodies, paths, error messages, profiles or source content. Preserve the primary failure across cleanup and wait for actual owned-child exit; do not signal an already-exited leader's process group.
- Freeze a native failure stage before secondary probes or cleanup. Mark response headers and JSON body completion separately; a successful status alone is not a completed read. Classify only exact source-issued failure codes, never raw error text. Preserve the primary error, request sequence and original deadlines.
- Inspect composer state only through fixed, scoped projections within the existing UI evaluation. An effect-published getter has no freshness proof: distinguish its observed draft from DOM state and actual transport. Reuse an existing send as the positive control; bounded diagnostics must add no model work and must retain unknown when evidence is missing.
- Initial UI enablement and global health do not prove selected-directory engine initialization. Consume the authenticated instance response and verify exact scope within the original absolute startup budget; do not probe a missing historical root during move recovery. Keep JSON syntax failures content-free without exposing parser cause, while preserving transport and deadline error identity.
- Native provider setup must use the authenticated host workspace reload contract for directory normalization, existing readiness and MCP restoration. Config persistence, provider catalogue discovery and actual engine tool/file execution prove different boundaries; a partial native pass does not close the whole gate.
- Ordinary Bun tests must defer native browser-only fixture imports until the native entry point. Keep mixed Bun/Node discovery separate with explicit source paths, preserving package cwd/preloads and dedicated postbuild Node gates; update finite CI selections deliberately.
- SSR fixtures must install one complete Storage object at global and window before awaited production imports, then restore descriptors even on setup failure. Persistence captures its storage adapter: byte/rehydration fixtures must explicitly own and restore the supported live adapter and restore state before releasing it. Prove test order from actual runner headers, not argv order.
- POSIX native relaunch tests must request ordinary application quit before strict owned cleanup. Keep one explicitly budgeted quit window separate from unchanged stop deadlines; acknowledgement or leader exit cannot authorize folder movement. Preserve Windows close-CDP then stop ordering without inducing leader exit first; the inherited Windows stop contract is not a descendant-closure proof. Test-only controls must reuse the original guarded read-only handler, restrict the main frame, and preserve ordered cleanup failures alongside the original error. Publish bounded main-owned quit acceptance before shutdown can navigate the renderer, bind it to the fresh launch nonce and child, and tolerate only the exact typed accepted navigation error. Missing/foreign receipts and generic errors still refuse movement; receipt reads share the original quit window and stop after it closes.

- Startup diagnostics distinguish selected-instance request, headers, whole body and scope verification. Ownership diagnostics retain bounded allowlisted counts before refusal; controlled sequence adapters preserve production defaults and every individual identity recheck. Admit late process identities from the same fresh snapshot only while a verified living member anchors ownership, and give each admitted identity its own fresh per-PID signal check. Discovery, signaling and waiting share one unchanged absolute phase budget; first-seen unanchored survivors remain a refusal.
- Failure-only fixture timing must preserve original assertions, clocks, deadlines and natural cleanup. A runner-owned timeout is separate from a caught fixture error; capture incomplete state on cleanup entry and leave later unobserved continuations unknown. Never warm stores or add waits to diagnose a timing failure.
- Distinguish a fixture latency cutoff from a product SLA. After measured late-but-preserved work, behavioral tests may await the real event within the existing runner budget; prove lost scheduling still fails. Cleanup that already began must prevent late setup from installing a new waiter or starting more work.
- Isolated engine rebuild experiments must keep raw child diagnostics inside their private owned root; only a closed validated projection may reach uploader paths. A late writer after timeout must not mutate publication. Report native cleanup failures as unknown independently of direct-child exit, and keep original release failures authoritative. Separate spawn, pipe failure and direct-child exit metadata; source-shaped stderr summaries are untrusted observations, never authenticated causes or raw diagnostic content. Test bodies may continue after a runner timeout: capture the observer per body and freeze its bounded statement evidence before cleanup awaits. Preserve the original cleanup order and primary errors; a pending statement is not proof of its inner await or a product defect. Observe public-source build progress passively through fixed, separately framed stream markers without changing entry semantics; missing markers do not prove nonreach, and a successful diagnostic job does not make an unknown experiment pass.
- A compile exception monitor must first prove non-suppressing delivery on the exact pinned runtime with a real native resolver failure. Check exact entry/argv before registration, precompute canonical source identities, and emit only closed finite projections; an inherited preload must stay silent in other entries. Windows test maps must use the same canonical case convention as production maps.
- Inner invocation diagnostics preserve original await/return adoption and operation/error identity. Supply the optional observer only from the explicit test opt-in, allocate no observer wrapper when absent, and freeze a separate closed protocol at the original cleanup boundary; a pre-status checkpoint does not prove status completion. A last-completed checkpoint followed by an unobserved await remains unknown; never relabel it as the next entered phase.

- Fixed-environment behavioral probes must preserve the default harness and original binary, admit only current first-attempt synthetic CI, and bind producer acknowledgment separately from live environment observation. Protect reserved publication names using target-filesystem equivalence, including case aliases. Require unchanged before/after file and manifest identity for altered classifications; descendant completion and causal equivalence remain unknown.
- A separate pinned-binary runtime metadata smoke proves only executable identity and preload capability. Keep it failure-only after the primary CI gate, with synthetic home/minimal environment, bounded output and an actually exited owned child; it cannot turn failed application startup green.
- Test synthetic environment paths with host-native absolute paths and exact expected environment maps. A loader-platform argument does not change node:path semantics; a POSIX literal prefix can pass locally and fail on Windows. Treat path.win32 counterexamples as path-model evidence, not Windows execution. Convert file URLs with node:url fileURLToPath before passing script filenames to child processes; URL.pathname keeps URL syntax and escaping. Conversely, Node --import takes an ESM specifier: use pathToFileURL for native preload filenames, retain native paths for Bun preload variables, and test spaces/#/% encoding.
- Default engine-file observations are startup-failure-only and synthetic-CI-only: bind the canonical owned root after unchanged preflight, read one bounded regular file with containment/identity checks, and project strict source-verified enums/counts. Keep engine-run observations separate from selected-directory evidence; batching, missing records and unsupported filesystem identities remain unknown. A fresh-process failure diagnostic never overrides the original failed suite. When narrowing a failure diagnostic to one test, preserve its body, preloads, original per-test budget and failure condition; verify the name filter selects exactly that test and keep the required suite unchanged.
- Provider failure observations must bind the actual native assistant and originating user message before dispatch. Strip local correlation before upstream fetch, preserve opaque provider bytes, persist only bounded failure codes in app-owned storage, and require terminal idle evidence before decorating a snapshot. Successful retries override observations; an empty turn without a verified provider witness remains an incomplete outcome with unknown cause.
- Diagnostic publication must never hold provider body EOF. Bound and lifecycle-own independent jobs, cancel and drain them on disposal, and notify snapshot consumers after durable late writes.
- Every non-test JavaScript helper emitted into opencode-plugins is copied outside node_modules and must satisfy the packaging import guard, even when the configured plugin already inlines it. Bundle helpers with bare dependencies explicitly and verify detached built artifacts, not only source imports.
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
- When integrating independent histories, preserve every distinct fixture contract and remove duplicate owners/imports introduced by automatic merges. New fake managed engines must return the registered health response including version; keep the real readiness validator strict. Bind dependency helper gates to their own required runtime, separately from application CI.
- Native Files navigation helpers must use the current rendered sidebar contract: the scoped workspace chevron owns expansion, and SidebarMenuSubButton uses presence-only data-active. Bind regression attributes to actual rendered primitives; do not invent title expansion or Files pressed attributes, or select nested session chevrons. Read active state before navigating. Retained hidden panels cannot prove readiness: acknowledge the selected workspace, runtime owner, filesystem root and visible root/folder through the existing chooser boundary, preserving the original operation budgets. Use explicit pre-reconnect readiness for the visible enabled recovery action when the root is absent, preserving the same ownership/root/breadcrumb guards and four budgets; require ordinary directory listing after successful relink. Test the actual imported caller helper with executed renderer expressions, then confirm the mounted journey separately.
- Aggregate renderer network diagnostics into fixed categories/status families before limiting individual requests, so pending imports cannot hide failures. Calculate network ages only from the network monotonic clock, never console epoch timestamps.
- Recovery UI assertions must acknowledge the visible target folder and the actual same-workspace preparation response before checking refreshed verification. Failure probes may export only fixed control/badge counts and typed visibility/timing values, never raw DOM text.
- After folder reconnect, acknowledge the renderer's published current workspace root and server identity before selecting sources. Backend persistence alone does not establish that the renderer has consumed the new identity; a later identity update intentionally resets folder/selection state.
- Engine OTLP diagnostics use an owned loopback receiver and fixed completed-span names with numeric duration/status only. Drop resource metadata, attributes, events, IDs and error text; missing completed spans do not prove phase entry.
- Manual diagnostic jobs supplement the required PR matrix. Reused runtime artifacts must come from the same repository/branch and an ancestor commit, with the normal manifest verification retained.
- Merge newer cached stores into the existing captured runtime generation rather than adding a parallel owner map. Compatibility drains target existing operation-only generations, preserve live borrowers and refuse self-drain; accepted queue jobs reserve that generation before awaiting their predecessor.
- Effective endpoint identity includes the explicit owning host capability and application-owned local client. Remote capabilities never borrow local host credentials. Cold provisioning completes before the separate selected-instance proof budget starts; queue observations follow the current public prompt boundary.
- A scoped Darwin process census must select the original group plus every captured PID, so moved or reused identities remain visible. A live sentinel keeps selection nonempty but must never become an owner, anchor or signal target; preserve fresh identity checks and the original signal budget.
- A closed diagnostic experiment needs disabled job admission, not only an opt-in step deep inside its producer. Preserve required package/native gates and historical source; integrated static guards must test actual producer/environment contracts and reject concrete unsafe mutations.
- Vite preview cannot transform source TSX regression imports. Keep acceptance on its built app; compile explicit mounted fixtures separately into an owned preview copy, preserve the normal dist, and make source-CI checks respect their actual build prerequisites. Give only that compiler child the explicit bounded packaging heap; verify the effective V8 budget under a constrained parent while preserving inherited options.
- Cancel producer admission and drain accepted work before closing any stores it writes. A direct runner test is insufficient for server teardown: hold the real server's send, stop it, then verify durable completion and physical close.
- Capture the current production chooser input immediately before opening it; an observer receipt without capture cannot establish input-generation continuity.

- Standalone fixtures that borrow a process-cached policy runtime must close its captured path explicitly before removal and restore environment state in finally. A server lifetime and a standalone operation have different ownership contracts; never discard policy secrets/throttle state to make cleanup pass.
- Initialize multi-table SQLite schemas in one transaction; prove partial-schema rollback, legacy migration and real native-handle release without changing durability settings or filesystem validation.
- Mounted regressions compiled separately from the application must restore exact global API property descriptors around their complete import/mount lifetime, including thrown assertions. A fixture-private inspector can otherwise hide the application route registry even while refresh events continue; prove live getter and event-owner continuity in a real browser.

- Native picker IPC receipts precede renderer completion. Before returning to Files, acknowledge a new visible completed artifact tab, the committed workspace route and its selected owner; never reuse a prior same-path tab. A fragment-based entry menu owns the input immediately following its trigger, not every input under the shared list parent. Preserve exact captured/event input identity and refuse ambiguous adjacency.

- Desktop native route assertions follow the actual HashRouter selected by the Electron bridge and the control provider's committed useLocation snapshot. Parked DocumentPane portals are outside document: include public openFiles IDs when excluding preexisting imports. Regressions must mount the real import-event handler and panel rendering; a modeled BrowserRouter callback cannot prove desktop history or hidden-tab ownership.


## Selected-practice overview invariants

- Practice overview membership is explicit: registered top-level local clients under the selected profile `officeRoot`; unrelated and remote workspaces are excluded visibly. Never register a practice root merely to aggregate clients.
- Host snapshots are keyed by canonical scope membership/path, server, authentication generation and local day. Retain last successful source content only within that identity; cancellation and a changed scope must not publish the preceding read.
- A failed source is not empty. Keep per-source success timestamps, show partial/failed coverage even in empty views, and refuse actions until the owning client has a successful fresh read. Recheck membership before client actions; never fall back to another client or generic session on refusal.
- Office-memory reads are host-only and require the exact expected profile root. Keep 500-file, 1 MiB/file and 8 MiB aggregate bounds, no symlink parents/files, bounded handle reads and identity rechecks. Source/SSR tests do not establish native Windows acceptance or the engine credential boundary.
## Desktop release evidence

- Generate embedded build identity after stamping from the exact checkout and target. Packaged identity never falls back to runtime environment variables; dirty local packages must show unavailable provenance.
- Hash only final, post-signing bytes. Keep evidence per platform and architecture, immutable run-tag payloads, and one owner for common updater manifests. A retry may reuse identical bytes but must not clobber a different payload.
- Native acceptance must bind the final installer, installed bundle, live IPC identity, owned profile, and actual journeys. Source tests, packaged startup, and operator-free preflight cannot provide native PASS. Preserve separate fresh/migrated receipts and historical evidence snapshots.


- Auxiliary raw-source diagnostics must use the overview's server/authentication/scope owner and propagate cancellation through every file read; relative names and workspace IDs alone do not identify source text.
- Multi-root wiki fixtures use separate actual ServerConfig/listener credentials first pinned to each owning root. Preserve project/own-wiki positives independently, assert shared-token refusals, and exercise owner-only approval lifecycle on a fresh owner runtime after a monotone role downgrade.
- AI governance admission tests must pair a typed denial with a controlled receiver observing zero protected payloads. HTTP 200 from the engine may carry a model error; a positive oracle requires actual assistant text. A passing observational feasibility test is not acceptance when it records a filesystem/egress bypass.
- A public synthetic execution must own an empty scratch/config/DB/environment and bind the complete final serialized context in a native decision. A prompt hash, loopback URL or renderer checkbox cannot classify ambient client/system context as public. This bounded channel does not establish an OS sandbox for the general engine.

## Managed deadline workflow

- Managed deadlines use one canonical L2 OKF task and the ordinary `.okf-write.lock`. Shared lock callbacks must stay synchronous; never create a separate mutex ignored by the canonical writer. Keep full-file CAS independent from semantic legal revision hashes and observation/export metadata.
- Native host receipts require local consumption evidence as well as current source/rule/matter binding. Restoring old Markdown must not resurrect a revoked receipt. Copied records and stale source snapshots remain historical warnings until new local review.
- CZ/SK source verification is a separate gate from legal RulePack approval. Bundled proposed profiles remain `synthetic_only`; artificial approval injection belongs only in explicitly imported test fixtures. The deadline rollout flag admits the workflow, never grants legal authority or enables upstream calendar tools.
- A confirmed canonical commit may outlive an ICS failure. Preserve `export_pending`/`export_failed`, deterministic UID/SEQUENCE/DTSTAMP, foreign files and external edits. Recovery runs only for a selected matter or explicit retry. Cancellation ICS does not remove events already imported elsewhere.
- Native deadline queries and retained UI state must include the actual connection URL/credential/auth generation and complete practice scope, not only workspace/path IDs. Capture cancellation at admission and prevent late source, mutation and excerpt-hash results from publishing after an owner switch; verify with the real QueryObserver.
- Release resumption consumes the original run/attempt candidate artifact, including final installers, and verified native intake artifacts. Never rebuild or restamp a resumed release. Only the serialized acceptance-resume workflow revises canonical evidence: archive exact prior bytes, verify the full digest chain, recheck the captured REST asset ID, and exclusively create the next canonical record without payload clobber.
- Inventory both legacy and installed engine-v2 execution/continuation routes at the host admission boundary. Preserve typed denials before SDK normalization or dedup reservations, and verify owning-session visibility before model policy. Trusted pure-domain transport ports are constructor-only; HTTP and persisted settings cannot activate them.
- Renderer API clients map the actual resolved desktop connection fields and retain both current credentials. SSR markup cannot establish that a live native request reaches its intended authenticated endpoint.

- New server modules must load from the relocated packaged tree, including transitive imports. Reuse trusted host-owned pinned-version inputs instead of adding repository-root imports that depend on a packaging rewrite; verify strict version mismatch refusal as well as real packaged imports.

- Native deadline projection ownership comes from the host receipt-consumption attestation, never writable Markdown export hashes, event counts or state. Preserve lifetime UID/sequence through revocation and explicit replacement, and recheck the current attestation under the canonical writer lock before export. Read-only trust GETs admit viewers; native/mutation authorization remains stricter.

- Canonical evidence absence is not first-publication proof. The shared metadata owner must refuse create-only seeding whenever that target's snapshot namespace already exists; require explicit verified recovery so no caller can disconnect preserved history.
- Preflight protected scheduled work before fresh-session creation: chat titles are content-bearing engine requests too. Keep default admission separate from explicitly trusted constructor-only non-model jobs and retain accepted-job shutdown drain coverage.

- Native approval payloads must remain complete and inert text in a bounded scroll region with visible actions. A sender-bound isolated review preload must expose no application bridge; renderer success cannot substitute for the main process final decision and cancellation checks.

## Confined document transport invariants

- A protected document session is owned by its host runtime registry, never by a renderer flag or session-shaped ID. Keep the general engine denied while AI hranice are enforced; the alpha ships with them off by default (MČ 20. 10. 2026). The guest has no NIC, client filesystem mount or provider credential; only current selected-document capabilities and the fixed host model relay are available.
- Bind each native final-wire decision to complete serialized bytes and current source/root/runtime/plugin/launcher/config/target/account/legal-profile/organization-policy identity. Revalidate before the socket and during receipt. Native source classification, legal eligibility, operation authority and output correctness remain separate gates.
- Identical prepared-source readmission changes only list ordering; exclude its admittedAt timestamp from semantic authority, while retaining extraction revisions, coverage, provenance, raw hashes and physical source/root identities. A fresh final-wire review still binds the current complete serialized tool response.
- Cancelled legacy network reviews must settle without waiting for an external decision callback. A late decision cannot resume DNS or socket IO; retain complete network-work drain, especially for constructor-owned protected callbacks.
- Native approval and DNS each have a fresh continuation gate; periodic source inspection begins only immediately before the socket. Stop and drain every outstanding inspection before the last fresh check and response publication; draining only in finally can publish a response that its monitor subsequently revokes.
- Persist actual guest SQLite with an online consistent backup and exact hash. Restoring history grants no egress; continuation needs fresh host admission. Preserve actual session/message/tool IDs and only project known directory metadata, never arbitrary model text. Revalidate attachment copies against selected original hashes at admission and delivery.
- Real VM tests must prove positive tools/saved hashes and independent reachable-receiver controls before asserting zero raw TCP/UDP/subprocess egress. Protocol substitutes and synthetic profile fixtures do not establish native packaging or legal/provider approval.
- Instance-free engine health does not initialize a workspace. Before publishing protected readiness, complete authenticated fixed-directory provider, primary-agent and tool-schema responses within the absolute host-owned provisioning budget; preserve the separate health limit and disarm startup expiry only on validated readiness. Initialization must request no model and execute no document tool.
- Bound protected RPC admission before consuming request bodies. Preserve the same credit through body reading, dispatch and caller cancellation until the measured guest confirms task cleanup; response EOF alone cannot release a guest slot. Keep FIFO waiters bounded, drain owned readers on stop, and prove retirement ordering with actual guest barriers as well as host protocol tests.
- In concurrent receipt probes, mark the first observed frame synchronously before awaiting its producer. Track accepted receipts separately after the await; delayed bookkeeping must not make a later frame appear first. Release all held test barriers during cleanup.
- Retain the first native generation POST independently of rolling network diagnostics, bound to the actual provisioned session and host origin. Publish only bounded status/state categories, freeze primary-failure receipts before cleanup, and keep missing observations unknown. For an explicitly enabled synthetic 5xx diagnostic, read only that completed owned response; retain a closed error-envelope category and finite relative timing, never body/message/reference content. Structural envelope labels do not authenticate error origin or establish cause. After primary freeze, an owned synthetic process-log projection may add only closed exception categories and bounded locations in allowlisted shipped modules, correlated to the exact captured POST; missing or forged structural evidence never establishes cause.
- Clear a document worker busy latch only from its own terminal event, including the engine directory/payload envelope, then independently recheck actual idle status before eviction. A transient idle status or delayed event cannot authorize cancelling active work.
- An idle capacity probe freezes new SDK admissions and naturally drains accepted finite reads through body EOF before its fresh idle check. Guest callbacks remain admissible and invalidate the probe; a bounded drain timeout must not cancel accepted reads or release ownership.
- Size the outer native CI batch for all ten isolated cold starts and restore/relaunch work; keep each existing 240s provisioning and 90s inference oracle separate and unchanged. Batch completion never excuses an individual deadline failure. Include readiness fixtures in serial runtime acceptance budgets, and reserve job time for the preceding isolation suite and measured runtime build.
- Queue admission stores a locally validated intent without cold-starting a captured runtime. Delivery repeats current source/profile/upload checks and fresh native admission; a read-only captured/restoring/ready state grants no execution or transfer authority. Observe cold provisioning separately before the original recovered inference oracle.
- Multiple listeners for one config must respect the active session claim, refresh historical authority from serialized storage and retain failed teardown ownership. Release a claim and worker slot only after checkpoint, stop and disposal succeed; reserve capacity before startup and evict only an actually idle worker.
