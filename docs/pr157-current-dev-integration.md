# PR157 integration with current dev

This integration merges PR157 `e65e3a2b7452ae9179fdb45b7e40a65b9b735960` with dev `4884642657bcd0352dd0b98efe69596635530b28` (upstream 0.2.9, PR165/166). Both histories are retained. PR158's separate SDK payload is outside this change.

## Preserved boundaries

- PR157's captured SQLite generation remains the lifetime authority. Current dev's policy/hub cleanup joins final-generation release; calendar stores use the same borrowed lifetime. Explicit standalone calendar stores have their own close. Compatibility close calls drain only an existing operation-only generation at the captured path, preserve live owners, and refuse active self-drain.
- Existing accepted reload jobs reserve the captured runtime operation before awaiting the queue. Last producer teardown cancels future policy retries; accepted work finishes before the final resource release. Neither garbage collection nor unlink on Unix establishes native close.
- Selected endpoint memoization retains transports across metadata/root refresh. Effective bearer, explicit owning host capability, workspace classification and application-owned local client remain invalidation operands. Remote host capabilities come from that remote record; local host credentials never supply a remote fallback. Nullish and literal-empty bearer precedence is unchanged.
- Session snapshot deadline/cancellation, native execution ordering, query ownership, revert boundaries and load-error visibility remain intact. Current dev's deleted-session tombstone rejects late metadata instead of resurrecting a deleted chat. Interaction lineage and usage-limit behavior remain present.
- Native synthetic setup uses the authenticated owning workspace proxy. Raw engine credentials are not reconstructed in the renderer. Cold instance readiness keeps its 300-second contract; only after its complete MCP body does the selected-directory 90-second absolute proof begin. Host reload remains 90 seconds and ordinary engine requests 30 seconds.
- Queue admission replaces the old direct chat prompt endpoint at the current public boundary. Diagnostic observations still retain fixed counts, status classes, marker booleans and owner correlation. PR157 bounded document epochs and current-dev renderer aggregates both survive.

## Evidence limits

Local validation uses pinned Node24.21.0, Bun1.4.2 and pnpm11.4.0 with an isolated HOME/XDG root. It exercises source tests and synthetic loopback fixtures. It does not run Electron, a real OpenCode engine, live providers, paid inference or the frozen Windows diagnostic experiments40–44.

The original PR157 Windows failures remain historical failures. Current dev's green CI is baseline evidence only. A newly published feature head still needs its own required native/package CI and independent approval. No local source result establishes Windows native acceptance, the original five-finding production acceptance, or legal correctness.

Compatibility adaptations keep exact assertions at the current public boundary: provider-aware errors include their provider suffix; chat tools send the narrow agent/session/directory headers; only the owning remote host capability is transmitted. Node-adapter read-error assertions execute unchanged under the actual postbuild Node gate, because the same `serve()` factory intentionally selects native Bun in Bun tests.

A rejected unconfirmed provider replacement/deletion must preserve the complete refresh/runtime/workspace/audit state. The confirmation guard now precedes the refresh-state write; accepted changes retain stale-engine disconnection and audit behavior. Batch MCP removal awaits each read/modify/write so concurrent removals cannot restore siblings.

On Darwin, owned cleanup selects the documented union of the original detached process group and every captured positive PID, with `COMMAND_MODE=unix2003`. A live caller PID keeps the query nonempty and is removed before ownership analysis. Each signal still requires a fresh identity check within the unchanged phase deadline. Other POSIX implementations retain the full census. The same real descendant test keeps its 100 ms budget; moved/reused PID, late-member and unanchored-group negatives remain.

The three historical Windows baseline/compile/empty-auth diagnostic jobs retain their source but have literal disabled admission, so an ordinary package failure cannot renew experiments40–44. Normal package/native CI remains enabled. Frozen source guards now check the integrated producer, isolated-environment and startup contracts with concrete negative mutations; unrelated strict protocol/receipt/schema guards remain.

Final local source gates: server 2707 pass / 71 skip / 0 fail; complete postbuild Node 15 pass; desktop 19 Bun plus 404 Node pass / 6 skip; native helpers 232 pass; all three typechecks, reproducible server build (767 identical artifacts), i18n, synthetic ISIR, commercial guards and packaged-import checks pass. App evidence is composite: the first full run had 2558 pass / 2 skip / 1 obsolete exact-error-suffix failure; after adapting that assertion to current dev, its entire affected file passed 163 tests. This is not a new whole-app zero-failure run. The external task report binds commands, failures and final source hashes.

The unchanged current-dev build generator regenerates tracked `calendar/calculator-code.ts` under pinned Bun1.4.2. This generated output is retained with the tested build; the generator, calculator inputs and lockfile remain exact current dev. The source manifest labels it separately from authored integration.

## Task review fixes (round 1)

The native acceptance app still requires the prebuilt `apps/app/dist` output. Its launcher copies that build into the owned native root and separately compiles explicit mounted-regression entries into that copy's `__isir-fixtures` directory using the app's Vite configuration. Preview imports compiled JavaScript, including its chunks; it never transforms the application from source. Normal dist/package inputs receive no test files. Source CI's focused compiler/preview check uses an explicitly synthetic built HTML marker because that job builds the server only. A separate isolated headless Chromium check mounts the actual production file menu/input from this compiled fixture, selects an owned file through CDP and checks bytes copied by the supported visual-fixture importer through an owned loopback sink. This is not Electron IPC or full native acceptance.

The native picker captures the current mounted production input immediately before clicking the visible Add files action. The original connectedness, node/client identity, controlled refresh and real native copy assertions remain. Server shutdown cancels every registered producer, waits for accepted work to drain while dependent stores remain live, then closes resources and releases the generation. A real startServer/loopback scheduled-send regression verifies persisted sent status, repeated-stop identity and actual SQLite handle release; the earlier direct-runner test remains.


## Source-CI fixture compiler memory (task 2)

The published b95c6580 macOS source job 117401485872 in run 39034497867 failed the actual fixture compilation at approximately 2 GiB V8 old-space; the other 232 helpers passed. The compiler child now receives explicit `--max-old-space-size=6144`, matching the existing desktop packaging build budget. This argument overrides a constrained parent's heap option without modifying inherited `NODE_OPTIONS` or the runner environment. No workflow-wide heap, timeout or assertion change is needed.

The focused compiler/preview regression starts an actual 2048 MiB constrained Node driver and measures V8 heap limits in that driver and its real compiler child through an owned preload. It requires a bounded 6144 MiB compiler allowance, equal inherited options, actual compiled mounted exports served through Vite preview, and byte-identical normal app dist. The new budget assertion fails before the fix; the original CI OOM remains the full-allocation failure evidence. A new feature head still needs ordinary required CI and independent review; local source tests do not establish full native acceptance.


## Windows source failures on c406 (task 3)

The actual Windows server selection failed 48 cases: 30 standalone-fixture cleanup failures, 17 five-second timeouts and one contaminated connector-migration assertion. Standalone configuration/MCP fixtures own the persistent organization-policy cache explicitly, as the existing policy fixtures do. They now close that captured database path before strict removal, await freshness disposers, verify zero physical handles and restore environment variables even when cleanup rejects. Every cleanup error remains visible. The migration's original full connector expectation is unchanged.

A trial that auto-closed the entire organization-policy Runtime on every operation failed the existing standalone secret-continuity checks. It was rejected and reverted; policy, server lifetime, secrets, throttle and synchronous listeners are unchanged. A standalone caller still must explicitly close its owned policy cache. Actual overlapping-server/final-generation tests cover the different server-owner contract.

TaskStore and ProjectSyncStore initialize schema in one transaction instead of separate durable commits. Real Bun and Node drivers verify that a later SQL initialization failure leaves no partial schema, then reopens normally with no retained handles. Existing legacy migration and failed-native-close recovery tests remain authoritative. One measured project case reduced SQL execution time from59.94ms to22.66ms locally, retaining61lstat/10realpath calls. This is a mitigation for the15 project timeouts, not Windows timing proof. The isolated provider and onboarding timeouts remain unexplained; no deadline, physical path validation, expected value or production request budget was relaxed. Next normal feature-head Windows CI must decide all timing outcomes.

Focused final local validation:233 Bun tests across14 affected/adjacent files pass, including all seven failing Windows test files and policy compatibility; strict server TypeScript and server build pass. Full Windows/native acceptance is not established. Exact source/evidence identities and discarded-attempt results are retained in the external task-3 report.
