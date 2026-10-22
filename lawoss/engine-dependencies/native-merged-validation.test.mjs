import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import net from 'node:net';
import { collectMetadata } from './native-merged-cache-worker.mjs';
net.Socket.prototype.connect = function () { throw Error('TEST_NETWORK_FORBIDDEN'); };
test('decoded metadata crossing chunk refuses without Content-Length', async () => {
  const body = Readable.from([Buffer.alloc(4), Buffer.alloc(5)]);
  await assert.rejects(collectMetadata(body, { bytes: 0 }, { bodyBytes: 8, totalBytes: 20 }), { code: 'METADATA_BODY_LIMIT' });
  assert.equal(body.destroyed, true);
});

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCEPT, METADATA_LIMITS, VERSIONS, RUNTIME_LOCK, runtimeApis, namedArtifacts, metadataRequest, publicCode, active } from './native-merged-cache-worker.mjs';
import { validateAcquisition, failureReceipt, validateTap, sourceTestCount, ownedValidation, TEST_FILES, readOperationReceipt, failedTap, validationChild, retainAcquisition } from './native-merged-validation.mjs';
import { runChild, childEnvironment } from '../build/plugin-payload/prepare.mjs';
import { ACCEPTED } from '../build/plugin-payload/prime-cache.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const record = { name: 'synthetic', escapedName: 'synthetic', version: '1.0.0', resolved: 'https://registry.npmjs.org/synthetic/-/synthetic-1.0.0.tgz', integrity: 'sha512-synthetic' };
const metadata = () => ({ name: record.name, versions: { [record.version]: { name: record.name, version: record.version, dist: { tarball: record.resolved, integrity: record.integrity } } } });
const bytes = value => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
function request(fetch, changes = {}) {
  return metadataRequest({ fetch, cache: '/synthetic-owned-cache', record, accept: ACCEPT[0], budget: { bytes: 0 }, deadline: Date.now() + 3000, ...changes });
}
function response(value, status = 200) { return { status, body: Readable.from([bytes(value)]) }; }

test('default metadata budget accepts realistic 28 MiB valid streamed JSON', async () => {
  const value = metadata();
  const prefix = Buffer.from(JSON.stringify(value).slice(0, -1) + ',"padding":"');
  const chunk = Buffer.alloc(64 * 1024, 'x');
  const budget = { bytes: 0 };
  const body = Readable.from((async function* () {
    yield prefix;
    for (let i = 0; i < 448; i++) yield chunk;
    yield Buffer.from('"}');
  })());
  await request(async () => ({ status: 200, body }), { budget });
  assert.equal(budget.bytes, prefix.length + 28 * 1024 * 1024 + 2);
  assert.equal(body.destroyed, true);
});
test('default metadata ceiling refuses crossing chunk and closes stream before tail', async () => {
  const chunk = Buffer.alloc(1024 * 1024);
  let tail = false;
  const body = Readable.from((async function* () {
    for (let i = 0; i < 65; i++) yield chunk;
    yield Buffer.alloc(1);
    tail = true;
  })());
  const budget = { bytes: 0 };
  await assert.rejects(collectMetadata(body, budget), { code: 'METADATA_BODY_LIMIT' });
  assert.equal(budget.bytes, 65 * 1024 * 1024);
  assert.equal(body.destroyed, true);
  assert.equal(tail, false);
});

test('aggregate decoded budget includes every body and crossing chunk', async () => {
  const budget = { bytes: 0 }; const limits = { bodyBytes: 8, totalBytes: 10 };
  assert.equal((await collectMetadata(Readable.from([Buffer.alloc(6)]), budget, limits)).length, 6);
  await assert.rejects(collectMetadata(Readable.from([Buffer.alloc(5)]), budget, limits), { code: 'METADATA_TOTAL_LIMIT' });
  assert.equal(budget.bytes, 11);
});
test('metadata limits are inclusive and collector retains exact untouched bytes', async () => {
  const original = bytes(metadata()); const budget = { bytes: 0 };
  assert.deepEqual(await collectMetadata(Readable.from([original.subarray(0, 9), original.subarray(9)]), budget, { bodyBytes: original.length, totalBytes: original.length }), original);
  assert.equal(budget.bytes, original.length);
});
test('malformed JSON and accepted-version dist changes refuse', async () => {
  await assert.rejects(request(async () => response('{')), { code: 'METADATA_JSON' });
  for (const change of ['name', 'version', 'tarball', 'integrity', 'missing']) {
    const value = metadata(); const version = value.versions[record.version];
    if (change === 'missing') delete value.versions[record.version];
    else if (change === 'name' || change === 'version') version[change] = 'changed';
    else version.dist[change] = 'changed';
    await assert.rejects(request(async () => response(value)), { code: 'METADATA_DIST' });
  }
});
test('request uses both genuine representation headers, strict TLS, no retry/redirect, shared cache and default compression', async () => {
  for (const accept of ACCEPT) {
    let calls = 0;
    await request(async (url, opts) => {
      calls++; assert.equal(url, 'https://registry.npmjs.org/synthetic');
      assert.equal(opts.headers.accept, accept); assert.equal(opts.cachePath, '/synthetic-owned-cache');
      assert.equal(opts.cache, 'default'); assert.equal(opts.redirect, 'error'); assert.equal(opts.strictSSL, true);
      assert.deepEqual(opts.retry, { retries: 0 }); assert.equal(opts.maxSockets, 1); assert.equal(opts.timeout, 45000);
      assert.equal('compress' in opts, false); assert.equal('accept-encoding' in opts.headers, false);
      return response(metadata());
    }, { accept });
    assert.equal(calls, 1);
  }
});
test('redirect and transport failures never retry or follow', async () => {
  for (const status of [301, 302, 404, 500]) {
    let calls = 0;
    await assert.rejects(request(async () => { calls++; return response('', status); }), { code: 'HTTP_STATUS' });
    assert.equal(calls, 1);
  }
  let calls = 0;
  await assert.rejects(request(async () => { calls++; throw Object.assign(Error('private URL'), { code: 'ENOTAREALCODE' }); }), { code: 'METADATA_FAILED' });
  assert.equal(calls, 1);
});
test('same absolute deadline prevents next request and aborts pending response', async () => {
  let calls = 0;
  await assert.rejects(request(async () => { calls++; }, { deadline: Date.now() - 1 }), { code: 'PRIMER_DEADLINE' });
  assert.equal(calls, 0);
  await assert.rejects(request((_url, options) => new Promise((resolve, reject) => {
    options.signal.addEventListener('abort', () => reject(Error('controlled abort')), { once: true });
  }), { deadline: Date.now() + 25 }), { code: 'PRIMER_DEADLINE' });
});
test('per-request timeout retains its refusal and late response is destroyed', async () => {
  let body;
  await assert.rejects(request(async () => {
    await new Promise(resolve => setTimeout(resolve, 25));
    body = Readable.from([bytes(metadata())]); return { status: 200, body };
  }, { limits: { ...METADATA_LIMITS, requestMs: 5 } }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(body.destroyed, true);
});
test('caller cancellation destroys idle owned response', async () => {
  const controller = new AbortController(); let body;
  const pending = request(async () => {
    body = new Readable({ read() {} });
    setImmediate(() => controller.abort()); return { status: 200, body };
  }, { signal: controller.signal });
  await assert.rejects(pending, { code: 'CANCELLED' }); assert.equal(body.destroyed, true);
});
test('finite public errors never reflect raw values or arbitrary uppercase codes', () => {
  const error = Object.assign(Error('private-sentinel'), { code: 'SECRET_TOKEN' });
  assert.equal(publicCode(error), 'ACQUISITION_FAILED');
  assert.deepEqual(failureReceipt(error), { schema: 1, phase: 'initialize', status: 'failed', code: 'NATIVE_VALIDATION_FAILED', childClosed: 'unknown', exitCode: null, signal: 'unknown', worker: null, projection: null, tests: null });
  assert.throws(() => active(NaN), { code: 'PRIMER_DEADLINE' });
});
test('genuine pinned local API closure admits exactly immutable 32 distinct records offline', async () => {
  const apis = await runtimeApis(); const records = await namedArtifacts(apis.npa);
  assert.equal(records.length, 32); assert.equal(new Set(records.map(r => r.name)).size, 32);
  assert.equal(typeof apis.fetch, 'function'); assert.equal(typeof apis.pacote.packument, 'function');
  assert.equal(records.some(r => r.escapedName.startsWith('@opencode-ai%2f')), true);
  assert.equal(VERSIONS.fetch, '15.0.6');
});
const goodReceipt = () => ({ schema: 1, phase: 'acquisition', status: 'complete', ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK,
  node: process.version, platform: process.platform, versions: VERSIONS,
  tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: 1, metadataBytes: 1 });
test('acquisition receipt is closed, exact, bounded and integral', () => {
  assert.deepEqual(validateAcquisition(goodReceipt()), goodReceipt());
  for (const patch of [{ extra: true }, { metadata: 63 }, { offline: 63 }, { node: 'v24.21.0' }, { versions: {} }, { archiveBytes: Infinity }, { metadataBytes: -1 }, { metadataBytes: 0.1 }, { metadataBytes: METADATA_LIMITS.totalBytes + 1 }, { lockSha256: 'different' }]) {
    assert.throws(() => validateAcquisition({ ...goodReceipt(), ...patch }), { code: 'RECEIPT_INVALID' });
  }
});
test('expected acceptance counts derive from unchanged sources without executing tests', async () => {
  assert.deepEqual(await Promise.all(TEST_FILES.map(async file => sourceTestCount(await fs.readFile(path.join(here, file), 'utf8')))), [8, 25, 14]);
  assert.throws(() => sourceTestCount('test(variable)'), { code: 'TEST_SOURCE_INVALID' });
});
const tap = count => `TAP version 13\n${Array.from({ length: count }, (_, i) => `ok ${i + 1} - synthetic\n`).join('')}1..${count}\n# tests ${count}\n# suites 0\n# pass ${count}\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
test('TAP count validation refuses skipped, missing, duplicate and failed evidence', () => {
  assert.equal(validateTap(tap(47), 47).tests, 47);
  for (const value of [tap(46), tap(47).replace('# skipped 0', '# skipped 4'), tap(47) + '# tests 47\n', tap(47).replace('ok 1 -', 'not ok 1 -'), tap(47).replace('# todo 0', '# todo 1'), tap(47).replace('# cancelled 0', '# cancelled 1'), tap(47).replace('ok 1 - synthetic\n', '')]) {
    assert.throws(() => validateTap(value, 47), { code: 'TEST_COUNTS_INVALID' });
  }
});
test('sanitized acquisition environment has no inherited npm/auth/proxy/Node overrides', () => {
  const env = childEnvironment('/synthetic-owned');
  for (const key of ['NODE_OPTIONS', 'NODE_PATH', 'HTTPS_PROXY', 'HTTP_PROXY', 'ALL_PROXY', 'NPM_TOKEN', 'NODE_AUTH_TOKEN', 'NODE_TLS_REJECT_UNAUTHORIZED']) assert.equal(key in env, false);
  assert.equal(env.npm_config_userconfig, path.join('/synthetic-owned', 'empty-npmrc'));
});
test('owned child close precedes cleanup, including its delayed final write', async () => {
  let owned, observed = false;
  await ownedValidation(async workspace => {
    owned = workspace;
    await runChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'success', workspace], workspace);
    assert.equal(await fs.readFile(path.join(workspace, 'settled'), 'utf8'), 'closed-before-cleanup');
  }, { cleanup: async (workspace, opts) => {
    observed = true; assert.equal(await fs.readFile(path.join(workspace, 'settled'), 'utf8'), 'closed-before-cleanup'); await fs.rm(workspace, opts);
  } });
  assert.equal(observed, true); await assert.rejects(fs.access(owned), { code: 'ENOENT' });
});
test('failed child closes before cleanup and its private diagnostics never enter public receipt', async () => {
  let owned;
  await assert.rejects(ownedValidation(async workspace => {
    owned = workspace;
    await runChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'failure', workspace], workspace);
  }), error => {
    assert.equal(error.private.primary.child.closed, true);
    assert.equal(JSON.stringify(failureReceipt(error)).includes('private-sentinel'), false); return true;
  });
  await assert.rejects(fs.access(owned), { code: 'ENOENT' });
});
test('cancelled child joins its signal-driven final write before owned cleanup', async () => {
  const controller = new AbortController();
  await assert.rejects(ownedValidation(async workspace => {
    const pending = runChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'cancel', workspace], workspace, { signal: controller.signal });
    // Explicit file readiness, not a timed assumption that the handler exists.
    const limit = Date.now() + 3000;
    while (!(await fs.stat(path.join(workspace, 'ready')).catch(() => null))) {
      if (Date.now() >= limit) { controller.abort(); await pending; assert.fail('child readiness'); }
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    controller.abort(); await pending;
  }, { cleanup: async (workspace, opts) => {
    // Windows child.kill terminates directly; it cannot run a SIGTERM handler.
    if (process.platform !== 'win32') assert.equal(await fs.readFile(path.join(workspace, 'settled'), 'utf8'), 'closed-before-cleanup');
    await fs.rm(workspace, opts);
  } }), error => error.code === 'CANCELLED' && error.private.primary.child.closed);
});
test('primary and cleanup failures both survive privately', async () => {
  const primary = Error('private-primary'), cleanup = Error('private-cleanup'); let owned;
  try {
    await assert.rejects(ownedValidation(async workspace => { owned = workspace; throw primary; }, { cleanup: async () => { throw cleanup; } }), error => {
      assert.equal(error.private.primary, primary); assert.equal(error.private.cleanup, cleanup);
      assert.equal(JSON.stringify(error).includes('private-'), false); return true;
    });
  } finally { await fs.rm(owned, { recursive: true }); }
});
test('supervisor acquisition deadline joins killed direct child before cleanup', async () => {
  let cleaned = false;
  await assert.rejects(ownedValidation(async workspace => {
    await runChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'cancel', workspace], workspace, { timeout: 150 });
  }, { cleanup: async (workspace, opts) => { cleaned = true; await fs.rm(workspace, opts); } }), error => {
    assert.equal(error.code, 'OPERATION_TIMEOUT'); assert.equal(error.private.primary.child.closed, true); return true;
  });
  assert.equal(cleaned, true);
});
test('genuine pacote offline cache miss never opens a socket or falls back to network', async () => {
  const { pacote } = await runtimeApis();
  await ownedValidation(async workspace => {
    for (const fullMetadata of [true, false]) {
      await assert.rejects(pacote.packument(record.name, { cache: path.join(workspace, 'cache/_cacache'), offline: true, fullMetadata, registry: 'https://registry.npmjs.org/', retry: { retries: 0 } }), { code: 'ENOTCACHED' });
    }
  });
});

test('uncoded operation failure retains initialize phase and never masquerades as cleanup', async () => {
  await assert.rejects(ownedValidation(async () => { throw Error('private-primary'); }), error => {
    const receipt = failureReceipt(error);
    assert.equal(receipt.code, 'NATIVE_VALIDATION_FAILED');
    assert.equal(receipt.phase, 'initialize'); return true;
  });
});

test('mixed stderr retains finite worker file only after actual close; missing receipt stays unknown', async () => {
  for (const mode of ['worker-receipt', 'failure']) await assert.rejects(ownedValidation(async (workspace, context) => {
    context.phase = 'acquisition';
    await validationChild([path.join(here, 'fixtures/native-merged-child.mjs'), mode, workspace], workspace, {}, context);
  }, { cleanup: async (workspace, opts) => {
    assert.equal(await fs.readFile(path.join(workspace, 'settled'), 'utf8'), 'closed-before-cleanup'); await fs.rm(workspace, opts);
  } }), error => {
    const value = failureReceipt(error);
    assert.equal(value.phase, 'acquisition'); assert.equal(value.childClosed, true); assert.equal(value.exitCode, 1);
    assert.equal(value.code, mode === 'worker-receipt' ? 'METADATA_DIST' : 'CHILD_FAILED');
    assert.equal(value.worker?.stage ?? null, mode === 'worker-receipt' ? 'metadata' : null);
    assert.equal(JSON.stringify(value).includes('private-sentinel'), false); return true;
  });
});
test('worker receipt refuses unclosed reads, extra fields, bytes, symlinks and multiple links', async () => {
  const { OPERATION_RECEIPT, writeOperationReceipt } = await import('./native-merged-cache-worker.mjs');
  await ownedValidation(async workspace => {
    const file = path.join(workspace, OPERATION_RECEIPT);
    const value = { schema: 1, status: 'failed', stage: 'metadata', code: 'METADATA_DIST', tarballs: 32, metadata: 1, offline: 0 };
    await writeOperationReceipt(workspace, value);
    assert.equal(await readOperationReceipt(workspace, { closed: false }), null);
    assert.deepEqual(await readOperationReceipt(workspace, { closed: true }), value);
    await assert.rejects(writeOperationReceipt(workspace, value), { code: 'EEXIST' });
    for (const bad of [{ ...value, raw: 'private-sentinel' }, { ...value, code: 'SECRET' }, { ...value, metadata: 65 }, { ...value, stage: 'secret' }]) {
      await fs.writeFile(file, JSON.stringify(bad)); assert.equal(await readOperationReceipt(workspace, { closed: true }), null);
    }
    await fs.writeFile(file, ' '.repeat(4097)); assert.equal(await readOperationReceipt(workspace, { closed: true }), null);
    await fs.writeFile(file, JSON.stringify(value)); await fs.link(file, path.join(workspace, 'hardlink'));
    assert.equal(await readOperationReceipt(workspace, { closed: true }), null);
    await fs.unlink(file); await fs.symlink(path.join(workspace, 'hardlink'), file);
    assert.equal(await readOperationReceipt(workspace, { closed: true }), null);
  });
});
test('validated acquisition survives later actual failed test child and cleanup failure', async () => {
  for (const cleanupFailure of [false, true]) {
    let owned; const emitted = [];
    try {
      await assert.rejects(ownedValidation(async (workspace, context) => {
        owned = workspace;
        await validationChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'success', workspace], workspace, {}, context);
        retainAcquisition(goodReceipt(), context, r => emitted.push(r)); // controlled receipt, not genuine cache proof
        context.phase = 'tests'; context.expected = 1;
        if (!cleanupFailure) await validationChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'failed-tap', workspace], workspace, { json: false }, context);
      }, { cleanup: async (workspace, opts) => { if (cleanupFailure) throw Error('private-cleanup'); await fs.rm(workspace, opts); } }), error => {
        assert.equal(emitted.length, 1); assert.deepEqual(error.private.context.acquisition, goodReceipt());
        const value = failureReceipt(error); assert.equal(value.phase, cleanupFailure ? 'cleanup' : 'tests');
        if (!cleanupFailure) { assert.equal(value.tests.fail, 1); assert.equal(value.tests.failures[0].registration, 1); }
        assert.equal(JSON.stringify(value).includes('private-'), false); return true;
      });
    } finally { await fs.rm(owned, { recursive: true, force: true }); }
  }
  assert.throws(() => retainAcquisition(goodReceipt(), { child: { closed: false } }, () => assert.fail()), { code: 'RECEIPT_INVALID' });
});
test('failed TAP requires complete numeric plan and fixed-source declaration identity', async () => {
  const declarations = await Promise.all(TEST_FILES.map(async file => new Set((await fs.readFile(path.join(here, file), 'utf8')).split('\n').flatMap((line, i) => /^\s*test\(/.test(line) ? [i + 1] : []))));
  for (let i = 0; i < 3; i++) {
    const line = [...declarations[i]][0];
    const value = tap(1).replace('ok 1 - synthetic', `not ok 1 - private-sentinel\n  ---\n  location: '${path.join(here, TEST_FILES[i])}:${line}:1'\n  error: private-sentinel\n  ...`).replace('# pass 1', '# pass 0').replace('# fail 0', '# fail 1');
    const result = failedTap(value, 1, declarations);
    assert.equal(result.failures[0].source, ['config', 'lease', 'target'][i]); assert.equal(result.failures[0].line, line);
    assert.equal(JSON.stringify(result).includes('private-sentinel'), false);
    assert.equal(failedTap(value.replace('# todo 0', ''), 1, declarations), null);
    assert.equal(failedTap(value + '# tests 1\n', 1, declarations), null);
    assert.equal(failedTap(value.replace('1..1', '1..2'), 1, declarations), null);
    assert.equal(failedTap(value.replace(`:${line}:1`, ':999999:1'), 1, declarations).failures[0].source, 'unknown');
  }
});

test('absence of positive close keeps workspace and refuses receipt reads or cleanup', async () => {
  let owned, cleaned = false; const controller = new AbortController(); controller.abort();
  try {
    await assert.rejects(ownedValidation(async (workspace, context) => {
      owned = workspace; context.phase = 'acquisition';
      await validationChild([path.join(here, 'fixtures/native-merged-child.mjs'), 'success', workspace], workspace, { signal: controller.signal }, context);
    }, { cleanup: async () => { cleaned = true; } }), error => {
      assert.equal(failureReceipt(error).childClosed, 'unknown'); assert.equal(failureReceipt(error).worker, null); return true;
    });
    assert.equal(cleaned, false); assert.equal((await fs.lstat(owned)).isDirectory(), true);
  } finally { await fs.rm(owned, { recursive: true }); }
});

test('missing failure block cannot borrow the next registration location', async () => {
  const source = await fs.readFile(path.join(here, TEST_FILES[0]), 'utf8');
  const line = source.split('\n').findIndex(v => /^\s*test\(/.test(v)) + 1;
  const value = `TAP version 13\nnot ok 1 - first\nok 2 - second\n  ---\n  location: '${path.join(here, TEST_FILES[0])}:${line}:1'\n  ...\n1..2\n# tests 2\n# suites 0\n# pass 1\n# fail 1\n# cancelled 0\n# skipped 0\n# todo 0\n`;
  assert.equal(failedTap(value, 2, [new Set([line])]).failures[0].source, 'unknown');
});

// Supplemental Task18 controls: these do not fabricate genuine 32-package admission.
import * as parentProjection from './native-merged-validation.mjs';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { PATHS, FIXTURE_POLICY, COUNTS, canonicalRecordBytes, sha256, inventoryDigest } from './native-merged-projection-contract.mjs';
const projectionWorker = path.join(here, 'native-merged-cache-projection-worker.mjs');
const projectionFixture = path.join(here, 'fixtures/native-merged-child.mjs');
const toolsBoundary = path.join(here, 'runtime-tools/node_modules');
const nonce = '12345678-1234-1234-1234-123456789abc';
const projectionFailure = (patch = {}) => ({ schema: 1, phase: 'projection', status: 'failed', policy: FIXTURE_POLICY,
  nonce, stage: 'admission', code: 'TOOLS_INVALID', archives: 0, rawReads: 0, representations: 0, byteChecks: 0, pacoteChecks: 0, drain: 'settled', ...patch });
const latch = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function fixedPlan() {
  const sources = await Promise.all(TEST_FILES.map(f => fs.readFile(path.join(here, f), 'utf8')));
  return { expected: sources.map(sourceTestCount), declarations: sources.map(s => new Set(s.split('\n').flatMap((line, i) => /^\s*test\(/.test(line) ? [i + 1] : []))) };
}
async function negativeProjection(workspace, deadline = Date.now() + 300000) {
  const sources = []; // negative control; real verifier refuses before source admission
  const request = { schema: 1, policy: FIXTURE_POLICY, nonce, deadline, rawAcquisition: goodReceipt(),
    rawAcquisitionSha256: sha256(canonicalRecordBytes(goodReceipt())), sourceInventorySha256: inventoryDigest(sources) };
  const receipt = { schema: 1, phase: 'projection', status: 'complete', kind: 'derived-accepted-version-fixture', policy: FIXTURE_POLICY,
    nonce, requestSha256: sha256(canonicalRecordBytes(request)), rawAcquisitionSha256: request.rawAcquisitionSha256,
    sourceInventorySha256: request.sourceInventorySha256, manifestSha256: '0'.repeat(64), rawCacheSha256: '0'.repeat(64), derivedCacheSha256: '0'.repeat(64),
    node: process.version, platform: process.platform, ...COUNTS, archiveBytes: 1, rawMetadataBytes: 1, projectedMetadataBytes: 1 };
  await fs.writeFile(path.join(workspace, PATHS.request), canonicalRecordBytes(request), { flag: 'wx' });
  await fs.mkdir(path.join(workspace, PATHS.fixture));
  const workspaceStat = await fs.lstat(workspace, { bigint: true }), root = await fs.lstat(path.join(workspace, PATHS.fixture), { bigint: true });
  const identity = s => ({ dev: String(s.dev), ino: String(s.ino) });
  await fs.writeFile(path.join(workspace, PATHS.owner), canonicalRecordBytes({ schema: 1, nonce, workspace: identity(workspaceStat), root: identity(root) }));
  await fs.writeFile(path.join(workspace, PATHS.manifest), '{'); // intentionally malformed, never a full cache
  await fs.writeFile(path.join(workspace, 'projection-fixture-receipt.json'), JSON.stringify(receipt));
  return { request, sources };
}
async function marker(workspace, name, checkPending = () => {}) {
  const limit = process.hrtime.bigint() + 5_000_000_000n;
  while (!(await fs.stat(path.join(workspace, name)).catch(() => null))) {
    checkPending();
    if (process.hrtime.bigint() >= limit) assert.fail('owned fixture readiness: ' + name);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
}
function interceptProjection(mode, expectedDeadline) {
  const descriptor = Object.getOwnPropertyDescriptor(childProcess, 'spawn');
  const original = descriptor.value, children = [], closes = [], observations = [];
  let testSpawns = 0;
  Object.defineProperty(childProcess, 'spawn', { ...descriptor, value(executable, args, options) {
    if (args.includes('--test')) { testSpawns++; assert.fail('test launch on refused projection'); }
    assert.equal(executable, process.execPath);
    assert.equal(args[0], '--import');
    assert.match(args[1], /network-guard\.mjs$/);
    assert.deepEqual(args.slice(2), [projectionWorker, options.cwd, String(expectedDeadline)]);
    observations.push({ executable, args: [...args], cwd: options.cwd });
    const child = original(executable, [...args.slice(0, 2), projectionFixture, mode, options.cwd], options);
    children.push(child); closes.push(new Promise(resolve => child.once('close', (code, signal) => resolve({ code, signal }))));
    return child;
  } }); syncBuiltinESMExports();
  return { children, closes, observations, get testSpawns() { return testSpawns; }, restore() { Object.defineProperty(childProcess, 'spawn', descriptor); syncBuiltinESMExports(); } };
}
function interceptOpen(workspace, { hold = false } = {}) {
  const descriptor = Object.getOwnPropertyDescriptor(fs, 'open'), original = descriptor.value;
  const entered = latch(), release = latch(), fdClosed = latch();
  const statDescriptor = Object.getOwnPropertyDescriptor(fs, 'lstat');
  let manifests = 0, failures = 0, failureStats = 0, cacheStats = 0, closedFds = 0, manifestFd = null;
  Object.defineProperty(fs, 'lstat', { ...statDescriptor, value(file, ...args) {
    if (file === path.join(workspace, PATHS.failure)) failureStats++;
    if ([path.join(workspace, PATHS.raw), path.join(workspace, PATHS.derived)].includes(file)) cacheStats++;
    return statDescriptor.value.call(fs, file, ...args);
  } });
  Object.defineProperty(fs, 'open', { ...descriptor, value: async function(file, ...args) {
    if (file === path.join(workspace, PATHS.failure)) failures++;
    const handle = await original.call(fs, file, ...args);
    if (file === path.join(workspace, PATHS.manifest)) {
      manifests++; manifestFd = handle.fd; const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...readArgs) => { entered.resolve(); if (hold) await release.promise; return read(...readArgs); };
      handle.close = async () => { try { return await close(); } finally { closedFds++; fdClosed.resolve(); } };
    }
    return handle;
  } }); syncBuiltinESMExports();
  return { entered, release, fdClosed, get manifests() { return manifests; }, get failures() { return failures; }, get failureStats() { return failureStats; }, get cacheStats() { return cacheStats; }, get closedFds() { return closedFds; }, get manifestFd() { return manifestFd; }, restore() { Object.defineProperty(fs, 'open', descriptor); Object.defineProperty(fs, 'lstat', statDescriptor); syncBuiltinESMExports(); } };
}

test('projection parent: real preparation refuses exact absent tools boundary before child or preload', async () => {
  assert.equal(typeof parentProjection.prepareProjectionRequest, 'function');
  const descriptor = Object.getOwnPropertyDescriptor(fs, 'realpath'), original = descriptor.value;
  const spawnDescriptor = Object.getOwnPropertyDescriptor(childProcess, 'spawn'); let calls = 0, spawns = 0;
  Object.defineProperty(fs, 'realpath', { ...descriptor, value: async (file, ...args) => {
    if (file === toolsBoundary) { calls++; throw Object.assign(Error('controlled absent tools'), { code: 'ENOENT' }); }
    return original.call(fs, file, ...args);
  } });
  Object.defineProperty(childProcess, 'spawn', { ...spawnDescriptor, value() { spawns++; assert.fail('no spawn before tools admission'); } }); syncBuiltinESMExports();
  try {
    await ownedValidation(async workspace => {
      await assert.rejects(parentProjection.prepareProjectionRequest(workspace, goodReceipt(), Date.now() + 300000), { code: 'TOOLS_INVALID' });
      await assert.rejects(fs.access(path.join(workspace, PATHS.request)), { code: 'ENOENT' });
      await assert.rejects(fs.access(path.join(workspace, 'accepted-cache.mjs')), { code: 'ENOENT' });
    });
    assert.equal(calls, 1); assert.equal(spawns, 0);
  } finally { Object.defineProperty(fs, 'realpath', descriptor); Object.defineProperty(childProcess, 'spawn', spawnDescriptor); syncBuiltinESMExports(); }
});

test('projection parent: finite projection failure field and phase never echo private diagnostics', () => {
  const failure = projectionFailure();
  const error = Object.assign(Error('private-sentinel'), { code: 'TOOLS_INVALID', private: { context: { phase: 'projection', projectionFailure: failure } } });
  assert.deepEqual(failureReceipt(error), { schema: 1, phase: 'projection', status: 'failed', code: 'TOOLS_INVALID', childClosed: 'unknown', exitCode: null, signal: 'unknown', worker: null, projection: failure, tests: null });
  error.private.context.projectionFailure = { ...failure, raw: 'private-sentinel' };
  assert.equal(failureReceipt(error).projection, null);
  error.code = 'SECRET_TOKEN'; assert.equal(failureReceipt(error).code, 'PROJECTION_FAILED');
});

test('projection parent: bounded diagnostic requires actual close and exact nonce/schema/code/physical record', async () => {
  assert.equal(typeof parentProjection.readProjectionFailure, 'function');
  await ownedValidation(async workspace => {
    const file = path.join(workspace, PATHS.failure), value = projectionFailure();
    assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), null);
    await fs.writeFile(file, canonicalRecordBytes(value));
    assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: false }, nonce), null);
    assert.deepEqual(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), value);
    for (const patch of [{ nonce: '87654321-1234-1234-1234-123456789abc' }, { raw: 'private-sentinel' }, { code: 'SECRET_TOKEN' }, { nonce: null, stage: 'metadata' }]) {
      await fs.writeFile(file, canonicalRecordBytes(projectionFailure(patch)));
      assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), null);
    }
    const early = projectionFailure({ nonce: null });
    await fs.writeFile(file, canonicalRecordBytes(early));
    assert.deepEqual(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), early);
    await fs.writeFile(file, ' '.repeat(4097)); assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), null);
    await fs.writeFile(file, canonicalRecordBytes(value)); await fs.link(file, path.join(workspace, 'projection-linked'));
    assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), null);
    await fs.unlink(file); await fs.symlink(path.join(workspace, 'projection-linked'), file);
    assert.equal(await parentProjection.readProjectionFailure(workspace, { closed: true }, nonce), null);
  });
});

for (const gate of ['receipt-before-close', 'held-manifest', 'cancel-admission', 'deadline-admission', 'nonzero-success-stdout', 'preabort', 'cleanup-failure']) {
  test('projection parent: actual tail ' + gate + ' drains owned child/fd and refuses progress', async t => {
    assert.equal(typeof parentProjection.projectionThenTests, 'function');
    let owned, interception, io, pending, cleaned = false, settled = false, observedContext;
    const controller = new AbortController(), deadline = Date.now() + 300000, plan = await fixedPlan();
    const dateDescriptor = Object.getOwnPropertyDescriptor(Date, 'now');
    const cleanupError = Error('private-cleanup'); let finalError;
    try {
      pending = ownedValidation(async (workspace, context) => {
        owned = workspace; observedContext = context;
        const prepared = await negativeProjection(workspace, deadline);
        context.acquisition = goodReceipt(); context.worker = { preserved: 'private-worker' };
        context.child = { closed: true, exitCode: 0, signal: null }; // must be cleared before projection
        interception = interceptProjection(gate === 'nonzero-success-stdout' ? 'projection-nonzero' : 'projection-held', deadline);
        io = interceptOpen(workspace, { hold: ['held-manifest', 'cancel-admission', 'deadline-admission'].includes(gate) });
        if (gate === 'preabort') controller.abort();
        return parentProjection.projectionThenTests(workspace, context, prepared, plan, { signal: controller.signal, onProjection() { assert.fail('negative control cannot admit projection'); } });
      }, { cleanup: async (workspace, opts) => {
        cleaned = true;
        if (interception.children.length) {
          assert.equal(await fs.readFile(path.join(workspace, 'projection-final'), 'utf8'), 'child-final-write');
          assert.equal(observedContext.child.closed, true);
        }
        if (gate === 'cleanup-failure') throw cleanupError;
        await fs.rm(workspace, opts);
      } });
      const outcome = pending.then(value => { settled = true; return value; }, error => { settled = true; finalError = error; });
      // The interception is installed by the owned operation before fixture readiness.
      while (!interception && !settled) await new Promise(resolve => setImmediate(resolve));
      if (gate !== 'preabort') {
        await marker(owned, 'projection-ready');
        if (gate === 'receipt-before-close') {
          assert.equal(settled, false); assert.equal(cleaned, false); assert.equal(io.manifests, 0); assert.equal(io.failures, 0); assert.equal(io.failureStats, 0); assert.equal(io.cacheStats, 0);
          assert.equal(observedContext.child.closed, false);
          await assert.rejects(fs.access(path.join(owned, 'accepted-cache.mjs')), { code: 'ENOENT' });
        }
        await fs.writeFile(path.join(owned, 'projection-release'), 'release');
        if (['held-manifest', 'cancel-admission', 'deadline-admission'].includes(gate)) {
          await io.entered.promise;
          assert.equal(observedContext.child.closed, true); assert.equal(settled, false); assert.equal(cleaned, false);
          assert.equal((await interception.closes[0]).code, 0);
          if (gate === 'cancel-admission') controller.abort();
          if (gate === 'deadline-admission') Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline + 1 });
          await new Promise(resolve => setImmediate(resolve));
          assert.equal(settled, false); assert.equal(cleaned, false); assert.equal(interception.testSpawns, 0);
          io.release.resolve(); await io.fdClosed.promise;
        }
      }
      await outcome;
      assert.ok(finalError); assert.deepEqual(finalError.private.context.acquisition, goodReceipt());
      assert.deepEqual(finalError.private.context.worker, { preserved: 'private-worker' });
      assert.equal(interception.testSpawns, 0);
      const publicFailure = failureReceipt(finalError);
      assert.equal(publicFailure.projection, null);
      t.diagnostic(JSON.stringify({ control: gate, originalSpawns: interception.observations,
        actualChildren: interception.children.map(child => ({ pid: child.pid, argv: child.spawnargs, exitCode: child.exitCode, signal: child.signalCode })),
        positiveClose: observedContext.child?.closed ?? 'unknown', manifestOpens: io.manifests, manifestFd: io.manifestFd, closedFds: io.closedFds,
        failureReads: io.failureStats, cacheReads: io.cacheStats, cleanup: cleaned, testSpawns: interception.testSpawns, code: finalError.code }));
      if (gate === 'preabort') {
        assert.equal(finalError.code, 'CANCELLED'); assert.equal(publicFailure.childClosed, 'unknown');
        assert.equal(childSupervision.childSupervisorReason(finalError.private.primary), 'CANCELLED');
        assert.equal(cleaned, false); assert.equal(io.manifests, 0); assert.equal(io.failures, 0); assert.equal(io.failureStats, 0); assert.equal(io.cacheStats, 0);
        assert.equal((await fs.lstat(owned)).isDirectory(), true);
      } else {
        assert.equal(cleaned, true); assert.equal(publicFailure.childClosed, true);
        assert.equal(finalError.code, gate === 'cancel-admission' ? 'CANCELLED' : gate === 'deadline-admission' ? 'PRIMER_DEADLINE' : gate === 'nonzero-success-stdout' ? 'CHILD_FAILED' : 'RECEIPT_INVALID');
        if (gate === 'nonzero-success-stdout') assert.equal(io.manifests, 0);
        else assert.equal(io.manifests, 1);
        if (gate === 'cleanup-failure') assert.equal(finalError.private.cleanup, cleanupError);
      }
    } finally {
      Object.defineProperty(Date, 'now', dateDescriptor);
      io?.release.resolve();
      if (owned) await fs.writeFile(path.join(owned, 'projection-release'), 'release').catch(() => {});
      controller.abort();
      await pending?.catch(() => {});
      if (interception) await Promise.all(interception.closes);
      io?.restore(); interception?.restore();
      if (owned) await fs.rm(owned, { recursive: true, force: true });
    }
  });
}

for (const diagnostic of ['valid', 'wrong-nonce', 'extra', 'code', 'oversize', 'forged-stderr', 'cancelled', 'timeout', 'output-limit']) {
  test('projection parent: actual closed failure ' + diagnostic + ' preserves original context and primary', async t => {
    const deadline = Date.now() + 300000, controller = new AbortController(), emitted = [];
    const dateDescriptor = Object.getOwnPropertyDescriptor(Date, 'now');
    let owned, interception, io, pending, error, context, settled = false;
    try {
      pending = ownedValidation(async (workspace, state) => {
        owned = workspace; context = state;
        const prepared = await negativeProjection(workspace, deadline);
        state.child = { closed: true, exitCode: 0, signal: null };
        retainAcquisition(goodReceipt(), state, value => emitted.push(value));
        state.worker = { preserved: 'raw-worker-context' };
        const value = projectionFailure(diagnostic === 'wrong-nonce' ? { nonce: '87654321-1234-1234-1234-123456789abc' } : diagnostic === 'extra' ? { secret: 'private-sentinel' } : diagnostic === 'code' ? { code: 'SECRET' } : {});
        await fs.writeFile(path.join(workspace, 'projection-fixture-failure.json'), diagnostic === 'oversize' ? ' '.repeat(4097) : canonicalRecordBytes(value));
        interception = interceptProjection(diagnostic === 'forged-stderr' ? 'projection-forged-code' : diagnostic === 'output-limit' ? 'projection-output-limit' : 'projection-failure', deadline);
        if (diagnostic === 'timeout') Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline - 1000 });
        io = interceptOpen(workspace);
        return parentProjection.projectionThenTests(workspace, state, prepared, await fixedPlan(), { signal: controller.signal, onProjection() { assert.fail('failure cannot publish'); } });
      });
      const outcome = pending.catch(failure => { error = failure; }).finally(() => { settled = true; });
      const checkPending = () => { if (settled) throw error ?? Error('owned operation completed before fixture readiness'); };
      while ((!owned || !interception) && !settled) await new Promise(resolve => setImmediate(resolve));
      checkPending();
      await marker(owned, 'projection-ready', checkPending);
      if (diagnostic === 'cancelled') controller.abort();
      else if (diagnostic === 'output-limit') await fs.writeFile(path.join(owned, 'projection-output-release'), 'release');
      else if (!['timeout', 'output-limit'].includes(diagnostic)) await fs.writeFile(path.join(owned, 'projection-release'), 'release');
      await outcome;
      assert.ok(error); assert.equal(emitted.length, 1); assert.deepEqual(context.acquisition, goodReceipt());
      assert.deepEqual(context.worker, { preserved: 'raw-worker-context' });
      assert.equal(io.manifests, 0); assert.equal(interception.testSpawns, 0);
      assert.equal(context.child.closed, true);
      const value = failureReceipt(error);
      if (diagnostic === 'valid' || (['cancelled', 'timeout', 'output-limit'].includes(diagnostic) && process.platform !== 'win32')) assert.deepEqual(value.projection, projectionFailure());
      else assert.equal(value.projection, null);
      assert.equal(value.code, diagnostic === 'cancelled' ? 'CANCELLED' : diagnostic === 'timeout' ? 'OPERATION_TIMEOUT' : diagnostic === 'output-limit' ? 'CHILD_OUTPUT_LIMIT' : diagnostic === 'valid' ? 'TOOLS_INVALID' : 'CHILD_FAILED');
      if (['cancelled', 'timeout', 'output-limit'].includes(diagnostic)) assert.equal(childSupervision.childSupervisorReason(error.private.primary), value.code);
      assert.equal(JSON.stringify(value).includes('private-sentinel'), false);
      t.diagnostic(JSON.stringify({ control: diagnostic, originalSpawns: interception.observations,
        actualChildren: interception.children.map(child => ({ pid: child.pid, argv: child.spawnargs, exitCode: child.exitCode, signal: child.signalCode })),
        positiveClose: context.child.closed, manifestOpens: io.manifests, failureReads: io.failureStats, testSpawns: interception.testSpawns,
        primary: error.private.primary.code, publicCode: value.code, admittedFailure: value.projection !== null }));
    } finally {
      if (owned) await fs.writeFile(path.join(owned, 'projection-release'), 'release').catch(() => {});
      controller.abort(); await pending?.catch(() => {});
      if (interception) await Promise.all(interception.closes);
      io?.restore(); interception?.restore();
      Object.defineProperty(Date, 'now', dateDescriptor);
      if (owned) await fs.rm(owned, { recursive: true, force: true });
    }
  });
}

for (const expiry of ['after-acquisition', 'during-preparation']) {
  test('projection parent: original native deadline ' + expiry + ' joins work and prevents next spawn', async t => {
    const descriptor = Object.getOwnPropertyDescriptor(childProcess, 'spawn'), original = descriptor.value;
    const realpathDescriptor = Object.getOwnPropertyDescriptor(fs, 'realpath'), originalRealpath = realpathDescriptor.value;
    const dateDescriptor = Object.getOwnPropertyDescriptor(Date, 'now');
    const entered = latch(), release = latch(), emitted = [], children = [], closes = [];
    let deadline, owned, pending, finalError, toolReads = 0, nextSpawns = 0, settled = false;
    Object.defineProperty(childProcess, 'spawn', { ...descriptor, value(executable, args, options) {
      if (!args.includes(path.join(here, 'native-merged-cache-worker.mjs'))) { nextSpawns++; assert.fail('expired original deadline forbids next child'); }
      assert.equal(executable, process.execPath); owned = options.cwd;
      const offset = args.indexOf(path.join(here, 'native-merged-cache-worker.mjs'));
      assert.deepEqual(args.slice(offset, offset + 2), [path.join(here, 'native-merged-cache-worker.mjs'), owned]);
      deadline = Number(args[offset + 2]); assert.ok(deadline > Date.now() && deadline - Date.now() <= 300000);
      const child = original(executable, [...args.slice(0, offset), projectionFixture, 'acquisition-held', owned], options);
      children.push(child); closes.push(new Promise(resolve => child.once('close', resolve))); return child;
    } });
    Object.defineProperty(fs, 'realpath', { ...realpathDescriptor, value: async function(file, ...args) {
      if (file === toolsBoundary) {
        toolReads++; entered.resolve(); await release.promise;
        throw Object.assign(Error('controlled missing tools after owned pending read'), { code: 'ENOENT' });
      }
      return originalRealpath.call(fs, file, ...args);
    } }); syncBuiltinESMExports();
    try {
      pending = parentProjection.nativeValidation({ onAcquisition(value) {
        emitted.push(value);
        if (expiry === 'after-acquisition') Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline + 1 });
      }, onProjection() { assert.fail('expired acquisition allowance'); } });
      const outcome = pending.catch(error => { finalError = error; }).finally(() => { settled = true; });
      while (!owned && !settled) await new Promise(resolve => setImmediate(resolve));
      await marker(owned, 'projection-ready');
      assert.equal(settled, false); assert.equal(emitted.length, 0);
      await fs.writeFile(path.join(owned, 'projection-release'), 'release');
      if (expiry === 'during-preparation') {
        await entered.promise; assert.equal(settled, false);
        Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline + 1 });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(settled, false); assert.equal((await fs.lstat(owned)).isDirectory(), true);
        release.resolve();
      }
      await outcome;
      assert.equal(finalError.code, 'PRIMER_DEADLINE'); assert.equal(emitted.length, 1);
      assert.deepEqual(finalError.private.context.acquisition, goodReceipt());
      assert.equal(finalError.private.context.phase, 'projection');
      assert.equal(finalError.private.context.child, undefined); // acquisition close cannot authorize projection reads
      assert.equal(toolReads, expiry === 'after-acquisition' ? 0 : 1); assert.equal(nextSpawns, 0);
      t.diagnostic(JSON.stringify({ control: expiry, originalDeadline: deadline,
        actualChildren: children.map(child => ({ pid: child.pid, argv: child.spawnargs, exitCode: child.exitCode, signal: child.signalCode })),
        acquisitionEmitted: emitted.length, projectionWitness: finalError.private.context.child ?? 'cleared', toolReads, nextSpawns, code: finalError.code }));
      await assert.rejects(fs.access(owned), { code: 'ENOENT' });
    } finally {
      Object.defineProperty(Date, 'now', dateDescriptor); release.resolve();
      if (owned) await fs.writeFile(path.join(owned, 'projection-release'), 'release').catch(() => {});
      await pending?.catch(() => {}); await Promise.all(closes);
      Object.defineProperty(childProcess, 'spawn', descriptor); Object.defineProperty(fs, 'realpath', realpathDescriptor); syncBuiltinESMExports();
      if (owned) await fs.rm(owned, { recursive: true, force: true });
    }
  });
}

test('projection parent: unchanged absolute deadline reduces actual supervisor remainder after controlled acquisition', async t => {
  const deadline = Date.now() + 300000, dateDescriptor = Object.getOwnPropertyDescriptor(Date, 'now');
  const timeoutDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'setTimeout');
  const timeouts = [];
  let owned, pending, interception, io, failure, settled = false;
  try {
    pending = ownedValidation(async (workspace, context) => {
      owned = workspace;
      context.phase = 'acquisition';
      const child = validationChild([projectionFixture, 'acquisition-held', workspace], workspace, { offline: true, timeout: 300000 }, context);
      const acquisition = child.catch(() => {});
      try {
        await marker(workspace, 'projection-ready');
        // Controlled clock advance while the actual acquisition child is held.
        Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline - 12345 });
        await fs.writeFile(path.join(workspace, 'projection-release'), 'release');
        retainAcquisition(await child, context, () => {});
      } finally {
        await fs.writeFile(path.join(workspace, 'projection-release'), 'release').catch(() => {});
        await acquisition;
      }
      await fs.unlink(path.join(workspace, 'projection-ready')); await fs.unlink(path.join(workspace, 'projection-release'));
      const prepared = await negativeProjection(workspace, deadline);
      interception = interceptProjection('projection-nonzero', deadline); io = interceptOpen(workspace);
      Object.defineProperty(globalThis, 'setTimeout', { ...timeoutDescriptor, value(fn, ms, ...args) { timeouts.push(ms); return timeoutDescriptor.value(fn, ms, ...args); } });
      return parentProjection.projectionThenTests(workspace, context, prepared, await fixedPlan());
    });
    const outcome = pending.catch(error => { failure = error; return error; }).finally(() => { settled = true; });
    const checkPending = () => { if (settled) throw failure ?? Error('owned operation completed before fixture readiness'); };
    while (!interception && !settled) await new Promise(resolve => setImmediate(resolve));
    checkPending();
    await marker(owned, 'projection-ready', checkPending);
    await fs.writeFile(path.join(owned, 'projection-release'), 'release');
    const error = await outcome;
    assert.equal(error.code, 'CHILD_FAILED'); assert.equal(interception.testSpawns, 0);
    assert.equal(interception.observations[0].args.at(-1), String(deadline));
    assert.deepEqual(timeouts.filter(ms => ms > 1000), [12345]);
    t.diagnostic(JSON.stringify({ originalDeadline: deadline, originalSpawns: interception.observations, actualArgv: interception.children[0].spawnargs, supervisorTimeouts: timeouts.filter(ms => ms > 1000), code: error.code }));
  } finally {
    if (owned) await fs.writeFile(path.join(owned, 'projection-release'), 'release').catch(() => {});
    await pending?.catch(() => {}); if (interception) await Promise.all(interception.closes);
    Object.defineProperty(Date, 'now', dateDescriptor); Object.defineProperty(globalThis, 'setTimeout', timeoutDescriptor);
    io?.restore(); interception?.restore(); if (owned) await fs.rm(owned, { recursive: true, force: true });
  }
});

test('projection parent: fixed successful wiring model keeps derived preload, original argv/47/180000 and immutable callback order', async () => {
  // Source-bound model only: no mocked verifier/admitted cache/full positive claim.
  const source = await fs.readFile(path.join(here, 'native-merged-validation.mjs'), 'utf8');
  assert.deepEqual((await fixedPlan()).expected, [8, 25, 14]);
  assert.equal(source.match(/const deadline = Date.now\(\) \+ 300000;/g)?.length, 1);
  assert.match(source, /verifyProjectionArtifacts\(workspace, receipt, request, sources, \{ signal \}\)/);
  assert.match(source, /JSON.stringify\(admitted.cache\)/);
  assert.doesNotMatch(source, /JSON.stringify\(path.join\(workspace, 'cache\/_cacache'\)\)/);
  assert.match(source, /\['--import', pathToFileURL\(preload\).href, '--test', '--test-reporter=tap', \n?\s*\.\.\.TEST_FILES.map\(file => path.join\(here, file\)\)\]/);
  assert.match(source, /\{ signal, json: false, timeout: 180000 \}/);
  const verified = source.indexOf('const admitted = await scope.run(() => verifyProjectionArtifacts');
  const retained = source.indexOf('context.projection = admitted.receipt;', verified);
  const callback = source.indexOf('onProjection(admitted.receipt)', retained);
  const accepted = source.indexOf('acceptedArtifacts()', callback);
  const preload = source.indexOf('publishAcceptedPreload(workspace, admitted, scope)', accepted);
  const disposed = source.indexOf('scope.dispose()', preload);
  const tests = source.indexOf("context.phase = 'tests'", disposed);
  assert.ok(verified >= 0 && retained > verified && callback > retained && accepted > callback && preload > accepted && disposed > preload && tests > disposed);
  assert.match(source, /return \{ acquisition: context.acquisition, projection: context.projection,/);
  assert.match(source, /onAcquisition: receipt => console.log\(JSON.stringify\(receipt\)\), onProjection: receipt => console.log\(JSON.stringify\(receipt\)\)/);
  assert.match(source, /console.log\(JSON.stringify\(result.tests\)\)/);
});

test('projection parent: expiration after prepared negative control prevents projection launch and reads', async t => {
  const deadline = Date.now() + 300000, dateDescriptor = Object.getOwnPropertyDescriptor(Date, 'now');
  let owned, interception, io, error, cleaned = false;
  try {
    await assert.rejects(ownedValidation(async (workspace, context) => {
      owned = workspace;
      const prepared = await negativeProjection(workspace, deadline);
      context.acquisition = goodReceipt(); context.child = { closed: true, exitCode: 0 };
      interception = interceptProjection('projection-held', deadline); io = interceptOpen(workspace);
      const plan = await fixedPlan();
      Object.defineProperty(Date, 'now', { ...dateDescriptor, value: () => deadline + 1 });
      return parentProjection.projectionThenTests(workspace, context, prepared, plan, { onProjection() { assert.fail('expired request'); } });
    }, { cleanup: async (workspace, options) => { cleaned = true; await fs.rm(workspace, options); } }), value => {
      error = value; return value.code === 'PRIMER_DEADLINE';
    });
    assert.equal(error.private.context.child, undefined); assert.equal(cleaned, true);
    assert.equal(interception.children.length, 0); assert.equal(interception.testSpawns, 0);
    assert.equal(io.manifests, 0); assert.equal(io.failureStats, 0); assert.equal(io.cacheStats, 0);
    t.diagnostic(JSON.stringify({ originalDeadline: deadline, projectionSpawns: interception.children.length, testSpawns: interception.testSpawns, manifestOpens: io.manifests, failureReads: io.failureStats, cacheReads: io.cacheStats, cleanup: cleaned, code: error.code }));
  } finally {
    Object.defineProperty(Date, 'now', dateDescriptor); io?.restore(); interception?.restore();
    if (owned) await fs.rm(owned, { recursive: true, force: true });
  }
});


// Task18 R1: identity-backed supervisor provenance; no stderr name is authority.
import * as childSupervision from '../build/plugin-payload/prepare.mjs';
for (const [forged, mode] of [['CANCELLED', 'supervisor-forged-cancelled'], ['OPERATION_TIMEOUT', 'supervisor-forged-timeout'], ['CHILD_OUTPUT_LIMIT', 'supervisor-forged-output-limit']]) {
  for (const withFailure of [false, true]) {
    test(`projection parent: supervisor provenance forged ${forged} file=${withFailure} refuses impersonation`, async t => {
      const controller = new AbortController(); let primary, context;
      await assert.rejects(ownedValidation(async (workspace, state) => {
        context = state; state.phase = 'projection'; state.projectionNonce = nonce;
        if (withFailure) await fs.writeFile(path.join(workspace, 'projection-fixture-failure.json'), canonicalRecordBytes(projectionFailure()));
        await validationChild([projectionFixture, mode, workspace], workspace, { offline: true, timeout: 5000, signal: controller.signal }, state);
      }), error => {
        primary = error.private.primary;
        assert.equal(controller.signal.aborted, false);
        assert.equal(primary.child.closed, true); assert.equal(primary.child.exitCode, 1); assert.equal(primary.child.signal, null);
        assert.equal(primary.code, withFailure ? 'TOOLS_INVALID' : 'CHILD_FAILED');
        assert.equal(failureReceipt(error).code, withFailure ? 'TOOLS_INVALID' : 'CHILD_FAILED');
        assert.deepEqual(failureReceipt(error).projection, withFailure ? projectionFailure() : null);
        assert.equal(childSupervision.childSupervisorReason(primary), undefined);
        assert.equal(childSupervision.childSupervisorReason(error), undefined); // wrapper is not the original Error
        return true;
      });
      t.diagnostic(JSON.stringify({ forged, diagnosticFile: withFailure, signalAborted: controller.signal.aborted, timeout: 5000,
        child: context.child, primary: primary.code, genuineReason: childSupervision.childSupervisorReason(primary) ?? null }));
    });
  }
}

test('projection parent: supervisor provenance raw stderr fields stay unchanged and never register caller objects', async () => {
  for (const [code, mode] of [['CANCELLED', 'supervisor-forged-cancelled'], ['OPERATION_TIMEOUT', 'supervisor-forged-timeout'], ['CHILD_OUTPUT_LIMIT', 'supervisor-forged-output-limit']]) {
    await ownedValidation(async workspace => {
      await assert.rejects(runChild([projectionFixture, mode, workspace], workspace, { offline: true, timeout: 5000 }), error => {
        assert.equal(error.code, code); assert.equal(error.message, code); assert.equal(error.child.closed, true);
        assert.equal(error.child.exitCode, 1); assert.equal(error.child.signal, null); assert.equal(Object.hasOwn(error, 'output'), false);
        assert.equal(childSupervision.childSupervisorReason(error), undefined);
        return true;
      });
    });
  }
  for (const caller of [null, undefined, 'CANCELLED', 1, Symbol('reason'), { code: 'CANCELLED', reason: 'CANCELLED' }, Object.assign(Error('CANCELLED'), { code: 'CANCELLED' }), Object.create({ code: 'OPERATION_TIMEOUT' }), new Proxy({}, { get() { assert.fail('must not read caller fields'); }, getPrototypeOf() { assert.fail('must not inspect caller prototypes'); } })]) {
    assert.equal(childSupervision.childSupervisorReason(caller), undefined);
  }
  assert.equal(childSupervision.childSupervisorReason(Object.defineProperty({}, 'code', { get() { assert.fail('must not read caller getter'); } })), undefined);
});

test('projection parent: supervisor provenance genuine first abort survives later actual output limit and graceful close', { skip: process.platform === 'win32' ? 'POSIX graceful SIGTERM handler; portable actual-close controls run separately' : false }, async t => {
  const controller = new AbortController(), descriptor = Object.getOwnPropertyDescriptor(childProcess, 'spawn');
  const overflow = latch(), children = [], closes = []; let bytes = 0, owned, pending, failure;
  Object.defineProperty(childProcess, 'spawn', { ...descriptor, value(executable, args, options) {
    assert.equal(executable, process.execPath);
    assert.deepEqual(args.slice(2), [projectionFixture, 'supervisor-first-reason', options.cwd]);
    assert.equal(args[0], '--import'); assert.match(args[1], /network-guard\.mjs$/);
    const child = descriptor.value(executable, args, options); children.push(child);
    child.stdout.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) overflow.resolve(); });
    closes.push(new Promise(resolve => child.once('close', resolve))); return child;
  } }); syncBuiltinESMExports();
  try {
    pending = ownedValidation(async (workspace, context) => {
      owned = workspace; context.phase = 'projection';
      const operation = validationChild([projectionFixture, 'supervisor-first-reason', workspace], workspace, { offline: true, timeout: 5000, signal: controller.signal }, context);
      const outcome = operation.catch(error => { failure = error; });
      try {
        await marker(workspace, 'supervisor-ready'); controller.abort();
        // This new provenance control joins its real operation if close wins readiness.
        await Promise.race([overflow.promise, outcome.then(() => { assert.ok(bytes > 65536, 'child settled before actual overflow'); })]);
      } finally {
        controller.abort(); await fs.writeFile(path.join(workspace, 'supervisor-close-release'), 'release'); await outcome;
      }
      throw failure;
    });
    await assert.rejects(pending, error => {
      assert.equal(error.code, 'CANCELLED'); assert.equal(error.private.primary.child.closed, true);
      assert.equal(error.private.primary.child.exitCode, 1); assert.equal(error.private.primary.child.signal, null);
      assert.equal(childSupervision.childSupervisorReason(error.private.primary), 'CANCELLED');
      assert.equal(childSupervision.childSupervisorReason(Object.assign(Error('copy'), error.private.primary)), undefined);
      assert.equal(childSupervision.childSupervisorReason(Object.create(error.private.primary)), undefined);
      assert.equal(childSupervision.childSupervisorReason(error), undefined);
      return true;
    });
    assert.ok(bytes > 65536);
    t.diagnostic(JSON.stringify({ actualBytes: bytes, first: 'CANCELLED', attemptedLater: 'CHILD_OUTPUT_LIMIT', child: failure.child,
      actualChildren: children.map(child => ({ pid: child.pid, argv: child.spawnargs, exitCode: child.exitCode, signal: child.signalCode })) }));
  } finally {
    controller.abort(); if (owned) await fs.writeFile(path.join(owned, 'supervisor-close-release'), 'release').catch(() => {});
    await pending?.catch(() => {}); await Promise.all(closes);
    Object.defineProperty(childProcess, 'spawn', descriptor); syncBuiltinESMExports();
    if (owned) await fs.rm(owned, { recursive: true, force: true });
  }
});
