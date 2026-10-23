import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAcceptanceProfile, ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { runAlphaAcceptance } from './run.mjs';
import { NativeAlphaLaunchError } from './native-app.mjs';

const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0-alpha.1', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: process.platform, arch: process.arch, channel: 'alpha', workflowRunUrl: '' };
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'alpha-run-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profileRoot = join(root, 'profile'); await prepareAcceptanceProfile({ root: profileRoot, kind: 'fresh' });
  return { installedApp: join(root, 'installed'), asset: join(root, 'installer'), expectedSha256: '1'.repeat(64), build,
    profileRoot, profileKind: 'fresh', output: join(root, 'receipt.json'), operator: 'synthetic-contract-test' };
}
function adapters(events, options = {}) {
  return {
    verifyInstallation: async () => { events.push('installation'); return { status: 'verified', signing: 'not-asserted' }; },
    launch: async () => ({ pid: 123,
      observe: async () => ({ process: { pid: 123 }, snapshot: { ok: true, route: '/welcome' } }),
      execute: async () => ({ ok: true }),
      capture: async path => { await writeFile(path, 'owned-window'); return { path, sha256: createHash('sha256').update('owned-window').digest('hex'), format: 'png', method: 'synthetic-boundary', ownerPid: 123 }; },
      stop: async () => { events.push('stop'); if (options.cleanupFails) throw new Error('cleanup unverified'); },
    }),
  };
}
test('noninteractive startup cannot turn unperformed user journeys into PASS', async t => {
  const options = await fixture(t), events = [];
  const receipt = await runAlphaAcceptance(options, adapters(events));
  assert.equal(receipt.kind, 'lawoss-private-alpha'); assert.equal(receipt.releaseEligible, false);
  assert.equal(receipt.status, 'blocked'); assert.equal(receipt.cleanup, 'verified');
  assert.equal(receipt.scenarios.find(x => x.scenario === 'startup').status, 'pass');
  assert.ok(receipt.scenarios.filter(x => x.scenario !== 'startup').every(x => x.status === 'blocked'));
  assert.deepEqual(events, ['installation', 'stop']);
  assert.equal(JSON.parse(await readFile(options.output, 'utf8')).status, 'blocked');
});
test('unverified cleanup overrides a successful startup and prevents a passing receipt', async t => {
  const options = await fixture(t);
  const result = await runAlphaAcceptance(options, adapters([], { cleanupFails: true }));
  assert.equal(result.status, 'blocked'); assert.equal(result.cleanup, 'unverified');
  assert.ok(await readFile(join(options.profileRoot, '.acceptance-running.lock'), 'utf8'));
});
test('an unsupported installation never starts the app', async t => {
  const options = await fixture(t); let launched = false;
  const result = await runAlphaAcceptance(options, { verifyInstallation: async () => { throw new Error('unsupported artifact'); }, launch: async () => { launched = true; } });
  assert.equal(launched, false); assert.equal(result.status, 'blocked'); assert.equal(result.installation.status, 'unverified');
});
test('unowned profiles and active profile leases are rejected before installation', async t => {
  const options = await fixture(t); const events = [];
  await writeFile(join(options.profileRoot, '.acceptance-running.lock'), 'other run');
  await assert.rejects(runAlphaAcceptance(options, adapters(events)), /EEXIST/);
  assert.deepEqual(events, []);
  assert.equal(await readFile(join(options.profileRoot, '.acceptance-running.lock'), 'utf8'), 'other run');
});

for (const historicalBuild of [{}, { version: '0.9.0-alpha.1' }]) test(`migration refuses an unevidenced copied baseline (${historicalBuild.version ?? 'missing version'})`, async t => {
  const options = await fixture(t), source = await ownedProfile(options.profileRoot);
  await writeFile(join(options.profileRoot, '.alpha-acceptance-baseline.json'), JSON.stringify({ status: 'pass', profileOwner: source.owner, build: historicalBuild }));
  const migrated = join(options.profileRoot, '..', 'migrated');
  await prepareAcceptanceProfile({ root: migrated, kind: 'migrated', migrateFrom: options.profileRoot });
  const events = [];
  const result = await runAlphaAcceptance({ ...options, profileRoot: migrated, profileKind: 'migrated' }, adapters(events));
  assert.equal(result.status, 'blocked');
  assert.deepEqual(events, []);
  assert.match(result.reasons.join(' '), /baseline|historical|evidence/i);
});

test('a failed launch releases its acceptance lease only with matching verified native cleanup', async t => {
  for (const matching of [true, false]) {
    const options = await fixture(t), profile = await ownedProfile(options.profileRoot);
    const result = await runAlphaAcceptance(options, { ...adapters([]), launch: async () => {
      throw new NativeAlphaLaunchError(new Error('native-readiness-timeout'), { descendantClosure: 'verified',
        profileRoot: profile.root, profileOwner: matching ? profile.owner : 'foreign-owner' });
    } });
    assert.equal(result.status, 'blocked');
    assert.equal(result.cleanup, matching ? 'verified' : 'unverified');
    if (matching) await assert.rejects(readFile(join(profile.root, '.acceptance-running.lock')), { code: 'ENOENT' });
    else assert.ok(await readFile(join(profile.root, '.acceptance-running.lock')));
  }
});


test('cleanup attribution observer sees written startup and original work reason before stop', async t => {
  const options = await fixture(t), events = [];
  const ports = adapters(events, { cleanupFails: true });
  const launch = ports.launch;
  const work = new Error('original work reason');
  let observations = 0, writtenAtObservation, observedError;
  ports.launch = async () => {
    const app = await launch();
    app.observe = async () => {
      if (++observations === 2) throw work;
      return { process: { pid: 123 }, snapshot: { ok: true, route: '/welcome' } };
    };
    return app;
  };
  ports.diagnosticObserver = (event, error) => {
    events.push(event);
    if (event === 'startup-written') writtenAtObservation = JSON.parse(readFileSync(`${options.output}.evidence/startup.json`)).status;
    if (event === 'work-failed') {
      observedError = error;
      error.message = 'observer mutation must not replace original reason';
    }
  };
  const result = await runAlphaAcceptance(options, ports);
  assert.deepEqual(events, ['installation', 'startup-written', 'work-failed', 'stop']);
  assert.equal(writtenAtObservation, 'pass');
  assert.equal(observedError, work);
  assert.deepEqual(result.reasons, ['original work reason', 'Owned process cleanup could not be verified']);
  assert.equal(result.scenarios[0].status, 'pass');
  assert.equal(JSON.parse(await readFile(result.scenarios[0].evidence)).status, 'pass');
  assert.equal(result.cleanup, 'unverified');
  assert.ok(await readFile(join(options.profileRoot, '.acceptance-running.lock')));
});

for (const behavior of ['throw', 'reject', 'thenable', 'native-then-getter', 'observer-getter']) test(`cleanup attribution observer ${behavior} cannot alter legacy success or become unhandled`, async t => {
  const options = await fixture(t), events = [], ports = adapters(events);
  let thenReads = 0, called = 0;
  ports.diagnosticObserver = event => {
    called++;
    events.push(event);
    if (behavior === 'throw') throw new Error('PRIVATE observer');
    if (behavior === 'reject') return Promise.reject(new Error('PRIVATE observer'));
    if (behavior === 'native-then-getter') {
      const pending = Promise.reject(new Error('PRIVATE native rejection'));
      Object.defineProperty(pending, 'then', { get() { thenReads++; throw new Error('do not read then'); } });
      return pending;
    }
    return { get then() { thenReads++; throw new Error('thenable must not be assimilated'); } };
  };
  if (behavior === 'observer-getter') Object.defineProperty(ports, 'diagnosticObserver', { get() { called++; throw new Error('PRIVATE observer getter'); } });
  const receipt = await runAlphaAcceptance(options, ports);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(called, 1);
  assert.equal(thenReads, 0);
  assert.deepEqual(events, behavior === 'observer-getter' ? ['installation', 'stop'] : ['installation', 'startup-written', 'stop']);
  assert.equal(receipt.cleanup, 'verified');
  assert.equal(receipt.status, 'blocked');
  assert.deepEqual(receipt.reasons, []);
  assert.equal(receipt.scenarios[0].status, 'pass');
  assert.equal(Object.hasOwn(receipt, 'diagnostic'), false);
  await assert.rejects(readFile(join(options.profileRoot, '.acceptance-running.lock')), { code: 'ENOENT' });
});

test('cleanup attribution observer follows original native cleanup and message reads', async t => {
  const options = await fixture(t), profile = await ownedProfile(options.profileRoot), events = [];
  const error = new NativeAlphaLaunchError(new Error('original'), { descendantClosure: 'verified', profileRoot: profile.root, profileOwner: profile.owner });
  const cleanup = error.nativeCleanup;
  Object.defineProperty(error, 'message', { get() { events.push('reason-read'); return 'original reason'; }, configurable: true });
  for (const key of ['descendantClosure', 'profileRoot', 'profileOwner']) {
    const value = cleanup[key];
    Object.defineProperty(cleanup, key, { get() { events.push(key); return value; }, configurable: true });
  }
  let observed;
  const receipt = await runAlphaAcceptance(options, { ...adapters([]), launch: async () => { throw error; }, diagnosticObserver: (event, raw) => {
    events.push(event); observed = raw;
    Object.defineProperty(raw, 'message', { value: 'mutated' });
    raw.nativeCleanup = null;
    return Promise.reject(new Error('contained'));
  } });
  assert.equal(observed, error);
  assert.deepEqual(events, ['descendantClosure', 'profileRoot', 'profileOwner', 'reason-read', 'work-failed']);
  assert.deepEqual(receipt.reasons, ['original reason']);
  assert.equal(receipt.cleanup, 'verified');
  assert.equal(receipt.scenarios[0].status, 'blocked');
  await assert.rejects(readFile(join(options.profileRoot, '.acceptance-running.lock')), { code: 'ENOENT' });
});
