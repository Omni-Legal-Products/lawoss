import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { assertInteractiveUi } from './native-app.mjs';

export const ALPHA_TARGETS = Object.freeze(['darwin-x64', 'darwin-arm64', 'linux-x64', 'linux-arm64', 'win32-x64', 'win32-arm64']);
export const ALPHA_SCENARIOS = Object.freeze(['startup', 'onboarding', 'native-picker', 'okf', 'document', 'memory', 'client-isolation', 'restart', 'error-recovery', 'ai-state', 'locales']);

export async function loadAlphaReceipt(file) {
  const readOwned = async filename => {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error('Invalid alpha evidence file');
    return readFile(filename);
  };
  const receipt = JSON.parse(await readOwned(file));
  if (receipt.status !== 'pass') return receipt;
  validateBuildInfo(receipt.build);
  const directory = await lstat(`${file}.evidence`);
  if (!directory.isDirectory() || directory.isSymbolicLink()) throw new Error('Invalid alpha evidence directory');
  const platform = receipt.build?.platform;
  const captureMethod = { darwin: ['macos-owned-window-screencapture', 'png'], linux: ['x11-owned-window-xwd', 'xwd'], win32: ['windows-owned-window-printwindow', 'png'] }[platform];
  if (!captureMethod || !passingProfile(receipt, receipt.build.gitSha)) throw new Error('Incomplete native alpha evidence');
  for (const scenario of ALPHA_SCENARIOS) {
    const evidence = JSON.parse(await readOwned(`${file}.evidence/${scenario}.json`));
    const { observed, capture } = evidence;
    if (evidence.profile?.root !== receipt.profileRoot || evidence.profile.owner !== receipt.profileOwner || evidence.profile.kind !== receipt.profile)
      throw new Error('Native evidence profile differs');
    if (evidence.scenario !== scenario || evidence.status !== 'pass' || !capture || capture.method !== captureMethod[0] || capture.format !== captureMethod[1]
      || !Number.isSafeInteger(capture.ownerPid) || capture.ownerPid <= 0 || capture.ownerPid !== observed?.process?.pid)
      throw new Error('Invalid native capture evidence');
    const live = observed.build;
    assertInteractiveUi(observed.snapshot);
    if (observed.ok !== true || live?.provenance !== 'embedded' || live.legalworkDevMode !== false || live.gitSha !== receipt.build.gitSha
      || live.os !== platform || live.arch !== receipt.build.arch || observed.snapshot?.ok !== true || typeof observed.snapshot.route !== 'string')
      throw new Error('Native evidence identity differs');
    for (const key of ['version', 'buildEpoch', 'channel']) if (receipt.build[key] !== live[key]) throw new Error('Native evidence identity differs');
    const paths = platform === 'win32' ? path.win32 : path.posix;
    const executable = observed.process.executable;
    if (!paths.isAbsolute(executable ?? '') || !paths.isAbsolute(observed.process.userData ?? '')) throw new Error('Invalid native evidence process');
    if (paths.relative(paths.join(receipt.profileRoot, 'userdata'), observed.process.userData) !== '') throw new Error('Native evidence profile root differs');
    const rendererRoot = paths.resolve(paths.dirname(executable), platform === 'darwin' ? '../Resources/app-dist' : 'resources/app-dist');
    const renderer = fileURLToPath(observed.rendererUrl, { windows: platform === 'win32' });
    const relative = paths.relative(rendererRoot, renderer);
    if (!relative || paths.isAbsolute(relative) || relative === '..' || relative.startsWith(`..${paths.sep}`)) throw new Error('Native evidence renderer differs');
    const image = await readOwned(`${file}.evidence/${scenario}.${captureMethod[1]}`);
    const validImage = captureMethod[1] === 'png' ? image.length >= 24 && image.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
      : image.length >= 100 && image.readUInt32BE(4) === 7;
    if (!validImage || createHash('sha256').update(image).digest('hex') !== capture.sha256) throw new Error('Native capture evidence bytes differ');
  }
  return receipt;
}

function passingProfile(receipt, gitSha) {
  return receipt?.kind === 'lawoss-private-alpha' && receipt.releaseEligible === false && receipt.status === 'pass'
    && receipt.build?.gitSha === gitSha && /^[a-f0-9]{64}$/.test(receipt.assetSha256 ?? '')
    && typeof receipt.profileOwner === 'string' && receipt.profileOwner.length > 0
    && (receipt.build.platform === 'win32' ? path.win32 : path.posix).isAbsolute(receipt.profileRoot ?? '')
    && receipt.cleanup === 'verified' && receipt.installation?.status === 'verified'
    && Array.isArray(receipt.scenarios) && ALPHA_SCENARIOS.every(scenario => {
      const results = receipt.scenarios.filter(item => item.scenario === scenario);
      return results.length === 1 && results[0].status === 'pass' && typeof results[0].evidence === 'string' && results[0].evidence.length > 0;
    });
}

export function summarizeAlphaCoverage(receipts, gitSha) {
  if (!/^[a-f0-9]{40}$/.test(gitSha ?? '')) throw new Error('Expected the exact candidate commit');
  if (!Array.isArray(receipts)) throw new Error('Expected native alpha receipts');
  let completedProfiles = 0;
  const targets = ALPHA_TARGETS.map(target => {
    const candidates = receipts.filter(receipt => `${receipt?.build?.platform}-${receipt?.build?.arch}` === target);
    const profiles = ['fresh', 'migrated'].map(profile => {
      const results = candidates.filter(receipt => receipt.profile === profile);
      const receipt = results[0];
      const passed = results.length === 1 && passingProfile(receipt, gitSha);
      return { profile, status: passed ? 'pass' : 'blocked', assetSha256: receipt?.assetSha256 ?? null, owner: receipt?.profileOwner ?? null, root: receipt?.profileRoot ?? null };
    });
    const sameArtifact = profiles[0].assetSha256 === profiles[1].assetSha256;
    const separateOwners = profiles[0].owner !== profiles[1].owner;
    const paths = target.startsWith('win32-') ? path.win32 : path.posix;
    const separateRoots = profiles.every(profile => typeof profile.root === 'string') && paths.relative(profiles[0].root, profiles[1].root) !== '';
    if (!sameArtifact || !separateOwners || !separateRoots) for (const profile of profiles) profile.status = 'blocked';
    completedProfiles += profiles.filter(profile => profile.status === 'pass').length;
    return { target, status: profiles.every(profile => profile.status === 'pass') ? 'pass' : 'blocked', profiles };
  });
  return { kind: 'lawoss-private-alpha-coverage', gitSha, releaseEligible: false,
    status: targets.every(target => target.status === 'pass') ? 'pass' : 'blocked', completedProfiles, targets };
}
