// Build caller only: pinned action output is trusted input, never PATH discovery.
// Copy data, never import/execute it. Internal symlinks are deliberately unsupported.
// Ownership checks coordinate cooperating CI tools, not hostile same-UID writers
// or Windows ACLs. Every failed/uncertain output is retained, never repaired.
import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { initialize, verifyWorkspace } from './prepare.mjs';

const invalid = () => { throw Object.assign(new Error('DESKTOP_PNPM_INPUT_INVALID'), { code: 'DESKTOP_PNPM_INPUT_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const stamp = stat => [stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
const unchanged = (a, b) => JSON.stringify(stamp(a)) === JSON.stringify(stamp(b));
const inside = (root, candidate) => {
  const relative = path.relative(root, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
};
function inputPaths(input) {
  if (!input || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) invalid();
  const fields = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(fields);
  if (keys.length !== 2 || keys.some(key => typeof key !== 'string' || !['installRoot', 'outputRoot'].includes(key))) invalid();
  const values = ['installRoot', 'outputRoot'].map(key => {
    const field = fields[key];
    if (!field?.enumerable || !Object.hasOwn(field, 'value')) invalid();
    const value = field.value;
    if (typeof value !== 'string' || value.length > 4096 || !path.isAbsolute(value) || path.resolve(value) !== value || /[\r\n\0]/.test(value)) invalid();
    return value;
  });
  const [installRoot, outputRoot] = values;
  // The SDK generation has a fixed name in the original product caller. Keep
  // the normalized tool outside that namespace, including its parent relation.
  const sdkRoot = fileURLToPath(new URL('../../../apps/desktop/resources/.plugin-sdk-build', import.meta.url));
  if (inside(installRoot, outputRoot) || inside(outputRoot, installRoot) || inside(sdkRoot, outputRoot) || inside(outputRoot, sdkRoot) ||
    outputRoot.split(path.sep).some(part => part === '.plugin-sdk-build' || part.startsWith('..plugin-sdk-build.'))) invalid();
  return { installRoot, outputRoot };
}
async function physical(directory) {
  const stat = await fs.lstat(directory);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(directory) !== directory) invalid();
  return stat;
}
async function absent(file) {
  try { await fs.lstat(file); }
  catch (error) { if (Object.getOwnPropertyDescriptor(error, 'code')?.value === 'ENOENT') return; throw error; }
  invalid();
}
async function regular(file, check, independent = false, limit = 32 * 1024 * 1024) {
  await check();
  const before = await fs.lstat(file);
  const acceptable = stat => stat.isFile() && !stat.isSymbolicLink() && stat.size <= limit && (!independent || stat.nlink === 1);
  if (!acceptable(before) || await fs.realpath(file) !== file) invalid();
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!unchanged(before, await handle.stat())) invalid();
    const chunks = [], hash = createHash('sha256'), buffer = Buffer.alloc(65536);
    let total = 0;
    while (true) {
      const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, limit + 1 - total), null);
      if (!bytesRead) break;
      total += bytesRead;
      if (total > limit) invalid();
      const chunk = Buffer.from(buffer.subarray(0, bytesRead));
      chunks.push(chunk); hash.update(chunk);
    }
    await check();
    const after = await fs.lstat(file);
    if (total !== before.size || !acceptable(after) || !unchanged(before, after) || !unchanged(before, await handle.stat()) || await fs.realpath(file) !== file) invalid();
    return { stat: before, sha256: hash.digest('hex'), bytes: Buffer.concat(chunks) };
  } finally { await handle.close(); }
}
async function inventory(root, checkRoot, independent = false) {
  const entries = [], directories = new Map();
  let total = 0, count = 0;
  async function visit(relative, depth) {
    if (depth > 64 || ++count > 30000) invalid();
    await checkRoot();
    // Recheck every observed ancestor before inspecting an uncertain child.
    for (let name = relative; ; name = path.dirname(name) === '.' ? '' : path.dirname(name)) {
      const identity = directories.get(name);
      if (identity && !unchanged(identity, await physical(path.join(root, name)))) invalid();
      if (!name) break;
    }
    const file = path.join(root, relative), stat = await fs.lstat(file);
    if (stat.isSymbolicLink()) invalid();
    if (stat.isDirectory()) {
      if (await fs.realpath(file) !== file) invalid();
      directories.set(relative, stat);
      entries.push({ path: relative, kind: 'directory', stat });
      const names = [], directory = await fs.opendir(file);
      for await (const entry of directory) {
        if (count + names.length >= 30000) invalid();
        names.push(entry.name);
      }
      names.sort();
      for (const name of names) await visit(path.join(relative, name), depth + 1);
      if (!unchanged(stat, await physical(file))) invalid();
    } else {
      if (!stat.isFile() || stat.size > 32 * 1024 * 1024 || (total += stat.size) > 256 * 1024 * 1024) invalid();
      const value = await regular(file, checkRoot, independent);
      if (!unchanged(stat, value.stat)) invalid();
      entries.push({ path: relative, kind: 'file', stat, sha256: value.sha256 });
    }
  }
  await visit('', 0);
  return entries;
}
const sourceBinding = entries => JSON.stringify(entries.map(entry => [entry.path, entry.kind, stamp(entry.stat), entry.sha256]));
const contentBinding = entries => JSON.stringify(entries.map(entry => [entry.path, entry.kind, entry.stat.mode & 0o7777, entry.kind === 'file' ? entry.stat.size : null, entry.sha256]));

/** Materialize only the explicit trusted pnpm/action-setup package, as inert data. */
export async function prepareDesktopPnpmInput(input) {
  try {
    const { installRoot, outputRoot } = inputPaths(input);
    const parent = path.dirname(outputRoot), parentIdentity = await physical(parent), installIdentity = await physical(installRoot);
    const modules = path.join(installRoot, 'node_modules'), modulesIdentity = await physical(modules);
    // This sole alias resolution is intentional; all copied package children
    // must be canonical physical directories/files, with no internal links.
    const alias = path.join(modules, 'pnpm'), sourceRoot = await fs.realpath(alias);
    if (!inside(installRoot, sourceRoot) || sourceRoot === installRoot || inside(sourceRoot, outputRoot) || inside(outputRoot, sourceRoot)) invalid();
    const sourceIdentity = await physical(sourceRoot);
    const checkSource = async () => {
      if (!same(installIdentity, await physical(installRoot)) || !same(modulesIdentity, await physical(modules)) ||
        await fs.realpath(alias) !== sourceRoot || !unchanged(sourceIdentity, await physical(sourceRoot))) invalid();
    };
    const checkParent = async () => { if (!same(parentIdentity, await physical(parent))) invalid(); };
    await checkParent(); await absent(outputRoot);
    const pkg = await regular(path.join(sourceRoot, 'package.json'), checkSource, false, 65536);
    const metadata = JSON.parse(pkg.bytes.toString('utf8'));
    if (!metadata || metadata.name !== 'pnpm' || metadata.version !== '11.4.0' || metadata.bin?.pnpm !== 'bin/pnpm.mjs') invalid();
    const cli = await regular(path.join(sourceRoot, 'bin/pnpm.mjs'), checkSource, false, 16 * 1024 * 1024);
    if (!cli.stat.size) invalid();
    const before = await inventory(sourceRoot, checkSource);
    if (!before.some(entry => entry.path === 'package.json' && entry.sha256 === pkg.sha256 && unchanged(entry.stat, pkg.stat)) ||
      !before.some(entry => entry.path === path.join('bin', 'pnpm.mjs') && entry.sha256 === cli.sha256 && unchanged(entry.stat, cli.stat))) invalid();
    await checkParent(); await absent(outputRoot);
    await initialize(outputRoot);
    await checkParent();
    const outputIdentity = await physical(outputRoot);
    const checkOutput = async () => {
      await checkParent();
      if (!same(outputIdentity, await physical(outputRoot))) invalid();
      await verifyWorkspace(outputRoot);
    };
    await checkOutput();
    const packageRoot = path.join(outputRoot, 'pnpm');
    await fs.mkdir(packageRoot, { mode: 0o700 });
    const destinations = new Map([['', await physical(packageRoot)]]);
    const checkDestination = async relative => {
      await checkOutput();
      for (let name = relative; ; name = path.dirname(name) === '.' ? '' : path.dirname(name)) {
        const identity = destinations.get(name);
        if (identity && !same(identity, await physical(path.join(packageRoot, name)))) invalid();
        if (!name) break;
      }
    };
    for (const entry of before) {
      if (!entry.path) continue;
      await checkSource(); await checkDestination(entry.path);
      const to = path.join(packageRoot, entry.path);
      if (entry.kind === 'directory') {
        await fs.mkdir(to, { mode: 0o700 }); destinations.set(entry.path, await physical(to));
      } else {
        const from = await regular(path.join(sourceRoot, entry.path), checkSource);
        if (!unchanged(entry.stat, from.stat) || entry.sha256 !== from.sha256) invalid();
        await checkDestination(entry.path);
        const handle = await fs.open(to, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600);
        try {
          await checkDestination(entry.path);
          await handle.writeFile(from.bytes); await handle.chmod(entry.stat.mode & 0o7777);
          const copied = await handle.stat();
          if (!copied.isFile() || copied.nlink !== 1 || same(copied, from.stat)) invalid();
        } finally { await handle.close(); }
      }
    }
    for (const entry of [...before].reverse()) {
      if (entry.kind === 'directory') { await checkDestination(entry.path); await fs.chmod(path.join(packageRoot, entry.path), entry.stat.mode & 0o7777); }
    }
    const after = await inventory(packageRoot, () => checkDestination(''), true);
    const sourceFiles = new Set(before.filter(entry => entry.kind === 'file').map(entry => `${entry.stat.dev}:${entry.stat.ino}`));
    if (contentBinding(before) !== contentBinding(after) || after.some(entry => entry.kind === 'file' && sourceFiles.has(`${entry.stat.dev}:${entry.stat.ino}`))) invalid();
    if (sourceBinding(before) !== sourceBinding(await inventory(sourceRoot, checkSource))) invalid();
    await checkSource(); await checkOutput();
    const pnpmCli = path.join(packageRoot, 'bin/pnpm.mjs');
    if (await fs.realpath(pnpmCli) !== pnpmCli) invalid();
    return Object.freeze({ root: outputRoot, pnpmCli });
  } catch { invalid(); } // Do not publish raw OS messages, paths or external getters.
}
