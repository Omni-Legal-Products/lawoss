import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink, readlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { nativeEngineCandidates, prepareNativeEngineFiles, verifyNativeEngineFiles, verifyNativeEngineRuntime, probeNativeEngineVersion } from "./engine-identity.mjs";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
async function fixture(run) {
  const root = await mkdtemp(path.join(tmpdir(), "native-engine-identity-"));
  const bundle = path.join(root, "bundle"); await mkdir(bundle);
  try { await run(root, bundle); } finally { await rm(root, { recursive: true, force: true }); }
}
async function manifest(bundle, bytes, version = "1.18.29", name = "versions.json") {
  await writeFile(path.join(bundle, name), JSON.stringify({ opencode: { version, sha256: hash(bytes) } }));
}

test("prepared platform target wins over an older different generic alias and records actual bytes", () => fixture(async (_root, bundle) => {
  const bytes = "synthetic prepared target", candidate = nativeEngineCandidates("darwin", "arm64")[0];
  await writeFile(path.join(bundle, candidate), bytes); await writeFile(path.join(bundle, "opencode"), "older same-version alias bytes"); await manifest(bundle, bytes);
  const prepared = await prepareNativeEngineFiles({ bundleDir: bundle, platform: "darwin", arch: "arm64" });
  const receipt = await verifyNativeEngineFiles(prepared, path.join(bundle, candidate));
  assert.equal(receipt.path, path.join(bundle, candidate)); assert.equal(receipt.hash, hash(bytes)); assert.equal(receipt.expectedHash, hash(bytes)); assert.equal(receipt.identitySource, "manifest");
  await assert.rejects(verifyNativeEngineFiles(prepared, path.join(bundle, "opencode")), /selected bundle candidate/);
  await prepared.cleanup(); assert.equal(await readFile(path.join(bundle, "opencode"), "utf8"), "older same-version alias bytes");
}));

for (const [platform, arch, target, canonical] of [
  ["darwin", "arm64", "opencode-aarch64-apple-darwin", "opencode"],
  ["darwin", "x64", "opencode-x86_64-apple-darwin", "opencode"],
  ["linux", "x64", "opencode-x86_64-unknown-linux-gnu", "opencode"],
  ["linux", "arm64", "opencode-aarch64-unknown-linux-gnu", "opencode"],
  ["win32", "x64", "opencode-x86_64-pc-windows-msvc.exe", "opencode.exe"],
  ["win32", "arm64", "opencode-aarch64-pc-windows-msvc.exe", "opencode.exe"],
]) test(`real prepared target/canonical-only file policy ${platform}/${arch} without foreign execution`, () => fixture(async (_root, bundle) => {
  assert.deepEqual(nativeEngineCandidates(platform, arch), [target, canonical]);
  const bytes = `synthetic ${platform}/${arch} file bytes`; await manifest(bundle, bytes);
  for (const name of [canonical, target]) {
    await writeFile(path.join(bundle, name), bytes);
    const prepared = await prepareNativeEngineFiles({ bundleDir: bundle, platform, arch });
    assert.equal((await verifyNativeEngineFiles(prepared, path.join(bundle, name))).hash, hash(bytes));
    await prepared.cleanup();
  }
}));

test("outside/arbitrary PATH and unsupported candidate cannot confer identity even with matching bytes", () => fixture(async (root, bundle) => {
  const bytes = "synthetic correct bytes", candidate = nativeEngineCandidates()[0];
  await writeFile(path.join(bundle, candidate), bytes); await manifest(bundle, bytes);
  const prepared = await prepareNativeEngineFiles({ bundleDir: bundle });
  const outside = path.join(root, "opencode"); await writeFile(outside, bytes);
  await assert.rejects(verifyNativeEngineFiles(prepared, outside), /selected bundle candidate/);
  const unsupported = path.join(bundle, "opencode-other-platform"); await writeFile(unsupported, bytes);
  await assert.rejects(verifyNativeEngineFiles(prepared, unsupported), /selected bundle candidate/);
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: "opencode" }), /absolute/);
  assert.throws(() => nativeEngineCandidates("freebsd", "x64"), /Unsupported/);
  assert.throws(() => nativeEngineCandidates("linux", "riscv64"), /Unsupported/);
}));

test("wrong prepared bytes, stale version and conflicting platform manifest fail closed", () => fixture(async (_root, bundle) => {
  const candidate = nativeEngineCandidates()[0], target = path.join(bundle, candidate);
  await writeFile(target, "wrong bytes"); await manifest(bundle, "correct bytes");
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle }), /hash/);
  await writeFile(target, "correct bytes"); await manifest(bundle, "correct bytes", "1.18.28");
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle }), /version/);
  await manifest(bundle, "correct bytes");
  const targetManifest = `versions.json-${candidate.slice("opencode-".length)}`;
  await manifest(bundle, "different target bytes", "1.18.29", targetManifest);
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle }), /manifest|hash/);
}));

test("relaunch rechecks bytes and manifest and health before conferring identity", () => fixture(async (_root, bundle) => {
  const target = path.join(bundle, nativeEngineCandidates()[0]), bytes = "initial correct bytes";
  await writeFile(target, bytes); await manifest(bundle, bytes);
  const prepared = await prepareNativeEngineFiles({ bundleDir: bundle });
  assert.equal((await verifyNativeEngineFiles(prepared, target)).hash, hash(bytes));
  await writeFile(target, "relaunch wrong same-version bytes");
  await assert.rejects(verifyNativeEngineFiles(prepared, target), /hash/);
  await writeFile(target, bytes); await manifest(bundle, "manifest changed during relaunch");
  await assert.rejects(verifyNativeEngineFiles(prepared, target), /manifest|hash/);
  await manifest(bundle, bytes);
  await assert.rejects(verifyNativeEngineRuntime(prepared, target, { version: "1.18.28" }), /health/);
  assert.throws(() => probeNativeEngineVersion(process.execPath), /version/); // Actual native executable, not a simulated process result.
}));

test("existing external symlink or unpinned existing candidates fail without mutation", () => fixture(async (root, bundle) => {
  const external = path.join(root, "external-engine"); await writeFile(external, "synthetic external bytes");
  const canonical = path.join(bundle, nativeEngineCandidates()[1]);
  await symlink(external, canonical);
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: external }), /outside|manifest/);
  assert.equal(await readlink(canonical), external);
  await rm(canonical); await writeFile(canonical, "existing unpinned bytes");
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: external }), /manifest/);
  assert.equal(await readFile(canonical, "utf8"), "existing unpinned bytes");
}));

test("explicit external fixture provisions only an absent owned bundle link and captured byte identity", () => fixture(async (root, bundle) => {
  const external = path.join(root, "external-engine"), bytes = "synthetic explicitly provisioned bytes"; await writeFile(external, bytes);
  const prepared = await prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: external });
  assert.equal(await readlink(prepared.path), external);
  const receipt = await verifyNativeEngineFiles(prepared, prepared.path);
  assert.equal(receipt.identitySource, "owned-provisioned-fixture"); assert.equal(receipt.realPath, await realpath(external)); assert.equal(receipt.hash, hash(bytes));
  await assert.rejects(verifyNativeEngineFiles(prepared, external), /selected bundle candidate/);
  await writeFile(external, "replaced source bytes"); await assert.rejects(verifyNativeEngineFiles(prepared, prepared.path), /hash/);
  await writeFile(external, bytes); await prepared.cleanup();
  await assert.rejects(readlink(prepared.path), { code: "ENOENT" }); assert.equal(await readFile(external, "utf8"), bytes);
}));

test("cleanup never deletes replacement links or regular files and missing prepared artifacts do not borrow external bytes", () => fixture(async (root, bundle) => {
  const external = path.join(root, "external-engine"), other = path.join(root, "other-engine");
  await writeFile(external, "fixture bytes"); await writeFile(other, "other bytes");
  const prepared = await prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: external });
  await rm(prepared.path); await symlink(other, prepared.path); await prepared.cleanup();
  assert.equal(await readlink(prepared.path), other);
  await rm(prepared.path); await writeFile(prepared.path, "replacement regular file"); await prepared.cleanup();
  assert.equal(await readFile(prepared.path, "utf8"), "replacement regular file");
  await rm(prepared.path); await manifest(bundle, "fixture bytes");
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle, externalEngine: external }), /missing/);
  await assert.rejects(prepareNativeEngineFiles({ bundleDir: bundle }), /missing/);
}));
