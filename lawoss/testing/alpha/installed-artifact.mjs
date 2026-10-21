import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { createReadStream, createWriteStream, constants } from 'node:fs';
import { chmod, copyFile, lstat, mkdir, mkdtemp, open, readFile, readlink, readdir, realpath, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';

async function fileHash(path) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
}
const contains = (root, path) => {
    const rel = relative(root, path);
    return rel === '' || (!isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${sep}`));
};
function packagingLibrary(name) {
    // Reuse the exact archive implementation already installed for desktop packaging.
    const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
    const builder = createRequire(desktop.resolve('electron-builder/package.json'));
    return createRequire(builder.resolve('app-builder-lib/package.json'))(name);
}
function archivePath(raw, directory = false) {
    if (typeof raw !== 'string' || /[\\\x00-\x1f]/.test(raw) || posix.isAbsolute(raw) || /^[A-Za-z]:/.test(raw))
        throw new Error('Unsafe archive path');
    const path = raw.replace(/^(\.\/)+/, '').replace(directory ? /\/+$/ : /$^/, '');
    if (directory && (path === '' || path === '.')) return '';
    if (!path || path.split('/').some(part => !part || part === '.' || part === '..'))
        throw new Error('Unsafe archive traversal or ambiguous path');
    return path;
}
async function extractTar(asset, destination) {
    const tar = packagingLibrary('tar'), entries = new Map();
    let invalid, bytes = 0;
    await tar.list({ file: asset, strict: true, onReadEntry(entry) {
        if (invalid) return;
        try {
            if (!['File', 'OldFile', 'Directory', 'SymbolicLink'].includes(entry.type))
                throw new Error('Unsupported archive entry type');
            const name = archivePath(entry.path, entry.type === 'Directory');
            if (!name) return;
            const key = name.normalize('NFC');
            if (entries.has(key)) throw new Error('Duplicate archive path');
            if (entries.size >= 100_000 || !Number.isSafeInteger(entry.size) || entry.size < 0 || (bytes += entry.size) > 32 * 1024 ** 3)
                throw new Error('Archive exceeds alpha extraction budget');
            entries.set(key, { type: entry.type, link: entry.linkpath });
        } catch (error) { invalid = error; }
    } });
    if (invalid) throw invalid;
    validateArchiveLinks(entries);
    await tar.extract({ file: asset, cwd: destination, strict: true, preservePaths: false, chmod: true, processUmask: 0o022, umask: 0o022 });
}
function validateArchiveLinks(entries) {
    for (const [name, entry] of entries) {
        for (let parent = posix.dirname(name); parent !== '.'; parent = posix.dirname(parent)) {
            if (entries.has(parent) && entries.get(parent).type !== 'Directory')
                throw new Error('Archive entry traverses a link or file');
        }
        if (entry.type === 'SymbolicLink') {
            if (typeof entry.link !== 'string' || !entry.link || /[\\\x00-\x1f]/.test(entry.link) || posix.isAbsolute(entry.link) || /^[A-Za-z]:/.test(entry.link))
                throw new Error('Unsafe archive symlink');
            const target = posix.normalize(posix.join(posix.dirname(name), entry.link));
            if (target === '..' || target.startsWith('../')) throw new Error('Archive symlink escapes extraction root');
        }
    }
}
async function extractZip(asset, destination) {
    const archive = await packagingLibrary('unzipper').Open.file(asset), entries = new Map();
    if (archive.files.length > 100_000) throw new Error('Archive exceeds alpha extraction budget');
    let bytes = 0;
    for (const source of archive.files) {
        const mode = source.externalFileAttributes >>> 16, kind = mode & 0o170000;
        const type = kind === 0o120000 ? 'SymbolicLink' : source.type;
        if (source.signature !== 0x02014b50 || source.flags & 1 || ![0, 0o040000, 0o100000, 0o120000].includes(kind))
            throw new Error('Unsupported ZIP archive entry');
        const name = archivePath(source.path, type === 'Directory').normalize('NFC');
        if (!name || entries.has(name)) throw new Error('Duplicate or empty ZIP archive path');
        if (!Number.isSafeInteger(source.uncompressedSize) || source.uncompressedSize < 0 || (bytes += source.uncompressedSize) > 32 * 1024 ** 3)
            throw new Error('Archive exceeds alpha extraction budget');
        let link;
        if (type === 'SymbolicLink') {
            const chunks = []; let length = 0;
            for await (const chunk of source.stream()) {
                if ((length += chunk.length) > 4096) throw new Error('Oversized archive symlink');
                chunks.push(chunk);
            }
            link = Buffer.concat(chunks).toString('utf8');
        }
        entries.set(name, { type, link, source, mode: mode & 0o7777 || (type === 'Directory' ? 0o755 : 0o644) });
    }
    validateArchiveLinks(entries);
    // Write validated regular entries first; no archive symlink can become a write parent.
    for (const [name, entry] of entries) {
        if (name === '__MACOSX' || name.startsWith('__MACOSX/')) continue;
        const target = join(destination, name);
        if (entry.type === 'Directory') await mkdir(target, { recursive: true, mode: 0o755 });
        else if (entry.type === 'File') {
            await mkdir(dirname(target), { recursive: true, mode: 0o755 });
            let length = 0;
            const bounded = new Transform({ transform(chunk, encoding, done) {
                length += chunk.length;
                done(length > entry.source.uncompressedSize ? new Error('ZIP entry exceeds declared size') : null, chunk);
            } });
            await pipeline(entry.source.stream(), bounded, createWriteStream(target, { flags: 'wx', mode: 0o600 }));
            if (length !== entry.source.uncompressedSize) throw new Error('ZIP entry size differs');
            await chmod(target, entry.mode);
        }
    }
    for (const [name, entry] of entries) {
        if (name === '__MACOSX' || name.startsWith('__MACOSX/')) continue;
        if (entry.type === 'SymbolicLink') {
            await mkdir(dirname(join(destination, name)), { recursive: true, mode: 0o755 });
            await symlink(entry.link, join(destination, name));
        }
    }
    for (const [name, entry] of [...entries].reverse())
        if (entry.type === 'Directory' && name !== '__MACOSX' && !name.startsWith('__MACOSX/')) await chmod(join(destination, name), entry.mode);
}
async function macPayloadRoot(extracted, dmg = false) {
    const names = await readdir(extracted), apps = names.filter(name => name.endsWith('.app'));
    const allowed = new Set(dmg ? ['Applications', '.DS_Store', '.VolumeIcon.icns', '.background'] : ['__MACOSX']);
    if (apps.length !== 1 || names.some(name => name !== apps[0] && !allowed.has(name)))
        throw new Error('Unsupported or ambiguous macOS artifact layout');
    const app = join(extracted, apps[0]), info = await lstat(app);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('Expected a physical app bundle');
    return app;
}
async function macArchitecture(app, arch) {
    const build = validateBuildInfo(JSON.parse(await readFile(join(app, 'Contents/Resources/build-info.json'), 'utf8')));
    if (build.platform !== 'darwin' || build.arch !== arch) throw new Error('macOS embedded architecture differs');
    const executable = join(app, 'Contents/MacOS/LAWOSS');
    if (!(await lstat(executable)).isFile()) throw new Error('Expected physical packaged Mac executable');
    if (process.platform === 'darwin') await promisify(execFile)('/usr/bin/lipo', [executable, '-verify_arch', arch === 'x64' ? 'x86_64' : 'arm64'], { timeout: 10_000 });
}
async function payloadRoot(extracted) {
    const names = await readdir(extracted);
    if (names.includes('legalwork') && names.includes('resources')) return extracted;
    if (names.length === 1) {
        const child = join(extracted, names[0]), info = await lstat(child);
        if (info.isDirectory() && !info.isSymbolicLink()) {
            const children = await readdir(child);
            if (children.includes('legalwork') && children.includes('resources')) return child;
        }
    }
    throw new Error('Unsupported or ambiguous Linux artifact layout');
}
async function executableArchitecture(path, arch, appImage = false) {
    const file = await open(path, 'r');
    try {
        const header = Buffer.alloc(20), { bytesRead } = await file.read(header, 0, 20, 0);
        if (bytesRead !== 20 || !header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) || header[4] !== 2 || header[5] !== 1 || ![2, 3].includes(header.readUInt16LE(16)) || header.readUInt16LE(18) !== (arch === 'arm64' ? 183 : 62))
            throw new Error('Linux payload executable architecture differs');
        if (appImage && !header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 2])))
            throw new Error('Expected a type-2 AppImage runtime');
    } finally { await file.close(); }
}
async function extractAppImage(asset, destination, scratch, arch) {
    if (process.platform !== 'linux' || process.arch !== arch)
        throw new Error('AppImage extraction requires a matching native Linux host');
    await executableArchitecture(asset, arch, true);
    await chmod(asset, 0o500);
    // This executes only the caller's trusted, digest-matched private candidate.
    // It is not an isolation boundary for an untrusted AppImage runtime.
    await promisify(execFile)(asset, ['--appimage-extract'], {
        cwd: destination, timeout: 120_000, maxBuffer: 8 * 1024 ** 2,
        env: { PATH: '/usr/bin:/bin', HOME: scratch, TMPDIR: scratch, LANG: 'C', LC_ALL: 'C' },
    });
    const names = await readdir(destination);
    if (names.length !== 1 || names[0] !== 'squashfs-root')
        throw new Error('Unsupported or ambiguous AppImage extraction layout');
}
async function tree(root) {
    const result = [];
    async function visit(directory) {
        for (const name of (await readdir(directory)).sort()) {
            const path = join(directory, name), info = await lstat(path), entry = relative(root, path);
            if (info.isSymbolicLink()) {
                const target = await readlink(path);
                if (!contains(root, resolve(dirname(path), target)) || !contains(root, await realpath(path)))
                    throw new Error('Installed payload symlink escapes its root');
                result.push([entry, 'link', target]);
            } else if (info.isDirectory()) {
                result.push([entry, 'directory', info.mode & 0o7777]);
                await visit(path);
            } else if (info.isFile()) result.push([entry, 'file', info.mode & 0o7777, await fileHash(path)]);
            else throw new Error('Unsupported installed payload entry');
        }
    }
    await visit(root);
    return result;
}

/** Lend a digest-checked payload; retain only when an owned child failed verified cleanup. */
export async function withExtractedAlphaArtifact({ platform, arch, asset, expectedSha256 }, use) {
    if (!['x64', 'arm64'].includes(arch) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''))
        throw new Error('Expected architecture and final artifact SHA-256');
    if (typeof use !== 'function') throw new Error('Expected an owned artifact consumer');
    const appImage = asset.endsWith('.AppImage'), mac = platform === 'darwin', dmg = mac && asset.endsWith('.dmg');
    if ((!mac && (platform !== 'linux' || (!asset.endsWith('.tar.gz') && !appImage))) || (mac && !asset.endsWith('.zip') && !dmg))
        throw new Error('Unsupported alpha artifact platform or format');
    if (!(await lstat(asset)).isFile()) throw new Error('Expected a physical final artifact');
    const scratch = await realpath(await mkdtemp(join(tmpdir(), 'lawoss-alpha-artifact-')));
    let mount, retained = false;
    try {
        // Verification/extraction use the same private copy, never a later mutable source path.
        const ownedAsset = join(scratch, `candidate${mac ? dmg ? '.dmg' : '.zip' : appImage ? '.AppImage' : '.tar.gz'}`);
        await copyFile(asset, ownedAsset, constants.COPYFILE_EXCL);
        if (await fileHash(ownedAsset) !== expectedSha256) throw new Error('Final artifact digest differs');
        const extracted = join(scratch, 'extracted');
        await mkdir(extracted, { mode: 0o700 });
        if (dmg) {
            if (process.platform !== 'darwin') throw new Error('DMG extraction requires a native macOS host');
            await promisify(execFile)('/usr/bin/hdiutil', ['attach', '-readonly', '-nobrowse', '-mountpoint', extracted, ownedAsset], { timeout: 60_000 });
            mount = extracted;
        } else if (mac) await extractZip(ownedAsset, extracted);
        else if (appImage) await extractAppImage(ownedAsset, extracted, scratch, arch);
        else await extractTar(ownedAsset, extracted);
        const payload = mac ? await macPayloadRoot(extracted, dmg) : await payloadRoot(extracted);
        if (mac) await macArchitecture(payload, arch);
        else await executableArchitecture(join(payload, 'legalwork'), arch);
        await tree(payload); // Refuse escaping/broken links before lending an executable.
        const installation = { status: 'verified', method: mac ? dmg ? 'sha256-dmg-installed-tree' : 'sha256-zip-installed-tree' : appImage ? 'sha256-appimage-installed-tree' : 'sha256-tar-installed-tree', signing: 'not-asserted', assetSha256: expectedSha256 };
        return await use({ installedApp: mac ? payload : join(payload, 'legalwork'), installation, retain: () => { retained = true; } });
    } finally {
        if (!retained) {
            if (mount) await promisify(execFile)('/usr/bin/hdiutil', ['detach', mount], { timeout: 30_000 });
            await rm(scratch, { recursive: true, force: true });
        }
    }
}

/** Private alpha payload integrity only; never supplies a public signing receipt. */
export async function verifyAlphaInstallation({ platform, arch, asset, installedApp, expectedSha256 }) {
    if (!['x64', 'arm64'].includes(arch) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? ''))
        throw new Error('Expected architecture and final artifact SHA-256');
    if (platform === 'win32') return (await import('./nsis-artifact.mjs')).verifyNsisInstallation({ arch, asset: resolve(asset), installedApp: resolve(installedApp), expectedSha256 });
    const installedInfo = await lstat(installedApp), mac = platform === 'darwin';
    if (installedInfo.isSymbolicLink() || (mac ? !installedInfo.isDirectory() : !installedInfo.isFile() || basename(installedApp) !== 'legalwork'))
        throw new Error('Expected a physical installed payload');
    const installedRoot = await realpath(mac ? installedApp : dirname(installedApp));
    return withExtractedAlphaArtifact({ platform, arch, asset, expectedSha256 }, async ({ installedApp: extracted, installation }) => {
        const payload = mac ? extracted : dirname(extracted);
        if (JSON.stringify(await tree(payload)) !== JSON.stringify(await tree(installedRoot)))
            throw new Error('Installed payload tree or bytes differ from final artifact');
        return installation;
    });
}
