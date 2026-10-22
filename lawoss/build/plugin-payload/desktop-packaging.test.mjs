import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, lstat, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { prepareDesktopProductSdkPackaging, verifyDesktopProductSdkPackaging, desktopProductSdkTarget, parseDesktopSdkBuildArguments, desktopSdkPackagingFailureDiagnostic } from './desktop-packaging.mjs';
import { createProductSdkIdentityModule } from './product-identity.mjs';
import { canonical, inventory } from './validate.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builder = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
const asar = builder('@electron/asar');
const target = { platform: 'win32', arch: 'arm64' };
const applicationBuild = { schemaVersion: 1, product: 'lawoss-desktop', version: '1.0.0', gitSha: 'a'.repeat(40),
  buildEpoch: '1700000000', platform: 'win32', arch: 'arm64', channel: 'stable', workflowRunUrl: '' };
async function desktop(t) {
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-desktop-sdk-')));
  t.after(() => rm(base, { recursive: true, force: true }));
  const desktopRoot = path.join(base, 'desktop'); await mkdir(path.join(desktopRoot, 'resources'), { recursive: true });
  const resourcesRoot = path.join(base, 'packaged-resources'); await mkdir(resourcesRoot);
  return { base, desktopRoot, resourcesRoot, target, applicationBuild };
}
async function packed(f, prepared) {
  const source = path.join(f.base, 'app-code');
  const folder = path.join(source, 'electron/generated/plugin-sdk'); await mkdir(folder, { recursive: true });
  await writeFile(path.join(folder, 'identity.mjs'), await readFile(prepared.identityModulePath));
  await asar.createPackage(source, path.join(f.resourcesRoot, 'app.asar'));
  await writeFile(path.join(f.resourcesRoot, 'build-info.json'), JSON.stringify(f.applicationBuild));
  if(prepared.resourceRoot) await cp(prepared.resourceRoot, path.join(f.resourcesRoot, 'plugin-sdk'), { recursive: true });
}
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

test('desktop default without-sdk preserves crossbuild support and binds actual asar to its owned generation', async t => {
  const f = await desktop(t), prepared = await prepareDesktopProductSdkPackaging(f);
  assert.equal(prepared.identity.mode, 'without-sdk'); await packed(f, prepared);
  const result = await verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'without-sdk' });
  assert.equal(result.status, 'verified'); assert.equal(result.mode, 'without-sdk');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual((await readdir(f.resourcesRoot)).sort(), ['app.asar', 'build-info.json']);
});

test('accepted foreign SDK is data-only and actual asar must match every source identity field', async t => {
  const f = await desktop(t), bundle = await fixture(t);
  const supplier = { mode: 'accepted', payloadRoot: bundle.payloadRoot, expectedManifestSha256: bundle.expectedManifestSha256,
    acceptedLockSha256: bundle.acceptedLockSha256, compatibilityBinding: bundle.compatibilityBinding };
  const prepared = await prepareDesktopProductSdkPackaging({ ...f, supplier }); await packed(f, prepared);
  const before = await inventory(f.resourcesRoot);
  const result = await verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' });
  assert.equal(result.status, 'verified'); assert.equal(result.mode, 'sdk');
  assert.deepEqual(await inventory(f.resourcesRoot), before);
  assert.equal((await readdir(path.join(f.desktopRoot, 'resources/.plugin-sdk-build'))).includes('verification'), false);
  const changed = { ...prepared.identity, sdk: { ...prepared.identity.sdk, sourceSetSha256: 'b'.repeat(64) } };
  await writeFile(prepared.identityModulePath, createProductSdkIdentityModule(changed));
  await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' }), { code: 'DESKTOP_SDK_PACKAGING_INVALID' });
});

test('strict target and explicit supplier arguments cannot silently enable native or hide failures', () => {
  assert.deepEqual(parseDesktopSdkBuildArguments([]), { mode: 'without-sdk' });
  assert.deepEqual(desktopProductSdkTarget('linux', 'arm64'), { platform: 'linux', arch: 'arm64', libc: 'glibc' });
  assert.throws(() => desktopProductSdkTarget('win32', 'ia32'));
  assert.throws(() => parseDesktopSdkBuildArguments(['--sdk-mode', 'native']));
  assert.throws(() => parseDesktopSdkBuildArguments(['--sdk-mode', 'without-sdk', '--sdk-consumer-node', '/unexpected']));
  assert.throws(() => parseDesktopSdkBuildArguments(['--unknown']));
});

test('dirty development identity remains null, without SDK and without verified BuildInfo', async t => {
  const f = await desktop(t); f.applicationBuild = null;
  const prepared = await prepareDesktopProductSdkPackaging(f); await packed(f, prepared);
  assert.equal(prepared.identity.mode, 'development');
  assert.equal(prepared.identity.applicationBuild, null); assert.equal(prepared.identity.sdk, null);
  const result = await verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'development' });
  assert.equal(result.status, 'development'); assert.equal(result.applicationBuild, null);
  await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' }), { code: 'DESKTOP_SDK_PACKAGING_INVALID' });
});

test('external mode, target and build cannot be inferred from packed or public identity', async t => {
  const f = await desktop(t), prepared = await prepareDesktopProductSdkPackaging(f); await packed(f, prepared);
  for (const input of [
    { ...f, expectedMode: 'sdk' },
    { ...f, expectedMode: 'without-sdk', target: { platform: 'win32', arch: 'x64' } },
    { ...f, expectedMode: 'without-sdk', applicationBuild: { ...applicationBuild, gitSha: 'b'.repeat(40) } },
  ]) await assert.rejects(verifyDesktopProductSdkPackaging(input), { code: 'DESKTOP_SDK_PACKAGING_INVALID' });
  await writeFile(path.join(f.resourcesRoot, 'build-info.json'), JSON.stringify({ ...applicationBuild, gitSha: 'b'.repeat(40) }));
  await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'without-sdk' }), { code: 'PACKAGED_SDK_RESOURCE_INVALID' });
});

test('an unowned generation or active outer lease refuses without adopting its files', async t => {
  const f = await desktop(t), prepared = await prepareDesktopProductSdkPackaging(f); await packed(f, prepared);
  const root = path.join(f.desktopRoot, 'resources/.plugin-sdk-build'), marker = path.join(root, '.owner.json');
  const original = await readFile(marker), owner = JSON.parse(original);
  await writeFile(marker, JSON.stringify({ ...owner, ino: owner.ino + 1 }));
  await assert.rejects(verifyDesktopProductSdkPackaging(f), { code: 'WORKSPACE_INVALID' });
  await writeFile(marker, original);
  const lease = path.join(f.desktopRoot, 'resources/..plugin-sdk-build.generation.lock');
  await writeFile(lease, 'another generation writer');
  await assert.rejects(verifyDesktopProductSdkPackaging(f), { code: 'DESKTOP_SDK_PACKAGING_INVALID' });
  assert.equal(await readFile(lease, 'utf8'), 'another generation writer');
});

test('every SDK tuple field must equal the source generation before any verification workspace is created', async t => {
  const f = await desktop(t), bundle = await fixture(t);
  const prepared = await prepareDesktopProductSdkPackaging({ ...f, supplier: { mode: 'accepted', payloadRoot: bundle.payloadRoot,
    expectedManifestSha256: bundle.expectedManifestSha256, acceptedLockSha256: bundle.acceptedLockSha256, compatibilityBinding: bundle.compatibilityBinding } });
  await packed(f, prepared);
  for (const key of ['manifestSha256', 'verifierSha256', 'inputSha256']) {
    const changed = { ...prepared.identity, sdk: { ...prepared.identity.sdk, [key]: 'b'.repeat(64) } };
    await writeFile(prepared.identityModulePath, createProductSdkIdentityModule(changed));
    await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' }), { code: 'DESKTOP_SDK_PACKAGING_INVALID' });
    await assert.rejects(lstat(path.join(f.desktopRoot, 'resources/.plugin-sdk-build/verification')), { code: 'ENOENT' });
  }
});

test('native crossbuild refuses rather than falling back to without-sdk', async t => {
  const f = await desktop(t);
  const platform = process.platform === 'win32' ? 'darwin' : 'win32';
  const foreign = desktopProductSdkTarget(platform, 'arm64');
  const supplier = { mode: 'native', consumerNode: path.join(f.base, 'missing-node'), pnpmCli: path.join(f.base, 'missing-pnpm'), headSha: 'a'.repeat(40), checkoutSha: applicationBuild.gitSha };
  await assert.rejects(prepareDesktopProductSdkPackaging({ ...f, target: foreign, applicationBuild: { ...applicationBuild, platform }, supplier }), { code: 'PRODUCT_SDK_NATIVE_TARGET_MISMATCH' });
  assert.deepEqual(await readdir(path.join(f.desktopRoot, 'resources')), []);
});

test('actual pinned builder FileSets place only current private identity in ASAR and capsule closure in resources', async t => {
  const f = await desktop(t), bundle = await fixture(t);
  const prepared = await prepareDesktopProductSdkPackaging({ ...f, supplier: { mode: 'accepted', payloadRoot: bundle.payloadRoot,
    expectedManifestSha256: bundle.expectedManifestSha256, acceptedLockSha256: bundle.acceptedLockSha256, compatibilityBinding: bundle.compatibilityBinding } });
  const config = require('yaml').parse(await readFile(new URL('../../../apps/desktop/electron-builder.yml', import.meta.url), 'utf8'));
  const { getFileMatchers, copyFiles } = builder('./fileMatcher.js');
  assert.equal(builder('../package.json').version, '26.16.1');
  const identityMapping = config.files.find(item => typeof item === 'object' && item.to === 'electron/generated/plugin-sdk');
  assert.deepEqual(identityMapping, { from: 'resources/.plugin-sdk-build/application-code', to: 'electron/generated/plugin-sdk', filter: ['identity.mjs'] });
  const resourceMapping = config.extraResources.find(item => item.to === 'plugin-sdk');
  assert.deepEqual(resourceMapping, { from: 'resources/.plugin-sdk-build/publication/plugin-sdk', to: 'plugin-sdk', filter: ['payload.tgz', 'verifier/**'] });
  const rogue = path.join(f.desktopRoot, 'electron/generated/plugin-sdk'); await mkdir(rogue, { recursive: true });
  await writeFile(path.join(rogue, 'identity.mjs'), 'throw new Error("STALE_SOURCE_IDENTITY");');
  await writeFile(path.join(prepared.applicationCodeRoot, 'private-proof.json'), 'must not ship');
  const applicationCode = path.join(f.base, 'builder-app-code');
  const options = { macroExpander: value => value, customBuildOptions: {}, globalOutDir: path.join(f.desktopRoot, 'dist-electron'), defaultSrc: f.desktopRoot };
  await copyFiles(getFileMatchers(config, 'files', applicationCode, options), null, false);
  const codeRecords = await inventory(applicationCode);
  assert.deepEqual(codeRecords.map(item => item.path), ['electron/generated/plugin-sdk/identity.mjs']);
  assert.deepEqual(await readFile(path.join(applicationCode, codeRecords[0].path)), await readFile(prepared.identityModulePath));
  await asar.createPackage(applicationCode, path.join(f.resourcesRoot, 'app.asar'));
  await writeFile(path.join(f.resourcesRoot, 'build-info.json'), JSON.stringify(applicationBuild));
  await copyFiles(getFileMatchers({ extraResources: [resourceMapping] }, 'extraResources', f.resourcesRoot, options), null, false);
  assert.deepEqual((await inventory(path.join(f.resourcesRoot, 'plugin-sdk'))).map(item => item.path), (await inventory(prepared.resourceRoot)).map(item => item.path));
  assert.equal((await verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' })).status, 'verified');
  // The same real matcher exposes an omitted resource instead of silently
  // treating electron-builder's missing-from skip as successful SDK admission.
  await rm(path.join(f.resourcesRoot, 'plugin-sdk'), { recursive: true });
  await copyFiles(getFileMatchers({ extraResources: [{ ...resourceMapping, from: 'resources/.plugin-sdk-build/publication/absent' }] }, 'extraResources', f.resourcesRoot, options), null, false);
  await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' }));
});

test('real afterPack invokes the SDK gate before original prerequisites and early returns', async t => {
  const vm = await import('node:vm'), fs = await import('node:fs');
  const base = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-hook-'))); t.after(() => rm(base, { recursive: true, force: true }));
  const primary = new Error('controlled SDK gate refusal'), calls = [], module = { exports: {} };
  const hookSource = await readFile(new URL('../../../apps/desktop/scripts/electron-after-pack.cjs', import.meta.url), 'utf8');
  const fixtureSource = hookSource.replace('await import("../../../lawoss/build/plugin-payload/desktop-packaging.mjs")',
    'require("../../../lawoss/build/plugin-payload/desktop-packaging.mjs")');
  assert.equal(hookSource.split('await import("../../../lawoss/build/plugin-payload/desktop-packaging.mjs")').length - 1, 1);
  assert.notEqual(fixtureSource, hookSource);
  vm.runInNewContext(fixtureSource, {
    module, require(name) {
      if (name === 'node:fs') return fs;
      if (name === 'node:path') return path;
      if (name === 'electron-builder') return { Arch: { 0: 'ia32' } };
      if (name === './packaged-ocr.cjs') return { pruneOcrRuntime() { calls.push('prune'); } };
      if (name === '../../../lawoss/build/plugin-payload/desktop-packaging.mjs') return {
        desktopProductSdkTarget(platform, arch) { calls.push('target'); return { platform, arch }; },
        async verifyDesktopProductSdkPackaging(input) { calls.push(input); throw primary; },
      };
      throw new Error(`Unexpected hook dependency ${name}`);
    },
  });
  await assert.rejects(module.exports({ appOutDir: base, electronPlatformName: 'linux', arch: 'x64', packager: { appInfo: {} } }), error => error === primary);
  assert.equal(calls.length, 2);
  assert.equal(calls[0], 'target');
  assert.equal(calls[1].resourcesRoot, path.join(base, 'resources'));
});

function assertFinalDistributionGates(workflow) {
  const data = require('yaml').parse(workflow), steps = data.jobs['package-smoke'].steps;
  const finals = steps.filter(step => typeof step.run === 'string' && step.run.includes('electron-builder') && step.run.includes('--prepackaged'));
  assert.equal(finals.length, 3);
  for (const step of finals) {
    const before = steps[steps.indexOf(step) - 1];
    assert.equal(before.if, step.if);
    assert.ok(before.run.startsWith('node apps/desktop/scripts/check-packaged-plugin-sdk.mjs '));
    assert.ok(before.run.includes('--mode sdk'));
    assert.ok(before.run.includes('--target "${{ matrix.target }}"'));
    assert.ok(before.run.includes('--asar "apps/desktop/dist-electron/${{ matrix.asar }}"'));
    assert.ok(step.run.includes('--publish never'));
  }
  for (const name of ['Package desktop app', 'Verify shipped fuses, Node and document tools', 'Verify actual Windows NSIS installation and final bytes', 'Verify final macOS ZIP native startup', 'Verify final Linux AppImage native startup']) assert.equal(steps.filter(step => step.name === name).length, 1);
  const build = steps.find(step => step.name === 'Build desktop app and native dependencies');
  assert.ok(build.run.includes('--sdk-mode native')); assert.ok(build.run.includes('--sdk-consumer-node'));
}

test('every prepackaged distribution has its independent exact-mode gate and removal is detected', async () => {
  const workflow = await readFile(new URL('../../../.github/workflows/ci-desktop-packaging.yml', import.meta.url), 'utf8');
  assertFinalDistributionGates(workflow);
  const data = require('yaml').parse(workflow), steps = data.jobs['package-smoke'].steps;
  const final = steps.findIndex(step => typeof step.run === 'string' && step.run.includes('--prepackaged'));
  steps.splice(final - 1, 1);
  assert.throws(() => assertFinalDistributionGates(require('yaml').stringify(data)));
});

test('the final gate CLI requires explicit target/mode and prints only a finite failure for invalid arguments', async () => {
  const { parsePackagedPluginSdkArguments } = await import('../../../apps/desktop/scripts/check-packaged-plugin-sdk.mjs');
  const { fileURLToPath } = await import('node:url');
  const { spawnSync } = await import('node:child_process');
  const asarPath = path.join(tmpdir(), 'SDK spaces Ω', 'resources', 'app.asar');
  assert.deepEqual(parsePackagedPluginSdkArguments(['--asar', asarPath, '--target', 'aarch64-unknown-linux-gnu', '--mode', 'sdk']), {
    resourcesRoot: path.dirname(asarPath), target: { platform: 'linux', arch: 'arm64', libc: 'glibc' }, expectedMode: 'sdk',
  });
  for (const args of [[], ['--asar', asarPath], ['--asar', asarPath, '--target', 'aarch64-unknown-linux-musl', '--mode', 'sdk'],
    ['--asar', asarPath, '--target', 'aarch64-unknown-linux-gnu', '--mode', 'sdk', '--mode', 'without-sdk']]) assert.throws(() => parsePackagedPluginSdkArguments(args));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('../../../apps/desktop/scripts/check-packaged-plugin-sdk.mjs', import.meta.url)), '--private-unknown', 'PRIVATE_SENTINEL'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null); assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.deepEqual(JSON.parse(result.stderr), { status: 'failed', code: 'DESKTOP_SDK_PACKAGING_FAILED' });
  assert.equal(result.stderr.includes('PRIVATE_SENTINEL'), false);
});


// Load the unchanged complete production module; only its existing imports are
// intercepted. No copied guard or rewritten function participates in these tests.
async function tupleModule(options = {}) {
  const vm = await import('node:vm');
  const source = await readFile(new URL('./desktop-packaging.mjs', import.meta.url), 'utf8');
  const calls = [], privateValue = 'PRIVATE_TUPLE_SENTINEL';
  const build = options.current === undefined ? { privateValue, side: 'current' } : options.current;
  const prepared = options.sameBuild ? build : options.prepared === undefined ? { privateValue, side: 'prepared' } : options.prepared;
  const sourceTarget = options.sourceTarget ?? target;
  const identity = { sdk: options.sourceSet ? { sourceSetSha256: 'prepared' } : null };
  Object.defineProperty(identity, 'mode', { enumerable: true, get() { calls.push('mode'); if (options.modeError) throw options.modeError; return options.sourceMode ?? 'sdk'; } });
  Object.defineProperty(identity, 'target', { enumerable: true, get() { calls.push('target'); if (options.targetError) throw options.targetError; return sourceTarget; } });
  Object.defineProperty(identity, 'applicationBuild', { get() {
    calls.push('prepared-build'); if (options.getterError) throw options.getterError; return prepared;
  } });
  const directory = { dev: 1, ino: 2, uid: 7, mode: 0o700, isDirectory: () => true, isSymbolicLink: () => false };
  const file = { dev: 1, ino: 3, size: 1, mtimeMs: 1, ctimeMs: 1, nlink: 1, isFile: () => true, isSymbolicLink: () => false };
  const later = options.laterError ?? new Error('PRIVATE_LATER');
  const operands = [];
  let canonicalCount = 0;
  const mocks = {
    'node:child_process': { execFileSync() { calls.push('epoch'); return '1700000000'; } },
    'node:fs': { constants: { O_RDONLY: 0, O_NOFOLLOW: 1 }, readFileSync() { calls.push('version'); return '{"version":"1.0.0"}'; } },
    'node:fs/promises': {
      async lstat(name) { calls.push('lstat'); if (name.endsWith('.generation.lock')) throw Object.assign(new Error(), { code: 'ENOENT' }); return name.endsWith('identity.mjs') ? file : directory; },
      async realpath(name) { calls.push('realpath'); return name; },
      async readFile() { calls.push('owner'); return '{"token":"private"}'; },
      async open() { calls.push('open'); return { async stat() { calls.push('stat'); return file; }, async read(bytes) { calls.push('read'); bytes[0] = 120; return { bytesRead: 1 }; }, async close() { calls.push('close'); } }; },
    },
    'node:url': { fileURLToPath: (await import('node:url')).fileURLToPath },
    'node:path': { default: path },
    '../../../scripts/release/build-info.mjs': {
      assertReleaseSource() { calls.push('assert-release'); if (options.defaultError) throw options.defaultError; return 'a'.repeat(40); },
      createBuildInfo() { calls.push('create-build'); return build; },
    },
    './product-packaging.mjs': { prepareProductSdkPackaging() { throw new Error('unexpected prepare'); } },
    './product-identity.mjs': { readProductSdkIdentityModule() { calls.push('identity'); return identity; } },
    './packaged-identity.mjs': { readPackagedProductSdkIdentity() { calls.push('packed'); if (options.success) return identity; throw later; } },
    './packaged-resource.mjs': { verifyPackagedProductSdk() { calls.push('verify-packed'); if (options.success) return Object.freeze({ status: 'verified' }); throw new Error('unexpected verify'); } },
    './product-bundle.mjs': { currentProductSdkSourceSetSha256() { calls.push('source-set'); throw later; } },
    './prepare.mjs': { verifyWorkspace() { calls.push('workspace'); } },
    './validate.mjs': { sdkConsumerMode() { throw new Error('unexpected target'); }, SDK_LOCK_SHA256: 'fixed', canonical(value) {
      calls.push(['canonical-target-left', 'canonical-target-right', 'canonical-build-left', 'canonical-build-right'][canonicalCount] ?? 'canonical-later'); operands.push(value);
      if (++canonicalCount === options.canonicalThrowAt) throw options.canonicalError;
      return JSON.stringify(value);
    } },
  };
  const context = vm.createContext({ Buffer, URL, process: { getuid: () => 7, env: {} } });
  const module = new vm.SourceTextModule(source, { context, initializeImportMeta(meta) { meta.url = new URL('./desktop-packaging.mjs', import.meta.url).href; } });
  await module.link(name => {
    assert.ok(Object.hasOwn(mocks, name), 'closed existing import');
    const entries = Object.entries(mocks[name]);
    return new vm.SyntheticModule(entries.map(([key]) => key), function () { for (const [key, value] of entries) this.setExport(key, value); }, { context });
  });
  await module.evaluate();
  const input = { desktopRoot: '/synthetic/desktop', resourcesRoot: '/synthetic/resources', target, expectedMode: options.mode ?? 'sdk' };
  if (!options.omitBuild) input.applicationBuild = build;
  let error;
  try { await module.namespace.verifyDesktopProductSdkPackaging(input); } catch (caught) { error = caught; }
  return { namespace: module.namespace, error, calls, later, identity, operands, prepared, build, sourceTarget };
}
const tupleKeys = ['schemaVersion', 'stage', 'firstFailedPredicate', 'modeAllowed', 'sourceModeMatches', 'targetMatches', 'applicationBuildMatches', 'preparedBuildInfoNull', 'currentBuildInfoNull'];

test('tuple diagnostic records only completed initial predicates with private frozen error identity', async () => {
  const predicates = ['modeAllowed', 'sourceModeMatches', 'targetMatches', 'applicationBuildMatches'];
  const cases = [{ mode: 'private' }, { sourceMode: 'without-sdk' }, { sourceTarget: { private: true } }, {}];
  for (let index = 0; index < cases.length; index++) {
    const result = await tupleModule(cases[index]);
    assert.equal(typeof result.namespace.desktopSdkPackagingFailureDiagnostic, 'function');
    const get = result.namespace.desktopSdkPackagingFailureDiagnostic, diagnostic = get(result.error);
    assert.equal(result.error.code, 'DESKTOP_SDK_PACKAGING_INVALID');
    assert.deepEqual(Object.keys(diagnostic), tupleKeys);
    assert.equal(diagnostic.schemaVersion, 1); assert.equal(diagnostic.stage, 'desktop-sdk-initial-tuple');
    assert.equal(diagnostic.firstFailedPredicate, predicates[index]);
    predicates.forEach((key, position) => assert.equal(diagnostic[key], position < index ? 'pass' : position === index ? 'fail' : 'not-reached'));
    assert.equal(diagnostic.preparedBuildInfoNull, index === 3 ? 'non-null' : 'not-reached');
    assert.equal(diagnostic.currentBuildInfoNull, index === 3 ? 'non-null' : 'not-reached');
    assert.equal(get(result.error), diagnostic); assert.equal(get(new Error()), undefined); assert.equal(get(null), undefined);
    assert.ok(Object.isFrozen(diagnostic)); assert.equal(JSON.stringify(diagnostic).includes('PRIVATE'), false);
    assert.equal(result.calls.filter(value => value === 'prepared-build').length, index === 3 ? 1 : 0);
    assert.equal(result.calls.includes('packed'), false); assert.equal(result.calls.includes('source-set'), false);
    assert.deepEqual(result.calls.filter(value => value.startsWith('canonical')), index < 2 ? [] : index === 2 ? ['canonical-target-left', 'canonical-target-right'] : ['canonical-target-left', 'canonical-target-right', 'canonical-build-left', 'canonical-build-right']);
    assert.equal(result.calls.includes('version'), false);
    assert.deepEqual(result.calls.filter(value => ['mode', 'target', 'prepared-build'].includes(value)), index === 0 ? [] : index === 1 ? ['mode'] : index === 2 ? ['mode', 'target'] : ['mode', 'target', 'prepared-build']);
    assert.deepEqual(result.operands, index < 2 ? [] : index === 2 ? [result.sourceTarget, target] : [result.sourceTarget, target, result.prepared, result.build]);
    assert.deepEqual(result.calls.slice(0, 12), ['lstat', 'realpath', 'workspace', 'lstat', 'owner', 'lstat', 'realpath', 'open', 'stat', 'read', 'stat', 'lstat']);
  }
});

test('tuple diagnostic keeps null operands distinct and leaves derivation and non-guard errors unregistered', async () => {
  for (const [prepared, current, left, right] of [[null, {}, 'null', 'non-null'], [{}, null, 'non-null', 'null']]) {
    const result = await tupleModule({ prepared, current });
    const d = result.namespace.desktopSdkPackagingFailureDiagnostic(result.error);
    assert.equal(d.preparedBuildInfoNull, left); assert.equal(d.currentBuildInfoNull, right);
  }
  const both = await tupleModule({ prepared: null, current: null });
  assert.equal(both.error, both.later); assert.equal(both.namespace.desktopSdkPackagingFailureDiagnostic(both.error), undefined);
  for (const kind of ['getterError', 'modeError', 'targetError', 'defaultError', ...[1, 2, 3, 4].map(String)]) {
    const sentinel = new Error('PRIVATE_EXCEPTION');
    const result = await tupleModule(kind === 'defaultError' ? { defaultError: sentinel, omitBuild: true } : ['getterError', 'modeError', 'targetError'].includes(kind) ? { [kind]: sentinel } : { canonicalThrowAt: Number(kind), canonicalError: sentinel });
    assert.equal(result.error, sentinel); assert.equal(result.namespace.desktopSdkPackagingFailureDiagnostic(result.error), undefined);
  }
  const derived = await tupleModule({ omitBuild: true });
  assert.deepEqual(derived.calls.slice(0, 4), ['version', 'assert-release', 'epoch', 'create-build']);
  for (const key of ['version', 'assert-release', 'epoch', 'create-build']) assert.equal(derived.calls.filter(call => call === key).length, 1);
  const later = await tupleModule({ sameBuild: true, sourceSet: true });
  assert.equal(later.error, later.later); assert.equal(later.calls.at(-1), 'source-set');
  assert.equal(later.namespace.desktopSdkPackagingFailureDiagnostic(later.error), undefined);
  const success = await tupleModule({ sameBuild: true, success: true });
  assert.equal(success.error, undefined);
  assert.equal(success.calls.filter(value => value === 'identity').length, 2);
  assert.equal(success.calls.filter(value => value === 'packed').length, 2);
  assert.equal(success.calls.filter(value => value === 'verify-packed').length, 1);
  assert.equal(success.namespace.desktopSdkPackagingFailureDiagnostic(success.error), undefined);
});

test('real afterPack tuple channel contains observer serialization and sink errors before all later actions', async () => {
  const vm = await import('node:vm');
  const hookSource = await readFile(new URL('../../../apps/desktop/scripts/electron-after-pack.cjs', import.meta.url), 'utf8');
  const source = hookSource.replace('await import("../../../lawoss/build/plugin-payload/desktop-packaging.mjs")', 'require("../../../lawoss/build/plugin-payload/desktop-packaging.mjs")');
  const result = await tupleModule({});
  const diagnostic = result.namespace.desktopSdkPackagingFailureDiagnostic(result.error);
  for (const kind of ['registered', 'unknown', 'accessor', 'serialization', 'sink', 'success']) {
    const primary = new Error('PRIVATE_PRIMARY'), writes = [], calls = [], module = { exports: {} };
    vm.runInNewContext(source, { module, process: { stderr: { write(line) { if (kind === 'sink') throw new Error('sink'); writes.push(line); } } }, require(name) {
      if (name === 'node:path') return path;
      if (name === 'node:fs') return { existsSync() { calls.push('exists'); return false; } };
      if (name === 'electron-builder') return { Arch: {} };
      if (name === './packaged-ocr.cjs') return { pruneOcrRuntime() { calls.push('prune'); } };
      if (name.endsWith('/desktop-packaging.mjs')) return {
        desktopProductSdkTarget() { calls.push('target'); return target; },
        async verifyDesktopProductSdkPackaging() { calls.push('verify'); if (kind !== 'success') throw primary; },
        desktopSdkPackagingFailureDiagnostic(error) { assert.equal(error, primary); if (kind === 'accessor') throw new Error('accessor'); return kind === 'unknown' ? undefined : kind === 'serialization' ? { get value() { throw new Error('serialization'); } } : diagnostic; },
      };
      throw new Error('unexpected import');
    } });
    if (kind === 'success') await assert.rejects(module.exports({ appOutDir: '/synthetic', electronPlatformName: 'linux', arch: 'x64', packager: { appInfo: {} } }), /Missing packaged Node runtime/);
    else await assert.rejects(module.exports({ appOutDir: '/synthetic', electronPlatformName: 'linux', arch: 'x64', packager: { appInfo: {} } }), error => error === primary);
    assert.deepEqual(calls, kind === 'success' ? ['target', 'verify', 'exists'] : ['target', 'verify']);
    assert.deepEqual(writes, kind === 'registered' ? [JSON.stringify(diagnostic) + '\n'] : []);
  }
});


test('tuple diagnostic also binds a real owned-generation fixture refusal', async t => {
  const f = await desktop(t);
  await prepareDesktopProductSdkPackaging({ ...f, supplier: { mode: 'without-sdk' } });
  let primary;
  await assert.rejects(verifyDesktopProductSdkPackaging({ ...f, expectedMode: 'sdk' }), error => { primary = error; return error.code === 'DESKTOP_SDK_PACKAGING_INVALID'; });
  const diagnostic = desktopSdkPackagingFailureDiagnostic(primary);
  assert.equal(diagnostic.firstFailedPredicate, 'sourceModeMatches');
  assert.equal(diagnostic.applicationBuildMatches, 'not-reached');
  assert.ok(Object.isFrozen(diagnostic));
});
