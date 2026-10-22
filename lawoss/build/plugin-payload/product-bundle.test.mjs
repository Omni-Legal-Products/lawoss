import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inspectProductSdkBundle } from './product-bundle.mjs';
import { verifyPayload, verifyRuntimePayload } from './validate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sources = ['validate.mjs', 'prepare.mjs', 'worker.mjs', 'import-check.mjs',
  'prime-cache.mjs', 'prime-transfer.mjs', 'network-guard.mjs', 'tools-preflight.mjs',
  'native-validation.mjs', 'native-validation.test.mjs', 'prepare.test.mjs', 'prime-cache.test.mjs',
  '../../engine-dependencies/package-runtime.mjs', 'runtime-consumer-validation.mjs',
  'runtime-consumer.test.mjs', 'runtime-consumer.integration.test.mjs', 'tools/package.json',
  'tools/pnpm-lock.yaml', 'sdk/package.json', 'sdk/package-lock.json', 'notices.mjs', 'notices.test.mjs',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md',
  'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt',
  'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
const imports = ['@opencode-ai/plugin', '@opencode-ai/plugin/tool', '@opencode-ai/plugin/v2/effect',
  '@opencode-ai/plugin/v2/promise', '@opencode-ai/plugin/v2/effect/plugin',
  '@opencode-ai/plugin/v2/effect/integration', 'zod', 'effect', '@ai-sdk/provider', '@opencode-ai/sdk'];
const counts = tests => ({ tests, pass: tests, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
const code = { code: 'PRODUCT_SDK_BUNDLE_INVALID' };
const sourceBytes = name => readFile(new URL(name, import.meta.url));

// Format/data fixtures only: these summaries assert no actual native execution.
// Trusted build callers must independently accept their real compatibility proof.
async function fixture(t, target = { platform: 'win32', arch: 'arm64' }, native = 'fallback') {
  const base = await mkdtemp(path.join(tmpdir(), 'lawoss-product-sdk-data-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = await realpath(base);
  const files = new Map([
    ['package.json', await sourceBytes('./sdk/package.json')],
    ['package-lock.json', await sourceBytes('./sdk/package-lock.json')],
    ['node_modules/inert.js', Buffer.from("throw new Error('Data fixture must never execute');\n")],
  ]);
  for (const name of ['THIRD_PARTY_NOTICES.md', 'index.json', 'licenses/kubernetes-Apache-2.0.txt',
    'licenses/msgpackr-extract-MIT.txt', 'licenses/opencode-MIT.txt']) {
    files.set(`third-party-notices/${name}`, await sourceBytes(`./sdk/notices/${name}`));
  }
  for (const [name, bytes] of files) {
    await mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await writeFile(path.join(root, name), bytes, { mode: 0o644 });
  }
  const lockBytes = files.get('package-lock.json'), lock = JSON.parse(lockBytes);
  const manifest = { schema: 1, sdk: { name: '@opencode-ai/plugin', version: '1.18.29',
    integrity: lock.packages['node_modules/@opencode-ai/plugin'].integrity },
    node: 'v24.21.0', arborist: '9.4.0', scripts: false, target,
    lockSha256: hash(lockBytes), inputSha256: hash(files.get('package.json')),
    imports: { imports, native, guard: true, roundtrip: true },
    closure: Object.keys(lock.packages), inertOptional: [], licenses: [],
    files: [...files].sort(([a], [b]) => a < b ? -1 : 1).map(([name, bytes]) => ({ path: name, bytes: bytes.length, executable: false, sha256: hash(bytes) })) };
  await writeFile(path.join(root, 'payload-manifest.json'), JSON.stringify(manifest));
  const digest = hash(await readFile(path.join(root, 'payload-manifest.json')));
  const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async name => [name, hash(await sourceBytes(name))])));
  const compatibilityBinding = { schema: 2, kind: 'plugin-sdk-runtime-consumer', status: 'complete', failedStage: null, code: null,
    headSha: 'a'.repeat(40), checkoutSha: 'b'.repeat(40), target,
    accepted: { lockSha256: manifest.lockSha256, inputSha256: manifest.inputSha256, toolsLockSha256: sourceHashes['tools/pnpm-lock.yaml'] },
    sources: sourceHashes, producer: { version: 'v24.21.0', sha256: 'c'.repeat(64) },
    consumer: { version: 'v22.23.2', sha256: 'd'.repeat(64) },
    acquisition: { records: 32, verified: 32, totalBytes: 1, outcome: 'complete', receiptSha256: 'e'.repeat(64) },
    tests: { producer: counts(53), consumer: counts(6) }, payloadManifestSha256: digest,
    consumerMode: native === 'loaded' ? 'native-loaded' : 'javascript-fallback',
    assertions: { producerVerified: true, nativeLoaded: native === 'loaded', nativeCapability: true, consumerVerified: true, unchanged: true },
    scope: 'dependency compatibility only; no product hook, engine startup or installed-application acceptance' };
  return { payloadRoot: root, expectedManifestSha256: digest, expectedTarget: structuredClone(target),
    acceptedLockSha256: manifest.lockSha256, compatibilityBinding, manifest };
}

test('static foreign-target SDK data admits only its exact trusted binding and returns frozen identity', async t => {
  const f = await fixture(t);
  const before = await readFile(path.join(f.payloadRoot, 'node_modules/inert.js'));
  const descriptor = await inspectProductSdkBundle(f);
  const sortedSources = Object.fromEntries(Object.entries(f.compatibilityBinding.sources).sort(([a], [b]) => a < b ? -1 : 1));
  assert.deepEqual(descriptor, { schema: 1, kind: 'lawoss-product-sdk-bundle', status: 'verified',
    manifestSha256: f.expectedManifestSha256, target: { platform: 'win32', arch: 'arm64' },
    lockSha256: f.acceptedLockSha256, inputSha256: f.manifest.inputSha256,
    sourceSetSha256: hash(JSON.stringify(sortedSources)), consumerMode: 'javascript-fallback' });
  assert.equal(Object.isFrozen(descriptor), true);
  assert.equal(Object.isFrozen(descriptor.target), true);
  f.expectedTarget.arch = 'x64'; f.compatibilityBinding.target.arch = 'x64';
  assert.equal(descriptor.target.arch, 'arm64');
  assert.deepEqual(await readFile(path.join(f.payloadRoot, 'node_modules/inert.js')), before);
});

test('static native-capable target data remains data proof and the host/runtime wrappers stay strict', async t => {
  const f = await fixture(t, { platform: 'linux', arch: 'x64', libc: 'glibc' }, 'loaded');
  assert.equal((await inspectProductSdkBundle(f)).consumerMode, 'native-loaded');
  const foreign = await fixture(t, { platform: process.platform === 'win32' ? 'darwin' : 'win32', arch: 'x64' }, 'loaded');
  await assert.rejects(verifyPayload(foreign.payloadRoot), { code: 'PAYLOAD_INVALID' });
  await assert.rejects(verifyRuntimePayload(f.payloadRoot, f.expectedManifestSha256), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
});

test('static SDK data rejects changed, missing and extra content or notice bytes without repair', async t => {
  for (const [name, mutate] of Object.entries({
    changed: f => writeFile(path.join(f.payloadRoot, 'node_modules/inert.js'), 'changed'),
    missing: f => rm(path.join(f.payloadRoot, 'node_modules/inert.js')),
    extra: f => writeFile(path.join(f.payloadRoot, 'extra'), 'unexpected'),
    notice: f => writeFile(path.join(f.payloadRoot, 'third-party-notices/index.json'), '{}'),
    'missing-notice': f => rm(path.join(f.payloadRoot, 'third-party-notices/licenses/opencode-MIT.txt')),
    'extra-notice': f => writeFile(path.join(f.payloadRoot, 'third-party-notices/extra'), 'unexpected'),
  })) await t.test(name, async t => {
    const f = await fixture(t); await mutate(f);
    await assert.rejects(inspectProductSdkBundle(f), code);
  });
});

test('static SDK data rejects changed external identity, target, locks, source set or incomplete compatibility', async t => {
  const mutations = [
    f => { f.expectedManifestSha256 = '0'.repeat(64); },
    f => { f.acceptedLockSha256 = '0'.repeat(64); },
    f => { f.expectedTarget.arch = 'ia32'; },
    f => { f.expectedTarget = { platform: 'linux', arch: 'arm64', libc: 'musl' }; },
    f => { f.compatibilityBinding.target.arch = 'x64'; },
    f => { f.compatibilityBinding.payloadManifestSha256 = '0'.repeat(64); },
    f => { f.compatibilityBinding.accepted.lockSha256 = '0'.repeat(64); },
    f => { f.compatibilityBinding.accepted.inputSha256 = '0'.repeat(64); },
    f => { f.compatibilityBinding.accepted.toolsLockSha256 = '0'.repeat(64); },
    f => { f.compatibilityBinding.sources['validate.mjs'] = '0'.repeat(64); },
    f => { delete f.compatibilityBinding.sources['worker.mjs']; },
    f => { f.compatibilityBinding.sources.extra = '0'.repeat(64); },
    f => { f.compatibilityBinding.producer.version = 'v24.18.0'; },
    f => { f.compatibilityBinding.consumer.version = 'v22.0.0'; },
    f => { f.compatibilityBinding.consumerMode = 'native-loaded'; },
    f => { f.compatibilityBinding.assertions.consumerVerified = false; },
    f => { f.compatibilityBinding.assertions.unchanged = false; },
    f => { f.compatibilityBinding.tests.producer.skipped = 1; },
    f => { f.compatibilityBinding.tests.consumer.pass = 5; },
    f => { f.compatibilityBinding.acquisition.verified = 31; },
    f => { f.compatibilityBinding.status = 'failed'; },
    f => { f.compatibilityBinding.failedStage = 'consumer'; },
    f => { f.compatibilityBinding.private = 'must-not-be-accepted'; },
  ];
  const f = await fixture(t);
  for (const mutate of mutations) {
    const invalid = structuredClone(f); mutate(invalid);
    await assert.rejects(inspectProductSdkBundle(invalid), code);
  }
});

test('a self-consistent adjacent replacement cannot replace external product SDK identity', async t => {
  const f = await fixture(t), file = path.join(f.payloadRoot, 'payload-manifest.json');
  const replacement = { ...f.manifest, node: 'v22.23.2' };
  await writeFile(file, JSON.stringify(replacement));
  await assert.rejects(inspectProductSdkBundle(f), code);
  const replacementDigest = hash(await readFile(file));
  const updated = structuredClone(f); updated.expectedManifestSha256 = replacementDigest;
  updated.compatibilityBinding.payloadManifestSha256 = replacementDigest;
  await assert.rejects(inspectProductSdkBundle(updated), code);
  assert.equal(JSON.parse(await readFile(file)).node, 'v22.23.2');
});

test('static SDK identity refuses malformed caller data without executing binding accessors', async t => {
  const f = await fixture(t); let reads = 0;
  for (const options of [undefined, null, {}, { ...f, compatibilityBinding: null },
    { ...f, compatibilityBinding: { get schema() { reads++; return 2; } } },
    { ...f, expectedTarget: { platform: 'win32', get arch() { reads++; return 'arm64'; } } },
  ]) await assert.rejects(inspectProductSdkBundle(options), code);
  assert.equal(reads, 0);
});

test('static SDK identity rejects shared DAGs before revisiting their objects', async () => {
  let leafVisits = 0;
  let graph = new Proxy({ value: 'inert data' }, { ownKeys(value) { leafVisits++; return Reflect.ownKeys(value); } });
  // Six physical objects, not an exponentially materialized object tree.
  for (let depth = 0; depth < 5; depth++) graph = { first: graph, second: graph };
  await assert.rejects(inspectProductSdkBundle({ expectedTarget: { platform: 'win32', arch: 'arm64' },
    compatibilityBinding: graph }), code);
  assert.equal(leafVisits, 1, 'snapshot must stop on the first repeated object identity');
});

test('static SDK identity stops a unique tree at its total value budget before later branches', async () => {
  const binding = {};
  for (let group = 0; group < 63; group++) {
    binding[`group${group}`] = Object.fromEntries(Array.from({ length: 64 }, (_, index) => [`v${index}`, index]));
  }
  let laterVisits = 0;
  // root +63groups +4032primitive values =4096, so this branch must not be read.
  binding.later = new Proxy({ value: 'inert' }, { ownKeys(value) { laterVisits++; return Reflect.ownKeys(value); } });
  await assert.rejects(inspectProductSdkBundle({ expectedTarget: { platform: 'win32', arch: 'arm64' },
    compatibilityBinding: binding }), code);
  assert.equal(laterVisits, 0);
});

test('static SDK identity stops at its aggregate text and key budget before later leaves', async () => {
  for (const oversized of [
    { first: { text: 'x'.repeat(32768) }, second: { text: 'y'.repeat(32768) } },
    { ['x'.repeat(32768)]: 1, ['y'.repeat(32768)]: 2 },
  ]) {
    let laterVisits = 0;
    const later = new Proxy({ value: 'inert' }, { ownKeys(value) { laterVisits++; return Reflect.ownKeys(value); } });
    await assert.rejects(inspectProductSdkBundle({ expectedTarget: { platform: 'win32', arch: 'arm64' },
      compatibilityBinding: { ...oversized, later } }), code);
    assert.equal(laterVisits, 0);
  }
});
