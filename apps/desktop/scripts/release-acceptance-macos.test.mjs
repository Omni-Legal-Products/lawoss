import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { compareInstalledTree, validateLiveIdentity } from './release-acceptance-macos.mjs';
test('installed bundle must match all final installer bytes and symlink targets', async (t) => { const root = await mkdtemp(join(tmpdir(), 'installed-tree-')); t.after(() => rm(root, { recursive: true, force: true })); const a = join(root, 'a'), b = join(root, 'b'); await mkdir(a); await mkdir(b); for (const p of [a, b]) {
    await writeFile(join(p, 'main'), 'signed bytes');
    await symlink('main', join(p, 'link'));
} await compareInstalledTree(a, b); await writeFile(join(b, 'extra'), 'extra'); await assert.rejects(compareInstalledTree(a, b), /installed|tree/i); await rm(join(b, 'extra')); await writeFile(join(b, 'main'), 'changed'); await assert.rejects(compareInstalledTree(a, b), /installed|bytes/i); });
test('live IPC identity requires the owned PID, profile, final executable and packaged renderer', () => { const expected = { build: { version: '1.2.3', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: 'darwin', arch: 'arm64', channel: 'alpha' }, pid: 123, userData: '/owned/profile', executable: '/installed/LAWOSS.app/Contents/MacOS/LAWOSS', rendererRoot: '/installed/LAWOSS.app/Contents/Resources/app-dist' }; const actual = { ok: true, build: { version: '1.2.3', gitSha: 'a'.repeat(40), buildEpoch: '123', os: 'darwin', arch: 'arm64', channel: 'alpha', provenance: 'embedded', legalworkDevMode: false }, process: { pid: 123, userData: expected.userData, executable: expected.executable }, rendererUrl: 'file:///installed/LAWOSS.app/Contents/Resources/app-dist/index.html', snapshot: { ok: true, route: '/welcome' } }; assert.doesNotThrow(() => validateLiveIdentity(actual, expected)); for (const patch of [{ process: { ...actual.process, pid: 124 } }, { rendererUrl: 'http://localhost:5173' }, { build: { ...actual.build, provenance: 'development' } }, { process: { ...actual.process, userData: '/normal/profile' } }])
    assert.throws(() => validateLiveIdentity({ ...actual, ...patch }, expected)); });
