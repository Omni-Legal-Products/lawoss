import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import { cp, mkdir, mkdtemp, realpath, rm, readdir, writeFile, readFile, lstat, symlink, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { initialize } from './prepare.mjs';
const require = createRequire(new URL('./tools/package.json', import.meta.url));
const cacache = createRequire(require.resolve('@npmcli/arborist'))('cacache');
const data = Buffer.from('accepted synthetic archive');
const record = { resolved: 'https://registry.npmjs.org/fixture/-/fixture-1.0.0.tgz', integrity: 'sha512-' + createHash('sha512').update(data).digest('base64') };
const limits = { requests: 32, archiveBytes: 64, totalBytes: 128, requestMs: 1000, deadlineMs: 2000 };
async function fixture(t) {
  const base = new URL('./.work/primer-tests/', import.meta.url); await mkdir(base, { recursive: true });
  const parent = await realpath(await mkdtemp(path.join(await realpath(base), 'case-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, 'owned'); await initialize(workspace); return workspace;
}
function transport(body = () => Readable.from([data]), status = 200) {
  const state = { calls: 0, closed: 0 };
  state.open = (url, callback) => {
    assert.equal(url, record.resolved); state.calls++;
    const request = new EventEmitter(); let closed = false;
    request.destroy = () => { if (!closed) { closed = true; queueMicrotask(() => { state.closed++; request.emit('close'); }); } };
    queueMicrotask(() => { if (!closed) { const response = body(); response.statusCode = status; response.headers = {}; response.once('close', () => request.destroy()); callback(response); } });
    return request;
  };
  return state;
}
const transfer = async () => (await import('./prime-transfer.mjs')).acquireArtifacts;

test('sequential exact artifacts flush real cacache and verify by digest', async t => {
  const workspace = await fixture(t); const wire = transport();
  const result = await (await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: wire.open, limits });
  assert.deepEqual(result, { records: 1, verified: 1, totalBytes: 26 });
  assert.equal(wire.calls, 1); assert.equal(wire.closed, 1);
  assert.deepEqual(await cacache.get.byDigest(path.join(workspace, 'cache'), record.integrity), data);
  assert.ok((await cacache.ls(path.join(workspace, 'cache')))['lawoss:accepted:' + record.resolved]);
});

test('unsafe allowlist is completely refused before transport', async t => {
  const workspace = await fixture(t);
  for (const invalid of [{ ...record, resolved: 'https://other.invalid/a.tgz' }, { ...record, integrity: 'bad' }, { ...record, resolved: record.resolved + '?x=1' }]) {
    const wire = transport();
    await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record, invalid], cacheApi: cacache, open: wire.open, limits }), { code: 'ALLOWLIST_INVALID' });
    assert.equal(wire.calls, 0);
  }
});

test('redirects and other statuses close without retries or cache success', async t => {
  const workspace = await fixture(t);
  for (const status of [301, 302, 307, 308, 404]) {
    const wire = transport(undefined, status);
    await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: wire.open, limits }), { code: 'HTTP_STATUS' });
    assert.equal(wire.calls, 1); assert.equal(wire.closed, 1);
  }
  assert.deepEqual(await cacache.ls(path.join(workspace, 'cache')), {});
});

test('truncated and wrong-integrity bodies never verify or retry', async t => {
  const workspace = await fixture(t);
  for (const body of [() => Readable.from([data.subarray(0, 5)]), () => Readable.from([Buffer.from('wrong')])]) {
    const wire = transport(body);
    await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: wire.open, limits }), { code: 'CACHE_INTEGRITY' });
    assert.equal(wire.calls, 1); assert.equal(wire.closed, 1);
  }
  assert.deepEqual(await cacache.ls(path.join(workspace, 'cache')), {});
});

test('actual streamed bytes enforce per-archive and cumulative limits', async t => {
  const workspace = await fixture(t);
  for (const [bounds, records, code, calls] of [
    [{ ...limits, archiveBytes: 25 }, [record], 'ARCHIVE_LIMIT', 1],
    [{ ...limits, totalBytes: 40 }, [record, record], 'TOTAL_LIMIT', 2],
    [{ ...limits, requests: 1 }, [record, record], 'ALLOWLIST_INVALID', 0],
  ]) {
    const wire = transport();
    await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records, cacheApi: cacache, open: wire.open, limits: bounds }), { code });
    assert.equal(wire.calls, calls); assert.equal(wire.closed, calls);
  }
});

test('headers and slow chunks share one absolute deadline, distinct from request timeout', async t => {
  const workspace = await fixture(t);
  const wire = transport(() => { const stream = new PassThrough(); const id = setInterval(() => stream.write(data.subarray(0, 1)), 10); stream.once('close', () => clearInterval(id)); return stream; });
  await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: wire.open, limits: { ...limits, deadlineMs: 45 } }), { code: 'PRIMER_DEADLINE' });
  assert.equal(wire.closed, 1);
  const pending = new EventEmitter(); let closed = false;
  pending.destroy = () => { closed = true; queueMicrotask(() => pending.emit('close')); };
  await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: () => pending, limits: { ...limits, requestMs: 20 } }), { code: 'REQUEST_TIMEOUT' });
  assert.equal(closed, true);
});

test('caller abort streaming and real cache put/read cancellation keep admission until actual settlement', async t => {
  const workspace = await fixture(t); const controller = new AbortController();
  const wire = transport(() => { const response = new PassThrough(); response.write(data.subarray(0, 1)); queueMicrotask(() => controller.abort()); return response; });
  await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record], cacheApi: cacache, open: wire.open, limits, signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(wire.closed, 1);
  // Private fault injection only: production uses the public promises, never these internals.
  const index = createRequire(createRequire(require.resolve('@npmcli/arborist')).resolve('cacache'))('./entry-index.js');
  const fs = require('node:fs/promises');
  for (const phase of ['put', 'read']) for (const trigger of ['abort', 'deadline', 'request']) {
    const owned = await fixture(t); const cache = path.join(owned, 'cache');
    const lease = path.join(owned, '.admit-primer'); await mkdir(lease);
    let release, enter, finish; let operationEntered = false; let operationFinished = false; let returned = false; let primary; let inserts = 0; let reads = 0;
    const gate = new Promise(resolve => { release = resolve; });
    const entered = new Promise(resolve => { enter = resolve; });
    const settled = new Promise(resolve => { finish = resolve; });
    const originalInsert = index.insert; const originalRead = fs.readFile; const originalTimer = globalThis.setTimeout;
    const delayOperation = async operation => { operationEntered = true; enter(); await gate; try { return await operation(); } finally { operationFinished = true; finish(); } };
    index.insert = (...args) => { inserts++; return phase === 'put' ? delayOperation(() => originalInsert(...args)) : originalInsert(...args); };
    fs.readFile = (name, ...args) => {
      if (typeof name !== 'string' || !name.startsWith(path.join(cache, 'content-v2') + path.sep)) return originalRead(name, ...args);
      reads++; return phase === 'read' ? delayOperation(() => originalRead(name, ...args)) : originalRead(name, ...args);
    };
    let elapsed = 0; let expire; let timerMock;
    const timerMilliseconds = trigger === 'request' ? 5000 : 10000;
    if (trigger !== 'abort') timerMock = t.mock.method(globalThis, 'setTimeout', (callback, milliseconds, ...args) => {
      if (milliseconds === timerMilliseconds) { expire = callback; return originalTimer(() => {}, milliseconds); }
      return originalTimer(callback, milliseconds, ...args);
    });
    const aborter = new AbortController(); const transportCase = transport();
    const pending = (await transfer())({ cache, records: [record, record], cacheApi: cacache, open: transportCase.open, signal: aborter.signal, now: () => elapsed, limits: { ...limits, deadlineMs: 10000, requestMs: trigger === 'request' ? 5000 : 20000 } })
      .catch(error => { primary = error; }).finally(async () => { await rmdir(lease); returned = true; });
    try {
      await Promise.race([entered, pending.then(() => { throw Error('cache operation never entered'); })]);
      if (trigger === 'abort') aborter.abort(); else { assert.equal(typeof expire, 'function'); elapsed = timerMilliseconds; expire(); }
      await new Promise(resolve => originalTimer(resolve, 30));
      assert.equal(returned, false, `${phase}/${trigger}: return must wait for real pinned cacache settlement`);
      assert.equal(operationFinished, false); assert.equal((await lstat(lease)).isDirectory(), true);
      assert.equal(transportCase.calls, 1, 'no next request during cancellation cleanup');
      release(); await settled; await pending;
      assert.equal(primary?.code, trigger === 'abort' ? 'CANCELLED' : trigger === 'deadline' ? 'PRIMER_DEADLINE' : 'REQUEST_TIMEOUT');
      assert.equal(operationFinished, true); assert.equal(returned, true); assert.equal(transportCase.calls, 1);
      assert.equal(inserts, 1); assert.equal(reads, phase === 'put' ? 0 : 1, 'no later verification after cancellation');
      assert.equal(primary.progress.verified, 0);
      assert.equal((await readdir(owned)).includes('.admit-primer'), false);
    } finally {
      release(); await pending; if (operationEntered) await settled;
      index.insert = originalInsert; fs.readFile = originalRead; timerMock?.mock.restore();
    }
  }
});

test('public primer rejects dirty/symlink caches and immutable input drift before any transport', async t => {
  const { primeAcceptedCache, acceptedArtifacts } = await import('./prime-cache.mjs');
  const accepted = await acceptedArtifacts(); assert.equal(accepted.records.length, 32);
  const workspace = await fixture(t); await writeFile(path.join(workspace, 'cache/keep'), 'keep');
  await assert.rejects(primeAcceptedCache({ workspace }), { code: 'CACHE_NOT_EMPTY' });
  assert.equal(await readFile(path.join(workspace, 'cache/keep'), 'utf8'), 'keep');
  assert.equal((await readdir(workspace)).includes('acquisition.json'), false);
  await assert.rejects(primeAcceptedCache({ workspace, url: record.resolved }), { code: 'ARGUMENT_INVALID' });
  await rm(path.join(workspace, 'cache'), { recursive: true }); await symlink(path.join(workspace, 'home'), path.join(workspace, 'cache'), 'dir');
  await assert.rejects(primeAcceptedCache({ workspace }), { code: 'WORKSPACE_INVALID' });
});

test('public primer respects concurrent admission and leaves foreign ownership untouched', async t => {
  const { primeAcceptedCache } = await import('./prime-cache.mjs'); const workspace = await fixture(t);
  const admission = path.join(workspace, '.admit-primer'); await mkdir(admission); const before = await lstat(admission);
  await assert.rejects(primeAcceptedCache({ workspace }), { code: 'PRIMER_BUSY' });
  assert.equal((await lstat(admission)).ino, before.ino);
  assert.deepEqual(await readdir(path.join(workspace, 'cache')), []);
});


test('unchanged accepted hashes gate precedes transport and incomplete receipt cannot replay', async t => {
  const { primeAcceptedCache } = await import('./prime-cache.mjs'); const workspace = await fixture(t);
  await assert.rejects(primeAcceptedCache({ workspace }), { code: 'NETWORK_DISABLED' });
  assert.equal(JSON.parse(await readFile(path.join(workspace, 'acquisition.json'))).outcome, 'incomplete');
  assert.equal((await readdir(workspace)).includes('.admit-primer'), false);
  await assert.rejects(primeAcceptedCache({ workspace }), { code: 'EEXIST' });
  assert.deepEqual(await readdir(path.join(workspace, 'cache')), []);
  const source = path.join(workspace, 'home/source'); await mkdir(source);
  for (const name of ['prime-cache.mjs', 'prime-transfer.mjs', 'prepare.mjs', 'validate.mjs', 'sdk/package.json', 'sdk/package-lock.json', 'tools/pnpm-lock.yaml']) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    await cp(new URL('./' + name, import.meta.url), path.join(source, name));
  }
  await writeFile(path.join(source, 'sdk/package.json'), '{}');
  const copy = await import(pathToFileURL(path.join(source, 'prime-cache.mjs')).href);
  await assert.rejects(copy.acceptedArtifacts(), { code: 'INPUT_DRIFT' });
});

test('absolute budget is shared across sequential requests rather than reset per artifact', async t => {
  const workspace = await fixture(t);
  const wire = transport(); let elapsed = 0;
  const open = (...args) => { elapsed += 1200; return wire.open(...args); };
  await assert.rejects((await transfer())({ cache: path.join(workspace, 'cache'), records: [record, record], cacheApi: cacache, open, now: () => elapsed, limits }), error => error.code === 'PRIMER_DEADLINE' && error.progress.verified === 1);
  assert.equal(wire.calls, 2); assert.equal(wire.closed, 2);
});
