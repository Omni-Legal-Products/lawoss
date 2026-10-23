import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, realpath, rm, readdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { shouldRunWindowsDocumentsProbe, runWindowsDocumentsProbe, collectWindowsDocumentsCase, documentsProbeStatus, readElectronPackageMetadata } from './windows-documents-probe.mjs';
import { observeWindowsDocumentsPath, classifyWindowsDocumentsPath, documentsProbeCases, readDocumentsProbeJson } from './windows-documents-probe-child.mjs';
import { createHash } from 'node:crypto';
import { prepareAcceptanceProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';

const context = { platform: 'win32', arch: 'x64', environment: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' } };
function failure() {
  return { kind: 'lawoss-ci-native-startup', status: 'failed', reason: 'native-startup-unverified', diagnostic: {
    phase: 'launch', errorCode: 'native-readiness-timeout', cleanup: 'native-verified',
    nativeReadiness: { attempts: 128, attemptsCapped: true, progress: 'none', lastBoundary: 'discovery', lastError: 'ENOENT' },
    mainLog: { current: { availability: 'read', scannedBytes: 599, truncated: false,
      categories: ['startup-main-configured', 'startup-icons-entered', 'startup-icons-returned', 'startup-services-returned',
        'startup-runtime-manager-entered', 'startup-runtime-state-returned', 'startup-runtime-user-data-returned', 'startup-runtime-home-returned'] },
      previous: { availability: 'missing', scannedBytes: 0, truncated: false, categories: [] } },
  } };
}

test('Documents diagnostic admission requires the exact hosted Windows first-failure boundary and verified cleanup', () => {
  assert.equal(shouldRunWindowsDocumentsProbe(failure(), context), true);
  for (const change of [
    f => { f.diagnostic.cleanup = 'unverified'; },
    f => { f.diagnostic.phase = 'preflight'; },
    f => { f.diagnostic.errorCode = 'installed-app-exited'; },
    f => { f.diagnostic.nativeReadiness.lastError = 'EACCES'; },
    f => { f.diagnostic.nativeReadiness.progress = 'discovery'; },
    f => { f.diagnostic.mainLog.current.categories.push('startup-runtime-documents-returned'); },
    f => { f.diagnostic.mainLog.current.categories.pop(); },
    f => { f.diagnostic.mainLog.current.truncated = true; },
  ]) { const f = failure(); change(f); assert.equal(shouldRunWindowsDocumentsProbe(f, context), false); }
  for (const c of [{ ...context, platform: 'darwin' }, { ...context, arch: 'ia32' }, { ...context, environment: {} },
    { ...context, environment: { ...context.environment, RUNNER_ENVIRONMENT: 'self-hosted' } }]) assert.equal(shouldRunWindowsDocumentsProbe(failure(), c), false);
  let reads = 0;
  const hostile = {}; Object.defineProperty(hostile, 'diagnostic', { get() { reads++; throw Error('PRIVATE'); } });
  assert.equal(shouldRunWindowsDocumentsProbe(hostile, context), false);
  assert.equal(reads, 0);
});

test('Documents diagnostic refuses unsupported real hosts before writing a fixture or running children', {
  skip: process.platform === 'win32' ? 'host refusal fixture is for a real non-Windows host' : false,
}, async t => {
  const temporaryRoot = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-documents-refusal-')));
  t.after(() => rm(temporaryRoot, { recursive: true, force: true }));
  await assert.rejects(runWindowsDocumentsProbe({ temporaryRoot, originalFailure: failure(), output: path.join(temporaryRoot, 'result.json') }), { code: 'windows-documents-probe-refused' });
  assert.deepEqual(await readdir(temporaryRoot), []);
});

async function childFixture(t, caseId = 'alpha-environment') {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-documents-child-model-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'case');
  const profile = await prepareAcceptanceProfile({ root, kind: 'fresh' });
  for (const directory of ['userdata', 'runtime', 'workspace', 'home', 'config', 'data', 'cache', 'tmp']) await mkdir(path.join(root, directory));
  if (caseId === 'explicit-documents-control') await mkdir(path.join(root, 'documents'));
  return { schema: 1, root, owner: profile.owner, nonce: 'a'.repeat(64), caseId };
}

test('controlled API observations preserve one original path sequence and finite lexical scope without disclosing paths', async t => {
  for (const caseId of ['alpha-environment', 'home-documents-present', 'explicit-documents-control']) await t.test(caseId, async t => {
    const fixture = await childFixture(t, caseId), events = [];
    const app = { setPath(name) { events.push(`set:${name}`); }, setAppLogsPath() { events.push('logs'); },
      getPath(name) { events.push(`get:${name}`); return path.join(fixture.root, name); }, isReady() { return false; } };
    const result = observeWindowsDocumentsPath({ app, fixture, runtime: { electron: '43.7.5', arch: 'x64' } });
    assert.deepEqual(events, ['set:userData', 'logs', ...(caseId === 'explicit-documents-control' ? ['set:documents'] : []), 'get:userData', 'get:home', 'get:documents']);
    assert.equal(result.outcome, 'returned'); assert.equal(result.scope, 'inside-owned-root'); assert.equal(result.beforeReady, true);
    assert.equal(JSON.stringify(result).includes(fixture.root), false);
    assert.equal((await readFile(path.join(fixture.root, 'documents-entered.json'), 'utf8')).includes('documents'), true);
    assert.deepEqual(JSON.parse(await readFile(path.join(fixture.root, 'documents-result.json'), 'utf8')), result);
  });
  assert.equal(classifyWindowsDocumentsPath('C:\\owned', 'D:\\PRIVATE_USER\\Documents'), 'outside-owned-root');
  assert.equal(classifyWindowsDocumentsPath('C:\\owned', 'relative'), 'not-absolute');
  assert.equal(classifyWindowsDocumentsPath('C:\\owned', null), 'not-string');
});

test('controlled documents throws remain distinct from returned paths and expose no exception text or getters', async t => {
  const fixture = await childFixture(t);
  let reads = 0;
  const error = new Error('PRIVATE_EXCEPTION_PATH');
  Object.defineProperty(error, 'code', { get() { reads++; throw Error('PRIVATE'); } });
  const app = { setPath() {}, setAppLogsPath() {}, isReady() { return true; }, getPath(name) { if (name === 'documents') throw error; return 'ignored'; } };
  const result = observeWindowsDocumentsPath({ app, fixture, runtime: { electron: '43.7.5', arch: 'x64' } });
  assert.equal(result.outcome, 'threw'); assert.equal(result.beforeReady, false); assert.equal(result.errorCode, 'other');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(reads, 0);
  assert.equal(result.scope, 'not-observed');
});

function modeledJob(onStop = () => {}) {
  return { isRunning: () => true, stop: async () => { onStop(); return { status: 'stopped', descendantClosure: 'verified', method: 'windows-atomic-job-object' }; } };
}
const controlledApp = fixture => ({ setPath() {}, setAppLogsPath() {}, isReady: () => false,
  getPath: name => path.join(fixture.root, name) });

test('modeled collector returns closed observations only after stop and refuses inconsistent private records', async t => {
  for (const inconsistent of [false, true]) await t.test(String(inconsistent), async t => {
    const fixture = await childFixture(t); let stopped = 0;
    const observed = observeWindowsDocumentsPath({ app: controlledApp(fixture), fixture, runtime: { electron: '43.7.5', arch: 'x64' } });
    if (inconsistent) await writeFile(path.join(fixture.root, 'documents-result.json'), JSON.stringify({ ...observed,
      outcome: 'before-documents-failure', scope: 'not-observed', errorName: 'Error', errorCode: 'other' }));
    const result = await collectWindowsDocumentsCase({ fixture, executable: 'MODELED-NO-EXECUTION', env: {}, arch: 'x64' }, {
      launch: async options => { assert.equal(options.timeoutMs, 15000); return modeledJob(() => stopped++); },
    });
    assert.equal(stopped, 1); assert.equal(result.cleanup, 'verified');
    assert.equal(result.status, inconsistent ? 'unavailable' : 'observed');
    assert.equal(JSON.stringify(result).includes(fixture.nonce), false);
    assert.equal(JSON.stringify(result).includes(fixture.root), false);
  });
});

test('modeled collector distinguishes entered and not-entered timeout without retrying any child', async t => {
  for (const entered of [true, false]) await t.test(String(entered), async t => {
    const fixture = await childFixture(t);
    if (entered) await writeFile(path.join(fixture.root, 'documents-entered.json'), JSON.stringify({ schema: 1, nonce: fixture.nonce,
      caseId: fixture.caseId, electron: '43.7.5', arch: 'x64', phase: 'documents', beforeReady: true }));
    let launches = 0, stopped = 0, time = 0;
    const result = await collectWindowsDocumentsCase({ fixture, executable: 'MODELED-NO-EXECUTION', env: {}, arch: 'x64' }, {
      launch: async () => { launches++; return modeledJob(() => stopped++); }, now: () => time, pause: async () => { time = 15000; },
    });
    assert.equal(result.outcome, entered ? 'entered-timeout' : 'not-entered-timeout');
    assert.equal(result.beforeReady, entered ? true : null);
    assert.equal(result.apiElapsedMs, null); assert.equal(result.parentObservationElapsedMs, 15000);
    assert.equal(launches, 1); assert.equal(stopped, 1);
  });
});

test('modeled stop uncertainty retains private observations and cannot become verified cleanup', async t => {
  const fixture = await childFixture(t);
  observeWindowsDocumentsPath({ app: controlledApp(fixture), fixture, runtime: { electron: '43.7.5', arch: 'x64' } });
  const result = await collectWindowsDocumentsCase({ fixture, executable: 'MODELED-NO-EXECUTION', env: {}, arch: 'x64' }, {
    launch: async () => ({ isRunning: () => true, stop: async () => { throw new Error('PRIVATE_CLOSE_ERROR'); } }),
  });
  assert.equal(result.cleanup, 'unverified');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'documents-result.json'), 'utf8')).outcome, 'returned');
});

test('modeled liveness observation failure cannot prevent owned stop from being attempted', async t => {
  const fixture = await childFixture(t); let stopped = 0;
  observeWindowsDocumentsPath({ app: controlledApp(fixture), fixture, runtime: { electron: '43.7.5', arch: 'x64' } });
  const result = await collectWindowsDocumentsCase({ fixture, executable: 'MODELED-NO-EXECUTION', env: {}, arch: 'x64' }, {
    launch: async () => ({ isRunning() { throw Error('PRIVATE_OBSERVER_ERROR'); }, stop: async () => { stopped++; return { status: 'stopped', descendantClosure: 'verified', method: 'windows-atomic-job-object' }; } }),
  });
  assert.equal(stopped, 1); assert.equal(result.cleanup, 'verified'); assert.equal(result.jobRunningBeforeStop, null);
});

test('overall diagnostic remains incomplete for unavailable cases even after verified stop', () => {
  const cases = documentsProbeCases.map(caseId => ({ caseId, status: 'observed', cleanup: 'verified' }));
  assert.equal(documentsProbeStatus(cases, true), 'observed');
  assert.equal(documentsProbeStatus(cases, false), 'incomplete');
  assert.equal(documentsProbeStatus([{ ...cases[0], status: 'unavailable' }, ...cases.slice(1)], true), 'incomplete');
  assert.equal(documentsProbeStatus([{ ...cases[0], cleanup: 'unverified' }, ...cases.slice(1)], true), 'incomplete');
  assert.equal(documentsProbeStatus(cases.slice(0, 2), true), 'incomplete');
});

test('private entered and result records stay absent until their complete bytes are published', async t => {
  const fixture = await childFixture(t), write = fs.writeFileSync;
  let publications = 0;
  fs.writeFileSync = (filename, text, options) => {
    const match = /^\.?documents-(entered|result)(?:\.json|\.pending)$/.exec(path.basename(filename));
    if (!match || path.dirname(filename) !== fixture.root) return write(filename, text, options);
    const bytes = Buffer.from(text), middle = Math.floor(bytes.length / 2);
    write(filename, bytes.subarray(0, middle), options);
    assert.equal(fs.existsSync(path.join(fixture.root, `documents-${match[1]}.json`)), false, 'a reader must not see a partial final record');
    write(filename, bytes.subarray(middle), { flag: 'a' }); publications++;
  };
  syncBuiltinESMExports();
  try { observeWindowsDocumentsPath({ app: controlledApp(fixture), fixture, runtime: { electron: '43.7.5', arch: 'x64' } }); }
  finally { fs.writeFileSync = write; syncBuiltinESMExports(); }
  assert.equal(publications, 2);
  assert.equal(JSON.parse(await readFile(path.join(fixture.root, 'documents-result.json'), 'utf8')).outcome, 'returned');
});

test('a symlink fixture root is refused before inspecting any child marker', async t => {
  const fixture = await childFixture(t), alias = path.join(path.dirname(fixture.root), 'alias');
  await fs.promises.symlink(fixture.root, alias, 'junction');
  const stat = fs.lstatSync; let markerReads = 0;
  fs.lstatSync = filename => {
    if (filename === path.join(alias, '.lawoss-release-acceptance-profile.json')) { markerReads++; throw Error('PRIVATE_MARKER_READ'); }
    return stat(filename);
  };
  syncBuiltinESMExports();
  try { assert.throws(() => observeWindowsDocumentsPath({ app: controlledApp(fixture), fixture: { ...fixture, root: alias }, runtime: { electron: '43.7.5', arch: 'x64' } }), { code: 'windows-documents-fixture-invalid' }); }
  finally { fs.lstatSync = stat; syncBuiltinESMExports(); }
  assert.equal(markerReads, 0);
});

test('read-only Electron package metadata accepts store hardlinks while private records and symlinks remain refused', async t => {
  const fixture = await childFixture(t), original = path.join(fixture.root, 'original-package.json'), shared = path.join(fixture.root, 'package.json');
  const bytes = Buffer.from(JSON.stringify({ name: 'electron', version: '43.7.5' }) + '\n');
  await writeFile(original, bytes); await fs.promises.link(original, shared);
  assert.equal((await fs.promises.lstat(shared)).nlink, 2);
  assert.deepEqual(await readElectronPackageMetadata(shared), { version: '43.7.5', sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.throws(() => readDocumentsProbeJson(shared), { code: 'windows-documents-fixture-invalid' });
  await t.test('file-symlink metadata is refused on POSIX', {
    skip: process.platform === 'win32' ? 'file-symlink-privilege is not established on Windows' : false,
  }, async () => {
    const symlink = path.join(fixture.root, 'symlink-package.json'); await fs.promises.symlink(shared, symlink);
    await assert.rejects(readElectronPackageMetadata(symlink));
  });
  const invalid = path.join(fixture.root, 'wrong-package.json'); await writeFile(invalid, JSON.stringify({ name: 'other', version: '43.7.5' }));
  await assert.rejects(readElectronPackageMetadata(invalid));
  await writeFile(invalid, JSON.stringify({ name: 'electron', version: '43.7.4' }));
  await assert.rejects(readElectronPackageMetadata(invalid));
});
