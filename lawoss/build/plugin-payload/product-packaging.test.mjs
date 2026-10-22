import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, lstat, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareProductSdkPackaging } from './product-packaging.mjs';
import { readProductSdkIdentityModule } from './product-identity.mjs';

const target = { platform: 'win32', arch: 'arm64' };
const build = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0', gitSha: 'a'.repeat(40),
  buildEpoch: '1700000000', platform: 'win32', arch: 'arm64', channel: 'alpha', workflowRunUrl: '' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
async function desktop(t) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-packaging-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const desktopRoot = path.join(base, 'desktop');
  await mkdir(desktopRoot);
  await mkdir(path.join(desktopRoot, 'resources'), { mode: 0o755 });
  return { desktopRoot, target, applicationBuild: build, supplier: { mode: 'without-sdk' } };
}

test('explicit without-sdk packages frozen private build identity and no SDK resource', async t => {
  const input = await desktop(t), parent = path.join(input.desktopRoot, 'resources');
  const before = await lstat(parent);
  const result = await prepareProductSdkPackaging(input);
  const root = path.join(parent, '.plugin-sdk-build');
  assert.equal(result.applicationCodeRoot, path.join(root, 'application-code'));
  assert.equal(result.identityModulePath, path.join(result.applicationCodeRoot, 'identity.mjs'));
  assert.equal(result.resourceRoot, null);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.identity), true);
  assert.equal(Object.isFrozen(result.identity.applicationBuild), true);
  assert.equal(Object.isFrozen(result.identity.target), true);
  assert.deepEqual(result.identity, { schema: 1, kind: 'lawoss-product-sdk-packaging', mode: 'without-sdk',
    applicationBuild: build, target, sdk: null });
  assert.deepEqual(readProductSdkIdentityModule(await readFile(result.identityModulePath, 'utf8')), result.identity);
  assert.deepEqual(await readdir(result.applicationCodeRoot), ['identity.mjs']);
  assert.equal((await readdir(root)).includes('publication'), false);
  assert.deepEqual(await readdir(parent), ['.plugin-sdk-build']);
  assert.equal((await lstat(parent)).mode, before.mode);
  assert.equal((await lstat(parent)).ino, before.ino);
});

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

async function accepted(t) {
  const input = await desktop(t), bundle = await fixture(t);
  input.supplier = { mode: 'accepted', payloadRoot: bundle.payloadRoot,
    expectedManifestSha256: bundle.expectedManifestSha256, acceptedLockSha256: bundle.acceptedLockSha256,
    compatibilityBinding: bundle.compatibilityBinding };
  return input;
}

test('accepted bundle is copied as a capsule and bound into private application code without executing SDK data', async t => {
  const input = await accepted(t), result = await prepareProductSdkPackaging(input);
  assert.equal(result.resourceRoot, path.join(input.desktopRoot, 'resources/.plugin-sdk-build/publication/plugin-sdk'));
  assert.deepEqual((await readdir(result.resourceRoot)).sort(), ['payload.tgz', 'verifier']);
  assert.equal(result.identity.mode, 'sdk');
  assert.equal(result.identity.sdk.manifestSha256, input.supplier.expectedManifestSha256);
  assert.equal(result.identity.sdk.consumerMode, 'javascript-fallback');
  assert.equal(result.identity.sdk.capsule.sha256, hash(await readFile(path.join(result.resourceRoot, 'payload.tgz'))));
  assert.equal(Object.isFrozen(result.identity.sdk), true);
  assert.equal(Object.isFrozen(result.identity.sdk.target), true);
  assert.equal(Object.isFrozen(result.identity.sdk.capsule), true);
  assert.deepEqual(readProductSdkIdentityModule(await readFile(result.identityModulePath, 'utf8')), result.identity);
  assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), ['.plugin-sdk-build']);
});

test('native supplier refuses a foreign target before executable reads, children or build generation', async t => {
  const input = await desktop(t);
  input.target = { platform: process.platform === 'win32' ? 'darwin' : 'win32', arch: 'x64' };
  input.applicationBuild = { ...build, ...input.target };
  input.supplier = { mode: 'native', consumerNode: path.join(input.desktopRoot, 'does-not-exist'),
    pnpmCli: path.join(input.desktopRoot, 'also-absent'), headSha: 'b'.repeat(40), checkoutSha: build.gitSha };
  await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_NATIVE_TARGET_MISMATCH' });
  assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), []);
});

test('a later generation archives the entire prior capsule and code before explicit without-sdk output', async t => {
  const input = await accepted(t), first = await prepareProductSdkPackaging(input);
  const oldCode = await readFile(first.identityModulePath), oldCapsule = await readFile(path.join(first.resourceRoot, 'payload.tgz'));
  const parent = path.join(input.desktopRoot, 'resources'), root = path.join(parent, '.plugin-sdk-build');
  const previous = await lstat(root);
  const second = await prepareProductSdkPackaging({ ...input, supplier: { mode: 'without-sdk' }, applicationBuild: { ...build, buildEpoch: '1700000001' } });
  assert.notEqual((await lstat(root)).ino, previous.ino);
  const archives = (await readdir(parent)).filter(name => name.startsWith('..plugin-sdk-build.previous-'));
  assert.equal(archives.length, 1);
  const archive = path.join(parent, archives[0]);
  assert.equal((await lstat(archive)).ino, previous.ino);
  assert.deepEqual(await readFile(path.join(archive, 'application-code/identity.mjs')), oldCode);
  assert.deepEqual(await readFile(path.join(archive, 'publication/plugin-sdk/payload.tgz')), oldCapsule);
  assert.equal(second.resourceRoot, null);
  assert.equal(second.identity.mode, 'without-sdk');
  assert.equal((await readdir(root)).includes('publication'), false);
  assert.notDeepEqual(await readFile(second.identityModulePath), oldCode);
  const third = await prepareProductSdkPackaging({ ...input, supplier: { mode: 'without-sdk' } });
  assert.equal(third.identity.applicationBuild.buildEpoch, '1700000000');
  assert.equal((await readdir(parent)).filter(name => name.startsWith('..plugin-sdk-build.previous-')).length, 2);
});

test('repeated accepted preparation publishes fresh files while retaining identical prior capsule and code bytes', async t => {
  const input = await accepted(t), first = await prepareProductSdkPackaging(input);
  const code = await readFile(first.identityModulePath), capsule = await readFile(path.join(first.resourceRoot, 'payload.tgz'));
  const firstFile = await lstat(path.join(first.resourceRoot, 'payload.tgz'));
  const second = await prepareProductSdkPackaging(input);
  assert.notEqual((await lstat(path.join(second.resourceRoot, 'payload.tgz'))).ino, firstFile.ino);
  assert.deepEqual(await readFile(second.identityModulePath), code);
  assert.deepEqual(await readFile(path.join(second.resourceRoot, 'payload.tgz')), capsule);
  const parent = path.join(input.desktopRoot, 'resources');
  const archive = (await readdir(parent)).find(name => name.startsWith('..plugin-sdk-build.previous-'));
  assert.ok(archive);
  assert.deepEqual(await readFile(path.join(parent, archive, 'application-code/identity.mjs')), code);
  assert.deepEqual(await readFile(path.join(parent, archive, 'publication/plugin-sdk/payload.tgz')), capsule);
});

test('invalid external proof or target refuses before changing an existing completed generation', async t => {
  const input = await accepted(t), prior = await prepareProductSdkPackaging({ ...input, supplier: { mode: 'without-sdk' } });
  const before = await lstat(path.dirname(prior.applicationCodeRoot)), codeBytes = await readFile(prior.identityModulePath);
  for (const mutate of [
    x => { x.supplier.expectedManifestSha256 = '0'.repeat(64); },
    x => { x.supplier.compatibilityBinding.sources['validate.mjs'] = '0'.repeat(64); },
    x => { x.supplier.compatibilityBinding.tests.consumer.skipped = 1; },
    x => { x.target.arch = 'x64'; x.applicationBuild.arch = 'x64'; },
  ]) {
    const bad = structuredClone(input); mutate(bad);
    await assert.rejects(prepareProductSdkPackaging(bad), { code: 'PRODUCT_SDK_BUNDLE_INVALID' });
    assert.equal((await lstat(path.dirname(prior.applicationCodeRoot))).ino, before.ino);
    assert.deepEqual(await readFile(prior.identityModulePath), codeBytes);
    assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), ['.plugin-sdk-build']);
  }
});

test('unowned root or an existing generation lease is never adopted or overwritten', async t => {
  for (const entry of ['.plugin-sdk-build', '..plugin-sdk-build.generation.lock']) await t.test(entry, async t => {
    const input = await desktop(t), parent = path.join(input.desktopRoot, 'resources'), existing = path.join(parent, entry);
    await writeFile(existing, 'another owner');
    const before = await lstat(existing);
    await assert.rejects(prepareProductSdkPackaging(input));
    assert.equal((await lstat(existing)).ino, before.ino);
    assert.equal(await readFile(existing, 'utf8'), 'another owner');
    assert.deepEqual(await readdir(parent), [entry]);
  });
});

test('an accepted payload inside the build root refuses before rotating or writing any entry', async t => {
  const input = await accepted(t), parent = path.join(input.desktopRoot, 'resources');
  // The payload is actual valid inert data, not a forged listing or verifier.
  const root = path.join(parent, '.plugin-sdk-build');
  const { rename } = await import('node:fs/promises');
  await rename(input.supplier.payloadRoot, root);
  input.supplier.payloadRoot = root;
  const before = await lstat(root), manifest = await readFile(path.join(root, 'payload-manifest.json'));
  await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_PACKAGING_INVALID' });
  assert.equal((await lstat(root)).ino, before.ino);
  assert.deepEqual(await readFile(path.join(root, 'payload-manifest.json')), manifest);
  assert.deepEqual(await readdir(parent), ['.plugin-sdk-build']);
});

test('own-data admission refuses getters, extra fields, malformed builds and oversized suppliers before writes', async t => {
  const input = await desktop(t);
  let called = 0;
  const getter = { ...build };
  Object.defineProperty(getter, 'gitSha', { enumerable: true, get() { called++; throw Error('must not execute'); } });
  for (const bad of [
    { ...input, applicationBuild: getter },
    { ...input, applicationBuild: { ...build, gitSha: 'bad' } },
    { ...input, supplier: { mode: 'without-sdk', extra: true } },
    { ...input, supplier: { mode: 'accepted', payloadRoot: 'x'.repeat(65537) } },
    { ...input, target: { ...target, libc: 'glibc' } },
    { ...input, unexpected: true },
  ]) await assert.rejects(prepareProductSdkPackaging(bad));
  const supplierGetter = {};
  Object.defineProperty(supplierGetter, 'mode', { enumerable: true, get() { called++; throw Error('must not execute'); } });
  await assert.rejects(prepareProductSdkPackaging({ ...input, supplier: supplierGetter }));
  assert.equal(called, 0);
  assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), []);
});

test('native source identity must be explicit and bind the application checkout before executable reads', async t => {
  const input = await desktop(t);
  input.target = { platform: process.platform, arch: process.arch, ...(process.platform === 'linux' ? { libc: 'glibc' } : {}) };
  input.applicationBuild = { ...build, platform: process.platform, arch: process.arch };
  const native = { mode: 'native', consumerNode: path.join(input.desktopRoot, 'absent-consumer'),
    pnpmCli: path.join(input.desktopRoot, 'absent-cli'), headSha: 'b'.repeat(40), checkoutSha: build.gitSha };
  for (const change of [{ headSha: 'B'.repeat(40) }, { checkoutSha: 'c'.repeat(40) }, { checkoutSha: null }]) {
    await assert.rejects(prepareProductSdkPackaging({ ...input, supplier: { ...native, ...change } }), { code: 'PRODUCT_SDK_PACKAGING_INVALID' });
    assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), []);
  }
});

test('original CLI wrong-consumer failure closes normally but retains the failed generation and exact finite summary', async t => {
  const input = await desktop(t);
  input.target = { platform: process.platform, arch: process.arch, ...(process.platform === 'linux' ? { libc: 'glibc' } : {}) };
  input.applicationBuild = { ...build, platform: process.platform, arch: process.arch };
  const pnpmRoot = path.join(path.dirname(input.desktopRoot), 'inert-pnpm');
  await mkdir(path.join(pnpmRoot, 'bin'), { recursive: true });
  await writeFile(path.join(pnpmRoot, 'package.json'), JSON.stringify({ name: 'pnpm', version: '11.4.0', bin: { pnpm: 'bin/pnpm.mjs' } }));
  const cli = path.join(pnpmRoot, 'bin/pnpm.mjs');
  await writeFile(cli, "throw new Error('Inert pnpm must not execute');\n");
  const originalCli = await readFile(cli);
  input.supplier = { mode: 'native', consumerNode: await realpath(process.execPath), pnpmCli: cli,
    headSha: 'b'.repeat(40), checkoutSha: build.gitSha };
  await assert.rejects(prepareProductSdkPackaging(input), { code: 'PRODUCT_SDK_NATIVE_CHILD_FAILED' });
  const parent = path.join(input.desktopRoot, 'resources'), root = path.join(parent, '.plugin-sdk-build');
  const summary = JSON.parse(await readFile(path.join(root, 'supplier/runtime-consumer-summary.json'), 'utf8'));
  assert.equal(summary.status, 'failed');
  assert.equal(summary.failedStage, 'admission');
  assert.equal(summary.code, 'CONSUMER_VERSION');
  assert.equal(summary.headSha, 'b'.repeat(40));
  assert.equal(summary.checkoutSha, build.gitSha);
  assert.equal(summary.producer, null);
  assert.equal(summary.tests.producer, null);
  assert.equal(summary.tests.consumer, null);
  assert.equal(summary.payloadManifestSha256, null);
  assert.equal(summary.acquisition, null);
  assert.deepEqual((await readdir(parent)).sort(), ['..plugin-sdk-build.generation.lock', '.plugin-sdk-build']);
  assert.equal((await readdir(root)).includes('application-code'), false);
  assert.equal((await readdir(root)).includes('publication'), false);
  assert.deepEqual(await readFile(cli), originalCli);
  await assert.rejects(prepareProductSdkPackaging({ ...input, supplier: { mode: 'without-sdk' } }), { code: 'EEXIST' });
  assert.equal((await lstat(path.join(root, 'supplier/runtime-consumer-validation/.owner.json'))).isFile(), true);
});

test('native admission rejects malformed metadata without exposing its text or creating a generation', async t => {
  const input = await desktop(t);
  input.target = { platform: process.platform, arch: process.arch, ...(process.platform === 'linux' ? { libc: 'glibc' } : {}) };
  input.applicationBuild = { ...build, platform: process.platform, arch: process.arch };
  const pnpmRoot = path.join(path.dirname(input.desktopRoot), 'bad-pnpm');
  await mkdir(path.join(pnpmRoot, 'bin'), { recursive: true });
  const cli = path.join(pnpmRoot, 'bin/pnpm.mjs');
  await writeFile(cli, 'inert data only');
  input.supplier = { mode: 'native', consumerNode: await realpath(process.execPath), pnpmCli: cli,
    headSha: 'b'.repeat(40), checkoutSha: build.gitSha };
  for (const text of ['PRIVATE_METADATA_SENTINEL{', 'null', '[]']) {
    await writeFile(path.join(pnpmRoot, 'package.json'), text);
    await assert.rejects(prepareProductSdkPackaging(input), failure => {
      assert.equal(failure.code, 'PRODUCT_SDK_PACKAGING_INVALID');
      assert.equal(failure.message.includes('PRIVATE_METADATA_SENTINEL'), false);
      return true;
    });
  }
  assert.deepEqual(await readdir(path.join(input.desktopRoot, 'resources')), []);
});
