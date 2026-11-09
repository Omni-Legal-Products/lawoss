import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { opencodeReleaseTarget } from "../../../../packages/opencode-release/index.mjs";
import { prepareNativeEngineFiles, printedEngineVersion, probeNativeEngineVersion, selectedEnginePaths, verifyNativeEngineFiles, verifyNativeEngineRuntime } from "./engine-identity.mjs";

// LAWOSS v2: the selection and its artifact verifier come from packages/opencode-release
// (generated/selection.json). These tests inject a synthetic selection with the same contract;
// the real selected derivative is exercised by engine-runtime-smoke.mjs and the native gate.
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const VERSION = "2.1.4-legalwork.http-policy.3";
const ARTIFACT = "a".repeat(64);
const filename = process.platform === "win32" ? "opencode.exe" : "opencode";

async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "native-engine-identity-"));
  const resources = path.join(root, "resources"), profile = path.join(root, "profile");
  await mkdir(profile);
  try { await run({ root, resources, profile }); } finally { await rm(root, { recursive: true, force: true }); }
}
/** Synthetic verifier: accepts only exact pinned bytes at a path of the selected artifact layout. */
function syntheticEngine(bytes, { version = VERSION, kind = "derivative", provenance = "p".repeat(64) } = {}) {
  const calls = { verify: [], stage: [] };
  return {
    calls,
    selection: { kind, version, baseVersion: "2.1.4", artifactId: ARTIFACT },
    async verify(binary, { target }) {
      calls.verify.push({ binary, target });
      const actual = await readFile(binary);
      if (hash(actual) !== hash(bytes) || path.basename(path.dirname(binary)) !== target || path.basename(path.dirname(path.dirname(binary))) !== ARTIFACT) throw new Error("Engine path does not identify the selected installed artifact.");
      return { path: binary, version, sha256: hash(actual), provenanceSha256: provenance };
    },
    async stage({ binary, directory, target }) {
      calls.stage.push({ binary, directory, target });
      await mkdir(directory, { recursive: true });
      const staged = path.join(directory, filename);
      await writeFile(staged, await readFile(binary));
      return staged;
    },
  };
}
async function bundled(resources, bytes) {
  const file = selectedEnginePaths({ resourcesDir: resources, profileDir: path.dirname(resources), artifactId: ARTIFACT, target: opencodeReleaseTarget() }).bundled;
  await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes);
  return file;
}

test("selected engine paths mirror the runtime's bundled-then-installed resolution", () => {
  const resourcesDir = path.resolve("resources"), profileDir = path.resolve("profile");
  assert.deepEqual(selectedEnginePaths({ resourcesDir, profileDir, artifactId: ARTIFACT, target: "darwin-arm64", platform: "darwin" }), {
    bundled: path.join(resourcesDir, "opencode-engine", ARTIFACT, "darwin-arm64", "opencode"),
    installed: path.join(profileDir, "engines", ARTIFACT, "darwin-arm64", "opencode"),
  });
  assert.equal(path.basename(selectedEnginePaths({ resourcesDir, profileDir, artifactId: ARTIFACT, target: "windows-x64-baseline", platform: "win32" }).bundled), "opencode.exe");
  for (const input of [{ artifactId: "1.18.29" }, { target: "../escape" }, { resourcesDir: "relative" }])
    assert.throws(() => selectedEnginePaths({ resourcesDir, profileDir, artifactId: ARTIFACT, target: "darwin-arm64", ...input }));
});

test("printed engine version normalizes only the exact `opencode v` prefix", () => {
  assert.equal(printedEngineVersion(`opencode v${VERSION}\n`), VERSION);
  assert.equal(printedEngineVersion(`${VERSION}\n`), VERSION);
  assert.equal(printedEngineVersion(`opencode ${VERSION}`), `opencode ${VERSION}`);
  assert.equal(printedEngineVersion(undefined), "");
});

test("bundled selected artifact is verified by bytes, version and provenance before and after use", () => fixture(async ({ resources, profile }) => {
  const bytes = "synthetic selected derivative", engine = syntheticEngine(bytes);
  const file = await bundled(resources, bytes);
  const prepared = await prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine });
  assert.equal(prepared.path, file); assert.equal(prepared.version, VERSION); assert.equal(prepared.identitySource, "bundled");
  const receipt = await verifyNativeEngineFiles(prepared, file);
  assert.equal(receipt.hash, hash(bytes)); assert.equal(receipt.provenanceSha256, "p".repeat(64)); assert.equal(receipt.artifactId, ARTIFACT);
  assert.ok(engine.calls.verify.every(call => call.target === opencodeReleaseTarget()));
  await assert.rejects(verifyNativeEngineFiles(prepared, path.join(path.dirname(file), "other")), /selected engine path/);
  await writeFile(file, "replaced same-name bytes");
  await assert.rejects(verifyNativeEngineFiles(prepared, file), /hash/);
  await writeFile(file, bytes);
  engine.verify = async binary => ({ path: binary, version: VERSION, sha256: hash(bytes), provenanceSha256: "q".repeat(64) });
  await assert.rejects(verifyNativeEngineFiles(prepared, file), /provenance/);
  await prepared.cleanup(); assert.equal(await readFile(file, "utf8"), bytes);
}));

test("wrong selection kind, unverified bytes and a different artifact version fail closed", () => fixture(async ({ resources, profile }) => {
  await bundled(resources, "synthetic bytes");
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine: syntheticEngine("synthetic bytes", { kind: "official" }) }), /derivative/);
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine: syntheticEngine("other pinned bytes") }), /selected installed artifact/);
  const stale = syntheticEngine("synthetic bytes"); stale.verify = async binary => ({ path: binary, version: "1.18.29", sha256: hash("synthetic bytes"), provenanceSha256: "p".repeat(64) });
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine: stale }), /version/);
  const unverified = syntheticEngine("synthetic bytes"); unverified.verify = async () => undefined;
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine: unverified }), /not verified/);
}));

test("missing bundled engine never borrows bytes; an explicit fixture is staged only into the owned profile", () => fixture(async ({ root, resources, profile }) => {
  const bytes = "synthetic external derivative", external = path.join(root, "external", filename);
  await mkdir(path.dirname(external)); await writeFile(external, bytes);
  const engine = syntheticEngine(bytes);
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, engine }), /missing/);
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, externalEngine: "opencode", engine }), /absolute/);
  const prepared = await prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, externalEngine: external, engine });
  const installed = selectedEnginePaths({ resourcesDir: resources, profileDir: profile, artifactId: ARTIFACT, target: opencodeReleaseTarget() }).installed;
  assert.equal(prepared.path, installed); assert.equal(prepared.identitySource, "owned-staged-fixture");
  assert.deepEqual(engine.calls.stage, [{ binary: external, directory: path.dirname(installed), target: opencodeReleaseTarget() }]);
  await assert.rejects(lstat(path.join(resources, "opencode-engine")), { code: "ENOENT" }, "Application resources are never provisioned by the test");
  await assert.rejects(prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, externalEngine: external, engine }), /already holds/);
  await prepared.cleanup();
  await assert.rejects(lstat(path.dirname(installed)), { code: "ENOENT" });
  assert.equal(await readFile(external, "utf8"), bytes);
}));

test("bundled engine wins over an explicit fixture and runtime health must report the selected version", () => fixture(async ({ root, resources, profile }) => {
  const bytes = "synthetic selected derivative", engine = syntheticEngine(bytes), file = await bundled(resources, bytes);
  const external = path.join(root, "external"); await writeFile(external, bytes);
  const prepared = await prepareNativeEngineFiles({ resourcesDir: resources, profileDir: profile, externalEngine: external, engine });
  assert.equal(prepared.path, file); assert.equal(engine.calls.stage.length, 0);
  await assert.rejects(verifyNativeEngineRuntime(prepared, file, { version: "1.18.29" }), /api\/info version/);
  await assert.rejects(verifyNativeEngineRuntime(prepared, file, null), /api\/info version/);
  assert.throws(() => probeNativeEngineVersion(process.execPath, VERSION), /version/); // Actual native executable, not a simulated result.
  assert.throws(() => probeNativeEngineVersion("opencode", VERSION), /absolute/);
  assert.throws(() => probeNativeEngineVersion(process.execPath, ""), /Expected/);
}));
