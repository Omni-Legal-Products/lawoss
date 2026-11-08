# macOS alpha install failure

Observed while updating 0.2.10 to `0.2.11-alpha.111.g65e4bae` on macOS.

## Two independent failures

1. The ZIP downloaded successfully, but Squirrel failed to unpack it with
   `ditto: No space left on device`. The renderer had already entered `ready`:
   electron-updater resolves `downloadUpdate()` once it finishes serving the ZIP
   to Squirrel, before native validation finishes. `quitAndInstall()` then waited
   for a native completion event that would never arrive after the failure.
2. Installing the checksum-verified, signed ZIP directly exposed an incomplete
   SDK bundle. The ZIP contained only `opencode-sdk/package.json`, with none of
   its package directories. Electron Builder's `createFilter` unconditionally
   excludes a source directory's root `node_modules`, including extra resources.
   CI staged the SDK successfully, but packaging dropped the dependency graph.
   The existing startup smoke test only checked renderer controls, which remain
   available when embedded engine startup fails.

The original working app was restored. No project sharing settings were changed.

## Changes

- Map the SDK's `node_modules` contents as their own extra resource.
- Check all required SDK package manifests and the plugin version after packaging
  and before startup smoke tests; exercise SDK imports with bundled Node in the
  packaged security check.
- Run the previously omitted SDK packaging tests in the desktop test command.
- On macOS, wait for native `update-downloaded` as well as the ZIP transfer.
  Native errors and preparation timeouts return a download error to the UI.
  Reject installation unless preparation succeeded in the current app session.

## Validation

- The regression uses Electron Builder's real `getFileMatchers` and `copyFiles`
  with production YAML. It failed with missing SDK files before the mapping fix
  and passes afterward, including dependency license files.
- The real staged SDK was copied using the corrected resource mappings. Its
  plugin and SDK client imported successfully with the installed app's standalone
  Node, with no system Node on PATH. See
  `evidence/updater/alpha-install-recovery.json`.
- Updater tests cover delayed native completion, unpacking failure after ZIP
  transfer, cached-download event ordering, download failure, timeout cleanup,
  and the existing behavior on other platforms.

Reproduce checks with:

```sh
pnpm --filter @legalwork/desktop test
pnpm --filter @legalwork/desktop typecheck:electron
```

A corrected signed app has not been built and installed locally: that requires
the CI signing environment. No successful end-to-end install video is available.
After building the next alpha, run its packaged startup/security checks, install
it from 0.2.10, and verify both the current version and engine startup. The
after-pack check now rejects the incomplete SDK before signing or publishing.

## Repeated Linux CI failures

The Linux job failed twice in three existing server tests, before desktop tests:

- The view-stream bridge remembered only that it had once installed its fetch
  wrapper. Another plugin/test could restore or replace fetch afterward. The
  bridge then failed to reinstall, so local correlation headers reached the
  provider and streamed previews were not intercepted. Track the actual installed
  function instead, preserve intervening wrappers, and restore test fetch state.
  A regression deliberately replaces fetch and failed before this change.
- The PDF integration fixture compared a partial text run against Helvetica
  metrics while the canvas measured it with a host-specific fallback font.
  Keep exact native PDF run bounds in that integration fixture, including the
  existing rotation, crop and negative-citation assertions. A separate geometry
  test verifies partial-run proportional glyph widths to ten decimal places.
  No production PDF rendering behavior or assertion tolerance is changed.

With Bun 1.4.2 on an isolated Ubuntu 24.04 VM, the final PDF fixture also passes
when only a deliberately mismatched monospace fallback font is available; the
old fixture fails in that same environment. Targeted Linux checks passed. The
full Mac server suite with Bun 1.4.2 passed 2,382 tests (69 skips), and server
typecheck passed. The first full Linux VM run encountered four different
synchronization/timing failures plus a missing-npx fixture; a follow-up uses
temporary RAM-backed test files and the complete Node tool directory. The
GitHub Linux job remains the required platform check.
