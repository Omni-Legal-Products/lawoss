import '../build/plugin-payload/network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { mkdtemp, mkdir, writeFile, chmod, lstat, readFile, rm, readdir, rename } from 'node:fs/promises';
import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runOwnedStageDecoder } from './sdk-stage-decoder-supervisor.mjs';
import { encodeStageWireFrame } from './sdk-stage-decoder-wire.mjs';
import { withEngineDependencyLease } from './dependency-lease.mjs';
import { createStageBundleFixture } from './test-fixtures/sdk-stage-decoder-bundle-fixture.mjs';
import { hostTarget, metadata } from '../build/plugin-payload/embedded-runtime-verifier-fixture.mjs';
import { inventory, SDK_LOCK_SHA256, sdkConsumerMode, sha256 } from '../build/plugin-payload/validate.mjs';
const node22 = fileURLToPath(new URL('../../apps/desktop/resources/node/node', import.meta.url));
const bun = '/Users/vojte/Projects/lawoss-local-tests/toolchains/bun-1.4.2-darwin-aarch64/bun-darwin-aarch64/bun';
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const id = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const result = r => ({ schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: r.generation,
  stageIdentity: r.stageGrant.identity, capsuleSha256: r.sdkIdentity.capsule.sha256, manifestSha256: r.sdkIdentity.manifestSha256, verifierSha256: r.sdkIdentity.verifierSha256 });
async function descriptor(worker, workDirectory) {
  const n = await lstat(node22, { bigint: true }), w = await lstat(worker, { bigint: true }), d = await lstat(workDirectory, { bigint: true });
  return Object.freeze({ schema: 1, kind: 'lawoss-sdk-stage-test-launch', provenance: 'test-owned-bundle-v1', nodePath: node22,
    nodeDev: String(n.dev), nodeIno: String(n.ino), nodeBytes: Number(n.size), nodeSha256: sha256(await readFile(node22)),
    workerPath: worker, workerDev: String(w.dev), workerIno: String(w.ino), workerBytes: Number(w.size), workerSha256: sha256(await readFile(worker)),
    workDirectory, workDev: String(d.dev), workIno: String(d.ino), systemRoot: process.platform === 'win32' ? process.env.SystemRoot : null });
}
async function fixture(t, behavior = 'success') {
  const base = await mkdtemp(path.join(await fs.realpath(tmpdir()), 'lawoss-b2-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const stage = path.join(base, 'parent', 'stage'), resourceRoot = path.join(base, 'resources'), workDirectory = path.join(base, 'code');
  await mkdir(stage, { recursive: true, mode: 0o700 }); await mkdir(resourceRoot); await mkdir(workDirectory, { mode: 0o700 });
  await writeFile(path.join(resourceRoot, 'payload.tgz'), 'synthetic inert capsule');
  const worker = path.join(workDirectory, 'worker.mjs');
  const module = fileURLToPath(new URL('./test-fixtures/sdk-stage-supervisor-child-fixture.mjs', import.meta.url));
  await writeFile(worker, `import { ${behavior} } from ${JSON.stringify(module)}; await ${behavior}();\n`, { mode: 0o600 });
  const request = { schema: 1, kind: 'lawoss-sdk-stage-decode', generation: 'a'.repeat(32), resourceRoot, resourceIdentity: id(await lstat(resourceRoot, { bigint: true })),
    stageGrant: { path: stage, identity: id(await lstat(stage, { bigint: true })), parent: { path: path.dirname(stage), ...id(await lstat(path.dirname(stage), { bigint: true })) } },
    sdkIdentity: { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', target: hostTarget, manifestSha256: '1'.repeat(64), lockSha256: SDK_LOCK_SHA256,
      inputSha256: sha256(metadata.acceptedInputText), sourceSetSha256: '2'.repeat(64), consumerMode: sdkConsumerMode(hostTarget, SDK_LOCK_SHA256), verifierSha256: '3'.repeat(64),
      capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: sha256(Buffer.from('synthetic inert capsule')), bytes: 23 } }, deadline: Date.now() + 60000 };
  return { base, stage, resourceRoot, request, launch: await descriptor(worker, workDirectory) };
}
function model() {
  const child = new EventEmitter(); child.stdin = new Writable({ write(_bytes, _encoding, callback) { callback(); } });
  child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.kill = () => true;
  const spawned = deferred();
  return { child, spawned, close(code = 0, signal = null) { child.stdin.destroy(); child.stdout.destroy(); child.stderr.destroy(); child.emit('close', code, signal); } };
}
async function patchedSpawn(spawn, operation) {
  const original = cp.spawn; cp.spawn = spawn; syncBuiltinESMExports();
  try { return await operation(); } finally { cp.spawn = original; syncBuiltinESMExports(); }
}
function outcome(promise) { const state = { settled: false }; state.promise = promise.then(value => { state.settled = true; return { value }; }, error => { state.settled = true; return { error }; }); return state; }
const options = (f, signal) => ({ launch: f.launch, request: f.request, deadline: f.request.deadline, ...(signal ? { signal } : {}) });

test('lifecycle RED: response and exit cannot release unchanged lease before modeled close', async t => {
  const f = await fixture(t), m = model(), entered = deferred();
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(withEngineDependencyLease({ stateDirectory: path.join(f.base, 'state'), logicalDirectories: ['b2:synthetic:a', 'b2:synthetic:b'], deadline: f.request.deadline }, async signal => {
      entered.resolve(); return runOwnedStageDecoder(options(f, signal));
    }));
    await entered.promise; await Promise.race([m.spawned.promise, pending.promise.then(value => { throw value.error ?? new Error('unexpected early settlement'); })]); await pause(5);
    m.child.stdout.end(encodeStageWireFrame(result(f.request), 'terminal')); m.child.stderr.end(); m.child.emit('exit', 0, null);
    try { await pause(40); assert.equal(pending.settled, false, 'reply/exit released owner before close'); assert.equal((await readdir(path.join(f.base, 'state', 'locks'))).length, 2); }
    finally { m.close(); await pending.promise; }
  });
});
test('lifecycle RED: late valid response cannot defeat cancellation', async t => {
  const f = await fixture(t), m = model(), abort = new AbortController();
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(runOwnedStageDecoder(options(f, abort.signal)));
    await Promise.race([m.spawned.promise, pending.promise.then(value => { throw value.error ?? new Error('unexpected early settlement'); })]); await pause(5); abort.abort();
    m.child.stdout.end(encodeStageWireFrame(result(f.request), 'terminal')); m.child.stderr.end(); m.child.emit('exit', 0, null); m.close();
    const actual = await pending.promise; assert.equal(actual.error?.code, 'STAGE_ABORTED');
  });
});

// Instrument only the test process's builtin binding. Real process/pipe close
// observations are recorded independently and never emitted by this harness.
async function realSpawn(f, operation, replacement) {
  const original = cp.spawn, captured = deferred(), events = [];
  let retained, child, nativeKill;
  await patchedSpawn((executable, argv, settings) => {
    assert.equal(executable, f.launch.nodePath); assert.deepEqual(argv, [f.launch.workerPath]);
    assert.deepEqual(settings.env, process.platform === 'win32' ? { SystemRoot: f.launch.systemRoot } : {});
    assert.equal(settings.shell, false); assert.equal(settings.detached, false); assert.equal(settings.cwd, f.launch.workDirectory);
    child = replacement ? replacement(original, executable, argv, settings) : original(executable, argv, settings);
    nativeKill = child.kill.bind(child);
    const mark = (event, detail) => events.push({ event, at: performance.now(), ...detail });
    retained = f.retainChild?.(child);
    child.on('exit', (code, signal) => mark('exit', { code, signal }));
    child.on('close', (code, signal) => mark('close', { code, signal }));
    for (const stream of ['stdin', 'stdout', 'stderr']) {
      child[stream].on('close', () => mark(`${stream}:close`));
      if (stream !== 'stdin') child[stream].on('end', () => mark(`${stream}:end`));
    }
    child.stdout.on('data', () => mark('reply-data'));
    child.stderr.on('data', () => mark('stderr-data'));
    captured.resolve(child); return child;
  }, async () => {
    // Watchdog belongs to the fixture, uses retained native direct-child method,
    // and never removes data if the real close/pipe barrier cannot be observed.
    const watchdog = setTimeout(() => { if (child && !events.some(e => e.event === 'close')) nativeKill('SIGKILL'); }, 50000);
    try { await operation({ captured: captured.promise, events, nativeKill: (...args) => nativeKill(...args), retained: () => retained }); }
    finally {
      clearTimeout(watchdog);
      if (child && !events.some(e => e.event === 'close')) {
        nativeKill('SIGKILL'); await new Promise(resolve => child.once('close', resolve));
      }
      for (const stream of ['stdin', 'stdout', 'stderr']) if (child && !events.some(e => e.event === `${stream}:close`)) await new Promise(resolve => child[stream].once('close', resolve));
    }
  });
  return events;
}
async function startCaptured(pending, captured) {
  return Promise.race([captured, pending.promise.then(actual => { throw actual.error ?? new Error('settled before spawn'); })]);
}
function closedBeforeSettlement(events) {
  const settlement = events.find(e => e.event === 'settlement'); assert.ok(settlement);
  for (const event of ['close', 'stdin:close', 'stdout:close', 'stderr:close']) assert.ok(events.find(e => e.event === event)?.at <= settlement.at, `${event} before settlement`);
}
function diagnostic(t, events) { t.diagnostic(JSON.stringify(events)); }

test('actual B1 CJS bundle runs real A: ClosedStage follows direct child and three pipe closes; resource inventory unchanged', async t => {
  assert.equal(process.version, 'v22.23.2');
  const f = await createStageBundleFixture(t, { node22, bun });
  await chmod(f.codeDirectory, 0o700); await chmod(f.worker, 0o600);
  f.launch = await descriptor(f.worker, f.codeDirectory);
  const before = await inventory(f.resourceRoot);
  await realSpawn(f, async ({ captured, events, retained }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, captured);
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.ifError(actual.error); assert.deepEqual(actual.value.result, result(f.request)); assert.equal(actual.value.kind, 'lawoss-sdk-closed-stage');
    assert.deepEqual({ ...retained() }, { close: true, stdin: true, stdout: true, stderr: true });
    closedBeforeSettlement(events); diagnostic(t, events);
  });
  assert.deepEqual(await inventory(f.resourceRoot), before);
  assert.deepEqual(await inventory(f.stage), f.stageInventory);
  t.diagnostic(JSON.stringify({ actualB1: f.provenance, stageEntries: f.stageInventory.length, resourceEntries: before.length }));
});

test('actual response before exit remains pending; abort closes retained child before refusal', async t => {
  const f = await fixture(t, 'holdReply'), abort = new AbortController();
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f, abort.signal))), child = await startCaptured(pending, captured);
    await new Promise(resolve => child.stdout.once('end', resolve));
    await pause(25); assert.equal(pending.settled, false); assert.ok(!events.some(e => e.event === 'exit'));
    abort.abort(); const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error.code, 'STAGE_ABORTED'); closedBeforeSettlement(events); diagnostic(t, events);
  });
});

test('actual blocked synchronous child preserves unchanged two-alias lease beyond actual 20s heartbeat, then close -> callback -> removal', async t => {
  const f = await fixture(t, 'blocked'), abort = new AbortController(), stateDirectory = path.join(f.base, 'state');
  let ticks = 0;
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(withEngineDependencyLease({ stateDirectory, logicalDirectories: ['b2:synthetic:heartbeat:a', 'b2:synthetic:heartbeat:b'], deadline: f.request.deadline, signal: abort.signal }, async signal => {
      try { return await runOwnedStageDecoder(options(f, signal)); }
      finally { events.push({ event: 'callback-settlement', at: performance.now() }); }
    }));
    const child = await startCaptured(pending, captured);
    await new Promise(resolve => child.stderr.once('data', bytes => { assert.equal(bytes.toString(), 'READY'); resolve(); }));
    const locks = path.join(stateDirectory, 'locks'), names = await readdir(locks); assert.equal(names.length, 2);
    const heartbeats = names.map(name => path.join(locks, name, 'heartbeat'));
    const initial = await Promise.all(heartbeats.map(file => lstat(file)));
    const tick = setInterval(() => { ticks++; }, 25);
    try {
      await pause(20500);
      const after = await Promise.all(heartbeats.map(file => lstat(file)));
      assert.ok(after.every((stat, index) => stat.mtimeMs > initial[index].mtimeMs));
      assert.equal((await readdir(locks)).length, 2); assert.equal(pending.settled, false); assert.ok(ticks > 100);
      events.push({ event: 'actual-heartbeat', at: performance.now(), before: initial.map(s => s.mtimeMs), after: after.map(s => s.mtimeMs), ticks });
    } finally { clearInterval(tick); abort.abort(); }
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() }); assert.equal(actual.error.code, 'STAGE_ABORTED');
    assert.deepEqual(await readdir(locks), []); events.push({ event: 'locks-absent-after-callback', at: performance.now() });
    closedBeforeSettlement(events); assert.ok(events.find(e => e.event === 'close').at <= events.find(e => e.event === 'callback-settlement').at);
    diagnostic(t, events);
  });
});

for (const [behavior, code] of [['partial', 'STAGE_PROTOCOL_INVALID'], ['extra', 'STAGE_PROTOCOL_INVALID'], ['duplicate', 'STAGE_PROTOCOL_INVALID'],
  ['badNonce', 'STAGE_PROTOCOL_INVALID'], ['declared', 'STAGE_OUTPUT_LIMIT'], ['flood', 'STAGE_OUTPUT_LIMIT'], ['stderrOverflow', 'STAGE_OUTPUT_LIMIT'],
  ['nonzero', 'STAGE_CHILD_FAILED'], ['signalExit', 'STAGE_CHILD_FAILED'], ['noResult', 'STAGE_PROTOCOL_INVALID'], ['childError', 'STAGE_VERIFY_FAILED'],
  ['errorExitZero', 'STAGE_PROTOCOL_INVALID']]) test(`actual finite inert ${behavior} refuses after real close (${code})`, async t => {
  const f = await fixture(t, behavior);
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, captured);
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error?.code, code); closedBeforeSettlement(events); diagnostic(t, events);
    assert.equal((await readdir(f.stage)).length, 0); assert.equal((await readFile(path.join(f.resourceRoot, 'payload.tgz'))).toString(), 'synthetic inert capsule');
  });
});

test('actual parent deadline beats a late candidate success', async t => {
  const f = await fixture(t, 'late'); f.request.deadline = Date.now() + 220;
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, captured);
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error?.code, 'STAGE_DEADLINE'); closedBeforeSettlement(events); diagnostic(t, events);
  });
});

test('already aborted/expired and closed options/launch/proxy/native-signal admission start no child', async t => {
  const f = await fixture(t); let spawns = 0;
  await patchedSpawn(() => { spawns++; throw new Error('forbidden'); }, async () => {
    const abort = new AbortController(); abort.abort();
    await assert.rejects(runOwnedStageDecoder(options(f, abort.signal)), { code: 'STAGE_ABORTED' });
    const expired = { ...f.request, deadline: Date.now() - 1 };
    await assert.rejects(runOwnedStageDecoder({ launch: f.launch, request: expired, deadline: expired.deadline }), { code: 'STAGE_DEADLINE' });
    let traps = 0; const proxy = new Proxy({}, { ownKeys() { traps++; throw new Error(); }, getPrototypeOf() { traps++; throw new Error(); } });
    const bad = [null, 7, 'invalid', proxy, { ...options(f), extra: true }, { ...options(f), deadline: f.request.deadline + 1 }, { ...options(f), signal: {} }, { ...options(f), signal: proxy },
      { ...options(f), request: { ...f.request, stageGrant: proxy } }];
    for (const input of bad) await assert.rejects(runOwnedStageDecoder(input), { code: 'STAGE_REQUEST_INVALID' });
    for (const launch of [proxy, { ...f.launch, nodeSha256: {} }, { ...f.launch, nodeBytes: 512 * 1024 * 1024 + 1 }, { ...f.launch, workerBytes: 16 * 1024 * 1024 + 1 },
      { ...f.launch, workerIno: '01' }, { ...f.launch, systemRoot: '/unneeded' }, { ...f.launch, extra: true }, { ...f.launch, nodeSha256: 'a'.repeat(64) }]) {
      await assert.rejects(runOwnedStageDecoder({ ...options(f), launch }), { code: 'STAGE_LAUNCH_MISMATCH' });
    }
    const getter = { ...f.launch }; Object.defineProperty(getter, 'workerPath', { enumerable: true, get() { traps++; throw new Error(); } });
    await assert.rejects(runOwnedStageDecoder({ ...options(f), launch: getter }), { code: 'STAGE_LAUNCH_MISMATCH' });
    assert.equal(traps, 0); assert.equal(spawns, 0);
  });
});

test('actual missing-executable async spawn error: controlled post-admission name loss still waits actual child and pipes close', async t => {
  const f = await fixture(t);
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, captured);
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error?.code, 'STAGE_SPAWN_FAILED'); closedBeforeSettlement(events); diagnostic(t, events);
  }, (original, executable, argv, settings) => {
    // Model the post-check pathname race with a real OS ENOENT spawn. The exact
    // returned ChildProcess and all actual pipes are still the supervisor's.
    return original(path.join(f.base, 'missing-node'), argv, settings);
  });
});

test('actual worker rejects request pipe; diagnostic notes whether this host schedules an EPIPE', async t => {
  const f = await fixture(t, 'rejectInput');
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))), child = await startCaptured(pending, captured);
    child.stdin.on('error', error => events.push({ event: 'actual-stdin-error', code: error.code, at: performance.now() }));
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.ok(['STAGE_PROTOCOL_INVALID', 'STAGE_CHILD_FAILED'].includes(actual.error?.code));
    closedBeforeSettlement(events); diagnostic(t, events);
  });
});

for (const kind of ['false', 'throw']) test(`modeled kill ${kind}: no close retains owner and exact unchanged lease; repeated abort/deadline cannot release`, async t => {
  const f = await fixture(t), m = model(), abort = new AbortController(), calls = [], stateDirectory = path.join(f.base, 'state');
  f.request.deadline = Date.now() + 450;
  m.child.kill = signal => { calls.push(signal); if (kind === 'throw') throw new Error('modeled kill throw'); return false; };
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(withEngineDependencyLease({ stateDirectory, logicalDirectories: ['b2:modeled:a', 'b2:modeled:b'], deadline: f.request.deadline, signal: abort.signal }, signal => runOwnedStageDecoder(options(f, signal))));
    await startCaptured(pending, m.spawned.promise); await pause(5);
    abort.abort(); abort.abort(); m.child.emit('error', new Error('modeled kill error event'));
    m.child.emit('exit', 0, null); m.child.stdout.end(encodeStageWireFrame(result(f.request), 'terminal')); m.child.stderr.end();
    try {
      await pause(520); assert.equal(pending.settled, false); assert.equal((await readdir(path.join(stateDirectory, 'locks'))).length, 2);
      assert.deepEqual(calls, process.platform === 'win32' ? ['SIGTERM'] : ['SIGTERM', 'SIGKILL']);
      assert.deepEqual(await readdir(f.stage), []); assert.ok(await lstat(f.launch.workerPath));
    } finally { m.close(); }
    assert.equal((await pending.promise).error?.code, 'STAGE_ABORTED'); assert.deepEqual(await readdir(path.join(stateDirectory, 'locks')), []);
    t.diagnostic(`MODELED ${kind}: exit and both kill attempts were not closure; separate modeled close unwound test`);
  });
});

test('modeled request end callback pending retains all work after child/pipe close; synchronous spawn throw is local', async t => {
  const f = await fixture(t), m = model(); let finishWrite;
  m.child.stdin.end = (_bytes, callback) => { finishWrite = callback; return m.child.stdin; };
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, m.spawned.promise); await pause(5);
    m.child.stdin.emit('finish'); m.child.stdout.end(encodeStageWireFrame(result(f.request), 'terminal')); m.child.stderr.end();
    await pause(5); m.child.emit('exit', 0, null); m.close();
    await pause(25); assert.equal(pending.settled, false, 'started write callback is still owned');
    finishWrite(); const actual = await pending.promise; assert.ifError(actual.error);
  });
  await patchedSpawn(() => { throw new Error('modeled sync spawn throw'); }, async () => {
    await assert.rejects(runOwnedStageDecoder(options(f)), { code: 'STAGE_SPAWN_FAILED' });
  });
});

test('modeled transport first failure survives cancellation, late success, kill error and closure', async t => {
  const f = await fixture(t), m = model(), abort = new AbortController();
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(runOwnedStageDecoder(options(f, abort.signal))); await startCaptured(pending, m.spawned.promise); await pause(5);
    m.child.stdout.emit('error', new Error('modeled transport secret')); abort.abort();
    m.child.stdout.end(encodeStageWireFrame(result(f.request), 'terminal')); m.child.stderr.end(); m.child.emit('error', new Error('modeled kill error'));
    m.child.emit('exit', 0, null); m.close();
    const actual = await pending.promise; assert.equal(actual.error.code, 'STAGE_PROTOCOL_INVALID');
    assert.equal(actual.error.message, 'STAGE_PROTOCOL_INVALID'); assert.equal(actual.error.cause, undefined);
  });
});

test('actual real child, modeled first kill false: unchanged lease stays until saved native method yields real close', async t => {
  const f = await fixture(t, 'blocked'), abort = new AbortController(), stateDirectory = path.join(f.base, 'state');
  await realSpawn(f, async ({ captured, events, nativeKill }) => {
    const pending = outcome(withEngineDependencyLease({ stateDirectory, logicalDirectories: ['b2:retained-real:a', 'b2:retained-real:b'], deadline: f.request.deadline, signal: abort.signal }, async signal => {
      try { return await runOwnedStageDecoder(options(f, signal)); }
      finally { events.push({ event: 'callback-settlement', at: performance.now() }); }
    }));
    const child = await startCaptured(pending, captured);
    await new Promise(resolve => child.stderr.once('data', resolve));
    const signals = [];
    child.kill = signal => { signals.push(signal); return false; }; // Only this return schedule is modeled.
    abort.abort(); await pause(300);
    assert.equal(pending.settled, false); assert.equal((await readdir(path.join(stateDirectory, 'locks'))).length, 2); assert.ok(!events.some(e => e.event === 'close'));
    nativeKill('SIGKILL'); const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error.code, 'STAGE_ABORTED'); assert.deepEqual(await readdir(path.join(stateDirectory, 'locks')), []);
    closedBeforeSettlement(events); diagnostic(t, [...events, { event: 'MODELED-kill-return-only', signals }]);
  });
});

for (const replacement of ['stage', 'resource', 'capsule']) test(`actual held child ${replacement} replacement refuses after close and retains successor`, async t => {
  const f = await fixture(t, 'holdReply');
  await realSpawn(f, async ({ captured, events, nativeKill }) => {
    const pending = outcome(runOwnedStageDecoder(options(f))), child = await startCaptured(pending, captured);
    await new Promise(resolve => child.stdout.once('end', resolve));
    const target = replacement === 'stage' ? f.stage : replacement === 'resource' ? f.resourceRoot : path.join(f.resourceRoot, 'payload.tgz');
    await rename(target, target + '.original');
    if (replacement === 'capsule') await writeFile(target, 'successor capsule retained'); else { await mkdir(target, { mode: 0o700 }); await writeFile(path.join(target, 'successor'), 'retained'); }
    // Inert holdReply has a timer; SIGTERM would make the child unsuccessful.
    // This test supplies a separate test-owned natural exit via a native signal
    // handler fixed into its static wrapper, leaving the actual exit code zero.
    nativeKill('SIGUSR2');
    const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error?.code, 'STAGE_OWNERSHIP_UNCERTAIN'); closedBeforeSettlement(events);
    assert.equal((await readFile(replacement === 'capsule' ? target : path.join(target, 'successor'))).toString(), replacement === 'capsule' ? 'successor capsule retained' : 'retained'); diagnostic(t, events);
  });
});

async function holdStat(predicate, operation) {
  const original = fs.lstat, entered = deferred(), release = deferred(); let held = false;
  fs.lstat = async (...args) => {
    if (!held && predicate(args[0])) { held = true; entered.resolve(); await release.promise; }
    return original(...args);
  };
  syncBuiltinESMExports();
  try { await operation({ entered: entered.promise, release: release.resolve }); }
  finally { release.resolve(); fs.lstat = original; syncBuiltinESMExports(); }
}

test('actual close followed by held post-close stat: original deadline expires and cannot be reset', async t => {
  const f = await fixture(t), observed = { closed: false }; f.request.deadline = Date.now() + 650;
  await realSpawn(f, async ({ captured, events }) => {
    await holdStat(file => observed.closed && file === f.stage, async gate => {
      const pending = outcome(runOwnedStageDecoder(options(f))), child = await startCaptured(pending, captured);
      child.once('close', () => { observed.closed = true; });
      await gate.entered; assert.equal(pending.settled, false); await pause(Math.max(0, f.request.deadline - Date.now() + 20));
      assert.equal(pending.settled, false, 'started lstat has not settled'); gate.release();
      const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() }); assert.equal(actual.error.code, 'STAGE_DEADLINE'); closedBeforeSettlement(events); diagnostic(t, events);
    });
  });
});

test('abort during owned launch read: no abandoned read or handle and no child', async t => {
  const f = await fixture(t), abort = new AbortController(), original = fs.open, entered = deferred(), release = deferred();
  let closes = 0, reads = 0, spawns = 0;
  fs.open = async (...args) => {
    const handle = await original(...args);
    if (args[0] === f.launch.nodePath) {
      const read = handle.read.bind(handle), close = handle.close.bind(handle);
      handle.read = async (...values) => { reads++; entered.resolve(); await release.promise; return read(...values); };
      handle.close = async () => { closes++; return close(); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await patchedSpawn(() => { spawns++; throw new Error('forbidden'); }, async () => {
      const pending = outcome(runOwnedStageDecoder(options(f, abort.signal))); await entered.promise; abort.abort(); await pause(25);
      assert.equal(pending.settled, false); assert.equal(closes, 0); release.resolve(); assert.equal((await pending.promise).error.code, 'STAGE_ABORTED');
      assert.equal(closes, 1); assert.equal(reads, 1); assert.equal(spawns, 0);
    });
  } finally { release.resolve(); fs.open = original; syncBuiltinESMExports(); }
});

test('actual post-close capsule replacement during owned stat refuses and retains successor', async t => {
  const f = await fixture(t), observed = { closed: false }, capsule = path.join(f.resourceRoot, 'payload.tgz');
  await realSpawn(f, async ({ captured, events }) => {
    await holdStat(file => observed.closed && file === capsule, async gate => {
      const pending = outcome(runOwnedStageDecoder(options(f))), child = await startCaptured(pending, captured);
      child.once('close', () => { observed.closed = true; }); await gate.entered;
      await rename(capsule, capsule + '.original'); await writeFile(capsule, 'synthetic inert capsule'); gate.release();
      const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
      assert.equal(actual.error.code, 'STAGE_OWNERSHIP_UNCERTAIN'); assert.equal((await readFile(capsule)).toString(), 'synthetic inert capsule'); closedBeforeSettlement(events); diagnostic(t, events);
    });
  });
});

test('actual abort during blocked IO, independent timer progresses before real child close', async t => {
  const f = await fixture(t, 'blocked'), abort = new AbortController(); let ticks = 0;
  await realSpawn(f, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f, abort.signal))), child = await startCaptured(pending, captured);
    await new Promise(resolve => child.stderr.once('data', resolve));
    const timer = setInterval(() => { ticks++; }, 5); await pause(40); clearInterval(timer); assert.ok(ticks >= 2);
    abort.abort(); const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.equal(actual.error.code, 'STAGE_ABORTED'); closedBeforeSettlement(events); diagnostic(t, [...events, { event: 'parent-timer-only', ticks }]);
  });
});

test('launch/request snapshots precede await; caller mutation cannot select another executable, worker or deadline', async t => {
  const f = await fixture(t), originalLaunch = f.launch, mutableLaunch = { ...f.launch }, originalDeadline = f.request.deadline;
  f.launch = mutableLaunch;
  await realSpawn({ ...f, launch: originalLaunch }, async ({ captured, events }) => {
    const pending = outcome(runOwnedStageDecoder(options(f)));
    mutableLaunch.workerPath = '/forbidden-selection'; mutableLaunch.nodePath = '/forbidden-node'; f.request.deadline = Date.now() - 1;
    await startCaptured(pending, captured); const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now() });
    assert.ifError(actual.error); assert.equal(actual.value.result.generation, f.request.generation); assert.ok(originalDeadline > Date.now()); closedBeforeSettlement(events);
  });
});

test('modeled rejected native-handle close never settles before separately observed actual handle close', async t => {
  const f = await fixture(t), original = fs.open, attempted = deferred(); let savedClose, actualClosed = false, spawns = 0;
  fs.open = async (...args) => {
    const handle = await original(...args);
    if (args[0] === f.launch.nodePath) {
      savedClose = handle.close.bind(handle); handle.once('close', () => { actualClosed = true; });
      handle.close = async () => { attempted.resolve(); throw new Error('MODELED close rejection; descriptor remains open'); };
    }
    return handle;
  };
  syncBuiltinESMExports();
  try {
    await patchedSpawn(() => { spawns++; throw new Error('forbidden'); }, async () => {
      const pending = outcome(runOwnedStageDecoder(options(f))); await attempted.promise;
      try { await pause(25); assert.equal(pending.settled, false); assert.equal(actualClosed, false); assert.equal(spawns, 0); }
      finally { await savedClose(); }
      assert.equal((await pending.promise).error.code, 'STAGE_LAUNCH_MISMATCH'); assert.equal(actualClosed, true);
    });
  } finally { fs.open = original; syncBuiltinESMExports(); }
});

for (const stream of ['stdin', 'stdout', 'stderr']) test(`modeled ${stream} transport error joins all retained work before refusal`, async t => {
  const f = await fixture(t), m = model();
  await patchedSpawn(() => { m.spawned.resolve(); return m.child; }, async () => {
    const pending = outcome(runOwnedStageDecoder(options(f))); await startCaptured(pending, m.spawned.promise); await pause(5);
    m.child[stream].emit('error', new Error(`MODELED ${stream} fault`));
    await pause(10); assert.equal(pending.settled, false); m.child.emit('exit', 1, null); m.close(1);
    assert.equal((await pending.promise).error.code, 'STAGE_PROTOCOL_INVALID');
  });
});

test('I1 actual post-close missing capsule reports ownership uncertainty after child/pipe/write barrier', async t => {
  const f = await fixture(t), capsule = path.join(f.resourceRoot, 'payload.tgz'), observed = { closed: false, writeCallback: false, finish: false };
  await realSpawn(f, async ({ captured, events }) => {
    await holdStat(file => observed.closed && file === capsule, async gate => {
      const pending = outcome(runOwnedStageDecoder(options(f))), child = await startCaptured(pending, captured);
      child.once('close', () => { observed.closed = true; }); await gate.entered;
      for (const event of ['close', 'stdin:close', 'stdout:close', 'stderr:close']) assert.ok(events.some(e => e.event === event), event);
      assert.equal(observed.writeCallback, true); assert.equal(observed.finish, true); assert.equal(pending.settled, false);
      await rename(capsule, capsule + '.retained'); gate.release();
      const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now(), code: actual.error?.code });
      diagnostic(t, [...events, { event: 'actual-native-request-write-progress', writeCallback: observed.writeCallback, finish: observed.finish }]);
      assert.equal(actual.error?.code, 'STAGE_OWNERSHIP_UNCERTAIN'); assert.equal(actual.error.cause, undefined);
      closedBeforeSettlement(events); assert.equal((await readFile(capsule + '.retained')).toString(), 'synthetic inert capsule');
    });
  }, (original, executable, argv, settings) => {
    const child = original(executable, argv, settings), end = child.stdin.end.bind(child.stdin);
    child.stdin.once('finish', () => { observed.finish = true; });
    // Observe the actual native end callback without delaying/replacing it.
    child.stdin.end = (frame, callback) => end(frame, error => { observed.writeCallback = true; callback(error); });
    return child;
  });
});

test('I1 actual preflight missing worker remains launch mismatch without starting a child', async t => {
  const f = await fixture(t); await rename(f.launch.workerPath, f.launch.workerPath + '.retained'); let spawns = 0;
  await patchedSpawn(() => { spawns++; throw new Error('forbidden preflight spawn'); }, async () => {
    await assert.rejects(runOwnedStageDecoder(options(f)), { code: 'STAGE_LAUNCH_MISMATCH' });
    assert.equal(spawns, 0); assert.ok(await lstat(f.launch.workerPath + '.retained'));
  });
});

for (const reason of ['abort', 'deadline']) test(`I1 actual native post-close missing path preserves earlier ${reason}`, async t => {
  const f = await fixture(t), abort = new AbortController(), observed = { closed: false }, capsule = path.join(f.resourceRoot, 'payload.tgz');
  if (reason === 'deadline') f.request.deadline = Date.now() + 650;
  await realSpawn(f, async ({ captured, events }) => {
    await holdStat(file => observed.closed && file === capsule, async gate => {
      const pending = outcome(runOwnedStageDecoder(options(f, abort.signal))), child = await startCaptured(pending, captured);
      child.once('close', () => { observed.closed = true; }); await gate.entered;
      await rename(capsule, capsule + '.retained');
      if (reason === 'abort') abort.abort(); else await pause(Math.max(0, f.request.deadline - Date.now() + 20));
      assert.equal(pending.settled, false, 'native ownership observation is still pending'); gate.release();
      const actual = await pending.promise; events.push({ event: 'settlement', at: performance.now(), code: actual.error?.code });
      assert.equal(actual.error?.code, reason === 'abort' ? 'STAGE_ABORTED' : 'STAGE_DEADLINE'); assert.equal(actual.error.cause, undefined);
      closedBeforeSettlement(events); diagnostic(t, events); assert.ok(await lstat(capsule + '.retained'));
    });
  });
});
