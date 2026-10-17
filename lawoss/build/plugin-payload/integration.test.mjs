import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir, mkdtemp, realpath, rm, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { initialize, prepare, runChild } from './prepare.mjs';
import * as validation from './validate.mjs';

const source = process.env.PAYLOAD_VALIDATION_WORKSPACE;
const require = createRequire(new URL('./tools/package.json', import.meta.url));
const Arborist = require('@npmcli/arborist');
const arboristRequire = createRequire(require.resolve('@npmcli/arborist'));
const cacache = arboristRequire('cacache');
async function workspace(t, populated = true) {
  const base = new URL('./.work/test-fixtures/', import.meta.url);
  await mkdir(base, { recursive: true });
  const parent = await realpath(await mkdtemp(path.join(await realpath(base), 'sdk-integration-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = path.join(parent, 'owned'); await initialize(root);
  if (populated) await cp(path.join(source, 'cache'), path.join(root, 'cache'), { recursive: true });
  return root;
}

test('genuine offline SDK replay reproduces hashes, target-native load and relocated ESM imports', { skip: !source }, async t => {
  const root = await workspace(t);
  const first = await prepare({ workspace: root, outputName: 'first', signal: t.signal });
  const second = await prepare({ workspace: root, outputName: 'second', signal: t.signal });
  const a = await validation.verifyPayload(first, Arborist);
  const b = await validation.verifyPayload(second, Arborist);
  assert.deepEqual(a, b);
  assert.equal(a.imports.imports.length, 10);
  assert.equal(a.imports.native, 'loaded');
  assert.deepEqual(a.target, { platform: process.platform, arch: process.arch });
  const relocated = path.join(root, 'relocated žluťoučký SDK space');
  await cp(first, relocated, { recursive: true, verbatimSymlinks: true });
  assert.deepEqual(await validation.verifyPayload(relocated, Arborist), a);
  const probe = path.join(relocated, '.payload-import-check.mjs');
  await writeFile(probe, await readFile(new URL('./import-check.mjs', import.meta.url)));
  const imports = await runChild([probe, relocated], root);
  await rm(probe);
  assert.deepEqual(imports, a.imports);
  assert.deepEqual(await validation.verifyPayload(relocated, Arborist), a);
  const zodFile = path.join(relocated, 'node_modules/zod/index.js');
  const zodBytes = await readFile(zodFile);
  await writeFile(zodFile, 'corruption');
  await assert.rejects(validation.verifyPayload(relocated, Arborist), { code: 'PAYLOAD_INVALID' });
  await writeFile(zodFile, zodBytes);
  const pkgFile = path.join(relocated, 'node_modules/zod/package.json');
  const pkgBytes = await readFile(pkgFile);
  const pkg = JSON.parse(pkgBytes); pkg.version = '0.0.1'; await writeFile(pkgFile, JSON.stringify(pkg));
  const lock = JSON.parse(await readFile(path.join(relocated, 'package-lock.json')));
  await assert.rejects(validation.validatePhysical(relocated, lock, a.closure, Arborist), { code: 'PHYSICAL_INVALID' });
  await writeFile(pkgFile, pkgBytes);
  await rm(path.join(relocated, 'node_modules/@opencode-ai/plugin/dist/tool.js'));
  await writeFile(probe, await readFile(new URL('./import-check.mjs', import.meta.url)));
  await assert.rejects(runChild([probe, relocated], root), { code: 'ERR_MODULE_NOT_FOUND' });
  await rm(probe);
  await assert.rejects(validation.verifyPayload(relocated, Arborist), { code: 'PAYLOAD_INVALID' });
});

test('clean missing-cache offline replay fails without network or publishable residue', { skip: !source }, async t => {
  const root = await workspace(t, false);
  await assert.rejects(prepare({ workspace: root, signal: t.signal }), { code: 'ENOTCACHED' });
  assert.equal((await readdir(root)).includes('payload'), false);
  assert.deepEqual((await readdir(root)).filter(name => name.startsWith('.stage-')), []);
});

test('corrupt required SDK cache content cannot be published or repaired online', { skip: !source }, async t => {
  const root = await workspace(t);
  const cache = path.join(root, 'cache');
  const entries = await cacache.ls(cache);
  const key = Object.keys(entries).find(key => key.includes('/plugin/-/plugin-1.18.29.tgz'));
  assert.ok(key, 'genuine SDK tarball is present in the private Arborist cache');
  const info = await cacache.get.info(cache, key);
  await writeFile(info.path, 'corrupt required SDK');
  await assert.rejects(prepare({ workspace: root, signal: t.signal }));
  assert.equal((await readdir(root)).includes('payload'), false);
});


test('corrupt target-applicable optional native cache cannot silently shrink the physical closure', { skip: !source }, async t => {
  const root = await workspace(t);
  const cache = path.join(root, 'cache');
  const entries = await cacache.ls(cache);
  const targetName = `msgpackr-extract-${process.platform}-${process.arch}`;
  const key = Object.keys(entries).find(key => key.includes(`/${targetName}/-/`));
  assert.ok(key, 'actual host native tarball is cached');
  const info = await cacache.get.info(cache, key);
  await writeFile(info.path, 'corrupt host native');
  await assert.rejects(prepare({ workspace: root, signal: t.signal }), { code: 'PHYSICAL_INVALID' });
  assert.equal((await readdir(root)).includes('payload'), false);
});
