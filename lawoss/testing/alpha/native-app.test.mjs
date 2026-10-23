import assert from 'node:assert/strict';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, readlink, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir, hostname } from 'node:os';
import { dirname, isAbsolute, join, win32 } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { createNativeAppStop, nativeStopDiagnostic, assertCaptureBinding, assertInteractiveUi, launchAlphaApp, NativeAlphaLaunchError, nativeOwnerCensusDiagnostic, nativeAppLayout, nativeAppEnvironment } from './native-app.mjs';
import { ownedProfile, prepareAcceptanceProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { nativeLaunchDiagnostic } from './native-launch-diagnostics.mjs';
import { nativeReadinessDiagnostic } from './native-readiness-diagnostics.mjs';

const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3-alpha.1',
  gitSha: 'a'.repeat(40), buildEpoch: '123', platform: process.platform, arch: process.arch,
  channel: 'alpha', workflowRunUrl: '' };

test('layout uses the installed bundle on macOS and the actual executable on Linux/Windows', () => {
  assert.deepEqual(nativeAppLayout('/apps/LAWOSS.app', 'darwin'), {
    executable: '/apps/LAWOSS.app/Contents/MacOS/LAWOSS', resources: '/apps/LAWOSS.app/Contents/Resources',
    rendererRoot: '/apps/LAWOSS.app/Contents/Resources/app-dist',
  });
  assert.deepEqual(nativeAppLayout('/apps/lawoss/legalwork', 'linux'), {
    executable: '/apps/lawoss/legalwork', resources: '/apps/lawoss/resources', rendererRoot: '/apps/lawoss/resources/app-dist',
  });
  assert.deepEqual(nativeAppLayout('C:\\apps\\LAWOSS.exe', 'win32'), {
    executable: 'C:\\apps\\LAWOSS.exe', resources: 'C:\\apps\\resources', rendererRoot: 'C:\\apps\\resources\\app-dist',
  });
  assert.throws(() => nativeAppLayout('/apps/app', 'freebsd'), /unsupported/i);
});

test('environment has explicit synthetic storage and preserves only native UI/system necessities', () => {
  const ambient = { PATH: '/pinned-node:/usr/bin', DISPLAY: ':42', XAUTHORITY: '/owned/Xauthority',
    WAYLAND_DISPLAY: 'wayland-0', XDG_RUNTIME_DIR: '/run/user/1', DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/bus',
    HOME: '/private', TEST_HOME: '/private/engine-test-home', OPENAI_API_KEY: 'private-key', NODE_OPTIONS: '--import=private',
    XDG_STATE_HOME: '/private/state', xDg_StAtE_hOmE: 'C:\\private\\mixed-state',
    ELECTRON_RUN_AS_NODE: '1', ELECTRON_EXTRA_LAUNCH_ARGS: '--remote-debugging-port=9222',
    LEGALWORK_UI_CONTROL_DISCOVERY: '/private/discovery', OPENCODE_CONFIG: 'private', LEGALWORK_WORKSPACES: '/private/workspaces',
    SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', APPDATA: 'private', USERPROFILE: 'private',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.COM;.EXE;.CMD', TEMP: '/private/temp' };
  const linux = nativeAppEnvironment('/owned', { platform: 'linux', environment: ambient });
  assert.equal(linux.PATH, ambient.PATH);
  for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) assert.equal(linux[key], ambient[key]);
  assert.equal(linux.HOME, '/owned/home');
  assert.equal(linux.TMPDIR, '/owned/tmp');
  assert.equal(linux.XDG_STATE_HOME, '/owned/state');
  assert.equal(isAbsolute(linux.XDG_STATE_HOME), true);
  assert.equal(linux.LEGALWORK_ELECTRON_USERDATA, '/owned/userdata');
  assert.equal(linux.LEGALWORK_SERVER_CONFIG, '/owned/runtime/server.json');
  assert.equal(linux.NODE_OPTIONS, '');
  assert.equal(linux.ELECTRON_RUN_AS_NODE, '');
  for (const key of ['OPENAI_API_KEY', 'OPENCODE_CONFIG', 'LEGALWORK_UI_CONTROL_DISCOVERY', 'ELECTRON_EXTRA_LAUNCH_ARGS']) assert.equal(linux[key], undefined);
  assert.equal(linux.LEGALWORK_WORKSPACES, undefined, 'a relaunch must read persisted workspace configuration instead of an acceptance override');
  const windows = nativeAppEnvironment('C:\\owned', { platform: 'win32', environment: ambient });
  assert.equal(windows.SystemRoot, ambient.SystemRoot);
  assert.equal(windows.PATHEXT, ambient.PATHEXT);
  assert.equal(windows.USERPROFILE, 'C:\\owned\\home');
  assert.equal(windows.APPDATA, 'C:\\owned\\config');
  assert.equal(windows.LOCALAPPDATA, 'C:\\owned\\data');
  assert.equal(windows.TEMP, 'C:\\owned\\tmp');
  assert.equal(windows.XDG_STATE_HOME, 'C:\\owned\\state');
  assert.equal(win32.isAbsolute(windows.XDG_STATE_HOME), true);
  assert.equal(windows.DISPLAY, undefined);
  assert.equal(windows.LAWOSS_ALPHA_STARTUP_CHECKPOINTS, '1');
  const mac = nativeAppEnvironment('/owned', { platform: 'darwin', environment: ambient });
  assert.equal(mac.XDG_STATE_HOME, '/owned/state');
  assert.equal(isAbsolute(mac.XDG_STATE_HOME), true);
  for (const env of [linux, windows, mac]) {
    assert.deepEqual(Object.keys(env).filter(key => key.toLowerCase() === 'xdg_state_home'), ['XDG_STATE_HOME']);
    assert.equal(env.OPENAI_API_KEY, undefined);
    assert.equal(env.TEST_HOME, undefined);
  }
  assert.equal(mac.LAWOSS_DEV_MOCK_KEYCHAIN, '1');
  assert.equal(mac.LAWOSS_ALPHA_STARTUP_CHECKPOINTS, undefined);
  assert.equal(linux.LAWOSS_ALPHA_STARTUP_CHECKPOINTS, undefined);
  assert.equal(linux.LAWOSS_DEV_MOCK_KEYCHAIN, undefined);
  assert.equal(windows.LAWOSS_DEV_MOCK_KEYCHAIN, undefined);
});

test('returned environment confines a real Node child state write and preserves hostile ambient state', async t => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'alpha-state-environment-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = join(root, 'owned'), state = join(profile, 'state'), outside = join(root, 'ambient-state');
  await mkdir(state, { recursive: true });
  await mkdir(outside);
  const sentinel = Buffer.from('preserve ambient state\n');
  await writeFile(join(outside, 'sentinel'), sentinel);
  const outsideBefore = await lstat(join(outside, 'sentinel'), { bigint: true });
  const env = nativeAppEnvironment(profile, { environment: {
    XDG_STATE_HOME: outside, xDg_StAtE_hOmE: outside, OPENAI_API_KEY: 'private-key', HOME: outside,
  } });
  const child = spawn(process.execPath, ['--input-type=module'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.end(`
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const state = process.env.XDG_STATE_HOME ?? null;
if (state) await writeFile(join(state, 'node-state-sentinel'), 'synthetic state\\n', { flag: 'wx', mode: 0o600 });
process.stdout.write(JSON.stringify({ state, credential: process.env.OPENAI_API_KEY ?? null,
  stateKeys: Object.keys(process.env).filter(key => key.toLowerCase() === 'xdg_state_home') }));
`);
  const [code, signal] = await closed;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(stderr, '');
  assert.deepEqual(JSON.parse(stdout), { state, credential: null, stateKeys: ['XDG_STATE_HOME'] });
  assert.equal(await readFile(join(state, 'node-state-sentinel'), 'utf8'), 'synthetic state\n');
  assert.deepEqual(await readdir(state), ['node-state-sentinel']);
  assert.deepEqual(await readdir(outside), ['sentinel']);
  assert.deepEqual(await readFile(join(outside, 'sentinel')), sentinel);
  const outsideAfter = await lstat(join(outside, 'sentinel'), { bigint: true });
  for (const key of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(outsideAfter[key], outsideBefore[key]);
});

// A real owned child implements only the shipping HTTP protocol. This fixture
// tests launcher boundaries; it is not Electron or native acceptance evidence.
async function fixture(t, { wrong = {}, stall = false, delayedDiscovery = false, stateProbe = false, readiness = { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 1 } } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'alpha-native-protocol-')));
  let owned;
  t.after(async () => { try { await owned?.stop(); } finally { await rm(root, { recursive: true, force: true }); } });
  const platform = process.platform;
  const installedApp = platform === 'darwin' ? join(root, 'LAWOSS.app') : join(root, 'installed', 'legalwork');
  const layout = nativeAppLayout(installedApp, platform), profileRoot = join(root, 'profile');
  await mkdir(dirname(layout.executable), { recursive: true });
  await mkdir(layout.rendererRoot, { recursive: true });
  await prepareAcceptanceProfile({ root: profileRoot, kind: 'fresh' });
  await writeFile(join(layout.resources, 'build-info.json'), JSON.stringify(build));
  const script = `#!${process.execPath}
import { createServer } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
${stateProbe ? `await writeFile(join(process.env.LEGALWORK_ELECTRON_USERDATA, 'fixture-child-started'), 'started', { flag: 'wx' });
await writeFile(join(process.env.XDG_STATE_HOME, 'fixture-state-sentinel'), JSON.stringify({ state: process.env.XDG_STATE_HOME }), { flag: 'wx' });` : ''}
let patch = ${JSON.stringify(wrong)};
let presentation = null, snapshotCalls = 0;
const token = 'private-fixture-token';
const identity = () => ({ ok:true, build:{version:'1.2.3-alpha.1',gitSha:'${build.gitSha}',buildEpoch:'123',os:'${platform}',arch:'${process.arch}',channel:'alpha',provenance:'embedded',legalworkDevMode:false},process:{pid:process.pid,userData:process.env.LEGALWORK_ELECTRON_USERDATA,executable:${JSON.stringify(layout.executable)}},rendererUrl:${JSON.stringify(pathToFileURL(join(layout.rendererRoot, 'index.html')).href)},windowSourceId:null,...patch });
const server=createServer(async (req,res)=>{
  if(req.headers.authorization!=='Bearer '+token){res.writeHead(401);res.end('{}');return;}
  if(req.url==='/build-info'){res.end(JSON.stringify(identity()));return;}
  if(req.url==='/snapshot'){snapshotCalls++;await writeFile(join(process.env.LEGALWORK_ELECTRON_USERDATA,'snapshot-count'),String(snapshotCalls));if(presentation?.stall==='headers')return;if(presentation?.stall==='body'){res.writeHead(200);res.write('{');return;}if(presentation && (presentation.remaining === -1 || presentation.remaining-- > 0)){if(presentation.identityAfterSnapshot)patch=presentation.identityAfterSnapshot;res.end(JSON.stringify({ok:false,error:presentation.error ?? 'Renderer presentation is not available yet.',readiness:Object.hasOwn(presentation,'readiness') ? presentation.readiness : ${JSON.stringify(readiness)}}));return;}if(${stall}){res.writeHead(200);res.write('{');return;}res.end(JSON.stringify({ok:true,route:'/welcome',readiness:${JSON.stringify(readiness)}}));return;}
  if(req.url==='/execute'){let raw='';for await(const chunk of req)raw+=chunk;const input=JSON.parse(raw);if(input.actionId==='fixture.identity')patch=input.args;if(input.actionId==='fixture.presentation'){presentation=input.args;snapshotCalls=0;if(input.args.identity)patch=input.args.identity;}res.end(JSON.stringify({ok:true,input}));return;}
  res.writeHead(404);res.end('{}');
});
server.listen(0,'127.0.0.1',()=>setTimeout(()=>writeFile(join(process.env.LEGALWORK_ELECTRON_USERDATA,'legalwork-ui-control.json'),JSON.stringify({version:1,platform:'${platform}',baseUrl:'http://127.0.0.1:'+server.address().port,token}),{mode:0o600}),${delayedDiscovery ? 200 : 0}));
`;
  await writeFile(layout.executable, script, { mode: 0o700 });
  await chmod(layout.executable, 0o700);
  return { root, profileRoot, installedApp, layout, own(app) { owned = app; return app; } };
}

test('unsupported target refuses before profile mutation or spawn', async (t) => {
  const { installedApp, profileRoot } = await fixture(t);
  await assert.rejects(launchAlphaApp({ installedApp, profileRoot, build: { ...build, arch: build.arch === 'arm64' ? 'x64' : 'arm64' } }), /native-host-unavailable/);
});

// Controlled execFile failure model; no extra ps or installed application runs.
test('initial census execFile failure model preserves registered facts through the known wrapper', { skip: process.platform !== 'darwin' }, async t => {
  const options = await fixture(t), profile = await ownedProfile(options.profileRoot);
  const child = spawn(process.execPath, ['--input-type=module'], { env: {}, stdio: ['pipe', 'pipe', 'pipe'] });
  const closed = once(child, 'close');
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.end(`
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
let calls = 0;
childProcess.execFile = (command, args, options, callback) => {
  calls++;
  assert.equal(command, '/bin/ps');
  assert.deepEqual(args, ['-axww', '-o', 'pid=,comm=']);
  assert.deepEqual(options, { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  const raw = Object.assign(new Error('PRIVATE exec failure /private/path pid=123'), {
    code: 'EPERM', signal: null, killed: true, stdout: 'PRIVATE stdout', stderr: 'PRIVATE stderr',
  });
  queueMicrotask(() => callback(raw, 'PRIVATE stdout', 'PRIVATE stderr'));
};
syncBuiltinESMExports();
const module = await import(${JSON.stringify(new URL('./native-app.mjs', import.meta.url).href)});
let refusal;
try { await module.launchAlphaApp(${JSON.stringify({ installedApp: options.installedApp, profileRoot: options.profileRoot, build, timeoutMs: 300 })}); }
catch (error) { refusal = error; }
assert.ok(refusal instanceof module.NativeAlphaLaunchError);
assert.equal(calls, 1);
assert.equal(refusal.code, 'installed-app-owner-census-unavailable');
assert.equal(refusal.message, refusal.code);
assert.equal(refusal.status, 'blocked');
assert.equal(refusal.cause.code, refusal.code);
assert.equal(refusal.cause.message, refusal.message);
assert.equal(refusal.cause.status, refusal.status);
assert.deepEqual(Object.getOwnPropertyNames(refusal.cause).sort(), ['code', 'message', 'stack', 'status']);
process.stdout.write(JSON.stringify({ diagnostic: module.nativeOwnerCensusDiagnostic?.(refusal) ?? null,
  causeDiagnostic: module.nativeOwnerCensusDiagnostic?.(refusal.cause) ?? null, cleanup: refusal.nativeCleanup }));
`);
  const [code, signal] = await closed;
  assert.equal(code, 0);
  assert.equal(signal, null);
  assert.equal(stderr, '');
  const result = JSON.parse(stdout);
  const diagnostic = { stage: 'initial-pre-lock', category: 'spawn-reported', code: 'EPERM', exitCode: null, signal: null, killed: true };
  assert.deepEqual(result.diagnostic, diagnostic);
  assert.deepEqual(result.causeDiagnostic, diagnostic);
  assert.deepEqual(result.cleanup, { status: 'stopped', descendantClosure: 'verified', method: 'no-child-started',
    profileRoot: profile.root, profileOwner: profile.owner });
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

test('foreign-owner diagnostic model logs only finite facts and retains the original failing oracle', { skip: process.platform !== 'darwin' }, async () => {
  const child = spawn(process.execPath, ['--test-name-pattern=^a second macOS app instance', '--input-type=module'], {
    env: {}, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const closed = once(child, 'close');
  let stdout = '', stderr = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { stderr += chunk; });
  child.stdin.end(`
import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
let calls = 0;
childProcess.execFile = (command, args, options, callback) => {
  calls++;
  assert.equal(command, '/bin/ps');
  assert.deepEqual(args, ['-axww', '-o', 'pid=,comm=']);
  assert.deepEqual(options, { encoding: 'utf8', timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
  queueMicrotask(() => callback(Object.assign(new Error('PRIVATE_CENSUS_PAYLOAD'), { code: 'ENOBUFS' }),
    'PRIVATE_CENSUS_STDOUT', 'PRIVATE_CENSUS_STDERR'));
};
syncBuiltinESMExports();
process.on('beforeExit', () => assert.equal(calls, 1));
await import(${JSON.stringify(new URL('./native-app.test.mjs', import.meta.url).href)});
`);
  const [code, signal] = await closed;
  assert.equal(code, 1, 'the original exact expected-error assertion must still fail');
  assert.equal(signal, null);
  const output = stdout + stderr;
  const lines = output.split('\n').filter(line => line.includes('LAWOSS_OWNER_CENSUS_DIAGNOSTIC '));
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0].split('LAWOSS_OWNER_CENSUS_DIAGNOSTIC ')[1]), {
    stage: 'initial-pre-lock', category: 'buffer-reported', code: 'ENOBUFS', exitCode: null, signal: null, killed: null,
  });
  assert.match(output, /installed-app-owner-census-unavailable/);
  assert.match(output, /validation function is expected to return "true"/);
  assert.doesNotMatch(output, /PRIVATE_CENSUS_/);
});

test('a second macOS app instance refuses acceptance without stopping the existing process', { skip: process.platform !== 'darwin' }, async t => {
  const options = await fixture(t);
  // Reuse the running test runtime as a real native image at this owned path.
  // The owner guard does not need a C compiler or its partially written output.
  await copyFile(process.execPath, options.layout.executable);
  await chmod(options.layout.executable, 0o700);
  assert.deepEqual(await readFile(options.layout.executable), await readFile(process.execPath));
  const existing = spawn(options.layout.executable, ['-e', 'process.stdout.write("ready\\n");setTimeout(()=>{},60000)'], {
    env: {}, stdio: ['ignore', 'pipe', 'ignore'],
  });
  const closed = once(existing, 'close');
  try {
    await once(existing, 'spawn');
    const [ready] = await Promise.race([once(existing.stdout, 'data'), closed.then(() => {
      throw new Error('native-owner-fixture-exited-before-ready');
    })]);
    assert.equal(ready.toString(), 'ready\n');
    assert.equal(execFileSync('/bin/ps', ['-p', String(existing.pid), '-o', 'comm='], {
      encoding: 'utf8', timeout: 2000, maxBuffer: 8192,
    }).trim(), options.layout.executable);
    const profile = await ownedProfile(options.profileRoot);
    let refusal;
    await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 300 }), error => {
      refusal = error;
      if (error.code !== 'installed-app-already-running') {
        const diagnostic = nativeOwnerCensusDiagnostic(error);
        if (diagnostic) console.error('LAWOSS_OWNER_CENSUS_DIAGNOSTIC ' + JSON.stringify(diagnostic));
      }
      return error.code === 'installed-app-already-running';
    });
    process.kill(existing.pid, 0);
    assert.equal(existing.exitCode, null);
    assert.equal(existing.signalCode, null);
    await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
    assert.ok(refusal instanceof NativeAlphaLaunchError);
    assert.ok(refusal.cause instanceof Error);
    assert.notEqual(refusal.cause, refusal);
    assert.equal(refusal.cause.code, 'installed-app-already-running');
    assert.equal(refusal.code, refusal.cause.code);
    assert.equal(refusal.message, refusal.cause.message);
    assert.equal(refusal.status, 'blocked');
    assert.equal(refusal.status, refusal.cause.status);
    assert.deepEqual(refusal.nativeCleanup, { status: 'stopped', descendantClosure: 'verified',
      method: 'no-child-started', profileRoot: profile.root, profileOwner: profile.owner });
  } finally { existing.kill(); await closed; }
});

test('verified owned cleanup removes only that Chromium singleton lease and permits relaunch', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  const userdata = join(options.profileRoot, 'userdata');
  await symlink(`${hostname()}-${app.pid}`, join(userdata, 'SingletonLock'));
  await symlink('123456789', join(userdata, 'SingletonCookie'));
  await symlink(join(tmpdir(), 'scoped_dirSynthetic', 'SingletonSocket'), join(userdata, 'SingletonSocket'));
  await app.stop();
  const again = options.own(await launchAlphaApp({ ...options, build }));
  assert.equal((await again.observe()).snapshot.ok, true);
  await again.stop();
});

test('direct diagnostic launch refuses an ordinary directory without synthetic ownership', async t => {
  const options = await fixture(t);
  await rm(join(options.profileRoot, '.lawoss-release-acceptance-profile.json'));
  await assert.rejects(launchAlphaApp({ ...options, build }).then(options.own), error => {
    assert.equal(error instanceof NativeAlphaLaunchError, false);
    assert.equal(error.nativeCleanup, undefined);
    return /unowned|profile/i.test(error.message);
  });
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

test('installed embedded identity must match the expected candidate before taking a profile lock', async (t) => {
  const options = await fixture(t);
  await writeFile(join(options.layout.resources, 'build-info.json'), JSON.stringify({ ...build, gitSha: 'b'.repeat(40) }));
  await assert.rejects(launchAlphaApp({ ...options, build }), /installed-build-identity-mismatch/);
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

test('actual readiness timeout freezes non-exited status before cleanup terminates the owned protocol fixture', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t, { wrong: { rendererUrl: 'http://127.0.0.1:5173/' } });
  let caught;await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 400 }), error => { caught = error; return true; });
  assert.equal(caught.code, 'native-readiness-timeout');
  assert.equal(caught.nativeCleanup.descendantClosure, 'verified');
  assert.deepEqual(nativeLaunchDiagnostic(caught), { exitObserved: false, exitCode: null, signal: null,
    stderr: { categories: ['unknown'], scannedBytes: 0, truncated: false } });
  assert.equal(nativeLaunchDiagnostic(caught.cause), null);
  assert.equal(nativeLaunchDiagnostic(new Error('PRIVATE', { cause: caught })), null);
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

for (const [name, change, progress] of [
  ['held snapshot body', { stall: true }, 'process-identity'],
  ['unusable UI', { readiness: { documentReadyState: 'complete', bootOverlayVisible: true, interactiveControls: 1 } }, 'renderer-identity'],
]) test(`actual readiness retries retain highest completed progress for ${name} before owned cleanup`, { skip: process.platform === 'win32', timeout: 10_000 }, async t => {
  const options = await fixture(t, change);
  let caught;await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 1200 }), error => { caught = error;return true; });
  assert.equal(caught.code, 'native-readiness-timeout');assert.equal(caught.nativeCleanup.descendantClosure, 'verified');
  const facts = nativeReadinessDiagnostic(caught);
  assert.ok(facts.attempts > 0 && facts.attempts <= 128);assert.equal(facts.attemptsCapped, false);
  assert.equal(facts.progress, progress);
  // The wall clock can expire at a newer retry boundary than this completed progress.
  const snapshots = Number(await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8'));
  assert.ok(Number.isSafeInteger(snapshots) && snapshots >= 1);
  assert.equal(nativeReadinessDiagnostic(caught.cause), null);
  assert.doesNotMatch(JSON.stringify(facts), /PRIVATE|private|token|rendererUrl|baseUrl|"pid"/);
  assert.ok(Object.isFrozen(facts));
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

for (const [name, wrong] of [
  ['development build', { build: { provenance: 'development' } }],
  ['foreign executable', { process: { pid: 1, userData: '/foreign', executable: '/foreign/app' } }],
  ['development renderer', { rendererUrl: 'http://127.0.0.1:5173/' }],
]) test(`readiness refuses ${name} and retains no active profile lock after owned cleanup`, { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t, { wrong });
  await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 400 }), error => {
    assert.match(error.message, /native-readiness-timeout/);
    assert.equal(error.nativeCleanup?.descendantClosure, 'verified');
    assert.equal(error.nativeCleanup?.profileRoot, options.profileRoot);
    return true;
  });
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

test('protocol fixture binds child PID, profile, embedded build and file renderer; credentials stay private', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t);
  const app = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  const live = await app.observe();
  assert.equal(live.process.pid, app.pid);
  assert.equal(live.process.executable, options.layout.executable);
  assert.equal(live.process.userData, join(options.profileRoot, 'userdata'));
  assert.equal(live.snapshot.route, '/welcome');
  assert.doesNotMatch(JSON.stringify(app), /private-fixture-token|baseUrl|authorization/);
  const action = await app.execute('fixture.echo', { value: 'synthetic' });
  assert.deepEqual(action, { ok: true, input: { actionId: 'fixture.echo', args: { value: 'synthetic' } } });
  await assert.rejects(app.capture(join(options.root, 'window.png')), /owned-window-unavailable/);
  await assert.rejects(app.execute('', {}), /invalid-action/);
  const stopped = await app.stop();
  assert.equal(stopped.descendantClosure, 'verified');
  assert.deepEqual(await app.stop(), stopped);
  await assert.rejects(app.observe(), /app-stopped/);
});

test('identity is revalidated before any action and cannot drift to a foreign PID', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  await app.execute('fixture.identity', { process: { pid: process.pid, userData: join(options.profileRoot, 'userdata'), executable: options.layout.executable } });
  await assert.rejects(app.observe(), /process or profile ownership differs/);
  await assert.rejects(app.execute('fixture.echo', {}), /process or profile ownership differs/);
});

test('symlinked storage cannot redirect writes outside the owned profile', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t);
  await symlink(options.root, join(options.profileRoot, 'userdata'));
  await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 5000 }), /unsafe-profile/);
});

test('launcher prepares owned state before its protocol child writes and closes normally', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t, { stateProbe: true });
  const app = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  const state = join(options.profileRoot, 'state'), info = await lstat(state);
  assert.equal(info.isDirectory(), true);
  assert.equal(info.isSymbolicLink(), false);
  assert.deepEqual(JSON.parse(await readFile(join(state, 'fixture-state-sentinel'), 'utf8')), { state });
  assert.equal(await readFile(join(options.profileRoot, 'userdata/fixture-child-started'), 'utf8'), 'started');
  assert.equal((await app.stop()).descendantClosure, 'verified');
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

for (const kind of ['in-profile link', 'regular file', 'hardlinked file']) {
  test(`launcher refuses ${kind} at state before child or discovery mutation and retains unknown entries`, { skip: process.platform === 'win32' }, async t => {
    const options = await fixture(t, { stateProbe: true });
    const state = join(options.profileRoot, 'state'), target = join(options.profileRoot, 'unknown-state-target');
    const contents = 'retain unknown state';
    if (kind === 'in-profile link') {
      await mkdir(target);
      await writeFile(join(target, 'sentinel'), contents);
      await symlink(target, state);
    } else if (kind === 'hardlinked file') {
      await writeFile(target, contents);
      await link(target, state);
    } else await writeFile(state, contents);
    const before = await lstat(state, { bigint: true });
    await mkdir(join(options.profileRoot, 'userdata'));
    const discovery = join(options.profileRoot, 'userdata/legalwork-ui-control.json');
    await writeFile(discovery, 'retain stale discovery');
    await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 5000 }).then(options.own), error => {
      assert.equal(error.code, kind === 'hardlinked file' ? 'unsafe-profile-entry' : 'unsafe-profile');
      if (kind !== 'hardlinked file') {
        assert.ok(error instanceof NativeAlphaLaunchError);
        assert.equal(error.nativeCleanup.method, 'no-child-started');
        assert.equal(error.nativeCleanup.descendantClosure, 'verified');
      }
      return true;
    });
    const after = await lstat(state, { bigint: true });
    // Admission may read a link; access time is not a mutation of its identity or bytes.
    for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key]);
    assert.equal(await readFile(discovery, 'utf8'), 'retain stale discovery');
    await assert.rejects(readFile(join(options.profileRoot, 'userdata/fixture-child-started')), { code: 'ENOENT' });
    await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
    if (kind === 'in-profile link') {
      assert.equal(await readlink(state), target);
      assert.deepEqual(await readdir(target), ['sentinel']);
      assert.equal(await readFile(join(target, 'sentinel'), 'utf8'), contents);
    } else {
      assert.equal(await readFile(state, 'utf8'), contents);
      if (kind === 'hardlinked file') assert.equal(await readFile(target, 'utf8'), contents);
    }
  });
}

test('a nested migrated profile link cannot redirect application writes outside its root', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t);
  await mkdir(join(options.profileRoot, 'userdata'));
  const outside = join(options.root, 'normal-profile-state');
  await writeFile(outside, 'preserve normal profile');
  await symlink(outside, join(options.profileRoot, 'userdata', 'Local State'));
  await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 5000 }).then(options.own), /unsafe-profile/);
  assert.equal(await readFile(outside, 'utf8'), 'preserve normal profile');
});

test('profile lock prevents concurrent launch and releases only after verified stop', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 5000 }), /profile-in-use/);
  await app.stop();
  const second = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  await second.stop();
});

test('stale discovery is removed and fresh owned discovery is required', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t, { delayedDiscovery: true });
  await mkdir(join(options.profileRoot, 'userdata'));
  await writeFile(join(options.profileRoot, 'userdata', 'legalwork-ui-control.json'), JSON.stringify({ token: 'foreign-token', baseUrl: 'http://outside.invalid' }));
  const app = options.own(await launchAlphaApp({ ...options, build, timeoutMs: 5000 }));
  await app.stop();
});

test('header-only snapshot cannot escape readiness deadline and cleanup drains the child', { skip: process.platform === 'win32' }, async (t) => {
  const options = await fixture(t, { stall: true });
  const started = performance.now();
  await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 400 }), /native-readiness-timeout/);
  assert.ok(performance.now() - started < 3500);
  await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
});

for (const [name, readiness] of [
  ['boot overlay visible', { documentReadyState: 'complete', bootOverlayVisible: true, interactiveControls: 1 }],
  ['document still loading', { documentReadyState: 'loading', bootOverlayVisible: false, interactiveControls: 1 }],
  ['no interactive control', { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 0 }],
  ['legacy missing UI readiness', null],
]) test(`UI readiness validator refuses ${name}`, () => {
  assert.throws(() => assertInteractiveUi({ readiness }), { code: 'native-ui-not-ready' });
});

test('UI readiness validator accepts a completed document with no overlay and an interactive control', () => {
  assert.doesNotThrow(() => assertInteractiveUi({ readiness: { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 1 } }));
});


test('a transient presentation watchdog after launch recovers inside the observation budget', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { remaining: 2 });
  assert.equal((await app.observe()).snapshot.route, '/welcome');
  assert.equal(await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8'), '3');
});

test('persistent presentation delay cannot extend the original five-second observation budget', { skip: process.platform === 'win32', timeout: 8000 }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { remaining: -1 });
  const started = performance.now();
  await assert.rejects(app.observe(), { code: 'shipping-control-request-timeout' });
  assert.ok(performance.now() - started < 8000);
});

for (const phase of ['headers', 'body']) test(`stalled snapshot ${phase} reports the owned observation timeout`, { skip: process.platform === 'win32', timeout: 8000 }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { stall: phase, remaining: 0 });
  const started = performance.now();
  await assert.rejects(app.observe(), { code: 'shipping-control-request-timeout' });
  assert.ok(performance.now() - started < 8000);
});

for (const [name, identity, message] of [
  ['foreign renderer', { rendererUrl: 'file:///foreign/index.html' }, /Packaged renderer/],
  ['foreign PID', { process: { pid: 1, userData: '/foreign', executable: '/foreign' } }, /process or profile ownership differs/],
  ['foreign build', { build: { provenance: 'development' } }, /IPC identity differs/],
]) test(`presentation waiting never retries a ${name}`, { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { remaining: -1, identity });
  const before = await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8');
  await assert.rejects(app.observe(), message);
  assert.equal(await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8'), before);
});

for (const [name, patch] of [
  ['missing readiness', { readiness: null }],
  ['non-finite readiness', { readiness: { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: '3' } }],
  ['different renderer error', { error: 'LegalWork control surface is not available yet.' }],
]) test(`presentation waiting never retries ${name}`, { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { remaining: -1, ...patch });
  await assert.rejects(app.observe());
  assert.equal(await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8'), '1');
});


test('identity drift during a presentation wait refuses before another snapshot is requested', { skip: process.platform === 'win32' }, async t => {
  const options = await fixture(t), app = options.own(await launchAlphaApp({ ...options, build }));
  await app.execute('fixture.presentation', { remaining: 1, identityAfterSnapshot: { process: { pid: 1, userData: '/foreign', executable: '/foreign' } } });
  await assert.rejects(app.observe(), /process or profile ownership differs/);
  assert.equal(await readFile(join(options.profileRoot, 'userdata/snapshot-count'), 'utf8'), '1');
});

// The same packaged URL can survive a reload; it is not a document identity.
test('capture binding requires the same native window and finite renderer time origin', () => {
  const identity = () => ({windowSourceId:'window:42:0',rendererUrl:'file:///fixture/index.html',
    snapshot:{windowSourceId:'window:42:0',readiness:{documentTimeOrigin:1700000000000.5}}});
  const captured = {windowSourceId:'window:42:0',documentTimeOrigin:1700000000000.5};
  const stable=assertCaptureBinding(identity(),captured,identity());
  assert.deepEqual(stable,{status:'verified',window:'same',document:'same'});
  assert.equal(Object.isFrozen(stable),true);
  for(const value of [undefined,null,0,-1,NaN,Infinity,'1700000000000.5',Number.MAX_SAFE_INTEGER+1]) {
    const live=identity();live.snapshot.readiness.documentTimeOrigin=value;
    assert.throws(()=>assertCaptureBinding(live,captured),{code:'native-capture-identity-unavailable'});
  }
  for(const windowSourceId of [null,undefined,'window:0:0','window:42:0 private','private-token','x'.repeat(129)]) {
    const live=identity();live.windowSourceId=windowSourceId;live.snapshot.windowSourceId=windowSourceId;
    assert.throws(()=>assertCaptureBinding(live,captured),{code:'owned-window-unavailable'});
  }
  const other=identity();other.snapshot.windowSourceId='window:43:0';
  assert.throws(()=>assertCaptureBinding(other,captured),{code:'native-capture-identity-unavailable'});
  const reloaded=identity();reloaded.snapshot.readiness.documentTimeOrigin++;
  assert.throws(()=>assertCaptureBinding(identity(),captured,reloaded),{code:'native-capture-identity-changed'});
  assert.throws(()=>assertCaptureBinding(identity(),{}),{code:'native-capture-identity-changed'});
});


function modelStop(failedAt, error, extra = {}) {
  const order = [], child = { pid: 123 };
  const operation = name => async () => { order.push(name); if (failedAt === name) throw error; };
  const closed = failedAt === 'child-close' ? Promise.reject(error) : Promise.resolve();
  closed.catch(() => {});
  const stop = createNativeAppStop({ state: () => ({ child, closed }), root: 'MODEL',
    releaseLock: operation('profile-lock'), closeLock: async () => { order.push('handle-close'); },
    onStop: () => { order.push('stopped'); }, ...extra }, {
    stopChild: operation('native-stop'), removeLease: operation('chromium-lease'),
  });
  return { stop, order };
}

for (const [stage, completed, order] of [
  ['native-stop', 0, ['stopped', 'native-stop', 'handle-close']],
  ['child-close', 1, ['stopped', 'native-stop', 'handle-close']],
  ['chromium-lease', 2, ['stopped', 'native-stop', 'chromium-lease', 'handle-close']],
  ['profile-lock', 3, ['stopped', 'native-stop', 'chromium-lease', 'profile-lock', 'handle-close']],
]) test(`cleanup attribution production sequence preserves ${stage} failure and memoized stop`, async () => {
  const error = new Error('PRIVATE path token'), f = modelStop(stage, error);
  const first = f.stop();
  assert.equal(f.stop(), first);
  let thrown; try { await first; } catch (value) { thrown = value; }
  assert.equal(thrown, error);
  assert.deepEqual(f.order, order);
  assert.deepEqual(nativeStopDiagnostic(error, f.stop), { failedAt: stage, completed });
  assert.ok(Object.isFrozen(nativeStopDiagnostic(error, f.stop)));
  assert.equal(f.stop(), first);
});

test('cleanup attribution isolates concurrent owners and exact hostile error identity without property reads', async () => {
  const error = new Error('PRIVATE /path token');
  Object.defineProperty(error, 'message', { get() { throw new Error('message must not be read'); } });
  const a = modelStop('native-stop', error), b = modelStop('profile-lock', error);
  await Promise.all([a.stop().catch(value => assert.equal(value, error)), b.stop().catch(value => assert.equal(value, error))]);
  const first = nativeStopDiagnostic(error, a.stop);
  assert.deepEqual(first, { failedAt: 'native-stop', completed: 0 });
  assert.deepEqual(nativeStopDiagnostic(error, b.stop), { failedAt: 'profile-lock', completed: 3 });
  assert.throws(() => { first.completed = 3; }, TypeError);
  assert.equal(nativeStopDiagnostic(error, a.stop), first);
  let traps = 0;
  const proxy = new Proxy(error, { get() { traps++; throw new Error('PRIVATE'); }, getPrototypeOf() { traps++; throw new Error('PRIVATE'); } });
  const revoked = Proxy.revocable(error, {}); revoked.revoke();
  for (const foreign of [new Error('PRIVATE'), { cleanupAttribution: first }, new Error('wrapper', { cause: error }), proxy, revoked.proxy, null, 1, 'failure'])
    assert.equal(nativeStopDiagnostic(foreign, a.stop), null);
  for (const owner of [() => {}, new Proxy(a.stop, {}), {}, undefined, null, 1]) assert.equal(nativeStopDiagnostic(error, owner), null);
  assert.equal(traps, 0);
  const c = modelStop('chromium-lease', proxy);
  let thrown; try { await c.stop(); } catch (value) { thrown = value; }
  assert.equal(thrown, proxy);
  assert.deepEqual(nativeStopDiagnostic(proxy, c.stop), { failedAt: 'chromium-lease', completed: 2 });
  assert.equal(traps, 0);
  for (const value of [null, undefined, 0, 'PRIVATE primitive']) {
    const f = modelStop('native-stop', value);
    let thrown; try { await f.stop(); } catch (error) { thrown = error; }
    assert.equal(thrown, value);
    assert.equal(nativeStopDiagnostic(value, f.stop), null);
  }
});

test('cleanup attribution keeps dynamic stop state and Windows/no-child paths unregistered', async () => {
  for (const mode of ['no-child', 'windows', 'windows-missing', 'late-posix']) {
    const error = new Error('PRIVATE'), order = [];
    let state = {};
    const stop = createNativeAppStop({ state: () => state, root: 'MODEL', onStop: () => order.push('stopped'),
      releaseLock: async () => { order.push('lock'); throw error; }, closeLock: async () => { order.push('close'); },
    }, { stopChild: async (_child, budget) => { assert.equal(budget, 5000); order.push('native'); }, removeLease: async () => order.push('lease') });
    if (mode === 'windows') state = { windowsLaunchAttempted: true, windowsJob: { stop: async () => { order.push('windows'); return { method: 'MODEL windows' }; } } };
    if (mode === 'windows-missing') state = { windowsLaunchAttempted: true };
    if (mode === 'late-posix') state = { child: { pid: 123 }, closed: Promise.resolve() };
    let thrown; try { await stop(); } catch (value) { thrown = value; }
    if (mode === 'windows-missing') assert.equal(thrown.code, 'windows-job-closure-unverified');
    else assert.equal(thrown, error);
    assert.deepEqual(nativeStopDiagnostic(thrown, stop), mode === 'late-posix' ? { failedAt: 'profile-lock', completed: 3 } : null);
    assert.deepEqual(order, mode === 'late-posix' ? ['stopped', 'native', 'lease', 'lock', 'close']
      : mode === 'windows' ? ['stopped', 'windows', 'lock', 'close'] : mode === 'windows-missing' ? ['stopped', 'close'] : ['stopped', 'lock', 'close']);
  }
});

test('cleanup attribution freezes before best-effort handle closure and preserves its original rejection', async () => {
  const error = new Error('first'), later = new Error('close');
  let observed;
  const f = modelStop('native-stop', error, { closeLock: async () => { observed = nativeStopDiagnostic(error, f.stop); throw later; } });
  let thrown; try { await f.stop(); } catch (value) { thrown = value; }
  assert.equal(thrown, error);
  assert.deepEqual(observed, { failedAt: 'native-stop', completed: 0 });
  assert.equal(nativeStopDiagnostic(later, f.stop), null);
});

// Real disposable Node process and inherited output pipe. Termination is MODEL:
// the ownership helper intentionally destroys streams, so it cannot hold this barrier.
async function heldCloseFixture() {
  const holderSource = `
    const fs = require('node:fs');
    const gate = fs.createReadStream(null, { fd: 3 });
    const limit = setTimeout(() => process.exit(93), 12000);
    gate.once('data', () => { clearTimeout(limit); process.exit(0); });
    process.send('held');
  `;
  const source = `
    const { spawn } = require('node:child_process');
    const holder = spawn(process.execPath, ['-'], { stdio: ['pipe', 1, 'ignore', 3, 'ipc'] });
    holder.stdin.end(${JSON.stringify(holderSource)});
    holder.once('message', () => process.send('held', () => process.exit(0)));
  `;
  const child = spawn(process.execPath, ['-'], { stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'ipc'] });
  const close = once(child, 'close'), exit = once(child, 'exit'), ready = once(child, 'message');
  child.stdout.resume(); child.stderr.resume();
  child.stdin.end(source);
  return { child, close, exit, ready, release: () => child.stdio[3].end('release') };
}

for (const refuse of [false, true]) test(`cleanup attribution real owned pipe close barrier (${refuse ? 'finite refusal' : 'join'})`, { timeout: 18000 }, async t => {
  const f = await heldCloseFixture(), order = [];
  let didClose = false, outcome, pending;
  f.close.then(() => { didClose = true; order.push('actual-close'); });
  try {
    assert.deepEqual(await f.ready, ['held', undefined]);
    assert.deepEqual(await f.exit, [0, null]);
    assert.equal(didClose, false, 'process exit is not pipe close');
    const stop = createNativeAppStop({ state: () => ({ child: f.child, closed: f.close }), root: 'MODEL',
      onStop: () => order.push('stopped'), releaseLock: async () => order.push('lock'), closeLock: async () => order.push('handle-close'),
    }, { stopChild: async (child, budget) => {
      assert.equal(child, f.child); assert.equal(budget, 5000);
      await f.exit; order.push('MODEL-native-stop');
    }, removeLease: async () => { assert.equal(didClose, true); order.push('lease'); } });
    pending = stop().then(value => { outcome = { value }; }, error => { outcome = { error }; });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['stopped', 'MODEL-native-stop']);
    assert.equal(outcome, undefined);
    if (refuse) {
      await pending;
      assert.equal(outcome.error.code, 'native-child-close-unverified');
      assert.deepEqual(nativeStopDiagnostic(outcome.error, stop), { failedAt: 'child-close', completed: 1 });
      assert.deepEqual(order, ['stopped', 'MODEL-native-stop', 'handle-close']);
      assert.equal(didClose, false);
    }
    f.release(); await f.close; await pending;
    if (!refuse) {
      assert.deepEqual(order, ['stopped', 'MODEL-native-stop', 'actual-close', 'lease', 'lock']);
      assert.deepEqual(outcome.value, { status: 'stopped', descendantClosure: 'verified', method: 'posix-owned-process-group' });
    } else assert.deepEqual(order, ['stopped', 'MODEL-native-stop', 'handle-close', 'actual-close']);
    t.diagnostic(JSON.stringify({ proof: 'real-owned-Node-and-inherited-pipe-close', stopOperation: 'MODEL-not-native-ownership', refuse, order }));
  } finally {
    if (!didClose) f.release();
    await f.close;
    await pending;
  }
});
