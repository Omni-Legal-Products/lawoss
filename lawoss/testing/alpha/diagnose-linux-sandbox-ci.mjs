#!/usr/bin/env node
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { access, lstat, open } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const kind = 'lawoss-ci-linux-sandbox-diagnostic';
async function boundedText(file, maximum) {
  const handle = await open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const buffer = Buffer.alloc(maximum + 1), { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maximum) throw new Error('unavailable');
    return buffer.subarray(0, bytesRead).toString('utf8');
  } finally { await handle.close(); }
}
async function diagnose() {
  const { validateBuildInfo } = await import('../../../apps/desktop/electron/build-info.mjs');
  const { startupAssetName } = await import('./probe-startup-ci.mjs');
  const { withExtractedAlphaArtifact } = await import('./installed-artifact.mjs');
  const repo = fileURLToPath(new URL('../../../', import.meta.url));
  const build = validateBuildInfo(JSON.parse(await boundedText(join(repo, 'apps/desktop/resources/build-info.json'), 16384)));
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  const source = JSON.parse(await boundedText(join(repo, 'apps/desktop/package.json'), 65536));
  if (build.gitSha !== head || build.version !== source.version || build.platform !== process.platform || build.arch !== process.arch) throw new Error('unavailable');
  const asset = join(repo, 'apps/desktop/dist-electron', startupAssetName(build.platform, build.arch, build.version));
  if (!(await lstat(asset)).isFile()) throw new Error('unavailable');
  const hash = createHash('sha256');for await (const bytes of createReadStream(asset)) hash.update(bytes);
  const assetSha256 = hash.digest('hex');
  const facts = await withExtractedAlphaArtifact({ platform: build.platform, arch: build.arch, asset, expectedSha256: assetSha256 }, async loan => {
    const payload = dirname(loan.installedApp);
    const embedded = validateBuildInfo(JSON.parse(await boundedText(join(payload, 'resources/build-info.json'), 16384)));
    if (Object.keys(build).some(key => embedded[key] !== build[key])) throw new Error('unavailable');
    let info;
    try { info = await lstat(join(payload, 'chrome-sandbox')); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    const physicalFile = info?.isFile() === true && !info.isSymbolicLink();
    const helper = { physicalFile, rootOwned: physicalFile ? info.uid === 0 : null,
      setuid: physicalFile ? Boolean(info.mode & 0o4000) : null, ownerExecute: physicalFile ? Boolean(info.mode & 0o100) : null,
      otherExecute: physicalFile ? Boolean(info.mode & 0o001) : null, xOk: physicalFile ? await access(join(payload, 'chrome-sandbox'), constants.X_OK).then(() => true, () => false) : null };
    const kernel = {};
    for (const [name, file] of [
      ['userMaxUserNamespacesPositive', '/proc/sys/user/max_user_namespaces'],
      ['unprivilegedUsernsCloneEnabled', '/proc/sys/kernel/unprivileged_userns_clone'],
      ['apparmorRestrictUnprivilegedUsernsEnabled', '/proc/sys/kernel/apparmor_restrict_unprivileged_userns'],
    ]) {
      try { const value = (await boundedText(file, 64)).trim();kernel[name] = /^\d+$/.test(value) ? BigInt(value) > 0n : null; }
      catch { kernel[name] = null; }
    }
    const probe = spawnSync('/usr/bin/unshare', ['-Ur', '/usr/bin/true'], { timeout: 2000, maxBuffer: 4096,
      env: { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }, stdio: ['ignore', 'pipe', 'pipe'] });
    const result = probe.error?.code === 'ETIMEDOUT' ? 'timed-out' : ['ENOENT', 'EACCES', 'EPERM'].includes(probe.error?.code) ? 'unavailable'
      : !probe.error && !probe.signal && probe.status === 0 ? 'permitted' : 'failed';
    return { helper, kernel, namespaceProbe: { result, context: 'separate-unshare-process-not-app-grant' } };
  });
  return { kind, status: 'observed', build: { platform: build.platform, arch: build.arch, gitSha: build.gitSha, version: build.version },
    assetSha256, ...facts, extractionCleanup: 'completed' };
}

if (process.platform !== 'linux' || !['x64', 'arm64'].includes(process.arch) || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted') {
  console.log(JSON.stringify({ kind, status: 'refused', reason: 'native-hosted-linux-required' }));
  process.exitCode = 2;
} else {
  try { console.log(JSON.stringify(await diagnose())); }
  catch { console.log(JSON.stringify({ kind, status: 'unavailable', reason: 'diagnostic-unavailable' }));process.exitCode = 1; }
}
