import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { inspectTree, validatePnpm, prepareScratch, packageRuntime, validateFrozenManifest, removeGeneratedBins } from './package-runtime.mjs';

test('portable tree refuses symlinks rather than dereferencing dependencies', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    await fs.writeFile(path.join(root, 'plain'), 'ok');
    assert.equal((await inspectTree(root)).files, 1);
    await fs.symlink(path.join(root, 'plain'), path.join(root, 'link'));
    await assert.rejects(inspectTree(root), /UNSAFE_TREE/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('scratch refuses existing unowned directories and linked roots', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    await assert.rejects(prepareScratch(root), /UNOWNED_SCRATCH/);
    const owned = path.join(root, 'owned');
    await prepareScratch(owned);
    await prepareScratch(owned);
    await fs.symlink(owned, path.join(root, 'link'), 'junction');
    await assert.rejects(prepareScratch(path.join(root, 'link')), /UNSAFE_ROOT/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
test('genuine CLI admission rejects a wrapper or mismatched package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    await fs.mkdir(path.join(root, 'bin'));
    await fs.writeFile(path.join(root, 'bin/pnpm.mjs'), '');
    await fs.writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'pnpm', version: 'wrong', bin: { pnpm: 'bin/pnpm.mjs' } }));
    await assert.rejects(validatePnpm(path.join(root, 'bin/pnpm.mjs')), /INVALID_PNPM/);
  } finally { await fs.rm(root, { recursive: true, force: true }); }
});
for (const [version, expected] of [['v0.0.0', /INVALID_NODE/], ['v24.21.0', /INVALID_PNPM/]]) {
  test(`packager version admission ${version} refuses before installer/output mutation`, async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-version-test-'));
    const node = path.join(root, 'inert-node');
    const out = path.join(root, 'out'), scratch = path.join(root, 'scratch');
    const realSpawn = childProcess.spawn;
    const calls = [];
    let spawnMock;
    try {
      for (const folder of [out, scratch]) {
        await fs.mkdir(folder);
        await fs.writeFile(path.join(folder, 'keep.txt'), 'Original fixture bytes');
      }
      // Replace only the executable at the actual closedChild boundary. A real
      // inert Node child supplies an explicit version and its normal pipe/close
      // protocol; the test does not assume the verification host is nonmatching.
      spawnMock = t.mock.method(childProcess, 'spawn', (command, args, options) => {
        calls.push({ command, args });
        assert.equal(command, node);
        assert.deepEqual(args, ['--version']);
        return realSpawn(process.execPath, ['-e', `console.log(${JSON.stringify(version)})`], options);
      });
      syncBuiltinESMExports();
      await assert.rejects(packageRuntime({ node, pnpmCli: path.join(root, 'missing-pnpm'), out, scratch, store: path.join(scratch, 'store'), offline: true }), expected);
      assert.deepEqual(calls, [{ command: node, args: ['--version'] }], 'No installer child may start');
      assert.deepEqual((await fs.readdir(root)).sort(), ['out', 'scratch']);
      for (const folder of [out, scratch]) {
        assert.deepEqual(await fs.readdir(folder), ['keep.txt']);
        assert.equal(await fs.readFile(path.join(folder, 'keep.txt'), 'utf8'), 'Original fixture bytes');
      }
    } finally {
      spawnMock?.mock.restore();
      syncBuiltinESMExports();
      await fs.rm(root, { recursive: true });
    }
  });
}

test('frozen lock mismatch is refused before installer admission', async () => {
  const pkg = await fs.readFile(new URL('./runtime-tools/package.json', import.meta.url), 'utf8');
  const lock = await fs.readFile(new URL('./runtime-tools/pnpm-lock.yaml', import.meta.url));
  validateFrozenManifest(pkg, lock);
  assert.throws(() => validateFrozenManifest(pkg, Buffer.concat([lock, Buffer.from('changed') ])), /FROZEN_MANIFEST_MISMATCH/);
});
test('missing relocated local tooling cannot fall back to an ancestor package', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    const child = path.join(root, 'artifact');
    await fs.mkdir(path.join(child, 'runtime-tools'), {recursive:true});
    await fs.copyFile(new URL('./runtime-tools.mjs', import.meta.url), path.join(child, 'runtime-tools.mjs'));
    await fs.writeFile(path.join(child, 'runtime-tools/package.json'), '{}');
    const ancestor = path.join(root, 'node_modules/@npmcli/config');
    await fs.mkdir(ancestor, {recursive:true});
    await fs.writeFile(path.join(ancestor, 'package.json'), JSON.stringify({name:'@npmcli/config',version:'10.8.1',main:'index.js'}));
    await fs.writeFile(path.join(ancestor, 'index.js'), 'module.exports = {};');
    const {pathToFileURL} = await import('node:url');
    const {localRuntimePackage} = await import(pathToFileURL(path.join(child, 'runtime-tools.mjs')));
    assert.throws(() => localRuntimePackage('@npmcli/config', '10.8.1'), /TOOLING_UNAVAILABLE/);
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});

test('only an actual generated bin directory is removed; linked root is refused', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    const modules = path.join(root, 'node_modules');
    await fs.mkdir(modules);
    const bins = path.join(modules, '.bin');
    await fs.mkdir(bins);
    await fs.writeFile(path.join(root, 'retained'), 'license');
    await fs.symlink(path.join(root, 'retained'), path.join(bins, 'tool'));
    await removeGeneratedBins(root);
    assert.equal(await fs.readFile(path.join(root, 'retained'), 'utf8'), 'license');
    await fs.symlink(root, bins, 'junction');
    await assert.rejects(removeGeneratedBins(root), /UNSAFE_ROOT/);
    assert.equal(await fs.readFile(path.join(root, 'retained'), 'utf8'), 'license');
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});

test('relocation refuses missing closure and restores original marked artifact', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    const stage = path.join(root, 'stage');
    await fs.mkdir(stage);
    await fs.writeFile(path.join(stage, '.lawoss-runtime-build'), 'lawoss-engine-dependencies-v1\n');
    await fs.copyFile(new URL('./runtime-tools.mjs', import.meta.url), path.join(stage, 'runtime-tools.mjs'));
    const {relocationSmoke} = await import('./relocation-smoke.mjs');
    await assert.rejects(relocationSmoke({staged:stage,parent:root,node:process.execPath}), /CHILD_FAILED/);
    assert.equal((await fs.stat(stage)).isDirectory(), true);
    assert.deepEqual((await fs.readdir(root)).sort(), ['stage']);
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});

test('preexisting hidden artifact refuses before allocating relocation temporary root', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    const stage = path.join(root, 'stage');
    await fs.mkdir(stage);
    await fs.writeFile(path.join(stage, '.lawoss-runtime-build'), 'lawoss-engine-dependencies-v1\n');
    await fs.mkdir(`${stage}.hidden`);
    const before = (await fs.readdir(root)).sort();
    const {relocationSmoke} = await import('./relocation-smoke.mjs');
    await assert.rejects(relocationSmoke({staged:stage,parent:root,node:process.execPath}), /HIDDEN_EXISTS/);
    assert.deepEqual((await fs.readdir(root)).sort(), before);
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});

test('relocation cleanup retains primary error and attempts removal after restoration fails', async () => {
  const {cleanupRelocation} = await import('./relocation-smoke.mjs');
  const primary = Error('CHILD_FAILED');
  const restore = Error('restore failure');
  const remove = Error('remove failure');
  const calls = [];
  await cleanupRelocation({root:'owned',hidden:'hidden',staged:'staged',moved:true,primary}, {
    async rename() { calls.push('restore'); throw restore; },
    async rm() { calls.push('remove'); throw remove; },
  });
  assert.equal(primary.message, 'CHILD_FAILED');
  assert.deepEqual(primary.cleanup.errors, [restore, remove]);
  assert.deepEqual(calls, ['restore', 'remove']);
  await assert.rejects(cleanupRelocation({root:'owned',moved:false}, {
    async rm() { throw remove; },
  }), /RELOCATION_CLEANUP_FAILED/);
});

test('marked output replacement and failed publication restore the exact old tree', async () => {
  const {publishRuntime} = await import('./package-runtime.mjs');
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'runtime-test-'));
  try {
    const out = path.join(root, 'output');
    const stage = path.join(root, 'stage');
    await prepareScratch(out);
    await fs.writeFile(path.join(out, 'value'), 'old');
    await prepareScratch(stage);
    await fs.writeFile(path.join(stage, 'value'), 'new');
    await publishRuntime(stage, out);
    assert.equal(await fs.readFile(path.join(out, 'value'), 'utf8'), 'new');
    assert.deepEqual(await fs.readdir(root), ['output']);
    // The missing stage forces a genuine rename failure after old output backup.
    await assert.rejects(publishRuntime(stage, out), {code:'ENOENT'});
    assert.equal(await fs.readFile(path.join(out, 'value'), 'utf8'), 'new');
    assert.deepEqual(await fs.readdir(root), ['output']);
    await fs.mkdir(stage);
    await fs.mkdir(`${stage}-previous`);
    await fs.writeFile(path.join(`${stage}-previous`, 'keep'), 'unrelated');
    await assert.rejects(publishRuntime(stage, out), /BACKUP_EXISTS/);
    assert.equal(await fs.readFile(path.join(out, 'value'), 'utf8'), 'new');
    assert.equal(await fs.readFile(path.join(`${stage}-previous`, 'keep'), 'utf8'), 'unrelated');
    await fs.rm(path.join(out, '.lawoss-runtime-build'));
    await assert.rejects(publishRuntime(stage, out));
    assert.equal(await fs.readFile(path.join(out, 'value'), 'utf8'), 'new');
  } finally { await fs.rm(root, {recursive:true,force:true}); }
});

test('compound packaging cleanup retains primary identity and ordered nonenumerable failures', async () => {
  const {retainCleanupFailure} = await import('./package-runtime.mjs');
  const primary = Error('publish failed');
  const rollback = Error('rollback failed');
  const removal = Error('stage removal failed');
  assert.equal(retainCleanupFailure(primary, rollback), primary);
  assert.equal(primary.cleanup, rollback);
  assert.equal(retainCleanupFailure(primary, removal), primary);
  assert.ok(primary.cleanup instanceof AggregateError);
  assert.deepEqual(primary.cleanup.errors, [rollback, removal]);
  assert.equal(Object.getOwnPropertyDescriptor(primary, 'cleanup').enumerable, false);
  assert.equal(primary.message, 'publish failed');
});
