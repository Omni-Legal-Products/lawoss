import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { attestProtectedEngineGuestVersion, provisionProtectedEngineAssets, verifyProtectedEngineAssets } from './protected-engine-assets.mjs';

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

// This uses the real checksum-pinned release, never a mock executable. Guest
// execution/version proof is produced separately by the Docker guest build.
for (const architecture of ['arm64', 'x64']) test(`official ${architecture} archive stages exact bytes and requires genuine guest version proof`, { skip: !process.env.PROTECTED_ENGINE_ARCHIVES }, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'protected-engine-'));
  try {
    const archivePath = join(process.env.PROTECTED_ENGINE_ARCHIVES, `${architecture}.tar.gz`);
    await provisionProtectedEngineAssets({ architecture, destination: directory, archivePath });
    const manifest = await verifyProtectedEngineAssets(directory, { architecture, requireVersionProof: false });
    assert.equal(manifest.binary.sha256, architecture === 'arm64' ? 'e94d9ebec16ce2611eae94026afe8ec87f2e2dcc66db40bc4f889955b026eb75' : 'ca6c0e1f42be3120595bf6848937e7586ec862c87fa7aa111e89c7cc6e9a4650');
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
