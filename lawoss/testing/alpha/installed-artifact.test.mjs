import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { gzipSync } from 'node:zlib';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { verifyAlphaInstallation, withExtractedAlphaArtifact } from './installed-artifact.mjs';

const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
const tar = createRequire(builderRequire.resolve('app-builder-lib/package.json'))('tar');
const { zipSync } = desktopRequire('fflate');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const posixTest = (name, run) => test(name, { skip: process.platform === 'win32' ? 'POSIX artifact modes and file symlinks require a POSIX filesystem; Windows adapter remains explicitly unsupported' : false }, run);

async function fixture(t, { wrapped = true, arch = 'x64' } = {}) {
    const root = await mkdtemp(join(tmpdir(), 'lawoss-alpha-artifact-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const payload = join(root, 'source'), installed = join(root, 'installed');
    await mkdir(join(payload, 'resources'), { recursive: true });
    const elf = Buffer.alloc(64);
    elf.write('\x7fELF'); elf[4] = 2; elf[5] = 1;
    elf.writeUInt16LE(3, 16); elf.writeUInt16LE(arch === 'arm64' ? 183 : 62, 18);
    await writeFile(join(payload, 'legalwork'), elf, { mode: 0o755 });
    await writeFile(join(payload, 'resources', 'app.asar'), 'immutable application bytes');
    await symlink('resources/app.asar', join(payload, 'resource-link'));
    await cp(payload, installed, { recursive: true, verbatimSymlinks: true });
    const asset = join(root, 'lawoss.tar.gz');
    await tar.create({ file: asset, cwd: payload, gzip: true, portable: true, prefix: wrapped ? 'lawoss-linux-x64-1.2.3' : undefined }, ['.']);
    return { root, payload, installed, platform: 'linux', arch, asset, installedApp: join(installed, 'legalwork'), expectedSha256: digest(await readFile(asset)) };
}

posixTest('a final tarball verifies matching installed payload without asserting signing', async t => {
    const f = await fixture(t);
    assert.deepEqual(await verifyAlphaInstallation(f), { status: 'verified', method: 'sha256-tar-installed-tree', signing: 'not-asserted', assetSha256: f.expectedSha256 });
});
posixTest('flat ARM64 tar payloads are supported and architecture mismatches refuse verification', async t => {
    const f = await fixture(t, { wrapped: false, arch: 'arm64' });
    assert.equal((await verifyAlphaInstallation(f)).status, 'verified');
    await assert.rejects(verifyAlphaInstallation({ ...f, arch: 'x64' }), /architecture/i);
});
posixTest('installed mutations, extra or missing files, link targets and executable modes refuse verification', async t => {
    const mutations = {
        changed: f => writeFile(join(f.installed, 'resources', 'app.asar'), 'changed bytes'),
        extra: f => writeFile(join(f.installed, 'unexpected-executable'), 'extra'),
        missing: f => rm(join(f.installed, 'resources', 'app.asar')),
        mode: f => chmod(f.installedApp, 0o644),
        symlink: async f => { await rm(join(f.installed, 'resource-link')); await symlink('legalwork', join(f.installed, 'resource-link')); },
        escape: async f => { await rm(join(f.installed, 'resource-link')); await symlink(f.asset, join(f.installed, 'resource-link')); },
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
        const f = await fixture(t); await mutate(f);
        await assert.rejects(verifyAlphaInstallation(f));
    });
});
posixTest('wrong final digest refuses verification without modifying installed bytes', async t => {
    const f = await fixture(t), original = await readFile(f.installedApp);
    await assert.rejects(verifyAlphaInstallation({ ...f, expectedSha256: '0'.repeat(64) }), /digest/i);
    assert.deepEqual(await readFile(f.installedApp), original);
});
async function rawArchive(f, entries) {
    const blocks = [];
    for (const { path, type = 'File', linkpath, content = '' } of entries) {
        const body = Buffer.from(content), header = new tar.Header({ path, type, linkpath, size: body.length, mode: 0o644 });
        header.encode();
        blocks.push(header.block, body, Buffer.alloc((512 - body.length % 512) % 512));
    }
    await writeFile(f.asset, gzipSync(Buffer.concat([...blocks, Buffer.alloc(1024)])));
    return { ...f, expectedSha256: digest(await readFile(f.asset)) };
}
posixTest('archive traversal, absolute paths, duplicates, hardlinks and escaping links refuse before extraction', async t => {
    for (const [name, entries] of Object.entries({
        traversal: [{ path: '../escaped', content: 'outside' }],
        absolute: [{ path: '/outside', content: 'outside' }],
        duplicate: [{ path: 'same' }, { path: './same' }],
        hardlink: [{ path: 'link', type: 'Link', linkpath: 'original' }],
        symlink: [{ path: 'link', type: 'SymbolicLink', linkpath: '../outside' }],
        'link-parent': [{ path: 'link', type: 'SymbolicLink', linkpath: 'resources' }, { path: 'link/file', content: 'through link' }],
    })) await t.test(name, async t => {
        const f = await fixture(t);
        await assert.rejects(verifyAlphaInstallation(await rawArchive(f, entries)), /archive|symlink/i);
        assert.equal(await readFile(join(f.installed, 'resources', 'app.asar'), 'utf8'), 'immutable application bytes');
    });
});
test('a nonexistent Windows NSIS cannot fabricate an alpha integrity pass', async () => {
    await assert.rejects(verifyAlphaInstallation({ platform: 'win32', arch: 'x64', asset: 'candidate.exe', installedApp: 'LAWOSS.exe', expectedSha256: '0'.repeat(64) }), { code: 'ENOENT' });
});
posixTest('AppImage extraction refuses a foreign host before executing any artifact', async t => {
    const arch = process.arch === 'arm64' ? 'x64' : 'arm64', f = await fixture(t, { arch });
    const asset = join(f.root, 'candidate.AppImage'); await copyFile(f.asset, asset);
    await assert.rejects(verifyAlphaInstallation({ ...f, asset }), /matching native Linux host/i);
});
async function macFixture(t) {
    const root = await mkdtemp(join(tmpdir(), 'lawoss-alpha-mac-artifact-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const installedApp = join(root, 'LAWOSS.app'), arch = 'arm64';
    const macho = Buffer.alloc(32); macho.writeUInt32LE(0xfeedfacf); macho.writeUInt32LE(0x0100000c, 4); macho.writeUInt32LE(2, 12);
    const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.2.3', gitSha: 'a'.repeat(40), buildEpoch: '123', platform: 'darwin', arch, channel: 'alpha', workflowRunUrl: '' };
    const files = {
        'LAWOSS.app/': [Buffer.alloc(0), 0o040755],
        'LAWOSS.app/Contents/': [Buffer.alloc(0), 0o040755],
        'LAWOSS.app/Contents/MacOS/': [Buffer.alloc(0), 0o040755],
        'LAWOSS.app/Contents/Resources/': [Buffer.alloc(0), 0o040755],
        'LAWOSS.app/Contents/MacOS/LAWOSS': [macho, 0o100755],
        'LAWOSS.app/Contents/Resources/build-info.json': [Buffer.from(JSON.stringify(build)), 0o100644],
        'LAWOSS.app/Contents/resource-link': [Buffer.from('Resources/build-info.json'), 0o120777],
    };
    for (const [path, [bytes, mode]] of Object.entries(files)) {
        const target = join(root, path);
        if ((mode & 0o170000) === 0o040000) await mkdir(target, { recursive: true });
        else if ((mode & 0o170000) === 0o120000) await symlink(bytes.toString(), target);
        else await writeFile(target, bytes, { mode: mode & 0o7777 });
    }
    const asset = join(root, 'lawoss-mac-arm64.zip');
    await writeFile(asset, zipSync(Object.fromEntries(Object.entries(files).map(([path, [bytes, mode]]) => [path, [bytes, { os: 3, attrs: mode << 16 }]]))));
    return { root, files, installedApp, asset, arch, platform: 'darwin', expectedSha256: digest(await readFile(asset)) };
}
posixTest('private macOS ZIP integrity accepts the exact app bundle without asserting signing', async t => {
    const f = await macFixture(t);
    assert.deepEqual(await verifyAlphaInstallation(f), { status: 'verified', method: 'sha256-zip-installed-tree', signing: 'not-asserted', assetSha256: f.expectedSha256 });
});
posixTest('guarded extraction lends the verified payload only inside its callback and removes it afterwards', async t => {
    const f = await macFixture(t); let installed;
    const result = await withExtractedAlphaArtifact(f, async ({ installedApp, installation }) => {
        installed = installedApp;
        assert.equal(JSON.parse(await readFile(join(installedApp, 'Contents/Resources/build-info.json'))).arch, 'arm64');
        assert.equal(installation.signing, 'not-asserted');
        return 'completed';
    });
    assert.equal(result, 'completed');
    await assert.rejects(readFile(join(installed, 'Contents/Resources/build-info.json')), { code: 'ENOENT' });
});
posixTest('guarded extraction cleans failed consumers, refuses wrong hash before callback, and retains only on explicit ownership failure', async t => {
    const f = await macFixture(t); let installed, called = false;
    await assert.rejects(withExtractedAlphaArtifact({ ...f, expectedSha256: '0'.repeat(64) }, () => { called = true; }), /digest/i);
    assert.equal(called, false);
    const primary = new Error('consumer failure');
    await assert.rejects(withExtractedAlphaArtifact(f, async loan => { installed = loan.installedApp; throw primary; }), error => error === primary);
    await assert.rejects(readFile(join(installed, 'Contents/Resources/build-info.json')), { code: 'ENOENT' });
    const retainedFailure = new Error('owned stop unverified');
    await assert.rejects(withExtractedAlphaArtifact(f, async loan => { installed = loan.installedApp; loan.retain(); throw retainedFailure; }), error => error === retainedFailure);
    assert.equal(JSON.parse(await readFile(join(installed, 'Contents/Resources/build-info.json'))).arch, 'arm64');
    // This fixture never spawns an application; removing its explicitly retained scratch is safe.
    await rm(dirname(dirname(installed)), { recursive: true, force: true });
});
for (const consumerFails of [true, false]) test(`guarded extraction ${consumerFails ? 'preserves primary and cleanup failures together' : 'still rejects cleanup-only failure'}`, {
    skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'Requires ordinary-user POSIX directory permissions' : false,
}, async t => {
    const f = await fixture(t, { wrapped: false }), primary = new Error('consumer failure');
    let scratch, readonlyDirectory;
    t.after(async () => {
        // Restore only this test's extracted fixture after all failure assertions.
        if (readonlyDirectory) await chmod(readonlyDirectory, 0o755);
        if (scratch) await rm(scratch, { recursive: true, force: true });
    });
    await assert.rejects(withExtractedAlphaArtifact(f, async ({ installedApp }) => {
        scratch = dirname(dirname(installedApp));
        readonlyDirectory = join(dirname(installedApp), 'resources');
        // The pinned tar extractor adds owner-write permission to directories.
        // Make only this test-owned extracted directory readonly to exercise real rm failure.
        await chmod(readonlyDirectory, 0o555);
        assert.equal((await lstat(readonlyDirectory)).mode & 0o7777, 0o555);
        if (consumerFails) throw primary;
        return 'completed';
    }), error => {
        if (consumerFails) {
            assert.ok(error instanceof AggregateError);
            assert.equal(error.message, 'Artifact operation and cleanup failed');
            assert.equal(error.cause, primary);
            assert.equal(error.errors.length, 2);
            assert.equal(error.errors[0], primary);
            assert.equal(error.errors[1].code, 'EACCES');
        } else {
            assert.equal(error instanceof AggregateError, false);
            assert.equal(error.code, 'EACCES');
        }
        return true;
    });
    assert.equal(await readFile(join(readonlyDirectory, 'app.asar'), 'utf8'), 'immutable application bytes');
});
posixTest('macOS ZIP rejects changed installed bytes and wrong target architecture', async t => {
    const f = await macFixture(t);
    await assert.rejects(verifyAlphaInstallation({ ...f, arch: 'x64' }), /architecture/i);
    await writeFile(join(f.installedApp, 'Contents/Resources/extra'), 'extra');
    await assert.rejects(verifyAlphaInstallation(f), /tree|bytes/i);
});
posixTest('ZIP traversal, escaping symlinks, link parents and ambiguous app roots refuse verification', async t => {
    const encode = files => zipSync(Object.fromEntries(Object.entries(files).map(([path, [bytes, mode]]) => [path, [bytes, { os: 3, attrs: mode << 16 }]])));
    for (const [name, extra] of Object.entries({
        traversal: { '../escaped': [Buffer.from('outside'), 0o100644] },
        symlink: { 'LAWOSS.app/escape': [Buffer.from('../../outside'), 0o120777] },
        'link-parent': { 'LAWOSS.app/link': [Buffer.from('Contents'), 0o120777], 'LAWOSS.app/link/file': [Buffer.from('through link'), 0o100644] },
        'second-app': { 'Other.app/': [Buffer.alloc(0), 0o040755] },
        'extra-executable': { 'extra.exe': [Buffer.from('outside app'), 0o100755] },
    })) await t.test(name, async t => {
        const f = await macFixture(t);
        await writeFile(f.asset, encode({ ...f.files, ...extra }));
        await assert.rejects(verifyAlphaInstallation({ ...f, expectedSha256: digest(await readFile(f.asset)) }), /archive|layout/i);
        assert.equal(JSON.parse(await readFile(join(f.installedApp, 'Contents/Resources/build-info.json'))).arch, 'arm64');
    });
});
posixTest('DMG integrity uses a real readonly native mount or refuses a foreign host', async t => {
    const f = await macFixture(t), asset = join(f.root, 'candidate.dmg');
    if (process.platform !== 'darwin') {
        await copyFile(f.asset, asset);
        await assert.rejects(verifyAlphaInstallation({ ...f, asset }), /native macOS host/i);
        return;
    }
    const staging = join(f.root, 'dmg-source'); await mkdir(staging);
    await cp(f.installedApp, join(staging, 'LAWOSS.app'), { recursive: true, verbatimSymlinks: true });
    await promisify(execFile)('/usr/bin/hdiutil', ['create', '-srcfolder', staging, '-volname', 'LAWOSSAlphaTest', '-format', 'UDZO', asset], { timeout: 60_000 });
    const expectedSha256 = digest(await readFile(asset));
    assert.deepEqual(await verifyAlphaInstallation({ ...f, asset, expectedSha256 }), { status: 'verified', method: 'sha256-dmg-installed-tree', signing: 'not-asserted', assetSha256: expectedSha256 });
});
