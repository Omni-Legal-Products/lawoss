import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, chmod, lstat, readlink, symlink, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chmodSync, readFileSync, writeFileSync, readdirSync, renameSync, mkdirSync, unlinkSync } from 'node:fs';
import { publishProductSdkResource } from './product-resource.mjs';
import { inventory } from './validate.mjs';

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

test('build publication copies exact accepted data and a self-contained static verifier with private code identity', async t => {
  const f = await publication(t);
  const result = await publishProductSdkResource(f);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.identity), true);
  assert.equal(Object.isFrozen(result.identity.target), true);
  assert.equal(result.resourceRoot, path.join(f.buildParent, 'plugin-sdk'));
  assert.equal(result.identity.manifestSha256, f.expectedManifestSha256);
  assert.equal(result.identity.lockSha256, f.acceptedLockSha256);
  assert.deepEqual(await inventory(path.join(result.resourceRoot, 'payload')), await inventory(f.payloadRoot));
  const closure = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json',
    'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md',
    'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt',
    'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
  assert.deepEqual((await inventory(path.join(result.resourceRoot, 'verifier'))).map(x => x.path).sort(), closure.sort());
  for (const name of closure) assert.deepEqual(await readFile(path.join(result.resourceRoot, 'verifier', name)), await sourceBytes(name));
  const { verifyBuildPayload } = await import(pathToFileURL(path.join(result.resourceRoot, 'verifier/validate.mjs')));
  assert.deepEqual(await verifyBuildPayload(path.join(result.resourceRoot, 'payload'), f.expectedManifestSha256, f.expectedTarget), f.manifest);
  assert.equal(result.privateIdentityModule.includes(f.expectedManifestSha256), true);
  assert.equal(result.privateIdentityModule.includes(result.identity.verifierSha256), true);
  const generated = await import(`data:text/javascript,${encodeURIComponent(result.privateIdentityModule)}`);
  assert.deepEqual(generated.default, result.identity);
  assert.equal(Object.isFrozen(generated.default), true);
  assert.equal(Object.isFrozen(generated.default.target), true);
  assert.deepEqual((await readdir(result.resourceRoot)).sort(), ['payload', 'verifier']);
  assert.deepEqual(await readdir(f.buildParent), ['plugin-sdk']);
});

test('wrong external bundle identity or target and missing notice refuse before staging', async t => {
  for (const [name, mutate] of Object.entries({
    digest: f => { f.expectedManifestSha256 = '0'.repeat(64); },
    target: f => { f.expectedTarget.arch = 'x64'; },
    notice: f => rm(path.join(f.payloadRoot, 'third-party-notices/index.json')),
  })) await t.test(name, async t => {
    const f = await publication(t); await mutate(f);
    const before = await inventory(f.payloadRoot);
    await assert.rejects(publishProductSdkResource(f), { code: 'PRODUCT_SDK_BUNDLE_INVALID' });
    assert.deepEqual(await inventory(f.payloadRoot), before);
    assert.deepEqual(await readdir(f.buildParent), []);
  });
});

test('an existing output is never overwritten or adopted, including an empty directory', async t => {
  for (const kind of ['file', 'directory']) await t.test(kind, async t => {
    const f = await publication(t), destination = path.join(f.buildParent, f.outputName);
    if (kind === 'file') await writeFile(destination, 'preserve existing bytes'); else await mkdir(destination);
    const before = await lstat(destination);
    await assert.rejects(publishProductSdkResource(f), code);
    const after = await lstat(destination);
    assert.equal(after.ino, before.ino);
    if (kind === 'file') assert.equal(await readFile(destination, 'utf8'), 'preserve existing bytes');
    else assert.deepEqual(await readdir(destination), []);
    assert.deepEqual(await readdir(f.buildParent), ['plugin-sdk']);
  });
});

test('existing publication lease refuses competition without touching the owner marker', async t => {
  const f = await publication(t), lease = path.join(f.buildParent, '.lawoss-plugin-sdk-publication.lock');
  await writeFile(lease, 'another cooperating publisher', { flag: 'wx' });
  await assert.rejects(publishProductSdkResource(f), { code: 'EEXIST' });
  assert.equal(await readFile(lease, 'utf8'), 'another cooperating publisher');
  assert.deepEqual(await readdir(f.buildParent), ['.lawoss-plugin-sdk-publication.lock']);
});

test('unsafe names, noncanonical parents and source overlap refuse without generated entries', async t => {
  const f = await publication(t);
  for (const outputName of ['', '..', '../escape', 'nested/output', '/absolute', 'x'.repeat(65)]) {
    await assert.rejects(publishProductSdkResource({ ...f, outputName }), code);
  }
  await assert.rejects(publishProductSdkResource({ ...f, buildParent: `${f.buildParent}${path.sep}child${path.sep}..` }), code);
  await assert.rejects(publishProductSdkResource({ ...f, buildParent: f.payloadRoot }), code);
  await assert.rejects(publishProductSdkResource({ ...f, buildParent: path.dirname(f.payloadRoot) }), code);
  assert.deepEqual(await readdir(f.buildParent), []);
});

test('POSIX writable or aliased parents are not accepted as controlled build roots', {
  skip: process.platform === 'win32' ? 'POSIX ownership/modes and symlink privilege do not establish Windows ACL ownership' : false,
}, async t => {
  const f = await publication(t);
  await chmod(f.buildParent, 0o777);
  try { await assert.rejects(publishProductSdkResource(f), code); } finally { await chmod(f.buildParent, 0o700); }
  const alias = `${f.buildParent}-alias`;
  await symlink(f.buildParent, alias);
  t.after(() => rm(alias, { force: true }));
  await assert.rejects(publishProductSdkResource({ ...f, buildParent: alias }), code);
  const output = path.join(f.buildParent, f.outputName);
  await symlink(f.payloadRoot, output);
  await assert.rejects(publishProductSdkResource(f), code);
  assert.equal(await readlink(output), f.payloadRoot);
  assert.deepEqual(await readdir(f.buildParent), ['plugin-sdk']);
});

test('safe SDK bin links and exact POSIX file/directory modes survive publication', {
  skip: process.platform === 'win32' ? 'Creating symlinks and exact POSIX modes requires privileges absent from ordinary Windows fixtures' : false,
}, async t => {
  const f = await publication(t);
  const script = path.join(f.payloadRoot, 'node_modules/inert.js');
  await chmod(script, 0o751);
  await mkdir(path.join(f.payloadRoot, 'node_modules/.bin'), { mode: 0o750 });
  await symlink('../inert.js', path.join(f.payloadRoot, 'node_modules/.bin/inert'));
  f.manifest.files = await inventory(f.payloadRoot);
  f.manifest.files = f.manifest.files.filter(x => x.path !== 'payload-manifest.json');
  await writeFile(path.join(f.payloadRoot, 'payload-manifest.json'), JSON.stringify(f.manifest));
  f.expectedManifestSha256 = hash(await readFile(path.join(f.payloadRoot, 'payload-manifest.json')));
  f.compatibilityBinding.payloadManifestSha256 = f.expectedManifestSha256;
  const result = await publishProductSdkResource(f), copied = path.join(result.resourceRoot, 'payload/node_modules');
  assert.equal(await readlink(path.join(copied, '.bin/inert')), '../inert.js');
  assert.equal((await lstat(path.join(copied, 'inert.js'))).mode & 0o7777, 0o751);
  assert.equal((await lstat(path.join(copied, '.bin'))).mode & 0o7777, 0o750);
  assert.equal((await lstat(path.join(result.resourceRoot, 'payload'))).mode & 0o7777,
    (await lstat(f.payloadRoot)).mode & 0o7777);
});

test('copied verifier rejects damaged payload while all accepted source data stays unchanged', async t => {
  const f = await publication(t), before = await inventory(f.payloadRoot);
  const result = await publishProductSdkResource(f);
  const { verifyBuildPayload } = await import(pathToFileURL(path.join(result.resourceRoot, 'verifier/validate.mjs')));
  await writeFile(path.join(result.resourceRoot, 'payload/node_modules/inert.js'), 'corrupted owned copy');
  await assert.rejects(verifyBuildPayload(path.join(result.resourceRoot, 'payload'), f.expectedManifestSha256, f.expectedTarget), { code: 'PAYLOAD_INVALID' });
  assert.deepEqual(await inventory(f.payloadRoot), before);
});

test('a missing static verifier dependency cannot be silently supplied by SDK node_modules', async t => {
  const f = await publication(t), result = await publishProductSdkResource(f);
  await rm(path.join(result.resourceRoot, 'verifier/notices.mjs'));
  await assert.rejects(import(pathToFileURL(path.join(result.resourceRoot, 'verifier/validate.mjs'))), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('a caller primary exception retains its exact identity without staging', async t => {
  const f = await publication(t), primary = new Error('controlled caller failure');
  await assert.rejects(publishProductSdkResource({ ...f, get buildParent() { throw primary; } }), error => error === primary);
  assert.deepEqual(await readdir(f.buildParent), []);
});

// Faults occur at the caller-data boundary on its next admission, after copying.
// They change real owned files/permissions; no filesystem operation is mocked.
function afterCopy(f, change) {
  let snapshots = 0;
  f.compatibilityBinding = new Proxy(f.compatibilityBinding, {
    ownKeys(value) { if (++snapshots === 2) change(); return Reflect.ownKeys(value); },
  });
}

test('source drift after payload copy refuses publication and removes only the owned stage', async t => {
  const f = await publication(t), source = path.join(f.payloadRoot, 'node_modules/inert.js');
  const original = await readFile(source); let changed = false, copied;
  afterCopy(f, () => {
    const stage = readdirSync(f.buildParent).find(name => name.startsWith('.plugin-sdk-stage-'));
    copied = readFileSync(path.join(f.buildParent, stage, 'payload/node_modules/inert.js'));
    writeFileSync(source, 'changed source after its accepted payload copy'); changed = true;
  });
  await assert.rejects(publishProductSdkResource(f), { code: 'PRODUCT_SDK_BUNDLE_INVALID' });
  assert.equal(changed, true, 'the real post-copy fixture mutation must execute');
  assert.deepEqual(copied, original);
  assert.equal(await readFile(source, 'utf8'), 'changed source after its accepted payload copy');
  assert.deepEqual(await readdir(f.buildParent), []);
});

test('real rename and cleanup permission failures preserve primary cause and retained stage', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'Real POSIX EACCES requires an ordinary non-root user' : false,
}, async t => {
  const f = await publication(t); let changed = false, caught;
  afterCopy(f, () => { chmodSync(f.buildParent, 0o500); changed = true; });
  try {
    try { await publishProductSdkResource(f); } catch (error) { caught = error; }
    assert.equal(changed, true, 'the real parent permission change must execute');
    assert.equal(caught instanceof AggregateError, true);
    assert.equal(caught.errors.length, 2);
    assert.equal(caught.cause, caught.errors[0]);
    assert.equal(caught.errors[0].code, 'EACCES');
    assert.equal(caught.errors[1].code, 'EACCES');
  } finally { await chmod(f.buildParent, 0o700); }
  const retained = await readdir(f.buildParent);
  assert.equal(retained.some(name => name.startsWith('.plugin-sdk-stage-')), true);
  assert.equal(retained.includes('.lawoss-plugin-sdk-publication.lock'), true);
  assert.equal(retained.includes('plugin-sdk'), false);
});

test('a corrupted staged payload is rejected before publication with the accepted source intact', async t => {
  const f = await publication(t), before = await inventory(f.payloadRoot); let changed = false;
  afterCopy(f, () => {
    const stage = readdirSync(f.buildParent).find(name => name.startsWith('.plugin-sdk-stage-'));
    writeFileSync(path.join(f.buildParent, stage, 'payload/node_modules/inert.js'), 'corrupt staged bytes'); changed = true;
  });
  await assert.rejects(publishProductSdkResource(f), { code: 'PRODUCT_SDK_BUNDLE_INVALID' });
  assert.equal(changed, true);
  assert.deepEqual(await inventory(f.payloadRoot), before);
  assert.deepEqual(await readdir(f.buildParent), []);
});

test('replacement of the owned stage retains the replacement and primary plus cleanup failures', async t => {
  const f = await publication(t); let replacement, moved;
  afterCopy(f, () => {
    const stage = readdirSync(f.buildParent).find(name => name.startsWith('.plugin-sdk-stage-'));
    replacement = path.join(f.buildParent, stage); moved = `${replacement}-retained`;
    renameSync(replacement, moved); mkdirSync(replacement, { mode: 0o700 });
    writeFileSync(path.join(replacement, 'unowned-sentinel'), 'preserve replacement');
  });
  await assert.rejects(publishProductSdkResource(f), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    assert.equal(error.cause, error.errors[0]);
    assert.equal(error.errors[0].code, 'PRODUCT_SDK_BUNDLE_INVALID');
    assert.equal(error.errors[1].code, 'PRODUCT_SDK_RESOURCE_INVALID');
    return true;
  });
  assert.equal(await readFile(path.join(replacement, 'unowned-sentinel'), 'utf8'), 'preserve replacement');
  assert.equal((await lstat(path.join(moved, 'payload'))).isDirectory(), true);
  assert.equal((await readdir(f.buildParent)).includes('plugin-sdk'), false);
});

test('cleanup refusal after publication preserves the output and a replaced lease marker', async t => {
  const f = await publication(t), lease = path.join(f.buildParent, '.lawoss-plugin-sdk-publication.lock');
  afterCopy(f, () => { unlinkSync(lease); writeFileSync(lease, 'replacement marker', { flag: 'wx' }); });
  await assert.rejects(publishProductSdkResource(f), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 1);
    assert.equal(error.errors[0].code, 'PRODUCT_SDK_RESOURCE_INVALID');
    assert.equal(error.cause, undefined);
    return true;
  });
  assert.equal(await readFile(lease, 'utf8'), 'replacement marker');
  assert.equal((await lstat(path.join(f.buildParent, 'plugin-sdk/payload'))).isDirectory(), true);
  assert.deepEqual(await inventory(path.join(f.buildParent, 'plugin-sdk/payload')), await inventory(f.payloadRoot));
});
