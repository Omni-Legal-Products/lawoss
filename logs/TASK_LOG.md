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

## 2026-10-20T22:52:17.805274+00:00 — PR202 base reconciliation

- GitHub reported a conflict using stale base5aded641; actual dev5400fae0 already contains the candidate PDF review. Ordinary no-rewrite merge has identical index tree before this receipt and changes no product source.
- Exact Node24.21 watcher suite3pass0fail; AGENTS/CLAUDE identical and whitespace validation clean. CI on the new merge head remains required; no claim of Windows native acceptance or repaired PR200 startup.
