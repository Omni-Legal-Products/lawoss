// Standalone stage-only core. No caller may wire this into production before
// authenticated code/runtime/channel admission and the separate close supervisor.
import { constants } from 'node:fs';
import { lstat, open, readdir, realpath, unlink } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { validateProductSdkCapsuleArchive } from '../build/plugin-payload/product-capsule-format.mjs';
import { canonical, createEmbeddedRuntimePayloadVerifier, sdkConsumerMode } from '../build/plugin-payload/validate.mjs';
import { admitStageDecodeRequest, admitStageDecodeResult } from './sdk-stage-decoder-contract.mjs';

const verifierNames = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md', 'sdk/notices/licenses/opencode-MIT.txt',
  'sdk/notices/licenses/msgpackr-extract-MIT.txt', 'sdk/notices/licenses/kubernetes-Apache-2.0.txt'].sort();
const nativeAborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const archiveCodes = new Set(['PRODUCT_SDK_CAPSULE_INVALID', 'PRODUCT_SDK_CAPSULE_LIMIT']);
const fail = (code, cause) => { throw Object.assign(new Error(code, { cause }), { code }); };
const same = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const physicalSame = (a, b) => same(a, b) && ['size', 'mtimeNs', 'ctimeNs'].every(key => a[key] === b[key]);
const digest = value => createHash('sha256').update(value).digest('hex');
const privateDirectory = stat => typeof process.getuid !== 'function' || (stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n);
function record(value, names) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('STAGE_REQUEST_INVALID');
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length !== names.length || keys.some(key => !names.includes(key)) || names.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) fail('STAGE_REQUEST_INVALID');
  return Object.fromEntries(names.map(key => [key, fields[key].value]));
}
function localSignal(options) {
  const keys = options && Reflect.ownKeys(options);
  const fields = record(options, keys?.length === 0 ? [] : ['signal']);
  if (fields.signal === undefined) return undefined;
  // Invoke the native brand check rather than trusting a duck-typed object.
  try { nativeAborted.call(fields.signal); }
  catch { fail('STAGE_REQUEST_INVALID'); }
  return fields.signal;
}

export function createProductSdkStageDecoder(configuration) {
  let tar, verify;
  try {
    const value = record(configuration, ['tar', 'acceptedInputText', 'acceptedLockText']);
    tar = value.tar;
    if (!tar || typeof tar.Parser !== 'function' || typeof tar.x !== 'function') fail('STAGE_REQUEST_INVALID');
    verify = createEmbeddedRuntimePayloadVerifier({ acceptedInputText: value.acceptedInputText, acceptedLockText: value.acceptedLockText });
  } catch (cause) { fail('STAGE_REQUEST_INVALID', cause); }
  // tar is trusted composition input, never selected or authenticated by Request.
  return Object.freeze(async function decodeStage(value, options = {}) {
    let request, signal;
    try { request = admitStageDecodeRequest(value); signal = localSignal(options); }
    catch (error) {
      if (['STAGE_REQUEST_INVALID', 'STAGE_DEADLINE'].includes(Object.getOwnPropertyDescriptor(error ?? {}, 'code')?.value)) throw error;
      fail('STAGE_REQUEST_INVALID', error);
    }
    const end = performance.now() + (request.deadline - Date.now());
    function check() {
      if (signal && nativeAborted.call(signal)) fail('STAGE_ABORTED');
      if (performance.now() >= end) fail('STAGE_DEADLINE');
    }
    async function step(operation) { const result = await operation; check(); return result; }
    check();
    if (process.version !== 'v22.23.2' || process.versions.bun) fail('STAGE_RUNTIME_UNSUPPORTED');
    const host = { platform: process.platform, arch: process.arch,
      ...(process.platform === 'linux' ? { libc: process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl' } : {}) };
    if (canonical(host) !== canonical(request.sdkIdentity.target)) fail('STAGE_TARGET_MISMATCH');
    const stage = request.stageGrant.path, parent = request.stageGrant.parent.path, resource = request.resourceRoot;
    const contains = (a, b) => { const relative = path.relative(a, b); return !relative || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)); };
    if (path.dirname(stage) !== parent || contains(resource, stage) || contains(stage, resource)) fail('STAGE_OWNERSHIP_UNCERTAIN');

    let phase = 'STAGE_RESOURCE_INVALID', handle, primary, before;
    const file = path.join(resource, 'payload.tgz'), verifierRoot = path.join(resource, 'verifier');
    const cleanupErrors = [];
    const chains = new Map(), resources = new Map();
    function phaseError(cause) {
      const code = Object.getOwnPropertyDescriptor(cause ?? {}, 'code')?.value;
      return archiveCodes.has(code) || ['STAGE_ABORTED', 'STAGE_DEADLINE', 'STAGE_RESOURCE_INVALID', 'STAGE_OWNERSHIP_UNCERTAIN',
        'STAGE_COPY_FAILED', 'STAGE_EXTRACT_FAILED', 'STAGE_VERIFY_FAILED', 'STAGE_CLEANUP_UNCERTAIN'].includes(code)
        ? cause : Object.assign(new Error(phase, { cause }), { code: phase });
    }
    async function ancestry(root, expected, code) {
      const names = [], parsed = path.parse(root);
      let current = parsed.root;
      names.push(current);
      for (const part of root.slice(current.length).split(path.sep).filter(Boolean)) { current = path.join(current, part); names.push(current); }
      if (names.length > 128) fail(code);
      const captured = chains.get(root), observed = [];
      for (let index = 0; index < names.length; index++) {
        const stat = await step(lstat(names[index], { bigint: true }));
        if (!stat.isDirectory() || stat.isSymbolicLink() || (captured && !same(captured[index], stat))) fail(code);
        observed.push(stat);
      }
      if (await step(realpath(root)) !== root || !same(observed.at(-1), expected)) fail(code);
      if (!captured) chains.set(root, observed);
      return observed.at(-1);
    }
    async function ownedStage(empty = false) {
      const p = await ancestry(parent, request.stageGrant.parent, 'STAGE_OWNERSHIP_UNCERTAIN');
      const s = await ancestry(stage, request.stageGrant.identity, 'STAGE_OWNERSHIP_UNCERTAIN');
      // POSIX metadata is an additional refusal check, never a Windows ACL claim.
      if (!privateDirectory(p) || !privateDirectory(s)) fail('STAGE_OWNERSHIP_UNCERTAIN');
      if (empty && (await step(readdir(stage))).length) fail('STAGE_OWNERSHIP_UNCERTAIN');
      return s;
    }
    async function hashHandle(fileHandle, size) {
      const hash = createHash('sha256'), buffer = Buffer.alloc(64 * 1024);
      let position = 0;
      while (position < size) {
        const { bytesRead } = await step(fileHandle.read(buffer, 0, Math.min(buffer.length, size - position), position));
        if (!bytesRead) fail(phase);
        hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
      return hash.digest('hex');
    }
    async function verifierAncestry(relative, observed = resources) {
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      const parts = relative.split('/').slice(0, -1);
      for (let index = 0; index <= parts.length; index++) {
        const full = path.join(verifierRoot, ...parts.slice(0, index));
        const stat = await step(lstat(full, { bigint: true }));
        if (!stat.isDirectory() || stat.isSymbolicLink() || !same(observed.get(full), stat)) fail('STAGE_RESOURCE_INVALID');
      }
    }
    async function verifyResource() {
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      if (canonical((await step(readdir(resource))).sort()) !== canonical(['payload.tgz', 'verifier'])) fail('STAGE_RESOURCE_INVALID');
      const root = path.join(resource, 'verifier'), records = [], observed = new Map();
      const dirs = ['', ...new Set(verifierNames.flatMap(name => {
        const parts = name.split('/'); return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join('/'));
      }))];
      // Check every directory/ancestor before descending; no resource JS is loaded.
      for (const relative of dirs) {
        if (relative) await verifierAncestry(relative, observed);
        else await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
        const full = path.join(root, relative);
        const stat = await step(lstat(full, { bigint: true }));
        if (!stat.isDirectory() || stat.isSymbolicLink() || (resources.has(full) && !same(resources.get(full), stat))) fail('STAGE_RESOURCE_INVALID');
        observed.set(full, stat);
        const children = new Set(verifierNames.filter(name => !relative || name.startsWith(`${relative}/`)).map(name => name.slice(relative ? relative.length + 1 : 0).split('/')[0]));
        if (canonical((await step(readdir(full))).sort()) !== canonical([...children].sort())) fail('STAGE_RESOURCE_INVALID');
      }
      let total = 0n;
      for (const name of verifierNames) {
        await verifierAncestry(name, observed);
        const full = path.join(root, name), before = await step(lstat(full, { bigint: true }));
        total += before.size;
        if (!before.isFile() || before.nlink !== 1n || before.size > 32n * 1024n * 1024n || total > 256n * 1024n * 1024n || (resources.has(full) && !physicalSame(resources.get(full), before))) fail('STAGE_RESOURCE_INVALID');
        let dataHandle, error;
        try {
          await verifierAncestry(name, observed);
          dataHandle = await open(full, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); check();
          if (!physicalSame(before, await step(dataHandle.stat({ bigint: true })))) fail('STAGE_RESOURCE_INVALID');
          const sha256 = await hashHandle(dataHandle, Number(before.size));
          if (!physicalSame(before, await step(dataHandle.stat({ bigint: true })))) fail('STAGE_RESOURCE_INVALID');
          await verifierAncestry(name, observed);
          if (!physicalSame(before, await step(lstat(full, { bigint: true })))) fail('STAGE_RESOURCE_INVALID');
          records.push({ path: name, bytes: Number(before.size), executable: !!(before.mode & 0o111n), sha256 });
          observed.set(full, before);
        } catch (cause) { error = cause; throw cause; }
        finally {
          if (dataHandle) try { await dataHandle.close(); } catch (cleanup) { if (error) cleanupErrors.push(cleanup); else fail('STAGE_RESOURCE_INVALID', cleanup); }
        }
        check();
      }
      // Match the fixed inventory's lexical directory traversal.
      records.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
      if (digest(canonical(records)) !== request.sdkIdentity.verifierSha256) fail('STAGE_RESOURCE_INVALID');
      for (const [full, before] of observed) {
        const relative = path.relative(root, full);
        if (relative) await verifierAncestry(relative, observed);
        else await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
        const after = await step(lstat(full, { bigint: true }));
        if (before.isDirectory() ? !same(before, after) || !after.isDirectory() : !physicalSame(before, after)) fail('STAGE_RESOURCE_INVALID');
      }
      if (!resources.size) for (const [full, stat] of observed) resources.set(full, stat);
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
    }
    try {
      await verifyResource(); check();
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage(true); check();
      phase = 'STAGE_RESOURCE_INVALID';
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      before = await step(lstat(file, { bigint: true }));
      if (!before.isFile() || before.nlink !== 1n || before.size !== BigInt(request.sdkIdentity.capsule.bytes)) fail(phase);
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); check();
      async function sourceUnchanged(hash = false) {
        await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
        const opened = await step(handle.stat({ bigint: true }));
        await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
        const named = await step(lstat(file, { bigint: true }));
        if (!opened.isFile() || opened.nlink !== 1n || named.nlink !== 1n || !physicalSame(before, opened) || !physicalSame(before, named)) fail('STAGE_RESOURCE_INVALID');
        if (hash) {
          if (await hashHandle(handle, request.sdkIdentity.capsule.bytes) !== request.sdkIdentity.capsule.sha256 ||
            !physicalSame(before, await step(handle.stat({ bigint: true })))) fail('STAGE_RESOURCE_INVALID');
          await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
          if (!physicalSame(before, await step(lstat(file, { bigint: true })))) fail('STAGE_RESOURCE_INVALID');
        }
      }
      await sourceUnchanged(true); check();
      await validateProductSdkCapsuleArchive(handle, request.sdkIdentity.capsule.bytes, tar); check();
      await sourceUnchanged(); check();
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage(true); check();
      phase = 'STAGE_COPY_FAILED';
      const copy = path.join(stage, '.capsule-input.tgz');
      let copyHandle, copyStat, output, closed, copyPrimary;
      try {
        copyHandle = await open(copy, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        // Once opened, close is owned even if cancellation happened at this await.
        copyStat = await copyHandle.stat({ bigint: true });
        check();
        output = copyHandle.createWriteStream({ autoClose: true });
        // Native WriteStream._destroy waits for its outstanding write before
        // closing the descriptor. Its callback can replace an operation error
        // with a distinct close error: retain both channels before pipeline
        // reduces them to one rejection, and preserve the original operation.
        const destroy = output._destroy;
        output._destroy = function (operationError, done) {
          destroy.call(this, operationError, closeError => {
            if (operationError && closeError && closeError !== operationError) cleanupErrors.push(closeError);
            done(operationError ?? closeError);
          });
        };
        closed = new Promise(resolve => output.once('close', resolve));
        const hash = createHash('sha256'); let bytes = 0;
        const tap = new Transform({ transform(chunk, encoding, done) {
          try { check(); bytes += chunk.length; if (bytes > request.sdkIdentity.capsule.bytes) fail('STAGE_COPY_FAILED'); hash.update(chunk); done(null, chunk); }
          catch (error) { done(error); }
        } });
        let copyError;
        try { await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: request.sdkIdentity.capsule.bytes - 1 }), tap, output); }
        catch (error) { copyError = error; }
        finally { await closed; }
        if (copyError) throw copyError;
        check();
        if (bytes !== request.sdkIdentity.capsule.bytes || hash.digest('hex') !== request.sdkIdentity.capsule.sha256) fail('STAGE_COPY_FAILED');
      } catch (error) { copyPrimary = error; throw error; }
      finally {
        if (copyHandle && !output) try { await copyHandle.close(); } catch (cleanup) {
          if (copyPrimary) cleanupErrors.push(cleanup); else throw cleanup;
        }
      }
      // Bind the bytes actually on disk after writable close, not just bytes
      // observed upstream of the writer. The copy remains private and retained
      // on any uncertainty; never repair or remove a replacement.
      await ownedStage(); check();
      const copied = await step(lstat(copy, { bigint: true }));
      if (!copied.isFile() || copied.nlink !== 1n || !same(copyStat, copied) || copied.size !== BigInt(request.sdkIdentity.capsule.bytes)) fail('STAGE_COPY_FAILED');
      let copiedHandle, copiedError;
      try {
        copiedHandle = await open(copy, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0)); check();
        if (!physicalSame(copied, await step(copiedHandle.stat({ bigint: true }))) ||
          await hashHandle(copiedHandle, request.sdkIdentity.capsule.bytes) !== request.sdkIdentity.capsule.sha256 ||
          !physicalSame(copied, await step(copiedHandle.stat({ bigint: true })))) fail('STAGE_COPY_FAILED');
        await ownedStage(); check();
        if (!physicalSame(copied, await step(lstat(copy, { bigint: true })))) fail('STAGE_COPY_FAILED');
      } catch (error) { copiedError = error; throw error; }
      finally {
        if (copiedHandle) try { await copiedHandle.close(); } catch (cleanup) {
          if (copiedError) cleanupErrors.push(cleanup); else throw cleanup;
        }
      }
      copyStat = copied; check();
      await sourceUnchanged(); check();
      async function ownedCopy() {
        await ownedStage();
        const stat = await step(lstat(copy, { bigint: true }));
        if (!stat.isFile() || stat.nlink !== 1n || !physicalSame(stat, copyStat) || stat.size !== BigInt(request.sdkIdentity.capsule.bytes)) fail('STAGE_CLEANUP_UNCERTAIN');
      }
      phase = 'STAGE_CLEANUP_UNCERTAIN'; await ownedCopy(); check();
      phase = 'STAGE_EXTRACT_FAILED';
      tar.x({ file: copy, cwd: stage, sync: true, strict: true, umask: 0, preserveOwner: false });
      check();
      phase = 'STAGE_CLEANUP_UNCERTAIN'; await ownedCopy(); check();
      await step(unlink(copy));
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage(); check();
      phase = 'STAGE_VERIFY_FAILED';
      const manifest = await verify(stage, request.sdkIdentity.manifestSha256); check();
      if (manifest.inputSha256 !== request.sdkIdentity.inputSha256 || manifest.lockSha256 !== request.sdkIdentity.lockSha256 ||
        canonical(manifest.target) !== canonical(request.sdkIdentity.target) || sdkConsumerMode(manifest.target, manifest.lockSha256) !== request.sdkIdentity.consumerMode) fail(phase);
      phase = 'STAGE_RESOURCE_INVALID'; await sourceUnchanged(true); await verifyResource(); await sourceUnchanged(); check();
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage(); check();
    } catch (cause) {
      primary = phaseError(cause);
    } finally {
      if (handle) try { await handle.close(); } catch (cleanup) {
        if (primary) cleanupErrors.push(cleanup);
        else primary = Object.assign(new Error('STAGE_HANDLE_CLOSE_FAILED', { cause: cleanup }), { code: 'STAGE_HANDLE_CLOSE_FAILED' });
      }
    }
    if (primary) {
      if (cleanupErrors.length) Object.defineProperty(primary, 'cleanupErrors', { value: Object.freeze(cleanupErrors) });
      throw primary;
    }
    try {
      check();
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage();
      phase = 'STAGE_RESOURCE_INVALID';
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      if (canonical((await step(readdir(resource))).sort()) !== canonical(['payload.tgz', 'verifier'])) fail(phase);
      // Final close may have awaited arbitrary owned I/O. Retain the previously
      // hashed physical observations and revalidate names after that close,
      // without reopening descriptors or reusing pre-close ownership as success.
      for (const [full, captured] of resources) {
        const relative = path.relative(verifierRoot, full);
        if (relative) await verifierAncestry(relative);
        else await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
        const current = await step(lstat(full, { bigint: true }));
        if (captured.isDirectory()) {
          if (!current.isDirectory() || !same(captured, current)) fail(phase);
          const children = new Set(verifierNames.filter(name => !relative || name.startsWith(`${relative}/`)).map(name => name.slice(relative ? relative.length + 1 : 0).split('/')[0]));
          if (canonical((await step(readdir(full))).sort()) !== canonical([...children].sort())) fail(phase);
        } else if (!current.isFile() || current.nlink !== 1n || !physicalSame(captured, current)) fail(phase);
      }
      await ancestry(resource, request.resourceIdentity, 'STAGE_RESOURCE_INVALID');
      const current = await step(lstat(file, { bigint: true }));
      if (!current.isFile() || current.nlink !== 1n || !physicalSame(before, current)) fail(phase);
      phase = 'STAGE_OWNERSHIP_UNCERTAIN'; await ownedStage(); check();
      return admitStageDecodeResult({ schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: request.generation,
        stageIdentity: request.stageGrant.identity, capsuleSha256: request.sdkIdentity.capsule.sha256,
        manifestSha256: request.sdkIdentity.manifestSha256, verifierSha256: request.sdkIdentity.verifierSha256 }, request);
    } catch (cause) { throw phaseError(cause); }
  });
}
