import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
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
test('packager rejects non-exact host Node before any output mutation', async () => {
  await assert.rejects(packageRuntime({ node: process.execPath, pnpmCli: '/missing', out: '/missing', scratch: '/missing', offline: true }), /INVALID_NODE/);
});

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
