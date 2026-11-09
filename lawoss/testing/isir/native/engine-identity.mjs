import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, readFile, realpath, rm, stat } from "node:fs/promises";
import path from "node:path";
import { opencodeReleaseTarget } from "../../../../packages/opencode-release/index.mjs";

// LAWOSS v2: the native gate runs the selected LAWOSS derivative engine. Its version and exact
// artifact come from the prepared build selection (packages/opencode-release/generated/selection.json,
// read through selection.mjs), never from a pinned literal. The selection exists only after engine
// preparation, so it is loaded on first use; unit tests inject a synthetic selection and verifier.
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const missing = error => error.code === "ENOENT";
const exists = file => lstat(file).then(() => true, error => { if (missing(error)) return false; throw error; });

export async function selectedNativeEngine() {
  const { opencodeEngineSelection, verifySelectedOpencodeEngine, stageSelectedOpencodeEngine } = await import("../../../../packages/opencode-release/selection.mjs");
  return { selection: opencodeEngineSelection, verify: verifySelectedOpencodeEngine, stage: stageSelectedOpencodeEngine };
}

/** Mirror of findSelectedOpencodeBinary (apps/desktop/electron/runtime.mjs): bundled resources first,
 * then the profile's installed engine. No PATH or other fallback exists. */
export function selectedEnginePaths({ resourcesDir, profileDir, artifactId, target, platform = process.platform }) {
  assert.ok(path.isAbsolute(resourcesDir) && path.isAbsolute(profileDir), "Native engine locations must be absolute");
  assert.match(artifactId ?? "", /^[a-f0-9]{64}$/, "Selected engine artifact must be a manifest digest");
  assert.match(target ?? "", /^[a-z0-9-]+$/, "Selected engine target is invalid");
  const filename = platform === "win32" ? "opencode.exe" : "opencode";
  return {
    bundled: path.join(resourcesDir, "opencode-engine", artifactId, target, filename),
    installed: path.join(profileDir, "engines", artifactId, target, filename),
  };
}

/** `opencode --version` prints `opencode v<version>`; `/api/info` reports the bare version. */
export function printedEngineVersion(stdout) {
  const printed = typeof stdout === "string" ? stdout.trim() : "";
  return printed.startsWith("opencode v") ? printed.slice("opencode v".length) : printed;
}

export function probeNativeEngineVersion(executable, expectedVersion) {
  assert.ok(path.isAbsolute(executable), "Engine executable must be absolute, never an arbitrary PATH command");
  assert.ok(typeof expectedVersion === "string" && expectedVersion, "Expected selected engine version required");
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, "Real selected native engine version probe failed");
  assert.equal(printedEngineVersion(version.stdout), expectedVersion, "Native engine version differs from the selected engine");
  return expectedVersion;
}

/** File-level identity of the engine the application will select. An explicit external engine is
 * staged (verified five-file artifact) only into the owned test profile, never into resources. */
export async function prepareNativeEngineFiles({ resourcesDir, profileDir, externalEngine, platform = process.platform, arch = process.arch, engine }) {
  engine ??= await selectedNativeEngine();
  const { selection } = engine;
  assert.equal(selection?.kind, "derivative", "Native ISIR requires the selected LAWOSS derivative engine");
  if (externalEngine !== undefined) assert.ok(path.isAbsolute(externalEngine), "Explicit external engine fixture must be an absolute path");
  const target = opencodeReleaseTarget(platform, arch);
  const paths = selectedEnginePaths({ resourcesDir, profileDir, artifactId: selection.artifactId, target, platform });
  let selected = paths.bundled, identitySource = "bundled", owned = null;
  if (!await exists(paths.bundled)) {
    assert.ok(externalEngine, "Selected bundled engine is missing; run the desktop build or pass an explicit verified external engine");
    assert.equal(await exists(path.dirname(paths.installed)), false, "Owned profile already holds an engine; never reuse unowned bytes");
    owned = path.dirname(paths.installed);
    selected = await engine.stage({ binary: externalEngine, directory: owned, target });
    identitySource = "owned-staged-fixture";
  }
  const cleanup = async () => { if (owned) await rm(owned, { recursive: true, force: true }); };
  try {
    assert.ok((await stat(selected)).isFile(), "Selected engine must be a regular executable file");
    const descriptor = await engine.verify(selected, { target });
    assert.ok(descriptor, "Selected engine was not verified against its prepared artifact");
    assert.equal(descriptor.version, selection.version, "Selected engine artifact version differs from the build selection");
    const expectedHash = sha256(await readFile(selected));
    assert.equal(expectedHash, descriptor.sha256, "Selected engine bytes differ from the verified artifact");
    const prepared = { path: path.resolve(selected), realPath: await realpath(selected), expectedHash, version: selection.version,
      artifactId: selection.artifactId, target, identitySource, provenanceSha256: descriptor.provenanceSha256, engine, cleanup };
    await verifyNativeEngineFiles(prepared, prepared.path);
    return prepared;
  } catch (error) { await cleanup(); throw error; }
}

export async function verifyNativeEngineFiles(prepared, executedPath) {
  assert.ok(typeof executedPath === "string" && path.isAbsolute(executedPath), "Executed engine must use the selected engine path, never PATH");
  assert.equal(path.resolve(executedPath), prepared.path, "Executed engine must use the selected engine path");
  const actualRealPath = await realpath(executedPath);
  assert.equal(actualRealPath, prepared.realPath, "Executed engine target identity changed");
  assert.ok((await stat(executedPath)).isFile(), "Executed engine is not a regular file");
  const hash = sha256(await readFile(executedPath));
  assert.equal(hash, prepared.expectedHash, "Executed engine hash differs from prepared byte identity");
  const descriptor = await prepared.engine.verify(executedPath, { target: prepared.target });
  assert.ok(descriptor, "Executed engine is no longer the verified selected artifact");
  assert.equal(descriptor.sha256, hash, "Executed engine hash differs from its verified artifact");
  assert.equal(descriptor.provenanceSha256, prepared.provenanceSha256, "Executed engine provenance changed");
  return { path: path.resolve(executedPath), realPath: actualRealPath, hash, expectedHash: prepared.expectedHash, version: prepared.version,
    artifactId: prepared.artifactId, target: prepared.target, identitySource: prepared.identitySource, provenanceSha256: prepared.provenanceSha256 };
}

/** `health` is the authenticated instance-free `/api/info` body of the running engine. */
export async function verifyNativeEngineRuntime(prepared, executedPath, health) {
  assert.equal(health?.version, prepared.version, "Running engine /api/info version differs from the selected engine");
  await verifyNativeEngineFiles(prepared, executedPath);
  const version = probeNativeEngineVersion(executedPath, prepared.version);
  const receipt = await verifyNativeEngineFiles(prepared, executedPath);
  return { ...receipt, version, healthVersion: health.version };
}
