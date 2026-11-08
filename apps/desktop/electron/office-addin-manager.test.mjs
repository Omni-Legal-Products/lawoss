import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
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

// Upstream v0.3.0: explicit OS trust changes notify the host transport.

async function trustFixture() {
  const root = await mkdtemp(join(tmpdir(), "lw-office-trust-notification-"));
  const dist = join(root, "dist"), data = join(root, "profile");
  await Promise.all([mkdir(dist), mkdir(data)]);
  await writeFile(join(root, "package.json"), '{"type":"module"}');
  await writeFile(join(dist, "word-addin.js"), 'export const buildWordAddinManifest=()=>"owned-fixture";export const loadOfficeConnectionToken=async()=>"fixture";');
  const cert = join(root, "cert.mjs"), platform = join(root, "platform.mjs");
  await writeFile(cert, 'export const ensureLocalCert=async()=>({leafCertPath:"unused",caCertPath:"unused"});export const leafCertValid=()=>true;export const officeAddinCertToolAvailable=()=>true;export const caFingerprint=()=>"fixture";');
  await writeFile(platform, `export const state={trusted:false,trustOK:true,untrustOK:true,manifestOK:true};export function createOfficeAddinPlatformBackend(){return{listApps:()=>[{id:'word',label:'Word',installed:true}],caTrusted:()=>state.trusted,trustCa:()=>({ok:state.trustOK,error:state.trustOK?undefined:'declined'}),untrustCa:()=>({ok:state.untrustOK,error:state.untrustOK?undefined:'declined'}),manifestHost:()=> 'Word',writeManifest:()=>({ok:state.manifestOK,error:state.manifestOK?undefined:'fixture manifest failure'}),removeManifest:()=>({ok:true})}}`);
  // Link the actual manager to pure test backends. These tests never generate,
  // import, remove or inspect certificates in any real OS trust store.
  const source = await readFile(new URL("./office-addin-manager.mjs", import.meta.url), "utf8");
  assert.equal(source.split('"./office-addin-cert.mjs"').length, 2);
  assert.equal(source.split('"./office-addin-platform.mjs"').length, 2);
  const linked = source.replace('"./office-addin-cert.mjs"', JSON.stringify(pathToFileURL(cert).href)).replace('"./office-addin-platform.mjs"', JSON.stringify(pathToFileURL(platform).href));
  const { createOfficeAddinManager: createLinkedManager } = await import(`data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`);
  const { state } = await import(pathToFileURL(platform).href);
  const events = [];
  const manager = createLinkedManager({ app: { getPath: () => data, getVersion: () => "0.0.0" }, locateServerDist: () => dist, locatePaneDist: () => null,
    requestServerRestart: async () => { events.push("restart"); }, onTrustStoreChanged: () => { events.push("trust-changed"); } });
  return { state, manager, events, close: () => rm(root, { recursive: true, force: true }) };
}

test("successful explicit trust invalidates before a later manifest failure, without a restart or certificate IPC", async () => {
  const f = await trustFixture();
  try {
    f.state.manifestOK = false;
    const result = await f.manager.install("word");
    assert.equal(result.ok, false); assert.match(result.error, /manifest failure/);
    assert.deepEqual(f.events, ["trust-changed"]);
  } finally { await f.close(); }
});

test("skipped or failed OS trust never emits the successful-change notification", async () => {
  for (const trusted of [true, false]) {
    const f = await trustFixture();
    try {
      f.state.trusted = trusted; f.state.trustOK = false;
      const result = await f.manager.install("word");
      assert.equal(result.ok, trusted);
      assert.deepEqual(f.events, trusted ? ["restart"] : []);
    } finally { await f.close(); }
  }
});

test("only a successful explicit final uninstall invalidates trust, preserving denied uninstall state", async () => {
  const f = await trustFixture();
  try {
    f.state.trusted = true;
    assert.equal((await f.manager.install("word")).ok, true); f.events.length = 0;
    f.state.untrustOK = false;
    assert.equal((await f.manager.uninstall("word")).ok, false);
    assert.deepEqual(f.events, []); assert.equal(f.manager.readState().apps.word, true);
    f.state.untrustOK = true;
    assert.equal((await f.manager.uninstall("word")).ok, true);
    assert.deepEqual(f.events, ["trust-changed", "restart"]); assert.equal(f.manager.readState().apps.word, false);
  } finally { await f.close(); }
});
