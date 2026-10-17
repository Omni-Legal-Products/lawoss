# Release identity and evidence

`BuildInfoV1` identifies the checked-out source inside one desktop package.
`ReleaseEvidenceV1` binds that identity to final installers, signatures, and native acceptance.
Neither record attests the build environment cryptographically or approves legal use.

## Build identity

`apps/desktop/scripts/electron-build.mjs` writes
`apps/desktop/resources/build-info.json` after version stamping and before packaging.
The target comes from `TARGET` or `CARGO_CFG_TARGET_TRIPLE`, including cross-architecture builds.
Release input must be clean apart from the exact `apply-version.mjs` transformation and its lockfile version substitutions.
Unexpected source changes, short SHA values, and unsupported targets stop the build.

`electron-builder.yml` copies the file to `process.resourcesPath/build-info.json`.
The reader checks schema, application version, platform, and architecture.
Packaged IPC ignores runtime `LEGALWORK_GIT_SHA`, `LEGALWORK_BUILD_EPOCH`, and development-mode overrides.
A missing or invalid identity returns `provenance: unavailable` and null SHA and epoch.
Development IPC uses `provenance: development`. A dirty, unstamped local package writes no valid embedded identity and reports `unavailable`. Native Settings → Debug displays the distinction.

The embedded fields are `schemaVersion`, `product`, `version`, `gitSha`, `buildEpoch`,
`platform`, `arch`, `channel`, and `workflowRunUrl`. SHA is the full 40-character checkout identity.
Epoch is a decimal string. The record has no self-digest or future PASS.

## Record final bytes

Run this after signing, notarization, stapling, and updater hash replacement:

```sh
node scripts/release/checksums.mjs apps/desktop/dist-electron
node scripts/release/release-evidence.mjs create --build apps/desktop/resources/build-info.json --assets-dir apps/desktop/dist-electron --release-tag <exact-tag>
```

Creation uses exclusive output. Preserve an existing record instead of overwriting it.
Each target owns `release-evidence-<platform>-<arch>.json`.
Its assets include only that target's final installers, blockmaps, and target updater manifest.
For macOS the generator copies the target's feed to `latest-mac-<arch>.yml`.
The common `latest-mac.yml` is owned by the later promotion job.
Evidence excludes itself and its own checksum. Initial signing is `unverified` and acceptance is `not-run`.
A successful build or packaged-startup test does not change these fields to PASS.

```sh
node scripts/release/release-evidence.mjs verify --evidence <target-evidence.json> --assets-dir <final-assets>
node scripts/release/release-evidence.mjs verify --evidence <target-evidence.json> --assets-dir <final-assets> --require-tested
```

The first command checks current bytes. The second also requires a signature receipt and every mandatory
native scenario on both fresh and migrated profiles for every installer digest.
`fail`, `blocked`, `not-run`, another digest, and source-only results cannot satisfy it.

## Run native acceptance on macOS

Use a final signed DMG or ZIP and an application installed from those exact bytes.
Use an empty, task-owned parent directory. The runner refuses to adopt an existing ordinary profile.
Run from an interactive terminal for manual native UI judgments:

```sh
pnpm --filter @legalwork/desktop test:release-acceptance -- --prepare-profile --profile-kind fresh --profile-root <new-owned-profile>
pnpm --filter @legalwork/desktop test:release-acceptance -- --installed-app <installed-LAWOSS.app> --asset <final-DMG-or-ZIP> --evidence <target-evidence.json> --profile-kind fresh --profile-root <owned-profile> --output <fresh-receipt.json> --manual --operator <tester> --evidence-url <https-redacted-evidence-location>
```

The macOS adapter runs `codesign --verify --deep --strict` and Gatekeeper assessment.
It mounts DMG read-only or extracts ZIP into an owned temporary directory, then compares every app file,
permission mode, directory, and symlink with the installed bundle.
It launches the unchanged installed executable with isolated userData, HOME, XDG roots, runtime databases,
and workspace. Provider and signing credentials are not inherited.
The normal profile is not opened. CDP and runtime fuses remain unchanged.

The authenticated shipping UI-control `/build-info` endpoint reads `appBuildInfo` through the renderer preload IPC.
The adapter verifies its own child PID, executable, profile, embedded identity, file renderer, and live snapshot.
Restart stops that child and launches the same app and profile again.
For each functional journey the operator performs the documented steps and records `pass`, `fail`, or `blocked`.
A PASS includes the live observation and a hash of an owned-window capture. Captures stay local for review and redaction.
No JSON-only manual result can bypass installation, signature, live IPC, or profile checks in this runner.

Run migration against a copy of a previously accepted synthetic fresh profile:

```sh
pnpm --filter @legalwork/desktop test:release-acceptance -- --prepare-profile --profile-kind migrated --profile-root <new-migrated-copy> --migrate-from <old-owned-synthetic-profile>
pnpm --filter @legalwork/desktop test:release-acceptance -- --installed-app <installed-LAWOSS.app> --asset <final-installer> --evidence <target-evidence.json> --profile-kind migrated --profile-root <migrated-copy> --output <migrated-receipt.json> --manual --operator <tester> --evidence-url <https-redacted-evidence-location>
```

The old profile and its baseline remain unchanged. A running source profile cannot be copied.
Without a supported historical baseline, migration remains blocked.
Noninteractive runs perform native preflight when possible and record incomplete journeys as blocked.
Exit codes are 0 for complete native PASS, 1 for FAIL, and 2 for BLOCKED.
Invalid arguments, unsafe profiles, and wrong installer bytes fail before launching.
Windows and Linux currently have no native adapter in this command and remain blocked.
A successful unit test of the adapter is not a native acceptance result.

Import each actual PASS receipt into a new evidence snapshot:

```sh
node scripts/release/release-evidence.mjs record-acceptance --evidence <previous-evidence.json> --receipt <native-receipt.json> --assets-dir <final-assets> --out <new-evidence-snapshot.json>
```

The importer checks identity, installer digest, profile kind, operator, signature proof, mandatory scenarios,
and the hashes of local captures. A `tested` receipt appears only after both profiles pass for that installer.
Preserve all earlier snapshots. This is an auditable operator record, not a cryptographic attestation.

## Publish and promote

Run-tag payloads are immutable. `publish-electron-assets.mjs` validates the complete payload before its first upload.
It downloads existing same-name assets from the exact tag and refuses different bytes.
Identical retry is idempotent. Uploads omit `--clobber`, and read-back hashes detect changed uploaded bytes.

`--payload-only --draft-payload` stages an explicitly internal candidate only when the live release is actually draft.
It never promotes an updater feed. Public payload publication requires complete target acceptance.
The release workflows preserve initial target evidence and stop public publication when required native results are absent.
They do not convert CI source tests or packaged startup into native receipts.
Importing externally performed native acceptance into a resumed CI publication is still an operator-controlled integration step.

The stable matrix stages target payload and evidence. A single following `--manifests-only` job downloads and
verifies every referenced target, checks updater SHA-512 against final bytes, then emits the common manifest.
Its promotion receipt binds the common manifest hash to every target evidence hash.
A missing architecture or one failed target prevents this promotion.

`channel-evidence.mjs` checks the live exact source tag is public, final downloaded bytes match, signing and
fresh and migrated acceptance are complete, published receipts exist, and the platform feed is correct.
It refuses lower or equal semver. It only verifies. The existing workflow remains the owner of the subsequent pointer write.
The mutable pointer is a distribution mechanism, not source provenance. Keep the prior pointer and referenced immutable release
for rollback. A rollback to an older semver does not bypass the updater's existing downgrade guard.

`published` receipts require successful exact-tag read-back after public publication.
Do not derive them from a draft upload or a workflow success label.
`delivered` requires independent proof of transfer to the recipient. Download counts do not prove delivery.
No command here grants publication, signing, or external-send authority.

## Current verification limits

The local implementation tests use synthetic bytes and fake `gh` fixtures.
No final signed installer, supported historical profile, cross-platform native run, public upload,
channel movement, or delivery was performed in this change.
Missing accounts, legal approvals, providers, and unsupported functional journeys remain blocked.

## Next steps

Run the accepted implementation through the complete native journeys on each declared target.
Import the receipts, preserve snapshots, verify the exact uploaded payload, and only then authorize publication and promotion.

## Open questions

Assign release operators and supported baseline profiles. Define the Windows and Linux native adapters,
and the approved CI artifact handoff for externally performed acceptance before enabling public automation.
