import assert from 'node:assert/strict';
import { readFile, mkdtemp, mkdir, rm, symlink, realpath, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import test from 'node:test';
import { composeSources, reportEvents, createImportObserver, lineDecoder, admitContext, admitOutput, validateRecords, cellOutcome, decodeBracket, captureInvocation, testArgv, parseArgs, hash } from './windows-qualified-cold-experiment.mjs';

const selected = 'native Windows job stops root and detached grandchild before returning verified closure';
const file = '/trusted/composed/windows-job.test.mjs';
const sources = Object.fromEntries(await Promise.all(['windows-job.ps1', 'windows-job.mjs', 'windows-job.test.mjs'].map(async name => [name, await readFile(new URL(name, import.meta.url))])));
async function collect(events) { const result = []; for await (const line of reportEvents(events, file)) result.push(JSON.parse(line)); return result; }
test('composition refuses source drift before creating an executable experiment', () => {
  assert.throws(() => composeSources({ ...sources, 'windows-job.ps1': Buffer.concat([sources['windows-job.ps1'], Buffer.from('\n')]) }, 'control'), /source-binding/);
});
test('treatment changes only the declared absolute import while test and control bytes remain original', () => {
  const control = composeSources(sources, 'control'), treatment = composeSources(sources, 'absolute-import');
  assert.deepEqual(control['windows-job.ps1'], sources['windows-job.ps1']);
  assert.deepEqual(treatment['windows-job.test.mjs'], sources['windows-job.test.mjs']);
  assert.equal(treatment['windows-job.ps1'].equals(control['windows-job.ps1']), false);
  assert.equal(control['windows-job.mjs'].equals(sources['windows-job.mjs']), false);
  assert.deepEqual(treatment['windows-job.mjs'], control['windows-job.mjs']);
});

const moment = ms => ({ childElapsedMs: ms, childElapsedCapped: false, parentDeliveryElapsedMs: ms + 10, parentDeliveryElapsedCapped: false });
function projections(failed = false) {
  return {
    launch: { kind: 'lawoss-windows-job-launch-observer', timingSemantics: 'parent-observed-checkpoint-delivery', snapshotBoundary: 'observer-released-before-cancel-or-ready-return',
      checkpointFirstObservedMs: { entry: 1, encoding: 2, 'input-read': 3, decoded: 8, configured: 9, compiled: 12, created: 14 },
      callBoundaryFirstObserved: { 'decode-before': moment(1), 'decode-return': moment(8), 'decode-error': null, 'compile-before': moment(9), 'compile-return': moment(12), 'compile-error': null },
      callTimingSemantics: 'child-relative-source-bracket-and-parent-delivery-independent-origins', elapsedMs: 30, elapsedCapped: false, elapsedMayIncludeInternalCancellation: failed, outcome: failed ? 'failed' : 'ready' },
    imports: { kind: 'lawoss-windows-cold-import-observer', schema: 1, parentClock: 'copied-launcher-entry', childClock: 'helper-stopwatch', failureCode: failed ? 'windows-job-start-timeout' : null,
      slots: { before: failed ? null : moment(2), return: failed ? null : moment(4), error: null } },
  };
}
function fixtureEvents(failed = false) {
  const p = projections(failed), counts = { cancelled: 0, failed: Number(failed), passed: Number(!failed), skipped: 0, suites: 0, tests: 1, todo: 0, topLevel: 1 };
  const common = { name: selected, nesting: 0, parentId: 0, testId: 2, file, entryFile: file, testNumber: 1, details: { type: 'test' } };
  const stderr = JSON.stringify(p.imports);
  return [
    { type: 'test:enqueue', data: common }, { type: 'test:dequeue', data: common },
    { type: 'test:stderr', data: { file, entryFile: file, message: stderr.slice(0, 17) } },
    { type: 'test:stderr', data: { file, entryFile: file, message: stderr.slice(17) + '\r\n' } },
    { type: 'test:start', data: common }, { type: 'test:complete', data: common },
    { type: failed ? 'test:fail' : 'test:pass', data: common },
    { type: 'test:diagnostic', data: { file, entryFile: file, nesting: 0, message: JSON.stringify(p.launch) } },
    { type: 'test:plan', data: { nesting: 0, count: 1 } },
    { type: 'test:summary', data: { file, counts, success: !failed } },
    { type: 'test:diagnostic', data: { nesting: 0, message: 'tests 1' } },
    { type: 'test:summary', data: { counts, success: !failed } },
  ];
}
test('MODEL public reporter counts exactly one result and two scoped summaries for red and green', async () => {
  for (const failed of [false, true]) {
    const records = await collect(fixtureEvents(failed));
    assert.equal(records.at(-1).valid, true);
    assert.equal(records.filter(r => r.kind === 'selected-result').length, 1);
    assert.equal(records.filter(r => r.kind.endsWith('-summary')).length, 2);
    assert.ok(records.length <= 16);
  }
});
test('MODEL I33-1 mixed canonical and whitespace-owned projections reject in both orders while draining', async () => {
  for (const failed of [false, true]) for (const prefix of [' ', '\t', '\r', ' \t\r ']) for (const first of [true, false]) {
    const events = fixtureEvents(failed), extra = { type: 'test:stderr', data: { file, entryFile: file, message: prefix + JSON.stringify(projections(failed).imports) + '\n' } };
    events.splice(first ? 2 : 4, 0, extra);
    // Further bad data must neither emit another invalid record nor stop drain.
    events.push(extra, { type: 'test:complete', data: {} });
    let consumed = 0;
    async function* source() { for (const event of events) { consumed++; yield event; } }
    const records = await collect(source());
    assert.equal(records.at(-1).valid, false, `failed=${failed} prefix=${JSON.stringify(prefix)} first=${first}`);
    assert.equal(records.filter(record => record.kind === 'invalid').length, 1);
    assert.equal(consumed, events.length); assert.ok(records.length <= 16);
  }
  for (const failed of [false, true]) {
    const unrelated = { type: 'test:stderr', data: { file, entryFile: file, message: 'unrelated raw stderr\n  {"kind":"unrelated"}\nnote ' + JSON.stringify(projections(failed).imports) + '\n' } };
    const records = await collect([unrelated, ...fixtureEvents(failed)]);
    assert.equal(records.at(-1).valid, true);
    assert.equal(records.filter(record => record.kind === 'import-observation').length, 1);
  }
});
test('MODEL I33-2 summary provenance rejects conflicting file and cumulative entryFile while retaining legitimate scopes', async () => {
  for (const failed of [false, true]) {
    for (const [index, entryFile] of [[9, '/wrong/source.mjs'], [11, '/wrong/source.mjs'], [9, null], [11, file]]) {
      const events = fixtureEvents(failed); events[index].data.entryFile = entryFile;
      let consumed = 0;
      async function* source() { for (const event of events) { consumed++; yield event; } }
      const records = await collect(source());
      assert.equal(records.at(-1).valid, false, `failed=${failed} summaryIndex=${index} entryFile=${entryFile}`);
      assert.equal(records.filter(record => record.kind === 'invalid').length, 1);
      assert.equal(consumed, events.length);
    }
    for (const matchedFileEntry of [false, true]) {
      const events = fixtureEvents(failed);
      if (matchedFileEntry) events[9].data.entryFile = file;
      else events[9].data.entryFile = undefined;
      // The cumulative summary has no file owner, including explicit undefined.
      events[11].data.file = undefined; events[11].data.entryFile = undefined;
      const records = await collect(events);
      assert.equal(records.at(-1).valid, true);
      assert.equal(records.filter(record => record.kind.endsWith('-summary')).length, 2);
    }
  }
});
test('MODEL forged message JSON has no lifecycle authority and unknown executed/nested/skipped results refuse', async () => {
  const valid = fixtureEvents();
  const forged = { type: 'test:stdout', data: { file, entryFile: file, message: '{"kind":"selected-result","result":"pass"}\n' } };
  assert.equal((await collect([forged, ...valid])).at(-1).valid, true);
  for (const patch of [{ name: 'unexpected' }, { nesting: 1 }, { file: '/wrong' }, { entryFile: undefined }, { skip: true }, { skip: '' }, { todo: true }, { expectFailure: true }, { expectedFailure: true }, { details: { attempt: 1 } }, { unknown: true }, { parentId: 1 }, { testId: 3 }]) {
    const events = structuredClone(valid); events[6].data = { ...events[6].data, ...patch };
    assert.equal((await collect(events)).at(-1).valid, false, JSON.stringify(patch));
  }
});
test('MODEL missing end facts, duplicate projections/results, inconsistent or wrong-file summaries refuse', async () => {
  for (const mutate of [
    e => e.slice(0, -1), e => [...e, e[6]], e => [...e, e[7]], e => [...e, e[2], e[3]],
    e => e.map(v => v.type === 'test:summary' ? { ...v, data: { ...v.data, file: '/wrong' } } : v),
    e => e.map(v => v.type === 'test:summary' ? { ...v, data: { ...v.data, success: false } } : v),
    e => [...e, { type: 'test:watch:drained', data: {} }],
    e => e.map(v => v.type === 'test:plan' ? { ...v, data: { nesting: 0, count: 2 } } : v),
  ]) assert.equal((await collect(mutate(fixtureEvents()))).at(-1).valid, false);
});
test('MODEL getter/proxy events cannot run traps or forge evidence', async () => {
  let traps = 0;
  const getter = { data: {} }; Object.defineProperty(getter, 'type', { enumerable: true, get() { traps++; return 'test:start'; } });
  const proxy = new Proxy({}, { ownKeys() { traps++; throw Error('trap'); }, get() { traps++; throw Error('trap'); } });
  for (const value of [getter, proxy, { type: 'test:start', data: proxy }]) assert.equal((await collect([value, ...fixtureEvents()])).at(-1).valid, false);
  assert.equal(traps, 0);
});
test('MODEL import collector retains first before/terminal, bounds overflow, freezes before cancellation', async () => {
  let clock = 0, published = 0;
  const observer = createImportObserver(() => clock, () => { published++; throw Error('sink'); });
  observer.write('x'.repeat(257)); observer.write('LAWOSS_WINDOWS_JOB_CALL:import:before:1:0\n');
  observer.write('LAWOSS_WINDOWS_JOB_CALL:import:be'); clock = 10; observer.write('fore:2:0\r\n');
  clock = 20; observer.write('LAWOSS_WINDOWS_JOB_CALL:import:return:4:0\nLAWOSS_WINDOWS_JOB_CALL:import:error:5:0\n');
  const frozen = observer.freeze(null); observer.write('LAWOSS_WINDOWS_JOB_CALL:import:before:9:0\n'); observer.freeze(null);
  assert.equal(frozen.slots.before.childElapsedMs, 2); assert.equal(frozen.slots.return.childElapsedMs, 4); assert.equal(frozen.slots.error, null); assert.equal(published, 1);
  const rejection = createImportObserver(() => 60001, () => Promise.reject(Error('async sink')));
  rejection.write('LAWOSS_WINDOWS_JOB_CALL:import:before:60000:1\n');
  assert.equal(rejection.freeze(Object.assign(Error(), { code: 'windows-job-start-timeout' })).failureCode, 'windows-job-start-timeout');
  await Promise.resolve();
});
test('MODEL line decoder handles fragmented CRLF and refuses UTF8/EOF/overflow while draining', () => {
  const lines = [], invalid = [], decoder = lineDecoder(v => lines.push(v), v => invalid.push(v), 16);
  decoder.write(Buffer.from('ok\r')); decoder.write(Buffer.from('\n'));
  decoder.write(Buffer.from([0xc0, 0xaf, 10])); decoder.write(Buffer.from('x'.repeat(17) + '\nlast\npartial')); decoder.end();
  assert.deepEqual(lines, ['ok', 'last']); assert.deepEqual(invalid, ['malformed', 'line-overflow', 'truncated']);
});

function admitted() {
  const sha = 'a'.repeat(40);
  return { platform: 'win32', arch: 'x64', node: 'v24.21.0', execArgv: [], sourceSha: sha, actualSha: sha, actualMessage: 'chore: spustit jediny cold-helper experiment 20261023',
    env: { GITHUB_ACTIONS: 'true', CI: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Windows', RUNNER_ARCH: 'X64', GITHUB_EVENT_NAME: 'push', GITHUB_REF: 'refs/heads/fix/spolahliva-alfa-sest-platform-20261021', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: sha, GITHUB_RUN_ID: '123', GITHUB_JOB: 'first-helper' },
    event: { ref: 'refs/heads/fix/spolahliva-alfa-sest-platform-20261021', deleted: false, forced: false, after: sha, head_commit: { id: sha, message: 'chore: spustit jediny cold-helper experiment 20261023' } } };
}
test('MODEL preflight refuses wrong event/attempt/marker/source/host before any native attempt', () => {
  assert.doesNotThrow(() => admitContext(admitted()));
  for (const patch of [{ platform: 'darwin' }, { arch: 'ia32' }, { node: 'v24.21.1' }, { execArgv: ['--import=unreviewed'] }, { sourceSha: 'b'.repeat(40) }, { actualSha: 'b'.repeat(40) }, { actualMessage: 'wrong' }]) assert.throws(() => admitContext({ ...admitted(), ...patch }), /admission/);
  for (const patch of [{ GITHUB_EVENT_NAME: 'workflow_dispatch' }, { GITHUB_RUN_ATTEMPT: '2' }, { RUNNER_ENVIRONMENT: 'self-hosted' }, { RUNNER_ARCH: 'ARM64' }, { GITHUB_REF: 'refs/heads/dev' }, { NODE_OPTIONS: '--import=unreviewed' }, { NODE_TEST_CONTEXT: 'child-v8' }]) { const c = admitted(); c.env = { ...c.env, ...patch }; assert.throws(() => admitContext(c), /admission/); }
  for (const patch of [{ deleted: true }, { forced: true }, { after: 'b'.repeat(40) }, { head_commit: { id: 'a'.repeat(40), message: 'wrong' } }]) { const c = admitted(); c.event = { ...c.event, ...patch }; assert.throws(() => admitContext(c), /admission/); }
});
test('owned output refuses reuse, traversal and symbolic-link escape', async t => {
  const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'cold-output-'))); t.after(() => rm(temp, { recursive: true, force: true }));
  const output = path.join(temp, 'owned');
  await admitOutput(output, temp); await assert.rejects(admitOutput(output, temp));
  await assert.rejects(admitOutput(path.join(temp, '../escape'), temp));
  await symlink(temp, path.join(temp, 'link'), 'dir'); await assert.rejects(admitOutput(path.join(temp, 'link/escaped'), temp));
});
test('MODEL NDJSON envelope rejects missing, malformed, duplicate, noncanonical and truncated evidence', async () => {
  const raw = (await collect(fixtureEvents())).map(r => JSON.stringify(r) + '\n').join('');
  assert.equal(validateRecords(Buffer.from(raw)).valid, true);
  for (const bad of ['', raw.slice(0, -1), raw + raw, ' ' + raw, raw.replace('"valid":true', '"valid":true,"valid":true'), raw.replace('"schema":1', '"schema":2')]) assert.equal(validateRecords(Buffer.from(bad)).valid, false);
});
test('MODEL red controls require the original timeout and closure failures override readiness', async () => {
  const records = await collect(fixtureEvents());
  const close = { code: 0, signal: null, exitObserved: true, exitCode: 0, exitSignal: null, spawnAttempts: 1, spawnObserved: 1, closed: true, pipeClosed: [true, true], writersClosed: [true, true], errors: [], overflow: [false, false] };
  assert.equal(cellOutcome('absolute-import', records, close), 'TREATMENT_READY_AND_CLOSED');
  for (const patch of [{ code: 1 }, { code: null }, { signal: 'SIGTERM' }, { closed: false }, { spawnAttempts: 2 }, { errors: ['sink'] }]) assert.equal(cellOutcome('absolute-import', records, { ...close, ...patch }), 'INCONCLUSIVE');
  const red = await collect(fixtureEvents(true));
  assert.equal(cellOutcome('control', red, { ...close, code: 1, exitCode: 1 }), 'CONTROL_ORIGINAL_START_TIMEOUT');
  red.find(r => r.kind === 'import-observation').value.failureCode = 'other';
  assert.equal(cellOutcome('control', red, { ...close, code: 1, exitCode: 1 }), 'INCONCLUSIVE');
});
test('MODEL censored or capped decode brackets remain INCONCLUSIVE without a numeric improvement', () => {
  const p = projections();
  assert.deepEqual(decodeBracket(p.launch, p.imports, 'absolute-import'), { state: 'OBSERVED_UNCAPPED', durationMs: 7 });
  const absent = structuredClone(p); absent.launch.callBoundaryFirstObserved['decode-return'] = null;
  assert.deepEqual(decodeBracket(absent.launch, absent.imports, 'absolute-import'), { state: 'INCONCLUSIVE', durationMs: null });
  for (const altered of [
    () => { const copy = structuredClone(p); copy.launch.callBoundaryFirstObserved['decode-return'] = { ...moment(60000), childElapsedCapped: true, parentDeliveryElapsedMs: 60000 }; return copy; },
    () => { const copy = structuredClone(p); copy.imports.slots.return = moment(10); return copy; },
  ]) { const copy = altered(); assert.deepEqual(decodeBracket(copy.launch, copy.imports, 'absolute-import'), { state: 'INCONCLUSIVE', durationMs: null }); }
});
test('MODEL capture retains original error/null exit and waits actual child/pipe/writer closes', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  let release; const held = new Promise(r => { release = r; });
  const writer = new Writable({ write(chunk, encoding, cb) { held.then(() => cb()); } });
  const other = new Writable({ write(chunk, encoding, cb) { cb(); } });
  let settled = false; const result = captureInvocation(child, writer, other).then(v => { settled = true; return v; });
  child.emit('spawn'); child.stdout.write('tail'); child.emit('error', Error('spawn')); child.emit('exit', null, null);
  await Promise.resolve(); assert.equal(settled, false);
  child.stdout.end(); child.stderr.end(); child.emit('close', null, null); await Promise.resolve(); assert.equal(settled, false);
  release(); const observed = await result;
  assert.equal(observed.code, null); assert.equal(observed.signal, null); assert.equal(observed.closed, true); assert.deepEqual(observed.writersClosed, [true, true]); assert.ok(observed.errors.includes('spawn'));
});
test('closed caller flags and exact file-URL argv cannot introduce another test or reporter', () => {
  const own = fileURLToPath(new URL('./windows-qualified-cold-experiment.mjs', import.meta.url)), composed = path.resolve('test path #%.mjs');
  assert.deepEqual(testArgv(composed, own), ['--test', `--test-reporter=${new URL('./windows-qualified-cold-experiment.mjs', import.meta.url).href}`, `--test-name-pattern=^${selected}$`, composed]);
  const args = ['--arm', 'control', '--arch', 'x64', '--source-sha', 'a'.repeat(40), '--output', path.resolve('owned')];
  assert.equal(parseArgs(args).arm, 'control');
  for (const bad of [[...args, '--retry', '1'], ['--arm', 'control', '--arm', 'control', ...args.slice(4)], [...args.slice(0, 6), '--output', 'bad\0path'], [...args.slice(0, 4), '--source-sha', 'a'.repeat(39), ...args.slice(6)]]) assert.throws(() => parseArgs(bad), /arguments/);
});
test('MODEL malformed closed projections, unknown fields, duplicate keys and wrong message kinds refuse', async () => {
  const p = projections();
  for (const text of [JSON.stringify({ ...p.imports, unknown: true }), JSON.stringify(p.imports).replace('"schema":1', '"schema":1,"schema":1'), ' ' + JSON.stringify(p.imports), JSON.stringify({ ...p.imports, slots: [] }), JSON.stringify({ ...p.imports, slots: { before: moment(2), return: { ...moment(4), childElapsedCapped: true }, error: null } }), JSON.stringify(p.imports) + '\ufffd']) {
    const events = fixtureEvents(); events.splice(2, 2, { type: 'test:stderr', data: { file, entryFile: file, message: text + '\n' } });
    assert.equal((await collect(events)).at(-1).valid, false);
  }
  const swapped = fixtureEvents(); swapped[7].type = 'test:stdout'; assert.equal((await collect(swapped)).at(-1).valid, false);
  const swappedImport = fixtureEvents(); swappedImport[2].type = swappedImport[3].type = 'test:stdout'; assert.equal((await collect(swappedImport)).at(-1).valid, false);
});
test('MODEL capture drains byte overflow and asynchronous sink failure without retry/kill', async () => {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
  const failed = new Writable({ write(chunk, encoding, callback) { callback(Error('sink')); } });
  const normal = new Writable({ write(chunk, encoding, callback) { callback(); } });
  const waiting = captureInvocation(child, failed, normal); child.emit('spawn');
  child.stdout.write(Buffer.alloc(1024 * 1024 + 1, 65)); child.stdout.write('still drained'); child.stderr.end('tail'); child.stdout.end(); child.emit('close', 7, null);
  const result = await waiting;
  assert.equal(result.stdout.length, 1024 * 1024); assert.deepEqual(result.overflow, [true, false]); assert.equal(result.code, 7); assert.ok(result.errors.includes('sink')); assert.deepEqual(result.pipeEnded, [true, true]); assert.deepEqual(result.writersClosed, [true, true]);
});
test('MODEL independent composition inverse preserves original parsers, forwarding and every C# byte', () => {
  const control = composeSources(sources, 'control'), treatment = composeSources(sources, 'absolute-import');
  const before = sources['windows-job.mjs'].toString(), transformed = control['windows-job.mjs'].toString();
  let inverse = transformed.slice(transformed.indexOf('// Windows-only process ownership for synthetic installed-app acceptance.'));
  const additions = [
    ['\n  let coldObserver; try { coldObserver = createImportObserver(); } catch {}', ''],
    ["child.stderr.on('data', chunk => { diagnostics.write(chunk); try { coldObserver?.write(chunk); } catch {} });", "child.stderr.on('data', chunk => diagnostics.write(chunk));"],
    ['diagnostics.freeze(); try { coldObserver?.freeze(error); } catch {} await cancel(); throw error;', 'diagnostics.freeze(); await cancel(); throw error;'],
    ['diagnostics.freeze(); try { coldObserver?.freeze(null); } catch {}\n  return {', 'diagnostics.freeze();\n  return {'],
  ];
  for (const [added, original] of additions) { assert.equal(inverse.split(added).length, 2); inverse = inverse.replace(added, original); }
  assert.equal(hash(Buffer.from(inverse)), '94712ee2ffc11983020512b9c8e3dff7f036f9cab9044c249b822025120755c8'); assert.equal(inverse, before);
  const helper = control['windows-job.ps1'].toString(), changed = treatment['windows-job.ps1'].toString();
  const insertion = String.raw`  Write-CallBoundary 'import' 'before'
  try {
    Import-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
  } catch {
    Write-CallBoundary 'import' 'error'
    throw
  }
  Write-CallBoundary 'import' 'return'
`;
  assert.equal(changed.split(insertion).length, 2); assert.equal(changed.replace(insertion, ''), helper);
  assert.equal(changed.slice(changed.indexOf("  Add-Type @'\n")), helper.slice(helper.indexOf("  Add-Type @'\n")));
  assert.ok(changed.indexOf("Write-CallBoundary 'decode' 'before'") < changed.indexOf(insertion));
  assert.ok(changed.indexOf(insertion) < changed.indexOf('$configuration = Microsoft.PowerShell.Utility\\ConvertFrom-Json'));
});
test('MODEL actual composed stderr callback forwards each chunk once before a throwing observer', () => {
  const module = composeSources(sources, 'control')['windows-job.mjs'].toString();
  const body = /child\.stderr\.on\('data', chunk => \{ (diagnostics\.write\(chunk\); try \{ coldObserver\?\.write\(chunk\); \} catch \{\}) \}\);/.exec(module)?.[1];
  assert.ok(body);
  const records = [], chunk1 = 'first', chunk2 = 'second';
  // Source-extracted trusted callback MODEL, no supervisor or native execution.
  const callback = new Function('diagnostics', 'coldObserver', 'chunk', body);
  const diagnostics = { write(chunk) { records.push(['original', chunk]); } }, observer = { write(chunk) { records.push(['observer', chunk]); throw Error('observer'); } };
  callback(diagnostics, observer, chunk1); callback(diagnostics, observer, chunk2);
  assert.deepEqual(records, [['original', chunk1], ['observer', chunk1], ['original', chunk2], ['observer', chunk2]]);
});

function checkWorkflow(workflow) {
  const branch = 'fix/spolahliva-alfa-sest-platform-20261021';
  assert.deepEqual(Object.keys(workflow.on), ['push']); assert.deepEqual(workflow.on.push.branches, [branch]);
  assert.deepEqual(workflow.on.push.paths, ['.github/workflows/ci-alpha-windows-qualified-cold-experiment.yml', 'lawoss/testing/alpha/windows-qualified-cold-experiment.mjs', 'lawoss/testing/alpha/windows-qualified-cold-experiment.test.mjs']);
  assert.deepEqual(workflow.permissions, { contents: 'read' }); assert.equal(workflow.concurrency['cancel-in-progress'], false); assert.equal(workflow.concurrency.group, 'windows-qualified-cold-experiment-${{ github.run_id }}');
  assert.deepEqual(Object.keys(workflow.jobs), ['first-helper']); const job = workflow.jobs['first-helper'];
  assert.equal(job.if, "${{ github.event_name == 'push' && github.ref == 'refs/heads/fix/spolahliva-alfa-sest-platform-20261021' && github.event.deleted == false && github.event.forced == false && github.run_attempt == '1' && github.event.head_commit.message == 'chore: spustit jediny cold-helper experiment 20261023' && github.event.after == github.sha && github.event.head_commit.id == github.sha }}");
  assert.equal(job['timeout-minutes'], 3); assert.equal(job.strategy['fail-fast'], false); assert.deepEqual(Object.keys(job.strategy.matrix), ['include']);
  assert.deepEqual(job.strategy.matrix.include, [{ os: 'windows-2022', arch: 'x64', arm: 'control' }, { os: 'windows-2022', arch: 'x64', arm: 'absolute-import' }, { os: 'windows-11-arm', arch: 'arm64', arm: 'control' }, { os: 'windows-11-arm', arch: 'arm64', arm: 'absolute-import' }]);
  assert.equal(job.steps.length, 4); assert.equal(job.steps[0].uses, 'actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803'); assert.equal(job.steps[0].with.ref, '${{ github.sha }}'); assert.equal(job.steps[0].with['persist-credentials'], false);
  assert.equal(job.steps[1].uses, 'actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38'); assert.equal(job.steps[1].with['node-version'], '24.21.0'); assert.equal(job.steps[2].shell, 'cmd');
  assert.equal(job.steps[2].run, 'node lawoss/testing/alpha/windows-qualified-cold-experiment.mjs --arm ${{ matrix.arm }} --arch ${{ matrix.arch }} --source-sha %GITHUB_SHA% --output "%RUNNER_TEMP%\\qualified-cold-${{ matrix.arch }}-${{ matrix.arm }}"');
  assert.equal(job.steps[3].if, 'always()'); assert.equal(job.steps[3].uses, 'actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02'); assert.equal(job.steps[3].with['retention-days'], 7); assert.equal(job.steps[3].with['if-no-files-found'], 'error');
  assert.deepEqual(job.steps[3].with.path.split('\n').map(value => value.split('/').at(-1)), ['receipt.json', 'source-manifest.json', 'native.stdout.ndjson', 'native.stderr.log']);
}
test('workflow parses as the JSON subset of YAML and admits exactly the four guarded first jobs', async () => {
  const workflow = JSON.parse(await readFile(new URL('../../../.github/workflows/ci-alpha-windows-qualified-cold-experiment.yml', import.meta.url), 'utf8')); checkWorkflow(workflow);
  for (const mutate of [w => { delete w.jobs['first-helper'].if; }, w => { w.jobs['first-helper'].strategy.matrix.include.pop(); }, w => { w.on.workflow_dispatch = {}; }, w => { w.jobs['first-helper'].if += ' '; }]) { const changed = structuredClone(workflow); mutate(changed); assert.throws(() => checkWorkflow(changed)); }
});

test('ACTUAL INERT pinned Node24 CLI verifies reporter import, omitted unrelated body and public event transport (NO POWERSHELL)', async t => {
  assert.equal(process.version, 'v24.21.0');
  const temp = await realpath(await mkdtemp(path.join(tmpdir(), 'cold-inert-'))); t.after(() => rm(temp, { recursive: true, force: true }));
  const own = fileURLToPath(new URL('./windows-qualified-cold-experiment.mjs', import.meta.url)), fixture = path.join(temp, 'windows-job.test.mjs'), p = projections();
  const source = `import assert from 'node:assert/strict';
import test from 'node:test';
import cp from 'node:child_process';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import {syncBuiltinESMExports} from 'node:module';
const restored=[]; let attempted=0, output=0;
for(const [o,keys] of [[cp,['spawn','execFileSync']],[fs,['createWriteStream']],[fsp,['mkdir','writeFile','open']]]) for(const key of keys){const original=o[key];restored.push(()=>o[key]=original);o[key]=()=>{attempted++;throw Error('import effect')};}
const out=process.stdout.write, err=process.stderr.write;
process.stdout.write=process.stderr.write=()=>{output++;return true};
syncBuiltinESMExports();
try {await import(${JSON.stringify(new URL('./windows-qualified-cold-experiment.mjs', import.meta.url).href)});assert.equal(attempted,0);assert.equal(output,0);} finally {for(const restore of restored)restore();process.stdout.write=out;process.stderr.write=err;syncBuiltinESMExports();}
test('unrelated inert filtered body MUST NOT RUN',()=>{throw Error('filtered-body-executed')});
test(${JSON.stringify(selected)},async t=>{
 const message=${JSON.stringify(JSON.stringify(p.imports))};
 process.stderr.write(message.slice(0,17));
 await new Promise(resolve=>setImmediate(resolve));
 process.stderr.write(message.slice(17)+'\\r\\n');
 t.diagnostic(${JSON.stringify(JSON.stringify(p.launch))});
});
`;
  await writeFile(fixture, source, { flag: 'wx' });
  const env = { ...process.env }; delete env.NODE_TEST_CONTEXT; delete env.NODE_OPTIONS; delete env.LAWOSS_COLD_EXPERIMENT_EVIDENCE;
  const out = new Writable({ write(chunk, encoding, cb) { cb(); } }), err = new Writable({ write(chunk, encoding, cb) { cb(); } });
  const child = spawn(process.execPath, testArgv(fixture, own), { env, stdio: ['ignore', 'pipe', 'pipe'] });
  const captured = await captureInvocation(child, out, err), parsed = validateRecords(captured.stdout);
  if (process.env.LAWOSS_COLD_EXPERIMENT_EVIDENCE) {
    const destination = process.env.LAWOSS_COLD_EXPERIMENT_EVIDENCE;
    await writeFile(path.join(destination, 'actual-inert-fixture.mjs.txt'), source);
    await writeFile(path.join(destination, 'actual-inert.stdout.ndjson'), captured.stdout);
    await writeFile(path.join(destination, 'actual-inert.stderr.log'), captured.stderr);
    const { stdout, stderr, ...lifetime } = captured;
    await writeFile(path.join(destination, 'actual-inert.json'), JSON.stringify({ syntheticOnly: true, powershellInvocations: 0, originalNativeInvocations: 0, processVersion: process.version, runtimeSha256: hash(await readFile(process.execPath)), reporterSha256: hash(await readFile(own)), fixtureSha256: hash(Buffer.from(source)), argv: ['--test', 'fixed-file-URL-reporter', 'exact-anchored-original-title', 'trusted-temporary-inert-file'], lifetime, valid: parsed.valid }, null, 2));
  }
  assert.equal(captured.code, 0); assert.equal(captured.signal, null); assert.equal(captured.spawnObserved, 1); assert.deepEqual(captured.pipeClosed, [true, true]); assert.deepEqual(captured.writersClosed, [true, true]);
  assert.equal(parsed.valid, true, captured.stdout.toString());
  assert.equal(parsed.records.filter(record => record.kind === 'selected-result').length, 1);
  assert.equal(parsed.records.filter(record => record.kind.endsWith('-summary')).length, 2);
});
test('MODEL reporter rejects duplicate execution and drains after the first invalid event', async () => {
  let consumed = 0;
  async function* events() { for (const type of ['test:start', 'test:start', 'test:pass', 'test:pass']) { consumed++; yield { type, data: { name: selected, nesting: 0, parentId: 0, testId: 2, file, entryFile: file, testNumber: 1, details: { type: 'test' } } }; } }
  const records = await collect(events());
  assert.equal(consumed, 4); assert.equal(records.filter(r => r.kind === 'invalid').length, 1);
  assert.equal(records[0].kind, 'selected-start');
  assert.equal(records.at(-1).valid, false); assert.ok(records.length <= 16);
});
