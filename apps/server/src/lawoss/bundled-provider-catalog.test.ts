import { afterEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bundledProviderModelCatalog } from "./bundled-provider-catalog.js";
import { bundledModelsCatalogPath } from "./engine-network.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

const details = { name: "Model", tool_call: true, limit: { context: 1000, output: 100 } };

test("obnova modelov číta pribalený katalóg bez siete", async () => {
  const root = await mkdtemp(join(tmpdir(), "lawoss-bundled-catalog-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "api.json");
  await writeFile(path, JSON.stringify({ anthropic: { models: { a: details } } }));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = Object.assign(() => Promise.reject(new Error("network must not be used")), { preconnect: originalFetch.preconnect });
  try {
    expect(await bundledProviderModelCatalog("anthropic", path)).toEqual({ a: details });
    await expect(bundledProviderModelCatalog("openai", path)).rejects.toThrow("No model catalog is available for openai.");
  } finally { globalThis.fetch = originalFetch; }
});

test("chýbajúci pribalený katalóg je zrozumiteľná chyba", async () => {
  await expect(bundledProviderModelCatalog("anthropic", null)).rejects.toThrow("bundled model catalog is missing");
});

test("katalóg z repozitára obsahuje poskytovateľov pre vývoj a testy", async () => {
  const path = bundledModelsCatalogPath();
  expect(path).not.toBeNull();
  expect(Object.keys(await bundledProviderModelCatalog("anthropic", path)).length).toBeGreaterThan(0);
});
