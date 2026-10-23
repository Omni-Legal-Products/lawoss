import '../build/plugin-payload/network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp, { chmod, copyFile, link, lstat, mkdir, readFile, readdir, rename, symlink, writeFile } from 'node:fs/promises';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { metadata, hostTarget, owned, fixture, receipt } from '../build/plugin-payload/embedded-runtime-verifier-fixture.mjs';
import { canonical, inventory, SDK_LOCK_SHA256, sdkConsumerMode, sha256 } from '../build/plugin-payload/validate.mjs';
import { admitStageDecodeRequest, admitStageDecodeResult } from './sdk-stage-decoder-contract.mjs';
import { createProductSdkStageDecoder } from './sdk-stage-decoder-core.mjs';

const toolsRequire = createRequire(new URL('../build/plugin-payload/tools/package.json', import.meta.url));
const arboristRequire = createRequire(toolsRequire.resolve('@npmcli/arborist/package.json'));
assert.equal(arboristRequire('tar/package.json').version, '7.5.22');
const tar = arboristRequire('tar');
const names = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md', 'sdk/notices/licenses/opencode-MIT.txt',
  'sdk/notices/licenses/msgpackr-extract-MIT.txt', 'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
const id = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const clone = value => structuredClone(value);
const decoder = () => createProductSdkStageDecoder({ tar, ...metadata });
async function setup(t, change) {
  const f = await fixture(t);
  if (change) await change(f);
  const manifestSha256 = await receipt(f), base = await owned(t);
  const resourceRoot = path.join(base, 'resource'), parent = path.join(base, 'parent'), stage = path.join(parent, 'stage');
  await mkdir(resourceRoot); await mkdir(parent, { mode: 0o700 }); await mkdir(stage, { mode: 0o700 });
  const verifier = path.join(resourceRoot, 'verifier');
  for (const name of names) {
    const target = path.join(verifier, name); await mkdir(path.dirname(target), { recursive: true });
    await copyFile(new URL(`../build/plugin-payload/${name}`, import.meta.url), target);
  }
  const capsule = path.join(resourceRoot, 'payload.tgz');
  tar.c({ cwd: f.root, file: capsule, gzip: true, sync: true, portable: true, noMtime: true }, ['.']);
  const bytes = await readFile(capsule);
  const request = { schema: 1, kind: 'lawoss-sdk-stage-decode', generation: 'a'.repeat(32), resourceRoot,
    resourceIdentity: id(await lstat(resourceRoot, { bigint: true })),
    stageGrant: { path: stage, identity: id(await lstat(stage, { bigint: true })), parent: { path: parent, ...id(await lstat(parent, { bigint: true })) } },
    sdkIdentity: { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', manifestSha256,
      target: hostTarget, lockSha256: SDK_LOCK_SHA256, inputSha256: sha256(metadata.acceptedInputText),
      // Synthetic fixture provenance only, never application/native authentication.
      sourceSetSha256: sha256(canonical(await inventory(f.root))), consumerMode: sdkConsumerMode(hostTarget, SDK_LOCK_SHA256),
      verifierSha256: sha256(canonical(await inventory(verifier))),
      capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: sha256(bytes), bytes: bytes.length } }, deadline: Date.now() + 60000 };
  return { f, request, stage, parent, resourceRoot, capsule, verifier, bytes };
}
const invalid = { code: 'STAGE_REQUEST_INVALID' };

test('own-data admission rejects hostile schema and shared capsule identity before use', async t => {
  const f = await setup(t), original = f.request;
  let getters = 0;
  const accessor = clone(original); Object.defineProperty(accessor, 'generation', { enumerable: true, get() { getters++; } });
  const hidden = clone(original); Object.defineProperty(hidden, 'hidden', { value: 1 });
  const cycle = clone(original); cycle.resourceIdentity.loop = cycle;
  const mutations = [r => { r.extra = 1; }, r => { r[Symbol('extra')] = 1; }, r => { r.generation = 'A'.repeat(32); },
    r => { r.resourceIdentity.ino = '0'; }, r => { r.resourceIdentity.dev = '01'; }, r => { r.resourceIdentity.ino = '1'.repeat(41); },
    r => { r.stageGrant.path = 'relative'; }, r => { r.resourceRoot += '/..'; }, r => { r.resourceRoot = '/' + 'x'.repeat(4096); },
    r => { r.resourceRoot += '\0'; }, r => { r.resourceIdentity.ino = 1; }, r => { r.sdkIdentity.lockSha256 = '0'.repeat(64); },
    r => { r.sdkIdentity.consumerMode = 'unsupported'; }, r => { r.sdkIdentity.target.arch = 'unknown'; },
    r => { r.sdkIdentity.capsule.sha256 = 'G'.repeat(64); }, r => { r.deadline = Date.now() + 2 ** 31 + 10000; },
    r => { r.deadline = Infinity; }, r => { r.resourceIdentity.extra = 'é'.repeat(17000); },
    r => { let next = r.resourceIdentity; for (let i = 0; i < 9; i++) next = next.child = {}; },
    r => { for (let i = 0; i < 260; i++) r.resourceIdentity[i] = i; }];
  for (const value of [accessor, hidden, cycle, ...mutations.map(change => { const r = clone(original); change(r); return r; })]) {
    assert.throws(() => admitStageDecodeRequest(value), invalid);
    await assert.rejects(decoder()(value), invalid);
  }
  assert.equal(getters, 0);
  const admitted = admitStageDecodeRequest(original);
  assert.ok(Object.isFrozen(admitted.sdkIdentity.target));
  original.resourceIdentity.ino = '999';
  assert.notEqual(admitted.resourceIdentity.ino, '999');
  assert.deepEqual(await readdir(f.stage), []);
});

test('closed result binds generation, physical stage and all external digests', async t => {
  const { request } = await setup(t), admitted = admitStageDecodeRequest(request);
  const result = { schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: request.generation,
    stageIdentity: request.stageGrant.identity, capsuleSha256: request.sdkIdentity.capsule.sha256,
    manifestSha256: request.sdkIdentity.manifestSha256, verifierSha256: request.sdkIdentity.verifierSha256 };
  assert.ok(Object.isFrozen(admitStageDecodeResult(result, admitted).stageIdentity));
  for (const change of [r => { r.extra = 1; }, r => { r.generation = 'b'.repeat(32); }, r => { r.stageIdentity.ino = '2'; },
    r => { r.capsuleSha256 = '0'.repeat(64); }, r => { r.manifestSha256 = '0'.repeat(64); }, r => { r.verifierSha256 = '0'.repeat(64); }]) {
    const bad = clone(result); change(bad); assert.throws(() => admitStageDecodeResult(bad, admitted), invalid);
  }
});

test('actual Node22 accepted tar safeList/extraction/fixed verifier returns a stage and preserves sources', async t => {
  assert.equal(process.version, 'v22.23.2'); assert.equal(process.versions.bun, undefined);
  const f = await setup(t), resourceRecords = await inventory(f.resourceRoot), before = canonical(resourceRecords), payloadRecords = await inventory(f.f.root);
  const result = await decoder()(f.request);
  assert.deepEqual(result, { schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: 'a'.repeat(32),
    stageIdentity: f.request.stageGrant.identity, capsuleSha256: sha256(f.bytes), manifestSha256: f.request.sdkIdentity.manifestSha256,
    verifierSha256: f.request.sdkIdentity.verifierSha256 });
  assert.equal(canonical(await inventory(f.resourceRoot)), before);
  assert.deepEqual(await readFile(f.capsule), f.bytes);
  assert.equal(await readFile(path.join(f.stage, 'node_modules/@opencode-ai/plugin/index.js'), 'utf8'), "throw Error('Inert SDK fixture must never execute');\n");
  assert.deepEqual(await readdir(f.parent), ['stage']);
  assert.equal((await readdir(f.stage)).includes('.capsule-input.tgz'), false);
  const stageRecords = await inventory(f.stage);
  assert.deepEqual(stageRecords, payloadRecords);
  assert.equal(canonical(await inventory(f.f.root)), canonical(payloadRecords));
  t.diagnostic(JSON.stringify({ kind: 'inert-stage-data-witness', runtime: process.version, target: hostTarget,
    generation: result.generation, stageIdentity: result.stageIdentity, resourceRecords, stageRecords, result }));
  assert.deepEqual(await readdir(path.dirname(f.resourceRoot)), ['parent', 'resource']);
});

test('preaborted, expired and invalid options refuse before filesystem writes', async t => {
  const f = await setup(t), abort = new AbortController(); abort.abort();
  await assert.rejects(decoder()(f.request, { signal: abort.signal }), { code: 'STAGE_ABORTED' });
  const past = { ...f.request, deadline: Date.now() - 1 };
  assert.throws(() => admitStageDecodeRequest(past), { code: 'STAGE_DEADLINE' });
  await assert.rejects(decoder()(past), { code: 'STAGE_DEADLINE' });
  await assert.rejects(decoder()(f.request, { extra: 1 }), invalid);
  await assert.rejects(decoder()(f.request, { signal: {} }), invalid);
  assert.deepEqual(await readdir(f.stage), []);
});

for (const [label, mutate, code] of [
  ['nonempty stage', f => writeFile(path.join(f.stage, 'keep'), 'successor'), 'STAGE_OWNERSHIP_UNCERTAIN'],
  ['private mode', f => chmod(f.parent, 0o755), 'STAGE_OWNERSHIP_UNCERTAIN'],
  ['stage identity', f => { f.request.stageGrant.identity.ino = '2'; }, 'STAGE_OWNERSHIP_UNCERTAIN'],
  ['resource identity', f => { f.request.resourceIdentity.ino = '2'; }, 'STAGE_RESOURCE_INVALID'],
  ['overlap', f => { f.request.stageGrant.path = f.resourceRoot; }, 'STAGE_OWNERSHIP_UNCERTAIN'],
  ['hardlinked capsule', f => link(f.capsule, path.join(f.parent, 'link')), 'STAGE_RESOURCE_INVALID'],
  ['resource JS mismatch', f => writeFile(path.join(f.verifier, 'validate.mjs'), "throw Error('never execute');"), 'STAGE_RESOURCE_INVALID'],
  ['extra resource file', f => writeFile(path.join(f.resourceRoot, 'extra'), 'x'), 'STAGE_RESOURCE_INVALID'],
  ['symlink stage', async f => { await rename(f.stage, f.stage + '-kept'); await symlink(f.stage + '-kept', f.stage); }, 'STAGE_OWNERSHIP_UNCERTAIN'],
  ['host target', f => { f.request.sdkIdentity.target = { platform: 'win32', arch: process.arch === 'arm64' ? 'x64' : 'arm64' }; f.request.sdkIdentity.consumerMode = sdkConsumerMode(f.request.sdkIdentity.target, SDK_LOCK_SHA256); }, 'STAGE_TARGET_MISMATCH'],
]) test(`refuses ${label} while retaining attributed and successor data`, async t => {
  const f = await setup(t); await mutate(f);
  await assert.rejects(decoder()(f.request), { code });
  assert.deepEqual(await readFile(f.capsule), f.bytes);
});

test('delegated malformed archive refuses without extracting', async t => {
  const f = await setup(t); await writeFile(path.join(f.f.root, '.capsule-input.tgz'), 'reserved archive path');
  tar.c({ cwd: f.f.root, file: f.capsule, gzip: true, sync: true, portable: true, noMtime: true }, ['.']);
  const bytes = await readFile(f.capsule);
  f.request.sdkIdentity.capsule = { ...f.request.sdkIdentity.capsule, bytes: bytes.length, sha256: sha256(bytes) };
  await assert.rejects(decoder()(f.request), { code: 'PRODUCT_SDK_CAPSULE_INVALID' });
  assert.deepEqual(await readdir(f.stage), []);
});

test('actual embedded verifier refuses corrupted payload and retains partial stage', async t => {
  const f = await setup(t, async f => { f.manifest.files = []; });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_VERIFY_FAILED' });
  assert.ok((await readdir(f.stage)).includes('payload-manifest.json'));
});

const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function observeOpen(t, intercept) {
  const original = fsp.open;
  fsp.open = async (file, ...args) => {
    const handle = await original(file, ...args);
    await intercept(String(file), handle, args);
    return handle;
  };
  syncBuiltinESMExports();
  t.after(() => { fsp.open = original; syncBuiltinESMExports(); });
}

test('copy bytes changed at actual writable close refuse before extraction', async t => {
  const f = await setup(t), copy = path.join(f.stage, '.capsule-input.tgz');
  await observeOpen(t, (file, handle) => {
    if (file !== copy) return;
    const create = handle.createWriteStream.bind(handle);
    handle.createWriteStream = options => {
      const output = create(options), destroy = output._destroy;
      output._destroy = function (error, done) {
        destroy.call(this, error, async cleanup => {
          try { const changed = Buffer.from(f.bytes); changed[changed.length - 1] ^= 1; await writeFile(copy, changed); done(cleanup); }
          catch (fault) { done(fault); }
        });
      };
      return output;
    };
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_COPY_FAILED' });
  assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz']);
});

test('abort while real writable close is held waits for drain, close and capsule close', async t => {
  const f = await setup(t), controller = new AbortController(), held = deferred(), release = deferred(), events = [];
  let capsule, copyHandle;
  await observeOpen(t, (file, handle) => {
    if (file === f.capsule) {
      capsule = handle; const close = handle.close.bind(handle);
      handle.close = async () => { const wasOpen = handle.fd !== -1; await close(); if (wasOpen && !events.includes('capsule-close')) events.push('capsule-close'); };
    }
    if (file !== path.join(f.stage, '.capsule-input.tgz')) return;
    copyHandle = handle; const create = handle.createWriteStream.bind(handle);
    handle.createWriteStream = options => {
      const output = create(options), destroy = output._destroy;
      output.once('close', () => events.push('writable-close'));
      output._destroy = function (error, done) {
        destroy.call(this, error, cleanup => { events.push('descriptor-closed'); held.resolve(); release.promise.then(() => done(cleanup)); });
      };
      return output;
    };
  });
  let settled = false;
  const pending = decoder()(f.request, { signal: controller.signal });
  const observed = pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await held.promise; assert.equal(copyHandle.fd, -1); controller.abort();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.notEqual(capsule.fd, -1);
    release.resolve();
    await assert.rejects(pending, { code: 'STAGE_ABORTED' }); await observed;
    assert.deepEqual(events, ['descriptor-closed', 'writable-close', 'capsule-close']);
    t.diagnostic(JSON.stringify({ kind: 'actual-close-witness', events, copyFd: copyHandle.fd, capsuleFd: capsule.fd, settled }));
    assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz']);
  } finally { release.resolve(); await observed; }
});

for (const reason of ['abort', 'deadline']) test(`${reason} during a held real capsule read joins work and closes before settlement`, async t => {
  const f = await setup(t), controller = new AbortController(), held = deferred(), release = deferred();
  let handle, started = false, closed = false;
  await observeOpen(t, (file, opened) => {
    if (file !== f.capsule) return;
    handle = opened; const read = handle.read.bind(handle), close = handle.close.bind(handle);
    handle.close = async () => { await close(); closed = true; };
    handle.read = async (...args) => { const value = await read(...args); if (!started) { started = true; held.resolve(); await release.promise; } return value; };
  });
  if (reason === 'deadline') f.request.deadline = Date.now() + 120;
  let settled = false;
  const pending = decoder()(f.request, { signal: controller.signal });
  const observed = pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await held.promise;
    if (reason === 'abort') controller.abort();
    else await new Promise(resolve => setTimeout(resolve, 150));
    assert.equal(settled, false); assert.equal(closed, false);
    release.resolve();
    await assert.rejects(pending, { code: reason === 'abort' ? 'STAGE_ABORTED' : 'STAGE_DEADLINE' }); await observed;
    assert.equal(closed, true); assert.equal(handle.fd, -1); assert.deepEqual(await readdir(f.stage), []);
  } finally { release.resolve(); await observed; }
});

for (const replaceParent of [false, true]) test(`retains successor ${replaceParent ? 'parent and stage' : 'stage'} substituted while capsule work is held`, async t => {
  const f = await setup(t); let changed = false;
  await observeOpen(t, (file, handle) => {
    if (file !== f.capsule) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await read(...args);
      if (!changed) {
        changed = true;
        const target = replaceParent ? f.parent : f.stage;
        await rename(target, target + '-retained'); await mkdir(target, { mode: 0o700 });
        if (replaceParent) await mkdir(f.stage, { mode: 0o700 });
        await writeFile(path.join(f.stage, 'successor'), 'retain');
      }
      return result;
    };
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_OWNERSHIP_UNCERTAIN' });
  assert.deepEqual(await readdir(f.stage), ['successor']);
  assert.equal(await readFile(path.join(f.stage, 'successor'), 'utf8'), 'retain');
});

test('changing original capsule physical metadata refuses before stage mutation', async t => {
  const f = await setup(t); let changed = false;
  await observeOpen(t, (file, handle) => {
    if (file !== f.capsule) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => { const value = await read(...args); if (!changed) { changed = true; await writeFile(f.capsule, f.bytes); } return value; };
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_RESOURCE_INVALID' });
  assert.deepEqual(await readdir(f.stage), []);
});

test('source close failure cannot publish success and simultaneous primary failure is retained', async t => {
  for (const alsoReadFailure of [false, true]) {
    const f = await setup(t), original = fsp.open;
    const readFault = new Error('inert read fault'), closeFault = new Error('inert close fault');
    let closed = false;
    fsp.open = async (file, ...args) => {
      const handle = await original(file, ...args);
      if (String(file) === f.capsule) {
        const close = handle.close.bind(handle);
        handle.close = async () => { await close(); closed = true; throw closeFault; };
        if (alsoReadFailure) handle.read = async () => { throw readFault; };
      }
      return handle;
    };
    syncBuiltinESMExports();
    try {
      await assert.rejects(decoder()(f.request), error => {
        assert.equal(error.code, alsoReadFailure ? 'STAGE_RESOURCE_INVALID' : 'STAGE_HANDLE_CLOSE_FAILED');
        assert.equal(error.cause, alsoReadFailure ? readFault : closeFault);
        if (alsoReadFailure) assert.deepEqual(error.cleanupErrors, [closeFault]);
        assert.equal(closed, true); return true;
      });
    } finally { fsp.open = original; syncBuiltinESMExports(); }
  }
});

test('real writable failure settles close and retains copy and primary cause', async t => {
  const f = await setup(t), fault = new Error('inert output fault'); let closed = false;
  await observeOpen(t, (file, handle) => {
    if (file !== path.join(f.stage, '.capsule-input.tgz')) return;
    const create = handle.createWriteStream.bind(handle);
    handle.createWriteStream = options => {
      const output = create(options);
      output._write = (chunk, encoding, done) => done(fault);
      output.once('close', () => { closed = true; }); return output;
    };
  });
  await assert.rejects(decoder()(f.request), error => { assert.equal(error.code, 'STAGE_COPY_FAILED'); assert.equal(error.cause, fault); assert.equal(closed, true); return true; });
  assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz']);
});

test('real synchronous extractor read failure is phase-mapped and retained', async t => {
  const f = await setup(t), original = fs.openSync, fault = new Error('inert extraction fault');
  fs.openSync = (file, ...args) => { if (String(file) === path.join(f.stage, '.capsule-input.tgz')) throw fault; return original(file, ...args); };
  syncBuiltinESMExports();
  try { await assert.rejects(decoder()(f.request), error => { assert.equal(error.code, 'STAGE_EXTRACT_FAILED'); assert.equal(error.cause, fault); return true; }); }
  finally { fs.openSync = original; syncBuiltinESMExports(); }
  assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz']);
});

test('owned-copy unlink failure retains copy and maps cleanup uncertainty', async t => {
  const f = await setup(t), original = fsp.unlink, fault = new Error('inert unlink fault');
  fsp.unlink = async file => { if (String(file) === path.join(f.stage, '.capsule-input.tgz')) throw fault; return original(file); };
  syncBuiltinESMExports();
  try { await assert.rejects(decoder()(f.request), { code: 'STAGE_CLEANUP_UNCERTAIN' }); }
  finally { fsp.unlink = original; syncBuiltinESMExports(); }
  assert.ok((await readdir(f.stage)).includes('.capsule-input.tgz'));
});

test('resource ancestor substitution stops before opening any redirected descendant', async t => {
  const f = await setup(t), sdk = path.join(f.verifier, 'sdk'); let redirectedOpen = false, swapped = false;
  await observeOpen(t, async (file) => {
    if (file.startsWith(sdk + path.sep)) redirectedOpen = true;
    if (file === path.join(f.verifier, 'notices.mjs') && !swapped) {
      swapped = true; await rename(sdk, path.join(f.parent, 'retained-sdk')); await symlink(path.join(f.parent, 'retained-sdk'), sdk);
    }
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_RESOURCE_INVALID' });
  assert.equal(redirectedOpen, false);
  assert.deepEqual(await readdir(f.stage), []);
});

test('unexpected actual gzip failure maps to current finite phase and keeps local cause', async t => {
  const f = await setup(t), bytes = Buffer.from('invalid gzip inert fixture'); await writeFile(f.capsule, bytes);
  f.request.sdkIdentity.capsule = { ...f.request.sdkIdentity.capsule, bytes: bytes.length, sha256: sha256(bytes) };
  await assert.rejects(decoder()(f.request), error => { assert.equal(error.code, 'STAGE_RESOURCE_INVALID'); assert.equal(error.cause.code, 'Z_DATA_ERROR'); return true; });
  assert.deepEqual(await readdir(f.stage), []);
});

test('cancellation during explicit capsule close remains pending until actual close', async t => {
  const f = await setup(t), held = deferred(), release = deferred(), controller = new AbortController();
  let descriptor, closing = false, closed = false;
  await observeOpen(t, (file, handle) => {
    if (file !== f.capsule) return;
    descriptor = handle; const close = handle.close.bind(handle);
    handle.close = async () => {
      if (!closing && handle.fd !== -1) { closing = true; held.resolve(); await release.promise; }
      await close(); closed = true;
    };
  });
  let settled = false;
  const pending = decoder()(f.request, { signal: controller.signal });
  const observed = pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    await held.promise; controller.abort(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(settled, false); assert.equal(closed, false); assert.notEqual(descriptor.fd, -1);
    release.resolve(); await assert.rejects(pending, { code: 'STAGE_ABORTED' }); await observed;
    assert.equal(closed, true); assert.equal(descriptor.fd, -1);
  } finally { release.resolve(); await observed; }
});

test('constructor accepts only fixed composition and options never invoke accessors', async t => {
  const f = await setup(t); let getters = 0;
  const accessor = { tar, ...metadata };
  Object.defineProperty(accessor, 'tar', { enumerable: true, get() { getters++; return tar; } });
  for (const config of [accessor, { tar, ...metadata, verifier() {} }, { tar, ...metadata, limits: {} }, { tar, ...metadata, acceptedLockText: '{}' }]) {
    assert.throws(() => createProductSdkStageDecoder(config), invalid);
  }
  const options = {};
  Object.defineProperty(options, 'signal', { enumerable: true, get() { getters++; return undefined; } });
  await assert.rejects(decoder()(f.request, options), invalid);
  assert.equal(getters, 0); assert.deepEqual(await readdir(f.stage), []);
});

test('physical IDs preserve values beyond numeric precision without rounding or coercion', async t => {
  const { request } = await setup(t);
  request.resourceIdentity = { dev: '18446744073709551614', ino: '18446744073709551615' };
  const admitted = admitStageDecodeRequest(request);
  assert.deepEqual(JSON.parse(JSON.stringify(admitted)).resourceIdentity, request.resourceIdentity);
  await assert.rejects(decoder()(request), { code: 'STAGE_RESOURCE_INVALID' });
});

test('a successor private copy is retained and never extracted or unlinked', async t => {
  const f = await setup(t), copy = path.join(f.stage, '.capsule-input.tgz'); let replaced = false;
  await observeOpen(t, (file, handle) => {
    if (file !== copy) return;
    const create = handle.createWriteStream.bind(handle);
    handle.createWriteStream = options => {
      const output = create(options), destroy = output._destroy;
      output._destroy = function (error, done) {
        destroy.call(this, error, async cleanup => {
          try { await rename(copy, copy + '-retained'); await writeFile(copy, 'successor bytes'); replaced = true; done(cleanup); }
          catch (fault) { done(fault); }
        });
      };
      return output;
    };
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_COPY_FAILED' });
  assert.equal(replaced, true); assert.equal(await readFile(copy, 'utf8'), 'successor bytes');
  assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz', '.capsule-input.tgz-retained']);
});

test('verifier directory substitution during initial enumeration stops before redirected stat', async t => {
  const f = await setup(t), originalRead = fsp.readdir, originalStat = fsp.lstat;
  let changed = false, redirectedStats = 0;
  fsp.readdir = async (file, ...args) => {
    const result = await originalRead(file, ...args);
    if (String(file) === f.verifier && !changed) {
      await rename(f.verifier, path.join(f.parent, 'retained-verifier'));
      await symlink(path.join(f.parent, 'retained-verifier'), f.verifier); changed = true;
    }
    return result;
  };
  fsp.lstat = async (file, ...args) => {
    if (changed && String(file).startsWith(f.verifier + path.sep)) redirectedStats++;
    return originalStat(file, ...args);
  };
  syncBuiltinESMExports();
  try {
    await assert.rejects(decoder()(f.request), { code: 'STAGE_RESOURCE_INVALID' });
    assert.equal(redirectedStats, 0);
  } finally { fsp.readdir = originalRead; fsp.lstat = originalStat; syncBuiltinESMExports(); }
});

test('physical capsule mutation during final rehash refuses despite unchanged content bytes', async t => {
  const f = await setup(t), originalUnlink = fsp.unlink; let extracted = false, changed = false;
  assert.ok(f.bytes.length <= 64 * 1024);
  fsp.unlink = async file => { const result = await originalUnlink(file); if (String(file) === path.join(f.stage, '.capsule-input.tgz')) extracted = true; return result; };
  syncBuiltinESMExports();
  t.after(() => { fsp.unlink = originalUnlink; syncBuiltinESMExports(); });
  await observeOpen(t, (file, handle) => {
    if (file !== f.capsule) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => {
      const result = await read(...args);
      if (extracted && !changed) { changed = true; await writeFile(f.capsule, f.bytes); }
      return result;
    };
  });
  await assert.rejects(decoder()(f.request), { code: 'STAGE_RESOURCE_INVALID' });
  assert.equal(changed, true);
});

test('a branded local signal cannot override its native aborted state with an own getter', async t => {
  const f = await setup(t), controller = new AbortController(); let getters = 0;
  Object.defineProperty(controller.signal, 'aborted', { get() { getters++; return false; } });
  controller.abort();
  await assert.rejects(decoder()(f.request, { signal: controller.signal }), { code: 'STAGE_ABORTED' });
  assert.equal(getters, 0); assert.deepEqual(await readdir(f.stage), []);
});

for (const replacement of ['stage', 'parent', 'resource', 'capsule', 'verifier-file']) test(`R1 final actual close rejects ${replacement} changes before success`, async t => {
  const f = await setup(t), held = deferred(), release = deferred(), events = [];
  let source, closing = false, reached = false, settled = false;
  await observeOpen(t, (file, handle) => {
    if (file !== f.capsule) return;
    source = handle; const close = handle.close.bind(handle);
    handle.close = async () => {
      if (!closing && handle.fd !== -1) { closing = true; reached = true; events.push('source-close-held'); held.resolve(); await release.promise; }
      await close(); if (handle.fd === -1 && !events.includes('source-closed')) events.push('source-closed');
    };
  });
  const pending = decoder()(f.request);
  const observed = pending.then(() => { settled = true; held.resolve(); }, () => { settled = true; held.resolve(); });
  let successor;
  try {
    await held.promise; assert.equal(reached, true); assert.equal(settled, false); assert.notEqual(source.fd, -1);
    if (['stage', 'parent', 'resource'].includes(replacement)) {
      const target = replacement === 'stage' ? f.stage : replacement === 'parent' ? f.parent : f.resourceRoot;
      await rename(target, target + '-retained'); await mkdir(target, { mode: 0o700 });
      successor = path.join(target, 'successor'); await writeFile(successor, 'keep successor bytes');
    } else {
      const target = replacement === 'capsule' ? f.capsule : path.join(f.verifier, 'notices.mjs');
      await writeFile(target, await readFile(target));
    }
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release.resolve();
    await assert.rejects(pending, { code: ['stage', 'parent'].includes(replacement) ? 'STAGE_OWNERSHIP_UNCERTAIN' : 'STAGE_RESOURCE_INVALID' });
    await observed; assert.equal(source.fd, -1); assert.deepEqual(events, ['source-close-held', 'source-closed']);
    if (successor) assert.equal(await readFile(successor, 'utf8'), 'keep successor bytes');
    t.diagnostic(JSON.stringify({ finding: 'R1', replacement, events, sourceFd: source.fd, settled }));
  } finally { release.resolve(); await observed; }
});

for (const replacement of ['verifier', 'resource']) test(`R2 held hash renews ${replacement} ancestors before any named descendant access`, async t => {
  const f = await setup(t), held = deferred(), release = deferred(), originalStat = fsp.lstat;
  const target = replacement === 'verifier' ? f.verifier : f.resourceRoot;
  const leaf = replacement === 'verifier' ? path.join(f.verifier, 'notices.mjs') : f.capsule;
  let changed = false, reached = false, redirectedStats = 0, redirectedOpens = 0;
  fsp.lstat = async (file, ...args) => { if (changed && String(file).startsWith(target + path.sep)) redirectedStats++; return originalStat(file, ...args); };
  syncBuiltinESMExports();
  t.after(() => { fsp.lstat = originalStat; syncBuiltinESMExports(); });
  await observeOpen(t, (file, handle) => {
    if (changed && file.startsWith(target + path.sep)) redirectedOpens++;
    if (file !== leaf) return;
    const read = handle.read.bind(handle);
    handle.read = async (...args) => { const result = await read(...args); if (!reached) { reached = true; held.resolve(); await release.promise; } return result; };
  });
  const pending = decoder()(f.request), observed = pending.then(() => held.resolve(), () => held.resolve());
  try {
    await held.promise; assert.equal(reached, true);
    await rename(target, path.join(f.parent, 'retained-' + replacement));
    await symlink(path.join(f.parent, 'retained-' + replacement), target); changed = true;
    release.resolve(); await assert.rejects(pending, { code: 'STAGE_RESOURCE_INVALID' }); await observed;
    assert.equal(redirectedStats, 0); assert.equal(redirectedOpens, 0);
    t.diagnostic(JSON.stringify({ finding: 'R2', replacement, redirectedStats, redirectedOpens }));
  } finally { release.resolve(); await observed; }
});

test('R3 distinct real write and copy-descriptor close failures retain both errors after actual close', async t => {
  const f = await setup(t), held = deferred(), release = deferred(), primaryFault = new Error('real-copy-write-primary'), closeFault = new Error('real-copy-close-cleanup');
  const events = []; let copyHandle, source, closeEntered = false, settled = false;
  await observeOpen(t, (file, handle) => {
    if (file === f.capsule) {
      source = handle; const close = handle.close.bind(handle);
      handle.close = async () => { await close(); if (!events.includes('source-closed')) events.push('source-closed'); };
    }
    if (file !== path.join(f.stage, '.capsule-input.tgz')) return;
    copyHandle = handle; const close = handle.close.bind(handle), create = handle.createWriteStream.bind(handle);
    handle.close = async () => {
      if (closeEntered || handle.fd === -1) return close();
      closeEntered = true; events.push('copy-close-held'); held.resolve(); await release.promise;
      await close(); events.push('copy-descriptor-closed'); throw closeFault;
    };
    handle.createWriteStream = options => {
      const output = create(options), write = output._write;
      output._write = function (chunk, encoding, done) {
        write.call(this, chunk, encoding, error => { events.push('real-write-completed'); done(error ?? primaryFault); });
      };
      output.once('close', () => events.push('writable-close')); return output;
    };
  });
  const pending = decoder()(f.request), observed = pending.then(() => { settled = true; held.resolve(); }, () => { settled = true; held.resolve(); });
  try {
    await held.promise; assert.equal(closeEntered, true); assert.equal(settled, false); assert.notEqual(copyHandle.fd, -1); assert.notEqual(source.fd, -1);
    await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
    release.resolve();
    await assert.rejects(pending, error => {
      assert.equal(error.code, 'STAGE_COPY_FAILED'); assert.equal(error.cause, primaryFault);
      assert.deepEqual(error.cleanupErrors, [closeFault]);
      assert.equal(copyHandle.fd, -1); assert.equal(source.fd, -1); return true;
    });
    await observed; assert.deepEqual(await readdir(f.stage), ['.capsule-input.tgz']);
    assert.ok(events.indexOf('copy-descriptor-closed') < events.indexOf('writable-close'));
    assert.ok(events.indexOf('writable-close') < events.indexOf('source-closed'));
    t.diagnostic(JSON.stringify({ finding: 'R3', events, primaryRetained: true, cleanupRetained: true, copyFd: copyHandle.fd, sourceFd: source.fd }));
  } finally { release.resolve(); await observed; }
});
