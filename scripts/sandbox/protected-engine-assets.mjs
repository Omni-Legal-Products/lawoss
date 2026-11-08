/**
 * Build tooling only: installed applications never download an engine.
 *
 * LAWOSS (ADR 0016, MČ 8. 11. 2026): the guest engine is the same LegalWork derivative
 * `2.1.4-legalwork.http-policy.3` the desktop uses, built from source by the reviewed recipe
 * (`packages/opencode-release/build/recipe.json`; `pnpm engine:prepare --target linux-arm64
 * --target linux-x64-baseline`). OpenCode publishes no 2.1.4 GitHub release for it, so nothing is
 * downloaded here: the archive comes from the locally prepared distribution and must match the
 * reviewed archive and binary pins before extraction and after it.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import reviewedPins from '../../apps/server/src/lawoss/protected-ai/engine-pins.json' with {type: 'json'};
export const protectedEngineVersion = reviewedPins.engineVersion;
// One reviewed pin source is shared by build tooling and the packaged loader.
export const protectedEnginePins = Object.freeze(Object.fromEntries(Object.entries(reviewedPins.architectures).map(([arch, pin]) => [arch, Object.freeze(pin)])));
const repository = reviewedPins.repository;
// v2.1.4 LICENSE (identical to v1.18.29 blob 6439474beed8e0271df9862eff97ffd70ec2464c), shipped as LICENSE in the derivative archive.
const licenseText = `MIT License

Copyright (c) 2025 opencode

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
`;
async function sha256(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
/** The prepared derivative distribution (generated/receipt.json), never a network location. */
async function preparedArchive(pin) {
  const explicit = process.env.LAWOSS_PROTECTED_ENGINE_ARCHIVES?.trim();
  if (explicit) return join(explicit, pin.name);
  const receiptPath = new URL('../../packages/opencode-release/generated/receipt.json', import.meta.url);
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8').catch(() => { throw new Error(`Protected engine archive is not prepared; run pnpm engine:prepare --target ${pin.target} first`); }));
  if (typeof receipt.archiveDirectory !== 'string' || !receipt.targets?.includes(pin.target)) throw new Error(`Protected engine archive is not prepared; run pnpm engine:prepare --target ${pin.target} first`);
  return join(receipt.archiveDirectory, pin.name);
}
function pinFor(architecture, version) {
  if (version !== protectedEngineVersion) throw new Error('Unreviewed engine version; review new release asset pins first');
  const pin = Object.hasOwn(protectedEnginePins, architecture) ? protectedEnginePins[architecture] : null;
  if (!pin) throw new Error('Protected engine architecture must be arm64 or x64');
  return pin;
}
async function verifyFile(path, size, digest, label) {
  const info = await lstat(path);
  if (!info.isFile() || info.size !== size || await sha256(path) !== digest) throw new Error(`Protected engine ${label} checksum mismatch`);
}
function identity(architecture, pin) {
  return { schemaVersion: 1, engineVersion: protectedEngineVersion, architecture, repository, releaseId: reviewedPins.releaseId,
    asset: { id: pin.id, name: pin.name, sha256: pin.sha256, size: pin.size },
    binary: { name: 'protected-opencode', sha256: pin.binarySha256, size: pin.binarySize } };
}

export async function verifyProtectedEngineAssets(directory, { architecture, version = protectedEngineVersion, requireVersionProof = true } = {}) {
  const pin = pinFor(architecture, version);
  const manifest = JSON.parse(await readFile(join(directory, 'protected-opencode-manifest.json'), 'utf8'));
  const expected = identity(architecture, pin);
  if (Object.entries(expected).some(([key, value]) => JSON.stringify(manifest[key]) !== JSON.stringify(value))) throw new Error('Protected engine reviewed asset identity mismatch');
  await verifyFile(join(directory, 'protected-opencode'), pin.binarySize, pin.binarySha256, 'binary');
  if (requireVersionProof && (manifest.versionProof?.version !== version || manifest.versionProof?.binarySha256 !== pin.binarySha256 || manifest.versionProof?.environment !== 'linux-bookworm-guest')) throw new Error('Missing or mismatched protected engine guest version proof');
  return manifest;
}

export async function provisionProtectedEngineAssets({ architecture, destination, archivePath, version = protectedEngineVersion }) {
  const pin = pinFor(architecture, version);
  const scratch = await mkdtemp(join(tmpdir(), 'protected-engine-assets-'));
  try {
    archivePath ??= await preparedArchive(pin);
    await verifyFile(archivePath, pin.size, pin.sha256, 'archive');
    // The exact archive is pinned before extraction. Never extract unverified
    // metadata, links or traversal paths; only the fixed reviewed entry is read.
    execFileSync('tar', ['-xzf', archivePath, '-C', scratch, 'opencode'], { timeout: 60000 });
    const binary = join(scratch, 'opencode');
    await verifyFile(binary, pin.binarySize, pin.binarySha256, 'binary');
    const manifest = { ...identity(architecture, pin), versionProof: null };
    await mkdir(destination, { recursive: true });
    const target = join(destination, 'protected-opencode');
    // Rebuilding a measured artifact is supported even when the prior build
    // made its ELF read-only. Never touch that target before source verification.
    await chmod(target, 0o755).catch(error => { if (error.code !== 'ENOENT') throw error; });
    await copyFile(binary, target);
    await chmod(join(destination, 'protected-opencode'), 0o555);
    await writeFile(join(destination, 'protected-opencode-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
    await writeFile(join(destination, 'protected-opencode-sbom.json'), JSON.stringify({
      bomFormat: 'CycloneDX', specVersion: '1.6', version: 1,
      metadata: { component: { type: 'application', name: 'OpenCode', version } },
      components: [{ type: 'application', name: 'OpenCode', version, purl: `pkg:github/anomalyco/opencode@v2.1.4`,
        hashes: [{ alg: 'SHA-256', content: pin.binarySha256 }],
        licenses: [{ license: { id: 'MIT', text: { contentType: 'text/plain', content: licenseText } } }],
        properties: [{ name: 'lawoss:inventory-scope', value: 'LegalWork derivative built from the reviewed recipe; embedded dependency inventory is not provided by this artifact' }],
        externalReferences: [{ type: 'vcs', url: 'https://github.com/anomalyco/opencode/tree/68bc26b7da1990ce10ffecfbc1e09eb13aa5d824' }] }],
    }, null, 2) + '\n');
    return manifest;
  } finally { await rm(scratch, { recursive: true, force: true }); }
}

/** Bind the actual guest-produced stdout/hash, never host-native execution. */
export async function attestProtectedEngineGuestVersion(directory, architecture) {
  const manifest = await verifyProtectedEngineAssets(directory, { architecture, requireVersionProof: false });
  const proof = JSON.parse(await readFile(join(directory, 'protected-opencode-guest-proof.json'), 'utf8'));
  if (proof.version !== manifest.engineVersion || proof.binarySha256 !== manifest.binary.sha256 || proof.environment !== 'linux-bookworm-guest') throw new Error('Protected engine guest version proof mismatch');
  manifest.versionProof = proof;
  await writeFile(join(directory, 'protected-opencode-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  return verifyProtectedEngineAssets(directory, { architecture });
}
