// Disposable offline coordinator. Stdout is content evidence, never child close.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lstat } from "node:fs/promises";
import { createRequire } from "node:module";
import { isDeepStrictEqual } from "node:util";
import { verifyWorkspace } from "../build/plugin-payload/prepare.mjs";
import { acceptedArtifacts } from "../build/plugin-payload/prime-cache.mjs";
import { runtimeApis, namedArtifacts, VERSIONS } from "./native-merged-cache-worker.mjs";
import { projectAcceptedMetadata, validateAcceptedClosure, FIXTURE_ACCEPT } from "./native-merged-cache-projection.mjs";
import { LIMITS, PATHS, INPUTS, FIXTURE_POLICY, COUNTS, canonicalRecordBytes, inventoryDigest, sha256, integrity, validateProjectionRequest, validateProjectionManifest, validateProjectionReceipt, validateProjectionFailure, validateOwner, need, refuse, publicCode } from "./native-merged-projection-contract.mjs";
import { identity, sameIdentity, realDirectory, readBoundedRecord, writeExclusiveRecord, snapshotCache, assertSnapshot, copyCacheSnapshot, exclusiveDirectory, sourceInventory, resolveRuntimeTools, pinnedInputs } from "./native-merged-projection-files.mjs";
import { operationScope, copyAcceptedArchive, readRawRepresentation, writeProjectedRepresentation, verifyProjectedRepresentation, verifyPacoteRepresentation } from "./native-merged-projection-cache.mjs";
function failure() {
  return { schema: 1, phase: "projection", status: "failed", policy: FIXTURE_POLICY, nonce: null, stage: "admission", code: "PROJECTION_FAILED", archives: 0, rawReads: 0, representations: 0, byteChecks: 0, pacoteChecks: 0, drain: "settled" };
}
async function projectRepresentations({ apis, records, scratch, lock, publicManifests, semver, scope, progress, expectedRawMetadataBytes }) {
  // Raw buffers live for one serial fetch/project only. Two projected maps and
  // at most128MiB projected encoded bodies remain; no raw-body collection stays.
  const maps = [new Map, new Map], pending = [], metadata = [];
  let rawMetadataBytes = 0, projectedMetadataBytes = 0;
  progress.stage = "metadata";
  for (const record of records)
    for (let i = 0;i < 2; i++) {
      scope.check();
      let rawRead = await readRawRepresentation({ fetch: apis.fetch, cache: scratch, record, accept: FIXTURE_ACCEPT[i], scope });
      rawMetadataBytes += rawRead.bytes.length;
      need(rawMetadataBytes <= LIMITS.metadata, "PROJECTION_LIMIT");
      progress.rawReads++;
      let parsed;
      try {
        parsed = JSON.parse(rawRead.bytes);
      } catch {
        refuse("INPUT_DRIFT");
      }
      scope.check();
      const projected = projectAcceptedMetadata(parsed, record);
      parsed = null;
      const bytes = Buffer.from(JSON.stringify(projected));
      need(bytes.length > 0 && bytes.length <= LIMITS.body, "PROJECTION_LIMIT");
      projectedMetadataBytes += bytes.length;
      need(projectedMetadataBytes <= LIMITS.metadata, "PROJECTION_LIMIT");
      if (Object.hasOwn(projected, "_contentLength"))
        need(projected._contentLength === bytes.length, "INPUT_DRIFT");
      maps[i].set(record.name, projected);
      const row = { name: record.name, version: record.version, representation: i === 0 ? "full" : "corgi", rawBytes: rawRead.bytes.length, rawSha256: rawRead.rawSha256, projectedBytes: bytes.length, projectedSha256: sha256(bytes), projectedIntegrity: integrity(bytes), retainedValueSha256: sha256(canonicalRecordBytes(projected.versions[record.version])) };
      metadata.push(row);
      pending.push({ record, i, bytes, rawBodySha256: rawRead.rawSha256 });
      rawRead = null;
      progress.representations++;
    }
  need(rawMetadataBytes === expectedRawMetadataBytes, "INPUT_DRIFT");
  progress.stage = "closure";
  scope.check();
  for (const map of maps) {
    validateAcceptedClosure(map, lock, publicManifests, { npa: apis.npa, semver });
    scope.check();
  }
  return { pending, metadata, rawMetadataBytes, projectedMetadataBytes };
}
async function verifyRepresentations({ apis, derived, pending, scope, progress }) {
  progress.stage = "write";
  for (const item of pending) {
    scope.check();
    await writeProjectedRepresentation({ cacache: apis.cacache, cache: derived, record: item.record, accept: FIXTURE_ACCEPT[item.i], bytes: item.bytes, rawBodySha256: item.rawBodySha256, scope });
  }
  progress.stage = "offline";
  for (const item of pending) {
    await verifyProjectedRepresentation({ fetch: apis.fetch, cache: derived, record: item.record, accept: FIXTURE_ACCEPT[item.i], expected: item.bytes, scope });
    progress.byteChecks++;
  }
  progress.stage = "pacote";
  for (const item of pending) {
    await verifyPacoteRepresentation({ pacote: apis.pacote, cache: derived, record: item.record, fullMetadata: item.i === 0, expected: item.bytes, scope });
    progress.pacoteChecks++;
  }
  pending.length = 0;
}
export async function projectNativeCache(workspace, deadline, signal) {
  const progress = failure();
  let scope, workspaceAdmitted = false;
  try {
    if (process.version !== "v22.23.2")
      refuse("NODE_VERSION");
    const guard = Object.getOwnPropertyDescriptor(globalThis, Symbol.for("lawoss.payload.networkDisabled"));
    need(guard?.value === true && guard.configurable === false, "PROJECTION_NETWORK_GUARD");
    need(Number.isSafeInteger(deadline) && deadline > Date.now() && deadline - Date.now() <= 300000, "PRIMER_DEADLINE");
    scope = operationScope(deadline, signal);
    scope.check();
    await scope.run(() => verifyWorkspace(workspace));
    workspaceAdmitted = true;
    const workspaceStat = await scope.run(() => realDirectory(workspace, { scope }));
    const request = validateProjectionRequest(await readBoundedRecord(path.join(workspace, PATHS.request), LIMITS.request, { scope }));
    need(request.deadline === deadline, "PRIMER_DEADLINE");
    progress.nonce = request.nonce;
    const requestSha256 = sha256(canonicalRecordBytes(request));
    const sources = await sourceInventory({ scope });
    need(inventoryDigest(sources) === request.sourceInventorySha256, "INPUT_DRIFT");
    await scope.run(() => acceptedArtifacts());
    const apis = await scope.run(() => runtimeApis()), records = await scope.run(() => namedArtifacts(apis.npa)), resolved = await scope.run(() => resolveRuntimeTools({ scope }));
    const semver = createRequire(resolved.npa.entry)("semver");
    const { lock, publicManifests } = await pinnedInputs({ scope });
    const raw = path.join(workspace, PATHS.raw), scratch = path.join(workspace, PATHS.scratch), fixture = path.join(workspace, PATHS.fixture), derived = path.join(workspace, PATHS.derived);
    const rawSnapshot = await snapshotCache(raw, { scope });
    progress.stage = "copy";
    await copyCacheSnapshot(raw, scratch, rawSnapshot, { scope });
    const scratchStat = await realDirectory(scratch, { scope }), fixtureStat = await exclusiveDirectory(fixture, { scope });
    await exclusiveDirectory(derived, { scope });
    const derivedStat = await realDirectory(derived, { scope });
    const owner = { schema: 1, nonce: request.nonce, workspace: identity(workspaceStat), root: identity(fixtureStat) };
    validateOwner(owner);
    await writeExclusiveRecord(path.join(workspace, PATHS.owner), owner, LIMITS.owner, { scope });
    const archives = [];
    let archiveBytes = 0;
    progress.stage = "archives";
    for (const record of records) {
      scope.check();
      const row = await copyAcceptedArchive({ cacache: apis.cacache, source: scratch, destination: derived, record, scope });
      archives.push(row);
      archiveBytes += row.bytes;
      need(archiveBytes <= LIMITS.archives, "PROJECTION_LIMIT");
      progress.archives++;
    }
    need(archiveBytes === request.rawAcquisition.archiveBytes, "INPUT_DRIFT");
    const { pending, metadata, rawMetadataBytes, projectedMetadataBytes } = await projectRepresentations({ apis, records, scratch, lock, publicManifests, semver, scope, progress, expectedRawMetadataBytes: request.rawAcquisition.metadataBytes });
    await verifyRepresentations({ apis, derived, pending, scope, progress });
    progress.stage = "revalidation";
    scope.check();
    await scope.run(() => acceptedArtifacts());
    await scope.run(() => runtimeApis());
    await pinnedInputs({ scope });
    const finalSources = await sourceInventory({ scope });
    need(isDeepStrictEqual(finalSources, sources), "INPUT_DRIFT");
    await scope.run(() => verifyWorkspace(workspace));
    for (const [file, previous] of [[workspace, workspaceStat], [fixture, fixtureStat], [scratch, scratchStat], [derived, derivedStat]])
      need(sameIdentity(previous, await scope.run(() => lstat(file, { bigint: true }))), "WORKSPACE_INVALID");
    need(isDeepStrictEqual(await readBoundedRecord(path.join(workspace, PATHS.owner), LIMITS.owner, { scope }), owner), "WORKSPACE_INVALID");
    need(isDeepStrictEqual(await readBoundedRecord(path.join(workspace, PATHS.request), LIMITS.request, { scope }), request), "INPUT_DRIFT");
    await assertSnapshot(raw, rawSnapshot, { scope });
    const finalDerived = await snapshotCache(derived, { scope });
    await snapshotCache(scratch, { scope });
    const counts = { ...COUNTS, archiveBytes, rawMetadataBytes, projectedMetadataBytes };
    archives.sort((a, b) => a.name < b.name ? -1 : 1);
    metadata.sort((a, b) => {
      const x = a.name + "\x00" + a.representation, y = b.name + "\x00" + b.representation;
      return x < y ? -1 : 1;
    });
    const manifest = { schema: 1, kind: "derived-accepted-version-fixture", policy: FIXTURE_POLICY, nonce: request.nonce, requestSha256, rawAcquisitionSha256: request.rawAcquisitionSha256, sourceInventory: sources, sourcesSha256: request.sourceInventorySha256, inputs: INPUTS, runtime: { node: process.version, platform: process.platform, versions: VERSIONS, semver: "7.8.5" }, workspaceIdentity: identity(workspaceStat), rawCacheIdentity: identity(rawSnapshot.root), fixtureIdentity: identity(fixtureStat), rawInventory: rawSnapshot.inventory, derivedInventory: finalDerived.inventory, archives, metadata, counts };
    validateProjectionManifest(manifest, records);
    progress.stage = "publication";
    const published = await writeExclusiveRecord(path.join(workspace, PATHS.manifest), manifest, LIMITS.manifest, { scope });
    scope.check();
    const receipt = { schema: 1, phase: "projection", status: "complete", kind: "derived-accepted-version-fixture", policy: FIXTURE_POLICY, nonce: request.nonce, requestSha256, rawAcquisitionSha256: request.rawAcquisitionSha256, sourceInventorySha256: request.sourceInventorySha256, manifestSha256: published.sha256, rawCacheSha256: inventoryDigest(rawSnapshot.inventory), derivedCacheSha256: inventoryDigest(finalDerived.inventory), node: process.version, platform: process.platform, ...counts };
    validateProjectionReceipt(receipt);
    need(canonicalRecordBytes(receipt).length <= LIMITS.receipt, "PROJECTION_LIMIT");
    scope.check();
    return receipt;
  } catch (primary) {
    progress.code = publicCode(primary);
    progress.drain = scope ? await scope.drain() : "settled";
    let receiptError;
    if (workspaceAdmitted) {
      try {
        await verifyWorkspace(workspace);
        validateProjectionFailure(progress);
        await writeExclusiveRecord(path.join(workspace, PATHS.failure), progress, LIMITS.failure);
      } catch (error) {
        receiptError = error;
      }
    }
    const error = Object.assign(new Error(progress.code), { code: progress.code });
    Object.defineProperty(error, "private", { value: { primary, receiptError, secondary: scope?.privateErrors } });
    Object.defineProperty(error, "failure", { value: { ...progress } });
    throw error;
  } finally {
    scope?.dispose();
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController, cancel = () => controller.abort();
  process.once("SIGTERM", cancel);
  process.once("SIGINT", cancel);
  try {
    need(process.argv.length === 4, "RECEIPT_INVALID");
    console.log(canonicalRecordBytes(await projectNativeCache(process.argv[2], Number(process.argv[3]), controller.signal)).toString().trimEnd());
  } catch (error) {
    const row = Object.getOwnPropertyDescriptor(error, "failure")?.value ?? { ...failure(), code: publicCode(error) };
    console.error(canonicalRecordBytes(validateProjectionFailure(row)).toString().trimEnd());
    process.exitCode = 1;
  } finally {
    process.removeListener("SIGTERM", cancel);
    process.removeListener("SIGINT", cancel);
  }
}
