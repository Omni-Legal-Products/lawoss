#!/usr/bin/env node
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { ALPHA_SCENARIOS, summarizeAlphaCoverage, loadAlphaReceipt } from './coverage.mjs';

const instructions = {
  onboarding: 'Complete Ty → AI (skip) → Folder on synthetic data; verify no provider fallback.',
  'native-picker': 'Cancel the native folder picker with zero writes, reopen it and select the synthetic folder.',
  okf: 'Preview and confirm a synthetic client and matter; verify visible names and resulting file bytes.',
  document: 'Open a synthetic document in its matter, verify its contents and provenance; ask about it using only an explicitly selected test provider.',
  memory: 'Save synthetic matter memory; open a new conversation and verify the correct memory is used.',
  'client-isolation': 'Use distinct synthetic clients and verify no cross-client document, folder or memory access.',
  restart: 'After this measured restart, verify the same client, matter, memory and settings.',
  'error-recovery': 'Exercise a missing client directory and provider failure, then restore them; verify an explicit error and correct recovery.',
  'ai-state': 'Verify skip-AI, missing/invalid provider and both declared AI boundary states; no silent model substitution.',
  locales: 'Verify Czech and Slovak UI, native dialogs, errors and persisted selection after switching.',
};
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function runAlphaAcceptance(options, adapters = {}) {
  const { installedApp, asset, expectedSha256, profileRoot, profileKind, output, manual = false, operator = '' } = options;
  const build = validateBuildInfo(options.build);
  if (!['fresh', 'migrated'].includes(profileKind)) throw new Error('Expected fresh or migrated profile kind');
  if (!/^[a-f0-9]{64}$/.test(expectedSha256 ?? '')) throw new Error('Expected a pinned installer SHA-256');
  const profile = await ownedProfile(profileRoot, profileKind);
  const evidenceRoot = `${resolve(output)}.evidence`;
  if (!(await lstat(dirname(resolve(output)))).isDirectory()) throw new Error('Evidence parent must exist');
  const lease = join(profileRoot, '.acceptance-running.lock');
  const owner = JSON.stringify({ owner: profile.owner, pid: process.pid, token: randomUUID() });
  await writeFile(lease, owner, { flag: 'wx', mode: 0o600 });
  let app, reader, cleanup = 'not-started';
  let installation = { status: 'unverified', signing: 'not-asserted' };
  const scenarios = ALPHA_SCENARIOS.map(scenario => ({ scenario, status: 'blocked', evidence: null }));
  const reasons = [];
  try {
    await mkdir(evidenceRoot, { mode: 0o700 });
    if (build.platform !== process.platform || build.arch !== process.arch) throw new Error('Target host unavailable');
    if (profileKind === 'migrated') {
      const baseline = JSON.parse(await readFile(join(profileRoot, '.alpha-acceptance-baseline.json'), 'utf8'));
      if (baseline.status !== 'pass' || baseline.profileOwner !== profile.migratedFrom?.owner || baseline.build?.version === build.version)
        throw new Error('Supported old synthetic profile baseline is not proven');
    }
    const verifyInstallation = adapters.verifyInstallation ?? (await import('./installed-artifact.mjs')).verifyAlphaInstallation;
    const launch = adapters.launch ?? (await import('./native-app.mjs')).launchAlphaApp;
    installation = await verifyInstallation({ platform: build.platform, arch: build.arch, asset, installedApp, expectedSha256 });
    if (installation?.status !== 'verified') throw new Error('Installation integrity was not verified');
    cleanup = 'unverified';
    app = await launch({ installedApp, profileRoot, build });
    if (manual && process.stdin.isTTY && process.stdout.isTTY && operator.trim())
      reader = createInterface({ input: process.stdin, output: process.stdout });
    for (const result of scenarios) {
      if (result.scenario === 'restart' && reader) {
        await app.stop(); app = null;
        app = await launch({ installedApp, profileRoot, build });
      }
      let status = result.scenario === 'startup' ? 'pass' : 'blocked';
      if (reader && result.scenario !== 'startup') {
        const answer = await reader.question(`\n${result.scenario}: ${instructions[result.scenario]}\nAfter exercising it, record pass, fail or blocked: `);
        status = ['pass', 'fail', 'blocked'].includes(answer.trim()) ? answer.trim() : 'blocked';
      }
      const observed = await app.observe();
      let capture = null;
      if (status === 'pass') {
        capture = await app.capture(join(evidenceRoot, `${result.scenario}.${process.platform === 'linux' ? 'xwd' : 'png'}`));
        if (capture.ownerPid !== app.pid || digest(await readFile(capture.path)) !== capture.sha256)
          throw new Error('Owned window capture evidence differs');
      }
      const evidence = join(evidenceRoot, `${result.scenario}.json`);
      await writeFile(evidence, JSON.stringify({ scenario: result.scenario, status, operator: reader ? operator : null,
        profile: { root: profile.root, owner: profile.owner, kind: profile.kind }, observed, capture }, null, 2), { flag: 'wx', mode: 0o600 });
      Object.assign(result, { status, evidence });
    }
  } catch (error) {
    reasons.push(error instanceof Error ? error.message : 'Native alpha verification failed');
  } finally {
    reader?.close();
    if (app) {
      try { await app.stop(); cleanup = 'verified'; }
      catch { cleanup = 'unverified'; reasons.push('Owned process cleanup could not be verified'); }
    }
    if (cleanup !== 'unverified' && await readFile(lease, 'utf8') === owner) await rm(lease);
  }
  const status = cleanup === 'verified' && !reasons.length && scenarios.every(result => result.status === 'pass') ? 'pass'
    : scenarios.some(result => result.status === 'fail') ? 'fail' : 'blocked';
  const receipt = { kind: 'lawoss-private-alpha', releaseEligible: false, status, build, assetSha256: expectedSha256,
    profile: profileKind, profileRoot: profile.root, profileOwner: profile.owner, installation, cleanup, scenarios, reasons, at: new Date().toISOString() };
  await writeFile(output, `${JSON.stringify(receipt, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  if (status === 'pass') await writeFile(join(profileRoot, '.alpha-acceptance-baseline.json'), JSON.stringify(receipt), { mode: 0o600 });
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const args = process.argv.slice(2);
    if (args[0] === 'coverage') {
      const [gitSha, ...files] = args.slice(1);
      const receipts = await Promise.all(files.map(loadAlphaReceipt));
      const result = summarizeAlphaCoverage(receipts, gitSha);
      console.log(JSON.stringify(result, null, 2)); process.exitCode = result.status === 'pass' ? 0 : 2;
    } else {
      const value = flag => { const index = args.indexOf(flag); if (index < 0 || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`Required ${flag}`); return args[index + 1]; };
      const receipt = await runAlphaAcceptance({ installedApp: resolve(value('--installed-app')), asset: resolve(value('--asset')),
        expectedSha256: value('--sha256'), build: JSON.parse(await readFile(value('--build-info'), 'utf8')), profileRoot: resolve(value('--profile')),
        profileKind: value('--profile-kind'), output: resolve(value('--output')), manual: args.includes('--manual'), operator: args.includes('--operator') ? value('--operator') : '' });
      console.log(JSON.stringify({ status: receipt.status, releaseEligible: false, reasons: receipt.reasons }));
      process.exitCode = receipt.status === 'pass' ? 0 : receipt.status === 'fail' ? 1 : 2;
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
