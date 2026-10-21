// Windows-only process ownership for synthetic installed-app acceptance.
// App stdio never shares this supervisor's private protocol pipes.
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

function blocked(code) { return Object.assign(new Error(code), { code, status: 'blocked', descendantClosure: 'unknown' }); }
const pid = value => Number.isSafeInteger(value) && value > 0 && value <= 0xffffffff;
const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;

export function validateWindowsJobOptions(options) {
  const { executable, args = [], cwd, env, timeoutMs = 15000 } = options ?? {};
  const text = value => typeof value === 'string' && !value.includes('\0');
  const absolute = value => text(value) && path.win32.isAbsolute(value) && /^[A-Za-z]:[\\/]/.test(value);
  if (!absolute(executable) || !absolute(cwd) || !Array.isArray(args) || args.some(arg => !text(arg)) ||
    !env || typeof env !== 'object' || Array.isArray(env) || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 300000) throw blocked('windows-job-invalid-options');
  const entries = Object.entries(env), keys = entries.map(([key]) => key.toLowerCase());
  if (new Set(keys).size !== keys.length || entries.some(([key, value]) => !/^[A-Za-z_][A-Za-z0-9_() -]*$/.test(key) || !text(value)) ||
    entries.reduce((size, [key, value]) => size + key.length + value.length + 2, 1) > 32767 ||
    args.reduce((size, arg) => size + arg.length + 3, executable.length + 3) > 32767) throw blocked('windows-job-invalid-options');
  return { executable, args: [...args], cwd, env: Object.fromEntries(entries), timeoutMs };
}

/** Closed protocol parsing is a contract check, never native execution proof. */
export function parseWindowsJobFrame(line, { nonce, supervisorPid }) {
  let frame;
  try { if (typeof line !== 'string' || Buffer.byteLength(line) > 4096) throw 0; frame = JSON.parse(line); }
  catch { throw blocked('windows-job-invalid-protocol'); }
  const common = ['schema', 'nonce', 'event', 'supervisorPid'];
  const fields = frame?.event === 'ready' || frame?.event === 'state' ? [...common, 'pid', 'rootRunning', 'activeProcesses', 'creationFileTime']
    : frame?.event === 'stopped' ? [...common, 'pid', 'activeProcesses', 'rootExited']
      : frame?.event === 'error' ? [...common, 'code'] : [];
  if (!frame || Array.isArray(frame) || JSON.stringify(frame) !== line || fields.length === 0 || Object.keys(frame).length !== fields.length || fields.some(key => !(key in frame)) ||
    frame.schema !== 1 || frame.nonce !== nonce || !pid(frame.supervisorPid) || frame.supervisorPid !== supervisorPid) throw blocked('windows-job-invalid-protocol');
  if (frame.event === 'error') {
    if (!['job-start-failed', 'job-protocol-failed', 'job-stop-failed', 'job-supervisor-failed'].includes(frame.code)) throw blocked('windows-job-invalid-protocol');
  } else if (!pid(frame.pid) || !count(frame.activeProcesses) ||
    (frame.event === 'stopped' ? typeof frame.rootExited !== 'boolean' : typeof frame.rootRunning !== 'boolean' || typeof frame.creationFileTime !== 'string' || !/^[1-9]\d{0,19}$/.test(frame.creationFileTime))) throw blocked('windows-job-invalid-protocol');
  return frame;
}

export function assertWindowsJobCompletion(receipt, close, expected) {
  if (receipt?.event !== 'stopped' || receipt.pid !== expected.pid || receipt.supervisorPid !== expected.supervisorPid || receipt.activeProcesses !== 0 || receipt.rootExited !== true || close?.code !== 0 || close.signal !== null) throw blocked('windows-job-closure-unverified');
  return { status: 'stopped', descendantClosure: 'verified', method: 'windows-atomic-job-object' };
}

async function within(timeoutMs, predicate, code) {
  const deadline = performance.now() + timeoutMs;
  do {
    const value = predicate(); if (value) return value;
    const remaining = deadline - performance.now(); if (remaining <= 0) break;
    await delay(Math.min(20, remaining));
  } while (performance.now() <= deadline);
  throw blocked(code);
}

export async function launchWindowsJob(input) {
  const options = validateWindowsJobOptions(input);
  if (process.platform !== 'win32') throw blocked('windows-job-host-unavailable');
  const executable = await realpath(options.executable), cwd = await realpath(options.cwd);
  if (!(await lstat(executable)).isFile() || !(await lstat(cwd)).isDirectory()) throw blocked('windows-job-invalid-options');
  const systemRoot = process.env.SystemRoot ?? process.env.SYSTEMROOT;
  if (!systemRoot || !path.win32.isAbsolute(systemRoot)) throw blocked('windows-job-system-root-unavailable');
  const supervisor = path.join(systemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const helper = fileURLToPath(new URL('./windows-job.ps1', import.meta.url));
  const nonce = randomBytes(32).toString('hex');
  const supervisorEnv = Object.fromEntries(Object.entries(options.env).filter(([key]) => key.toLowerCase() !== 'systemroot'));
  const child = spawn(supervisor, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper], {
    cwd, env: { ...supervisorEnv, SystemRoot: systemRoot }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'],
  });
  let ready, state, receipt, close, fault, stopRequested = false, stopPromise, buffered = '', lastStateAt = 0;
  const fail = code => { fault ??= blocked(code); child.kill(); };
  child.on('error', () => { fault ??= blocked('windows-job-supervisor-failed'); });
  child.stdin.on('error', () => { fault ??= blocked('windows-job-control-pipe-failed'); });
  child.stdout.on('error', () => fail('windows-job-supervisor-pipe-failed'));
  child.stderr.on('error', () => fail('windows-job-supervisor-pipe-failed'));
  child.stderr.resume(); // Never publish compiler errors, environment, or app output.
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    try {
      for (;;) {
        const end = buffered.indexOf('\n');
        if (end === -1) { if (Buffer.byteLength(buffered) > 4096) throw blocked('windows-job-invalid-protocol'); break; }
        const line = buffered.slice(0, end).replace(/\r$/, ''); buffered = buffered.slice(end + 1);
        const frame = parseWindowsJobFrame(line, { nonce, supervisorPid: child.pid });
        if (frame.event === 'error') throw blocked(`windows-${frame.code}`);
        if (frame.event === 'ready') {
          if (ready || stopRequested) throw blocked('windows-job-invalid-protocol');
          ready = state = frame;
        } else {
          if (!ready || frame.pid !== ready.pid) throw blocked('windows-job-invalid-protocol');
          if (frame.event === 'state') {
            if (receipt || frame.creationFileTime !== ready.creationFileTime || (state?.rootRunning === false && frame.rootRunning)) throw blocked('windows-job-invalid-protocol');
            state = frame;
          } else {
            if (!stopRequested || receipt) throw blocked('windows-job-invalid-protocol');
            receipt = frame;
          }
        }
        lastStateAt = performance.now();
      }
    } catch (error) { fail(error.code ?? 'windows-job-invalid-protocol'); }
  });
  child.once('close', (code, signal) => {
    close = { code, signal };
    if (buffered.trim() || !stopRequested) fault ??= blocked('windows-job-supervisor-closed');
  });
  const cancel = async () => {
    child.stdin.destroy(); child.kill();
    try { await within(Math.min(1000, options.timeoutMs), () => close, 'windows-job-supervisor-close-unverified'); }
    catch { child.unref(); child.stdout.destroy(); child.stderr.destroy(); }
  };
  try {
    child.stdin.write(`${JSON.stringify({ schema: 1, nonce, executable, args: options.args, cwd, env: options.env, timeoutMs: options.timeoutMs })}\n`);
    await within(options.timeoutMs, () => {
      if (fault) throw fault;
      if (close) throw blocked('windows-job-supervisor-closed');
      if (ready && !state.rootRunning) throw blocked('windows-job-root-exited');
      return ready;
    }, 'windows-job-start-timeout');
  } catch (error) { await cancel(); throw error; }
  return {
    pid: ready.pid, supervisorPid: child.pid,
    isRunning: () => !fault && !close && !stopRequested && state.rootRunning && performance.now() - lastStateAt < 1000,
    stop: () => stopPromise ??= (async () => {
      stopRequested = true;
      try {
        if (fault) throw fault;
        if (close) throw blocked('windows-job-supervisor-closed');
        child.stdin.end(`stop ${nonce}\n`);
        await within(options.timeoutMs, () => { if (fault) throw fault; return close; }, 'windows-job-stop-timeout');
        return assertWindowsJobCompletion(receipt, close, { pid: ready.pid, supervisorPid: child.pid });
      } catch (error) { await cancel(); throw error; }
    })(),
  };
}
