# Alpha build execution ledger

Authority: user-approved plan in this conversation, 2026-10-20.
Baseline: origin/dev 5aded64158b86e7590b003401d47be247623d07d.

- [x] Archive original run 39488636647 and all four native diagnostic artifacts outside tracked files.
- [x] Recheck PR states: #193 merged at 5aded641; #191 closed by team. Windows x64/ARM64 and Linux package jobs passed; macOS failed.
- [ ] Establish root cause of macOS case2 provisioning HTTP500; retain original failure.
- [ ] Add regression before a minimal repair and obtain native acceptance.
- [ ] Integrate #177 after exact-head green checks and human approval.
- [ ] Verify #193 default-heap builds and Office behavior.
- [ ] Final-SHA full matrix and draft release evidence.

Ruling: #193/#191 task already completed externally; verify rather than reopen or duplicate.
Ruling: no direct dev pushes or approval bypass. A missing required review blocks merge, not preparation/testing.
Pre-flight: PDF and Office changes both affect artifact rendering; final integrated app tests must exercise both.
Diagnostic fact: original macOS case1 passed; case2 generation provisioning returned HTTP500 after100765ms; public code unclassified, private refusal body was not uploaded. This does not establish a timeout or a VM root cause.

Diagnostics RED/GREEN: missing provisioning observer reproduced; late provisioning completion erased by prompt observer reproduced; independent active owners fix both. Focused62/62 pass. Full native helper suite379/379 passed before final overlap fix; focused62 covers final diagnostic diff. Independent review requested and overlap finding repaired.

Candidate local merge: PR177 f16d31e4 merged without conflicts into diagnostic52db9744 over dev5aded641 (#193 already present).
Candidate app:2867pass/2platformskip/0fail; strict app typecheck and both i18n checks pass. PDF focused app10/71 assertions and server9/81 assertions pass; actual Chromium persistent A→B→C regression passes. Server production build passes.
Default-heap Office production build passed (8119 transformed modules; stub present, no pptx/Univer editor chunk). Watch initial/rebuild in progress.
Ruling: a new independent dev run39501263644 failed before packaging in WindowsARM64 MSYS2 optional cache-save paccache(exit127), despite pacman-contrib installation. Disable optional cache only for ARM64 using the action's documented input; do not claim a runtime fix or weaken compiler/native gates.
Checks: attempted nonexistent ci-matrix.test.mjs (not a passing test); replaced with direct execution assertions over the actual exported sandboxMatrices plus YAML validation.

Watch finding correction: the initial default-heap build passed in57646ms (8119 modules). Touching unchanged stub triggered a second build, which OOMed near4025MiB with4288MiB heap limit. Historical193 cold-build measurement is not watch-rebuild acceptance. Investigating retained Rollup module-cache lifetime with a bounded independent experiment; no heap increase.
Full server candidate run:2996pass/81skip/4fail (capacity30000ms, managed idle close, late response ownership, wiki deletion sync). Isolated original four-file replay:56pass/1skip/0fail. Original full failure retained; replay is diagnostic, not replacement acceptance.
Existing actual matrix test scripts/ci/sandbox-matrix.test.mjs:4pass, independently confirmed by reviewer.

Office watcher: cache-clear hypothesis rejected by second-buildOOM; fresh serial compiler experiment passes initial+2rebuilds at4288MiB (PIDs31524/31987/32405). Unit3pass; actual CLI shutdown exits0, captured3processes,0survivors. Fresh review resolved config-input and fatal-exit findings; no remaining must-fix.
Native local complete:10cases + attachment + negative + actual relaunch/reconnect/same IDs/allSHA; exit0 and clean owned shutdown. This does not identify the original CI500.
Toolchain mismatch found: prior local Bun1.4.0, CI1.4.2; previous source-suite results remain diagnostic, not matching-CI acceptance. Recheck on pinned binary.

## 2026-10-20T23:05:24.659526+00:00 — Windows source/native build triage and TDD

- PR201 Windows source5failures repaired in52119ab5; fixture now executes actual localization functions. Nativehelpers377pass and desktop450pass/6skip; subsequentremoteheadc073df1d includes this commit.
- PR200 Windows package118922997677 failed before generation: selectedMCP300s timeout; archived job, safe diagnostic, engineidentitysmoke. Historicalmac provisioning500 remains a separate unknown.
- RealHTTP RED proves ordinarySDK sessionLIST bypasses sharedcoldbootstrap; final repair only joins readiness below protected routing. Actuallist responses are fresh and separately authenticated/cancelled.
- Reviewer rejected broadresponsecache and absenthostowner. Additional owner, warm-body and cancellation RED/GREEN contracts retained. Fullsuite exposed protected precondition regression; existingtests unchanged and finalcorrectplacement/exactpath passed.
- Final fullserver3014pass/67skip/0fail, productionbuildpass,48targetedpass, Nodeproduction19pass andNode204/205/304pass. Independentreview38pass/no mustfix. NewWindows source selection includes bothregressionfiles; no budget/oracle change.
- mac source reload-watcher job118906948432 stillunclassified;25exactisolatedreplays pass, not replacementCIacceptance. Intermediate invaliddirectory Node test selection, aborted broad-caching run andfailedpreflight run are retained as failed/diagnostic evidence.

## 2026-10-20T22:52:17.805274+00:00 — PR202 base reconciliation

- GitHub reported a conflict using stale base5aded641; actual dev5400fae0 already contains the candidate PDF review. Ordinary no-rewrite merge has identical index tree before this receipt and changes no product source.
- Exact Node24.21 watcher suite3pass0fail; AGENTS/CLAUDE identical and whitespace validation clean. CI on the new merge head remains required; no claim of Windows native acceptance or repaired PR200 startup.

## 2026-10-20T23:14Z — PR202 concurrent history reconciliation

- First ordinary push rejected because remote e1b477a2 had merged accepted PDF177/dev5400fae0. Preserved both histories and receipts; product tree unchanged from verified local9cc1. No force push.
- Local9cc1 full server3017pass/67skip/0fail; full desktop build pass; actual native10cases, attachment, negatives, relaunch/same IDs/hashes and owned cleanup pass. Historical macOS provisioning500 remains unclassified.
- PDF functional assertions passed, but first full runner failed strict owned cleanup; original failure retained. Evidence-only observer copy reran all original assertions and unchanged cleanup policy successfully; timing/cause of first failure remains unclassified. No cleanup guard relaxed.
