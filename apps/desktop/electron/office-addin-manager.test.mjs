import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createOfficeAddinManager } from "./office-addin-manager.mjs";

function fixture(t, { failManifest = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "lawoss-office-pairing-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cert = join(root, "office-addin-certs");
  mkdirSync(cert);
  writeFileSync(join(cert, "localhost.crt"), "synthetic certificate");
  writeFileSync(join(cert, "localhost.key"), "synthetic key");
  const dist = join(root, "dist");
  mkdirSync(dist);
  writeFileSync(join(dist, "package.json"), '{"type":"module"}');
  writeFileSync(join(dist, "word-addin.js"), 'export const buildWordAddinManifest = (input) => JSON.stringify(input);\nexport const loadOfficeConnectionToken = async () => "' + "t".repeat(64) + '";');
  const statePath = join(root, "office-addins.json");
  writeFileSync(statePath, JSON.stringify({ enabled: true, port: 47443, installedAt: 123 }), { mode: 0o644 });
  const manifests = [];
  const backend = {
    manifestHost: (id) => id,
    writeManifest: (id, manifest) => { manifests.push({ id, input: JSON.parse(manifest) }); return { ok: !failManifest }; },
    listApps: () => [],
    caTrusted: () => false,
  };
  const manager = createOfficeAddinManager({ app: /** @type {import("electron").App} */ (/** @type {unknown} */ ({ getPath: () => root, getVersion: () => "1.2.3" })), locateServerDist: () => dist, locatePaneDist: () => null, requestServerRestart: async () => {}, createPlatformBackend: () => /** @type {ReturnType<typeof import("./office-addin-platform.mjs").createOfficeAddinPlatformBackend>} */ (/** @type {unknown} */ (backend)) });
  return { root, manager, statePath, manifests };
}

// Upstream v0.2.18: the installation credential comes from the server's private
// token file; LAWOSS keeps the state file private and atomically written.
test("existing Office installs refresh every manifest with the private connection credential", async (t) => {
  const f = fixture(t);
  await f.manager.refreshManifests();
  assert.deepEqual(f.manifests.map((entry) => entry.id), ["word", "excel", "powerpoint"]);
  assert.ok(f.manifests.every((entry) => entry.input.connectionToken === "t".repeat(64)));
  const config = await f.manager.serverConfig();
  assert.equal(config.wordAddin, true);
  assert.equal("wordAddinCapability" in config, false);
  assert.equal(JSON.stringify(f.manager.status()).includes("t".repeat(64)), false);
  assert.equal(readFileSync(f.statePath, "utf8").includes("t".repeat(64)), false);
});

test("a failed manifest refresh does not block the Office listener", async (t) => {
  const f = fixture(t, { failManifest: true });
  await f.manager.refreshManifests();
  assert.notEqual(await f.manager.serverConfig(), null);
});

test("an uninstalled Office integration starts no listener and writes no manifest", async (t) => {
  const f = fixture(t);
  writeFileSync(f.statePath, JSON.stringify({ apps: { word: false, excel: false, powerpoint: false } }));
  await f.manager.refreshManifests();
  assert.equal(await f.manager.serverConfig(), null);
  assert.equal(f.manifests.length, 0);
});
