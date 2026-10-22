import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir, hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { assertInteractiveUi, launchAlphaApp, nativeAppLayout, nativeAppEnvironment } from './native-app.mjs';
import { prepareAcceptanceProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
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
    HOME: '/private', OPENAI_API_KEY: 'private-key', NODE_OPTIONS: '--import=private',
    ELECTRON_RUN_AS_NODE: '1', ELECTRON_EXTRA_LAUNCH_ARGS: '--remote-debugging-port=9222',
    LEGALWORK_UI_CONTROL_DISCOVERY: '/private/discovery', OPENCODE_CONFIG: 'private', LEGALWORK_WORKSPACES: '/private/workspaces',
    SystemRoot: 'C:\\Windows', WINDIR: 'C:\\Windows', APPDATA: 'private', USERPROFILE: 'private',
    COMSPEC: 'C:\\Windows\\System32\\cmd.exe', PATHEXT: '.COM;.EXE;.CMD', TEMP: '/private/temp' };
  const linux = nativeAppEnvironment('/owned', { platform: 'linux', environment: ambient });
  assert.equal(linux.PATH, ambient.PATH);
  for (const key of ['DISPLAY', 'XAUTHORITY', 'WAYLAND_DISPLAY', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS']) assert.equal(linux[key], ambient[key]);
  assert.equal(linux.HOME, '/owned/home');
  assert.equal(linux.TMPDIR, '/owned/tmp');
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
  assert.equal(windows.DISPLAY, undefined);
  const mac = nativeAppEnvironment('/owned', { platform: 'darwin', environment: ambient });
  assert.equal(mac.LAWOSS_DEV_MOCK_KEYCHAIN, '1');
  assert.equal(linux.LAWOSS_DEV_MOCK_KEYCHAIN, undefined);
  assert.equal(windows.LAWOSS_DEV_MOCK_KEYCHAIN, undefined);
});

// A real owned child implements only the shipping HTTP protocol. This fixture
// tests launcher boundaries; it is not Electron or native acceptance evidence.
async function fixture(t, { wrong = {}, stall = false, delayedDiscovery = false, readiness = { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 1 } } = {}) {
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
    await assert.rejects(launchAlphaApp({ ...options, build, timeoutMs: 300 }), /installed-app-already-running/);
    process.kill(existing.pid, 0);
    assert.equal(existing.exitCode, null);
    assert.equal(existing.signalCode, null);
    await assert.rejects(readFile(join(options.profileRoot, '.alpha-native-app.lock')), { code: 'ENOENT' });
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
  await assert.rejects(launchAlphaApp({ ...options, build }).then(options.own), /unowned|profile/i);
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
