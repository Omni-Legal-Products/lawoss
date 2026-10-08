import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
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
  writeFileSync(join(dist, "word-addin.js"), 'export const buildWordAddinManifest = (input) => JSON.stringify(input);');
  const statePath = join(root, "office-addins.json");
  writeFileSync(statePath, JSON.stringify({ enabled: true, port: 47443, installedAt: 123 }), { mode: 0o644 });
  const manifests = [];
  const backend = {
    manifestHost: (id) => id,
    writeManifest: (id, manifest) => { manifests.push({ id, input: JSON.parse(manifest) }); return { ok: !failManifest }; },
    listApps: () => [],
    caTrusted: () => false,
  };
  const manager = createOfficeAddinManager({ app: { getPath: () => root, getVersion: () => "1.2.3" }, locateServerDist: () => dist, locatePaneDist: () => null, requestServerRestart: async () => {}, createPlatformBackend: () => backend });
  return { root, manager, statePath, manifests };
}

test("legacy Office installs receive one persistent private capability and all paired manifests before listening", async (t) => {
  const f = fixture(t);
  const first = await f.manager.serverConfig();
  assert.match(first.wordAddinCapability, /^[a-f0-9]{64}$/);
  assert.equal(f.manifests.length, 3);
  assert.deepEqual(f.manifests.map((entry) => entry.id), ["word", "excel", "powerpoint"]);
  assert.ok(f.manifests.every((entry) => entry.input.capability === first.wordAddinCapability));
  const state = JSON.parse(readFileSync(f.statePath, "utf8"));
  assert.equal(state.capability, first.wordAddinCapability);
  assert.equal(state.installedAt, 123);
  if (process.platform !== "win32") assert.equal(statSync(f.statePath).mode & 0o777, 0o600);
  assert.equal((await f.manager.serverConfig()).wordAddinCapability, first.wordAddinCapability);
  assert.equal(JSON.stringify(f.manager.status()).includes(first.wordAddinCapability), false);
});

test("failed manifest migration leaves the Office listener disabled", async (t) => {
  const f = fixture(t, { failManifest: true });
  assert.equal(await f.manager.serverConfig(), null);
  assert.match(JSON.parse(readFileSync(f.statePath, "utf8")).capability, /^[a-f0-9]{64}$/);
});

test("an uninstalled Office integration does not create a capability or listener", async (t) => {
  const f = fixture(t);
  writeFileSync(f.statePath, JSON.stringify({ apps: { word: false, excel: false, powerpoint: false } }));
  assert.equal(await f.manager.serverConfig(), null);
  assert.equal(f.manifests.length, 0);
});
