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
The dedicated `release-acceptance-resume.yml` workflow validates operator intake against original run artifacts and resumes their publication without rebuilding.

The stable matrix stages target payload and evidence. A single following `--manifests-only` job downloads and
verifies every referenced target, checks updater SHA-512 against final bytes, then emits the common manifest.
Its promotion receipt binds the common manifest hash to every target evidence hash.
A missing architecture or one failed target prevents this promotion.

`channel-evidence.mjs` checks the live exact source tag is public, final downloaded bytes match, signing and
fresh and migrated acceptance are complete, published receipts exist, and the platform feed is correct.
It refuses lower or equal semver. It only verifies. The pointer is written by `scripts/release/acceptance-promotion.mjs`
in `release-acceptance-resume.yml` (Resume exact desktop release acceptance), after the same gates.
The alpha workflows reach their own pointer step only with tested evidence, which a fresh build does not have.
A pointer someone turned into a draft is still compared by version. The promotion publishes it again
(`--draft=false --prerelease --latest=false`) only after every file it holds was verified and read back in the same run.
Otherwise it stays a draft and the run fails, so a stale manifest of another target is never made public again.
The mutable pointer is a distribution mechanism, not source provenance. Keep the prior pointer and referenced immutable release
for rollback. A rollback to an older semver does not bypass the updater's existing downgrade guard.

`published` receipts require successful exact-tag read-back after public publication.
Do not derive them from a draft upload or a workflow success label.
`delivered` requires independent proof of transfer to the recipient. Download counts do not prove delivery.
No command here grants publication, signing, or external-send authority.

## Hand native acceptance back to CI

Each source target preserves `release-candidate-<run-id>-<attempt>-<platform>-<arch>` for 30 days
before its public acceptance gate. This artifact includes the actual final installer, target updater files,
checksums, original target evidence, and `release-candidate.json`. A failed public gate does not discard the installer.
Unsigned internal Windows candidates remain in the existing private draft path and are not uploaded as public Actions artifacts.

Download the exact candidate from its original run and install that artifact. Complete the native runner for
fresh and migrated profiles for each installer in the evidence. Keep the original candidate files unchanged.
Package actual PASS receipts after the local capture hashes have been checked:

```sh
node scripts/release/acceptance-handoff.mjs pack --candidate-dir <downloaded-candidate> --receipt <fresh-receipt.json> --receipt <migrated-receipt.json> --out <target-intake.json>
```

Repeat `--receipt` for every installer. The portable intake keeps capture hashes and redacted evidence URLs,
removes local capture paths, and binds the original repository, source run and attempt, workflow commit,
target, build SHA, stamped version, release tag, source evidence digest, and candidate digest.
It is an operator record, not a cryptographic attestation or an automatic native PASS.

In **Resume exact desktop release acceptance**, choose **intake**, provide the original `source_run_id`,
and paste the portable target JSON into `intake_json`. This read-only validation job downloads the original
candidate and checks its producer identity, bytes, and complete target acceptance before preserving a
`release-native-intake-<source-run-id>-<intake-run-id>` artifact. Intake may cover one target at a time.
A pending, blocked, foreign-SHA, changed-byte, or missing migrated receipt fails the job.

After all targets of the original workflow have successful intake runs, choose **resume** and provide their
comma-separated `intake_run_ids`. The collector accepts only successful same-repository intake workflow runs.
It downloads their exact artifacts and checks for missing or duplicate targets. Resume re-downloads and
revalidates the original build candidate, then stages accepted evidence on the draft release.
It never runs version stamping, compilation, packaging, signing, or the native runner.
A new resume run number cannot change the source run's version, tag, SHA, or installer bytes.

Choose **publish** only for the deliberate public operation after completing every target's acceptance.
The job checks every intake and existing payload collision before release mutation, uploads immutable bytes,
updates accepted canonical evidence, makes the exact release public, reads the final payload back, and appends
`published` receipts. Only after every target's updated canonical evidence and full history are verified remotely
may it publish a common manifest or the corresponding alpha platform feed. Repeating the same intake is
idempotent. A different intake replay, foreign tag target, or stale payload is refused.

The original workflow target matrix defines required coverage. The current native runner supports macOS;
missing supported Windows/Linux native receipts remain blocked. Intake transport does not invent those results.

## Preserve canonical evidence revisions

`evidence-revision.mjs` is the dedicated metadata effect owner. The resume workflow serializes its revisions
under `desktop-release-metadata-<repository>` with cancellation disabled. Payload uploads remain immutable.

For a canonical update, the writer checks the original digest precondition, immutable build/tag/target/assets,
and retention of every prior state receipt and passing acceptance. It archives the exact old remote bytes as
`release-evidence-<platform>-<arch>-sha256-<digest>.json`, verifies that immutable upload, and appends the snapshot
to `evidenceHistory`. All earlier snapshots must exist, retain their exact hashes, and form the same prefix chain.
A snapshot collision or missing chain blocks both revision and subsequent feed publication.

After preserving the snapshot, the writer rechecks the canonical bytes and numeric REST asset ID.
It deletes only that captured asset ID, then creates the new canonical asset exclusively.
It never uses `--clobber` for evidence or installers. A concurrent replacement has another asset ID or occupies
the canonical name and is refused. If the canonical upload is interrupted, retry uses the unchanged prior digest
and preserved snapshot. Exact successful retries make no changes. Only the existing named mutable updater feeds
remain an explicit `--clobber` exception after all publication gates.

This is serialized release automation, not a cross-service transaction. Out-of-band writers must use the same owner;
any detected race, read-back error, or missing chain stops promotion and requires retry/reconciliation.

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
and actual native final-artifact receipts before using public automation. The implemented CI handoff preserves their original source identity.
