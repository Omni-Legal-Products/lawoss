import '../build/plugin-payload/network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough, Writable } from 'node:stream';
import { spawn, spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { canonical, inventory, SDK_LOCK_SHA256, sdkConsumerMode, sha256 } from '../build/plugin-payload/validate.mjs';
import { hostTarget, metadata } from '../build/plugin-payload/embedded-runtime-verifier-fixture.mjs';
import { admitStageDecodeResult } from './sdk-stage-decoder-contract.mjs';
import { createStageBundleFixture } from './test-fixtures/sdk-stage-decoder-bundle-fixture.mjs';
import { runSdkStageDecoderEntry } from './sdk-stage-decoder-entry.mjs';
import { createStageWireDecoder, encodeStageWireFrame, admitStageError, projectStageError } from './sdk-stage-decoder-wire.mjs';

const pause = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const generation = 'a'.repeat(32);
function request() {
  return { schema: 1, kind: 'lawoss-sdk-stage-decode', generation, resourceRoot: '/resource', resourceIdentity: { dev: '1', ino: '2' },
    stageGrant: { path: '/parent/stage', identity: { dev: '1', ino: '3' }, parent: { path: '/parent', dev: '1', ino: '4' } },
    sdkIdentity: { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', target: hostTarget, manifestSha256: '1'.repeat(64),
      lockSha256: SDK_LOCK_SHA256, inputSha256: sha256(metadata.acceptedInputText), sourceSetSha256: '2'.repeat(64), consumerMode: sdkConsumerMode(hostTarget, SDK_LOCK_SHA256),
      verifierSha256: '3'.repeat(64), capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: '4'.repeat(64), bytes: 123 } }, deadline: Date.now() + 60000 };
}
const result = r => ({ schema: 1, kind: 'lawoss-sdk-stage-result', status: 'verified-stage', generation: r.generation, stageIdentity: r.stageGrant.identity,
  capsuleSha256: r.sdkIdentity.capsule.sha256, manifestSha256: r.sdkIdentity.manifestSha256, verifierSha256: r.sdkIdentity.verifierSha256 });
const parse = (bytes, mode = 'terminal') => { const parser = createStageWireDecoder(mode); parser.push(bytes); return parser.finish(); };
const frame = text => { const body = Buffer.from(text); const header = Buffer.alloc(4); header.writeUInt32BE(body.length); return Buffer.concat([header, body]); };
async function streams(operation, output = new PassThrough()) {
  const input = new PassThrough();
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin'), stdout = Object.getOwnPropertyDescriptor(process, 'stdout');
  Object.defineProperty(process, 'stdin', { configurable: true, value: input });
  Object.defineProperty(process, 'stdout', { configurable: true, value: output });
  const chunks = []; output.on('data', chunk => chunks.push(Buffer.from(chunk)));
  try { return await operation({ input, output, bytes: () => Buffer.concat(chunks) }); }
  finally { input.destroy(); output.destroy(); Object.defineProperty(process, 'stdin', stdin); Object.defineProperty(process, 'stdout', stdout); }
}

test('entry import does not access process streams or perform entry IO', async () => {
  const stdin = Object.getOwnPropertyDescriptor(process, 'stdin'), stdout = Object.getOwnPropertyDescriptor(process, 'stdout');
  let accesses = 0;
  for (const name of ['stdin', 'stdout']) Object.defineProperty(process, name, { configurable: true, get() { accesses++; throw new Error('import-time stream access'); } });
  try { assert.equal(typeof (await import('./sdk-stage-decoder-entry.mjs?import-only')).runSdkStageDecoderEntry, 'function'); assert.equal(accesses, 0); }
  finally { Object.defineProperty(process, 'stdin', stdin); Object.defineProperty(process, 'stdout', stdout); }
});

test('wire refuses trailing bytes rather than accepting a first canonical frame', () => {
  const parser = createStageWireDecoder('request');
  assert.throws(() => parser.push(Buffer.concat([frame('{}'), Buffer.from('x')])), { code: 'STAGE_REQUEST_INVALID' });
});

test('stream model: full frame held before true EOF must not start decoder', async () => {
  await streams(async ({ input }) => {
    let calls = 0;
    const pending = runSdkStageDecoderEntry(async r => { calls++; return result(r); });
    input.write(encodeStageWireFrame(request(), 'request'));
    await pause();
    try { assert.equal(calls, 0, 'decoder began before true stdin EOF'); }
    finally { input.end(); assert.equal(await pending, 0); assert.equal(calls, 1); }
  });
});

test('closed canonical wire roundtrip accepts chunk splits and rejects noncanonical encodings', () => {
  const encoded = encodeStageWireFrame({ z: 'é', a: 1 }, 'request');
  assert.equal(encoded.subarray(4).toString(), '{"a":1,"z":"é"}');
  for (let split = 0; split <= encoded.length; split++) {
    const decoder = createStageWireDecoder('request'); decoder.push(encoded.subarray(0, split)); decoder.push(encoded.subarray(split));
    assert.deepEqual(decoder.finish(), { a: 1, z: 'é' });
    assert.throws(() => decoder.finish(), { code: 'STAGE_REQUEST_INVALID' });
  }
  for (const [mode, count] of [['request', 32760], ['terminal', 4088]]) {
    const exact = encodeStageWireFrame({ a: 'x'.repeat(count) }, mode);
    assert.equal(exact.readUInt32BE(), count + 8); assert.equal(parse(exact, mode).a.length, count);
    assert.throws(() => encodeStageWireFrame({ a: 'x'.repeat(count + 1) }, mode), { code: 'STAGE_REQUEST_INVALID' });
  }
  assert.throws(() => createStageWireDecoder('other')); assert.throws(() => encodeStageWireFrame({}, 'other'));
  const utf8 = Buffer.concat([Buffer.from([0, 0, 0, 2]), Buffer.from([0xc0, 0xaf])]);
  const bad = [utf8, frame('\ufeff{}'), frame('{"a":1,"a":1}'), frame('{"z":1,"a":2}'), frame('{ "a":1}'), frame('{"a":1.0}'), frame('{"a":-0}'), frame('{"a":"\\u0061"}'),
    Buffer.alloc(4), Buffer.from([0, 0, 128, 1]), Buffer.from([0, 0, 0]), frame('{}').subarray(0, 5), Buffer.concat([frame('{}'), frame('{}')])];
  for (const bytes of bad) assert.throws(() => parse(bytes, 'request'), { code: 'STAGE_REQUEST_INVALID' });
  assert.throws(() => parse(Buffer.from([0, 0, 16, 1])), { code: 'STAGE_REQUEST_INVALID' });
  assert.throws(() => encodeStageWireFrame({ a: 'x'.repeat(32768) }, 'request'), { code: 'STAGE_REQUEST_INVALID' });
  let reads = 0; const accessor = { get a() { reads++; return 1; } };
  assert.throws(() => encodeStageWireFrame(accessor, 'request')); assert.equal(reads, 0);
  const poisoned = createStageWireDecoder('request');
  assert.throws(() => poisoned.push(Buffer.from([0, 1, 0, 0])));
  assert.throws(() => poisoned.push(Buffer.alloc(1024 * 1024))); assert.throws(() => poisoned.finish());
});

test('error projection admits only the exact own primitive allowlist and matching correlation', () => {
  const allowed = ['STAGE_REQUEST_INVALID', 'STAGE_RUNTIME_UNSUPPORTED', 'STAGE_TARGET_MISMATCH', 'STAGE_ABORTED', 'STAGE_DEADLINE',
    'STAGE_RESOURCE_INVALID', 'STAGE_OWNERSHIP_UNCERTAIN', 'STAGE_COPY_FAILED', 'STAGE_EXTRACT_FAILED', 'STAGE_VERIFY_FAILED',
    'STAGE_HANDLE_CLOSE_FAILED', 'STAGE_CLEANUP_UNCERTAIN', 'PRODUCT_SDK_CAPSULE_INVALID', 'PRODUCT_SDK_CAPSULE_LIMIT'];
  for (const code of allowed) {
    const projected = projectStageError(Object.assign(new Error('secret/path'), { code, cause: 'secret cause' }), generation);
    assert.deepEqual(projected, { schema: 1, kind: 'lawoss-sdk-stage-error', generation, code });
    assert.ok(Object.isFrozen(admitStageError(parse(encodeStageWireFrame(projected, 'terminal')), generation)));
    assert.throws(() => admitStageError(projected, 'b'.repeat(32)));
    assert.throws(() => admitStageError({ ...projected, extra: 'path' }, generation));
    assert.throws(() => admitStageError({ ...projected, generation: null }, generation));
  }
  let reads = 0;
  for (const error of [{ code: 'EACCES' }, Object.create({ code: allowed[0] }), { code: { toString() { reads++; return allowed[0]; } } },
    { get code() { reads++; return allowed[0]; } }, null]) assert.equal(projectStageError(error, generation), undefined);
  assert.equal(reads, 0);
  const before = projectStageError({ code: 'STAGE_REQUEST_INVALID' }, null);
  assert.deepEqual(admitStageError(before, null), before);
  assert.equal(projectStageError({ code: allowed[0] }, 'invalid'), undefined);
  const accessor = { ...before }; Object.defineProperty(accessor, 'code', { enumerable: true, get() { reads++; return allowed[0]; } });
  assert.throws(() => admitStageError(accessor, null)); assert.equal(reads, 0);
});

test('stream model: split input, normal end then close calls decoder exactly once', async () => {
  await streams(async ({ input, bytes }) => {
    const r = request(), encoded = encodeStageWireFrame(r, 'request'); let calls = 0, signal;
    const pending = runSdkStageDecoderEntry(async (admitted, options) => { calls++; signal = options.signal; assert.equal(canonical(admitted), canonical(r)); return result(admitted); });
    for (const chunk of [encoded.subarray(0, 1), encoded.subarray(1, 4), encoded.subarray(4, 19), encoded.subarray(19)]) input.write(chunk);
    await pause(); assert.equal(calls, 0); input.end();
    assert.equal(await pending, 0); assert.equal(calls, 1); assert.equal(signal.aborted, false);
    assert.deepEqual(admitStageDecodeResult(parse(bytes()), r), result(r));
  });
});

for (const kind of ['close', 'error', 'malformed', 'expired']) test(`stream model: ${kind} input refuses without decoding and with null correlation`, async () => {
  await streams(async ({ input, bytes }) => {
    let calls = 0; const pending = runSdkStageDecoderEntry(async () => { calls++; });
    if (kind === 'close') { input.write(Buffer.from([0, 0])); input.destroy(); }
    if (kind === 'error') input.destroy(new Error('private input failure'));
    if (kind === 'malformed') input.end(Buffer.concat([encodeStageWireFrame(request(), 'request'), Buffer.from('x')]));
    if (kind === 'expired') input.end(encodeStageWireFrame({ ...request(), deadline: Date.now() - 1 }, 'request'));
    assert.equal(await pending, 1); assert.equal(calls, 0);
    assert.deepEqual(admitStageError(parse(bytes()), null), { schema: 1, kind: 'lawoss-sdk-stage-error', generation: null,
      code: kind === 'expired' ? 'STAGE_DEADLINE' : 'STAGE_REQUEST_INVALID' });
  });
});

test('stream model: pending rejection emits no terminal until the actual closure promise settles', async () => {
  await streams(async ({ input, bytes }) => {
    const started = deferred(), held = deferred();
    const pending = runSdkStageDecoderEntry(async () => { started.resolve(); return held.promise; });
    let settled = false; const joined = pending.then(() => { settled = true; });
    input.end(encodeStageWireFrame(request(), 'request')); await started.promise; await pause();
    try { assert.equal(settled, false); assert.equal(bytes().length, 0); }
    finally { held.reject(Object.assign(new Error('private'), { code: 'STAGE_HANDLE_CLOSE_FAILED' })); await joined; }
    assert.equal(await pending, 1); assert.equal(admitStageError(parse(bytes()), generation).code, 'STAGE_HANDLE_CLOSE_FAILED');
  });
});

test('stream model: output failure aborts the local signal but still joins pending decoder cleanup', async () => {
  await streams(async ({ input, output, bytes }) => {
    const started = deferred(), held = deferred(); let signal;
    const pending = runSdkStageDecoderEntry(async (_, options) => { signal = options.signal; started.resolve(); return held.promise; });
    let settled = false; const joined = pending.then(() => { settled = true; });
    input.end(encodeStageWireFrame(request(), 'request')); await started.promise;
    output.destroy(new Error('modeled pipe failure')); await pause();
    try { assert.equal(signal.aborted, true); assert.equal(settled, false); assert.equal(bytes().length, 0); }
    finally { held.reject(Object.assign(new Error('joined'), { code: 'STAGE_ABORTED' })); await joined; }
    assert.equal(await pending, 1); assert.equal(bytes().length, 0);
  });
});

test('stream model: silent premature output close aborts and joins pending decoder', async () => {
  await streams(async ({ input, output }) => {
    const started = deferred(), held = deferred(); let signal;
    const pending = runSdkStageDecoderEntry(async (_, options) => { signal = options.signal; started.resolve(); return held.promise; });
    input.end(encodeStageWireFrame(request(), 'request')); await started.promise;
    output.destroy(); await pause();
    try { assert.equal(signal.aborted, true); }
    finally { held.reject(Object.assign(new Error('joined'), { code: 'STAGE_ABORTED' })); await pending; }
  });
});

test('stream model: output finish and end completion precede status', async () => {
  const held = deferred(), finalEntered = deferred(); let written;
  const output = new Writable({ write(chunk, encoding, done) { written = Buffer.from(chunk); done(); }, final(done) { finalEntered.resolve(); held.promise.then(() => done()); } });
  await streams(async ({ input }) => {
    const pending = runSdkStageDecoderEntry(async r => result(r)); let settled = false;
    const joined = pending.then(() => { settled = true; });
    input.end(encodeStageWireFrame(request(), 'request')); await finalEntered.promise; await pause();
    try { assert.equal(settled, false); assert.equal(parse(written).status, 'verified-stage'); }
    finally { held.resolve(); await joined; }
    assert.equal(await pending, 0); assert.equal(output.writableFinished, true);
  }, output);
});

for (const kind of ['final-callback-error', 'synchronous-end-throw']) test(`stream model: ${kind} refuses output success`, async () => {
  const output = new Writable({ write(chunk, encoding, done) { done(); }, final(done) { done(new Error('private final failure')); } });
  if (kind === 'synchronous-end-throw') output.end = () => { throw new Error('private end failure'); };
  await streams(async ({ input }) => {
    const pending = runSdkStageDecoderEntry(async r => result(r));
    input.end(encodeStageWireFrame(request(), 'request')); assert.equal(await pending, 1);
    await pause();
  }, output);
});

for (const kind of ['unknown', 'accessor', 'mismatched-result']) test(`stream model: ${kind} decoder escape cannot leak or mint success`, async () => {
  await streams(async ({ input, bytes }) => {
    let reads = 0;
    const pending = runSdkStageDecoderEntry(async r => {
      if (kind === 'mismatched-result') return { ...result(r), generation: 'b'.repeat(32) };
      if (kind === 'unknown') throw Object.assign(new Error('secret stack/path'), { code: 'PRIVATE' });
      throw { get code() { reads++; return 'STAGE_VERIFY_FAILED'; } };
    });
    input.end(encodeStageWireFrame(request(), 'request')); assert.equal(await pending, 1); assert.equal(reads, 0);
    if (kind === 'mismatched-result') assert.equal(admitStageError(parse(bytes()), generation).code, 'STAGE_REQUEST_INVALID');
    else assert.equal(bytes().length, 0);
  });
});

// Small test-only driver, not the B2 supervisor. It always retains the real
// child and drains/discards beyond storage caps until real pipe/process close.
async function childRoundtrip(f, executable, bytes, hold) {
  const events = [], errors = [], stdout = [], stderr = [];
  let outBytes = 0, errBytes = 0, exit, signal, stdinFinished = false, stdoutEOF = false, stderrEOF = false;
  const child = spawn(executable, [f.worker], { cwd: f.codeDirectory, env: { PATH: path.dirname(executable) }, stdio: ['pipe', 'pipe', 'pipe'] });
  const closure = f.retainChild(child);
  const closed = new Promise(resolve => child.once('close', (code, term) => { events.push('child-close'); resolve({ code, term }); }));
  const pipeCloses = ['stdin', 'stdout', 'stderr'].map(name => new Promise(resolve => child[name].once('close', () => { events.push(`${name}-close`); resolve(); })));
  child.on('error', error => errors.push(error.code ?? 'child-error'));
  child.on('exit', (code, term) => { exit = code; signal = term; events.push('exit'); });
  child.stdin.on('error', error => errors.push(error.code ?? 'stdin-error')); child.stdin.on('finish', () => { stdinFinished = true; events.push('stdin-finish'); });
  for (const [name, chunks, cap] of [['stdout', stdout, 4100], ['stderr', stderr, 4096]]) {
    let retained = 0;
    child[name].on('data', chunk => {
      if (name === 'stdout') outBytes = Math.min(4101, outBytes + chunk.length); else errBytes = Math.min(4097, errBytes + chunk.length);
      const remaining = cap - retained;
      if (remaining > 0) { const copy = Buffer.from(chunk.subarray(0, remaining)); chunks.push(copy); retained += copy.length; }
    });
    child[name].on('error', error => errors.push(error.code ?? `${name}-error`));
    child[name].on('end', () => { events.push(`${name}-end`); if (name === 'stdout') stdoutEOF = true; else stderrEOF = true; });
  }
  let timedOut = false;
  const watchdog = setTimeout(() => { timedOut = true; child.stdin.destroy(); child.kill('SIGKILL'); }, 15000);
  try {
    child.stdin.write(bytes);
    if (hold) await hold(child, () => ({ outBytes, errBytes, exit }));
    child.stdin.end();
    const close = await closed; await Promise.all(pipeCloses);
    return { exit, signal, close, stdinFinished, stdoutEOF, stderrEOF, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr), outBytes, errBytes, errors, events, timedOut, closure };
  } finally {
    // Never drop an alive race loser or remove its fixture on a failed assertion.
    if (!closure.close) { child.stdin.destroy(); child.kill('SIGKILL'); await closed; await Promise.all(pipeCloses); }
    clearTimeout(watchdog);
  }
}

function assertClosed(run, expectedExit) {
  assert.equal(run.timedOut, false); assert.deepEqual(run.errors, []);
  assert.equal(run.exit, expectedExit); assert.equal(run.signal, null); assert.deepEqual(run.close, { code: expectedExit, term: null });
  assert.equal(run.stdinFinished, true); assert.equal(run.stdoutEOF, true); assert.equal(run.stderrEOF, true);
  assert.deepEqual(run.closure, { close: true, stdin: true, stdout: true, stderr: true }); assert.equal(run.errBytes, 0);
  assert.ok(run.events.indexOf('exit') < run.events.indexOf('child-close'));
}

test('actual fixed CJS composition closes in Node24 refusal and Node22 inert decoding', async t => {
  assert.equal(process.version, 'v22.23.2'); assert.equal(process.versions.bun, undefined);
  const node22 = process.execPath, bun = process.env.LAWOSS_TEST_BUN, node24 = process.env.LAWOSS_TEST_NODE24;
  assert.ok(bun && path.isAbsolute(bun), 'explicit LAWOSS_TEST_BUN required'); assert.ok(node24 && path.isAbsolute(node24), 'explicit LAWOSS_TEST_NODE24 required');
  const version = spawnSync(node24, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 });
  assert.ifError(version.error); assert.equal(version.status, 0); assert.equal(version.stdout.trim(), 'v24.21.0');
  const f = await createStageBundleFixture(t, { node22, bun });
  t.diagnostic(JSON.stringify({ kind: 'actual-cjs-composition', ...f.provenance, node24, node24Version: version.stdout.trim(), node24Sha256: sha256(await readFile(node24)) }));
  const beforeCode = await inventory(f.codeDirectory);
  const negative = await childRoundtrip(f, node24, encodeStageWireFrame(f.request, 'request'));
  assertClosed(negative, 1);
  assert.deepEqual(admitStageError(parse(negative.stdout), f.request.generation), { schema: 1, kind: 'lawoss-sdk-stage-error', generation: f.request.generation, code: 'STAGE_RUNTIME_UNSUPPORTED' });
  assert.deepEqual(await readdir(f.stage), []); assert.equal(canonical(await inventory(f.resourceRoot)), canonical(f.resourceInventory));
  t.diagnostic(JSON.stringify({ kind: 'actual-node24-closed-before-mutation', ...negative, stdout: parse(negative.stdout), stderr: '' }));
  const positive = await childRoundtrip(f, node22, encodeStageWireFrame(f.request, 'request'), async (_, observe) => {
    // A real held stdin pipe: no true EOF means no stage mutation or response.
    await new Promise(resolve => setTimeout(resolve, 100)); assert.deepEqual(await readdir(f.stage), []);
    assert.deepEqual(observe(), { outBytes: 0, errBytes: 0, exit: undefined });
    await assert.rejects(f.cleanup(), /FIXTURE_CHILD_CLOSURE_UNCERTAIN/);
    assert.deepEqual(await readdir(f.codeDirectory), ['worker.cjs']);
  });
  assertClosed(positive, 0); assert.deepEqual(admitStageDecodeResult(parse(positive.stdout), f.request), result(f.request));
  assert.deepEqual(await inventory(f.stage), f.stageInventory); assert.deepEqual(await readFile(f.capsule), f.capsuleBytes);
  assert.equal(canonical(await inventory(f.resourceRoot)), canonical(f.resourceInventory)); assert.deepEqual(await inventory(f.codeDirectory), beforeCode);
  assert.deepEqual(await readdir(f.parent), ['stage']); assert.equal((await readdir(f.stage)).includes('.capsule-input.tgz'), false);
  assert.equal(await readFile(path.join(f.stage, 'node_modules/@opencode-ai/plugin/index.js'), 'utf8'), "throw Error('Inert SDK fixture must never execute');\n");
  t.diagnostic(JSON.stringify({ kind: 'actual-node22-inert-stage-closed', ...positive, stdout: parse(positive.stdout), stderr: '', stageInventory: f.stageInventory, resourceInventory: f.resourceInventory }));
  const malformed = await childRoundtrip(f, node22, Buffer.concat([frame('{}'), Buffer.from('x')]));
  assertClosed(malformed, 1); assert.equal(admitStageError(parse(malformed.stdout), null).code, 'STAGE_REQUEST_INVALID');
  assert.deepEqual(await inventory(f.stage), f.stageInventory);
  t.diagnostic(JSON.stringify({ kind: 'actual-node22-malformed-closed', ...malformed, stdout: parse(malformed.stdout), stderr: '' }));
  await f.cleanup();
});
