import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { launchWindowsJob, validateWindowsJobOptions, parseWindowsJobFrame, assertWindowsJobCompletion } from './windows-job.mjs';

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

test('unavailable Windows host refuses without attempting a simulated native launch', { skip: process.platform === 'win32' }, async () => {
  await assert.rejects(launchWindowsJob(options), /windows-job-host-unavailable/);
});

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
  const f = await nativeFixture(t), job = f.own(await launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 15000 }));
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
  await assert.rejects(launchWindowsJob({ executable: invalid, cwd: f.root, env: f.env, timeoutMs: 15000 }), /windows-job-/);
  await assert.rejects(launchWindowsJob({ executable: process.execPath, args: [f.leader], cwd: f.root, env: f.env, timeoutMs: 1 }), /windows-job-/);
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
