# Isolating optional cloud-provider settings failures

Follow-up to [PR #309](https://github.com/eigenweltlabs/legalwork/pull/309), which addresses [issue #305](https://github.com/eigenweltlabs/legalwork/issues/305).

## Failure and correction

The detector read Dropbox, Nextcloud and ownCloud settings in one `Promise.all`. A JSON parse error or filesystem read error in any one file rejected the whole operation before it could inspect other providers or run the Windows/macOS target-folder probe. As a result, sharing status and document sync could fail for an ordinary project unrelated to the broken provider. This was an error-handling weakness, not a change to ordinary upload/download/conflict rules.

Each supplemental configuration read is now isolated. A failed read contributes any roots successfully learned from that same configuration earlier in the current server process. Other valid provider configurations and the OS checks still run. A successfully parsed replacement refreshes those roots, including clearing them when an account is unlinked. Briefly missing files retain known roots to handle atomic configuration replacements.

A warning is logged once per failing file until it recovers. The warning includes only the configuration filename, not its contents, account details or full path. Native errors inspecting the actual target folder still propagate; this change does not turn every detection error into “local”.

## Verification

The regression failed on merged `dev` with `SyntaxError: JSON Parse error` before the change. It now succeeds with a real temporary malformed Dropbox configuration and the real detector.

The project-sharing integration test then checks both directions of ordinary document sync through the synthetic firm service while those settings are corrupt. In the same run, an existing project whose stored Documents scope is still true remains blocked after its detected cloud configuration breaks, and its private document is not uploaded. No cloud-detector stub is used in this test; only the user-home lookup points to an isolated fixture profile.

Additional cases cover independent providers, real filesystem read errors, temporary missing settings, successful recovery/account unlinking, warning deduplication, cold-start OS-known cloud folders, and propagation of target-folder metadata errors.

Commands:

```sh
pnpm exec bun test apps/server/src/cloud-folder.test.ts apps/server/src/project-file-sync.test.ts apps/server/src/project-sync.test.ts apps/server/src/project-review-sync.test.ts apps/server/src/file-storage/project-folders.test.ts
pnpm --filter legalwork-server build
```

On an isolated Windows test machine, after building the server, run as administrator:

```sh
node scripts/diagnostics/cloud-folder-providers-windows.mjs
```

The native harness uses synthetic registry/configuration fixtures and actual Windows calls. It checks an ordinary folder with a corrupt configuration on first inspection, a registered cloud root under the same conditions, read errors, retention of a learned Dropbox root, other-provider independence and continued rejection of native target-lookup failures. It does not sign in to real cloud providers. This is a backend error-handling change; no new UI screenshot was captured. The reproducible tests and machine-readable results provide the evidence.

Results: **76 regression tests / 353 assertions passed**, the server build passed, and **32 native Windows checks passed**. [Machine-readable results and tested source hashes](../../evidence/onedrive/provider-detection-isolation-results.json).

## Limits

The retained configuration roots are **in memory for the current server process**, not persisted across app restarts. Standard macOS File Provider/iCloud locations and Windows registered roots remain detectable independently of these files. An unregistered legacy provider whose only configuration is already unreadable on first inspection cannot be identified from that configuration; this is best-effort supplemental discovery, not universal proof that a folder is local. The existing provider-coverage limits still apply.

This follow-up changes neither project-wide remote sharing settings nor existing cloud-folder sharing policy. Detected cloud folders remain blocked from document copying on the local computer; ordinary local member copies can still share according to the remote project's scope. Existing local and uploaded files are preserved.
