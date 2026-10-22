import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fsPromises, { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as validation from './validate.mjs';
import { metadata, hostTarget, owned, fixture, receipt } from './embedded-runtime-verifier-fixture.mjs';

const node22 = process.env.LAWOSS_TEST_NODE22 ?? fileURLToPath(new URL('../../../apps/desktop/resources/node/node', import.meta.url));
const bun = process.env.LAWOSS_TEST_BUN ?? '/Users/vojte/Projects/lawoss-local-tests/toolchains/bun-1.4.2-darwin-aarch64/bun-darwin-aarch64/bun';
const factory = value => validation.createEmbeddedRuntimePayloadVerifier(value);
const invalid = { code: 'INPUT_INVALID' };
async function run(t, executable, source, args = [], cwd) {
  const base = await owned(t), entry = path.join(base, 'runner.mjs');
  await writeFile(entry, source);
  return spawnSync(executable, [entry, ...args], { cwd: cwd ?? base, encoding: 'utf8', timeout: 20000,
    env: { PATH: path.dirname(executable), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) } });
}

test('factory API snapshots exact accepted metadata into a frozen function with no override fields', () => {
  assert.equal(typeof validation.createEmbeddedRuntimePayloadVerifier, 'function');
  const admitted = { ...metadata }, verify = factory(admitted);
  admitted.acceptedInputText = '{}'; admitted.acceptedLockText = '{}';
  assert.equal(typeof verify, 'function');
  assert.equal(Object.isFrozen(verify), true);
  assert.deepEqual(Reflect.ownKeys(verify).sort(), ['length', 'name']);
});

test('constructor refuses hostile records, fields and bounds without invoking getters or coercion', () => {
  let touched = 0;
  const accessor = { ...metadata };
  Object.defineProperty(accessor, 'acceptedInputText', { get() { touched++; throw Error('getter'); } });
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  for (const value of [undefined, null, [], Buffer.from('metadata'), Object.create(null),
    Object.assign(Object.create(metadata), metadata), { ...metadata, extra: true },
    { ...metadata, [Symbol('extra')]: true }, accessor, revoked.proxy,
    new Proxy(metadata, { ownKeys() { throw Error('private proxy'); } }),
    new Proxy(metadata, { getPrototypeOf() { throw Error('private prototype'); } }),
    new Proxy(metadata, { getOwnPropertyDescriptor() { throw Error('private descriptor'); } }),
    { ...metadata, acceptedInputText: { toString() { touched++; throw Error('coercion'); } } },
    { ...metadata, acceptedLockText: Buffer.from(metadata.acceptedLockText) },
    { ...metadata, acceptedInputText: ' '.repeat(16 * 1024 + 1) },
    { ...metadata, acceptedInputText: 'é'.repeat(16 * 1024) },
    { ...metadata, acceptedLockText: ' '.repeat(256 * 1024 + 1) },
    { ...metadata, acceptedLockText: 'é'.repeat(256 * 1024) },
  ]) assert.throws(() => factory(value), invalid);
  assert.equal(touched, 0);
});

test('constructor pins exact input and lock bytes even for semantic or self-consistent replacements', () => {
  const changed = JSON.parse(metadata.acceptedLockText);
  changed.packages['node_modules/@opencode-ai/plugin'].integrity = 'sha512-' + 'A'.repeat(86) + '==';
  for (const value of [
    { ...metadata, acceptedInputText: JSON.stringify(JSON.parse(metadata.acceptedInputText)) },
    { ...metadata, acceptedInputText: metadata.acceptedInputText + '\n' },
    { ...metadata, acceptedLockText: metadata.acceptedLockText + '\n' },
    { ...metadata, acceptedLockText: JSON.stringify(changed) },
    { acceptedInputText: '{}', acceptedLockText: '{}' },
  ]) assert.throws(() => factory(value), invalid);
});

test('constructor performs no filesystem operations and Node24 closure refuses before payload access', async () => {
  assert.equal(process.version, 'v24.21.0');
  const originals = new Map(['lstat', 'readFile', 'readdir', 'realpath'].map(key => [key, fsPromises[key]]));
  let reads = 0;
  for (const key of originals.keys()) fsPromises[key] = async () => { reads++; throw Error('unexpected filesystem access'); };
  syncBuiltinESMExports();
  try {
    const verify = factory(metadata);
    await assert.rejects(verify('nonexistent-payload', '0'.repeat(64)), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
    assert.equal(reads, 0);
  } finally {
    for (const [key, value] of originals) fsPromises[key] = value;
    syncBuiltinESMExports();
  }
});

test('original producer wrapper preserves source-relative metadata reads and their ordering', async t => {
  const f = await fixture(t); await receipt(f);
  const original = fsPromises.readFile, reads = [];
  fsPromises.readFile = async (file, ...args) => {
    reads.push(file instanceof URL ? fileURLToPath(file) : file);
    return original(file, ...args);
  };
  syncBuiltinESMExports();
  try { assert.deepEqual(await validation.verifyPayload(f.root), f.manifest); }
  finally { fsPromises.readFile = original; syncBuiltinESMExports(); }
  assert.deepEqual(reads.slice(0, 5), [path.join(f.root, 'payload-manifest.json'),
    path.join(f.root, 'package.json'), path.join(f.root, 'package-lock.json'),
    fileURLToPath(new URL('./sdk/package-lock.json', import.meta.url)),
    fileURLToPath(new URL('./sdk/package.json', import.meta.url))]);
});

test('genuine Node22 factory and default wrapper agree on accepted bytes and every refusal', async t => {
  assert.equal(spawnSync(node22, ['--version'], { encoding: 'utf8' }).stdout.trim(), 'v22.23.2');
  const cases = {
    accepted: () => {},
    'wrong-digest': () => {},
    'invalid-digest': () => {},
    content: f => writeFile(path.join(f.root, 'node_modules/@opencode-ai/plugin/index.js'), 'changed'),
    'replacement-inventory': async f => {
      await writeFile(path.join(f.root, 'package.json'), metadata.acceptedInputText + '\n');
      f.manifest.inputSha256 = validation.sha256(metadata.acceptedInputText + '\n');
      f.manifest.files = await validation.inventory(f.root);
    },
    'changed-lock-and-sri': async f => {
      const lock = JSON.parse(metadata.acceptedLockText);
      lock.packages['node_modules/@opencode-ai/plugin'].integrity = 'sha512-' + 'A'.repeat(86) + '==';
      const bytes = JSON.stringify(lock);
      await writeFile(path.join(f.root, 'package-lock.json'), bytes);
      f.manifest.sdk.integrity = lock.packages['node_modules/@opencode-ai/plugin'].integrity;
      f.manifest.lockSha256 = validation.sha256(bytes); f.manifest.files = await validation.inventory(f.root);
    },
    notice: async f => {
      await writeFile(path.join(f.root, 'third-party-notices/index.json'), '{}');
      f.manifest.files = await validation.inventory(f.root);
    },
    producer: f => { f.manifest.node = 'v22.23.2'; },
    target: f => { f.manifest.target = { platform: hostTarget.platform === 'win32' ? 'darwin' : 'win32', arch: 'x64' }; },
    'target-extra': f => { f.manifest.target = { ...hostTarget, extra: true }; },
    imports: f => { f.manifest.imports.imports = []; },
    native: f => { f.manifest.imports.native = 'absent'; },
    'native-opposite': f => { f.manifest.imports.native = f.manifest.imports.native === 'loaded' ? 'fallback' : 'loaded'; },
    guard: f => { f.manifest.imports.guard = false; },
    roundtrip: f => { f.manifest.imports.roundtrip = false; },
    closure: f => { f.manifest.closure = []; },
  };
  for (const [name, mutate] of Object.entries(cases)) await t.test(name, async t => {
    const f = await fixture(t); await mutate(f);
    const digest = await receipt(f), before = await validation.inventory(f.root);
    const external = name === 'wrong-digest' ? '0'.repeat(64) : name === 'invalid-digest' ? digest.toUpperCase() : digest;
    const child = await run(t, node22, `
      import assert from 'node:assert/strict';
      import { createEmbeddedRuntimePayloadVerifier, verifyRuntimePayload } from ${JSON.stringify(new URL('./validate.mjs', import.meta.url).href)};
      assert.equal(process.version, 'v22.23.2'); assert.equal(process.versions.bun, undefined);
      const metadata = ${JSON.stringify(metadata)};
      const embedded = createEmbeddedRuntimePayloadVerifier(metadata);
      metadata.acceptedInputText = '{}'; metadata.acceptedLockText = '{}';
      const args = ${JSON.stringify([f.root, external])};
      if (${JSON.stringify(name)} === 'accepted') assert.deepEqual(await embedded(...args), await verifyRuntimePayload(...args));
      else for (const verify of [embedded, verifyRuntimePayload]) await assert.rejects(verify(...args), { code: 'PAYLOAD_INVALID' });
      console.log('node22-parity-ok');
    `);
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), 'node22-parity-ok');
    assert.deepEqual(await validation.inventory(f.root), before);
  });
});

test('unsupported process target and actual Bun refuse before nonexistent payload access', async t => {
  const source = `
    import assert from 'node:assert/strict';
    import { createEmbeddedRuntimePayloadVerifier } from ${JSON.stringify(new URL('./validate.mjs', import.meta.url).href)};
    const verify = createEmbeddedRuntimePayloadVerifier(${JSON.stringify(metadata)});
    if (process.versions.bun) await assert.rejects(verify('nonexistent-payload', '0'.repeat(64)), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
    else {
      assert.equal(process.version, 'v22.23.2');
      Object.defineProperty(process, 'platform', { value: 'freebsd' });
      await assert.rejects(verify('nonexistent-payload', '0'.repeat(64)), { code: 'CONSUMER_TARGET_UNSUPPORTED' });
    }
    console.log('runtime-refused');
  `;
  assert.equal(spawnSync(bun, ['--version'], { encoding: 'utf8' }).stdout.trim(), '1.4.2');
  for (const executable of [node22, bun]) {
    const child = await run(t, executable, source);
    assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), 'runtime-refused');
  }
});

test('actual self-contained Bun bundle runs under Node22 without adjacent SDK or prepare bootstrap effects', async t => {
  const f = await fixture(t), digest = await receipt(f);
  const bundleRoot = path.join(f.base, 'isolated'); await mkdir(bundleRoot);
  const entry = path.join(f.base, 'entry.mjs'), bundle = path.join(bundleRoot, 'verifier.mjs');
  await writeFile(entry, `
    import assert from 'node:assert/strict';
    import { createEmbeddedRuntimePayloadVerifier } from ${JSON.stringify(fileURLToPath(new URL('./validate.mjs', import.meta.url)))};
    const verify = createEmbeddedRuntimePayloadVerifier(${JSON.stringify(metadata)});
    assert.equal(process.version, 'v22.23.2'); assert.equal(process.versions.bun, undefined);
    assert.equal((await verify(${JSON.stringify(f.root)}, ${JSON.stringify(digest)})).node, 'v24.21.0');
    await assert.rejects(verify(${JSON.stringify(f.root)}, '0'.repeat(64)), { code: 'PAYLOAD_INVALID' });
    console.log('isolated-bundle-ok');
  `);
  assert.equal(spawnSync(bun, ['--version'], { encoding: 'utf8' }).stdout.trim(), '1.4.2');
  const built = spawnSync(bun, ['build', entry, '--outfile', bundle, '--target=node', '--format=esm'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.stderr);
  await rm(entry);
  const before = await validation.inventory(f.root), isolatedBefore = await validation.inventory(bundleRoot);
  assert.deepEqual(await readdir(bundleRoot), ['verifier.mjs']);
  const child = spawnSync(node22, [bundle, 'init', '--workspace', path.join(bundleRoot, 'must-not-exist')], {
    cwd: bundleRoot, encoding: 'utf8', timeout: 20000, env: { PATH: path.dirname(node22) },
  });
  assert.equal(child.status, 0, child.stderr); assert.equal(child.stdout.trim(), 'isolated-bundle-ok');
  assert.deepEqual(await validation.inventory(bundleRoot), isolatedBefore);
  assert.deepEqual(await validation.inventory(f.root), before);
});
