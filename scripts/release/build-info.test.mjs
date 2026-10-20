import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBuildInfo, targetFromTriple, assertReleaseSource } from './build-info.mjs';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
const input = { version: '1.2.3-alpha.1', gitSha: 'a'.repeat(40), buildEpoch: '1792195200', platform: 'darwin', arch: 'x64', channel: 'alpha', workflowRunUrl: 'https://github.com/fixture/lawoss/actions/runs/1' };
test('reject_short_sha and malformed identity', () => {
    assert.throws(() => createBuildInfo({ ...input, gitSha: 'abc1234' }));
    for (const patch of [{ buildEpoch: 'yesterday' }, { arch: 'ia32' }, { platform: 'mac' }, { channel: 'canary' }, { version: '' }, { workflowRunUrl: 'javascript:bad' }, { schemaVersion: 2 }])
        assert.throws(() => createBuildInfo({ ...input, ...patch }));
    assert.equal(createBuildInfo(input).schemaVersion, 1);
});
test('cross_build_uses_target_arch', () => {
    assert.deepEqual(targetFromTriple('x86_64-apple-darwin'), { platform: 'darwin', arch: 'x64' });
    assert.deepEqual(targetFromTriple('aarch64-pc-windows-msvc'), { platform: 'win32', arch: 'arm64' });
    assert.throws(() => targetFromTriple('unrecognized'));
});
test('release source refuses arbitrary package edits and untracked sources', async (t) => {
    const root = await mkdtemp(join(tmpdir(), 'build-source-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(root, 'package.json'), JSON.stringify({ version: '0.0.0', name: 'fixture' }));
    git('add', '.');
    git('commit', '-qm', 'fixture');
    assertReleaseSource(root, '1.2.3');
    await writeFile(join(root, 'untracked.mjs'), 'changed source');
    assert.throws(() => assertReleaseSource(root, '1.2.3'), /source/i);
});
test('dirty development packaging cannot claim its HEAD as embedded provenance', async (t) => {
    const { writeBuildInfoForCheckout } = await import('./build-info.mjs');
    const root = await mkdtemp(join(tmpdir(), 'dirty-build-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git('init', '-q');
    git('config', 'user.name', 'Fixture');
    git('config', 'user.email', 'fixture@example.invalid');
    await writeFile(join(root, 'entry.mjs'), 'original');
    git('add', '.');
    git('commit', '-qm', 'fixture');
    await writeFile(join(root, 'entry.mjs'), 'changed');
    assert.equal(writeBuildInfoForCheckout({ root, out: join(root, 'build-info.json'), version: '0.0.0', platform: 'darwin', arch: 'arm64', channel: 'stable', release: false }), null);
});
