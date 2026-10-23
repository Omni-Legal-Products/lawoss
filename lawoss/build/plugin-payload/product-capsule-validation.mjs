// Build-only verification using externally authenticated private-code identity.
// No resource-supplied JS is imported. Caller owns this initialized workspace
// and must settle/clean it before a full packaging gate can report success.
import { constants, createWriteStream } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { validateProductSdkCapsuleArchive as safeList } from './product-capsule-format.mjs';
import { transaction, verifyWorkspace } from './prepare.mjs';
import { canonical, inventory, verifyBuildPayload } from './validate.mjs';
import { admitProductSdkCapsuleIdentity as identityData } from './product-capsule-identity.mjs';

const verifierNames = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md', 'sdk/notices/licenses/opencode-MIT.txt',
  'sdk/notices/licenses/msgpackr-extract-MIT.txt', 'sdk/notices/licenses/kubernetes-Apache-2.0.txt'].sort();
const bad = (code = 'PRODUCT_SDK_CAPSULE_INVALID') => { throw Object.assign(new Error(code), { code }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const physicalSame = (a, b) => same(a, b) && ['size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function absent(file) {
  try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; }
}
async function directory(root) {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) bad();
  return stat;
}
async function workspaceIdentity(workspace, expected) {
  const stat = await directory(workspace);
  // Refuse substitution before looking at any workspace child.
  if (expected && !same(stat, expected)) bad('PRODUCT_SDK_CAPSULE_OWNERSHIP_UNCERTAIN');
  if (typeof process.getuid === 'function' && (stat.uid !== process.getuid() || (stat.mode & 0o077))) bad();
  await verifyWorkspace(workspace);
  const owner = JSON.parse(await readFile(path.join(workspace, '.owner.json'), 'utf8'));
  if (expected && owner.token !== expected.token) bad('PRODUCT_SDK_CAPSULE_OWNERSHIP_UNCERTAIN');
  return { dev: stat.dev, ino: stat.ino, token: owner.token };
}
async function capsuleHash(handle, size, destination) {
  const digest = createHash('sha256'); let bytes = 0;
  const tap = new Transform({ transform(chunk, encoding, done) { bytes += chunk.length; digest.update(chunk); done(null, chunk); } });
  const output = destination ? createWriteStream(destination, { flags: 'wx', mode: 0o600 }) : new Writable({ write(chunk, encoding, done) { done(); } });
  await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: size - 1 }), tap, output);
  if (bytes !== size) bad();
  return digest.digest('hex');
}

export async function extractAndVerifyProductSdkCapsule({ resourceRoot, identity, workspace }) {
  const expected = identityData(identity);
  if (![resourceRoot, workspace].every(root => typeof root === 'string' && path.isAbsolute(root) && root.length <= 4096)) bad();
  const resource = await directory(resourceRoot), owner = await workspaceIdentity(workspace);
  const relative = path.relative(resourceRoot, workspace), reverse = path.relative(workspace, resourceRoot);
  if (!relative || !reverse || [relative, reverse].some(value => value !== '..' && !value.startsWith(`..${path.sep}`) && !path.isAbsolute(value))) bad();
  async function verifyResource() {
    if (!same(resource, await directory(resourceRoot)) || canonical((await readdir(resourceRoot)).sort()) !== canonical(['payload.tgz', 'verifier'])) bad();
    const verifier = path.join(resourceRoot, 'verifier'); await directory(verifier);
    const records = await inventory(verifier);
    if (canonical(records.map(record => record.path).sort()) !== canonical(verifierNames) || hash(canonical(records)) !== expected.verifierSha256) bad();
  }
  await verifyResource();
  const file = path.join(resourceRoot, 'payload.tgz'), before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size !== BigInt(expected.capsule.bytes)) bad();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let primary;
  try {
    const opened = await handle.stat({ bigint: true });
    if (!physicalSame(before, opened) || !opened.isFile() || await capsuleHash(handle, expected.capsule.bytes) !== expected.capsule.sha256) bad();
    const require = createRequire(new URL('./tools/package.json', import.meta.url));
    const tools = createRequire(require.resolve('@npmcli/arborist/package.json'));
    if (tools('tar/package.json').version !== '7.5.22') bad('SDK_CAPSULE_TOOLS_INVALID');
    const tar = tools('tar');
    await safeList(handle, expected.capsule.bytes, tar);
    await workspaceIdentity(workspace, owner);
    let stage, stageIdentity, admissionIdentity, output;
    const admission = path.join(workspace, '.admit-payload');
    async function settled(published) {
      await workspaceIdentity(workspace, owner);
      if (stage) {
        const current = published ? await lstat(path.join(workspace, 'payload')) : await lstat(stage).catch(error => { if (error.code !== 'ENOENT') throw error; return null; });
        if (published ? !current.isDirectory() || !same(current, stageIdentity) : current !== null) bad('PRODUCT_SDK_CAPSULE_CLEANUP_UNCERTAIN');
        if (!await absent(admission)) bad('PRODUCT_SDK_CAPSULE_CLEANUP_UNCERTAIN');
      }
    }
    try {
      output = await transaction(workspace, 'payload', async ownStage => {
        stage = ownStage; stageIdentity = await lstat(stage); admissionIdentity = await lstat(admission);
        await workspaceIdentity(workspace, owner);
        const copy = path.join(stage, '.capsule-input.tgz');
        if (await capsuleHash(handle, expected.capsule.bytes, copy) !== expected.capsule.sha256 ||
          !physicalSame(before, await handle.stat({ bigint: true }))) bad();
        // The exact authenticated/listed bytes now reside only in our private
        // stage. Synchronous extraction leaves no asynchronous writers to race
        // transaction cleanup, and never executes any SDK or resource JS.
        tar.x({ file: copy, cwd: stage, sync: true, strict: true, umask: 0, preserveOwner: false });
        await unlink(copy);
        const manifest = await verifyBuildPayload(stage, expected.manifestSha256, expected.target);
        if (manifest.inputSha256 !== expected.inputSha256 || manifest.lockSha256 !== expected.lockSha256) bad();
        if (await capsuleHash(handle, expected.capsule.bytes) !== expected.capsule.sha256 ||
          !physicalSame(before, await handle.stat({ bigint: true })) || !physicalSame(before, await lstat(file, { bigint: true })) ||
          !same(resource, await directory(resourceRoot))) bad();
        await verifyResource();
        await workspaceIdentity(workspace, owner);
      });
      await settled(true);
    } catch (error) {
      // OUTPUT_BUSY may belong to a different writer; without operation entry
      // there is no captured stage/admission to attribute to this invocation.
      if (stage && admissionIdentity) {
        try { await settled(false); }
        catch (cleanup) { throw new AggregateError([error, cleanup], 'SDK capsule verification and cleanup uncertain', { cause: error }); }
      }
      throw error;
    }
    return Object.freeze({ schema: 1, kind: 'lawoss-product-sdk-capsule-payload', status: 'verified', payloadRoot: output, identity: expected });
  } catch (error) { primary = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'SDK capsule verification and close failed', { cause: primary }); throw cleanup; }
  }
}
