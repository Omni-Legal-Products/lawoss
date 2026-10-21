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

## 2026-10-20T23:20Z — isolated macOS packaged startup keychain

- Actualaf23 app.asar444imports/447static, security/bundled tools and packaged VM passed. Original real startup failed unchanged90s before renderer controls. Owned process sample showed main thread blocked in SecItemCopyMatching/Keychain decrypt.
- TDD: actual spawned fixture first failed missing --use-mock-keychain; Darwin-only isolated runner argument now matches existing native entry. Both original cleanup regressions pass; same actual package now starts, registers renderer controls, replaces token and verifies0600. Production main/keychain and all acceptance limits/oracles unchanged.
- Evidence-only sampler initially had a timer-shadowing error; invalid run retained separately. Exact ownedPID was identity-checked and stopped; normal running profile/process untouched. No inference from that invalid harness run. Full-process sample is supplemental causal evidence.
- Independent review: no must-fix; synthetic mock-keychain startup does not establish real login-keychain integration. Existing AGENTS/CLAUDE reusable rule extended identically.

## 2026-10-20T22:45:25.780208+00:00 — PR201 TDD build correction

- Archived Windows source failure job118918603281 and reproduced identical five shutdown-fixture failures locally (Node24.21.0).
- Restored actual production localization collaborators in the existing VM fixture; added actual rendered Czech shutdown title assertion. Origin/main-frame/receipt/survivor refusals stay unchanged.
- Focused19/19 and exact CI native helper glob377/377 pass; independent reviewer19/19 and diff check pass.
- No production change or signing/distribution. Fresh runner acceptance is pending.

## 2026-10-20T22:49:34.616523+00:00 — PR CI audit and locale shutdown regression

- pstack status-only audit:175/176 available checks green;200 historical macOS watcher and Windows startup failures;201 repaired by concurrent52119ab5;201/202 conflict with dev. No review comments on200/201/202.
- Isolated repair branch starts from995cae41, reproduces14pass5fail, then incorporates concurrent52119ab5 without overwriting its edits. CS/SK/EN exercise real URL builder, production shutdown navigation, main-owned acceptance and strict cleanup; forged receipts still refuse folder movement.
- Node24.21.0/Bun1.4.2: focused21pass, server build exit0, exact native helper glob379pass0skip0fail. Required dependency/build setup failures retained under ignored.work/ci-repair; they do not establish product regressions.
- PR200 exact52db9744 watcher replay10pass1platformskip0fail. Windows failed before generation, health200 followed by a300031ms request timeout and long dependency-install spans; root cause remains unproven. No timeout or native acceptance oracle changed.
- Remote pushes use ordinary fast-forward only; no merge/distribution or claim of full CI acceptance.

## 2026-10-20T22:58:28.948198+00:00 — PR201 source/build integration verification

- Ordinary merge of dev5400fae0 preserves current PDF review and Czech presentation. Only PATCHES.md conflicted; retained both complete sections. PR base/topology unchanged; no force push or dev merge.
- Pinned Node24.21.0/Bun1.4.2: app2877pass2skip0fail; server3008pass81skip0fail; exact native helper glob379pass0skip0fail; focused PDF server9pass. App typecheck and root i18n audit exit0. Server/app/Office production builds exit0; Vite app50.42s, Office25.55s at CI6144MiB heap. Optional/runtime source skips do not establish VM or native Windows acceptance.
- PR202 ordinary dev reconciliatione1b477a2 pushed; source tree was exactly identical before receipt changes and its watcher suite3/3 passed. Cancel requested for its own superseded desktop run39506866194 after new-head checks appeared.
- Original PR200 failures remain historical and unclassified. One fresh exact52db9744 workflow39510917759 requests source plus packaging; no retry of a failed job snapshot and no weakened deadlines. PR201 Windows workflow39510914223 was admitted for42195bd0; final merge head requires its own PR checks.

## 2026-10-21T16:53:41.893410+00:00 — Six-target alpha evidence followup

- Exact Node24.21/Bun1.4.2; isolated worktree and profiles preserved. PR205 remains review-gated.
- Historical migration now reopens pinned receipt and native images, checks independent owner/target/version and copied profile digest. Typed launch errors carry only matching verified cleanup; uncertain closure retains leases.
- Windows NSIS verifier and atomic Job Object supervisor implemented in downstream helpers. Contracts pass on Mac; native Windows tests explicitly skipped locally. Full NSIS handler is required. No physical Windows proof.
- Actual corrected Mac artifact48a/f3b16c52 shows welcome in delayed diagnostic capture; immediate native capture still showed Ready. Superseded startup result; shipping snapshot now waits two frames and must be rebuilt/retested.
- CI39636278035 failed macOS Office watch output-loop assertion. Deterministic unnamed-event RED2!=1, GREEN4/4, independent fatal-close and edit-during-build probes pass. Previous server reload-watcher failure remained unreproduced in local10pass1skip and full3060pass70skip; no guessed fix or timeout increase.
- Detailed logs/decisions remain in ignored .work/six-platform-alpha/evidence and decisions.tsv.

## 2026-10-21T17:20:02.323332+00:00 — Actual Mac journeys and restart environment repair

- Final-byte Mac4201105b ZIP88be2c0a startup frame shows actual welcome. Functional2 measured four PASS journeys: startup, onboarding without model, real native picker cancel/reopen/select, OKF preview/cancel/apply and matter creation.359 original fixture files remained hash-identical. Document import/preview passed its layer; real-provider question and memory use remain blocked.
- Measured restart FAIL exposed test-only LEGALWORK_WORKSPACES overriding persisted server.json; source registry and data stayed intact. Removed override; same owned profile then recovered both clients/four matters/document hash and retained Czech. Switched Slovak, restarted again and verified Slovak UI/native menu. Original failed receipt preserved separately from subsequent diagnostic proof.
- Current exact b81 CI app/server/desktop stages reached only Electron fixture type errors; corrected two declarations without suppressions and reran exact typecheck. New runner evidence remains pending.
- No original user profiles, real client inputs, public installers, legal authority or provider settings modified.


2026-10-21T17:29:14.504703+00:00 Native synthetic missing-folder recovery: removed own test folder temporarily, observed readable missing state without directory recreation; restored folder and used actual Retry successfully. All359 pinned originals remained hash-identical. Found raw English server message in Slovak Memory Drive and English native picker title in Czech. Typed-error translation now uses existing projectErrorMessage; picker reads existing locale key at every opening. RED renderedCS/SK6fail+unrelatedcontrolPASS; pickerRED1fail2pass -> combined48PASS0skip pinned Bun1.4.2/Node24.21. Parent reviewed panel; independent picker source review approved, no cross-model claim. Full app checks and rebuilt native presentation recorded separately. Files: panel, picker helper, welcome route, focused tests, PATCHES,progress,task log. Reusable locale/error guidance already exists; AGENTS/CLAUDE unchanged and mirrored.
- Localized UI followup full pinned validation: app2963PASS/2explicitWindowsSKIP/0FAIL (393files), app typecheckPASS, Electron renderer build with LEGALWORK_ELECTRON_BUILD=1 PASS. Native Windows x64 old b81 contract job119374096481 now shows4 startup-timeout failures; retained exact logs and assigned rooted diagnosis, no gate/timeout relaxation.

2026-10-21 Native Windows diagnostic followup: first actual x64 run b81 job119374096481 produced4 start-timeout failures, invalidPE test also waited15s and falsely passed broad rejection. Tightened invalidPE oracle to exact start-failed; added open/closed stdin Console probes and finite completed-phase stderr projection (entry/configured/compiled/created), never raw stderr. New fast x64/ARM64 PR workflow has contents:read and no dependency/QEMU/build/publication path. Local5contractsPASS/7nativeSKIP; startup15s and authenticated stdout/lifecycle unchanged. Source review confirms bounded diagnostics, native result pending.

2026-10-21 Mac86b exactZIPd119c140 native startup/installedtree/liveidentity/cleanupPASS; overallfreshBLOCKED10unperformed. Same synthetic functional2 profile proved actual CS/SKpicker titles, translated missing-folder errors, realRetry after restoration with54filesunchanged, andSlovak+bothclients afterrestart. All359pinnedoriginalshashunchanged; nativecaptures+AX+observations retained .work/verify-alpha-localized, archived exactZIPclone, bothsessionsclosureverified. This is diagnostic existing-profile coverage, nothistoricalmigration/fullAIacceptance. Windows7b diag botharchitectures froze entry, simpleopen/closedConsoleprobesPASS; nextdifferential adds finite encoding/read/decoded checkpoints+real-sizedJSON read/pipeline/InputObject/pinned-systemmodules probes. Mainpackagegate remains full; supplementarydiagnosticpattern temporary. No timeout/lifecycle/appenv change.

2026-10-21 Windows51b differential: bothactualarchitectures read >4KiBJSON in<1s; ConvertFrom-Json pipeline/InputObject/pinned-system-module variants allhit15s afterread,beforedecode. Confirmscmdletboundary, notinternalcause. Nextbatchedsyntheticcontrols: EOF,qualifiedmodule,explicitmanifestimport,allowlistedOSbootstrap,and.NET-onlydecode/compilepositive; no productionrepairyet,no appenv/deadlinechange.
