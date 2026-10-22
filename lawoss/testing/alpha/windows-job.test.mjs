import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import * as windowsJob from './windows-job.mjs';
import { launchWindowsJob, validateWindowsJobOptions, parseWindowsJobFrame, assertWindowsJobCompletion, parseWindowsJobCheckpoint } from './windows-job.mjs';

const options = { executable: 'C:\\app\\LAWOSS.exe', args: ['space here', 'quote"', 'trailing\\', ''],
  cwd: 'C:\\owned', env: { SystemRoot: 'C:\\Windows', PATH: 'C:\\pinned-node', HOME: 'C:\\owned\\home' }, timeoutMs: 10000 };
const nonce = 'a'.repeat(64);
const ready = { schema: 1, nonce, event: 'ready', pid: 123, supervisorPid: 456, rootRunning: true, activeProcesses: 1, creationFileTime: '133000000000000001' };
const stopped = { schema: 1, nonce, event: 'stopped', pid: 123, supervisorPid: 456, activeProcesses: 0, rootExited: true };

test('Windows launch contract preserves literal argv/env and rejects ambiguous or unbounded input', () => {
  assert.deepEqual(validateWindowsJobOptions(options), options);
  for (const patch of [
    { executable: 'LAWOSS.exe' }, { executable: 'C:\\bad\0.exe' }, { cwd: 'relative' }, { args: [null] },
    { args: ['bad\0arg'] }, { args: ['a'.repeat(32768)] }, { timeoutMs: 0 }, { timeoutMs: 300001 },
    { env: { PATH: 'a', Path: 'b' } }, { env: { KEY: 3 } }, { env: { 'BAD=KEY': 'value' } },
    { env: { KEY: 'bad\0value' } }, { env: { KEY: 'a'.repeat(32768) } },
  ]) assert.throws(() => validateWindowsJobOptions({ ...options, ...patch }), /windows-job-invalid-options/);
});

test('native attribute calls use the Windows SDK input attribute enum values', async () => {
  // Microsoft WinBase.h: ProcThreadAttributeJobList=13, HandleList=2;
  // ProcThreadAttributeValue combines the decimal enum with INPUT 0x20000.
  // https://raw.githubusercontent.com/microsoft/win32metadata/main/generation/WinSDK/RecompiledIdlHeaders/um/WinBase.h
  const source = await readFile(new URL('./windows-job.ps1', import.meta.url), 'utf8');
  for (const [variable, enumeration] of [['jobs', 13], ['handles', 2]]) {
    const argument = new RegExp(`UpdateProcThreadAttribute\\(attributes, 0, new IntPtr\\((0x[0-9a-fA-F]+)\\), ${variable},`).exec(source);
    assert.ok(argument, `Missing native ${variable} attribute call`);
    assert.equal(Number(argument[1]), 0x20000 | enumeration);
  }
});

test('private supervisor protocol accepts only current nonce, closed finite frames and exact helper identity', () => {
  assert.deepEqual(parseWindowsJobFrame(JSON.stringify(ready), { nonce, supervisorPid: 456 }), ready);
  for (const frame of [
    { ...ready, nonce: 'b'.repeat(64) }, { ...ready, supervisorPid: 999 }, { ...ready, pid: 0 },
    { ...ready, activeProcesses: -1 }, { ...ready, creationFileTime: Number(ready.creationFileTime) },
    { ...ready, extra: 'private' }, { ...ready, event: 'app-output' },
  ]) assert.throws(() => parseWindowsJobFrame(JSON.stringify(frame), { nonce, supervisorPid: 456 }), /windows-job-invalid-protocol/);
  for (const line of ['not-json', 'x'.repeat(4097)]) assert.throws(() => parseWindowsJobFrame(line, { nonce, supervisorPid: 456 }), /windows-job-invalid-protocol/);
  const duplicatePid = JSON.stringify(ready).replace('"pid":123', '"pid":999,"pid":123');
  assert.throws(() => parseWindowsJobFrame(duplicatePid, { nonce, supervisorPid: 456 }), /windows-job-invalid-protocol/);
});

test('cleanup contract requires job zero, exact root exit and supervisor successful close', () => {
  assert.deepEqual(assertWindowsJobCompletion(stopped, { code: 0, signal: null }, { pid: 123, supervisorPid: 456 }), {
    status: 'stopped', descendantClosure: 'verified', method: 'windows-atomic-job-object',
  });
  for (const [receipt, close] of [
    [undefined, { code: 0, signal: null }], [{ ...stopped, activeProcesses: 1 }, { code: 0, signal: null }],
    [{ ...stopped, rootExited: false }, { code: 0, signal: null }], [{ ...stopped, pid: 124 }, { code: 0, signal: null }],
    [stopped, undefined], [stopped, { code: 1, signal: null }], [stopped, { code: 0, signal: 'SIGTERM' }],
  ]) assert.throws(() => assertWindowsJobCompletion(receipt, close, { pid: 123, supervisorPid: 456 }), /windows-job-closure-unverified/);
});

test('supervisor diagnostics project only exact completed checkpoint enums', () => {
  for (const phase of ['entry', 'encoding', 'input-read', 'decoded', 'configured', 'compiled', 'created']) assert.equal(parseWindowsJobCheckpoint(`LAWOSS_WINDOWS_JOB_CHECKPOINT:${phase}`), phase);
  for (const line of ['raw private error', 'prefix LAWOSS_WINDOWS_JOB_CHECKPOINT:entry', 'LAWOSS_WINDOWS_JOB_CHECKPOINT:private', 'LAWOSS_WINDOWS_JOB_CHECKPOINT:compiled private', 'x'.repeat(10000)]) assert.equal(parseWindowsJobCheckpoint(line), null);
});

test('checkpoint observers receive only exact phases and cannot change parser results', () => {
  const phases = ['entry', 'encoding', 'input-read', 'decoded', 'configured', 'compiled', 'created'];
  const observed = [];
  for (const phase of phases) assert.equal(parseWindowsJobCheckpoint(`LAWOSS_WINDOWS_JOB_CHECKPOINT:${phase}`, value => observed.push(value)), phase);
  assert.deepEqual(observed, phases);
  for (const line of [undefined, null, 42, 'raw private error', 'prefix LAWOSS_WINDOWS_JOB_CHECKPOINT:entry', 'LAWOSS_WINDOWS_JOB_CHECKPOINT:private', 'LAWOSS_WINDOWS_JOB_CHECKPOINT:compiled private', 'LAWOSS_WINDOWS_JOB_CHECKPOINT:entry\n', 'x'.repeat(10000)]) {
    assert.equal(parseWindowsJobCheckpoint(line, value => observed.push(value)), null);
  }
  assert.deepEqual(observed, phases);
  for (const phase of phases) assert.equal(parseWindowsJobCheckpoint(`LAWOSS_WINDOWS_JOB_CHECKPOINT:${phase}`, () => { throw new Error('observer failure'); }), phase);
});

test('CALL boundary grammar admits only six frozen finite records', () => {
  const parse = windowsJob.parseWindowsJobCallBoundary;
  assert.equal(typeof parse, 'function', 'new finite CALL parser is missing');
  for (const operation of ['decode', 'compile']) for (const boundary of ['before', 'return', 'error']) {
    for (const [elapsed, capped] of [[0, 0], [1, 0], [60000, 0], [60000, 1]]) {
      const line = `LAWOSS_WINDOWS_JOB_CALL:${operation}:${boundary}:${elapsed}:${capped}`;
      const value = parse(line);
      assert.deepEqual(value, { event: `${operation}-${boundary}`, childElapsedMs: elapsed, childElapsedCapped: capped === 1 });
      assert.equal(Object.isFrozen(value), true);
      assert.equal(parseWindowsJobCheckpoint(line), null);
    }
  }
  for (const line of [undefined, null, 1, {}, 'x'.repeat(10000),
    ...['-1','+1','01','1.0','1e2','60001','999999999999999999999',''].map(n=>`LAWOSS_WINDOWS_JOB_CALL:decode:before:${n}:0`),
    ...['2','true','01',''].map(n=>`LAWOSS_WINDOWS_JOB_CALL:decode:before:60000:${n}`),
    'LAWOSS_WINDOWS_JOB_CALL:decode:before:1:1', 'LAWOSS_WINDOWS_JOB_CALL:private:before:1:0',
    'LAWOSS_WINDOWS_JOB_CALL:decode:entered:1:0', 'LAWOSS_WINDOWS_JOB_CALL:decode:before:1:0:extra',
    ' LAWOSS_WINDOWS_JOB_CALL:decode:before:1:0', 'LAWOSS_WINDOWS_JOB_CALL:decode:before:1:0 ',
    'LAWOSS_WINDOWS_JOB_CALL:decode:before:1:0\n', 'LAWOSS_WINDOWS_JOB_CALL:decode:before:1:0\r']) assert.equal(parse(line), null);
});

test('CALL parent delivery caps independently of frozen child elapsed observations', () => {
  const calls = callObservations(performance.now() - 60001);
  const projector = windowsJob.createWindowsJobDiagnosticProjector(undefined, calls.observe);
  projector.write('LAWOSS_WINDOWS_JOB_CALL:decode:before:2:0\n');
  assert.deepEqual(calls.slots['decode-before'], { childElapsedMs: 2, childElapsedCapped: false,
    parentDeliveryElapsedMs: 60000, parentDeliveryElapsedCapped: true });
  assert.equal(Object.isFrozen(calls.slots['decode-before']), true);
  projector.freeze();
  projector.write('LAWOSS_WINDOWS_JOB_CALL:decode:return:3:0\n');
  assert.equal(calls.slots['decode-return'], null);
});

test('CALL stderr projector bounds fragmented lines, fixes first slots and freezes observers', () => {
  assert.equal(typeof windowsJob.createWindowsJobDiagnosticProjector, 'function', 'new bounded stderr projector is missing');
  const phases = [], calls = [];
  const projector = windowsJob.createWindowsJobDiagnosticProjector(phase => { phases.push(phase); throw new Error('observer'); }, value => { calls.push(value); throw new Error('observer'); });
  projector.write('raw private path/error\nLAWOSS_WINDOWS_JOB_CHECK');
  projector.write('POINT:configured\r\nLAWOSS_WINDOWS_JOB_CALL:decode:be');
  projector.write('fore:1:0\r\nLAWOSS_WINDOWS_JOB_CALL:decode:before:2:0\n');
  projector.write('x'.repeat(257)); projector.write('LAWOSS_WINDOWS_JOB_CALL:compile:before:3:0\n');
  projector.write('LAWOSS_WINDOWS_JOB_CALL:decode:return:5:0\nLAWOSS_WINDOWS_JOB_CALL:decode:error:6:0\n');
  projector.write('LAWOSS_WINDOWS_JOB_CALL:compile:before:60000:1\n');
  assert.deepEqual(phases, ['configured']);
  assert.equal(projector.lastCheckpoint, 'configured');
  assert.deepEqual(calls, [
    { event: 'decode-before', childElapsedMs: 1, childElapsedCapped: false },
    { event: 'decode-return', childElapsedMs: 5, childElapsedCapped: false },
    { event: 'compile-before', childElapsedMs: 60000, childElapsedCapped: true },
  ]);
  projector.freeze(); projector.freeze();
  projector.write('LAWOSS_WINDOWS_JOB_CHECKPOINT:compiled\nLAWOSS_WINDOWS_JOB_CALL:compile:error:60000:1\n');
  assert.equal(phases.length, 1); assert.equal(calls.length, 3);
  const silent = windowsJob.createWindowsJobDiagnosticProjector();
  silent.write('LAWOSS_WINDOWS_JOB_CHECKPOINT:entry\n');
  assert.equal(silent.lastCheckpoint, 'entry');
  const terminal = [];
  const other = windowsJob.createWindowsJobDiagnosticProjector(undefined, record => terminal.push(record));
  other.write('LAWOSS_WINDOWS_JOB_CALL:compile:error:3:0\nLAWOSS_WINDOWS_JOB_CALL:compile:return:4:0\n');
  assert.deepEqual(terminal.map(value=>value.event), ['compile-error']);
});

test('unavailable Windows host refuses without attempting a simulated native launch', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(launchWindowsJob(options), /windows-job-host-unavailable/);
});

function callObservations(started) {
  const slots = { 'decode-before': null, 'decode-return': null, 'decode-error': null,
    'compile-before': null, 'compile-return': null, 'compile-error': null };
  return { slots, observe(record) {
    if (!Object.hasOwn(slots, record.event) || slots[record.event] !== null) return;
    const elapsed = Math.max(0, Math.round(performance.now() - started));
    slots[record.event] = Object.freeze({ childElapsedMs: record.childElapsedMs, childElapsedCapped: record.childElapsedCapped,
      parentDeliveryElapsedMs: Math.min(60000, elapsed), parentDeliveryElapsedCapped: elapsed > 60000 });
  } };
}

const native = { skip: process.platform !== 'win32', timeout: 45000 };
async function until(check, timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) { const value = await check(); if (value) return value; await delay(30); }
  throw new Error('Native Windows fixture deadline');
}
const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { if (error.code === 'ESRCH') return false; throw error; } };
async function nativeFixture(t, { exitLeader = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'alpha-windows-job-'));
  const home = path.join(root, 'home'); await mkdir(home);
  const leaf = path.join(root, 'grandchild with spaces.mjs'), leader = path.join(root, 'leader.mjs'), receipt = path.join(root, 'pids.json');
  await writeFile(leaf, 'setInterval(()=>{},1000);');
  await writeFile(leader, `import {spawn} from 'node:child_process';import {writeFileSync} from 'node:fs';const child=spawn(process.execPath,[${JSON.stringify(leaf)}],{detached:true,stdio:'ignore'});child.unref();writeFileSync(${JSON.stringify(receipt)},JSON.stringify({root:process.pid,grandchild:child.pid}));${exitLeader ? 'setTimeout(()=>process.exit(0),500);' : 'setInterval(()=>{},1000);'}`);
  const env = { SystemRoot: process.env.SystemRoot, WINDIR: process.env.WINDIR ?? process.env.SystemRoot, PATH: process.env.PATH,
    HOME: home, USERPROFILE: home, APPDATA: home, LOCALAPPDATA: home, TEMP: root, TMP: root };
  let job;
  t.after(async () => { try { await job?.stop(); } catch { /* Helper-death test deliberately cannot prove closure. */ } finally { await rm(root, { recursive: true, force: true }); } });
  return { root, leader, receipt, env, own(value) { job = value; return value; } };
}

test('native Windows job stops root and detached grandchild before returning verified closure', native, async t => {
  const f = await nativeFixture(t);
  const checkpointFirstObservedMs = { entry: null, encoding: null, 'input-read': null, decoded: null, configured: null, compiled: null, created: null };
  let job, outcome = 'failed';
  const started = performance.now(), calls = callObservations(started);
  try {
    job = f.own(await launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 15000 }, phase => {
      if (Object.hasOwn(checkpointFirstObservedMs, phase) && checkpointFirstObservedMs[phase] === null) checkpointFirstObservedMs[phase] = Math.min(60000, Math.max(0, Math.round(performance.now() - started)));
    }, calls.observe));
    outcome = 'ready';
  } finally {
    const elapsed = Math.max(0, Math.round(performance.now() - started));
    t.diagnostic(JSON.stringify({ kind: 'lawoss-windows-job-launch-observer', timingSemantics: 'parent-observed-checkpoint-delivery', snapshotBoundary: 'observer-released-before-cancel-or-ready-return', checkpointFirstObservedMs, callBoundaryFirstObserved: calls.slots, callTimingSemantics: 'child-relative-source-bracket-and-parent-delivery-independent-origins', elapsedMs: Math.min(60000, elapsed), elapsedCapped: elapsed > 60000, elapsedMayIncludeInternalCancellation: outcome === 'failed', outcome }));
  }
  const pids = await until(async () => { try { return JSON.parse(await readFile(f.receipt, 'utf8')); } catch { return false; } });
  assert.equal(job.pid, pids.root); assert.notEqual(job.pid, job.supervisorPid); assert.equal(job.isRunning(), true);
  assert.equal(exists(pids.grandchild), true);
  assert.equal((await job.stop()).descendantClosure, 'verified');
  assert.equal(job.isRunning(), false);
  assert.equal(exists(pids.root), false); assert.equal(exists(pids.grandchild), false);
  assert.equal((await job.stop()).descendantClosure, 'verified');
});

test('native Windows job still owns a detached grandchild after root exit', native, async t => {
  const f = await nativeFixture(t, { exitLeader: true }), job = f.own(await launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 15000 }));
  const pids = await until(async () => { try { return JSON.parse(await readFile(f.receipt, 'utf8')); } catch { return false; } });
  await until(() => !job.isRunning());
  assert.equal(exists(pids.grandchild), true);
  assert.equal((await job.stop()).descendantClosure, 'verified');
  assert.equal(exists(pids.grandchild), false);
});

test('native Windows helper death kills its job but never yields a verified cleanup receipt', native, async t => {
  const f = await nativeFixture(t), job = f.own(await launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 15000 }));
  const pids = await until(async () => { try { return JSON.parse(await readFile(f.receipt, 'utf8')); } catch { return false; } });
  process.kill(job.supervisorPid);
  await until(() => !job.isRunning());
  await assert.rejects(job.stop(), /windows-job-/);
  await assert.rejects(job.stop(), /windows-job-/);
  await until(() => !exists(pids.root) && !exists(pids.grandchild));
});

test('native Windows invalid executable and expired startup never become a running job', native, async t => {
  const f = await nativeFixture(t), invalid = path.join(f.root, 'invalid.exe');
  await writeFile(invalid, 'not a PE executable');
  await assert.rejects(launchWindowsJob({ executable: invalid, cwd: f.root, env: f.env, timeoutMs: 15000 }), { code: 'windows-job-start-failed' });
  await assert.rejects(launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 1 }), { code: 'windows-job-start-timeout' });
});

test('native Windows preserves Unicode paths and literal argv while app output cannot enter control pipes', native, async t => {
  const f = await nativeFixture(t), script = path.join(f.root, 'žluťoučký native child.mjs'), receipt = path.join(f.root, 'argv.json');
  await writeFile(script, `import {writeFileSync} from 'node:fs';process.stdout.write('not-a-supervisor-frame\\n');process.stderr.write('also-not-a-supervisor-frame\\n');writeFileSync(${JSON.stringify(receipt)},JSON.stringify({args:process.argv.slice(2),marker:process.env.OWNED_MARKER}));setInterval(()=>{},1000);`);
  const args = ['space here', 'quote"', 'trailing\\', '', 'žluťoučký'];
  const job = f.own(await launchWindowsJob({ executable: process.execPath, args: [script, ...args], cwd: f.root, env: { ...f.env, OWNED_MARKER: 'syntetický' }, timeoutMs: 15000 }));
  const observed = await until(async () => { try { return JSON.parse(await readFile(receipt, 'utf8')); } catch { return false; } });
  assert.deepEqual(observed, { args, marker: 'syntetický' });
  assert.equal(job.isRunning(), true);
  assert.equal((await job.stop()).descendantClosure, 'verified');
});

for (const eof of [false, true]) test(`native Windows Console configuration probe with writer ${eof ? 'closed' : 'open'}`, native, async t => {
  const f = await nativeFixture(t), probe = path.join(f.root, 'console-probe.ps1');
  await writeFile(probe, `[Console]::Error.WriteLine('probe-entry')\n[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n[Console]::Error.WriteLine('probe-encoding')\n$line = [Console]::In.ReadLine()\n[Console]::Error.WriteLine('probe-read')\nif ($line -cne 'synthetic-configuration') { exit 125 }\n[Console]::Out.WriteLine('synthetic-configuration-consumed')\n`);
  const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const child = spawn(helper, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe], { env: f.env, cwd: f.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errorOutput = '', exit;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output = (output + chunk).slice(0, 1024); }); child.stderr.on('data', chunk => { errorOutput = (errorOutput + chunk).slice(-1024); });
  child.once('error', () => { exit = { code: 'spawn-error', signal: null }; });
  child.once('close', (code, signal) => { exit = { code, signal }; });
  f.own({ stop: async () => { if (!exit) { child.stdin.destroy(); child.kill(); await until(() => exit, 1000); } } });
  if (eof) child.stdin.end('synthetic-configuration\n'); else child.stdin.write('synthetic-configuration\n');
  try { await until(() => exit, 15000); }
  catch { assert.fail(`Console configuration probe timed out; completed=${['probe-entry', 'probe-encoding', 'probe-read'].filter(marker => errorOutput.split(/\r?\n/).includes(marker)).join(',')}`); }
  assert.deepEqual(exit, { code: 0, signal: null });
  assert.ok(output.trim() === 'synthetic-configuration-consumed', 'Unexpected synthetic Console probe output');
});

test('native Windows qualified decoder consumes actual-size JSON while the private control writer stays open', native, async t => {
  const f = await nativeFixture(t), probe = path.join(f.root, 'json-probe.ps1');
  const configuration = JSON.stringify({ schema: 1, nonce, executable: process.execPath, args: ['x'.repeat(4096)], cwd: f.root, env: f.env, timeoutMs: 15000 });
  await writeFile(probe, `$ErrorActionPreference = 'Stop'\n[Console]::Error.WriteLine('probe-entry')\n$callClock = $null\ntry { $callClock = [System.Diagnostics.Stopwatch]::StartNew() } catch { }\nfunction Write-CallBoundary([string]$operation, [string]$boundary) {\n  try {\n    if ($null -eq $callClock) { return }\n    $elapsed = $callClock.ElapsedMilliseconds\n    $capped = '0'\n    if ($elapsed -lt 0) { $elapsed = 0 }\n    if ($elapsed -gt 60000) { $elapsed = 60000; $capped = '1' }\n    [Console]::Error.WriteLine('LAWOSS_WINDOWS_JOB_CALL:' + $operation + ':' + $boundary + ':' + $elapsed + ':' + $capped)\n  } catch { }\n}\n[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)\n[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)\n[Console]::Error.WriteLine('probe-encoding')\n$line = [Console]::In.ReadLine()\n[Console]::Error.WriteLine('probe-read')\nif ($line.Length -ne ${configuration.length}) { exit 125 }\nWrite-CallBoundary 'decode' 'before'\ntry {\n$decoded = Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject $line\n} catch {\n  Write-CallBoundary 'decode' 'error'\n  throw\n}\nWrite-CallBoundary 'decode' 'return'\n[Console]::Error.WriteLine('probe-decoded')\nif ($decoded.schema -ne 1 -or $decoded.args[0].Length -ne 4096) { exit 125 }\n[Console]::Out.WriteLine('synthetic-json-consumed')\n`);
  const helper = path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const started = performance.now(), checkpoints = { 'probe-entry': null, 'probe-encoding': null, 'probe-read': null, 'probe-decoded': null };
  const calls = callObservations(started), diagnostics = windowsJob.createWindowsJobDiagnosticProjector(undefined, calls.observe);
  const child = spawn(helper, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', probe], { env: f.env, cwd: f.root, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', errorOutput = '', exit, spawnErrorObserved = false, closeObserved = false;
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
  child.stdout.on('data', chunk => { output = (output + chunk).slice(0, 1024); });
  child.stderr.on('data', chunk => {
    diagnostics.write(chunk);
    errorOutput = (errorOutput + chunk).slice(-1024);
    const lines = errorOutput.split(/\r?\n/).slice(0, -1);
    for (const marker of Object.keys(checkpoints)) if (checkpoints[marker] === null && lines.includes(marker)) {
      checkpoints[marker] = Math.min(60000, Math.round(performance.now() - started));
    }
  });
  child.once('error', () => { spawnErrorObserved = true; exit = { code: 'spawn-error', signal: null }; });
  child.once('close', (code, signal) => { closeObserved = true; exit = { code, signal }; });
  f.own({ stop: async () => { if (!exit) { child.stdin.destroy(); child.kill(); await until(() => exit, 1000); } } });
  child.stdin.write(`${configuration}\n`);
  try {
    try { await until(() => exit, 15000); }
    catch { assert.fail(`Qualified JSON configuration timed out; completed=${['probe-entry', 'probe-encoding', 'probe-read', 'probe-decoded'].filter(marker => errorOutput.split(/\r?\n/).includes(marker)).join(',')}; callBoundaries=${Object.keys(calls.slots).filter(event => calls.slots[event] !== null).join(',')}`); }
    assert.deepEqual(exit, { code: 0, signal: null });
    assert.ok(output.trim() === 'synthetic-json-consumed', 'Unexpected synthetic JSON probe output');
  } finally {
    // Parent-observed pipe delivery times, not durations inside PowerShell.
    // Freeze before t.after cleanup; never publish input, output or identifiers.
    diagnostics.freeze();
    const elapsed = Math.round(performance.now() - started);
    t.diagnostic(JSON.stringify({ kind: 'lawoss-cold-windows-json-probe', elapsedMs: Math.min(60000, elapsed), elapsedCapped: elapsed > 60000,
      callBoundaryFirstObserved: calls.slots, callTimingSemantics: 'child-relative-source-bracket-and-parent-delivery-independent-origins',
      checkpointObservedMs: checkpoints, closeObserved, spawnError: spawnErrorObserved,
      exitCode: Number.isInteger(exit?.code) && exit.code >= 0 && exit.code <= 255 ? exit.code : null,
      signal: exit?.signal === null ? null : ['SIGTERM', 'SIGKILL'].includes(exit?.signal) ? exit.signal : 'unknown' }));
  }
});
