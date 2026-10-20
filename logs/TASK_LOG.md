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
