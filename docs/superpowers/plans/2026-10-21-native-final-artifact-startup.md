# Native final-artifact startup implementation plan

> **For agentic workers:** Use the user-requested pstack bounded partition for the two independent writers below; the parent integrates and verifies. Existing goal execution authorization remains in force; independent review follows implementation.

**Goal:** Prove installed final-artifact native startup on all six CI targets while keeping full alpha acceptance explicitly incomplete.

**Architecture:** Reuse the existing guarded archive extractor, alpha runner, process owner and native capture. Publish only a finite startup receipt and the fresh synthetic welcome capture, never unsigned application binaries, profiles or raw private receipts. The parent downloads and visually reviews captures before accepting native presentation evidence.

**Tech Stack:** Node24.21.0, pnpm11.4.0, existing Electron builder/archive libraries, native X11/macOS/Windows capture, PowerShell.

**Spec:** User's active six-platform alpha goal; [team alpha/physical-Windows decision](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-10-19-zapis-call-mc-vr.md); [.agents/skills/verify-lawoss](../../../.agents/skills/verify-lawoss/SKILL.md).

## Global constraints

- macOS/Linux/Windows each x64/arm64; exact native architecture and embedded checkout SHA/version.
- Existing required names/gates, original deadlines, protected-AI and signing boundaries remain unchanged.
- Startup only; ten other scenarios remain unperformed, no migration baseline or public release permission.
- All storage is owned synthetic scratch; final bytes hash checked before use. No ambient model credentials.
- Existing NSIS installer probe remains integrity-only unless explicitly asked to run the additional startup phase.

## Review focus

- Altered archive or installed executable: refuse before native launch.
- Failed startup/capture/cleanup: required step fails, never verified metadata.
- Wrong route/profile/process: no capture publication; retain ownership evidence on failed cleanup.
- Profile/credential leakage: upload only explicit finite receipt and fresh welcome native image.
- Passing startup misread as full acceptance: distinct receipt kind and explicit unperformed scenario list.

### Task 1: Native startup probe and guarded extraction reuse

**Files:** `lawoss/testing/alpha/installed-artifact.mjs`, its tests; new `probe-startup-ci.mjs` and `probe-startup-ci.test.mjs`.

**Interfaces:** Export `withExtractedAlphaArtifact({platform,arch,asset,expectedSha256}, use)` for macOS/Linux using the existing validated private copy/extraction and finally cleanup. Callback receives `{installedApp, installation, retain}`; call `retain()` when native cleanup is unverified so a live executable or mount cannot be removed. Existing verifier uses this unchanged boundary. CLI `node lawoss/testing/alpha/probe-startup-ci.mjs --output-dir <new directory> [--installed-app <Windows actual NSIS install>]`; fixed native distribution filename from desktop package version. Windows is supplied only by the existing actual NSIS probe. CLI requires GitHub-hosted runner, native arch and embedded checkout/version identity. It runs existing nonmanual alpha acceptance on a new owned fresh profile; full receipt stays private.

- [x] RED: changed archive, blocked startup, unverified cleanup, wrong initial route, missing/altered native capture cannot publish verified startup.
- [x] Implement finite `lawoss-ci-native-startup` receipt: exact build/hash/installation, startup capture filename/hash/method, verified cleanup, full acceptance BLOCKED and ten unperformed scenarios; `nativeReview: pending`.
- [x] Publish only explicit `startup.json` plus `startup.png` or `startup.xwd` from owned native capture. No private profile/receipt path or PID in public JSON. Do not create a passing baseline.
- [x] GREEN: Node24.21 existing archive/alpha suites plus new meaningful regression tests; parent actual Mac artifact execution and visual capture inspection.

### Task 2: Six-target CI integration

**Files:** `.github/workflows/ci-desktop-packaging.yml`, `probe-nsis-ci.ps1`, `desktop-platform-matrix.test.mjs`.

- [x] RED: final-archive startup missing from either OS family, binary/profile upload or suppressed startup failure rejected.
- [x] Mac: build final ZIP with original native arch/ad-hoc signing after existing security gates; run probe. Linux: reuse already built final AppImage inside Xvfb; install native xwd/xprop prerequisites if absent. Windows: add opt-in `-NativeStartup` to actual NSIS probe, call the shared CLI with actual installed LAWOSS.exe; keep manual integrity-only default unchanged.
- [x] Upload only `${runner.temp}/alpha-startup-${matrix.arch}/startup.*`, explicit two-file allowlist, never unsigned archives/private roots. Existing steps remain required; startup step is required and bounded.
- [x] GREEN: matrix mutation regressions; verify YAML/PowerShell/CLI interfaces. Parent reviews exact diff, updates PATCHES/doctor/mirrored instructions/logs and commits one batch.

## Bounded swarm record

- [x] Frame: two nonoverlapping writers, base1364c47eef480b71b5bc6024c32d609a8c26742b; inherited models, no race.
- [x] Fan out: task1 owns helpers/tests; task2 owns workflow/PS/matrix tests. Parent owns this plan and docs/logs.
- [x] Aggregate: inspect actual diffs/tests and run exact Mac archive path.
- [x] Report: preserve actual artifact evidence and explicit missing target/native/full-journey results.

Ruling: pstack partition governs execution, as requested by the user; existing goal authorization covers implementation. Two disjoint writers implement the shared interface; parent integrates and reviews. Ruling: retain owned extracted payloads and leases on unverified native stop, rather than deleting live executable bytes.

Verified execution: exact Node24.21 combined152 tests/144PASS/8Windows-nativeSKIP/0FAIL; Task2prepackaged binding mutation RED/GREEN34PASS. Actual MacARM64 core test on pinned older c457 payload: finalprepackagedZIP SHA81ce96be459b8255eaac923f69aa81acdf8e0d0305537021778b7d32b6b0c59a, nativewelcome capture visuallyPASS, ownedPID/groupzero/cleanupverified, normalprofileabsent/globalDBunchanged. Re-read entire installed tree equals original inspected payload. Currentcandidate six-hostCI/fulljourneys/migration remain unproven.

Independent whole-batch review PASS at1364 base+frozenpatch8ad55355386f41e10f4514958385070aa2b430bd8ce000d5d56d61a5eb46acac; focused52PASS andprior34CI/NSISPASS. Only execution notes and CLI executable mode changed afterwards; production code unchanged. New current-candidate actual six-target CI remains next, not marked complete.
