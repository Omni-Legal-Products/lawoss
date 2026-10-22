import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { prepareProductSdkPackaging } from './product-packaging.mjs';
import { verifyWorkspace } from './prepare.mjs';

// Dynamic import lets RED state the missing API instead of failing test discovery.
const normalize = async input => {
  const module = await import('./desktop-pnpm-input.mjs').catch(error => {
    if (error.code === 'ERR_MODULE_NOT_FOUND') return {};
    throw error;
  });
  assert.equal(typeof module.prepareDesktopPnpmInput, 'function', 'caller normalization API must exist');
  return module.prepareDesktopPnpmInput(input);
};
const invalid = { code: 'DESKTOP_PNPM_INPUT_INVALID', message: 'DESKTOP_PNPM_INPUT_INVALID' };
const cliBytes = "throw new Error('INERT_PNPM_MUST_NEVER_EXECUTE');\n";
const deepBytes = "throw new Error('INERT_DIST_MUST_NEVER_EXECUTE');\n";
async function fixture(t, alias = true) {
  const base = await fs.realpath(await fs.mkdtemp(path.join(tmpdir(), 'lawoss-desktop-pnpm-')));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const installRoot = path.join(base, 'action'), source = path.join(installRoot, 'node_modules', alias ? '.pnpm/pnpm@11.4.0/node_modules/pnpm' : 'pnpm');
  await fs.mkdir(path.join(source, 'bin'), { recursive: true });
  await fs.mkdir(path.join(source, 'dist/node_modules/nested'), { recursive: true });
  await fs.mkdir(path.join(source, 'empty'));
  await fs.writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'pnpm', version: '11.4.0', bin: { pnpm: 'bin/pnpm.mjs' } }));
  const store = path.join(base, 'external-store');
  await fs.writeFile(store, cliBytes, { mode: 0o755 });
  await fs.link(store, path.join(source, 'bin/pnpm.mjs'));
  await fs.writeFile(path.join(source, 'dist/node_modules/nested/index.cjs'), deepBytes, { mode: 0o644 });
  await fs.writeFile(path.join(source, 'LICENSE'), 'inert license\n');
  if (alias) await fs.symlink(source, path.join(installRoot, 'node_modules/pnpm'), process.platform === 'win32' ? 'junction' : 'dir');
  return { base, installRoot, outputRoot: path.join(base, 'normalized'), source, store };
}
async function packaging(f, pnpmCli, label) {
  const desktopRoot = path.join(f.base, label);
  await fs.mkdir(path.join(desktopRoot, 'resources'), { recursive: true });
  return { desktopRoot, target: { platform: process.platform, arch: process.arch, ...(process.platform === 'linux' ? { libc: 'glibc' } : {}) },
    applicationBuild: { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0', gitSha: 'a'.repeat(40), buildEpoch: '1700000000',
      platform: process.platform, arch: process.arch, channel: 'alpha', workflowRunUrl: '' },
    supplier: { mode: 'native', consumerNode: await fs.realpath(process.execPath), pnpmCli, headSha: 'b'.repeat(40), checkoutSha: 'a'.repeat(40) } };
}
async function unchanged(f) {
  assert.equal(await fs.readFile(f.store, 'utf8'), cliBytes);
  assert.equal(await fs.readFile(path.join(f.source, 'bin/pnpm.mjs'), 'utf8'), cliBytes);
  assert.equal((await fs.lstat(f.store)).nlink, 2);
  assert.equal(await fs.readFile(path.join(f.source, 'dist/node_modules/nested/index.cjs'), 'utf8'), deepBytes);
}

test('complete aliased store package becomes independent canonical data and reaches the original wrong-consumer failure', async t => {
  assert.equal(process.version, 'v24.21.0', 'use the pinned build runtime; it is deliberately the wrong Node22 consumer');
  const f = await fixture(t);
  await fs.link(path.join(f.source, 'package.json'), path.join(f.base, 'external-metadata-store'));
  const sourceNames = ['', 'LICENSE', 'bin', 'bin/pnpm.mjs', 'dist', 'dist/node_modules', 'dist/node_modules/nested',
    'dist/node_modules/nested/index.cjs', 'empty', 'package.json'];
  const sourceSnapshot = () => Promise.all(sourceNames.map(async name => {
    const stat = await fs.lstat(path.join(f.source, name));
    return [name, stat.dev, stat.ino, stat.mode, stat.nlink, stat.size, stat.mtimeMs, stat.ctimeMs];
  }));
  const originalSource = await sourceSnapshot();
  for (const [label, cli] of [['direct-alias', path.join(f.installRoot, 'node_modules/pnpm/bin/pnpm.mjs')],
    ['direct-hardlink', path.join(f.source, 'bin/pnpm.mjs')]]) {
    const input = await packaging(f, cli, label);
    await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_PACKAGING_INVALID' });
    assert.deepEqual(await fs.readdir(path.join(input.desktopRoot, 'resources')), []);
  }
  const result = await normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(result.root, f.outputRoot);
  await verifyWorkspace(result.root);
  assert.equal(result.pnpmCli, path.join(result.root, 'pnpm/bin/pnpm.mjs'));
  assert.equal(await fs.realpath(result.pnpmCli), result.pnpmCli);
  for (const name of ['package.json', 'bin/pnpm.mjs', 'dist/node_modules/nested/index.cjs', 'LICENSE']) {
    const from = path.join(f.source, name), to = path.join(result.root, 'pnpm', name);
    const before = await fs.lstat(from), after = await fs.lstat(to);
    assert.deepEqual(await fs.readFile(to), await fs.readFile(from));
    assert.equal(after.isFile() && !after.isSymbolicLink(), true);
    assert.equal(after.nlink, 1);
    assert.equal(before.dev === after.dev && before.ino === after.ino, false);
    assert.equal(after.mode & 0o777, before.mode & 0o777);
  }
  assert.deepEqual(await fs.readdir(path.join(result.root, 'pnpm')).then(names => names.sort()), ['LICENSE', 'bin', 'dist', 'empty', 'package.json']);
  assert.deepEqual(await fs.readdir(path.join(result.root, 'pnpm/empty')), []);
  await unchanged(f);
  assert.deepEqual(await sourceSnapshot(), originalSource);
  const input = await packaging(f, result.pnpmCli, 'normalized-desktop');
  await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_NATIVE_CHILD_FAILED' });
  const parent = path.join(input.desktopRoot, 'resources'), generation = path.join(parent, '.plugin-sdk-build');
  const summary = JSON.parse(await fs.readFile(path.join(generation, 'supplier/runtime-consumer-summary.json'), 'utf8'));
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failedStage, 'admission');
  assert.equal(summary.code, 'CONSUMER_VERSION');
  assert.equal(summary.headSha, 'b'.repeat(40));
  assert.equal(summary.checkoutSha, 'a'.repeat(40));
  for (const value of [summary.producer, summary.tests.producer, summary.tests.consumer, summary.payloadManifestSha256, summary.acquisition]) assert.equal(value, null);
  assert.deepEqual((await fs.readdir(parent)).sort(), ['..plugin-sdk-build.generation.lock', '.plugin-sdk-build']);
  await verifyWorkspace(path.join(generation, 'supplier/runtime-consumer-validation'));
  assert.equal((await fs.readdir(generation)).includes('publication'), false);
  await unchanged(f);
  assert.deepEqual(await sourceSnapshot(), originalSource);
});

test('existing unknown or owned outputs are retained and never adopted', async t => {
  const f = await fixture(t, false);
  await fs.mkdir(f.outputRoot);
  await fs.writeFile(path.join(f.outputRoot, 'sentinel'), 'unknown');
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  assert.equal(await fs.readFile(path.join(f.outputRoot, 'sentinel'), 'utf8'), 'unknown');
  const owned = path.join(f.base, 'owned');
  await normalize({ installRoot: f.installRoot, outputRoot: owned });
  const owner = await fs.readFile(path.join(owned, '.owner.json'));
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: owned }), invalid);
  assert.deepEqual(await fs.readFile(path.join(owned, '.owner.json')), owner);
  await unchanged(f);
});

test('original direct supplier also rejects a directory alias with singlelink CLI bytes', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.source, 'bin/pnpm.mjs'));
  await fs.writeFile(path.join(f.source, 'bin/pnpm.mjs'), cliBytes);
  const input = await packaging(f, path.join(f.installRoot, 'node_modules/pnpm/bin/pnpm.mjs'), 'singlelink-alias');
  assert.equal((await fs.lstat(input.supplier.pnpmCli)).nlink, 1);
  await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_PACKAGING_INVALID' });
  assert.deepEqual(await fs.readdir(path.join(input.desktopRoot, 'resources')), []);
});

test('overlap, noncanonical output, unknown fields and getters refuse without executing getters', async t => {
  const f = await fixture(t);
  for (const outputRoot of [path.join(f.installRoot, 'copy'), f.base, `${f.base}/x/../copy`, path.join(f.base, '.plugin-sdk-build/copy')]) {
    await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot }), invalid);
  }
  let calls = 0;
  for (const value of [{ get installRoot() { calls++; throw new Error('PRIVATE'); }, outputRoot: f.outputRoot },
    { installRoot: f.installRoot, outputRoot: f.outputRoot, extra: true }, null]) await assert.rejects(normalize(value), invalid);
  assert.equal(calls, 0);
  await unchanged(f);
});

test('wrong package metadata and exact CLI binding refuse before copying', async t => {
  const f = await fixture(t);
  for (const metadata of ['PRIVATE_BAD_JSON{', 'null', '[]', JSON.stringify({ name: 'pnpm', version: '11.3.0', bin: { pnpm: 'bin/pnpm.mjs' } }),
    JSON.stringify({ name: 'pnpm', version: '11.4.0', bin: { pnpm: '../outside.mjs' } })]) {
    await fs.writeFile(path.join(f.source, 'package.json'), metadata);
    await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
    await assert.rejects(fs.lstat(f.outputRoot), { code: 'ENOENT' });
  }
});

test('source file drift during copying fails and retains the failed owned root', async t => {
  const f = await fixture(t);
  const original = fs.open;
  let changed = false;
  const replace = t.mock.method(fs, 'open', async function (file, ...args) {
    const result = await original.call(this, file, ...args);
    if (!changed && String(file).startsWith(`${f.outputRoot}${path.sep}`) && String(file).endsWith('pnpm.mjs')) {
      changed = true;
      await fs.writeFile(path.join(f.source, 'dist/node_modules/nested/index.cjs'), 'changed-source-data');
    }
    return result;
  });
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  replace.mock.restore();
  assert.equal(changed, true);
  await verifyWorkspace(f.outputRoot);
  assert.equal(await fs.readFile(f.store, 'utf8'), cliBytes);
});

test('substituted output root is refused before inspecting its children', async t => {
  const f = await fixture(t), moved = path.join(f.base, 'retained-original');
  const original = fs.open, read = fs.opendir;
  let replaced = false, inspected = false;
  const replace = t.mock.method(fs, 'open', async function (file, ...args) {
    const result = await original.call(this, file, ...args);
    if (!replaced && String(file).startsWith(`${f.outputRoot}${path.sep}`) && String(file).endsWith('pnpm.mjs')) {
      await fs.rename(f.outputRoot, moved);
      await fs.mkdir(f.outputRoot);
      await fs.writeFile(path.join(f.outputRoot, 'sentinel'), 'replacement');
      replaced = true;
    }
    return result;
  });
  const inspection = t.mock.method(fs, 'opendir', async function (file, ...args) {
    if (replaced && String(file).startsWith(f.outputRoot)) inspected = true;
    return read.call(this, file, ...args);
  });
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  replace.mock.restore(); inspection.mock.restore();
  assert.equal(replaced, true); assert.equal(inspected, false);
  assert.equal(await fs.readFile(path.join(f.outputRoot, 'sentinel'), 'utf8'), 'replacement');
  await verifyWorkspace(moved);
  await unchanged(f);
});

for (const kind of ['source', 'parent']) test(`substituted ${kind} is refused before inspecting replacement children`, async t => {
  const f = await fixture(t), parent = path.join(f.base, 'explicit-parent');
  await fs.mkdir(parent);
  f.outputRoot = path.join(parent, 'normalized');
  const victim = kind === 'source' ? f.source : parent, moved = path.join(f.base, `retained-${kind}`);
  const original = fs.open, stat = fs.lstat;
  let replaced = false, inspected = false;
  const replace = t.mock.method(fs, 'open', async function (file, ...args) {
    const result = await original.call(this, file, ...args);
    if (!replaced && String(file).startsWith(`${f.outputRoot}${path.sep}`) && String(file).endsWith('pnpm.mjs')) {
      await fs.rename(victim, moved); await fs.mkdir(victim);
      await fs.writeFile(path.join(victim, 'sentinel'), 'replacement'); replaced = true;
    }
    return result;
  });
  const inspection = t.mock.method(fs, 'lstat', async function (file, ...args) {
    if (replaced && String(file).startsWith(`${victim}${path.sep}`)) inspected = true;
    return stat.call(this, file, ...args);
  });
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  replace.mock.restore(); inspection.mock.restore();
  assert.equal(replaced, true); assert.equal(inspected, false);
  assert.equal(await fs.readFile(path.join(victim, 'sentinel'), 'utf8'), 'replacement');
  await verifyWorkspace(kind === 'source' ? f.outputRoot : path.join(moved, 'normalized'));
  assert.equal(await fs.readFile(f.store, 'utf8'), cliBytes);
});

test('external error fields are not read or exposed', async t => {
  const f = await fixture(t);
  let reads = 0;
  const external = Object.defineProperties({}, { code: { get() { reads++; throw new Error('PRIVATE'); } },
    message: { get() { reads++; throw new Error('PRIVATE'); } } });
  for (const [method, target] of [['open', path.join(f.source, 'package.json')], ['lstat', f.outputRoot]]) {
    const original = fs[method];
    const failure = t.mock.method(fs, method, async function (file, ...args) {
      if (String(file) === target) throw external;
      return original.call(this, file, ...args);
    });
    await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
    failure.mock.restore(); assert.equal(reads, 0);
  }
  await unchanged(f);
});

test('physical FIFO is refused without opening it', { skip: process.platform === 'win32' ? 'POSIX FIFO fixture' : false }, async t => {
  const f = await fixture(t);
  execFileSync('/usr/bin/mkfifo', [path.join(f.source, 'fifo')]);
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  await unchanged(f);
});

test('package directory alias cannot escape the explicit installation', async t => {
  const f = await fixture(t);
  await fs.unlink(path.join(f.installRoot, 'node_modules/pnpm'));
  await fs.symlink(f.base, path.join(f.installRoot, 'node_modules/pnpm'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
});

test('internal file symlinks and escaping directory links are explicitly unsupported', { skip: process.platform === 'win32' ? 'POSIX file symlink privileges; directory junction alias covered above' : false }, async t => {
  const f = await fixture(t);
  for (const target of [f.store, path.join(f.source, 'LICENSE')]) {
    const link = path.join(f.source, 'internal-link');
    await fs.symlink(target, link);
    await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
    await fs.unlink(link);
  }
  await fs.symlink(f.base, path.join(f.source, 'escape'), 'dir');
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  await unchanged(f);
});

test('oversized actual source files and excessive depth refuse without a copy', async t => {
  const f = await fixture(t), file = path.join(f.source, 'large');
  const handle = await fs.open(file, 'wx');
  await handle.truncate(32 * 1024 * 1024 + 1); await handle.close();
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  await fs.unlink(file);
  await fs.mkdir(path.join(f.source, ...Array(65).fill('d')), { recursive: true });
  await assert.rejects(normalize({ installRoot: f.installRoot, outputRoot: f.outputRoot }), invalid);
  await unchanged(f);
});
