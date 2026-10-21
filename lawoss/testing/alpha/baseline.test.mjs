import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareAcceptanceProfile, ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { ALPHA_SCENARIOS } from './coverage.mjs';
import { writeAlphaBaseline, verifyAlphaBaseline } from './baseline.mjs';

// These fabricated protocol/image bytes exercise evidence validation only.
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'alpha-baseline-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await prepareAcceptanceProfile({ root: join(root, 'source'), kind: 'fresh' });
  await writeFile(join(source.root, 'history.txt'), 'verified historical state');
  const file = join(root, 'historical.json'), evidence = `${file}.evidence`;
  await mkdir(evidence);
  const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0-alpha.1', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: process.platform, arch: process.arch, channel: 'alpha', workflowRunUrl: '' };
  const receipt = { kind: 'lawoss-private-alpha', releaseEligible: false, status: 'pass', build, assetSha256: '1'.repeat(64), profile: 'fresh',
    profileRoot: source.root, profileOwner: source.owner, cleanup: 'verified', installation: { status: 'verified' }, scenarios: [] };
  const linux = process.platform === 'linux';
  const bytes = linux ? Buffer.alloc(100) : Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(24)]);
  if (linux) bytes.writeUInt32BE(7, 4);
  const executable = process.platform === 'darwin' ? join(root, 'LAWOSS.app/Contents/MacOS/LAWOSS') : join(root, 'installed', process.platform === 'win32' ? 'LAWOSS.exe' : 'legalwork');
  const renderer = process.platform === 'darwin' ? join(root, 'LAWOSS.app/Contents/Resources/app-dist/index.html') : join(root, 'installed/resources/app-dist/index.html');
  const method = { darwin: 'macos-owned-window-screencapture', linux: 'x11-owned-window-xwd', win32: 'windows-owned-window-printwindow' }[process.platform];
  for (const scenario of ALPHA_SCENARIOS) {
    const record = join(evidence, `${scenario}.json`), image = join(evidence, `${scenario}.${linux ? 'xwd' : 'png'}`);
    receipt.scenarios.push({ scenario, status: 'pass', evidence: record });
    await writeFile(image, bytes);
    await writeFile(record, JSON.stringify({ scenario, status: 'pass', profile: { root: source.root, owner: source.owner, kind: 'fresh' },
      observed: { ok: true, build: { ...build, os: process.platform, provenance: 'embedded', legalworkDevMode: false },
        process: { pid: 123, executable, userData: join(source.root, 'userdata') },
        rendererUrl: pathToFileURL(renderer).href,
        snapshot: { ok: true, route: '/welcome', readiness: { documentReadyState: 'complete', bootOverlayVisible: false, interactiveControls: 1 } } },
      capture: { ownerPid: 123, method, format: linux ? 'xwd' : 'png', sha256: createHash('sha256').update(bytes).digest('hex') } }));
  }
  await writeFile(file, JSON.stringify(receipt));
  await writeAlphaBaseline(source.root, file);
  const migrated = join(root, 'migrated');
  await prepareAcceptanceProfile({ root: migrated, kind: 'migrated', migrateFrom: source.root });
  return { root, source, file, migrated, profile: await ownedProfile(migrated), build: { ...build, version: '1.0.0-alpha.2', gitSha: 'b'.repeat(40) } };
}

test('migration verifies pinned historical receipt, every evidence file and copied profile bytes', async t => {
  const f = await fixture(t);
  assert.equal((await verifyAlphaBaseline(f.profile, f.build)).status, 'pass');
  await writeFile(join(f.migrated, 'history.txt'), 'later candidate changed state');
  await assert.rejects(verifyAlphaBaseline(f.profile, f.build), /profile bytes/);
});
test('changed historical receipt or native image invalidates migration proof', async t => {
  const f = await fixture(t), original = await readFile(f.file);
  await writeFile(f.file, `${original}\n`);
  await assert.rejects(verifyAlphaBaseline(f.profile, f.build), /digest/);
  await writeFile(f.file, original);
  await writeFile(`${f.file}.evidence/startup.${process.platform === 'linux' ? 'xwd' : 'png'}`, 'tampered');
  await assert.rejects(verifyAlphaBaseline(f.profile, f.build), /evidence|capture/i);
});
test('a same-version, other-target or other-source baseline cannot satisfy migration', async t => {
  const f = await fixture(t);
  for (const build of [{ ...f.build, version: '1.0.0-alpha.1' }, { ...f.build, arch: process.arch === 'x64' ? 'arm64' : 'x64' }])
    await assert.rejects(verifyAlphaBaseline(f.profile, build), /baseline/);
  f.profile.migratedFrom.owner = 'foreign';
  await assert.rejects(verifyAlphaBaseline(f.profile, f.build), /baseline/);
});
