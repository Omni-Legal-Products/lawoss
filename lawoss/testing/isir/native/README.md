# Focused native import boundary regression

The regular desktop native CI still runs `node scripts/test-isir-native.mjs` against the built app and real synthetic file-copy IPC. Its picker now requires the completed renderer artifact and committed workspace route before returning to Files.

The focused browser check below is an explicit local regression, not an additional scheduled CI job. Use the repository-pinned Node/pnpm/Bun and an independently installed repository dependency graph. Supply a Chromium executable, a private HOME/TMPDIR and an owned build directory; never use a personal browser profile. The existing renderer compiler needs the app's `dist/index.html` and runs from `apps/app` through the launcher.

```sh
node lawoss/testing/isir/native/import-boundary.browser.mjs "$CHROMIUM_EXECUTABLE" "$OWNED_BUILD_ROOT" completion
node lawoss/testing/isir/native/import-boundary.browser.mjs "$CHROMIUM_EXECUTABLE" "$OWNED_BUILD_ROOT" siblings
node lawoss/testing/isir/native/import-boundary.browser.mjs "$CHROMIUM_EXECUTABLE" "$OWNED_BUILD_ROOT" immediate
node lawoss/testing/isir/native/import-boundary.browser.mjs "$CHROMIUM_EXECUTABLE" "$OWNED_BUILD_ROOT" wait-error
node --test lawoss/testing/isir/native/project-files-navigation.test.mjs
```

On the first run, the existing native fixture compiler creates a private preview copy without changing `dist`. Recompile after fixture changes; do not treat a previously compiled fixture as evidence for new source:

```sh
(cd apps/app && node --max-old-space-size=6144 ../../lawoss/testing/isir/native/renderer.mjs --compile-fixtures "$PWD" "$OWNED_BUILD_ROOT/renderer-preview")
```

The browser executes the current native picker's actual function body using real CDP, WorkspaceEntryMenu, file input, useProjectFileImport, file-copy store and router. Its synthetic importer copies bytes through an owned loopback sink and can hold renderer completion after that receipt. The mounted router callback models the inspected SessionPage import navigation; it does not mount the entire application shell or prove the exact scheduling of a historical native failure. New visible tabs, route/owner identity, same-path stale tabs, sibling inputs, duplicate/hidden nodes and primary wait-error propagation are covered. The final two optional arguments select immutable driver/observer snapshots for RED replay; ordinary runs always use current source.

Keep native startup, processing/root readiness, reconnect, output-byte and next-head platform CI assertions authoritative. A local browser PASS is not an Electron/engine/platform acceptance PASS.
