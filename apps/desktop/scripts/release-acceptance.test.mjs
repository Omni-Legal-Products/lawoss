import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readlink, rm, writeFile, mkdir, symlink, readdir } from 'node:fs/promises';
import { join, posix, win32 } from 'node:path';
import { tmpdir } from 'node:os';
import { runReleaseAcceptance, prepareAcceptanceProfile, validateNativeObservation, assertSeparateProfileRoots } from './release-acceptance.mjs';
import { createReleaseEvidence, REQUIRED_NATIVE_SCENARIOS, sha256 } from '../../../scripts/release/release-evidence.mjs';
const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: 'darwin', arch: 'arm64', channel: 'stable', workflowRunUrl: 'https://example.invalid/build' };
async function fixture(t) { const root = await mkdtemp(join(tmpdir(), 'native-acceptance-')); t.after(() => rm(root, { recursive: true, force: true })); const asset = join(root, 'lawoss-mac-arm64-1.2.3.dmg'); await writeFile(asset, 'final'); const evidence = createReleaseEvidence({ build, releaseTag: 'v1.2.3', assets: [{ name: 'lawoss-mac-arm64-1.2.3.dmg', size: 5, sha256: sha256('final') }], receipts: [], signing: { status: 'unverified', evidenceUrl: null }, acceptance: [] }); return { root, asset, evidence, profileKind: 'fresh', profileRoot: join(root, 'owned'), installedApp: join(root, 'LAWOSS.app'), output: join(root, 'receipt.json') }; }
test('refuses_normal_profile', async (t) => { const opts = await fixture(t); await mkdir(opts.profileRoot); await assert.rejects(runReleaseAcceptance(opts), /owned|profile/i); });
test('wrong_installer_digest', async (t) => { const opts = await fixture(t); await prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'fresh' }); await writeFile(opts.asset, 'changed'); await assert.rejects(runReleaseAcceptance(opts), /digest|bytes/i); });
test('different_running_build', () => { assert.throws(() => validateNativeObservation({ build: { ...build, gitSha: 'b'.repeat(40) }, profileKind: 'fresh', assetSha256: sha256('final'), legalworkDevMode: false }, { build, profileKind: 'fresh', assetSha256: sha256('final') }), /build/i); });
test('timeout_or_missing_native_case_fails', () => { assert.throws(() => validateNativeObservation({ build, profileKind: 'fresh', assetSha256: sha256('final'), legalworkDevMode: false, scenarios: [] }, { build, profileKind: 'fresh', assetSha256: sha256('final') }), /native|scenario/i); });
test('migrated_case_cannot_reuse_fresh_receipt', () => { assert.throws(() => validateNativeObservation({ build, profileKind: 'fresh', assetSha256: sha256('final'), legalworkDevMode: false, scenarios: REQUIRED_NATIVE_SCENARIOS.map(scenario => ({ scenario, status: 'pass' })) }, { build, profileKind: 'migrated', assetSha256: sha256('final') }), /profile/i); });
test('uninstalled fixture writes blocked receipt and never reports runtime pass', async (t) => { const opts = await fixture(t); await prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'fresh' }); const resources = join(opts.installedApp, 'Contents/Resources'); await mkdir(resources, { recursive: true }); await writeFile(join(resources, 'build-info.json'), JSON.stringify(build)); const result = await runReleaseAcceptance(opts); assert.equal(result.status, 'blocked'); assert.equal(JSON.parse(await readFile(opts.output, 'utf8')).profile, 'fresh'); assert.ok(result.acceptance.every(x => x.status === 'blocked')); });
test('migrated synthetic copy preserves original and has independent owner', async (t) => { const opts = await fixture(t); const original = join(opts.root, 'old'); await prepareAcceptanceProfile({ root: original, kind: 'fresh' }); await writeFile(join(original, 'synthetic.txt'), 'original'); await prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'migrated', migrateFrom: original }); await writeFile(join(opts.profileRoot, 'synthetic.txt'), 'copy'); assert.equal(await readFile(join(original, 'synthetic.txt'), 'utf8'), 'original'); });

test('migration refuses a profile leased by the direct native diagnostic launcher', async t => {
    const opts = await fixture(t), source = join(opts.root, 'old');
    await prepareAcceptanceProfile({ root: source, kind: 'fresh' });
    await writeFile(join(source, '.alpha-native-app.lock'), 'active native diagnostic');
    await assert.rejects(prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'migrated', migrateFrom: source }), /running profile/);
    await assert.rejects(readFile(join(opts.profileRoot, '.lawoss-release-acceptance-profile.json')), { code: 'ENOENT' });
});

test('migration preserves safe relative links inside the independent copy', { skip: process.platform === 'win32' }, async t => {
    const opts = await fixture(t), source = join(opts.root, 'old');
    await prepareAcceptanceProfile({ root: source, kind: 'fresh' });
    await mkdir(join(source, 'data')); await writeFile(join(source, 'data', 'state'), 'original');
    await symlink('data', join(source, 'alias'));
    await prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'migrated', migrateFrom: source });
    assert.equal(await readlink(join(opts.profileRoot, 'alias')), 'data');
    await writeFile(join(opts.profileRoot, 'alias', 'state'), 'copy');
    assert.equal(await readFile(join(source, 'data', 'state'), 'utf8'), 'original');
});

test('migration rejects an absolute source link before creating the target', { skip: process.platform === 'win32' }, async t => {
    const opts = await fixture(t), source = join(opts.root, 'old');
    await prepareAcceptanceProfile({ root: source, kind: 'fresh' });
    await mkdir(join(source, 'data')); await symlink(join(source, 'data'), join(source, 'alias'));
    await assert.rejects(prepareAcceptanceProfile({ root: opts.profileRoot, kind: 'migrated', migrateFrom: source }), /migration.*link/i);
    await assert.rejects(readFile(join(opts.profileRoot, '.lawoss-release-acceptance-profile.json')), { code: 'ENOENT' });
});
test('refuses a symlinked target parent before creating a profile', async (t) => {
    const opts = await fixture(t);
    const physical = join(opts.root, 'physical'), alias = join(opts.root, 'alias');
    await mkdir(physical);
    await symlink(physical, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareAcceptanceProfile({ root: join(alias, 'profile'), kind: 'fresh' }), /parent|symbolic|symlink/i);
    assert.deepEqual(await readdir(physical), []);
});
test('refuses migration through an ancestor alias into its source before copying', async (t) => {
    const opts = await fixture(t);
    const source = join(opts.root, 'source'), alias = join(opts.root, 'alias');
    await prepareAcceptanceProfile({ root: source, kind: 'fresh' });
    await mkdir(join(source, 'child'));
    await writeFile(join(source, 'original.txt'), 'unchanged');
    await symlink(source, alias, process.platform === 'win32' ? 'junction' : 'dir');
    await assert.rejects(prepareAcceptanceProfile({ root: join(alias, 'child', 'migrated'), kind: 'migrated', migrateFrom: source }), /separate/i);
    assert.deepEqual(await readdir(join(source, 'child')), []);
    assert.equal(await readFile(join(source, 'original.txt'), 'utf8'), 'unchanged');
});
test('migration roots must be disjoint under POSIX and Windows path semantics', () => {
    for (const [paths, source, target] of [
        [posix, '/owned/profile', '/owned/profile'],
        [posix, '/owned/profile', '/owned/profile/child'],
        [posix, '/owned/profile/child', '/owned/profile'],
        [win32, 'C:\\owned\\profile', 'c:/OWNED/profile/child'],
        [win32, 'C:\\owned\\profile\\child', 'c:/owned/profile'],
        [win32, '\\\\host\\share\\profile', '\\\\HOST\\SHARE\\PROFILE\\child'],
    ]) assert.throws(() => assertSeparateProfileRoots(source, target, paths), /separate/i);
    for (const [paths, source, target] of [
        [posix, '/owned/profile', '/owned/profile-copy'],
        [win32, 'C:\\owned\\profile', 'C:\\owned\\profile-copy'],
        [win32, 'C:\\owned\\profile', 'D:\\owned\\profile'],
        [win32, '\\\\host\\share\\profile', '\\\\host\\other\\profile'],
    ]) assert.doesNotThrow(() => assertSeparateProfileRoots(source, target, paths));
});
test('overlapping migration roots leave the original directory and ownership marker unchanged', async (t) => {
    const opts = await fixture(t), source = join(opts.root, 'source');
    await prepareAcceptanceProfile({ root: source, kind: 'fresh' });
    await writeFile(join(source, 'original.txt'), 'unchanged');
    const markerPath = join(source, '.lawoss-release-acceptance-profile.json');
    const marker = await readFile(markerPath, 'utf8'), entries = await readdir(source);
    for (const target of [source, join(source, 'nested'), opts.root]) {
        await assert.rejects(prepareAcceptanceProfile({ root: target, kind: 'migrated', migrateFrom: source }), /separate/i);
        assert.deepEqual(await readdir(source), entries);
        assert.equal(await readFile(markerPath, 'utf8'), marker);
        assert.equal(await readFile(join(source, 'original.txt'), 'utf8'), 'unchanged');
    }
});
