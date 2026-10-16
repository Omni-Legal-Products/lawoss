import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fork } from 'node:child_process';
import { once } from 'node:events';
const root = fileURLToPath(new URL('./.work/test-fixtures/', import.meta.url));
import { withEngineDependencyLease } from './dependency-lease.mjs';
import { createHash } from 'node:crypto';
const cleanups = new WeakMap();
async function fixture(t) {
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'lease-'));
  cleanups.set(t, []);
  t.after(async () => {
    for (const cleanup of cleanups.get(t).reverse()) await cleanup();
    await fs.rm(dir, { recursive: true, force: true });
  });
  return dir;
}
async function peer(t, state, logical) {
  const env = Object.fromEntries(['PATH', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP'].filter(k => process.env[k]).map(k => [k, process.env[k]]));
  env.HOME = state; env.USERPROFILE = state;
  const child = fork(fileURLToPath(new URL('./fixtures/dependency-lease-peer.mjs', import.meta.url)), [state, logical], { execPath: process.execPath, env, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  let childError;
  child.on('error', error => { childError = error; });
  let closeReceipt;
  const closed = new Promise(resolve => child.once('close', (...args) => { closeReceipt = args; resolve(args); }));
  let released = false;
  let receipt = false;
  child.on('message', message => { if (message === 'released') receipt = true; });
  async function release() {
    if (released) return;
    released = true;
    if (!closeReceipt && child.connected) child.send('release');
    const timeout = setTimeout(() => child.kill(), 3000);
    try { const [code] = await closed; if (childError) throw childError; assert.equal(code, 0); assert.equal(receipt, true); } finally { clearTimeout(timeout); }
  }
  cleanups.get(t).push(release);
  const startupTimer = setTimeout(() => child.kill(), 3000);
  try {
    const ready = await Promise.race([once(child, 'message'), closed.then(() => { throw new Error('PEER_CLOSED_BEFORE_READY'); })]);
    assert.equal(ready[0], 'ready');
  } finally { clearTimeout(startupTimer); }
  return release;
}
test('real protocol peer excludes callback, then close permits normal acquisition', { timeout: 6000 }, async t => {
  const stateDirectory = await fixture(t);
  const release = await peer(t, stateDirectory, 'logical/../exact');
  let entered = false;
  await assert.rejects(withEngineDependencyLease({ stateDirectory, logicalDirectories: ['logical/../exact'], deadline: Date.now() + 180 }, async () => { entered = true; }), /DEADLINE/);
  assert.equal(entered, false);
  await release();
  await withEngineDependencyLease({ stateDirectory, logicalDirectories: ['logical/../exact'], deadline: Date.now() + 1000 }, async () => { entered = true; });
  assert.equal(entered, true);
  assert.deepEqual(await fs.readdir(path.join(stateDirectory, 'locks')), []);
});
const lockPath = (state, logical) => path.join(state, 'locks', createHash('sha1').update(`npm-install:${logical}`).digest('hex') + '.lock');
const options = (stateDirectory, logicalDirectories = ['target'], milliseconds = 2000) => ({ stateDirectory, logicalDirectories, deadline: Date.now() + milliseconds });
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function present(file) { return fs.stat(file).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; }); }
async function seed(state, logical, mode = 'heartbeat') {
  const dir = lockPath(state, logical);
  await fs.mkdir(dir, { recursive: true });
  if (mode !== 'dir') await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ token: 'fixture-token', pid: process.pid, hostname: 'fixture', createdAt: new Date().toISOString() }));
  if (mode === 'heartbeat') await fs.writeFile(path.join(dir, 'heartbeat'), '');
  return dir;
}
function allErrors(error) { return [error, ...(error instanceof AggregateError ? error.errors.flatMap(allErrors) : [])]; }

test('aborted waiter leaves actual peer lock intact', { timeout: 6000 }, async t => {
  const state = await fixture(t);
  await peer(t, state, 'target');
  const dir = lockPath(state, 'target');
  const before = await fs.readFile(path.join(dir, 'meta.json'));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error('CALLER_ABORT')), 70);
  try { await assert.rejects(withEngineDependencyLease({ ...options(state), signal: controller.signal }, async () => assert.fail('entered')), /CALLER_ABORT/); }
  finally { clearTimeout(timer); }
  assert.deepEqual(await fs.readFile(path.join(dir, 'meta.json')), before);
});

test('exact aliases are unique and sorted; partial failure releases in reverse order', async t => {
  const state = await fixture(t);
  await seed(state, 'z');
  const original = fs.rm;
  const removed = [];
  t.mock.method(fs, 'rm', async (file, ...rest) => { removed.push(file); return original(file, ...rest); });
  await assert.rejects(withEngineDependencyLease(options(state, ['z', 'b', 'a/../b', 'b'], 160), async () => assert.fail('entered')), /DEADLINE/);
  assert.deepEqual(removed, [lockPath(state, 'b'), lockPath(state, 'a/../b')]);
  assert.equal(await present(lockPath(state, 'z')), true);
});

for (const mode of ['heartbeat', 'meta', 'dir']) {
  test(`stale ${mode} fallback is recovered through breaker`, async t => {
    const state = await fixture(t);
    const dir = await seed(state, 'target', mode);
    const file = mode === 'dir' ? dir : path.join(dir, mode === 'meta' ? 'meta.json' : 'heartbeat');
    const old = new Date(Date.now() - 65_000);
    await fs.utimes(file, old, old);
    let entered = false;
    await withEngineDependencyLease(options(state), async () => { entered = true; });
    assert.equal(entered, true);
    assert.deepEqual(await fs.readdir(path.dirname(dir)), []);
  });
}

test('breaker rechecks refreshed heartbeat and does not evict owner', async t => {
  const state = await fixture(t);
  const dir = await seed(state, 'target');
  const hb = path.join(dir, 'heartbeat');
  const old = new Date(Date.now() - 65_000);
  await fs.utimes(hb, old, old);
  const original = fs.mkdir;
  t.mock.method(fs, 'mkdir', async (file, ...rest) => {
    const value = await original(file, ...rest);
    if (file === dir + '.breaker') { const now = new Date(); await fs.utimes(hb, now, now); }
    return value;
  });
  await assert.rejects(withEngineDependencyLease(options(state, ['target'], 150), async () => assert.fail('entered')), /DEADLINE/);
  assert.equal((JSON.parse(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'))).token, 'fixture-token');
  assert.equal(await present(dir + '.breaker'), false);
});

test('stale breaker is recovered without skipping the lock recheck', async t => {
  const state = await fixture(t);
  const dir = await seed(state, 'target', 'dir');
  await fs.mkdir(dir + '.breaker');
  const old = new Date(Date.now() - 65_000);
  await fs.utimes(dir, old, old); await fs.utimes(dir + '.breaker', old, old);
  await withEngineDependencyLease(options(state), async () => {});
  assert.deepEqual(await fs.readdir(path.dirname(dir)), []);
});

for (const replacement of ['successor', 'malformed', 'oversize']) {
  test(`release refuses ${replacement} metadata and preserves tree with primary error`, async t => {
    const state = await fixture(t);
    const dir = lockPath(state, 'target');
    const primary = new Error('CALLBACK_PRIMARY');
    await assert.rejects(withEngineDependencyLease(options(state), async () => {
      const file = path.join(dir, 'meta.json');
      const meta = JSON.parse(await fs.readFile(file, 'utf8'));
      await fs.writeFile(file, replacement === 'successor' ? JSON.stringify({ ...meta, token: 'successor' }) : replacement === 'malformed' ? '{bad' : 'x'.repeat(65537));
      await fs.writeFile(path.join(dir, 'successor-marker'), 'preserve');
      throw primary;
    }), error => {
      assert.equal(error.errors[0], primary);
      assert.ok(allErrors(error).some(e => e.code === (replacement === 'successor' ? 'LEASE_TOKEN_MISMATCH' : 'LEASE_METADATA_INVALID')));
      return true;
    });
    assert.equal(await fs.readFile(path.join(dir, 'successor-marker'), 'utf8'), 'preserve');
  });
}

test('callback cancellation keeps lease until controlled work settles', async t => {
  const state = await fixture(t);
  const controller = new AbortController();
  const started = deferred(); const work = deferred(); const cancelled = deferred();
  const running = withEngineDependencyLease({ ...options(state), signal: controller.signal }, async signal => {
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    started.resolve();
    await work.promise;
  });
  const rejected = assert.rejects(running, /CALLER_ABORT/);
  await started.promise;
  controller.abort(new Error('CALLER_ABORT'));
  await cancelled.promise;
  assert.equal(await present(lockPath(state, 'target')), true);
  await assert.rejects(withEngineDependencyLease(options(state, ['target'], 90), async () => assert.fail('early entry')), /DEADLINE/);
  work.resolve();
  await rejected;
  assert.equal(await present(lockPath(state, 'target')), false);
});

test('deadline signals callback but awaits its cleanup beyond deadline', async t => {
  const state = await fixture(t);
  const work = deferred(); const cancelled = deferred();
  const running = withEngineDependencyLease(options(state, ['target'], 100), async signal => {
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    await work.promise;
  });
  const rejected = assert.rejects(running, /DEADLINE/);
  await cancelled.promise;
  assert.equal(await present(lockPath(state, 'target')), true);
  work.resolve(); await rejected;
  assert.equal(await present(lockPath(state, 'target')), false);
});

test('initialization conflict retains uncertain ownership without deleting foreign files', async t => {
  const state = await fixture(t);
  const dir = lockPath(state, 'target');
  const original = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (file, ...args) => {
    if (file === path.join(dir, 'meta.json')) await original(file, 'foreign', { flag: 'wx' });
    return original(file, ...args);
  });
  await assert.rejects(withEngineDependencyLease(options(state), async () => assert.fail('entered')), /STATE_RETAINED/);
  assert.equal(await fs.readFile(path.join(dir, 'meta.json'), 'utf8'), 'foreign');
});

test('abort after awaited acquisition releases owned key without calling operation', async t => {
  const state = await fixture(t);
  const controller = new AbortController();
  const original = fs.writeFile;
  t.mock.method(fs, 'writeFile', async (...args) => {
    const result = await original(...args);
    if (args[0].endsWith('meta.json')) controller.abort(new Error('ACQUIRE_ABORT'));
    return result;
  });
  await assert.rejects(withEngineDependencyLease({ ...options(state), signal: controller.signal }, async () => assert.fail('entered')), /ACQUIRE_ABORT/);
  assert.deepEqual(await fs.readdir(path.join(state, 'locks')), []);
});

test('initial heartbeat fault refuses callback entry and is retained', async t => {
  const state = await fixture(t);
  const original = fs.open;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (args[0].endsWith('heartbeat')) handle.utimes = async () => { throw new Error('HEARTBEAT_IO'); };
    return handle;
  });
  let entered = false;
  await assert.rejects(withEngineDependencyLease(options(state), async () => { entered = true; }), error => {
    assert.ok(allErrors(error).some(e => e.message === 'HEARTBEAT_IO')); return true;
  });
  assert.equal(entered, false);
  assert.deepEqual(await fs.readdir(path.join(state, 'locks')), []);
});

test('pending heartbeat is drained before removal and cannot update successor', { timeout: 30_000 }, async t => {
  const state = await fixture(t);
  const original = fs.open;
  const writeStarted = deferred(); const allowWrite = deferred(); const work = deferred();
  let writes = 0; let completedWrites = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (args[0].endsWith('heartbeat')) {
      const utimes = handle.utimes.bind(handle);
      handle.utimes = async (...times) => {
        if (++writes === 2) { writeStarted.resolve(); await allowWrite.promise; }
        await utimes(...times); completedWrites++;
      };
    }
    return handle;
  });
  let finished = false;
  const running = withEngineDependencyLease(options(state, ['target'], 27_000), async () => work.promise).then(() => { finished = true; });
  await writeStarted.promise;
  work.resolve();
  // Await real filesystem I/O after callback settlement, not a timer-only release assumption.
  assert.equal(await present(lockPath(state, 'target')), true);
  assert.equal(finished, false);
  assert.equal(completedWrites, 1);
  allowWrite.resolve(); await running;
  assert.equal(completedWrites, 2);
  const dir = await seed(state, 'target');
  const hb = path.join(dir, 'heartbeat');
  const marker = new Date(Date.now() - 10_000);
  await fs.utimes(hb, marker, marker);
  const before = (await fs.stat(hb)).mtimeMs;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal((await fs.stat(hb)).mtimeMs, before);
  assert.equal(completedWrites, 2);
});

test('periodic token compromise cancels pending operation and retains successor until work settles', async t => {
  const state = await fixture(t);
  const originalTimer = globalThis.setTimeout;
  let tick;
  t.mock.method(globalThis, 'setTimeout', (callback, delay, ...args) => {
    if (delay === 20_000) { tick = callback; return undefined; }
    return originalTimer(callback, delay, ...args);
  });
  const started = deferred(); const cancelled = deferred(); const work = deferred();
  let settled = false;
  const running = withEngineDependencyLease(options(state), async signal => {
    signal.addEventListener('abort', () => cancelled.resolve(), { once: true });
    started.resolve(); await work.promise;
  });
  const rejected = assert.rejects(running, error => {
    settled = true;
    assert.ok(allErrors(error).some(e => e.code === 'LEASE_TOKEN_MISMATCH')); return true;
  });
  await started.promise;
  const dir = lockPath(state, 'target');
  const file = path.join(dir, 'meta.json');
  const meta = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.writeFile(file, JSON.stringify({ ...meta, token: 'successor' }));
  tick(); await cancelled.promise;
  assert.equal(settled, false);
  assert.equal(await present(dir), true);
  work.resolve(); await rejected;
  assert.equal((JSON.parse(await fs.readFile(file, 'utf8'))).token, 'successor');
});

test('metadata growth after stat remains bounded and refuses release', async t => {
  const state = await fixture(t);
  const original = fs.open;
  let grow = false;
  let maximumReadEnd = 0;
  t.mock.method(fs, 'open', async (...args) => {
    const handle = await original(...args);
    if (grow && args[0].endsWith('meta.json')) {
      const stat = handle.stat.bind(handle);
      handle.stat = async () => {
        const info = await stat();
        await fs.appendFile(args[0], 'x'.repeat(100_000));
        return info;
      };
      const read = handle.read.bind(handle);
      handle.read = async (buffer, offset, length, position) => {
        maximumReadEnd = Math.max(maximumReadEnd, offset + length);
        return read(buffer, offset, length, position);
      };
    }
    return handle;
  });
  await assert.rejects(withEngineDependencyLease(options(state), async () => { grow = true; }), error => {
    assert.ok(allErrors(error).some(e => e.code === 'LEASE_METADATA_INVALID')); return true;
  });
  assert.equal(maximumReadEnd, 65537);
  assert.equal(await present(lockPath(state, 'target')), true);
});

for (const phase of ['stat', 'read', 'utimes']) {
  for (const simultaneous of [true, false]) {
    test(`initial ${phase} handle retains ${simultaneous ? 'I/O and close failures' : 'close-only failure'}`, async t => {
      const state = await fixture(t);
      const originalOpen = fs.open;
      const primary = new Error(`INITIAL_${phase.toUpperCase()}`);
      const closeFailure = new Error('HANDLE_CLOSE_FAILURE');
      let injected = false;
      let reallyClosed = false;
      let entered = false;
      t.mock.method(fs, 'open', async (...args) => {
        const handle = await originalOpen(...args);
        const target = phase === 'utimes' ? 'heartbeat' : 'meta.json';
        if (!injected && args[0].endsWith(target)) {
          injected = true;
          if (simultaneous) handle[phase] = async () => { throw primary; };
          const close = handle.close.bind(handle);
          handle.close = async () => {
            await close();
            reallyClosed = true;
            throw closeFailure;
          };
        }
        return handle;
      });
      await assert.rejects(withEngineDependencyLease(options(state), async () => { entered = true; }), error => {
        const errors = allErrors(error);
        if (simultaneous) assert.ok(errors.includes(primary), 'original I/O error identity retained');
        assert.ok(errors.includes(closeFailure), 'close error identity retained');
        // The outer lease error contract remains unchanged for close-only failure.
        if (!simultaneous) assert.equal(error.errors[0], closeFailure);
        return true;
      });
      assert.equal(injected, true);
      assert.equal(reallyClosed, true);
      assert.equal(entered, false);
      assert.deepEqual(await fs.readdir(path.join(state, 'locks')), []);
    });
  }
}
