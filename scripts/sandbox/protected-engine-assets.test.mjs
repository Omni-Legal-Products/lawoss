import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attestProtectedEngineGuestVersion, protectedEnginePins, protectedEngineRelease, protectedEngineReleaseUrl, provisionProtectedEngineAssets, verifyProtectedEngineAssets } from './protected-engine-assets.mjs';

test('untrusted archive fails before replacing an existing measured engine', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'protected-engine-'));
  try {
    const archivePath = join(directory, 'untrusted.tar.gz');
    await writeFile(archivePath, 'untrusted archive');
    await writeFile(join(directory, 'protected-opencode'), 'existing engine');
    await assert.rejects(provisionProtectedEngineAssets({ architecture: 'arm64', destination: directory, archivePath }), /archive checksum mismatch/);
    assert.equal(await readFile(join(directory, 'protected-opencode'), 'utf8'), 'existing engine');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('the reviewed archive comes from the LAWOSS release, never the upstream repository', () => {
  assert.deepEqual({ ...protectedEngineRelease }, { repository: 'Omni-Legal-Products/lawoss', tag: 'opencode-v2.1.4-legalwork.http-policy.4-lawoss.1' });
  for (const pin of Object.values(protectedEnginePins)) {
    assert.equal(protectedEngineReleaseUrl(pin), `https://github.com/Omni-Legal-Products/lawoss/releases/download/opencode-v2.1.4-legalwork.http-policy.4-lawoss.1/${pin.name}`);
  }
});

test('a release download follows only GitHub redirects and fails the pinned checksum before extraction', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'protected-engine-'));
  try {
    await writeFile(join(directory, 'protected-opencode'), 'existing engine');
    const requested = [];
    const redirectTo = (location) => async (url) => {
      requested.push(String(url));
      return String(url).startsWith('https://github.com/') ? new Response(null, { status: 302, headers: { location } }) : new Response('untrusted archive', { status: 200 });
    };
    await assert.rejects(provisionProtectedEngineAssets({ architecture: 'arm64', destination: directory, fetchImpl: redirectTo('https://release-assets.githubusercontent.com/asset') }), /archive checksum mismatch/);
    assert.deepEqual(requested, [protectedEngineReleaseUrl(protectedEnginePins.arm64), 'https://release-assets.githubusercontent.com/asset']);
    requested.length = 0;
    await assert.rejects(provisionProtectedEngineAssets({ architecture: 'arm64', destination: directory, fetchImpl: redirectTo('https://mirror.example/asset') }), /left the reviewed GitHub hosts/);
    assert.equal(requested.length, 1);
    await assert.rejects(provisionProtectedEngineAssets({ architecture: 'x64', destination: directory, fetchImpl: async () => new Response('missing', { status: 404 }) }), /unavailable \(404\)/);
    assert.equal(await readFile(join(directory, 'protected-opencode'), 'utf8'), 'existing engine');
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('an engine version outside the reviewed pin cannot be provisioned', async () => {
  await assert.rejects(provisionProtectedEngineAssets({ architecture: 'arm64', destination: tmpdir(), version: '2.0.0' }), /reviewed engine version/);
});

test('measured metadata cannot authorize an arbitrary replacement binary', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'protected-engine-'));
  try {
    await writeFile(join(directory, 'protected-opencode-manifest.json'), JSON.stringify({ schemaVersion: 1, engineVersion: '1.18.29', architecture: 'arm64', binary: { sha256: '0'.repeat(64) } }));
    await writeFile(join(directory, 'protected-opencode'), 'replacement');
    await assert.rejects(verifyProtectedEngineAssets(directory, { architecture: 'arm64' }), /reviewed asset identity/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

// This uses the real checksum-pinned derivative archive, never a mock executable. Guest
// execution/version proof is produced separately by the Docker guest build.
for (const architecture of ['arm64', 'x64']) test(`official ${architecture} archive stages exact bytes and requires genuine guest version proof`, { skip: !process.env.PROTECTED_ENGINE_ARCHIVES }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'protected-engine-'));
  try {
    const archivePath = join(process.env.PROTECTED_ENGINE_ARCHIVES, protectedEnginePins[architecture].name);
    await provisionProtectedEngineAssets({ architecture, destination: directory, archivePath });
    const manifest = await verifyProtectedEngineAssets(directory, { architecture, requireVersionProof: false });
    assert.equal(manifest.binary.sha256, protectedEnginePins[architecture].binarySha256);
    await assert.rejects(verifyProtectedEngineAssets(directory, { architecture }), /guest version proof/);
    await assert.rejects(verifyProtectedEngineAssets(directory, { architecture: architecture === 'arm64' ? 'x64' : 'arm64', requireVersionProof: false }), /reviewed asset identity/);
    await writeFile(join(directory, 'protected-opencode-guest-proof.json'), JSON.stringify({ version: '2.0.0', binarySha256: manifest.binary.sha256, environment: 'linux-bookworm-guest' }));
    await assert.rejects(attestProtectedEngineGuestVersion(directory, architecture), /guest version proof mismatch/);
    await provisionProtectedEngineAssets({ architecture, destination: directory, archivePath });
    assert.equal((await verifyProtectedEngineAssets(directory, { architecture, requireVersionProof: false })).binary.sha256, manifest.binary.sha256);
    await rm(join(directory, 'protected-opencode'));
    await writeFile(join(directory, 'protected-opencode'), 'changed after admission');
    await assert.rejects(verifyProtectedEngineAssets(directory, { architecture, requireVersionProof: false }), /binary checksum mismatch/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
