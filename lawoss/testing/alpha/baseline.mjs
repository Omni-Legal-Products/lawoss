import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readFile, readdir, readlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { loadAlphaReceipt } from './coverage.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const excluded = new Set(['.alpha-acceptance-baseline.json', '.lawoss-release-acceptance-profile.json', '.acceptance-running.lock', '.alpha-native-app.lock']);
export async function alphaProfileDigest(root) {
  const hash = createHash('sha256');
  let entries = 0, bytes = 0;
  async function visit(directory) {
    for (const name of (await readdir(directory)).sort()) {
      if (directory === root && excluded.has(name)) continue;
      const file = path.join(directory, name), info = await lstat(file);
      if (++entries > 100_000 || (bytes += info.size) > 32 * 1024 ** 3) throw new Error('Historical profile exceeds evidence budget');
      const relative = path.relative(root, file).split(path.sep).join('/');
      if (info.isDirectory()) { hash.update(JSON.stringify([relative, 'directory'])); await visit(file); }
      else if (info.isSymbolicLink()) hash.update(JSON.stringify([relative, 'link', await readlink(file)]));
      else if (info.isFile() && info.nlink === 1) {
        hash.update(JSON.stringify([relative, 'file', info.size]));
        const content = createHash('sha256');
        for await (const chunk of createReadStream(file)) content.update(chunk);
        hash.update(content.digest());
      } else throw new Error('Unsupported historical profile entry');
    }
  }
  await visit(root);
  return hash.digest('hex');
}
async function boundedFile(file) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 64 * 1024 * 1024) throw new Error('Invalid historical alpha evidence file');
  return readFile(file);
}

export async function writeAlphaBaseline(profileRoot, receiptFile) {
  const receipt = await loadAlphaReceipt(receiptFile);
  if (receipt.status !== 'pass' || receipt.profile !== 'fresh') return;
  const bytes = await boundedFile(receiptFile);
  const baseline = { schemaVersion: 1, kind: 'lawoss-alpha-baseline', profileOwner: receipt.profileOwner,
    build: receipt.build, profileSha256: await alphaProfileDigest(profileRoot), receipt: { path: path.resolve(receiptFile), sha256: digest(bytes) } };
  await writeFile(path.join(profileRoot, '.alpha-acceptance-baseline.json'), JSON.stringify(baseline), { mode: 0o600 });
}

export async function verifyAlphaBaseline(profile, build) {
  const baseline = JSON.parse(await boundedFile(path.join(profile.root, '.alpha-acceptance-baseline.json')));
  let historical;
  try { historical = validateBuildInfo(baseline.build); }
  catch { throw new Error('Invalid historical alpha baseline build'); }
  if (baseline.schemaVersion !== 1 || baseline.kind !== 'lawoss-alpha-baseline' || !path.isAbsolute(baseline.receipt?.path ?? '')
    || !/^[a-f0-9]{64}$/.test(baseline.receipt?.sha256 ?? '') || baseline.profileOwner !== profile.migratedFrom?.owner
    || historical.version === build.version || historical.platform !== build.platform || historical.arch !== build.arch)
    throw new Error('Supported historical alpha baseline is not proven');
  const bytes = await boundedFile(baseline.receipt.path);
  if (digest(bytes) !== baseline.receipt.sha256) throw new Error('Historical alpha receipt digest differs');
  const receipt = await loadAlphaReceipt(baseline.receipt.path);
  const paths = build.platform === 'win32' ? path.win32 : path.posix;
  if (receipt.status !== 'pass' || receipt.profile !== 'fresh' || receipt.profileOwner !== baseline.profileOwner
    || paths.relative(profile.migratedFrom.root, receipt.profileRoot ?? '') !== ''
    || Object.keys(historical).some(key => historical[key] !== receipt.build?.[key]))
    throw new Error('Historical alpha evidence identity differs');
  if (await alphaProfileDigest(profile.root) !== baseline.profileSha256) throw new Error('Historical profile bytes differ from verified baseline');
  return receipt;
}
