// Read-only admission and bounded physical I/O. No library cache API or cleanup.
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { verifyWorkspace } from "../build/plugin-payload/prepare.mjs";
import { VERSIONS } from "./native-merged-cache-worker.mjs";
import { LIMITS, PATHS, INPUTS, STATIC_SOURCES, TOOL_EXTRA_SOURCES, canonicalRecordBytes, sha256, inventoryDigest, validateInventory, validateOwner, validateProjectionRequest, validateProjectionManifest, validateProjectionReceipt, validateProjectionLinks, object, publicCode, need, refuse } from "./native-merged-projection-contract.mjs";
const base = fileURLToPath(new URL("../../", import.meta.url));
const stat = (file) => fs.lstat(file, { bigint: true });
export const identity = (s) => ({ dev: s.dev.toString(), ino: s.ino.toString() });
export const sameIdentity = (a, b) => a.dev === b.dev && a.ino === b.ino;
function unchanged(a, b) {
  return sameIdentity(a, b) && a.mode === b.mode && a.nlink === b.nlink && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
}
function preserveClose(primary, error) {
  if (!primary)
    return error;
  try {
    const errors = Object.getOwnPropertyDescriptor(primary, "closeErrors")?.value;
    if (Array.isArray(errors))
      errors.push(error);
    else
      Object.defineProperty(primary, "closeErrors", { value: [error] });
    if (!Object.getOwnPropertyDescriptor(primary, "closeError"))
      Object.defineProperty(primary, "closeError", { value: error });
    return primary;
  } catch {
    const combined = Object.assign(new Error(publicCode(primary)), { code: publicCode(primary) });
    Object.defineProperty(combined, "private", { value: { primary, closeError: error } });
    return combined;
  }
}
const check = (scope) => scope?.check();
async function step(scope, start) {
  return scope ? scope.run(start) : start();
}
export async function realDirectory(file, { scope } = {}) {
  check(scope);
  const absolute = path.resolve(file), root = path.parse(absolute).root;
  let current = root;
  for (const part of path.relative(root, absolute).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const s = await step(scope, () => stat(current));
    need(s.isDirectory() && !s.isSymbolicLink(), "WORKSPACE_INVALID");
  }
  return step(scope, () => stat(absolute));
}
// O_NOFOLLOW + before/fd/after checks. Path APIs cannot exclude hostile same-UID
// replacement between library operations; absent O_NOFOLLOW only checks remain.
export async function stableRead(file, max, { scope, singleLink = true, expected, sink, collect = true } = {}) {
  check(scope);
  await step(scope, () => realDirectory(path.dirname(file), { scope }));
  const before = await step(scope, () => stat(file));
  need(before.isFile() && !before.isSymbolicLink() && (!singleLink || before.nlink === 1n), "WORKSPACE_INVALID");
  need(before.size >= 0n && before.size <= BigInt(max), "PROJECTION_LIMIT");
  if (expected)
    need(unchanged(before, expected), "INPUT_DRIFT");
  let handle, primary, result;
  const chunks = [];
  try {
    await step(scope, async () => {
      handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      return handle;
    });
    const fd = await step(scope, () => handle.stat({ bigint: true }));
    need(unchanged(before, fd), "INPUT_DRIFT");
    const hash = createHash("sha256");
    let position = 0;
    const buffer = Buffer.alloc(Math.min(64 * 1024, max + 1));
    while (true) {
      check(scope);
      const { bytesRead } = await step(scope, () => handle.read(buffer, 0, Math.min(buffer.length, max - position + 1), position));
      if (!bytesRead)
        break;
      need(position + bytesRead <= max && BigInt(position + bytesRead) <= before.size, "PROJECTION_LIMIT");
      const chunk = buffer.subarray(0, bytesRead);
      hash.update(chunk);
      if (collect)
        chunks.push(Buffer.from(chunk));
      if (sink)
        await step(scope, () => sink(chunk, position));
      position += bytesRead;
    }
    need(BigInt(position) === before.size, "INPUT_DRIFT");
    const afterFd = await step(scope, () => handle.stat({ bigint: true }));
    const after = await step(scope, () => stat(file));
    need(unchanged(before, afterFd) && unchanged(before, after), "INPUT_DRIFT");
    result = { bytes: position, sha256: hash.digest("hex"), stat: before, ...collect ? { data: Buffer.concat(chunks, position) } : {} };
  } catch (error) {
    primary = error;
  } finally {
    chunks.length = 0;
    if (handle) {
      try {
        await handle.close();
      } catch (error) {
        scope?.recordError?.(error);
        primary = preserveClose(primary, error);
      }
    }
  }
  if (primary)
    throw primary;
  check(scope);
  return result;
}
export async function readBoundedRecord(file, max, options) {
  const { data } = await stableRead(file, max, options);
  let value;
  try {
    value = JSON.parse(data);
  } catch {
    refuse("RECEIPT_INVALID");
  }
  need(data.equals(canonicalRecordBytes(value)));
  return value;
}
export async function writeExclusiveRecord(file, value, max, { scope } = {}) {
  const bytes = canonicalRecordBytes(value);
  need(bytes.length <= max, "PROJECTION_LIMIT");
  check(scope);
  await step(scope, () => realDirectory(path.dirname(file), { scope }));
  let handle, primary, ownedStat;
  try {
    await step(scope, async () => {
      handle = await fs.open(file, "wx", 384);
      return handle;
    });
    await step(scope, () => handle.writeFile(bytes));
    ownedStat = await step(scope, () => handle.stat({ bigint: true }));
  } catch (error) {
    primary = error;
  } finally {
    if (handle)
      try {
        await handle.close();
      } catch (error) {
        scope?.recordError?.(error);
        primary = preserveClose(primary, error);
      }
  }
  if (primary)
    throw primary;
  const read = await stableRead(file, max, { scope });
  need(read.data.equals(bytes) && unchanged(read.stat, ownedStat), "INPUT_DRIFT");
  return read;
}
function allowedDirectory(relative) {
  if (relative === "tmp")
    return true;
  return /^(?:content-v2(?:\/sha512(?:\/[a-f0-9]{2}(?:\/[a-f0-9]{2})?)?)?|index-v5(?:\/[a-f0-9]{2}(?:\/[a-f0-9]{2})?)?)$/.test(relative);
}
export async function snapshotCache(root, { scope } = {}) {
  check(scope);
  await step(scope, () => realDirectory(root, { scope }));
  const rootStat = await step(scope, () => stat(root)), directories = [], files = [], inventory = [];
  let count = 0, content = 0, index = 0;
  async function visit(directory, relative = "") {
    const before = await step(scope, () => stat(directory));
    need(before.isDirectory() && !before.isSymbolicLink(), "PROJECTION_CACHE_LAYOUT");
    directories.push({ path: relative, stat: before });
    need(directories.length <= LIMITS.directories, "PROJECTION_LIMIT");
    const names = (await step(scope, () => fs.readdir(directory))).sort();
    if (relative === "tmp")
      need(names.length === 0, "PROJECTION_CACHE_LAYOUT");
    for (const name of names) {
      const rel = relative ? relative + "/" + name : name;
      need(Buffer.byteLength(rel) <= LIMITS.pathBytes && rel.split("/").length <= LIMITS.depth, "PROJECTION_LIMIT");
      const file = path.join(directory, name), s = await step(scope, () => stat(file));
      if (s.isDirectory() && !s.isSymbolicLink()) {
        need(allowedDirectory(rel), "PROJECTION_CACHE_LAYOUT");
        await visit(file, rel);
      } else {
        need(s.isFile() && !s.isSymbolicLink() && s.nlink === 1n, "PROJECTION_CACHE_LAYOUT");
        need(++count <= LIMITS.files, "PROJECTION_LIMIT");
        const isContent = /^content-v2\/sha512\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{124}$/.test(rel);
        need(isContent || /^index-v5\/[a-f0-9]{2}\/[a-f0-9]{2}\/[a-f0-9]{60}$/.test(rel), "PROJECTION_CACHE_LAYOUT");
        const read = await stableRead(file, isContent ? LIMITS.contentFile : LIMITS.indexFile, { scope, expected: s, collect: false });
        if (isContent)
          content += read.bytes;
        else
          index += read.bytes;
        need(content <= LIMITS.contentBytes && index <= LIMITS.indexBytes, "PROJECTION_LIMIT");
        files.push({ path: rel, stat: read.stat });
        inventory.push({ path: rel, bytes: read.bytes, sha256: read.sha256 });
      }
    }
    need(unchanged(before, await step(scope, () => stat(directory))), "INPUT_DRIFT");
  }
  await visit(root);
  files.sort((a, b) => a.path < b.path ? -1 : 1);
  inventory.sort((a, b) => a.path < b.path ? -1 : 1);
  validateInventory(inventory);
  for (const dir of directories)
    need(unchanged(dir.stat, await step(scope, () => stat(path.join(root, dir.path)))), "INPUT_DRIFT");
  need(sameIdentity(rootStat, await step(scope, () => stat(root))), "INPUT_DRIFT");
  return { root: rootStat, files, directories, inventory };
}
export async function assertSnapshot(root, expected, options) {
  const current = await snapshotCache(root, options);
  need(isDeepStrictEqual(current.inventory, expected.inventory) && current.files.length === expected.files.length && current.directories.length === expected.directories.length, "INPUT_DRIFT");
  for (let i = 0;i < current.files.length; i++)
    need(unchanged(current.files[i].stat, expected.files[i].stat), "INPUT_DRIFT");
  for (let i = 0;i < current.directories.length; i++)
    need(current.directories[i].path === expected.directories[i].path && unchanged(current.directories[i].stat, expected.directories[i].stat), "INPUT_DRIFT");
  return current;
}
export async function exclusiveDirectory(file, { scope } = {}) {
  check(scope);
  await step(scope, () => realDirectory(path.dirname(file), { scope }));
  try {
    await step(scope, () => fs.mkdir(file, { mode: 448 }));
  } catch (e) {
    if (e.code === "EEXIST")
      refuse("PROJECTION_DESTINATION_EXISTS");
    throw e;
  }
  return step(scope, () => stat(file));
}
export async function copyCacheSnapshot(source, destination, snapshot, { scope } = {}) {
  const relative = path.relative(path.resolve(source), path.resolve(destination)), reverse = path.relative(path.resolve(destination), path.resolve(source));
  need(relative !== "" && !(!relative.startsWith(".." + path.sep) && relative !== ".." && !path.isAbsolute(relative)) && !(!reverse.startsWith(".." + path.sep) && reverse !== ".." && !path.isAbsolute(reverse)), "PROJECTION_DESTINATION_EXISTS");
  await assertSnapshot(source, snapshot, { scope });
  const createdDirectories = [{ path: "", stat: await exclusiveDirectory(destination, { scope }) }], createdFiles = [];
  for (const dir of snapshot.directories.filter((d) => d.path))
    createdDirectories.push({ path: dir.path, stat: await exclusiveDirectory(path.join(destination, dir.path), { scope }) });
  for (const file of snapshot.files) {
    let handle, primary;
    const target = path.join(destination, file.path);
    try {
      await step(scope, async () => {
        handle = await fs.open(target, "wx", 384);
        return handle;
      });
      await stableRead(path.join(source, file.path), LIMITS.contentFile, { scope, expected: file.stat, collect: false, sink: async (chunk, position) => {
        let offset = 0;
        while (offset < chunk.length) {
          const written = await step(scope, () => handle.write(chunk, offset, chunk.length - offset, position + offset));
          need(written.bytesWritten > 0, "PROJECTION_READBACK");
          offset += written.bytesWritten;
        }
      } });
      const ownedStat = await step(scope, () => handle.stat({ bigint: true }));
      const current = await step(scope, () => stat(target));
      need(ownedStat.isFile() && ownedStat.nlink === 1n && unchanged(ownedStat, current), "INPUT_DRIFT");
      createdFiles.push({ path: file.path, stat: ownedStat });
    } catch (error) {
      primary = error;
    } finally {
      if (handle)
        try {
          await handle.close();
        } catch (error) {
          scope?.recordError?.(error);
          primary = preserveClose(primary, error);
        }
    }
    if (primary)
      throw primary;
  }
  const copy = await snapshotCache(destination, { scope });
  need(isDeepStrictEqual(copy.inventory, snapshot.inventory), "INPUT_DRIFT");
  for (let i = 0;i < copy.files.length; i++)
    need(!sameIdentity(copy.files[i].stat, snapshot.files[i].stat) && unchanged(copy.files[i].stat, createdFiles[i].stat), "INPUT_DRIFT");
  for (const created of createdDirectories) {
    const current = copy.directories.find((row) => row.path === created.path);
    need(current && sameIdentity(current.stat, created.stat), "INPUT_DRIFT");
  }
  await assertSnapshot(source, snapshot, { scope });
  return copy;
}
const toolSpecs = Object.freeze([["arborist", "@npmcli/arborist", VERSIONS.arborist, "root"], ["config", "@npmcli/config", VERSIONS.config, "root"], ["pacote", "pacote", VERSIONS.pacote, "arborist"], ["registryFetch", "npm-registry-fetch", VERSIONS.registryFetch, "pacote"], ["fetch", "make-fetch-happen", VERSIONS.fetch, "registryFetch"], ["cacache", "cacache", VERSIONS.cacache, "arborist"], ["npa", "npm-package-arg", VERSIONS.npa, "arborist"], ["semver", "semver", "7.8.5", "npa"]]);
// Resolution only: neither require(name) nor tool API execution is permitted here.
export async function resolveRuntimeTools({ scope } = {}) {
  check(scope);
  try {
    const toolRoot = path.join(base, "lawoss/engine-dependencies/runtime-tools"), physical = await step(scope, () => fs.realpath(path.join(toolRoot, "node_modules")));
    await realDirectory(physical, { scope });
    const resolved = { root: { require: createRequire(path.join(toolRoot, "package.json")) } };
    for (const [key, name, version, parent] of toolSpecs) {
      const require = resolved[parent].require, manifest = await step(scope, () => fs.realpath(require.resolve(name + "/package.json"))), entry = await step(scope, () => fs.realpath(require.resolve(name)));
      for (const file of [manifest, entry]) {
        const rel = path.relative(physical, file);
        need(rel !== "" && !rel.startsWith(".." + path.sep) && rel !== ".." && !path.isAbsolute(rel), "TOOLS_INVALID");
      }
      need(entry.startsWith(path.dirname(manifest) + path.sep), "TOOLS_INVALID");
      const bytes = await stableRead(manifest, LIMITS.sourceFile, { scope, singleLink: false });
      const pkg = JSON.parse(bytes.data);
      need(pkg.name === name && pkg.version === version, "TOOLS_INVALID");
      resolved[key] = { name, version, manifest, entry, require: createRequire(entry) };
    }
    delete resolved.root;
    return resolved;
  } catch (error) {
    if (["CANCELLED", "PRIMER_DEADLINE"].includes(publicCode(error)))
      throw error;
    refuse("TOOLS_INVALID");
  }
}
export async function sourceInventory({ scope } = {}) {
  check(scope);
  const resolved = await step(scope, () => resolveRuntimeTools({ scope })), files = STATIC_SOURCES.map((logical) => ({ logical, file: path.join(base, logical) }));
  for (const [key, binding] of Object.entries(resolved))
    for (const kind of ["manifest", "entry"])
      files.push({ logical: "runtime/" + key + "/" + kind, file: binding[kind] });
  for (const [key, names] of Object.entries(TOOL_EXTRA_SOURCES))
    for (const name of names)
      files.push({ logical: "runtime/" + key + "/" + name, file: path.join(path.dirname(resolved[key].manifest), name) });
  need(files.length <= LIMITS.sourceFiles, "PROJECTION_LIMIT");
  const rows = [];
  let total = 0;
  for (const { logical, file } of files) {
    const read = await stableRead(file, LIMITS.sourceFile, { scope, singleLink: !logical.startsWith("runtime/") && !logical.startsWith("lawoss/engine-dependencies/runtime-tools/") });
    total += read.bytes;
    need(total <= LIMITS.sourceBytes, "PROJECTION_LIMIT");
    rows.push({ path: logical, bytes: read.bytes, sha256: read.sha256 });
  }
  rows.sort((a, b) => a.path < b.path ? -1 : 1);
  validateInventory(rows, { source: true });
  return rows;
}
export async function pinnedInputs({ scope } = {}) {
  const definitions = [["sdkInputSha256", "lawoss/build/plugin-payload/sdk/package.json"], ["sdkLockSha256", "lawoss/build/plugin-payload/sdk/package-lock.json"], ["toolsLockSha256", "lawoss/build/plugin-payload/tools/pnpm-lock.yaml"], ["runtimeLockSha256", "lawoss/engine-dependencies/runtime-tools/pnpm-lock.yaml"], ["publicManifestSha256", "lawoss/build/plugin-payload/sdk/public-package-manifests.json"]];
  const buffers = {};
  for (const [key, relative] of definitions) {
    const read = await stableRead(path.join(base, relative), LIMITS.sourceFile, {
      scope, singleLink: relative !== "lawoss/engine-dependencies/runtime-tools/pnpm-lock.yaml",
    });
    need(read.sha256 === INPUTS[key], "INPUT_DRIFT");
    buffers[key] = read.data;
  }
  const lock = JSON.parse(buffers.sdkLockSha256), publicManifests = JSON.parse(buffers.publicManifestSha256);
  const records = Object.entries(lock.packages).filter(([name]) => name !== "").map(([key, pkg]) => ({ name: key.replace(/^node_modules\//, ""), version: pkg.version, integrity: pkg.integrity, resolved: pkg.resolved }));
  need(records.length === 32 && Object.keys(publicManifests).length === 27, "INPUT_DRIFT");
  return { lock, publicManifests, records };
}
function immutable(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value))
      immutable(child);
    Object.freeze(value);
  }
  return value;
}
// REQUIRED external premise: Task18 calls only after its own positive direct
// child close + exit0. No boolean/token supplied here can attest process close.
export async function verifyProjectionArtifacts(workspace, receipt, expectedRequest, expectedSourceInventory, options = {}) {
  need(object(options) && Object.keys(options).every((key) => key === "signal"));
  const { signal } = options;
  validateProjectionRequest(expectedRequest);
  validateProjectionReceipt(receipt);
  const scope = { check() {
    if (signal?.aborted)
      refuse("CANCELLED");
    need(Date.now() < expectedRequest.deadline && expectedRequest.deadline - Date.now() <= 300000, "PRIMER_DEADLINE");
  }, async run(start) {
    this.check();
    const value = await start();
    this.check();
    return value;
  } };
  scope.check();
  await scope.run(() => verifyWorkspace(workspace));
  const workspaceStat = await realDirectory(workspace, { scope });
  const request = validateProjectionRequest(await readBoundedRecord(path.join(workspace, PATHS.request), LIMITS.request, { scope }));
  need(isDeepStrictEqual(request, expectedRequest), "INPUT_DRIFT");
  const owner = validateOwner(await readBoundedRecord(path.join(workspace, PATHS.owner), LIMITS.owner, { scope }));
  const manifestRead = await stableRead(path.join(workspace, PATHS.manifest), LIMITS.manifest, { scope });
  let manifest;
  try {
    manifest = JSON.parse(manifestRead.data);
  } catch {
    refuse("RECEIPT_INVALID");
  }
  need(manifestRead.data.equals(canonicalRecordBytes(manifest)));
  const { records } = await pinnedInputs({ scope });
  validateProjectionManifest(manifest, records);
  const sources = await sourceInventory({ scope });
  need(isDeepStrictEqual(sources, expectedSourceInventory) && isDeepStrictEqual(sources, manifest.sourceInventory) && inventoryDigest(sources) === request.sourceInventorySha256, "INPUT_DRIFT");
  const raw = await snapshotCache(path.join(workspace, PATHS.raw), { scope }), derived = await snapshotCache(path.join(workspace, PATHS.derived), { scope }), fixture = await realDirectory(path.join(workspace, PATHS.fixture), { scope });
  need(isDeepStrictEqual(owner.workspace, identity(workspaceStat)) && isDeepStrictEqual(owner.root, identity(fixture)) && owner.nonce === request.nonce && manifest.nonce === request.nonce && receipt.nonce === request.nonce, "WORKSPACE_INVALID");
  for (const [key, want] of [["workspaceIdentity", identity(workspaceStat)], ["rawCacheIdentity", identity(raw.root)], ["fixtureIdentity", identity(fixture)]])
    need(isDeepStrictEqual(manifest[key], want), "WORKSPACE_INVALID");
  need(isDeepStrictEqual(raw.inventory, manifest.rawInventory) && isDeepStrictEqual(derived.inventory, manifest.derivedInventory), "INPUT_DRIFT");
  validateProjectionLinks({ receipt, manifest, request, owner, manifestSha256: manifestRead.sha256 });
  await scope.run(() => verifyWorkspace(workspace));
  need(sameIdentity(workspaceStat, await scope.run(() => stat(workspace))), "WORKSPACE_INVALID");
  scope.check();
  return Object.freeze({ cache: path.join(workspace, PATHS.derived), receipt: immutable(structuredClone(receipt)) });
}
