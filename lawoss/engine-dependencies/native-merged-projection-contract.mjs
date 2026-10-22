// Closed consistency records, not signatures or evidence of child process close.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { ACCEPTED } from "../build/plugin-payload/prime-cache.mjs";
import { RUNTIME_LOCK, VERSIONS } from "./native-merged-cache-worker.mjs";
import { FIXTURE_POLICY, PUBLIC_MANIFEST_SHA256 } from "./native-merged-cache-projection.mjs";

export { FIXTURE_POLICY };
const MiB = 1024 * 1024;
export const LIMITS = Object.freeze({ files: 2048, directories: 4096, depth: 8, pathBytes: 256, contentBytes: 384 * MiB, indexBytes: 16 * MiB, contentFile: 64 * MiB, indexFile: 256 * 1024, archive: 32 * MiB, archives: 256 * MiB, body: 64 * MiB, metadata: 128 * MiB, request: 4096, owner: 1024, failure: 4096, receipt: 4096, manifest: MiB, sourceFiles: 64, sourceFile: 2 * MiB, sourceBytes: 16 * MiB });
export const PATHS = Object.freeze({ request: "native-projection-input.json", raw: "cache/_cacache", scratch: "projection-raw-readback", fixture: "accepted-fixture", derived: "accepted-fixture/_cacache", owner: "accepted-fixture/.owner.json", manifest: "accepted-fixture/manifest.json", failure: "native-projection-operation.json" });
export const INPUTS = Object.freeze({ sdkInputSha256: ACCEPTED.inputSha256, sdkLockSha256: ACCEPTED.lockSha256, toolsLockSha256: ACCEPTED.toolsLockSha256, runtimeLockSha256: RUNTIME_LOCK, publicManifestSha256: PUBLIC_MANIFEST_SHA256 });
export const STATIC_SOURCES = Object.freeze([
  ...["native-merged-cache-projection.mjs", "native-merged-projection-contract.mjs", "native-merged-projection-files.mjs", "native-merged-projection-cache.mjs", "native-merged-cache-projection-worker.mjs", "native-merged-cache-worker.mjs"].map((n) => "lawoss/engine-dependencies/" + n),
  ...["prime-cache.mjs", "prime-transfer.mjs", "prepare.mjs", "validate.mjs", "notices.mjs", "network-guard.mjs", "sdk/package.json", "sdk/package-lock.json", "sdk/public-package-manifests.json", "tools/pnpm-lock.yaml"].map((n) => "lawoss/build/plugin-payload/" + n),
  "lawoss/engine-dependencies/runtime-tools/package.json",
  "lawoss/engine-dependencies/runtime-tools/pnpm-lock.yaml"
]);
export const TOOL_EXTRA_SOURCES = Object.freeze({ fetch: Object.freeze(["lib/cache/entry.js", "lib/cache/key.js", "lib/cache/policy.js", "lib/cache/index.js"]), cacache: Object.freeze(["lib/put.js", "lib/get.js", "lib/entry-index.js", "lib/content/read.js", "lib/content/write.js", "lib/content/path.js"]), pacote: Object.freeze(["lib/registry.js"]) });
export const SOURCE_PATHS = Object.freeze([...STATIC_SOURCES, ...["arborist", "config", "pacote", "registryFetch", "fetch", "cacache", "npa", "semver"].flatMap((key) => ["manifest", "entry"].map((kind) => "runtime/" + key + "/" + kind)), ...Object.entries(TOOL_EXTRA_SOURCES).flatMap(([key, names]) => names.map((name) => "runtime/" + key + "/" + name))].sort());
export const STAGES = Object.freeze(["admission", "copy", "archives", "metadata", "closure", "write", "offline", "pacote", "revalidation", "publication"]);
export const CODES = Object.freeze(["NODE_VERSION", "TOOLS_INVALID", "INPUT_DRIFT", "WORKSPACE_INVALID", "RECEIPT_INVALID", "PROJECTION_NETWORK_GUARD", "PROJECTION_DESTINATION_EXISTS", "PROJECTION_CACHE_LAYOUT", "PROJECTION_LIMIT", "PROJECTION_READBACK", "PROJECTION_FAILED", "CANCELLED", "PRIMER_DEADLINE"]);
export const COUNTS = Object.freeze({ names: 32, archives: 32, representations: 64, rawReads: 64, byteChecks: 64, pacoteChecks: 64 });
const countKeys = [...Object.keys(COUNTS), "archiveBytes", "rawMetadataBytes", "projectedMetadataBytes"];
export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
export const integrity = (bytes) => "sha512-" + createHash("sha512").update(bytes).digest("base64");
export function refuse(code = "RECEIPT_INVALID") {
  throw Object.assign(new Error(code), { code });
}
export function need(condition, code = "RECEIPT_INVALID") {
  if (!condition)
    refuse(code);
}
export function publicCode(error) {
  try {
    const code = error && Object.getOwnPropertyDescriptor(error, "code")?.value;
    return CODES.includes(code) ? code : "PROJECTION_FAILED";
  } catch {
    return "PROJECTION_FAILED";
  }
}
export const object = (v) => v !== null && typeof v === "object" && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));
export function exact(v, keys) {
  need(object(v) && isDeepStrictEqual(Object.keys(v).sort(), [...keys].sort()));
}
const uint = (v, max = Number.MAX_SAFE_INTEGER, min = 0) => Number.isSafeInteger(v) && v >= min && v <= max;
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const sri = (v) => typeof v === "string" && /^sha512-[A-Za-z0-9+/]{86}==$/.test(v) && Buffer.from(v.slice(7), "base64").toString("base64") === v.slice(7);
const nonce = (v) => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export function canonicalRecordBytes(value) {
  const ancestors = new Set;
  function sorted(v) {
    if (v === null || typeof v === "string" || typeof v === "boolean")
      return v;
    if (typeof v === "number") {
      need(Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER);
      return v;
    }
    need(object(v) || Array.isArray(v));
    need(!ancestors.has(v));
    ancestors.add(v);
    const out = Array.isArray(v) ? Array.from(v, sorted) : Object.fromEntries(Object.keys(v).sort().map((k) => {
      const d = Object.getOwnPropertyDescriptor(v, k);
      need(d && Object.hasOwn(d, "value"));
      return [k, sorted(d.value)];
    }));
    ancestors.delete(v);
    return out;
  }
  return Buffer.from(JSON.stringify(sorted(value)) + `
`);
}
export function validateIdentity(value) {
  exact(value, ["dev", "ino"]);
  for (const k of ["dev", "ino"])
    need(typeof value[k] === "string" && /^(0|[1-9][0-9]*)$/.test(value[k]));
  return value;
}
export function validateAcquisition(value) {
  const expected = { schema: 1, phase: "acquisition", status: "complete", ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK, node: "v22.23.2", platform: process.platform, versions: VERSIONS, tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: value?.archiveBytes, metadataBytes: value?.metadataBytes };
  need(isDeepStrictEqual(value, expected) && uint(value.archiveBytes, LIMITS.archives, 1) && uint(value.metadataBytes, LIMITS.metadata, 1));
  return value;
}
export function validateProjectionRequest(v) {
  exact(v, ["schema", "policy", "nonce", "deadline", "rawAcquisition", "rawAcquisitionSha256", "sourceInventorySha256"]);
  need(v.schema === 1 && v.policy === FIXTURE_POLICY && nonce(v.nonce) && uint(v.deadline) && digest(v.rawAcquisitionSha256) && digest(v.sourceInventorySha256));
  validateAcquisition(v.rawAcquisition);
  need(sha256(canonicalRecordBytes(v.rawAcquisition)) === v.rawAcquisitionSha256);
  return v;
}
export function validateInventory(rows, { source = false } = {}) {
  need(Array.isArray(rows) && rows.length <= (source ? LIMITS.sourceFiles : LIMITS.files));
  let previous = "", content = 0, index = 0, total = 0;
  for (const row of rows) {
    exact(row, ["path", "bytes", "sha256"]);
    need(typeof row.path === "string" && /^[\x21-\x7e]+$/.test(row.path) && !row.path.includes("\\") && !row.path.startsWith("/") && row.path.split("/").every((p) => p !== "." && p !== ".." && p !== ""));
    need(row.path > previous && Buffer.byteLength(row.path) <= LIMITS.pathBytes);
    previous = row.path;
    need(digest(row.sha256) && uint(row.bytes, source ? LIMITS.sourceFile : LIMITS.contentFile));
    total += row.bytes;
    if (!source) {
      if (/^content-v2\/sha512\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{124}$/.test(row.path)) {
        content += row.bytes;
      } else {
        need(/^index-v5\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{60}$/.test(row.path) && row.bytes <= LIMITS.indexFile);
        index += row.bytes;
      }
    }
  }
  need(source ? total <= LIMITS.sourceBytes : content <= LIMITS.contentBytes && index <= LIMITS.indexBytes);
  return rows;
}
export const inventoryDigest = (rows) => sha256(canonicalRecordBytes(rows));
function counts(v) {
  exact(v, countKeys);
  for (const [key, value] of Object.entries(COUNTS))
    need(v[key] === value);
  need(uint(v.archiveBytes, LIMITS.archives, 1) && uint(v.rawMetadataBytes, LIMITS.metadata, 1) && uint(v.projectedMetadataBytes, LIMITS.metadata, 1));
}
export function validateProjectionReceipt(v) {
  exact(v, ["schema", "phase", "status", "kind", "policy", "nonce", "requestSha256", "rawAcquisitionSha256", "sourceInventorySha256", "manifestSha256", "rawCacheSha256", "derivedCacheSha256", "node", "platform", ...countKeys]);
  need(v.schema === 1 && v.phase === "projection" && v.status === "complete" && v.kind === "derived-accepted-version-fixture" && v.policy === FIXTURE_POLICY && nonce(v.nonce) && v.node === "v22.23.2" && v.platform === process.platform);
  for (const k of ["requestSha256", "rawAcquisitionSha256", "sourceInventorySha256", "manifestSha256", "rawCacheSha256", "derivedCacheSha256"])
    need(digest(v[k]));
  counts(Object.fromEntries(countKeys.map((k) => [k, v[k]])));
  return v;
}
export function validateOwner(v) {
  exact(v, ["schema", "nonce", "workspace", "root"]);
  need(v.schema === 1 && nonce(v.nonce));
  validateIdentity(v.workspace);
  validateIdentity(v.root);
  return v;
}
export function validateProjectionFailure(v) {
  exact(v, ["schema", "phase", "status", "policy", "nonce", "stage", "code", "archives", "rawReads", "representations", "byteChecks", "pacoteChecks", "drain"]);
  need(v.schema === 1 && v.phase === "projection" && v.status === "failed" && v.policy === FIXTURE_POLICY && (v.nonce === null || nonce(v.nonce)) && STAGES.includes(v.stage) && CODES.includes(v.code) && ["settled", "failed", "unknown"].includes(v.drain));
  for (const k of ["archives", "rawReads", "representations", "byteChecks", "pacoteChecks"])
    need(uint(v[k], k === "archives" ? 32 : 64));
  return v;
}
// records must come from independently authenticated namedArtifacts(), never stdout.
export function validateProjectionManifest(v, records) {
  exact(v, ["schema", "kind", "policy", "nonce", "requestSha256", "rawAcquisitionSha256", "sourceInventory", "sourcesSha256", "inputs", "runtime", "workspaceIdentity", "rawCacheIdentity", "fixtureIdentity", "rawInventory", "derivedInventory", "archives", "metadata", "counts"]);
  need(v.schema === 1 && v.kind === "derived-accepted-version-fixture" && v.policy === FIXTURE_POLICY && nonce(v.nonce));
  for (const key of ["requestSha256", "rawAcquisitionSha256", "sourcesSha256"])
    need(digest(v[key]));
  need(isDeepStrictEqual(v.inputs, INPUTS));
  need(isDeepStrictEqual(v.runtime, { node: "v22.23.2", platform: process.platform, versions: VERSIONS, semver: "7.8.5" }));
  for (const key of ["workspaceIdentity", "rawCacheIdentity", "fixtureIdentity"])
    validateIdentity(v[key]);
  validateInventory(v.sourceInventory, { source: true });
  need(isDeepStrictEqual(v.sourceInventory.map((row) => row.path), SOURCE_PATHS));
  need(inventoryDigest(v.sourceInventory) === v.sourcesSha256);
  validateInventory(v.rawInventory);
  validateInventory(v.derivedInventory);
  counts(v.counts);
  need(Array.isArray(records) && records.length === 32 && new Set(records.map((r) => r.name)).size === 32);
  const byName = new Map(records.map((r) => [r.name, r]));
  need(Array.isArray(v.archives) && v.archives.length === 32 && Array.isArray(v.metadata) && v.metadata.length === 64);
  let previous = "", sum = 0;
  for (const row of v.archives) {
    exact(row, ["name", "version", "integrity", "bytes", "sha256"]);
    const r = byName.get(row.name);
    need(r && row.version === r.version && row.integrity === r.integrity && sri(row.integrity) && digest(row.sha256) && uint(row.bytes, LIMITS.archive, 1) && row.name > previous);
    previous = row.name;
    sum += row.bytes;
  }
  need(sum === v.counts.archiveBytes);
  previous = "";
  let raw = 0, projected = 0;
  for (const row of v.metadata) {
    exact(row, ["name", "version", "representation", "rawBytes", "rawSha256", "projectedBytes", "projectedSha256", "projectedIntegrity", "retainedValueSha256"]);
    const r = byName.get(row.name), key = row.name + "\x00" + row.representation;
    need(r && row.version === r.version && ["full", "corgi"].includes(row.representation) && key > previous);
    previous = key;
    need(uint(row.rawBytes, LIMITS.body, 1) && uint(row.projectedBytes, LIMITS.body, 1) && sri(row.projectedIntegrity));
    for (const k of ["rawSha256", "projectedSha256", "retainedValueSha256"])
      need(digest(row[k]));
    raw += row.rawBytes;
    projected += row.projectedBytes;
  }
  need(raw === v.counts.rawMetadataBytes && projected === v.counts.projectedMetadataBytes);
  for (const r of records)
    need(v.metadata.filter((row) => row.name === r.name).length === 2);
  return v;
}
// Cross-record equality is separate from each closed schema and physical I/O.
export function validateProjectionLinks(bundle) {
  exact(bundle, ["receipt", "manifest", "request", "owner", "manifestSha256"]);
  const { receipt, manifest, request, owner, manifestSha256 } = bundle;
  validateProjectionReceipt(receipt);
  validateProjectionRequest(request);
  validateOwner(owner);
  need(receipt.nonce === request.nonce && manifest.nonce === request.nonce && owner.nonce === request.nonce);
  need(isDeepStrictEqual(owner.workspace, manifest.workspaceIdentity) && isDeepStrictEqual(owner.root, manifest.fixtureIdentity));
  for (const [key, want] of [["requestSha256", sha256(canonicalRecordBytes(request))], ["rawAcquisitionSha256", request.rawAcquisitionSha256], ["sourceInventorySha256", request.sourceInventorySha256], ["manifestSha256", manifestSha256], ["rawCacheSha256", inventoryDigest(manifest.rawInventory)], ["derivedCacheSha256", inventoryDigest(manifest.derivedInventory)]])
    need(receipt[key] === want);
  need(manifest.requestSha256 === receipt.requestSha256 && manifest.rawAcquisitionSha256 === receipt.rawAcquisitionSha256 && manifest.sourcesSha256 === receipt.sourceInventorySha256);
  for (const [key, value] of Object.entries(manifest.counts))
    need(receipt[key] === value);
  need(receipt.archiveBytes === request.rawAcquisition.archiveBytes && receipt.rawMetadataBytes === request.rawAcquisition.metadataBytes);
}
