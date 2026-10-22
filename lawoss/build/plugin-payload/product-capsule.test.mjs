import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, chmod, lstat, readlink, symlink, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishProductSdkResource } from './product-resource.mjs';
import { inventory } from './validate.mjs';
import { createRequire } from 'node:module';

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
const code = { code: 'PRODUCT_SDK_RESOURCE_INVALID' };
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

async function publication(t) {
  const f = await fixture(t);
  const buildParent = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-build-')));
  t.after(() => rm(buildParent, { recursive: true, force: true }));
  return { ...f, buildParent, outputName: 'plugin-sdk' };
}

// An inert Mach-O-shaped SDK member must retain its bytes without becoming a
// loose signing input. This is format/data proof, not native execution.
async function assertCapsuleRoundtrip(t, links = false) {
  const f = await publication(t);
  const native = Buffer.from('cffaedfe0c000001000000000600000000000000000000000000000000000000', 'hex');
  const name = 'node_modules/native.node';
  await writeFile(path.join(f.payloadRoot, name), native, { mode: 0o751 });
  await chmod(path.join(f.payloadRoot, 'node_modules'), 0o750);
  if (links) {
    await mkdir(path.join(f.payloadRoot, 'node_modules/.bin'));
    await symlink('../native.node', path.join(f.payloadRoot, 'node_modules/.bin/native'));
  }
  f.manifest.files = await inventory(f.payloadRoot);
  f.manifest.files = f.manifest.files.filter(x => x.path !== 'payload-manifest.json');
  await writeFile(path.join(f.payloadRoot, 'payload-manifest.json'), JSON.stringify(f.manifest));
  f.expectedManifestSha256 = hash(await readFile(path.join(f.payloadRoot, 'payload-manifest.json')));
  f.compatibilityBinding.payloadManifestSha256 = f.expectedManifestSha256;
  const before = await inventory(f.payloadRoot);
  const result = await publishProductSdkResource({ ...f, transport: 'tar+gzip' });
  assert.deepEqual((await readdir(result.resourceRoot)).sort(), ['payload.tgz', 'verifier']);
  assert.equal(result.identity.kind, 'lawoss-product-sdk-capsule');
  assert.equal(result.identity.capsule.format, 'tar+gzip');
  assert.equal(result.identity.capsule.file, 'payload.tgz');
  const bytes = await readFile(path.join(result.resourceRoot, 'payload.tgz'));
  assert.equal(bytes.subarray(0, 2).toString('hex'), '1f8b');
  assert.equal(result.identity.capsule.sha256, hash(bytes));
  assert.equal(result.identity.capsule.bytes, bytes.length);
  const require = createRequire(new URL('./tools/package.json', import.meta.url));
  const tar = createRequire(require.resolve('@npmcli/arborist/package.json'))('tar');
  const extracted = path.join(f.buildParent, 'independent-extraction');
  await mkdir(extracted);
  await tar.x({ file: path.join(result.resourceRoot, 'payload.tgz'), cwd: extracted, strict: true, umask: 0 });
  assert.deepEqual(await inventory(extracted), before);
  assert.deepEqual(await readFile(path.join(extracted, name)), native);
  if (links) assert.equal(await readlink(path.join(extracted, 'node_modules/.bin/native')), '../native.node');
  if (process.platform !== 'win32') {
    assert.equal((await lstat(path.join(extracted, name))).mode & 0o777, 0o751);
    assert.equal((await lstat(path.join(extracted, 'node_modules'))).mode & 0o777, 0o750);
  }
  const generated = await import(`data:text/javascript,${encodeURIComponent(result.privateIdentityModule)}`);
  assert.deepEqual(generated.default, result.identity);
  assert.equal(Object.isFrozen(generated.default.capsule), true);
  assert.equal(Object.isFrozen(result.identity.capsule), true);
  assert.deepEqual(await inventory(f.payloadRoot), before);
}

test('capsule transport preserves native bytes and private identity behind a data archive', t => assertCapsuleRoundtrip(t));
test('capsule transport preserves safe bin links and exact executable/directory modes', { skip: process.platform === 'win32' ? 'POSIX symlink privilege and mode fixture' : false }, t => assertCapsuleRoundtrip(t, true));

test('unknown resource transport refuses before copying or lease creation', async t => {
  const f = await publication(t);
  await assert.rejects(publishProductSdkResource({ ...f, transport: 'zip' }), code);
  assert.deepEqual(await readdir(f.buildParent), []);
});

test('a truncated produced archive refuses publication and preserves the accepted source', async t => {
  const f = await publication(t), before = await inventory(f.payloadRoot);
  const require = createRequire(new URL('./tools/package.json', import.meta.url));
  const tar = createRequire(require.resolve('@npmcli/arborist/package.json'))('tar');
  const descriptor = Object.getOwnPropertyDescriptor(tar, 'c'), original = tar.c;
  let corruptions = 0;
  Object.defineProperty(tar, 'c', { configurable: true, value: async (...args) => {
    await original(...args);
    await writeFile(args[0].file, Buffer.from('1f8b0800', 'hex'));
    corruptions++;
  } });
  try { await assert.rejects(publishProductSdkResource({ ...f, transport: 'tar+gzip' })); }
  finally { Object.defineProperty(tar, 'c', descriptor); }
  assert.equal(corruptions, 1);
  assert.deepEqual(await readdir(f.buildParent), []);
  assert.deepEqual(await inventory(f.payloadRoot), before);
});

test('a wrong tar version is refused before its implementation executes', async t => {
  const f = await publication(t);
  const copied = path.join(f.buildParent, 'copied-helper'), stage = path.join(f.buildParent, 'stage');
  await mkdir(copied); await mkdir(stage);
  for (const name of ['product-capsule.mjs', 'validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
    'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md',
    'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt',
    'sdk/notices/licenses/kubernetes-Apache-2.0.txt', 'tools/package.json']) {
    await mkdir(path.dirname(path.join(copied, name)), { recursive: true });
    await writeFile(path.join(copied, name), await sourceBytes(name));
  }
  await cp(f.payloadRoot, path.join(stage, 'payload'), { recursive: true });
  const arborist = path.join(copied, 'tools/node_modules/@npmcli/arborist');
  const tar = path.join(arborist, 'node_modules/tar'), sentinel = path.join(f.buildParent, 'wrong-tar-executed');
  await mkdir(tar, { recursive: true });
  await writeFile(path.join(arborist, 'package.json'), JSON.stringify({ name: '@npmcli/arborist', version: '9.4.0' }));
  await writeFile(path.join(tar, 'package.json'), JSON.stringify({ name: 'tar', version: '7.5.21', main: 'index.cjs' }));
  await writeFile(path.join(tar, 'index.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed'); throw new Error('WRONG_TAR_EXECUTED');`);
  const { createProductSdkCapsule } = await import(pathToFileURL(path.join(copied, 'product-capsule.mjs')));
  await assert.rejects(createProductSdkCapsule(stage, { manifestSha256: f.expectedManifestSha256, target: f.expectedTarget }), { message: 'SDK_CAPSULE_TOOLS_INVALID' });
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
  assert.deepEqual(await inventory(path.join(stage, 'payload')), await inventory(f.payloadRoot));
});
