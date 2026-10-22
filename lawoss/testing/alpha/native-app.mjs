// Alpha-only adapter for an installed application. No debug port, renderer
// replacement, or inherited provider credential is part of this launcher.
import { execFile, spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, readFile, readlink, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { validateLiveIdentity, validateLiveProcessIdentity } from '../../../apps/desktop/scripts/release-acceptance-macos.mjs';
import { ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { stopNativeChild } from '../isir/native/owned-process.mjs';
import { launchWindowsJob } from './windows-job.mjs';
import { createNativeLaunchDiagnostics } from './native-launch-diagnostics.mjs';
import { createNativeReadinessDiagnostics } from './native-readiness-diagnostics.mjs';
import { createOwnerCensusRefusal, ownerCensusRefusalDiagnostic } from './native-owner-census-diagnostics.mjs';

const ownerCensusWrappers = new WeakMap();
export function nativeOwnerCensusDiagnostic(error) {
  return ownerCensusWrappers.get(error) ?? ownerCensusRefusalDiagnostic(error);
}

function blocked(code) { return Object.assign(new Error(code), { code, status: 'blocked' }); }
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function assertExclusiveMacExecutable(executable, ownedPid, budget = 2000) {
  if (process.platform !== 'darwin') return;
  let output;
  try {
    output = (await promisify(execFile)('/bin/ps', ['-axww', '-o', 'pid=,comm='], {
      encoding: 'utf8', timeout: budget, maxBuffer: 4 * 1024 * 1024,
    })).stdout;
  } catch (error) { throw createOwnerCensusRefusal(error, ownedPid === undefined ? 'initial-pre-lock' : 'observe'); }
  for (const line of output.split('\n')) {
    const row = /^\s*(\d+)\s+(.+)$/.exec(line);
    if (row && row[2] === executable && Number(row[1]) !== ownedPid) throw blocked('installed-app-already-running');
  }
}

export class NativeAlphaLaunchError extends Error {
  constructor(cause, nativeCleanup) {
    super(cause.message, { cause });
    this.code = cause.code;
    this.status = cause.status;
    this.nativeCleanup = nativeCleanup;
    const diagnostic = ownerCensusRefusalDiagnostic(cause);
    if (diagnostic) ownerCensusWrappers.set(this, diagnostic);
  }
}

export function assertInteractiveUi(snapshot) {
  const readiness = snapshot?.readiness;
  if (readiness?.documentReadyState !== 'complete' || readiness.bootOverlayVisible !== false
    || !Number.isSafeInteger(readiness.interactiveControls) || readiness.interactiveControls < 1) throw blocked('native-ui-not-ready');
}

function captureIdentity(live) {
  const windowSourceId = live?.windowSourceId;
  const documentTimeOrigin = live?.snapshot?.readiness?.documentTimeOrigin;
  if (typeof windowSourceId !== 'string' || windowSourceId.length > 128 || !/^window:[1-9]\d*:\d+$/.test(windowSourceId)) throw blocked('owned-window-unavailable');
  if (live?.snapshot?.windowSourceId !== windowSourceId || !Number.isFinite(documentTimeOrigin)
    || documentTimeOrigin <= 0 || documentTimeOrigin > Number.MAX_SAFE_INTEGER) throw blocked('native-capture-identity-unavailable');
  return { windowSourceId, documentTimeOrigin };
}

export function assertCaptureBinding(before, capture, after = before) {
  const initial = captureIdentity(before), final = captureIdentity(after);
  for (const key of ['windowSourceId', 'documentTimeOrigin']) {
    if (initial[key] !== capture?.[key] || initial[key] !== final[key]) throw blocked('native-capture-identity-changed');
  }
  return Object.freeze({ status: 'verified', window: 'same', document: 'same' });
}

export function nativeAppLayout(installedApp, platform = process.platform) {
  if (!['darwin', 'linux', 'win32'].includes(platform)) throw blocked('unsupported-native-platform');
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (typeof installedApp !== 'string' || !paths.isAbsolute(installedApp)) throw blocked('invalid-installed-app-path');
  const executable = platform === 'darwin' ? paths.join(installedApp, 'Contents/MacOS/LAWOSS') : installedApp;
  const resources = platform === 'darwin' ? paths.join(installedApp, 'Contents/Resources') : paths.join(paths.dirname(installedApp), 'resources');
  return { executable, resources, rendererRoot: paths.join(resources, 'app-dist') };
}

export function nativeAppEnvironment(root, { platform = process.platform, environment = process.env } = {}) {
  const paths = platform === 'win32' ? path.win32 : path.posix;
  const allowed = ['PATH', 'LANG', 'LC_ALL', 'TERM'];
  if (platform === 'darwin') allowed.push('USER', 'LOGNAME');
  if (platform === 'linux') allowed.push('DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS');
  if (platform === 'win32') allowed.push('SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT');
  const inherited = {};
  for (const key of allowed) {
    const original = platform === 'win32' ? Object.keys(environment).find(candidate => candidate.toLowerCase() === key.toLowerCase()) : key;
    if (original && typeof environment[original] === 'string') inherited[key] = environment[original];
  }
  const home = paths.join(root, 'home'), config = paths.join(root, 'config'), data = paths.join(root, 'data'), temp = paths.join(root, 'tmp');
  return { ...inherited, HOME: home,
    // Synthetic acceptance must not prompt for or read the real login keychain.
    ...(platform === 'darwin' ? { LAWOSS_DEV_MOCK_KEYCHAIN: '1' } : {}),
    ...(platform === 'win32' ? { USERPROFILE: home, APPDATA: config, LOCALAPPDATA: data, LAWOSS_ALPHA_STARTUP_CHECKPOINTS: '1' } : {}),
    TMPDIR: temp, TMP: temp, TEMP: temp,
    XDG_CONFIG_HOME: config, XDG_DATA_HOME: data, XDG_CACHE_HOME: paths.join(root, 'cache'), XDG_STATE_HOME: paths.join(root, 'state'),
    NODE_OPTIONS: '', ELECTRON_RUN_AS_NODE: '', LEGALWORK_DEV_MODE: '0',
    LEGALWORK_ELECTRON_USERDATA: paths.join(root, 'userdata'), LEGALWORK_DATA_DIR: paths.join(root, 'runtime'),
    LEGALWORK_SERVER_CONFIG: paths.join(root, 'runtime/server.json'), LEGALWORK_RUNTIME_DB: paths.join(root, 'runtime/runtime.db'),
    OPENCODE_DB: paths.join(root, 'runtime/opencode.db'), LEGALWORK_WORD_ADDIN: '0' };
}

async function ownedDirectory(directory) {
  await mkdir(directory, { mode: 0o700 }).catch(error => { if (error.code !== 'EEXIST') throw error; });
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) throw blocked('unsafe-profile');
}

async function assertProfileTree(root) {
  async function visit(directory) {
    for (const name of await readdir(directory)) {
      const entry = path.join(directory, name), info = await lstat(entry);
      if (info.isSymbolicLink()) {
        const relative = path.relative(root, await realpath(entry));
        if (path.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${path.sep}`)) throw blocked('unsafe-profile-link');
      } else if (info.isDirectory()) await visit(entry);
      else if (!info.isFile() || info.nlink > 1) throw blocked('unsafe-profile-entry');
    }
  }
  await visit(root);
}

async function removeOwnedChromiumLease(root, pid) {
  if (process.platform === 'win32' || !pid) return;
  const userdata = path.join(root, 'userdata');
  if ((await lstat(userdata)).isSymbolicLink() || await realpath(userdata) !== userdata) throw blocked('unsafe-profile');
  const links = new Map();
  for (const name of ['SingletonLock', 'SingletonCookie', 'SingletonSocket']) {
    try {
      const file = path.join(userdata, name);
      if (!(await lstat(file)).isSymbolicLink()) throw blocked('chromium-lease-ownership-unverified');
      links.set(name, await readlink(file));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  if (!links.size) return;
  if (links.get('SingletonLock') !== `${hostname()}-${pid}`
    || links.has('SingletonCookie') && !/^\d+$/.test(links.get('SingletonCookie'))
    || links.has('SingletonSocket') && (!path.isAbsolute(links.get('SingletonSocket')) || path.basename(links.get('SingletonSocket')) !== 'SingletonSocket'))
    throw blocked('chromium-lease-ownership-unverified');
  // Only unlink metadata inside the owned profile, after descendant closure.
  // Never follow or delete the socket's external target.
  for (const name of links.keys()) await rm(path.join(userdata, name));
}

async function discoveryFile(filename) {
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.size > 16384 || (process.platform !== 'win32' && (before.uid !== process.getuid() || (before.mode & 0o077) !== 0))) throw blocked('unsafe-discovery');
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await file.stat();
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino || opened.size !== before.size) throw blocked('unsafe-discovery');
    const bytes = Buffer.alloc(16385), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    if (bytesRead > 16384) throw blocked('unsafe-discovery');
    const value = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    if (value.version !== 1 || value.platform !== process.platform || typeof value.token !== 'string' || !/^[A-Za-z0-9_-]{16,256}$/.test(value.token) || !/^http:\/\/127\.0\.0\.1:[1-9]\d{0,4}$/.test(value.baseUrl)) throw blocked('unsafe-discovery');
    new URL(value.baseUrl); // Also rejects ports greater than 65535.
    return { baseUrl: value.baseUrl, token: value.token };
  } finally { await file.close(); }
}

async function readJsonResponse(response) {
  if (!response.ok || !response.body) {
    await response.body?.cancel().catch(() => {});
    throw blocked('shipping-control-request-failed');
  }
  const reader = response.body.getReader(), chunks = [];
  let length = 0, complete = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { complete = true; break; }
      length += value.byteLength;
      if (length > 1024 * 1024) throw blocked('shipping-control-response-too-large');
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw blocked('shipping-control-invalid-json'); }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function captureOwnedWindow({ live, pid, output, temporaryRoot, env, assertRunning }) {
  const match = /^window:([1-9]\d*):/.exec(live.windowSourceId ?? '');
  if (!match || BigInt(match[1]) > 0x7fffffffffffffffn) throw blocked('owned-window-unavailable');
  const scratch = await mkdtemp(path.join(temporaryRoot, 'window-'));
  const format = process.platform === 'linux' ? 'xwd' : 'png';
  const temporary = path.join(scratch, `capture.${format}`);
  const command = async (executable, args) => (await promisify(execFile)(executable, args, { env, encoding: 'utf8', timeout: 15000, maxBuffer: 16384 })).stdout;
  let method;
  try {
    if (process.platform === 'darwin') {
      await command('/usr/sbin/screencapture', ['-x', '-l', match[1], temporary]);
      method = 'macos-owned-window-screencapture';
    } else if (process.platform === 'linux') {
      if (!env.DISPLAY) throw blocked('native-x11-display-unavailable');
      const window = `0x${BigInt(match[1]).toString(16)}`;
      const check = async () => {
        const owner = /^_NET_WM_PID\(CARDINAL\)\s*=\s*(\d+)\s*$/.exec((await command('xprop', ['-id', window, '_NET_WM_PID'])).trim());
        if (!owner || Number(owner[1]) !== pid) throw blocked('native-window-owner-mismatch');
      };
      await check();
      await command('xwd', ['-silent', '-id', window, '-out', temporary]);
      await check();
      method = 'x11-owned-window-xwd';
    } else if (process.platform === 'win32') {
      if (!env.SystemRoot) throw blocked('native-windows-system-root-unavailable');
      const helper = fileURLToPath(new URL('./capture-owned-window.ps1', import.meta.url));
      await command(path.join(env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper, '-WindowId', match[1], '-OwnerPid', String(pid), '-OutputPath', temporary]);
      method = 'windows-owned-window-printwindow';
    } else throw blocked('unsupported-native-platform');
    const info = await lstat(temporary);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw blocked('invalid-native-window-capture');
    const bytes = await readFile(temporary);
    if (format === 'png' ? bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : bytes.length < 100 || bytes.readUInt32BE(4) !== 7) throw blocked('invalid-native-window-capture');
    assertRunning();
    // Exclusive publication never replaces an existing evidence artifact.
    await writeFile(output, bytes, { flag: 'wx', mode: 0o600 });
    return { path: output, sha256: sha256(bytes), format, method, ownerPid: pid, ...captureIdentity(live) };
  } catch (error) {
    if (error.status === 'blocked' || error.code === 'EEXIST') throw error;
    throw blocked('native-window-capture-unavailable');
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Launch an already verified installed artifact on its actual native host. */
export async function launchAlphaApp({ installedApp, profileRoot, build, timeoutMs = 90000 }) {
  validateBuildInfo(build);
  if (build.platform !== process.platform || build.arch !== process.arch) throw blocked('native-host-unavailable');
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 300000) throw blocked('invalid-readiness-budget');
  const profile = await ownedProfile(profileRoot);
  const source = nativeAppLayout(installedApp);
  const executable = await realpath(source.executable), resources = await realpath(source.resources), rendererRoot = await realpath(source.rendererRoot);
  if (!(await lstat(executable)).isFile()) throw blocked('invalid-installed-executable');
  const embedded = validateBuildInfo(JSON.parse(await readFile(path.join(resources, 'build-info.json'), 'utf8')));
  if (Object.keys(build).some(key => embedded[key] !== build[key])) throw blocked('installed-build-identity-mismatch');
  try { await assertExclusiveMacExecutable(executable); }
  catch (cause) {
    throw new NativeAlphaLaunchError(cause, { status: 'stopped', descendantClosure: 'verified',
      method: 'no-child-started', profileRoot: profile.root, profileOwner: profile.owner });
  }
  const profileInfo = await lstat(profileRoot);
  if (!profileInfo.isDirectory() || profileInfo.isSymbolicLink()) throw blocked('unsafe-profile');
  const root = await realpath(profileRoot), lockPath = path.join(root, '.alpha-native-app.lock');
  await assertProfileTree(root);
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch (error) { if (error.code === 'EEXIST') throw blocked('profile-in-use'); throw error; }
  const lockIdentity = await lock.stat(), nonce = randomUUID();
  await lock.writeFile(nonce);
  const releaseLock = async () => {
    const current = await lstat(lockPath);
    if (!current.isFile() || current.isSymbolicLink() || current.dev !== lockIdentity.dev || current.ino !== lockIdentity.ino || await readFile(lockPath, 'utf8') !== nonce) throw blocked('profile-lock-ownership-lost');
    await lock.close();
    await rm(lockPath);
  };
  let child, windowsJob, windowsLaunchAttempted = false, stopPromise, stopped = false, discovery, launchError, closed;
  const launchDiagnostics = process.platform === 'win32' ? null : createNativeLaunchDiagnostics();
  const readinessDiagnostics = createNativeReadinessDiagnostics();
  const env = nativeAppEnvironment(root);
  const stop = () => stopPromise ??= (async () => {
    stopped = true;
    let method = 'no-child-started';
    if (windowsLaunchAttempted) {
      if (!windowsJob) throw blocked('windows-job-closure-unverified');
      method = (await windowsJob.stop()).method;
    } else if (child) {
      await stopNativeChild(child, 5000);
      await Promise.race([closed, delay(5000, undefined, { ref: false }).then(() => { throw blocked('native-child-close-unverified'); })]);
      await removeOwnedChromiumLease(root, child.pid);
      method = child.pid ? 'posix-owned-process-group' : 'no-child-started';
    }
    await releaseLock();
    return { status: 'stopped', descendantClosure: 'verified', method };
  })().catch(async error => { await lock.close().catch(() => {}); throw error; });
  function assertRunning() {
    if (stopped) throw blocked('app-stopped');
    if (launchError) throw blocked('installed-app-spawn-failed');
    if (windowsJob && !windowsJob.isRunning()) throw blocked('installed-app-exited-or-job-unavailable');
    if (child.exitCode !== null || child.signalCode !== null) throw blocked('installed-app-exited');
  }
  async function request(endpoint, options = {}, budget = 5000) {
    assertRunning();
    const signal = AbortSignal.timeout(Math.max(1, budget));
    try {
      const response = await fetch(`${discovery.baseUrl}${endpoint}`, { ...options, redirect: 'error',
        headers: { ...options.headers, authorization: `Bearer ${discovery.token}` }, signal });
      return await readJsonResponse(response);
    } catch (error) {
      if (signal.aborted) throw blocked('shipping-control-request-timeout');
      throw error;
    }
  }
  async function observe(budget = 5000) {
    const deadline = performance.now() + budget;
    const remaining = () => {
      const value = Math.floor(deadline - performance.now());
      if (value <= 0) throw blocked('shipping-control-request-timeout');
      return value;
    };
    for (;;) {
      readinessDiagnostics.boundary('process-owner');
      try { await assertExclusiveMacExecutable(executable, child.pid, Math.min(2000, remaining())); }
      catch (error) { remaining(); throw error; }
      readinessDiagnostics.boundary('build-info');
      const identity = await request('/build-info', {}, remaining());
      readinessDiagnostics.passed('build-info');
      const expected = { build, pid: child.pid, userData: env.LEGALWORK_ELECTRON_USERDATA, executable, rendererRoot };
      readinessDiagnostics.boundary('process-identity');
      validateLiveProcessIdentity(identity, expected);
      readinessDiagnostics.passed('process-identity');
      readinessDiagnostics.boundary('snapshot');
      identity.snapshot = await request('/snapshot', {}, remaining());
      readinessDiagnostics.passed('snapshot');
      remaining();
      if (identity.snapshot?.ok === false && identity.snapshot.error === 'Renderer presentation is not available yet.') {
        readinessDiagnostics.boundary('interactive-ui');
        assertInteractiveUi(identity.snapshot);
        readinessDiagnostics.boundary('presentation-wait');
        await delay(Math.min(20, remaining()));
        continue;
      }
      readinessDiagnostics.boundary('renderer-identity');
      validateLiveIdentity(identity, expected);
      readinessDiagnostics.passed('renderer-identity');
      readinessDiagnostics.boundary('interactive-ui');
      assertInteractiveUi(identity.snapshot);
      readinessDiagnostics.passed('interactive-ui');
      readinessDiagnostics.boundary('process-running');
      assertRunning();
      readinessDiagnostics.passed('ready');
      return identity;
    }
  }
  try {
    for (const name of ['userdata', 'runtime', 'workspace', 'home', 'config', 'data', 'cache', 'tmp', 'state']) await ownedDirectory(path.join(root, name));
    const discoveryPath = path.join(root, 'userdata/legalwork-ui-control.json');
    await rm(discoveryPath, { force: true });
    if (process.platform === 'win32') {
      windowsLaunchAttempted = true;
      windowsJob = await launchWindowsJob({ executable, cwd: root, env, timeoutMs: Math.min(timeoutMs, 15000) });
      child = { pid: windowsJob.pid, exitCode: null, signalCode: null };
    } else {
      child = spawn(executable, [], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env });
      child.once('error', error => { launchError = error; });
      child.stderr.on('data', chunk => launchDiagnostics.stderr(chunk));
      child.stdout.resume(); child.stderr.resume();
      closed = new Promise(resolveClosed => child.once('close', resolveClosed));
    }
    const deadline = performance.now() + timeoutMs;
    while (performance.now() < deadline) {
      readinessDiagnostics.attempt();
      readinessDiagnostics.boundary('process-running');
      assertRunning();
      try {
        readinessDiagnostics.boundary('discovery');
        discovery = await discoveryFile(discoveryPath);
        readinessDiagnostics.passed('discovery');
        await observe(Math.max(1, Math.min(5000, Math.floor(deadline - performance.now()))));
        return { pid: child.pid, observe: () => observe(),
          async execute(actionId, args = {}) {
            if (typeof actionId !== 'string' || !actionId.trim() || actionId.length > 256 || !args || typeof args !== 'object' || Array.isArray(args)) throw blocked('invalid-action');
            const body = JSON.stringify({ actionId, args });
            if (Buffer.byteLength(body) > 1024 * 1024) throw blocked('invalid-action');
            await observe();
            return request('/execute', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
          },
          async capture(output) {
            if (typeof output !== 'string' || !path.isAbsolute(output)) throw blocked('invalid-capture-path');
            const live = await observe();
            captureIdentity(live);
            return captureOwnedWindow({ live, pid: child.pid, output, temporaryRoot: env.TMPDIR, env, assertRunning });
          }, stop };
      } catch (error) {
        readinessDiagnostics.failure(error);
        if (['installed-app-already-running', 'installed-app-owner-census-unavailable'].includes(error.code)) throw error;
        /* Retry discovery and renderer readiness inside the same budget. */
      }
      await delay(Math.max(1, Math.min(100, Math.floor(deadline - performance.now()))));
    }
    throw blocked('native-readiness-timeout');
  } catch (primary) {
    launchDiagnostics?.freeze(child);
    readinessDiagnostics.freeze();
    let cleanup;
    try { cleanup = await stop(); }
    catch (cleanup) {
      const error = new AggregateError([primary, cleanup], 'Native alpha startup failed; cleanup did not verify closure');
      launchDiagnostics?.associate(error);readinessDiagnostics.associate(error);throw error;
    }
    const error = new NativeAlphaLaunchError(primary, { ...cleanup, profileRoot: profile.root, profileOwner: profile.owner });
    launchDiagnostics?.associate(error);readinessDiagnostics.associate(error);throw error;
  }
}
