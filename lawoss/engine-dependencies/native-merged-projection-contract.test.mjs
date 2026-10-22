import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { canonicalRecordBytes, inventoryDigest, validateIdentity, validateProjectionRequest, validateProjectionFailure, validateAcquisition, publicCode } from "./native-merged-projection-contract.mjs";
import { validateAcquisition as original } from "./native-merged-validation.mjs";
import { ACCEPTED } from "../build/plugin-payload/prime-cache.mjs";
import { RUNTIME_LOCK, VERSIONS } from "./native-merged-cache-worker.mjs";
export const acquisition = () => ({ schema: 1, phase: "acquisition", status: "complete", ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK, node: "v22.23.2", platform: process.platform, versions: { ...VERSIONS }, tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: 32, metadataBytes: 64 });
const hash = (b) => createHash("sha256").update(b).digest("hex");
test("canonical domains sort keys, preserve array order, and include exactly one LF", () => {
  assert.equal(canonicalRecordBytes({ z: [2, 1], a: { b: 1 } }).toString(), `{"a":{"b":1},"z":[2,1]}
`);
  assert.equal(inventoryDigest([{ path: "a", bytes: 1, sha256: "a".repeat(64) }]), hash(Buffer.from('[{"bytes":1,"path":"a","sha256":"' + "a".repeat(64) + `"}]
`)));
  for (const v of [NaN, 1 / 0, 2 ** 53, undefined, new Date])
    assert.throws(() => canonicalRecordBytes(v));
});
test("identities retain unsigned decimal BigInts beyond the safe Number boundary", () => {
  assert.deepEqual(validateIdentity({ dev: "9007199254740993", ino: "18446744073709551615" }), { dev: "9007199254740993", ino: "18446744073709551615" });
  for (const dev of ["-1", "01", "1.0", 1, ""])
    assert.throws(() => validateIdentity({ dev, ino: "1" }));
});
test("original acquisition tuple acceptance agrees with unchanged parent schema", () => {
  const cases = [acquisition(), { ...acquisition(), extra: 1 }, { ...acquisition(), metadata: 63 }, { ...acquisition(), archiveBytes: 0 }, { ...acquisition(), metadataBytes: 128 * 1024 * 1024 + 1 }, { ...acquisition(), platform: "alien" }, { ...acquisition(), versions: { ...VERSIONS, npa: "1" } }];
  for (const row of cases) {
    let old = true, fresh = true;
    try {
      original(row);
    } catch {
      old = false;
    }
    try {
      validateAcquisition(row);
    } catch {
      fresh = false;
    }
    assert.equal(fresh, old);
  }
});
test("request binds unchanged acquisition canonical digest and exact closed keys", () => {
  const raw = acquisition();
  const row = { schema: 1, policy: "accepted-version-fixture-v1", nonce: "12345678-1234-4234-8234-123456789abc", deadline: Date.now() + 1000, rawAcquisition: raw, rawAcquisitionSha256: hash(canonicalRecordBytes(raw)), sourceInventorySha256: "a".repeat(64) };
  assert.equal(validateProjectionRequest(row), row);
  for (const bad of [{ ...row, extra: true }, { ...row, rawAcquisitionSha256: hash(Buffer.from(JSON.stringify(raw))) }, { ...row, nonce: row.nonce.toUpperCase() }])
    assert.throws(() => validateProjectionRequest(bad));
});
test("failure projection cannot leak exception getters or arbitrary public payload", () => {
  const row = { schema: 1, phase: "projection", status: "failed", policy: "accepted-version-fixture-v1", nonce: null, stage: "admission", code: "CANCELLED", archives: 0, rawReads: 0, representations: 0, byteChecks: 0, pacoteChecks: 0, drain: "settled" };
  assert.equal(validateProjectionFailure(row), row);
  for (const bad of [{ ...row, childClosed: true }, { ...row, code: "https://secret" }, { ...row, drain: "closed" }, { ...row, archives: 33 }])
    assert.throws(() => validateProjectionFailure(bad));
  assert.equal(publicCode(Object.defineProperty({}, "code", { get() {
    throw Error("leak");
  } })), "PROJECTION_FAILED");
});
import { readFile } from "node:fs/promises";
import { validateProjectionManifest, validateProjectionReceipt, INPUTS, COUNTS, SOURCE_PATHS, validateInventory } from "./native-merged-projection-contract.mjs";
const lock = JSON.parse(await readFile(new URL("../build/plugin-payload/sdk/package-lock.json", import.meta.url)));
const records = Object.entries(lock.packages).filter(([key]) => key).map(([key, pkg]) => ({ name: key.replace(/^node_modules\//, ""), ...pkg })).sort((a, b) => a.name < b.name ? -1 : 1);
// Synthetic CLOSED RECORD only: no cache or all32 worker execution.
function manifest() {
  const sources = SOURCE_PATHS.map((path) => ({ path, bytes: 1, sha256: "a".repeat(64) }));
  return { schema: 1, kind: "derived-accepted-version-fixture", policy: "accepted-version-fixture-v1", nonce: "12345678-1234-4234-8234-123456789abc", requestSha256: "a".repeat(64), rawAcquisitionSha256: "b".repeat(64), sourceInventory: sources, sourcesSha256: hash(canonicalRecordBytes(sources)), inputs: { ...INPUTS }, runtime: { node: "v22.23.2", platform: process.platform, versions: { ...VERSIONS }, semver: "7.8.5" }, workspaceIdentity: { dev: "1", ino: "9007199254740993" }, rawCacheIdentity: { dev: "1", ino: "9007199254740994" }, fixtureIdentity: { dev: "1", ino: "9007199254740995" }, rawInventory: [], derivedInventory: [], archives: records.map((r) => ({ name: r.name, version: r.version, integrity: r.integrity, bytes: 1, sha256: "a".repeat(64) })), metadata: records.flatMap((r) => ["corgi", "full"].map((representation) => ({ name: r.name, version: r.version, representation, rawBytes: 1, rawSha256: "a".repeat(64), projectedBytes: 1, projectedSha256: "a".repeat(64), projectedIntegrity: r.integrity, retainedValueSha256: "a".repeat(64) }))), counts: { ...COUNTS, archiveBytes: 32, rawMetadataBytes: 64, projectedMetadataBytes: 64 } };
}
test("closed manifest rejects duplicate/missing rows, wrong totals/pins, unknown sources and self-inclusion", () => {
  const row = manifest();
  assert.equal(validateProjectionManifest(row, records), row);
  const mutations = [(v) => v.archives.push(v.archives[0]), (v) => v.archives.pop(), (v) => v.metadata[1] = { ...v.metadata[0] }, (v) => v.metadata.pop(), (v) => v.counts.archiveBytes++, (v) => v.inputs.sdkLockSha256 = "0".repeat(64), (v) => {
    v.sourceInventory[0].path = "aaa-unknown";
    v.sourcesSha256 = hash(canonicalRecordBytes(v.sourceInventory));
  }, (v) => {
    v.sourceInventory.pop();
    v.sourcesSha256 = hash(canonicalRecordBytes(v.sourceInventory));
  }, (v) => v.rawInventory.push({ path: "manifest.json", bytes: 1, sha256: "a".repeat(64) }), (v) => v.childClosed = true, (v) => v.runtime.semver = "7.8.4", (v) => v.workspaceIdentity.ino = "-1"];
  for (const mutate of mutations) {
    const bad = structuredClone(row);
    mutate(bad);
    assert.throws(() => validateProjectionManifest(bad, records));
  }
});
test("success record rejects unknown close claims, bad byte caps and arbitrary public fields", () => {
  const row = { schema: 1, phase: "projection", status: "complete", kind: "derived-accepted-version-fixture", policy: "accepted-version-fixture-v1", nonce: "12345678-1234-4234-8234-123456789abc", requestSha256: "a".repeat(64), rawAcquisitionSha256: "a".repeat(64), sourceInventorySha256: "a".repeat(64), manifestSha256: "a".repeat(64), rawCacheSha256: "a".repeat(64), derivedCacheSha256: "a".repeat(64), node: "v22.23.2", platform: process.platform, ...COUNTS, archiveBytes: 32, rawMetadataBytes: 64, projectedMetadataBytes: 64 };
  assert.equal(validateProjectionReceipt(row), row);
  for (const v of [{ ...row, childClosed: true }, { ...row, url: "private" }, { ...row, archives: 31 }, { ...row, archiveBytes: 256 * 1024 * 1024 + 1 }, { ...row, nonce: null }])
    assert.throws(() => validateProjectionReceipt(v));
});
test("fixed inventories enforce path ordering, storage crosscaps and source single-file bounds", () => {
  for (const rows of [[{ path: "../a", bytes: 1, sha256: "a".repeat(64) }], [{ path: "tmp/file", bytes: 1, sha256: "a".repeat(64) }], [{ path: "index-v5/aa/bb/" + "c".repeat(60), bytes: 262145, sha256: "a".repeat(64) }], Array.from({ length: 7 }, (_, i) => ({ path: "content-v2/sha512/aa/bb/" + String(i).padStart(124, "0"), bytes: 64 * 1024 * 1024, sha256: "a".repeat(64) }))])
    assert.throws(() => validateInventory(rows));
  assert.throws(() => validateInventory([{ path: "source", bytes: 2 * 1024 * 1024 + 1, sha256: "a".repeat(64) }], { source: true }));
});
test("canonical retained values preserve finite fractional JSON fields and publicCode refuses hostile descriptors", () => {
  assert.equal(canonicalRecordBytes({ score: 1.25 }).toString(), `{"score":1.25}
`);
  assert.equal(publicCode(new Proxy({}, { getOwnPropertyDescriptor() {
    throw Error("private");
  } })), "PROJECTION_FAILED");
});
import { validateProjectionLinks } from "./native-merged-projection-contract.mjs";
test("crosslinks reject forged nonce/root, raw totals and canonical request/manifest domain drift", () => {
  const m = manifest(), raw = acquisition(), request = { schema: 1, policy: m.policy, nonce: m.nonce, deadline: Date.now() + 5000, rawAcquisition: raw, rawAcquisitionSha256: hash(canonicalRecordBytes(raw)), sourceInventorySha256: m.sourcesSha256 };
  m.requestSha256 = hash(canonicalRecordBytes(request));
  m.rawAcquisitionSha256 = request.rawAcquisitionSha256;
  const owner = { schema: 1, nonce: m.nonce, workspace: { ...m.workspaceIdentity }, root: { ...m.fixtureIdentity } };
  const receipt = { schema: 1, phase: "projection", status: "complete", kind: m.kind, policy: m.policy, nonce: m.nonce, requestSha256: m.requestSha256, rawAcquisitionSha256: m.rawAcquisitionSha256, sourceInventorySha256: m.sourcesSha256, manifestSha256: hash(canonicalRecordBytes(m)), rawCacheSha256: hash(canonicalRecordBytes(m.rawInventory)), derivedCacheSha256: hash(canonicalRecordBytes(m.derivedInventory)), node: "v22.23.2", platform: process.platform, ...m.counts };
  const bundle = { receipt, manifest: m, request, owner, manifestSha256: receipt.manifestSha256 };
  validateProjectionLinks(bundle);
  for (const mutate of [(b) => b.owner.nonce = "00000000-0000-4000-8000-000000000000", (b) => b.owner.root.ino = "9007199254740996", (b) => b.receipt.archiveBytes++, (b) => b.receipt.requestSha256 = hash(Buffer.from(JSON.stringify(request))), (b) => b.manifestSha256 = hash(Buffer.from(JSON.stringify(m))), (b) => b.receipt.rawCacheSha256 = "0".repeat(64), (b) => b.manifest.sourcesSha256 = "0".repeat(64)]) {
    const bad = structuredClone(bundle);
    mutate(bad);
    assert.throws(() => validateProjectionLinks(bad));
  }
});
