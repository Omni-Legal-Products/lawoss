import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as payload from './prepare.mjs';

test('fixed input validation refuses missing, fake root-only and changed manifests', () => {
  for (const lock of [undefined, {}, { lockfileVersion: 3, packages: { '': payload.INPUT } }]) {
    assert.throws(() => payload.validateInputs(payload.INPUT, lock), { code: 'INPUT_INVALID' });
  }
  assert.throws(() => payload.validateInputs({ ...payload.INPUT, scripts: { install: 'false' } }, {}), { code: 'INPUT_INVALID' });
});

import { mkdtemp, mkdir, writeFile, readFile, symlink, link, rm, readdir, realpath, lstat } from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { snapshot, unchangedGraph, inventory } from './validate.mjs';

const fixture = async t => {
  const base = new URL('./.work/test-fixtures/', import.meta.url);
  await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(await realpath(base), 'sdk-payload-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
};

test('graph baseline detaches nested metadata and edge resolutions; drift is refused without repair', () => {
  const node = { location: '', name: 'root', version: '1.0.0', package: { dependencies: { sdk: '1' } }, edgesOut: new Map([['sdk', { name: 'sdk', spec: '1', type: 'prod', to: { location: 'node_modules/sdk' }, valid: true }]]) };
  const tree = { inventory: new Map([['', node]]) };
  const before = snapshot(tree);
  node.package.dependencies.sdk = '2';
  node.edgesOut.get('sdk').to.location = 'node_modules/drift';
  assert.equal(before[0].package.dependencies.sdk, '1');
  assert.equal(before[0].edges[0].to, 'node_modules/sdk');
  assert.throws(() => unchangedGraph(before, tree), { code: 'GRAPH_DRIFT' });
  assert.equal(node.package.dependencies.sdk, '2');
});

test('inventory catches file corruption, outside/bin links and hardlinks', async t => {
  const root = await fixture(t);
  const tree = path.join(root, 'tree');
  await mkdir(path.join(tree, 'node_modules/.bin'), { recursive: true });
  await writeFile(path.join(tree, 'data'), 'a');
  const before = await inventory(tree);
  await writeFile(path.join(tree, 'data'), 'b');
  assert.notDeepEqual(await inventory(tree), before);
  await symlink('../../../../outside', path.join(tree, 'node_modules/.bin/bad'), 'file');
  await assert.rejects(inventory(tree));
  await rm(path.join(tree, 'node_modules/.bin/bad'));
  await link(path.join(tree, 'data'), path.join(tree, 'copy'));
  await assert.rejects(inventory(tree), { code: 'TREE_UNSAFE' });
});

test('owned publication rejects outside paths, symlink ancestors, collision and concurrent writer', async t => {
  const root = await fixture(t);
  const workspace = path.join(root, 'owned');
  await payload.initialize(workspace);
  await assert.rejects(payload.initialize(workspace), { code: 'WORKSPACE_INVALID' });
  await assert.rejects(payload.transaction(root, 'out', async () => {}), { code: 'WORKSPACE_INVALID' });
  await assert.rejects(payload.transaction(workspace, '../out', async () => {}), { code: 'OUTPUT_INVALID' });
  await symlink(workspace, path.join(root, 'alias'), 'dir');
  await assert.rejects(payload.transaction(path.join(root, 'alias'), 'out', async () => {}), { code: 'WORKSPACE_INVALID' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const ready = new Promise(resolve => { entered = resolve; });
  const first = payload.transaction(workspace, 'out', async stage => { entered(); await gate; await writeFile(path.join(stage, 'payload-manifest.json'), '{}'); });
  await ready;
  await assert.rejects(payload.transaction(workspace, 'out', async () => {}), { code: 'OUTPUT_BUSY' });
  release(); await first;
  await assert.rejects(payload.transaction(workspace, 'out', async () => {}), { code: 'OUTPUT_EXISTS' });
  assert.equal(await readFile(path.join(workspace, 'out/payload-manifest.json'), 'utf8'), '{}');
});

test('failed and cancelled operations remove only their exact stage and retain primary error', async t => {
  const root = await fixture(t);
  const workspace = path.join(root, 'owned');
  await payload.initialize(workspace);
  await writeFile(path.join(workspace, 'untouched'), 'keep');
  const primary = new Error('synthetic primary');
  await assert.rejects(payload.transaction(workspace, 'out', async stage => { await writeFile(path.join(stage, 'partial'), 'x'); throw primary; }), error => error === primary);
  assert.deepEqual((await readdir(workspace)).filter(name => name.startsWith('.stage-')), []);
  await assert.rejects(payload.transaction(workspace, 'out', async () => {}), { code: 'PUBLICATION_INVALID' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(payload.prepare({ workspace, outputName: 'cancelled', signal: controller.signal }), { code: 'CANCELLED' });
  assert.equal(await readFile(path.join(workspace, 'untouched'), 'utf8'), 'keep');
});

test('isolated child environment excludes provider secrets, npm config and NODE_OPTIONS', () => {
  process.env.PAYLOAD_TEST_SECRET = 'secret';
  try {
    const workspace = path.resolve('owned');
    const env = payload.childEnvironment(workspace);
    assert.equal(env.PAYLOAD_TEST_SECRET, undefined);
    assert.equal(env.NODE_OPTIONS, undefined);
    assert.equal(env.HOME, path.join(workspace, 'home'));
    assert.equal(env.npm_config_userconfig, path.join(workspace, 'empty-npmrc'));
  } finally { delete process.env.PAYLOAD_TEST_SECRET; }
});

test('offline guard denies TCP, TLS, UDP, DNS and fetch before clients load', () => {
  const guard = new URL('./network-guard.mjs', import.meta.url).href;
  const probe = `import net from 'node:net'; import tls from 'node:tls'; import dns from 'node:dns'; import dgram from 'node:dgram';
for (const fn of [()=>net.connect(9,'127.0.0.1'), ()=>tls.connect(9,'127.0.0.1'), ()=>dns.lookup('example.com'), ()=>dns.promises.lookup('example.com'), ()=>dgram.createSocket('udp4').send('x',9,'127.0.0.1')]) { try { await fn(); throw Error('allowed'); } catch(e) { if(e.code!=='NETWORK_DISABLED') throw e; } } try { await fetch('https://example.com'); throw Error('allowed'); } catch(e) { if(e.cause?.code!=='NETWORK_DISABLED' && e.code!=='NETWORK_DISABLED') throw e; }`;
  const child = spawnSync(process.execPath, ['--import', guard, '--input-type=module', '-e', probe], { timeout: 5000, encoding: 'utf8', env: payload.childEnvironment(path.resolve('owned')) });
  assert.equal(child.status, 0, child.stderr);
});

import { createRequire } from 'node:module';
import { validateInputs, validateGraph, validatePhysical } from './validate.mjs';
const toolRequire = createRequire(new URL('./tools/package.json', import.meta.url));
const Arborist = toolRequire('@npmcli/arborist');
const acceptedLock = async () => JSON.parse(await readFile(new URL('./sdk/package-lock.json', import.meta.url)));

test('accepted genuine lock validates; wrong SDK hash, unsafe sources, peer and manifest drift fail', async () => {
  const lock = await acceptedLock();
  validateInputs(payload.INPUT, lock);
  for (const mutate of [
    l => { l.packages['node_modules/@opencode-ai/plugin'].integrity = 'sha512-' + 'A'.repeat(86) + '=='; },
    l => { l.packages['node_modules/zod'].resolved += '?token=x'; },
    l => { l.packages['node_modules/zod'].resolved = 'file:/outside'; },
    l => { l.packages['node_modules/zod'].resolved = 'https://user:pass@registry.npmjs.org/zod/-/zod-4.1.8.tgz'; },
    l => { l.packages['node_modules/zod'].link = true; },
    l => { l.packages['node_modules/@opencode-ai/plugin'].peerDependenciesMeta['@opentui/core'].optional = false; },
    l => { l.packages['node_modules/@opencode-ai/plugin'].dependencies.effect = '0.0.1'; },
    l => { l.packages[''].dependencies.extra = '1.0.0'; },
  ]) {
    const invalid = structuredClone(lock); mutate(invalid);
    assert.throws(() => validateInputs(payload.INPUT, invalid), { code: 'INPUT_INVALID' });
  }
});

test('real Arborist virtual graph refuses a missing required transitive record before reification', async t => {
  const root = await fixture(t);
  const lock = await acceptedLock();
  delete lock.packages['node_modules/zod'];
  await writeFile(path.join(root, 'package.json'), JSON.stringify(payload.INPUT));
  await writeFile(path.join(root, 'package-lock.json'), JSON.stringify(lock));
  const virtual = await new Arborist({ path: root, offline: true, ignoreScripts: true, audit: false }).loadVirtual();
  assert.throws(() => validateGraph(virtual, lock), { code: 'GRAPH_INVALID' });
  assert.equal((await readdir(root)).includes('node_modules'), false);
});

test('physical validation rejects a missing required package and an extraneous package', async t => {
  const root = await fixture(t);
  const lock = await acceptedLock();
  await writeFile(path.join(root, 'package.json'), JSON.stringify(payload.INPUT));
  await assert.rejects(validatePhysical(root, lock, Object.keys(lock.packages), Arborist), { code: 'PHYSICAL_INVALID' });
  await mkdir(path.join(root, 'node_modules/extra'), { recursive: true });
  await writeFile(path.join(root, 'node_modules/extra/package.json'), '{"name":"extra","version":"1.0.0"}');
  await assert.rejects(validatePhysical(root, lock, [''], Arborist), { code: 'PHYSICAL_INVALID' });
});

test('owned child cancellation and timeout observe close before stage cleanup', async t => {
  const root = await fixture(t); const workspace = path.join(root, 'owned');
  await payload.initialize(workspace);
  const controller = new AbortController();
  const ready = path.join(workspace, 'child-ready');
  let childProof;
  const pending = payload.transaction(workspace, 'cancelled', async stage => {
    try {
      await payload.runChild(['--input-type=module', '-e', `import {writeFileSync} from 'node:fs'; writeFileSync(process.argv[1],'ready'); setInterval(()=>{},1000)`, ready], workspace, { signal: controller.signal });
      await writeFile(path.join(stage, 'payload-manifest.json'), '{}');
    } catch (error) {
      childProof = error.child;
      assert.equal((await lstat(stage)).isDirectory(), true, 'stage remains owned until direct child close');
      throw error;
    }
  });
  const rejection = assert.rejects(pending, { code: 'CANCELLED' });
  const deadline = Date.now() + 5000;
  while (true) {
    try { await readFile(ready); break; } catch (error) { if (error.code !== 'ENOENT' || Date.now() > deadline) throw error; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  controller.abort(); await rejection;
  assert.equal(childProof.closed, true); assert.equal(childProof.descendants, 'unknown');
  if (process.platform === 'win32') assert.ok((childProof.signal === 'SIGTERM' && childProof.exitCode === null) || (childProof.signal === null && Number.isInteger(childProof.exitCode) && childProof.exitCode !== 0), 'Windows termination still requires SIGTERM or a nonzero termination exit');
  else assert.deepEqual(childProof, { closed: true, exitCode: null, signal: 'SIGTERM', descendants: 'unknown' });
  await assert.rejects(payload.runChild(['--input-type=module', '-e', 'setInterval(()=>{},1000)'], workspace, { timeout: 25 }), error => error.code === 'OPERATION_TIMEOUT' && error.child.closed === true);
  assert.deepEqual((await readdir(workspace)).filter(name => name.startsWith('.stage-') || name === 'cancelled'), []);
});

test('publication refuses a substituted stage and leaves replacement and existing paths alone', async t => {
  const root = await fixture(t); const workspace = path.join(root, 'owned');
  await payload.initialize(workspace);
  const outside = path.join(root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'payload-manifest.json'), '{}');
  let replacement;
  await assert.rejects(payload.transaction(workspace, 'out', async stage => {
    await rm(stage, { recursive: true }); await symlink(outside, stage, 'dir'); replacement = stage;
  }), { code: 'PUBLICATION_INVALID' });
  assert.equal(await readFile(path.join(outside, 'payload-manifest.json'), 'utf8'), '{}');
  assert.equal((await readdir(workspace)).includes('out'), false);
  assert.equal((await lstat(replacement)).isSymbolicLink(), true);
});

test('accepted SDK lock disables further online candidate resolution', async t => {
  const root = await fixture(t); const workspace = path.join(root, 'owned');
  await payload.initialize(workspace);
  await assert.rejects(payload.prepare({ workspace, mode: 'candidate' }), { code: 'CANDIDATE_EXISTS' });
  assert.equal((await readdir(workspace)).includes('.candidate-once'), false);
});

// Preflight tests exercise no producer or constructor, including when no accepted lock exists.
test('ordinary test entry forbids online admission even for an absent accepted lock', () => {
  assert.equal(globalThis[Symbol.for('lawoss.payload.networkDisabled')], true);
  assert.throws(() => payload.candidatePreflight(false), { code: 'NETWORK_DISABLED' });
  assert.throws(() => payload.candidatePreflight(true), { code: 'CANDIDATE_EXISTS' });
});

test('child creation keeps inherited offline-only guard even if a caller asks for online', async t => {
  const root = await fixture(t); const workspace = path.join(root, 'owned'); await payload.initialize(workspace);
  const script = `import net from 'node:net'; try { net.connect(9,'127.0.0.1'); process.exitCode=2; } catch(e) { if(e.code!=='NETWORK_DISABLED') throw e; }`;
  await payload.runChild(['--input-type=module', '-e', script], workspace, { offline: false });
});

test('owned cache cannot contain an outside symlink before worker admission', async t => {
  const root = await fixture(t); const workspace = path.join(root, 'owned'); await payload.initialize(workspace);
  const outside = path.join(root, 'outside'); await writeFile(outside, 'keep');
  await symlink(outside, path.join(workspace, 'cache/escape'), 'file');
  await assert.rejects(payload.prepare({ workspace }), { code: 'TREE_UNSAFE' });
  assert.equal(await readFile(outside, 'utf8'), 'keep');
});
