import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile, realpath, rm, readdir, lstat, cp, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createProductSdkIdentityModule } from './product-identity.mjs';
import { verifyPackagedProductSdk } from './packaged-resource.mjs';
import { publishProductSdkResource } from './product-resource.mjs';
import { initialize } from './prepare.mjs';
import { inventory, canonical } from './validate.mjs';

const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builder = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
const asar = builder('@electron/asar');
const target = { platform: 'win32', arch: 'arm64' };
const applicationBuild = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0', gitSha: 'a'.repeat(40),
  buildEpoch: '1700000000', platform: 'win32', arch: 'arm64', channel: 'alpha', workflowRunUrl: '' };
const filename = 'electron/generated/plugin-sdk/identity.mjs';
const withoutSdk = () => ({ schema: 1, kind: 'lawoss-product-sdk-packaging', mode: 'without-sdk', target, applicationBuild, sdk: null });
async function packaged(t, identity = withoutSdk()) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-packaged-sdk-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const resourcesRoot = path.join(base, 'resources'), source = path.join(base, 'source');
  await mkdir(resourcesRoot);
  await mkdir(path.join(source, path.dirname(filename)), { recursive: true });
  await writeFile(path.join(source, filename), createProductSdkIdentityModule(identity));
  await asar.createPackage(source, path.join(resourcesRoot, 'app.asar'));
  await writeFile(path.join(resourcesRoot, 'build-info.json'), JSON.stringify(applicationBuild));
  const validationParent = path.join(base, 'unused-validation');
  return { base, source, input: { resourcesRoot, target, expectedMode: identity.mode, applicationBuild, validationParent }, identity };
}

test('actual asar without-sdk identity and public build metadata verify without any validation workspace', async t => {
  const f = await packaged(t), result = await verifyPackagedProductSdk(f.input);
  assert.deepEqual(result, { status: 'verified', mode: 'without-sdk', target, applicationBuild });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.target), true);
  assert.equal(Object.isFrozen(result.applicationBuild), true);
  assert.deepEqual((await readdir(f.input.resourcesRoot)).sort(), ['app.asar', 'build-info.json']);
  await assert.rejects(lstat(f.input.validationParent), { code: 'ENOENT' });
});

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

async function sdkPackage(t) {
  const f = await packaged(t), bundle = await fixture(t);
  const buildParent = path.join(f.base, 'publication');
  await mkdir(buildParent, { mode: 0o700 });
  const published = await publishProductSdkResource({ ...bundle, buildParent, outputName: 'plugin-sdk', transport: 'tar+gzip' });
  await cp(published.resourceRoot, path.join(f.input.resourcesRoot, 'plugin-sdk'), { recursive: true, dereference: false });
  f.identity = { ...withoutSdk(), mode: 'sdk', sdk: published.identity };
  f.input.expectedMode = 'sdk';
  await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(f.identity));
  await asar.createPackage(f.source, path.join(f.input.resourcesRoot, 'app.asar'));
  await initialize(f.input.validationParent);
  return { ...f, bundle };
}

test('actual asar SDK authority verifies an inert capsule and cleans only its fresh owned verification workspace', async t => {
  const f = await sdkPackage(t), before = await inventory(f.input.resourcesRoot);
  const parent = await lstat(f.input.validationParent);
  const result = await verifyPackagedProductSdk(f.input);
  assert.deepEqual(result, { status: 'verified', mode: 'sdk', target, applicationBuild,
    manifestSha256: f.identity.sdk.manifestSha256, capsuleSha256: f.identity.sdk.capsule.sha256 });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.target), true);
  assert.equal(Object.isFrozen(result.applicationBuild), true);
  assert.deepEqual(await inventory(f.input.resourcesRoot), before);
  assert.equal((await lstat(f.input.validationParent)).ino, parent.ino);
  assert.deepEqual((await readdir(f.input.validationParent)).sort(), ['.owner.json', 'cache', 'empty-npmrc', 'home']);
});

test('without-sdk refuses every stale SDK resource including an empty directory and a symbolic directory', async t => {
  for (const kind of ['file', 'directory', 'symbolic-directory']) await t.test(kind, async t => {
    const f = await packaged(t), entry = path.join(f.input.resourcesRoot, 'plugin-sdk');
    if (kind === 'file') await writeFile(entry, 'preserve');
    else if (kind === 'directory') await mkdir(entry);
    else { const outside = path.join(f.base, 'outside'); await mkdir(outside); await symlink(outside, entry, 'junction'); }
    const before = await lstat(entry);
    await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
    assert.equal((await lstat(entry)).ino, before.ino);
    await assert.rejects(lstat(f.input.validationParent), { code: 'ENOENT' });
  });
});

test('actual private mode, target, build and module grammar cannot be replaced by public metadata', async t => {
  const f = await packaged(t);
  for (const input of [
    { ...f.input, expectedMode: 'sdk' },
    { ...f.input, target: { platform: 'win32', arch: 'x64' }, applicationBuild: { ...applicationBuild, arch: 'x64' } },
    { ...f.input, applicationBuild: { ...applicationBuild, gitSha: 'b'.repeat(40) } },
  ]) await assert.rejects(verifyPackagedProductSdk(input));
  await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(f.identity) + '\nglobalThis.PACKAGED_SDK_EXECUTED=true;');
  await asar.createPackage(f.source, path.join(f.input.resourcesRoot, 'app.asar'));
  await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_IDENTITY_INVALID' });
  assert.equal(globalThis.PACKAGED_SDK_EXECUTED, undefined);
  await rm(path.join(f.source, filename));
  await asar.createPackage(f.source, path.join(f.input.resourcesRoot, 'app.asar'));
  await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_IDENTITY_INVALID' });
  await assert.rejects(lstat(f.input.validationParent), { code: 'ENOENT' });
});

test('public BuildInfo must be exact bounded regular single-link data', async t => {
  for (const kind of ['different', 'oversized', 'malformed', 'hardlink']) await t.test(kind, async t => {
    const f = await packaged(t), file = path.join(f.input.resourcesRoot, 'build-info.json');
    if (kind === 'different') await writeFile(file, JSON.stringify({ ...applicationBuild, buildEpoch: '1700000001' }));
    if (kind === 'oversized') await writeFile(file, JSON.stringify(applicationBuild) + ' '.repeat(8193));
    if (kind === 'malformed') await writeFile(file, 'PRIVATE_METADATA_SENTINEL');
    if (kind === 'hardlink') await link(file, path.join(f.base, 'other-build-info'));
    await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
    await assert.rejects(lstat(f.input.validationParent), { code: 'ENOENT' });
  });
});

test('SDK verification requires an existing owned private validation parent and never adopts an old workspace', async t => {
  const f = await sdkPackage(t), parent = f.input.validationParent, old = path.join(parent, 'verification');
  await initialize(old);
  await writeFile(path.join(old, 'evidence'), 'retained old evidence');
  const before = await lstat(old);
  await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
  assert.equal((await lstat(old)).ino, before.ino);
  assert.equal(await readFile(path.join(old, 'evidence'), 'utf8'), 'retained old evidence');
  const unknown = path.join(f.base, 'unowned'); await mkdir(unknown, { mode: 0o700 });
  await assert.rejects(verifyPackagedProductSdk({ ...f.input, validationParent: unknown }));
  assert.deepEqual(await readdir(unknown), []);
  const absent = path.join(f.base, 'absent');
  await assert.rejects(verifyPackagedProductSdk({ ...f.input, validationParent: absent }));
  await assert.rejects(lstat(absent), { code: 'ENOENT' });
});

test('validation parent overlapping the packaged resources is refused without writing a workspace', async t => {
  const f = await sdkPackage(t), original = await inventory(f.input.resourcesRoot);
  const nested = path.join(f.input.resourcesRoot, 'owned-validation'); await initialize(nested);
  const before = await inventory(nested);
  await assert.rejects(verifyPackagedProductSdk({ ...f.input, validationParent: nested }), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
  assert.deepEqual(await inventory(nested), before);
  await assert.rejects(lstat(path.join(nested, 'verification')), { code: 'ENOENT' });
  assert.deepEqual((await inventory(f.input.resourcesRoot)).filter(record => !record.path.startsWith('owned-validation/')), original);
});

test('tampered capsule or resource JavaScript refuses and retains the fresh validation workspace without executing it', async t => {
  for (const kind of ['capsule', 'resource-js']) await t.test(kind, async t => {
    const f = await sdkPackage(t), resource = path.join(f.input.resourcesRoot, 'plugin-sdk');
    if (kind === 'capsule') {
      const file = path.join(resource, 'payload.tgz'), bytes = await readFile(file); bytes[bytes.length - 1] ^= 1; await writeFile(file, bytes);
    } else await writeFile(path.join(resource, 'verifier/validate.mjs'), 'globalThis.SDK_RESOURCE_EXECUTED=true;throw Error("must not run");');
    await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PRODUCT_SDK_CAPSULE_INVALID' });
    const workspace = path.join(f.input.validationParent, 'verification');
    assert.equal((await lstat(path.join(workspace, '.owner.json'))).isFile(), true);
    assert.equal(globalThis.SDK_RESOURCE_EXECUTED, undefined);
    await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
  });
});

async function updatePrivateIdentity(f) {
  await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(f.identity));
  await asar.createPackage(f.source, path.join(f.input.resourcesRoot, 'app.asar'));
}

test('even resource JavaScript explicitly bound by actual asar identity is never evaluated', async t => {
  const f = await sdkPackage(t), verifier = path.join(f.input.resourcesRoot, 'plugin-sdk/verifier');
  await writeFile(path.join(verifier, 'validate.mjs'), 'globalThis.SDK_BOUND_RESOURCE_EXECUTED=true;throw Error("never execute");');
  f.identity = { ...f.identity, sdk: { ...f.identity.sdk, verifierSha256: hash(canonical(await inventory(verifier))) } };
  await updatePrivateIdentity(f);
  assert.equal((await verifyPackagedProductSdk(f.input)).status, 'verified');
  assert.equal(globalThis.SDK_BOUND_RESOURCE_EXECUTED, undefined);
  await assert.rejects(lstat(path.join(f.input.validationParent, 'verification')), { code: 'ENOENT' });
});

test('full capsule inventory rejects extra or missing notices even with updated private capsule and manifest digests', async t => {
  for (const kind of ['missing', 'extra']) await t.test(kind, async t => {
    const f = await sdkPackage(t), payload = f.bundle.payloadRoot, manifestFile = path.join(payload, 'payload-manifest.json');
    const manifest = JSON.parse(await readFile(manifestFile, 'utf8'));
    if (kind === 'missing') {
      const name = 'third-party-notices/licenses/opencode-MIT.txt';
      await rm(path.join(payload, name)); manifest.files = manifest.files.filter(record => record.path !== name);
    } else {
      const name = 'third-party-notices/extra.txt', content = Buffer.from('extra inert notice');
      await writeFile(path.join(payload, name), content);
      manifest.files.push({ path: name, bytes: content.length, executable: false, sha256: hash(content) });
      manifest.files.sort((a, b) => a.path < b.path ? -1 : 1);
    }
    await writeFile(manifestFile, JSON.stringify(manifest));
    const toolRequire = createRequire(new URL('./tools/package.json', import.meta.url));
    const tar = createRequire(toolRequire.resolve('@npmcli/arborist/package.json'))('tar');
    const archive = path.join(f.input.resourcesRoot, 'plugin-sdk/payload.tgz');
    await tar.c({ cwd: payload, file: archive, gzip: true, portable: true, noMtime: true, follow: false, strict: true }, ['.']);
    const bytes = await readFile(archive);
    f.identity = { ...f.identity, sdk: { ...f.identity.sdk, manifestSha256: hash(await readFile(manifestFile)),
      capsule: { ...f.identity.sdk.capsule, bytes: bytes.length, sha256: hash(bytes) } } };
    await updatePrivateIdentity(f);
    await assert.rejects(verifyPackagedProductSdk(f.input));
    assert.equal((await lstat(path.join(f.input.validationParent, 'verification/.owner.json'))).isFile(), true);
    assert.equal((await lstat(archive)).size, bytes.length);
  });
});

test('postflight build drift, replaced ownership and new admission retain evidence without deleting unknown entries', async t => {
  for (const kind of ['build-drift', 'workspace-replaced', 'parent-replaced', 'owner-token-drift', 'new-admission']) await t.test(kind, async t => {
    const f = await sdkPackage(t), parent = f.input.validationParent, workspace = path.join(parent, 'verification');
    const moved = path.join(f.base, 'retained-original');
    const extract = asar.extractFile;
    let reads = 0;
    asar.extractFile = (...args) => {
      const bytes = extract(...args);
      if (args[0] === path.join(f.input.resourcesRoot, 'app.asar') && ++reads === 2) {
        if (kind === 'build-drift') writeFileSync(path.join(f.input.resourcesRoot, 'build-info.json'), JSON.stringify({ ...applicationBuild, buildEpoch: '1700000001' }));
        if (kind === 'workspace-replaced') { renameSync(workspace, moved); mkdirSync(workspace); writeFileSync(path.join(workspace, 'unknown'), 'preserve replacement'); }
        if (kind === 'parent-replaced') { renameSync(parent, moved); mkdirSync(parent); writeFileSync(path.join(parent, 'unknown'), 'preserve replacement'); }
        if (kind === 'owner-token-drift') {
          const file = path.join(workspace, '.owner.json'), owner = JSON.parse(readFileSync(file, 'utf8'));
          owner.token = owner.token === '00000000-0000-0000-0000-000000000000' ? '11111111-1111-1111-1111-111111111111' : '00000000-0000-0000-0000-000000000000';
          writeFileSync(file, JSON.stringify(owner));
        }
        if (kind === 'new-admission') mkdirSync(path.join(workspace, '.admit-payload'));
      }
      return bytes;
    };
    try { await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'PACKAGED_SDK_RESOURCE_INVALID' }); }
    finally { asar.extractFile = extract; }
    assert.equal(reads, 2);
    if (kind === 'workspace-replaced' || kind === 'parent-replaced') {
      const replacement = kind === 'workspace-replaced' ? workspace : parent;
      assert.deepEqual(await readdir(replacement), ['unknown']);
      assert.equal(await readFile(path.join(replacement, 'unknown'), 'utf8'), 'preserve replacement');
      const original = kind === 'workspace-replaced' ? moved : path.join(moved, 'verification');
      assert.equal((await lstat(path.join(original, '.owner.json'))).isFile(), true);
      assert.equal((await lstat(path.join(original, 'payload'))).isDirectory(), true);
    } else {
      assert.equal((await lstat(path.join(workspace, '.owner.json'))).isFile(), true);
      assert.equal((await lstat(path.join(workspace, 'payload'))).isDirectory(), true);
      if (kind === 'new-admission') assert.equal((await lstat(path.join(workspace, '.admit-payload'))).isDirectory(), true);
    }
  });
});

test('real owned-directory cleanup EACCES cannot publish success or delete the validation parent', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'requires ordinary POSIX permissions for a real cleanup EACCES' : false,
}, async t => {
  const f = await sdkPackage(t), workspace = path.join(f.input.validationParent, 'verification'), payload = path.join(workspace, 'payload');
  const original = asar.extractFile, before = await lstat(f.input.validationParent);
  let reads = 0;
  asar.extractFile = (...args) => {
    const bytes = original(...args);
    if (args[0] === path.join(f.input.resourcesRoot, 'app.asar') && ++reads === 2) chmodSync(payload, 0o000);
    return bytes;
  };
  try { await assert.rejects(verifyPackagedProductSdk(f.input), { code: 'EACCES' }); }
  finally { asar.extractFile = original; chmodSync(payload, 0o700); }
  assert.equal(reads, 2);
  assert.equal((await lstat(f.input.validationParent)).ino, before.ino);
  assert.equal((await lstat(workspace)).isDirectory(), true);
  assert.equal((await lstat(payload)).isDirectory(), true);
  assert.equal((await lstat(path.join(f.input.resourcesRoot, 'app.asar'))).isFile(), true);
});
