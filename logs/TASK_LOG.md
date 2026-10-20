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

## 2026-10-20T23:05:24.659526+00:00 — Windows source/native build triage and TDD

- PR201 Windows source5failures repaired in52119ab5; fixture now executes actual localization functions. Nativehelpers377pass and desktop450pass/6skip; subsequentremoteheadc073df1d includes this commit.
- PR200 Windows package118922997677 failed before generation: selectedMCP300s timeout; archived job, safe diagnostic, engineidentitysmoke. Historicalmac provisioning500 remains a separate unknown.
- RealHTTP RED proves ordinarySDK sessionLIST bypasses sharedcoldbootstrap; final repair only joins readiness below protected routing. Actuallist responses are fresh and separately authenticated/cancelled.
- Reviewer rejected broadresponsecache and absenthostowner. Additional owner, warm-body and cancellation RED/GREEN contracts retained. Fullsuite exposed protected precondition regression; existingtests unchanged and finalcorrectplacement/exactpath passed.
- Final fullserver3014pass/67skip/0fail, productionbuildpass,48targetedpass, Nodeproduction19pass andNode204/205/304pass. Independentreview38pass/no mustfix. NewWindows source selection includes bothregressionfiles; no budget/oracle change.
- mac source reload-watcher job118906948432 stillunclassified;25exactisolatedreplays pass, not replacementCIacceptance. Intermediate invaliddirectory Node test selection, aborted broad-caching run andfailedpreflight run are retained as failed/diagnostic evidence.
