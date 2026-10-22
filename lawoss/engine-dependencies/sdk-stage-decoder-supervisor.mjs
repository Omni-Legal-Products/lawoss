// Test-owned launch records are mismatch detectors, never production launch
// authority. App/ASAR/channel authentication remains a separate, unspecified gate.
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, lstat, open, realpath } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { types } from 'node:util';
import { performance } from 'node:perf_hooks';
import { admitStageDecodeRequest, admitStageDecodeResult } from './sdk-stage-decoder-contract.mjs';
import { createStageWireDecoder, encodeStageWireFrame, admitStageError } from './sdk-stage-decoder-wire.mjs';

const owners = new Set();
const localErrors = new WeakSet();
const fault = code => { const error = Object.assign(new Error(code), { code }); localErrors.add(error); return error; };
const aborted = Object.getOwnPropertyDescriptor(AbortSignal.prototype, 'aborted').get;
const addAbort = EventTarget.prototype.addEventListener, removeAbort = EventTarget.prototype.removeEventListener;
const same = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino);
const physical = (a, b) => same(a, b) && ['size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink', 'uid'].every(key => a[key] === b[key]);
const privateMode = stat => process.platform === 'win32' || (stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n);
function record(value, names, code) {
  if (!value || typeof value !== 'object' || types.isProxy(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw fault(code);
  const fields = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(fields);
  if (keys.length !== names.length || keys.some(key => !names.includes(key)) || names.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) throw fault(code);
  return Object.fromEntries(names.map(key => [key, fields[key].value]));
}
// Proxy refusal precedes reflection. A remains the sole request business policy.
function snapshot(value, maxValues, maxDepth, maxBytes, code) {
  let values = 0, bytes = 0;
  function string(s) { bytes += Buffer.byteLength(s); if (bytes > maxBytes) throw fault(code); }
  function visit(item, depth) {
    if (++values > maxValues || depth > maxDepth) throw fault(code);
    if (typeof item === 'string') { string(item); return item; }
    if (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))) return item;
    if (!item || typeof item !== 'object' || types.isProxy(item) || ![Object.prototype, null].includes(Object.getPrototypeOf(item))) throw fault(code);
    const fields = Object.getOwnPropertyDescriptors(item), keys = Reflect.ownKeys(fields), copy = Object.create(null);
    if (keys.length > maxValues) throw fault(code);
    for (const key of keys) {
      const field = fields[key];
      if (typeof key !== 'string' || !field.enumerable || !Object.hasOwn(field, 'value')) throw fault(code);
      string(key); Object.defineProperty(copy, key, { value: visit(field.value, depth + 1), enumerable: true });
    }
    return Object.freeze(copy);
  }
  return visit(value, 0);
}
function launchData(value) {
  const code = 'STAGE_LAUNCH_MISMATCH';
  const launch = snapshot(value, 128, 2, 65536, code);
  record(launch, ['schema', 'kind', 'provenance', 'nodePath', 'nodeDev', 'nodeIno', 'nodeBytes', 'nodeSha256',
    'workerPath', 'workerDev', 'workerIno', 'workerBytes', 'workerSha256', 'workDirectory', 'workDev', 'workIno', 'systemRoot'], code);
  const absolute = s => typeof s === 'string' && s.length <= 4096 && Buffer.byteLength(s) <= 16384 && !s.includes('\0') && path.isAbsolute(s) && path.normalize(s) === s && path.resolve(s) === s;
  const decimal = (s, nonzero = false) => typeof s === 'string' && /^(?:0|[1-9][0-9]{0,39})$/.test(s) && (!nonzero || s !== '0');
  if (launch.schema !== 1 || launch.kind !== 'lawoss-sdk-stage-test-launch' || launch.provenance !== 'test-owned-bundle-v1' ||
    !['nodePath', 'workerPath', 'workDirectory'].every(key => absolute(launch[key])) || path.dirname(launch.workerPath) !== launch.workDirectory ||
    !['node', 'worker', 'work'].every(prefix => decimal(launch[prefix + 'Dev']) && decimal(launch[prefix + 'Ino'], true)) ||
    !['node', 'worker'].every(prefix => typeof launch[prefix + 'Sha256'] === 'string' && /^[a-f0-9]{64}$/.test(launch[prefix + 'Sha256']) && Number.isSafeInteger(launch[prefix + 'Bytes']) && launch[prefix + 'Bytes'] > 0) ||
    launch.nodeBytes > 512 * 1024 * 1024 || launch.workerBytes > 16 * 1024 * 1024 ||
    (process.platform === 'win32' ? !absolute(launch.systemRoot) : launch.systemRoot !== null)) throw fault(code);
  return launch;
}

export async function runOwnedStageDecoder(value) {
  // Capture the wall-to-monotonic mapping before any async work or admission.
  const started = performance.now(), wall = Date.now();
  const keys = value && typeof value === 'object' && !types.isProxy(value) ? Reflect.ownKeys(value) : [];
  const options = record(value, keys.includes('signal') ? ['launch', 'request', 'deadline', 'signal'] : ['launch', 'request', 'deadline'], 'STAGE_REQUEST_INVALID');
  const request = admitStageDecodeRequest(snapshot(options.request, 256, 8, 32768, 'STAGE_REQUEST_INVALID'));
  if (options.deadline !== request.deadline) throw fault('STAGE_REQUEST_INVALID');
  const launch = launchData(options.launch), signal = options.signal;
  if (signal !== undefined) {
    try { if (types.isProxy(signal)) throw new Error(); aborted.call(signal); } catch { throw fault('STAGE_REQUEST_INVALID'); }
  }
  const end = started + (request.deadline - wall);
  const owner = { request, launch, end, child: undefined, failure: undefined, secondary: [], close: false, stopping: false,
    writes: 0, handles: new Map(), candidate: undefined, chains: new Map(), names: new Map(), streams: {}, exit: undefined };
  owners.add(owner);
  let timer, escalation;
  let join;
  const closed = new Promise(resolve => { join = resolve; });
  function freeze(code, cause) {
    if (!owner.failure) owner.failure = cause && localErrors.has(cause) && cause.code === code ? cause : fault(code);
    if (cause) owner.secondary.push(cause);
    stop(); return owner.failure;
  }
  function live() {
    if (signal && aborted.call(signal)) freeze('STAGE_ABORTED');
    if (performance.now() >= end) freeze('STAGE_DEADLINE');
    if (owner.failure) throw owner.failure;
  }
  async function step(operation) { const result = await operation; live(); return result; }
  function terminate(kind) {
    if (owner.close) return;
    try { if (!owner.child.kill(kind)) owner.secondary.push(fault('STAGE_CLOSE_PENDING')); }
    catch (error) { owner.secondary.push(error); }
  }
  function stop() {
    if (!owner.child || owner.stopping || owner.close) return;
    owner.stopping = true;
    // Error/close handlers remain installed. Destroy is never a close proof.
    try { owner.child.stdin.destroy(); } catch (error) { owner.secondary.push(error); }
    terminate('SIGTERM');
    if (process.platform !== 'win32' && !owner.close) escalation = setTimeout(() => terminate('SIGKILL'), 250);
  }
  function barrier() {
    if (owner.close && owner.writes === 0 && ['stdin', 'stdout', 'stderr'].every(name => owner.streams[name]?.close)) join();
  }
  const cancel = () => freeze('STAGE_ABORTED');
  function arm() {
    const remaining = end - performance.now();
    if (remaining <= 0) freeze('STAGE_DEADLINE');
    else timer = setTimeout(arm, Math.min(remaining, 2147483647));
  }
  async function ancestry(directory, expected, code) {
    const names = [path.parse(directory).root];
    for (const part of directory.slice(names[0].length).split(path.sep).filter(Boolean)) names.push(path.join(names.at(-1), part));
    if (names.length > 128) throw fault(code);
    const previous = owner.chains.get(directory), observed = [];
    for (let i = 0; i < names.length; i++) {
      const stat = await step(lstat(names[i], { bigint: true }));
      if (!stat.isDirectory() || stat.isSymbolicLink() || (previous && !same(previous[i], stat))) throw fault(code);
      observed.push(stat);
    }
    if ((await step(realpath(directory))) !== directory || (expected && !same(expected, observed.at(-1)))) throw fault(code);
    if (!previous) owner.chains.set(directory, observed);
    return observed.at(-1);
  }
  async function named(file, expected, code, exact = false) {
    await ancestry(path.dirname(file), undefined, code);
    const stat = await step(lstat(file, { bigint: true }));
    if (!stat.isFile() || stat.isSymbolicLink() || (expected && !(exact ? physical(expected, stat) : same(expected, stat)))) throw fault(code);
    return stat;
  }
  async function hashFile(prefix, cap) {
    const code = 'STAGE_LAUNCH_MISMATCH', file = launch[prefix + 'Path'];
    const before = await named(file, { dev: launch[prefix + 'Dev'], ino: launch[prefix + 'Ino'] }, code);
    if (before.size !== BigInt(launch[prefix + 'Bytes']) || before.size > BigInt(cap) ||
      (prefix === 'worker' && (before.nlink !== 1n || !privateMode(before))) ||
      (prefix === 'node' && process.platform !== 'win32' && (before.mode & 0o111n) === 0n)) throw fault(code);
    if (prefix === 'node' && process.platform !== 'win32') await step(access(file, constants.X_OK));
    let handle;
    try {
      handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const closed = new Promise(resolve => handle.once('close', resolve));
      owner.handles.set(handle, closed); live();
      if (!physical(before, await step(handle.stat({ bigint: true })))) throw fault(code);
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
      let position = 0;
      while (position < launch[prefix + 'Bytes']) {
        const { bytesRead } = await step(handle.read(buffer, 0, Math.min(buffer.length, launch[prefix + 'Bytes'] - position), position));
        if (!bytesRead) throw fault(code);
        hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
      }
      if (hash.digest('hex') !== launch[prefix + 'Sha256'] || !physical(before, await step(handle.stat({ bigint: true })))) throw fault(code);
    } catch (error) { freeze(error.code === 'STAGE_ABORTED' || error.code === 'STAGE_DEADLINE' ? error.code : code, error); }
    finally {
      if (handle) {
        try { await handle.close(); } catch (error) { freeze(code, error); }
        // A rejected close operation cannot establish that the owned handle
        // closed. Keep its owner rooted if the native close never arrives.
        await owner.handles.get(handle); owner.handles.delete(handle);
      }
    }
    live();
    owner.names.set(file, before);
    await named(file, before, code, true);
  }
  async function boundaries(postClose = false) {
    const code = 'STAGE_OWNERSHIP_UNCERTAIN';
    for (const [directory, expected, privateRequired] of [
      [request.stageGrant.parent.path, request.stageGrant.parent, true], [request.stageGrant.path, request.stageGrant.identity, true],
      [request.resourceRoot, request.resourceIdentity, false]]) {
      const stat = await ancestry(directory, expected, code);
      if (privateRequired && !privateMode(stat)) throw fault(code);
    }
    const capsule = path.join(request.resourceRoot, request.sdkIdentity.capsule.file);
    const captured = owner.names.get(capsule), stat = await named(capsule, captured, code, postClose);
    if (stat.nlink !== 1n || stat.size !== BigInt(request.sdkIdentity.capsule.bytes)) throw fault(code);
    if (!captured) owner.names.set(capsule, stat);
  }
  try {
    if (signal) addAbort.call(signal, 'abort', cancel, { once: true });
    arm(); live();
    const work = await ancestry(launch.workDirectory, { dev: launch.workDev, ino: launch.workIno }, 'STAGE_LAUNCH_MISMATCH');
    if (!privateMode(work)) throw fault('STAGE_LAUNCH_MISMATCH');
    await hashFile('node', 512 * 1024 * 1024); await hashFile('worker', 16 * 1024 * 1024);
    await boundaries();
    // All read handles have closed. Check names/ancestry once more before exec.
    await ancestry(launch.workDirectory, work, 'STAGE_LAUNCH_MISMATCH');
    for (const prefix of ['node', 'worker']) await named(launch[prefix + 'Path'], owner.names.get(launch[prefix + 'Path']), 'STAGE_LAUNCH_MISMATCH', true);
    live();
    let child;
    try {
      child = spawn(launch.nodePath, [launch.workerPath], { shell: false, detached: false, cwd: launch.workDirectory, stdio: ['pipe', 'pipe', 'pipe'],
        env: process.platform === 'win32' ? { SystemRoot: launch.systemRoot } : {} });
    } catch (error) { throw freeze('STAGE_SPAWN_FAILED', error); }
    owner.child = child;
    const decoder = createStageWireDecoder('terminal'), header = Buffer.alloc(4);
    let headerBytes = 0, stdoutBytes = 0, stderrBytes = 0, decoding = true, spawned = false;
    // No await or write occurs between spawn and complete handler attachment.
    child.on('spawn', () => { spawned = true; });
    child.on('error', error => { if (owner.stopping) owner.secondary.push(error); else freeze(spawned ? 'STAGE_CHILD_FAILED' : 'STAGE_SPAWN_FAILED', error); });
    child.on('exit', (code, signal) => { owner.exit = { code, signal }; });
    child.on('close', (code, signal) => {
      owner.close = true; owner.closedExit = { code, signal }; clearTimeout(escalation);
      if (code !== 0 || signal !== null) {
        if (!(owner.candidate?.kind === 'lawoss-sdk-stage-error' && code === 1 && signal === null)) freeze('STAGE_CHILD_FAILED');
      }
      barrier();
    });
    for (const name of ['stdin', 'stdout', 'stderr']) {
      const stream = child[name], state = owner.streams[name] = { end: false, close: false, error: false, finish: false };
      stream.on('error', error => { state.error = true; freeze('STAGE_PROTOCOL_INVALID', error); });
      stream.on('close', () => {
        state.close = true;
        if (name === 'stdin' ? !state.finish : !state.end) freeze('STAGE_PROTOCOL_INVALID');
        barrier();
      });
      if (name === 'stdin') stream.on('finish', () => { state.finish = true; });
      else stream.on('end', () => {
        state.end = true;
        if (name === 'stdout' && decoding) {
          try {
            const frame = decoder.finish();
            owner.candidate = frame?.kind === 'lawoss-sdk-stage-error' ? admitStageError(frame, request.generation) : admitStageDecodeResult(frame, request);
          } catch (error) { freeze('STAGE_PROTOCOL_INVALID', error); }
        }
      });
    }
    child.stdout.on('data', chunk => {
      stdoutBytes = Math.min(4101, stdoutBytes + chunk.length);
      if (!decoding) return;
      const take = Math.min(4 - headerBytes, chunk.length);
      if (take > 0) { chunk.copy(header, headerBytes, 0, take); headerBytes += take; }
      if (stdoutBytes > 4100 || (headerBytes === 4 && header.readUInt32BE() > 4096)) { decoding = false; freeze('STAGE_OUTPUT_LIMIT'); return; }
      try { decoder.push(chunk); } catch (error) { decoding = false; freeze('STAGE_PROTOCOL_INVALID', error); }
    });
    child.stderr.on('data', chunk => {
      stderrBytes = Math.min(16385, stderrBytes + chunk.length);
      if (stderrBytes > 16384) freeze('STAGE_OUTPUT_LIMIT');
    });
    owner.writes++;
    try {
      child.stdin.end(encodeStageWireFrame(request, 'request'), error => {
        owner.writes--; if (error) freeze('STAGE_PROTOCOL_INVALID', error); barrier();
      });
    } catch (error) { owner.writes--; freeze('STAGE_PROTOCOL_INVALID', error); }
    if (owner.failure) stop();
    await closed;
    live();
    if (!owner.exit || owner.exit.code !== owner.closedExit.code || owner.exit.signal !== owner.closedExit.signal ||
      !owner.streams.stdin.finish || !owner.streams.stdout.end || !owner.streams.stderr.end || !owner.candidate) throw fault('STAGE_CHILD_FAILED');
    if (owner.candidate.kind === 'lawoss-sdk-stage-error') {
      if (owner.closedExit.code !== 1 || owner.closedExit.signal !== null) throw fault('STAGE_PROTOCOL_INVALID');
      throw fault(owner.candidate.code);
    }
    if (owner.closedExit.code !== 0 || owner.closedExit.signal !== null) throw fault('STAGE_CHILD_FAILED');
    await boundaries(true); live();
    return Object.freeze({ schema: 1, kind: 'lawoss-sdk-closed-stage', result: owner.candidate, exitCode: 0, signal: null });
  } catch (error) {
    if (!owner.failure) {
      // Admitted peer error codes are already bounded by B1, never interpreted
      // as evidence of parent cancellation or a parent-owned deadline.
      owner.failure = localErrors.has(error) ? error : fault('STAGE_LAUNCH_MISMATCH');
      owner.secondary.push(error); stop();
    }
    if (owner.child) await closed;
    throw owner.failure;
  } finally {
    clearTimeout(timer); clearTimeout(escalation);
    if (signal) removeAbort.call(signal, 'abort', cancel);
    owners.delete(owner);
  }
}
