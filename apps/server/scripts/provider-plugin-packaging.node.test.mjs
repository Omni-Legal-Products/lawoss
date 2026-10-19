import assert from "node:assert/strict";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { test } from "node:test";
import { findUnresolvableImports } from "../../desktop/scripts/check-plugin-bundles.mjs";

test("the shipped provider observer helper imports outside every node_modules tree", async () => {
  const root = await mkdtemp(join(tmpdir(), "provider-plugin-package-"));
  try {
    const staged = join(root, "provider-failure-observer.js");
    await copyFile(fileURLToPath(new URL("../dist/opencode-plugins/provider-failure-observer.js", import.meta.url)), staged);
    assert.deepEqual(findUnresolvableImports(root), []);
    const module = await import(pathToFileURL(staged).href);
    assert.deepEqual(Object.keys(module), ["providerFailureObserver"]);
    const observer = module.providerFailureObserver({});
    assert.equal(typeof observer.headers, "function");
    await observer.dispose();
  } finally { await rm(root, { recursive: true, force: true }); }
});
