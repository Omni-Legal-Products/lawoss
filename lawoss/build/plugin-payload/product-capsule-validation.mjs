// Build-only verification using externally authenticated private-code identity.
// No resource-supplied JS is imported. Caller owns this initialized workspace
// and must settle/clean it before a full packaging gate can report success.
import { constants, createWriteStream } from 'node:fs';
import { lstat, open, readFile, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { Transform, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip } from 'node:zlib';
import path from 'node:path';
import { transaction, verifyWorkspace } from './prepare.mjs';
import { canonical, inventory, SDK_LOCK_SHA256, sdkConsumerMode, verifyBuildPayload } from './validate.mjs';

const MiB = 1024 * 1024;
const verifierNames = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md', 'sdk/notices/licenses/opencode-MIT.txt',
  'sdk/notices/licenses/msgpackr-extract-MIT.txt', 'sdk/notices/licenses/kubernetes-Apache-2.0.txt'].sort();
const bad = (code = 'PRODUCT_SDK_CAPSULE_INVALID') => { throw Object.assign(new Error(code), { code }); };
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const physicalSame = (a, b) => same(a, b) && ['size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function fields(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) bad();
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  if (keys.length !== names.length || keys.some(key => !names.includes(key))) bad();
  return Object.fromEntries(names.map(name => {
    const field = descriptors[name];
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable) bad();
    return [name, field.value];
  }));
}
function identityData(value) {
  const result = fields(value, ['schema', 'kind', 'status', 'manifestSha256', 'target', 'lockSha256',
    'inputSha256', 'sourceSetSha256', 'consumerMode', 'verifierSha256', 'capsule']);
  const platform = result.target && Object.getOwnPropertyDescriptor(result.target, 'platform')?.value;
  result.target = Object.freeze(fields(result.target, platform === 'linux' ? ['platform', 'arch', 'libc'] : ['platform', 'arch']));
  result.capsule = Object.freeze(fields(result.capsule, ['format', 'file', 'sha256', 'bytes']));
  if (result.schema !== 1 || result.kind !== 'lawoss-product-sdk-capsule' || result.status !== 'verified' ||
    !['manifestSha256', 'inputSha256', 'sourceSetSha256', 'verifierSha256'].every(name => hex(result[name])) ||
    result.lockSha256 !== SDK_LOCK_SHA256 || sdkConsumerMode(result.target, result.lockSha256) !== result.consumerMode ||
    result.capsule.format !== 'tar+gzip' || result.capsule.file !== 'payload.tgz' || !hex(result.capsule.sha256) ||
    !Number.isSafeInteger(result.capsule.bytes) || result.capsule.bytes < 1 || result.capsule.bytes > 270 * MiB) bad();
  return Object.freeze(result);
}
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
function safeName(raw, directoryEntry = false) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\p{Cc}\p{Cf}\\:<>"|?*]/u.test(raw) || raw.startsWith('/')) bad();
  let name = raw.startsWith('./') ? raw.slice(2) : raw;
  if (directoryEntry && name.endsWith('/')) name = name.slice(0, -1);
  if ((raw === '.' || raw === './') && directoryEntry) return '';
  if (!name || name.normalize('NFC') !== name || name.split('/')[0].toLowerCase() === '.capsule-input.tgz') bad();
  const parts = name.split('/');
  if (parts.length > 64) bad('PRODUCT_SDK_CAPSULE_LIMIT');
  if (parts.some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) ||
    Buffer.byteLength(part) > 255 || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) bad();
  return name;
}
function linkTarget(name, raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\p{Cc}\p{Cf}\\:<>"|?*]/u.test(raw) || path.posix.isAbsolute(raw)) bad();
  const parts = raw.split('/'); let index = 0;
  while (parts[index] === '..') index++;
  if (parts.slice(index).some(part => !part || part === '.' || part === '..')) bad();
  const target = path.posix.normalize(path.posix.join(path.posix.dirname(name), raw));
  if (!target || target === '.' || target === '..' || target.startsWith('../')) bad();
  return safeName(target);
}
async function safeList(handle, size, tar) {
  const nodes = new Map([['', { kind: 'Directory', explicit: false }]]), aliases = new Map([['', '']]);
  let entries = 0, bytes = 0, metadata = 0, metadataEntries = 0, eof = false, ended = false;
  const parser = new tar.Parser({ strict: true, maxMetaEntrySize: 65536, brotli: false, zstd: false });
  let remainder = Buffer.alloc(0), trailing = 0;
  const sink = new Writable({
    write(chunk, encoding, done) {
      try {
        if (remainder.length) chunk = Buffer.concat([remainder, chunk]);
        let offset = 0;
        // Fixed blocks let the existing parser identify the exact EOF boundary.
        // It must not buffer arbitrary trailing bytes that sync extraction would
        // also accumulate; no headers or entry semantics are decoded here.
        while (!eof && offset + 512 <= chunk.length) { parser.write(chunk.subarray(offset, offset + 512)); offset += 512; }
        remainder = chunk.subarray(offset);
        if (eof) {
          if ((trailing += remainder.length) > 65536) bad('PRODUCT_SDK_CAPSULE_LIMIT');
          if (remainder.some(byte => byte !== 0)) bad();
          remainder = Buffer.alloc(0);
        }
        done();
      } catch (error) { done(error); }
    },
    final(done) {
      if (ended) { done(); return; }
      parser.once('end', done); try { if (remainder.length) parser.write(remainder); parser.end(); } catch (error) { done(error); }
    },
  });
  parser.once('end', () => { ended = true; });
  parser.on('error', error => sink.destroy(error));
  const refuse = error => { try { parser.abort(error); } catch (failure) { sink.destroy(failure); } };
  parser.on('eof', () => { eof = true; });
  parser.on('ignoredEntry', entry => refuse(Object.assign(new Error('PRODUCT_SDK_CAPSULE_INVALID'), {
    code: entry.meta ? 'PRODUCT_SDK_CAPSULE_LIMIT' : 'PRODUCT_SDK_CAPSULE_INVALID',
  })));
  parser.on('meta', text => {
    metadata += Buffer.byteLength(text);
    if (++metadataEntries > 30000 || metadata > 64 * MiB) refuse(Object.assign(new Error('PRODUCT_SDK_CAPSULE_LIMIT'), { code: 'PRODUCT_SDK_CAPSULE_LIMIT' }));
  });
  function node(name, value) {
    const alias = name.toLowerCase();
    if (aliases.has(alias) && aliases.get(alias) !== name) bad();
    aliases.set(alias, name); nodes.set(name, value);
    if (nodes.size > 30000) bad('PRODUCT_SDK_CAPSULE_LIMIT');
  }
  parser.on('entry', entry => {
    try {
      if (++entries > 30000 || !Number.isSafeInteger(entry.size) || entry.size < 0 || entry.size > 32 * MiB) bad('PRODUCT_SDK_CAPSULE_LIMIT');
      if (!['File', 'OldFile', 'Directory', 'SymbolicLink'].includes(entry.type) ||
        !Number.isInteger(entry.mode) || entry.mode < 0 || entry.mode > 0o777 || (entry.type !== 'File' && entry.type !== 'OldFile' && entry.size)) bad();
      const name = safeName(entry.header.path, entry.type === 'Directory');
      if (safeName(entry.path, entry.type === 'Directory') !== name) bad();
      const parts = name.split('/');
      for (let i = 1; i < parts.length; i++) {
        const parent = parts.slice(0, i).join('/'), previous = nodes.get(parent);
        if (previous && previous.kind !== 'Directory') bad();
        if (!previous) node(parent, { kind: 'Directory', explicit: false });
      }
      const previous = nodes.get(name);
      if (previous?.explicit || (previous && entry.type !== 'Directory')) bad();
      const kind = entry.type === 'OldFile' ? 'File' : entry.type;
      const value = { kind, explicit: true };
      if (kind === 'SymbolicLink') {
        if (!name.includes('/.bin/') || entry.header.linkpath !== entry.linkpath) bad();
        value.target = linkTarget(name, entry.header.linkpath);
      }
      if ((bytes += entry.size) > 256 * MiB) bad('PRODUCT_SDK_CAPSULE_LIMIT');
      node(name, value);
    } catch (error) { refuse(error); }
    entry.resume();
  });
  let decompressed = 0; const prefix = [];
  const cap = new Transform({ transform(chunk, encoding, done) {
    decompressed += chunk.length;
    for (const byte of chunk.subarray(0, 2 - prefix.length)) prefix.push(byte);
    // Parser must only see raw tar: its implicit nested gzip decoder would
    // otherwise sit after our raw-byte cap. Other auto-decoders are disabled.
    if (prefix[0] === 0x1f && prefix[1] === 0x8b) { done(Object.assign(new Error('PRODUCT_SDK_CAPSULE_INVALID'), { code: 'PRODUCT_SDK_CAPSULE_INVALID' })); return; }
    done(decompressed > 384 * MiB ? Object.assign(new Error('PRODUCT_SDK_CAPSULE_LIMIT'), { code: 'PRODUCT_SDK_CAPSULE_LIMIT' }) : null, chunk);
  } });
  try { await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: size - 1 }), createGunzip(), cap, sink); }
  catch (error) { refuse(error); throw error; }
  if (!eof) bad();
  function resolve(name, seen = new Set()) {
    if (seen.size > 64 || seen.has(name)) bad();
    seen.add(name);
    const parts = name.split('/');
    for (let i = 1; i <= parts.length; i++) {
      const current = parts.slice(0, i).join('/'), value = nodes.get(current);
      if (!value) bad();
      if (value.kind === 'SymbolicLink') return resolve(path.posix.join(value.target, ...parts.slice(i)), seen);
      if (i < parts.length && value.kind !== 'Directory') bad();
    }
  }
  for (const value of nodes.values()) if (value.kind === 'SymbolicLink') resolve(value.target);
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
