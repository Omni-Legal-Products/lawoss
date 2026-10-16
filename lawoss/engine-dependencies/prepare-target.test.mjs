import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import net from 'node:net';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { prepareEngineDependencyTarget } from './prepare-target.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
// These source tests never authorize network; fail before a socket is opened.
net.Socket.prototype.connect = function () { throw new Error('TEST_NETWORK_FORBIDDEN'); };
const owned = path.join(here, '.work/test-fixtures');
await fs.mkdir(owned, { recursive: true });
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(owned, 'prepare-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'target');
  const recoveryParent = path.join(root, 'recovery');
  const engineNpmPath = path.join(root, 'engine-core');
  const home = path.join(root, 'home');
  await Promise.all([directory, recoveryParent, engineNpmPath, home].map(p => fs.mkdir(p)));
  return { root, directory, recoveryParent, engineNpmPath,
    engineExecPath: path.join(root, 'engine'), nativeHome: homedir(),
    stateDirectory: path.join(root, 'state'), logicalDirectories: [directory],
    deadline: Date.now() + 30000,
    environment: { HOME: home, npm_config_userconfig: path.join(home, '.npmrc'),
      npm_config_globalconfig: path.join(root, 'global.npmrc'), npm_config_cache: path.join(root, 'cache'), npm_config_offline: 'true' } };
}
test('missing physical SDK cannot be accepted from manifest declaration alone', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.directory, 'package.json'), JSON.stringify({ dependencies: { '@opencode-ai/plugin': '1.18.29' } }));
  const result = await prepareEngineDependencyTarget(f);
  assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'REIFY_FAILED');
  assert.ok(result.private.recoveryDirectory);
});

import { createHash } from 'node:crypto';
import { localRuntimePackage } from './runtime-tools.mjs';
import { withEngineDependencyLease } from './dependency-lease.mjs';
const Arborist = localRuntimePackage('@npmcli/arborist', '9.4.0')('@npmcli/arborist');
const cacheSource = process.env.LAWOSS_TEST_ACCEPTED_SDK_CACHE;
async function packageFile(f, value) { await fs.writeFile(path.join(f.directory, 'package.json'), JSON.stringify(value)); }
async function customGraph(f) {
  const pkg = { name: 'synthetic-user-graph', version: '2.0.0', private: true,
    description: 'Preserve this', scripts: { install: 'exit 97' }, custom: { nested: ['unchanged'] } };
  for (const [i, section] of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'].entries()) {
    const name = `local-custom-${i}`;
    const dir = path.join(f.root, name); await fs.mkdir(dir);
    await fs.writeFile(path.join(dir, 'package.json'), JSON.stringify({ name, version: '1.0.0' }));
    pkg[section] = { [name]: `file:../${name}` };
  }
  await packageFile(f, pkg);
  // Genuine custom-only baseline, no SDK lock transplant and no network.
  await new Arborist({ path: f.directory, cache: path.join(f.root, 'cache/_cacache'), offline: true, ignoreScripts: true }).reify({ save: true });
  return JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8'));
}
async function acceptedCache(f) {
  await fs.cp(cacheSource, path.join(f.root, 'cache/_cacache'), { recursive: true });
}

test('genuine offline exact SDK addition preserves existing custom lock, all sections and metadata', { skip: !cacheSource }, async t => {
  const f = await fixture(t); await acceptedCache(f);
  const before = await customGraph(f);
  const beforeLock = await fs.readFile(path.join(f.directory, 'package-lock.json'));
  const result = await prepareEngineDependencyTarget(f);
  assert.equal(result.code, 'READY');
  assert.ok(result.verifiedSdkNodes > 1);
  const after = JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8'));
  delete after.dependencies['@opencode-ai/plugin'];
  assert.deepEqual(after, before);
  assert.ok(!(await fs.readFile(path.join(f.directory, 'package-lock.json'))).equals(beforeLock));
  assert.ok((await fs.readFile(path.join(result.private.recoveryDirectory, 'original-package-lock.json'))).equals(beforeLock));
  assert.equal(JSON.stringify(result).includes(f.root), false);
  const actual = await new Arborist({ path: f.directory }).loadActual();
  for (let i = 0; i < 4; i++) assert.equal(actual.children.get(`local-custom-${i}`).package.version, '1.0.0');
  assert.equal(actual.children.get('@opencode-ai/plugin').package.version, '1.18.29');
  t.diagnostic(JSON.stringify({ evidence: 'genuine-offline-merged-graph', verifiedSdkNodes: result.verifiedSdkNodes,
    originalLockSha256: createHash('sha256').update(beforeLock).digest('hex'),
    mergedLockSha256: createHash('sha256').update(await fs.readFile(path.join(f.directory, 'package-lock.json'))).digest('hex') }));
  if (process.platform !== 'win32') {
    assert.equal((await fs.stat(result.private.recoveryDirectory)).mode & 0o777, 0o700);
    assert.equal((await fs.stat(path.join(result.private.recoveryDirectory, 'original-package.json'))).mode & 0o777, 0o600);
  }
  // Exact declared/lock repair must restore an actually missing package tree.
  await fs.rm(path.join(f.directory, 'node_modules/@opencode-ai/plugin'), { recursive: true });
  const repaired = await prepareEngineDependencyTarget({ ...f, deadline: Date.now() + 30000 });
  assert.equal(repaired.code, 'READY');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'node_modules/@opencode-ai/plugin/package.json'), 'utf8')).version, '1.18.29');
});

test('lease precedes configuration, target read and mutation; captured environment survives caller edit', async t => {
  const f = await fixture(t); await packageFile(f, { name: 'captured' });
  const alias = 'exact-logical-alias'; f.logicalDirectories.push(alias);
  let release, entered;
  const acquired = new Promise(resolve => { entered = resolve; });
  const holding = withEngineDependencyLease(f, async () => { entered(); await new Promise(resolve => { release = resolve; }); });
  await acquired;
  let called = false, resolveFactory;
  const factorySeen = new Promise(resolve => { resolveFactory = resolve; });
  f.environment.npm_config_registry = 'https://captured.invalid/';
  const ambient = JSON.stringify({ ...process.env });
  const pending = prepareEngineDependencyTarget(f, { arboristFactory: (_Class, options) => {
    called = true; resolveFactory();
    assert.equal(options.registry, 'https://captured.invalid/');
    assert.equal(options.offline, true);
    assert.equal(options.cache, path.join(f.root, 'cache/_cacache'));
    assert.equal(options.ignoreScripts, true); assert.equal(options.binLinks, true);
    return { async reify() { throw Error('controlled-no-reify'); } };
  } });
  f.environment.npm_config_registry = 'https://later.invalid/';
  // Under another owner's lease it must neither inspect malformed input nor create recovery.
  await packageFile(f, { name: 'fresh-after-lease' });
  assert.equal(called, false);
  assert.deepEqual(await fs.readdir(f.recoveryParent), []);
  release(); await holding; await factorySeen;
  const result = await pending;
  assert.equal(result.code, 'REIFY_FAILED');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.private.recoveryDirectory, 'original-package.json'), 'utf8')).name, 'fresh-after-lease');
  assert.ok(JSON.stringify({ ...process.env }) === ambient, 'ambient environment unchanged');
});

test('malformed, unsupported and oversized metadata refuse before factory', async t => {
  for (const kind of ['json', 'section', 'lock', 'oversized', 'symlink', 'shrinkwrap', 'workspace']) {
    const f = await fixture(t); await packageFile(f, {});
    if (kind === 'json') await fs.writeFile(path.join(f.directory, 'package.json'), '{');
    if (kind === 'section') await packageFile(f, { dependencies: [] });
    if (kind === 'lock') await fs.writeFile(path.join(f.directory, 'package-lock.json'), '{"lockfileVersion":3}');
    if (kind === 'oversized') await fs.writeFile(path.join(f.directory, 'package.json'), ' '.repeat(1024 * 1024 + 1));
    if (kind === 'symlink') {
      await fs.rename(path.join(f.directory, 'package.json'), path.join(f.root, 'foreign.json'));
      await fs.symlink(path.join(f.root, 'foreign.json'), path.join(f.directory, 'package.json'));
    }
    if (kind === 'shrinkwrap') await fs.writeFile(path.join(f.directory, 'npm-shrinkwrap.json'), '{}');
    if (kind === 'workspace') await packageFile(f, { workspaces: ['other'] });
    let called = false;
    const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => { called = true; } });
    assert.equal(result.status, 'blocked'); assert.equal(called, false);
    assert.deepEqual(await fs.readdir(f.recoveryParent), []);
  }
});

test('pre-reify concurrent metadata edit refuses and keeps original plus observed recovery; no rollback', async t => {
  const f = await fixture(t); await packageFile(f, { name: 'original' });
  let called = false;
  const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => {
    writeFileSync(path.join(f.directory, 'package.json'), '{"name":"foreign-edit"}');
    return { async reify() { called = true; } };
  } });
  assert.equal(called, false); assert.equal(result.status, 'blocked');
  assert.equal(result.code, 'TARGET_CHANGED');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8')).name, 'foreign-edit');
  assert.equal(JSON.parse(await fs.readFile(path.join(result.private.recoveryDirectory, 'original-package.json'), 'utf8')).name, 'original');
});

test('controlled mid-reify failure retains primary, source hashes and observed writes without foreign deletion', async t => {
  const f = await fixture(t); await packageFile(f, { name: 'before' });
  const bytes = await fs.readFile(path.join(f.directory, 'package.json'));
  const primary = Error('private-sentinel-only');
  const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => ({ async reify() {
    await packageFile(f, { name: 'partial' });
    await fs.mkdir(path.join(f.directory, 'node_modules'));
    await fs.writeFile(path.join(f.directory, 'node_modules/foreign.txt'), 'retain');
    throw primary;
  } }) });
  assert.equal(result.code, 'REIFY_FAILED');
  assert.equal(result.private.cause.cause, primary);
  assert.equal(JSON.stringify(result).includes('sentinel'), false);
  assert.ok((await fs.readFile(path.join(result.private.recoveryDirectory, 'original-package.json'))).equals(bytes));
  const record = JSON.parse(await fs.readFile(path.join(result.private.recoveryDirectory, 'original.json'), 'utf8'));
  assert.equal(record['package.json'].sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8')).name, 'partial');
  assert.equal(await fs.readFile(path.join(f.directory, 'node_modules/foreign.txt'), 'utf8'), 'retain');
});

test('cancelled reify retains lease until owned work settles and never returns success', async t => {
  const f = await fixture(t); await packageFile(f, {});
  const controller = new AbortController(); let began, finish;
  const started = new Promise(resolve => { began = resolve; });
  const pending = prepareEngineDependencyTarget({ ...f, signal: controller.signal }, { arboristFactory: (_Class, options) => ({ async reify(opts) {
    assert.equal(opts.signal, options.signal);
    began(); await new Promise(resolve => { finish = resolve; });
  } }) });
  await started; controller.abort();
  assert.equal((await fs.readdir(path.join(f.stateDirectory, 'locks'))).length, 1);
  let settled = false; pending.then(() => { settled = true; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(settled, false);
  finish(); const result = await pending;
  assert.equal(result.code, 'CANCELLED');
  assert.deepEqual(await fs.readdir(path.join(f.stateDirectory, 'locks')), []);
});

test('genuine reify followed by controlled custom loss, wrong SDK or partial SDK tree cannot succeed', { skip: !cacheSource }, async t => {
  for (const kind of ['custom-loss', 'wrong-sdk', 'partial-tree', 'missing-entrypoint']) {
    const f = await fixture(t); await acceptedCache(f); await customGraph(f);
    const result = await prepareEngineDependencyTarget(f, { arboristFactory: (Class, options) => ({ async reify(opts) {
      await new Class(options).reify(opts);
      if (kind === 'custom-loss') {
        const pkg = JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8'));
        delete pkg.custom; await packageFile(f, pkg);
      } else if (kind === 'wrong-sdk') {
        const file = path.join(f.directory, 'node_modules/@opencode-ai/plugin/package.json');
        const pkg = JSON.parse(await fs.readFile(file, 'utf8')); pkg.version = '0.0.0';
        await fs.writeFile(file, JSON.stringify(pkg));
      } else if (kind === 'partial-tree') await fs.rm(path.join(f.directory, 'node_modules/@opencode-ai/sdk'), { recursive: true });
      else await fs.rm(path.join(f.directory, 'node_modules/@opencode-ai/plugin/dist/index.js'));
    } }) });
    assert.equal(result.status, 'blocked'); assert.equal(result.code, 'POSTCONDITION_FAILED');
    assert.ok(await fs.stat(path.join(result.private.recoveryDirectory, 'failed-package.json')));
  }
});


test('target replacement refuses without reading successor metadata or restoring over it', async t => {
  const f = await fixture(t); await packageFile(f, { name: 'original' });
  const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => ({ async reify() {
    await fs.rename(f.directory, path.join(f.root, 'old-target'));
    await fs.mkdir(f.directory); await packageFile(f, { name: 'successor' });
  } }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.private.cause.errors[0].code, 'TARGET_CHANGED');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8')).name, 'successor');
  await assert.rejects(fs.access(path.join(result.private.recoveryDirectory, 'failed-package.json')));
});

test('original reify and lease cleanup errors both survive privately', async t => {
  const f = await fixture(t); await packageFile(f, {});
  const primary = Error('private-primary');
  const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => ({ async reify() {
    const locks = path.join(f.stateDirectory, 'locks');
    const [dir] = await fs.readdir(locks);
    const file = path.join(locks, dir, 'meta.json');
    const meta = JSON.parse(await fs.readFile(file, 'utf8')); meta.token = 'foreign-token';
    await fs.writeFile(file, JSON.stringify(meta));
    throw primary;
  } }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.private.cause.errors[0].cause, primary);
  assert.equal(result.private.cause.errors[1].message, 'LEASE_RELEASE_FAILED');
  assert.equal((await fs.readdir(path.join(f.stateDirectory, 'locks'))).length, 1);
  assert.deepEqual(Object.keys(result), ['status', 'code']);
});

test('missing target and invalid inputs never create the target', async t => {
  const f = await fixture(t); await fs.rmdir(f.directory);
  const result = await prepareEngineDependencyTarget(f);
  assert.equal(result.status, 'blocked'); await assert.rejects(fs.access(f.directory));
  for (const change of [{ directory: 'relative' }, { environment: null }, { logicalDirectories: [] }, { deadline: NaN }]) {
    assert.equal((await prepareEngineDependencyTarget({ ...f, ...change })).code, 'INVALID_INPUT');
  }
});


test('genuine omit=dev preserves declarations without forcing omitted nodes; lifecycle script stays unexecuted', { skip: !cacheSource }, async t => {
  const f = await fixture(t); await acceptedCache(f);
  const before = await customGraph(f);
  f.environment.npm_config_omit = 'dev';
  // Force observable omission: an existing dev-only node need not be retained.
  await fs.rm(path.join(f.directory, 'node_modules/local-custom-1'), { recursive: true, force: true });
  const result = await prepareEngineDependencyTarget(f);
  assert.equal(result.code, 'READY');
  const after = JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8'));
  assert.deepEqual(after.devDependencies, before.devDependencies);
  assert.equal(after.scripts.install, 'exit 97');
  await assert.rejects(fs.access(path.join(f.directory, 'node_modules/local-custom-1')));
});

test('genuine offline preparation supports an existing empty configuration directory', { skip: !cacheSource }, async t => {
  const f = await fixture(t); await acceptedCache(f);
  const result = await prepareEngineDependencyTarget(f);
  assert.equal(result.code, 'READY');
  const record = JSON.parse(await fs.readFile(path.join(result.private.recoveryDirectory, 'original.json'), 'utf8'));
  assert.deepEqual(record, { 'package.json': { exists: false }, 'package-lock.json': { exists: false } });
});


test('captured global-install policy refuses before reify without rewriting policy', async t => {
  const f = await fixture(t); await packageFile(f, { name: 'unchanged' });
  f.environment.npm_config_global = 'true';
  let called = false;
  const result = await prepareEngineDependencyTarget(f, { arboristFactory: () => { called = true; } });
  assert.equal(result.code, 'UNSUPPORTED_CONFIG'); assert.equal(called, false);
  assert.equal(f.environment.npm_config_global, 'true');
  assert.equal(JSON.parse(await fs.readFile(path.join(f.directory, 'package.json'), 'utf8')).name, 'unchanged');
});
