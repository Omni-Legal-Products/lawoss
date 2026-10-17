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
  assert.deepEqual(failureReceipt(error), { schema: 1, phase: 'initialize', status: 'failed', code: 'NATIVE_VALIDATION_FAILED', childClosed: 'unknown', exitCode: null, signal: 'unknown', worker: null, tests: null });
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
