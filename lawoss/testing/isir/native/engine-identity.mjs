import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, stat, mkdir, readFile, realpath, readlink, symlink, rm } from "node:fs/promises";
import path from "node:path";

export const PINNED_ENGINE_VERSION = "1.18.29";
const sha256 = bytes => createHash("sha256").update(bytes).digest("hex");
const within = (root, file) => { const relative = path.relative(root, file); return relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative); };
const missing = error => error.code === "ENOENT";

// Mirror the existing runtime's platform-target-first, canonical-second policy.
export function nativeEngineCandidates(platform = process.platform, arch = process.arch) {
  assert.ok(["arm64", "x64"].includes(arch), `Unsupported native engine architecture: ${arch}`);
  const architecture = arch === "arm64" ? "aarch64" : "x86_64";
  const target = { darwin: "apple-darwin", linux: "unknown-linux-gnu", win32: "pc-windows-msvc" }[platform];
  assert.ok(target, `Unsupported native engine platform: ${platform}`);
  const extension = platform === "win32" ? ".exe" : "";
  return [`opencode-${architecture}-${target}${extension}`, `opencode${extension}`];
}

async function manifests(bundleDir, candidateNames) {
  const targetManifest = `versions.json-${candidateNames[0].slice("opencode-".length)}`;
  const entries = [];
  for (const name of ["versions.json", targetManifest]) {
    const file = path.join(bundleDir, name);
    let entry;
    try { entry = await lstat(file); } catch (error) { if (missing(error)) continue; throw error; }
    assert.ok(entry.isFile() && !entry.isSymbolicLink(), "Engine manifest must be a regular bundled file");
    const bytes = await readFile(file), metadata = JSON.parse(bytes.toString("utf8"));
    assert.equal(metadata?.opencode?.version, PINNED_ENGINE_VERSION, "Prepared engine manifest version differs from pinned version");
    assert.match(metadata?.opencode?.sha256 ?? "", /^[a-f0-9]{64}$/, "Prepared engine manifest hash is missing or malformed");
    entries.push({ path: await realpath(file), hash: sha256(bytes), engineHash: metadata.opencode.sha256 });
  }
  return entries;
}

/** File-level identity; foreign platform fixtures never need to be executed. */
export async function prepareNativeEngineFiles({ bundleDir, externalEngine, platform = process.platform, arch = process.arch }) {
  assert.ok(path.isAbsolute(bundleDir), "Native engine bundle must be absolute");
  if (externalEngine !== undefined) assert.ok(path.isAbsolute(externalEngine), "Explicit external engine fixture must be an absolute path");
  const candidateNames = nativeEngineCandidates(platform, arch);
  const expectedManifests = await manifests(bundleDir, candidateNames);
  let selected;
  for (const name of candidateNames) {
    const candidate = path.join(bundleDir, name);
    try { await lstat(candidate); selected = candidate; break; } catch (error) { if (!missing(error)) throw error; }
  }
  let owned;
  if (!selected) {
    assert.equal(expectedManifests.length, 0, "Prepared engine is missing despite a build manifest; rebuild instead of borrowing external bytes");
    assert.ok(externalEngine, "Pinned bundled engine is missing; use the desktop build or an explicit external fixture");
    assert.ok((await stat(externalEngine)).isFile(), "External engine fixture must be a regular executable file");
    const externalRealPath = await realpath(externalEngine), externalHash = sha256(await readFile(externalEngine));
    await mkdir(bundleDir, { recursive: true });
    selected = path.join(bundleDir, candidateNames[1]);
    await symlink(externalEngine, selected); // Never overwrite an existing candidate.
    const entry = await lstat(selected);
    owned = { target: externalEngine, realPath: externalRealPath, hash: externalHash, dev: entry.dev, ino: entry.ino };
  }
  const cleanup = async () => {
    if (!owned) return;
    const entry = await lstat(selected).catch(error => { if (missing(error)) return null; throw error; });
    if (entry?.isSymbolicLink() && entry.dev === owned.dev && entry.ino === owned.ino && await readlink(selected) === owned.target) await rm(selected);
  };
  try {
    const canonicalBundle = await realpath(bundleDir);
    const selectedRealPath = await realpath(selected);
    assert.ok(within(canonicalBundle, selectedRealPath) || owned?.realPath === selectedRealPath, "Prepared engine resolves outside its bundle without owned provisioning");
    assert.ok((await stat(selected)).isFile(), "Prepared engine candidate must be a regular executable file");
    const expectedHash = sha256(await readFile(selected));
    if (owned) assert.equal(expectedHash, owned.hash, "Provisioned engine hash changed during preparation");
    if (!owned) assert.ok(expectedManifests.length > 0, "Existing prepared engine requires its build manifest");
    for (const manifest of expectedManifests) assert.equal(expectedHash, manifest.engineHash, "Prepared engine hash differs from build manifest");
    const prepared = {
      path: path.resolve(selected), bundleDir: canonicalBundle, realPath: selectedRealPath, expectedHash, candidateNames,
      identitySource: owned ? "owned-provisioned-fixture" : "manifest", manifests: expectedManifests,
      cleanup,
    };
    await verifyNativeEngineFiles(prepared, prepared.path);
    return prepared;
  } catch (error) { await cleanup(); throw error; }
}

export function probeNativeEngineVersion(executable) {
  assert.ok(path.isAbsolute(executable), "Engine executable must be absolute, never an arbitrary PATH command");
  const version = spawnSync(executable, ["--version"], { encoding: "utf8" });
  assert.equal(version.status, 0, "Real pinned native engine version probe failed");
  assert.equal(version.stdout.trim(), PINNED_ENGINE_VERSION, "Native engine version differs from pinned version");
  return version.stdout.trim();
}

export async function verifyNativeEngineFiles(prepared, executedPath) {
  assert.ok(typeof executedPath === "string" && path.isAbsolute(executedPath), "Executed engine must use the selected bundle candidate, never PATH");
  assert.equal(path.resolve(executedPath), prepared.path, "Executed engine must use the selected bundle candidate");
  const canonicalBundle = await realpath(path.dirname(executedPath));
  assert.equal(canonicalBundle, prepared.bundleDir, "Executed engine bundle changed");
  const actualRealPath = await realpath(executedPath);
  assert.equal(actualRealPath, prepared.realPath, "Executed engine target identity changed");
  assert.ok((await stat(executedPath)).isFile(), "Executed engine is not a regular file");
  const hash = sha256(await readFile(executedPath));
  assert.equal(hash, prepared.expectedHash, "Executed engine hash differs from prepared byte identity");
  const currentManifests = await manifests(prepared.bundleDir, prepared.candidateNames);
  assert.deepEqual(currentManifests, prepared.manifests, "Prepared engine manifest changed or is stale");
  for (const manifest of currentManifests) assert.equal(hash, manifest.engineHash, "Executed engine hash differs from current manifest");
  return { path: path.resolve(executedPath), realPath: actualRealPath, hash, expectedHash: prepared.expectedHash, identitySource: prepared.identitySource, manifests: prepared.manifests };
}

export async function verifyNativeEngineRuntime(prepared, executedPath, health) {
  assert.equal(health?.version, PINNED_ENGINE_VERSION, "Running engine health version differs from pinned version");
  await verifyNativeEngineFiles(prepared, executedPath);
  const version = probeNativeEngineVersion(executedPath);
  const receipt = await verifyNativeEngineFiles(prepared, executedPath);
  return { ...receipt, version, healthVersion: health.version };
}
