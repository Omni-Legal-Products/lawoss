---
name: verify-lawoss
description: Verify LAWOSS installed desktop alpha behavior on macOS, Linux and Windows using owned synthetic profiles, native UI observations and exact artifact hashes. Use after desktop changes or before claiming six-platform alpha acceptance.
---

# Verify LAWOSS

Read [the feature map](features/README.md), then the feature being exercised. Run from the product repository root with its CI toolchain. The helper uses the shipping UI-control bridge; packaged CDP remains disabled.

## Launch

Prepare a clean synthetic profile with the existing ownership helper:

```sh
mkdir -p .work/verify-alpha
node apps/desktop/scripts/release-acceptance.mjs --prepare-profile --profile-root .work/verify-alpha/fresh --profile-kind fresh
```

Use `lawoss/testing/alpha/run.mjs` with an installed application, final archive, independently pinned SHA-256 and that build's `build-info.json`. Example for a local ARM64 Mac package:

```sh
node lawoss/testing/alpha/run.mjs --installed-app apps/desktop/dist-electron/mac-arm64/LAWOSS.app --asset apps/desktop/dist-electron/lawoss-mac-arm64-0.0.0.zip --sha256 "$LAWOSS_ALPHA_SHA256" --build-info apps/desktop/resources/build-info.json --profile .work/verify-alpha/fresh --profile-kind fresh --output .work/verify-alpha/fresh-receipt.json
```

Set `LAWOSS_ALPHA_SHA256` from the artifact producer's checksum. Confirm the actual version/filename before running; the example targets a local `0.0.0` build. For functional journeys, add `--manual --operator "$LAWOSS_ALPHA_OPERATOR"` in a real terminal and perform each prompted scenario. Noninteractive startup records remaining journeys as `blocked`. Exit codes are 0 PASS, 1 FAIL/error, 2 BLOCKED.

Linux uses the installed executable plus its final `tar.gz` or AppImage. Windows uses the installed `LAWOSS.exe` plus its final NSIS installer. Its archive tool must expose both NSIS and 7z handlers; set `ELECTRON_BUILDER_7ZIP_PATH` to a full 7-Zip executable when the packaging tool's standalone 7za lacks NSIS. Unsupported formats/layouts remain blocked. Native host architecture must match the build. Alpha integrity proof asserts no publisher signing and never unlocks public release promotion. Production acceptance remains [the release procedure](../../../docs/release-evidence.md).

For migration, stop the historical synthetic app, keep its passing `.alpha-acceptance-baseline.json` and original receipt/evidence, then prepare a separate profile using `--profile-kind migrated --migrate-from` with the old profile. Run the candidate with `--profile-kind migrated`. The runner rechecks the original receipt digest, all native evidence and a digest of the copied profile contents. An edited historical profile or current-version fresh profile cannot satisfy migration. Safe relative links stay inside the copied profile; absolute or escaping links require a separate verified migration strategy and are refused before copying.

On disposable GitHub-hosted Windows runners, `probe-nsis-ci.ps1 -Arch x64|arm64 -Output <receipt.json>` performs a real silent NSIS installation and checks its complete installed tree plus embedded checkout identity. Its `lawoss-real-nsis-installed-tree` receipt proves this integrity layer only: no native journeys, process closure, migration or publisher signing. The runner owns installation side effects and teardown; this helper refuses ordinary workstations. Never use its receipt as an alpha acceptance baseline.

CI also runs `node lawoss/testing/alpha/probe-startup-ci.mjs --output-dir <new directory>` on final Mac ZIP and Linux AppImage payloads. On Windows, the existing real installer probe opts into this additional phase with `-NativeStartup`, passing its actual installed executable. The default manual NSIS probe remains integrity-only. The shared CLI refuses ordinary workstations and mismatched checkout identities; its local core API can exercise a separately pinned older artifact without representing it as current CI.

Its separate `lawoss-ci-native-startup` receipt proves only installed-tree integrity, native startup and owned cleanup. The full alpha remains BLOCKED with ten unperformed scenarios. Only finite `startup.json` and the fresh empty synthetic welcome native image are uploaded; profiles, private receipts and unsigned binaries stay outside that directory. Download the artifact, verify the image hash and inspect the actual image before accepting native presentation: `nativeReview: pending` is not a completed visual review. This receipt never satisfies migration or publisher-signing gates.

## Doctor

The launch helper's `observe()` is the read-only doctor. It checks the owned child PID, executable, userData, embedded build identity, packaged `file:` renderer and live snapshot. Startup also waits for a complete document, no visible boot overlay and a usable control; a loading frame is incomplete. The doctor waits through only the exact presentation-watchdog response with valid readiness, inside its existing five-second total budget. It revalidates build, process and packaged renderer before each attempt; other errors fail immediately. The runner invokes it before every capture; `execute()` invokes it before actions. Re-run it after a surprising response; reset or restart a wedged UI before proceeding.

For a controlled diagnostic session, import `launchAlphaApp` from `lawoss/testing/alpha/native-app.mjs`, call it with `{installedApp, profileRoot, build}`, then use `observe()`, `execute(actionId, args)`, `capture(absoluteOutputPath)` and `stop()`. Keep the handle in the same process and use `try/finally` for `stop()`. Discovery tokens stay inside that handle.

## Drive

Wait for the runner's `Owned app ready` prompt before calling a GUI tool. Tools such as Sky may launch a default-profile instance when called before the isolated process is ready. Before and immediately after the first GUI inspection, verify that the sole process executing this exact scratch-installed bundle is the runner's PID; recheck its doctor before typing or clicking. A second instance is a blocker, never an owner to terminate automatically. Compare the observed GUI page with the doctor's route and inspect the actual capture before accepting a journey; a screenshot of another or unchanged page invalidates the evidence even if the operator entered PASS.

Use the normal native UI for onboarding, file pickers and document work. Existing shipping actions include `route.settings.general`, `route.settings.providers`, `route.settings.appearance`, `lawoss.lite.route.today` and `lawoss.lite.route.clients`; obtain the registered actions for the current UI rather than inventing IDs. Source changes to action registration require updating the affected map entry.

Before writes, copy selected entries from the pinned [synthetic corpus](../../../SYNTHETIC_DATA.md) into a disposable workspace. Keep evaluator answers outside the selected source. Configure a synthetic provider explicitly when a scenario needs inference; preflight credentials/connectivity before any billable request. Skipped AI is a supported onboarding path, not a successful inference test.

## Evidence

The runner writes the receipt and its sibling `.evidence/` directory outside the profile. Each journey binds a live observation to an owned native window capture and SHA-256. Record the actual input, visible result and file side effects when performing a manual journey. Captures may contain synthetic content; review them before sharing. Keep screenshots local by default.

For the goal's coverage report:

```sh
node lawoss/testing/alpha/run.mjs coverage "$LAWOSS_CANDIDATE_SHA" .work/verify-alpha/*-receipt.json
```

PASS requires all six targets, both profile kinds, all core journeys, the same candidate SHA and matching artifact bytes across each profile pair. Missing, failed, skipped or blocked cases remain incomplete. JSON contract tests and a package startup smoke prove their own layer only. Physical Windows testing required by the team's alpha decision remains a separate operator receipt; hosted CI alone does not establish it.

## Cleanup

`run.mjs` stops only its owned child tree. Evidence survives cleanup. Failed or unverified process cleanup retains the profile lease; prove closure before removing a stale lease. A live or leased profile cannot be used as a migration source. Preserve normal LAWOSS profiles and application identity.

Windows launches atomically inside a private kill-on-close Job Object. Cleanup requires zero job processes, the captured root handle's exit and successful supervisor closure. Helper death remains unverified. POSIX cleanup removes only the just-closed child's Chromium singleton links inside its synthetic profile; it never follows their external targets.

## Helpers

- `lawoss/testing/alpha/run.mjs`: native alpha scenarios and six-target coverage CLI.
- `lawoss/testing/alpha/native-app.mjs`: owned app control/observation/capture API.
- `lawoss/testing/alpha/installed-artifact.mjs`: final-archive integrity adapter.
- `apps/desktop/scripts/release-acceptance.mjs --prepare-profile`: exclusive fresh/migrated synthetic profiles.

Run `node --test lawoss/testing/alpha/*.test.mjs lawoss/testing/desktop-platform-matrix.test.mjs` for harness contracts. Use pstack `maintain-verification-skill` after changes to mapped behavior, and report unavailable native coverage explicitly.
