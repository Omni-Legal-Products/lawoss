import { test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeAlphaCoverage, loadAlphaReceipt } from './coverage.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

const sha = 'a'.repeat(40);
const scenarios = ['startup', 'onboarding', 'native-picker', 'okf', 'document', 'memory', 'client-isolation', 'restart', 'error-recovery', 'ai-state', 'locales'];
const targets = ['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64'];
function receipts() {
  return targets.flatMap(target => ['fresh', 'migrated'].map(profile => {
    const [platform, arch] = target.split('-');
    return { kind: 'lawoss-private-alpha', releaseEligible: false, status: 'pass', build: { gitSha: sha, platform, arch },
      assetSha256: String(targets.indexOf(target) + 1).repeat(64), profile, profileOwner: `${target}-${profile}`,
      profileRoot: platform === 'win32' ? `C:\\alpha\\${target}\\${profile}` : `/alpha/${target}/${profile}`,
      cleanup: 'verified', installation: { status: 'verified', signing: 'not-asserted' },
      scenarios: scenarios.map(scenario => ({ scenario, status: 'pass', evidence: `${target}/${profile}/${scenario}.json` })) };
  }));
}
test('all six targets require both fresh and migrated native alpha receipts', () => {
  const result = summarizeAlphaCoverage(receipts(), sha);
  assert.equal(result.status, 'pass');
  assert.equal(result.targets.length, 6);
  assert.equal(result.completedProfiles, 12);
  assert.equal(result.releaseEligible, false);
});
test('four package targets or fresh profiles alone cannot complete alpha', () => {
  for (const subset of [receipts().slice(0, 8), receipts().filter(x => x.profile === 'fresh')]) {
    const result = summarizeAlphaCoverage(subset, sha);
    assert.equal(result.status, 'blocked');
    assert.ok(result.targets.some(x => x.status === 'blocked'));
  }
});
test('a missing, skipped, failed or blocked journey never counts as a passing profile', () => {
  for (const status of ['blocked', 'not-run', 'skipped', 'fail']) {
    const input = receipts(); input[0].scenarios[0].status = status;
    assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
  }
  const input = receipts(); input[0].scenarios.pop();
  assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
});
test('foreign commits, mismatched profile artifacts and incomplete cleanup cannot satisfy coverage', () => {
  for (const change of [x => x.build.gitSha = 'b'.repeat(40), x => x.assetSha256 = 'b'.repeat(64), x => x.cleanup = 'unknown', x => x.installation.status = 'unverified']) {
    const input = receipts(); change(input[0]);
    assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
  }
});
test('duplicated receipts and a shared fresh/migrated profile owner are rejected', () => {
  const input = receipts();
  assert.equal(summarizeAlphaCoverage([...input, input[0]], sha).status, 'blocked');
  input[1].profileOwner = input[0].profileOwner;
  assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
});
test('a single profile directory cannot satisfy both fresh and migrated coverage', () => {
  const input = receipts(); input[1].profileRoot = input[0].profileRoot;
  assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
});
test('source test or public release records cannot masquerade as private alpha native receipts', () => {
  const input = receipts(); input[0].kind = 'source-tests';
  assert.equal(summarizeAlphaCoverage(input, sha).status, 'blocked');
  assert.throws(() => summarizeAlphaCoverage([], 'not-a-commit'), /commit/);
});

async function evidenceFixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'alpha-evidence-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'receipt.json'), evidenceRoot = `${file}.evidence`;
  await mkdir(evidenceRoot);
  const receipt = receipts()[0];
  receipt.profileRoot = '/owned';
  Object.assign(receipt.build, { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0-alpha.1', buildEpoch: '123', channel: 'alpha', workflowRunUrl: '' });
  const image = Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), Buffer.alloc(24)]);
  const observed = { ok: true, build: { provenance: 'embedded', legalworkDevMode: false, gitSha: sha, os: 'darwin', arch: 'x64', version: '1.0.0-alpha.1', buildEpoch: '123', channel: 'alpha' },
    process: { pid: 123, executable: '/apps/LAWOSS.app/Contents/MacOS/LAWOSS', userData: '/owned/userdata' },
    rendererUrl: 'file:///apps/LAWOSS.app/Contents/Resources/app-dist/index.html', snapshot: { ok: true, route: '/welcome' } };
  for (const result of receipt.scenarios) {
    result.evidence = join(evidenceRoot, `${result.scenario}.json`);
    const capture = { path: join(evidenceRoot, `${result.scenario}.png`), sha256: createHash('sha256').update(image).digest('hex'),
      method: 'macos-owned-window-screencapture', format: 'png', ownerPid: 123 };
    await writeFile(capture.path, image);
    await writeFile(result.evidence, JSON.stringify({ scenario: result.scenario, status: 'pass',
      profile: { root: receipt.profileRoot, owner: receipt.profileOwner, kind: receipt.profile }, observed, capture }));
  }
  await writeFile(file, JSON.stringify(receipt));
  return { root, file, receipt };
}
test('coverage intake checks evidence bytes rather than trusting receipt links', async t => {
  const fixture = await evidenceFixture(t);
  assert.equal((await loadAlphaReceipt(fixture.file)).status, 'pass');
  await writeFile(`${fixture.file}.evidence/startup.png`, 'changed');
  await assert.rejects(loadAlphaReceipt(fixture.file), /capture|evidence/i);
});
test('missing evidence and a synthetic protocol capture cannot become native coverage', async t => {
  const fixture = await evidenceFixture(t);
  const file = `${fixture.file}.evidence/startup.json`;
  await writeFile(file, JSON.stringify({ scenario: 'startup', status: 'pass', capture: { method: 'synthetic-boundary' } }));
  await assert.rejects(loadAlphaReceipt(fixture.file), /capture|evidence|identity/i);
  await rm(file);
  await assert.rejects(loadAlphaReceipt(fixture.file), /ENOENT/);
});
test('fresh evidence cannot be relabelled as an independent migrated profile', async t => {
  const fixture = await evidenceFixture(t);
  fixture.receipt.profile = 'migrated'; fixture.receipt.profileOwner = 'different-owner'; fixture.receipt.profileRoot = '/other';
  await writeFile(fixture.file, JSON.stringify(fixture.receipt));
  await assert.rejects(loadAlphaReceipt(fixture.file), /profile/i);
});
