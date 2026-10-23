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
async function macFixture(t, header) {
    const root = await mkdtemp(join(tmpdir(), 'lawoss-alpha-mac-artifact-test-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const installedApp = join(root, 'LAWOSS.app'), arch = 'arm64';
    const macho = header ?? Buffer.from('cffaedfe0c000001000000000200000000000000000000000000000000000000', 'hex');
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
posixTest('matching macOS archive and installed bytes still require the actual supported architecture header', async t => {
    const valid = Buffer.from('cffaedfe0c000001000000000200000000000000000000000000000000000000', 'hex');
    const mutations = {
        'wrong-CPU-with-correct-build-info': bytes => { bytes.writeUInt32LE(0x01000007, 4); bytes.writeUInt32LE(3, 8); },
        'unsupported-arm64e': bytes => { bytes.writeUInt32LE(2, 8); },
        'capability-flag': bytes => { bytes.writeUInt32LE(0x80000000, 8); },
        'not-an-executable': bytes => { bytes.writeUInt32LE(1, 12); },
        truncated: bytes => bytes.subarray(0, 31),
    };
    for (const [name, mutate] of Object.entries(mutations)) await t.test(name, async t => {
        const bytes = Buffer.from(valid), changed = mutate(bytes), f = await macFixture(t, changed ?? bytes);
        await assert.rejects(verifyAlphaInstallation(f), { code: 'macho-architecture-unverified' });
    });
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

// Byte observations use inert archive bytes only; no embedded executable is run.
async function nodeZipFixture(t, kind = 'file') {
    const f = await macFixture(t);
    const nodeBytes = Buffer.from('inert embedded Node fixture bytes\n');
    const files = { ...f.files,
        'LAWOSS.app/Contents/Resources/node/': [Buffer.alloc(0), 0o040755],
        'LAWOSS.app/Contents/Resources/node/node-decoy': [Buffer.from('different decoy bytes'), 0o100644],
    };
    if (kind === 'file') files['LAWOSS.app/Contents/Resources/node/node'] = [nodeBytes, 0o100755];
    if (kind === 'directory') files['LAWOSS.app/Contents/Resources/node/node/'] = [Buffer.alloc(0), 0o040755];
    if (kind === 'link' || kind === 'unsafe') files['LAWOSS.app/Contents/Resources/node/node'] = [Buffer.from(kind === 'link' ? 'node-decoy' : '../../../../../../outside'), 0o120777];
    await writeFile(f.asset, zipSync(Object.fromEntries(Object.entries(files).map(([path, [bytes, mode]]) => [path, [bytes, { os: 3, attrs: mode << 16, mtime: new Date('2026-01-01T00:00:00Z') }]]))));
    return { ...f, nodeBytes, expectedSha256: digest(await readFile(f.asset)) };
}
posixTest('Mac ZIP byte observation reuses the actual fixed regular Node row before loan', async t => {
    const f = await nodeZipFixture(t), events = [];
    t.diagnostic(JSON.stringify({ fixtureAssetSha256: f.expectedSha256, fixtureNodeSha256: digest(f.nodeBytes) }));
    const result = await withExtractedAlphaArtifact({ ...f, observeArtifactBytes: event => {
        assert.ok(Object.isFrozen(event)); events.push(event);
    } }, async loan => {
        assert.deepEqual(events, [
            { schema: 1, stage: 'owned-copy', sha256: f.expectedSha256 },
            { schema: 1, stage: 'embedded-node', state: 'observed', sha256: digest(f.nodeBytes) },
        ]);
        assert.deepEqual(loan.installation, { status: 'verified', method: 'sha256-zip-installed-tree', signing: 'not-asserted', assetSha256: f.expectedSha256 });
        return 'completed';
    });
    assert.equal(result, 'completed');
});

for (const kind of ['missing', 'directory', 'link', 'unsafe']) posixTest(`Mac ZIP byte observation preserves original ${kind} Node outcome`, async t => {
    const f = await nodeZipFixture(t, kind), events = [];
    let used = false;
    const operation = withExtractedAlphaArtifact({ ...f, observeArtifactBytes: event => events.push(event) }, () => { used = true; });
    if (kind === 'unsafe') {
        await assert.rejects(operation, /symlink/i);
        assert.equal(used, false);
        assert.deepEqual(events, [{ schema: 1, stage: 'owned-copy', sha256: f.expectedSha256 }]);
    } else {
        await operation; assert.equal(used, true);
        assert.deepEqual(events, [{ schema: 1, stage: 'owned-copy', sha256: f.expectedSha256 },
            { schema: 1, stage: 'embedded-node', state: 'unavailable' }]);
    }
});
posixTest('Mac ZIP byte observation contains synchronous observer throws and preserves original ownership', async t => {
    for (const mode of ['success', 'primary', 'retained', 'wrong-hash']) await t.test(mode, async t => {
        const f = await nodeZipFixture(t), primary = new Error('original consumer'), events = [];
        let installed;
        const operation = withExtractedAlphaArtifact({ ...f, ...(mode === 'wrong-hash' ? { expectedSha256: '0'.repeat(64) } : {}),
            observeArtifactBytes: event => { events.push(event); throw new Error('observer failure'); } }, loan => {
            installed = loan.installedApp;
            if (mode === 'retained') loan.retain();
            if (mode !== 'success') throw primary;
            return 'done';
        });
        if (mode === 'success') assert.equal(await operation, 'done');
        else if (mode === 'wrong-hash') { await assert.rejects(operation, /digest/); assert.deepEqual(events, []); assert.equal(installed, undefined); return; }
        else await assert.rejects(operation, error => error === primary);
        assert.equal(events.length, 2);
        if (mode === 'retained') {
            assert.equal(digest(await readFile(join(installed, 'Contents/Resources/node/node'))), digest(f.nodeBytes));
            await rm(dirname(dirname(installed)), { recursive: true, force: true });
        } else await assert.rejects(lstat(installed), { code: 'ENOENT' });
    });
});

// Exact source-bound helper extraction instruments the original I/O boundary only.
// This MODEL complements the real ZIP tests above; it does not model native startup.
test('Mac ZIP byte observation performs one original inventory and no added I/O, preserving cleanup identities', async () => {
    const source = await readFile(new URL('./installed-artifact.mjs', import.meta.url), 'utf8');
    const helper = source.slice(source.indexOf('export async function withExtractedAlphaArtifact('), source.indexOf('/** Private alpha payload'));
    const observer = source.slice(source.indexOf('function observeBytes('), source.indexOf('/** Lend a digest-checked payload'));
    for (const mode of ['success', 'primary-cleanup', 'cleanup', 'copy-mismatch', 'duplicate']) {
        const calls = [], hash = 'a'.repeat(64), node = 'b'.repeat(64), primary = new Error('primary'), cleanup = new Error('cleanup');
        const note = (name, value) => async () => { calls.push(name); return value; };
        const deps = { join, tmpdir: () => '/MODEL', constants: { COPYFILE_EXCL: 1 },
            lstat: note('lstat', { isFile: () => true }), realpath: note('realpath', '/MODEL/scratch'), mkdtemp: note('mkdtemp', '/MODEL/scratch'),
            copyFile: async (...args) => { calls.push('copy'); assert.equal(args[2], 1); },
            fileHash: note('hash', mode === 'copy-mismatch' ? 'c'.repeat(64) : hash), mkdir: note('mkdir'), extractZip: note('extract'),
            macPayloadRoot: note('payload', '/MODEL/scratch/extracted/App.app'), macArchitecture: note('architecture'),
            tree: note('tree', [['Contents/Resources/node/node-decoy', 'file', 493, 'd'.repeat(64)],
                ['Contents/Resources/node/node', 'file', 493, node], ...(mode === 'duplicate' ? [['Contents/Resources/node/node', 'file', 493, node]] : [])]),
            rm: async () => { calls.push('rm'); if (mode.includes('cleanup')) throw cleanup; },
        };
        const run = new Function('deps', `const {${Object.keys(deps).join(',')}}=deps; ${observer}; return ${helper.replace('export ', '')}`)(deps);
        const events = [];
        const operation = run({ platform: 'darwin', arch: 'arm64', asset: '/MODEL/input.zip', expectedSha256: hash,
            observeArtifactBytes: event => { events.push(event); throw new Error('ignored sync observer'); } }, () => {
            calls.push('use'); if (mode === 'primary-cleanup') throw primary; return 'done';
        });
        if (mode === 'primary-cleanup') await assert.rejects(operation, error => {
            assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.deepEqual(error.errors, [primary, cleanup]); return true;
        });
        else if (mode === 'cleanup') await assert.rejects(operation, error => error === cleanup);
        else if (mode === 'copy-mismatch') await assert.rejects(operation, /digest/);
        else assert.equal(await operation, 'done');
        assert.deepEqual(calls, ['lstat', 'mkdtemp', 'realpath', 'copy', 'hash', ...(mode === 'copy-mismatch' ? [] : ['mkdir', 'extract', 'payload', 'architecture', 'tree', 'use']), 'rm']);
        assert.deepEqual(events, mode === 'copy-mismatch' ? [] : [{ schema: 1, stage: 'owned-copy', sha256: hash },
            { schema: 1, stage: 'embedded-node', ...(mode === 'duplicate' ? { state: 'unavailable' } : { state: 'observed', sha256: node }) }]);
    }
});
posixTest('Mac ZIP byte observation does not add observations to a Linux helper loan', async t => {
    const f = await fixture(t), events = [];
    await withExtractedAlphaArtifact({ ...f, observeArtifactBytes: event => events.push(event) }, loan => {
        assert.deepEqual(Object.keys(loan).sort(), ['installation', 'installedApp', 'retain']);
    });
    assert.deepEqual(events, []);
});

for (const consumerFails of [true, false]) test(`Mac ZIP byte observation survives actual ${consumerFails ? 'primary plus cleanup' : 'cleanup-only'} refusal`, {
    skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'Requires ordinary-user POSIX directory permissions' : false,
}, async t => {
    const f = await nodeZipFixture(t), primary = new Error('original consumer'), events = [];
    let scratch, readonly;
    t.after(async () => { if (readonly) await chmod(readonly, 0o755); if (scratch) await rm(scratch, { recursive: true, force: true }); });
    await assert.rejects(withExtractedAlphaArtifact({ ...f, observeArtifactBytes: event => { events.push(event); throw new Error('observer'); } }, loan => {
        scratch = dirname(dirname(loan.installedApp)); readonly = join(loan.installedApp, 'Contents/Resources/node');
        return chmod(readonly, 0o555).then(() => { if (consumerFails) throw primary; return 'done'; });
    }), error => {
        if (consumerFails) { assert.ok(error instanceof AggregateError); assert.equal(error.cause, primary); assert.equal(error.errors[0], primary); assert.equal(error.errors[1].code, 'EACCES'); }
        else { assert.equal(error instanceof AggregateError, false); assert.equal(error.code, 'EACCES'); }
        return true;
    });
    assert.deepEqual(events, [{ schema: 1, stage: 'owned-copy', sha256: f.expectedSha256 },
        { schema: 1, stage: 'embedded-node', state: 'observed', sha256: digest(f.nodeBytes) }]);
    assert.ok(events.every(Object.isFrozen));
});
