import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, posix } from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';

const MAX_ENTRIES = 100_000, MAX_BYTES = 32 * 1024 ** 3, MAX_LISTING = 32 * 1024 ** 2, MAX_HELPER = 256 * 1024 ** 2;
const entryKeys = new Set(['Path', 'Size', 'Packed Size', 'Modified', 'Created', 'Accessed', 'Attributes', 'CRC', 'Encrypted', 'Method', 'Block', 'Solid', 'Offset', 'Folder']);
const key = name => name.toUpperCase();
function safePath(raw) {
  if (typeof raw !== 'string' || raw.length > 4096 || /[\x00-\x1f\x7f:*?"<>|]/.test(raw) || raw !== raw.normalize('NFC'))
    throw new Error('Unsafe Windows archive path');
  const name = raw.replaceAll('\\', '/');
  if (name.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || part.length > 255 || /^(CON|CONIN\$|CONOUT\$|PRN|AUX|NUL|COM[1-9¹²³]|LPT[1-9¹²³])(?:\.|$)/i.test(part)))
    throw new Error('Unsafe Windows archive path');
  return name;
}
function fields(lines, allowed) {
  const result = new Map();
  for (const line of lines) {
    const match = /^([A-Za-z][A-Za-z ]*) = (.*)$/.exec(line);
    if (!match || result.has(match[1]) || (allowed && !allowed.has(match[1]))) throw new Error('Unsupported or ambiguous archive listing');
    result.set(match[1], match[2]);
  }
  return result;
}
/** Parse the tool's complete technical listing; returned raw paths are literal selectors. */
export function parse7ZipListing(text, expectedType) {
  if (!['Nsis', '7z'].includes(expectedType) || typeof text !== 'string') throw new Error('Invalid archive listing type');
  if (Buffer.byteLength(text) > MAX_LISTING) throw new Error('Archive exceeds alpha listing budget');
  const sections = text.replaceAll('\r\n', '\n').split('\n----------\n');
  if (sections.length !== 2) throw new Error('Unsupported archive listing');
  const header = sections[0].split('\n--\n');
  if (header.length !== 2 || fields(header[1].trimEnd().split('\n')).get('Type') !== expectedType) throw new Error('Unexpected NSIS or 7z archive type');
  const blocks = sections[1].trimEnd().split('\n\n'), entries = [], names = new Map(), components = new Map();
  if (!sections[1].trim() || blocks.length > MAX_ENTRIES) throw new Error('Archive exceeds alpha entry budget');
  let total = 0;
  for (const block of blocks) {
    const values = fields(block.split('\n'), entryKeys), rawPath = values.get('Path'), name = safePath(rawPath);
    const size = values.get('Size'), attributes = values.get('Attributes');
    // NSIS lists compressed file sizes as empty; their actual streams receive a
    // separate small helper budget. The application .7z must remain size-known.
    const unknownSize = expectedType === 'Nsis' && size === '' && ['Deflate', 'LZMA', 'BZip2'].includes(values.get('Method'));
    if ((!unknownSize && (!/^\d+$/.test(size ?? '') || !Number.isSafeInteger(Number(size)))) || typeof attributes !== 'string' || (values.has('Encrypted') && values.get('Encrypted') !== '-'))
      throw new Error('Unsupported archive entry');
    const attributeParts = attributes.trim().split(/\s+/), mode = attributeParts.find(part => /^[-dl]/.test(part));
    const directory = attributes.startsWith('D') || values.get('Folder') === '+';
    if (!/^[ADRHSCNI_ ]*(?:[-d][rwxstST-]{9})?$/.test(attributes) || (mode && (mode[0] === 'd') !== directory) || (values.has('Folder') && !['+', '-'].includes(values.get('Folder'))) || (directory && (unknownSize || Number(size) !== 0)))
      throw new Error('Unsupported archive entry attributes or link');
    if ((total += Number(size)) > MAX_BYTES) throw new Error('Archive exceeds alpha extraction budget');
    if (names.has(key(name))) throw new Error('Duplicate Windows archive path');
    for (let parent = name; parent !== '.'; parent = posix.dirname(parent)) {
      if (components.has(key(parent)) && components.get(key(parent)) !== parent) throw new Error('Aliased Windows archive path');
      components.set(key(parent), parent);
    }
    const entry = { path: name, rawPath, kind: directory ? 'directory' : 'file', size: unknownSize ? null : Number(size) };
    names.set(key(name), entry); entries.push(entry);
  }
  for (const entry of entries) for (let parent = posix.dirname(entry.path); parent !== '.'; parent = posix.dirname(parent)) {
    if (names.has(key(parent)) && names.get(key(parent)).kind !== 'directory') throw new Error('Archive path traverses a file');
  }
  return entries;
}
function checkTime(deadline) {
  if (performance.now() >= deadline) throw new Error('NSIS integrity verification exceeded its time budget');
}
async function hashFile(filename, deadline) {
  checkTime(deadline);
  const before = await lstat(filename);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > MAX_BYTES) throw new Error('Unsafe installed payload file or link');
  const file = await open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const same = info => info.isFile() && info.dev === before.dev && info.ino === before.ino && info.size === before.size && info.nlink === 1 && info.mtimeMs === before.mtimeMs && info.ctimeMs === before.ctimeMs;
    if (!same(await file.stat())) throw new Error('Installed payload identity changed');
    const hash = createHash('sha256'), buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      checkTime(deadline);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      hash.update(buffer.subarray(0, bytesRead));
    }
    if (!same(await file.stat()) || !same(await lstat(filename))) throw new Error('Installed payload identity changed');
    return hash.digest('hex');
  } finally { await file.close(); }
}
async function archiveTool() {
  const desktop = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
  const builder = createRequire(desktop.resolve('electron-builder/package.json'));
  const packaging = createRequire(builder.resolve('app-builder-lib/package.json'));
  return packaging('./out/toolsets/7zip.js').getPath7za();
}
async function runTool(tool, args, deadline, output) {
  checkTime(deadline);
  const child = spawn(tool, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let failure, stderrBytes = 0, bytes = 0;
  const fail = error => { failure ??= error; child.kill('SIGKILL'); };
  child.once('error', () => { failure ??= new Error('NSIS archive tool failed to start'); });
  const closed = new Promise(resolve => child.once('close', code => resolve(code)));
  child.stderr.on('data', chunk => { if ((stderrBytes += chunk.length) > 16384) fail(new Error('NSIS archive diagnostics exceed budget')); });
  const timer = setTimeout(() => fail(new Error('NSIS archive tool exceeded its time budget')), Math.max(1, Math.floor(deadline - performance.now())));
  const chunks = [];
  try {
    if (output) {
      const bounded = new Transform({ transform(chunk, encoding, done) {
        bytes += chunk.length;
        done(bytes > (output.size ?? MAX_HELPER) ? new Error('Archive stream exceeds declared size or helper budget') : null, chunk);
      } });
      await pipeline(child.stdout, bounded, createWriteStream(output.path, { flags: 'wx', mode: 0o600 }));
      if (output.size !== null && bytes !== output.size) fail(new Error('Archive stream differs from declared size'));
    } else for await (const chunk of child.stdout) {
      if ((bytes += chunk.length) > MAX_LISTING) { fail(new Error('Archive exceeds alpha listing budget')); break; }
      chunks.push(chunk);
    }
  } catch (error) { fail(error); }
  const code = await closed;
  clearTimeout(timer);
  if (failure) throw failure;
  if (code !== 0) throw new Error('NSIS archive tool refused the archive or extraction');
  return output ? bytes : new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks));
}
const toolArgs = ['-bd', '-bsp0', '-sccUTF-8'];
async function listArchive(tool, filename, type, deadline) {
  return parse7ZipListing(await runTool(tool, ['l', '-slt', ...toolArgs, `-t${type}`, '--', filename], deadline), type);
}
async function extractOne(tool, asset, entry, target, deadline) {
  return runTool(tool, ['x', '-so', '-spd', '-ssc', ...toolArgs, '-tNsis', '--', asset, entry.rawPath], deadline, { path: target, size: entry.size });
}
function outerFiles(entries, arch) {
  const expected = `$PLUGINSDIR/app-${arch === 'arm64' ? 'arm64' : '64'}.7z`;
  const payloads = entries.filter(entry => /^\$PLUGINSDIR\/app-.*\.(?:7z|zip)$/i.test(entry.path));
  if (payloads.length !== 1 || payloads[0].path !== expected || payloads[0].kind !== 'file' || payloads[0].size === null) throw new Error('NSIS architecture payload is missing, ambiguous or has unknown size');
  const extras = entries.filter(entry => ['Uninstall LAWOSS.exe', 'uninstallerIcon.ico'].includes(entry.path));
  if (!extras.some(entry => entry.path === 'Uninstall LAWOSS.exe') || extras.some(entry => entry.kind !== 'file')) throw new Error('Unsupported NSIS uninstaller layout');
  for (const entry of entries) {
    if (entry === payloads[0] || extras.includes(entry)) continue;
    if (entry.path === '$PLUGINSDIR' && entry.kind === 'directory') continue;
    if (entry.kind === 'file' && /^\$PLUGINSDIR\/[^/]+\.(?:dll|ico|bmp)$/i.test(entry.path)) continue;
    throw new Error('Unsupported NSIS outer archive entry');
  }
  return { payload: payloads[0], extras };
}
function expectedTree(entries) {
  const result = new Map(entries.map(entry => [entry.path, entry]));
  for (const entry of entries) for (let parent = posix.dirname(entry.path); parent !== '.'; parent = posix.dirname(parent)) {
    if (!result.has(parent)) result.set(parent, { path: parent, kind: 'directory', size: 0 });
    if (result.size > MAX_ENTRIES) throw new Error('Archive exceeds alpha entry budget');
  }
  return result;
}
async function auditTree(root, expected, deadline) {
  let count = 0, total = 0;
  const result = new Map();
  async function visit(directory, prefix = '') {
    checkTime(deadline);
    for (const name of await readdir(directory)) {
      const relative = prefix ? `${prefix}/${name}` : name, filename = join(directory, name);
      if (safePath(relative) !== relative || ++count > MAX_ENTRIES) throw new Error('Unsafe installed payload tree');
      const info = await lstat(filename), entry = expected.get(relative);
      if (!entry || info.isSymbolicLink() || (entry.kind === 'directory' ? !info.isDirectory() : !info.isFile() || info.nlink !== 1 || info.size !== entry.size) || (info.isFile() && (total += info.size) > MAX_BYTES))
        throw new Error('Installed payload tree, entry or bytes differ from final artifact');
      result.set(relative, entry.kind === 'file' ? await hashFile(filename, deadline) : 'directory');
      if (info.isDirectory()) await visit(filename, relative);
    }
  }
  await visit(root);
  if (result.size !== expected.size) throw new Error('Installed payload tree has missing entries');
  return result;
}
async function validateArchitecture(payload, arch) {
  const file = await open(join(payload, 'LAWOSS.exe'), 'r');
  try {
    const dos = Buffer.alloc(64), header = Buffer.alloc(26), info = await file.stat();
    const { bytesRead } = await file.read(dos, 0, dos.length, 0), offset = dos.readUInt32LE(60);
    if (bytesRead !== dos.length || dos.subarray(0, 2).toString() !== 'MZ' || offset < 64 || offset > 1024 ** 2 || offset > info.size - header.length || (await file.read(header, 0, header.length, offset)).bytesRead !== header.length || !header.subarray(0, 4).equals(Buffer.from('PE\0\0')) || header.readUInt16LE(4) !== (arch === 'arm64' ? 0xaa64 : 0x8664) || header.readUInt16LE(24) !== 0x20b)
      throw new Error('Windows payload executable architecture differs');
  } finally { await file.close(); }
  const buildFile = join(payload, 'resources/build-info.json');
  if ((await lstat(buildFile)).size > 16384) throw new Error('Oversized Windows build target metadata');
  const build = validateBuildInfo(JSON.parse(await readFile(buildFile, 'utf8')));
  if (build.platform !== 'win32' || build.arch !== arch) throw new Error('Windows embedded build target differs');
}

/** Static private-alpha payload integrity only. Never executes the installer or asserts signing. */
export async function verifyNsisInstallation({ asset, installedApp, arch, expectedSha256 }) {
  if (!['x64', 'arm64'].includes(arch) || !/^[a-f0-9]{64}$/.test(expectedSha256 ?? '') || typeof asset !== 'string' || !isAbsolute(asset) || !asset.endsWith('.exe') || typeof installedApp !== 'string' || !isAbsolute(installedApp) || basename(installedApp) !== 'LAWOSS.exe')
    throw new Error('Expected Windows final NSIS artifact, installed executable, architecture and SHA-256');
  for (const filename of [asset, installedApp]) {
    const info = await lstat(filename);
    if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1 || info.size > MAX_BYTES) throw new Error('Expected physical NSIS artifact and installed payload');
  }
  const installedDirectory = dirname(installedApp), rootInfo = await lstat(installedDirectory);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('Expected physical installed payload root');
  const tool = await archiveTool(), deadline = performance.now() + 180_000;
  const formats = (await runTool(tool, ['i', ...toolArgs], deadline)).replaceAll('\r\n', '\n').split('\n');
  if (!['Nsis', '7z'].every(format => formats.some(line => new RegExp(`^\\s+.*\\s${format}\\s+${format.toLowerCase()}(?:\\s|$)`).test(line))))
    throw Object.assign(new Error('Windows NSIS archive handler unavailable in packaging tool; a full 7zip executable is required'), { code: 'windows-nsis-tool-format-unavailable' });
  const scratch = await realpath(await mkdtemp(join(tmpdir(), 'lawoss-alpha-nsis-')));
  try {
    const candidate = join(scratch, 'candidate.exe');
    await copyFile(asset, candidate, constants.COPYFILE_EXCL);
    if (await hashFile(candidate, deadline) !== expectedSha256) throw new Error('Final NSIS artifact digest differs');
    const { payload, extras } = outerFiles(await listArchive(tool, candidate, 'Nsis', deadline), arch);
    const archive = join(scratch, 'payload.7z');
    await extractOne(tool, candidate, payload, archive, deadline);
    const entries = await listArchive(tool, archive, '7z', deadline), expected = expectedTree(entries);
    if (!entries.some(entry => entry.path === 'LAWOSS.exe' && entry.kind === 'file') || !entries.some(entry => entry.path === 'resources/build-info.json' && entry.kind === 'file')) throw new Error('Unsupported Windows application payload layout');
    const extracted = join(scratch, 'extracted');
    await mkdir(extracted, { mode: 0o700 });
    for (const entry of expected.values()) if (entry.kind === 'directory') await mkdir(join(extracted, entry.path), { recursive: true, mode: 0o700 });
    const selectors = join(scratch, 'files.txt');
    await writeFile(selectors, entries.filter(entry => entry.kind === 'file').map(entry => entry.rawPath).join('\n'), { flag: 'wx', mode: 0o600 });
    // No directory selectors: a forged technical-listing record must not cause
    // recursive selection of an unvalidated original archive filename. Literal,
    // case-sensitive selectors disable wildcard and alias-based selection.
    await runTool(tool, ['x', '-y', '-spd', '-ssc', '-r-', '-scsUTF-8', ...toolArgs, '-t7z', `-i@${selectors}`, `-o${extracted}`, '--', archive], deadline);
    const source = await auditTree(extracted, expected, deadline);
    await validateArchitecture(extracted, arch);
    for (const entry of extras) {
      if ([...expected.keys()].some(name => key(name) === key(entry.path))) throw new Error('Ambiguous NSIS installed extra');
      const filename = join(scratch, entry.path);
      const size = await extractOne(tool, candidate, entry, filename, deadline);
      source.set(entry.path, await hashFile(filename, deadline)); expected.set(entry.path, { ...entry, size });
    }
    const installed = await auditTree(await realpath(installedDirectory), expected, deadline);
    if ([...source].some(([name, hash]) => installed.get(name) !== hash)) throw new Error('Installed payload bytes differ from final NSIS artifact');
    return { status: 'verified', method: 'sha256-nsis-installed-tree', signing: 'not-asserted', assetSha256: expectedSha256 };
  } finally { await rm(scratch, { recursive: true, force: true }); }
}
