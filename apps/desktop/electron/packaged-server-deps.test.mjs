import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { findServerDepDrift } from "../scripts/check-server-deps.mjs";
import { findMissingServerImports } from "../scripts/check-packaged-server-imports.mjs";

const require = createRequire(import.meta.url);
const builderRequire = createRequire(require.resolve("electron-builder"));
const libRequire = createRequire(builderRequire.resolve("app-builder-lib"));
const { createPackage } = libRequire("@electron/asar");

test("packaging catches a server import into an excluded plugin directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "legalwork-server-imports-"));
  const stage = path.join(root, "stage");
  const routes = path.join(stage, "server/dist/routes");
  const archive = path.join(root, "app.asar");
  try {
    await mkdir(routes, { recursive: true });
    await writeFile(path.join(routes, "sessions.js"), 'import { prompt } from "../opencode-plugins/recovery.js";\n');
    await createPackage(stage, archive);
    assert.deepEqual(findMissingServerImports(archive), [{ file: "server/dist/routes/sessions.js", specifier: "../opencode-plugins/recovery.js" }]);
    await mkdir(path.join(stage, "server/dist/reviews"));
    await writeFile(path.join(stage, "server/dist/reviews/recovery.js"), 'export const prompt = "Continue";\n');
    await writeFile(path.join(routes, "sessions.js"), 'import { prompt } from "../reviews/recovery.js";\n');
    const fixedArchive = path.join(root, "fixed.asar");
    await createPackage(stage, fixedArchive);
    assert.deepEqual(findMissingServerImports(fixedArchive), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// A missing mirror only surfaces after packaging -- the alpha/release workflows
// go straight from install to build:electron, so catch it here on every PR too.
test("desktop mirrors every server runtime dependency for the packaged asar", () => {
  const { missing, mismatched } = findServerDepDrift();
  assert.deepEqual(
    missing,
    [],
    `apps/desktop/package.json is missing server runtime deps: ${missing.join(", ")}`,
  );
  assert.deepEqual(mismatched, [], `Version ranges drifted from apps/server: ${mismatched.join(", ")}`);
});
