/**
 * Coordinator tooling only (MČ 8. 11. 2026): prepares the GitHub release that carries the exact
 * reviewed guest engine archives. It never creates the release, uploads or pushes anything.
 *
 *   node scripts/sandbox/prepare-protected-engine-release.mjs <archive-directory> [--out <directory>]
 *
 * Every pinned archive is verified against engine-pins.json (size and SHA-256), then its fixed
 * `opencode` entry is extracted and verified against the pinned binary size and SHA-256 by the same
 * code path CI uses. With --out, SHA256SUMS and release notes are written there (a new, empty or
 * absent directory); the printed `gh release create` command uploads exactly those files.
 */
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { protectedEnginePins, protectedEngineRelease, protectedEngineReleaseUrl, protectedEngineVersion, provisionProtectedEngineAssets } from './protected-engine-assets.mjs';
import reviewedPins from '../../apps/server/src/lawoss/protected-ai/engine-pins.json' with {type: 'json'};

const { values, positionals } = parseArgs({ allowPositionals: true, options: { out: { type: 'string' } } });
if (positionals.length !== 1) throw new Error('Usage: prepare-protected-engine-release.mjs <archive-directory> [--out <directory>]');
const archives = resolve(positionals[0]);
const sha256 = async (path) => {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
};
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

const rows = [];
for (const [architecture, pin] of Object.entries(protectedEnginePins)) {
  const path = join(archives, pin.name);
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`${pin.name} must be a regular file`);
  const digest = await sha256(path);
  if (info.size !== pin.size || digest !== pin.sha256) throw new Error(`${pin.name} does not match engine-pins.json (size ${info.size}, sha256 ${digest})`);
  const staged = await mkdtemp(join(tmpdir(), 'protected-engine-release-'));
  try {
    // Same admission as CI: exact archive bytes, then the fixed extracted binary.
    const manifest = await provisionProtectedEngineAssets({ architecture, destination: staged, archivePath: path });
    rows.push({ architecture, target: pin.target, path, name: pin.name, size: info.size, sha256: digest, binarySha256: manifest.binary.sha256, binarySize: manifest.binary.size });
  } finally { await rm(staged, { recursive: true, force: true }); }
}

const sums = rows.map((row) => `${row.sha256}  ${row.name}`).join('\n') + '\n';
const notes = [
  `Exact guest engine archives for the protected document VM (LegalWork derivative ${protectedEngineVersion}).`,
  '',
  `Source: ${reviewedPins.source}`,
  `Recipe: ${reviewedPins.releaseId}`,
  '',
  '| Target | Archive | Size | SHA-256 | Binary SHA-256 |',
  '|---|---|---|---|---|',
  ...rows.map((row) => `| ${row.target} | ${row.name} | ${row.size} | ${row.sha256} | ${row.binarySha256} |`),
  '',
  'CI downloads these assets by name and refuses any size or SHA-256 other than apps/server/src/lawoss/protected-ai/engine-pins.json.',
  'Not a LAWOSS application release.',
  '',
].join('\n');

const files = rows.map((row) => row.path);
if (values.out) {
  const out = resolve(values.out);
  await mkdir(out, { recursive: true });
  if ((await readdir(out)).length) throw new Error('--out must be a new or empty directory');
  await writeFile(join(out, 'SHA256SUMS'), sums, { flag: 'wx' });
  await writeFile(join(out, 'release-notes.md'), notes, { flag: 'wx' });
  files.push(join(out, 'SHA256SUMS'));
}

console.log(`Release: ${protectedEngineRelease.repository} ${protectedEngineRelease.tag}`);
for (const row of rows) console.log(`${row.sha256}  ${row.size}  ${row.name}  (${row.target}; binary ${row.binarySha256} ${row.binarySize})`);
console.log('\nDownload URLs verified by CI:');
for (const [, pin] of Object.entries(protectedEnginePins)) console.log(`  ${protectedEngineReleaseUrl(pin)}`);
console.log('\nSHA256SUMS:\n' + sums);
console.log('Coordinator command (not executed by this script):');
console.log([
  'gh release create', quote(protectedEngineRelease.tag), '--repo', quote(protectedEngineRelease.repository),
  '--title', quote(`Protected guest engine ${protectedEngineVersion}`), '--latest=false', '--prerelease',
  values.out ? `--notes-file ${quote(join(resolve(values.out), 'release-notes.md'))}` : `--notes ${quote(notes)}`,
  ...files.map(quote),
].join(' '));
