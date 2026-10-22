// Build namespace only. Caller guarantees native children have settled before
// completing a generation. This lease coordinates this API, not hostile same-UID
// writers; directory rename has a final absence-check/no-replace race. POSIX
// UID/mode metadata is not a Windows ACL assertion. Unknown leases are never stolen.
import { lstat, open, readFile, readdir, realpath, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { initialize, verifyWorkspace } from './prepare.mjs';

const generations = new WeakMap();
const invalid = () => { throw Object.assign(new Error('PRODUCT_SDK_BUILD_ROOT_INVALID'), { code: 'PRODUCT_SDK_BUILD_ROOT_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
async function statOrAbsent(file) {
  try { return await lstat(file); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function physical(directory) {
  const stat = await lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(directory) !== directory ||
    (typeof process.getuid === 'function' && stat.uid !== process.getuid())) invalid();
  return stat;
}
async function owned(root) {
  await verifyWorkspace(root);
  const stat = await physical(root);
  if (typeof process.getuid === 'function' && (stat.mode & 0o077)) invalid();
  const owner = JSON.parse(await readFile(path.join(root, '.owner.json'), 'utf8'));
  if (owner.dev !== stat.dev || owner.ino !== stat.ino) invalid();
  return Object.freeze({ dev: stat.dev, ino: stat.ino, token: owner.token });
}
async function idle(root) {
  // Only known SDK admission locations; do not scan payloads, profiles or caches.
  for (const parts of [[], ['supplier'], ['supplier', 'runtime-consumer-validation'], ['runtime-consumer-validation'], ['publication']]) {
    let directory = root, missing = false;
    for (const part of parts) {
      directory = path.join(directory, part);
      const stat = await statOrAbsent(directory);
      if (!stat) { missing = true; break; }
      if (!stat.isDirectory() || stat.isSymbolicLink()) invalid();
    }
    if (missing) continue;
    const names = (await readdir(directory)).map(name => name.toLowerCase());
    if (names.length > 128 || names.some(name => name === '.admit' || name === '.admissions' || name.startsWith('.admit-') ||
      name === '.lawoss-plugin-sdk-publication.lock' || name.startsWith('.stage-') || name.startsWith('.plugin-sdk-stage-'))) invalid();
  }
}
async function release(state, remove) {
  // An unverified close must not release the generation marker.
  await state.lease.close();
  if (remove && state.leaseIdentity) {
    const stat = await lstat(state.leasePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || !same(stat, state.leaseIdentity)) invalid();
    await unlink(state.leasePath);
  }
}

export async function freshProductSdkBuildRoot(root) {
  if (typeof root !== 'string' || !path.isAbsolute(root) || path.resolve(root) !== root || root.length > 4096 ||
    !/^[a-zA-Z0-9._-]{1,80}$/.test(path.basename(root)) || path.dirname(root) === root) invalid();
  const parent = path.dirname(root), parentIdentity = await physical(parent);
  const leasePath = path.join(parent, `.${path.basename(root)}.generation.lock`);
  const state = { leasePath, lease: await open(leasePath, 'wx', 0o600), leaseIdentity: null };
  let uncertain = false;
  try {
    state.leaseIdentity = await state.lease.stat();
    if (!same(await physical(parent), parentIdentity)) invalid();
    let archivedPrevious = null;
    if (await statOrAbsent(root)) {
      const previous = await owned(root);
      await idle(root);
      archivedPrevious = path.join(parent, `.${path.basename(root)}.previous-${crypto.randomUUID()}`);
      if (await statOrAbsent(archivedPrevious)) invalid();
      if (!same(await physical(parent), parentIdentity) || !same(await owned(root), previous)) invalid();
      uncertain = true;
      await rename(root, archivedPrevious);
      const moved = await owned(archivedPrevious);
      if (!same(moved, previous) || moved.token !== previous.token) invalid();
    }
    if (await statOrAbsent(root)) invalid();
    uncertain = true;
    await initialize(root);
    const identity = await owned(root);
    const generation = Object.freeze({ root, archivedPrevious, identity });
    generations.set(generation, state);
    return generation;
  } catch (primary) {
    try { await release(state, !uncertain); }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'SDK build generation and cleanup failed', { cause: primary }); }
    throw primary;
  }
}

export async function completeProductSdkBuildRoot(generation) {
  const state = generations.get(generation);
  if (!state) invalid();
  generations.delete(generation);
  try {
    const identity = await owned(generation.root);
    if (!same(identity, generation.identity) || identity.token !== generation.identity.token) invalid();
    await idle(generation.root);
  } catch (primary) {
    try { await release(state, false); }
    catch (cleanup) { throw new AggregateError([primary, cleanup], 'SDK build completion and cleanup failed', { cause: primary }); }
    throw primary;
  }
  await release(state, true);
}
