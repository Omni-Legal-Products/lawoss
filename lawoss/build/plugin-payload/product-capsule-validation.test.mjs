import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, chmod, lstat, readlink, symlink, readdir, cp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { publishProductSdkResource } from './product-resource.mjs';
import { canonical, inventory, verifyBuildPayload } from './validate.mjs';
import { initialize } from './prepare.mjs';
import { extractAndVerifyProductSdkCapsule } from './product-capsule-validation.mjs';
import { gzipSync, gunzipSync, createGzip } from 'node:zlib';
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

async function capsule(t) {
  const f = await publication(t), result = await publishProductSdkResource({ ...f, transport: 'tar+gzip' });
  const workspace = path.join(f.buildParent, 'verification-workspace');
  await initialize(workspace);
  return { f, ...result, workspace };
}

test('an externally bound capsule extracts verified data into a fresh owned payload without executing it', async t => {
  const f = await capsule(t), original = await inventory(f.resourceRoot);
  const result = await extractAndVerifyProductSdkCapsule(f);
  assert.equal(result.status, 'verified');
  assert.equal(result.payloadRoot, path.join(f.workspace, 'payload'));
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.identity), true);
  assert.equal(Object.isFrozen(result.identity.target), true);
  assert.deepEqual(await inventory(result.payloadRoot), await inventory(f.f.payloadRoot));
  assert.deepEqual(await verifyBuildPayload(result.payloadRoot, f.identity.manifestSha256, f.identity.target), f.f.manifest);
  assert.deepEqual(await inventory(f.resourceRoot), original);
  assert.deepEqual((await readdir(f.workspace)).sort(), ['.owner.json', 'cache', 'empty-npmrc', 'home', 'payload']);
});

test('identity accessors are refused before filesystem reads without invoking private getters', async () => {
  let reads = 0;
  const identity = { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', manifestSha256: 'a'.repeat(64),
    target: { get platform() { reads++; return 'win32'; }, arch: 'arm64' }, lockSha256: 'a'.repeat(64),
    inputSha256: 'a'.repeat(64), sourceSetSha256: 'a'.repeat(64), consumerMode: 'javascript-fallback',
    verifierSha256: 'a'.repeat(64), capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: 'a'.repeat(64), bytes: 1 } };
  await assert.rejects(extractAndVerifyProductSdkCapsule({ resourceRoot: 'must-not-read', identity, workspace: 'must-not-read' }));
  assert.equal(reads, 0);
});

const toolsRequire = createRequire(new URL('./tools/package.json', import.meta.url));
const arboristRequire = createRequire(toolsRequire.resolve('@npmcli/arborist/package.json'));
const tar = arboristRequire('tar');
function tarBytes(entries, end = true) {
  const chunks = [];
  for (const item of entries) {
    const body = Buffer.from(item.body ?? '');
    const header = new tar.Header({ mode: 0o644, type: 'File', size: body.length, ...item });
    if (header.encode()) chunks.push(new tar.Pax({ path: item.path, linkpath: item.linkpath }).encode());
    chunks.push(header.block, body);
    const padding = (512 - body.length % 512) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  if (end) chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}
async function replaceArchive(f, raw, compressed = false) {
  const bytes = compressed ? raw : gzipSync(raw);
  await writeFile(path.join(f.resourceRoot, 'payload.tgz'), bytes);
  return { ...f, identity: { ...f.identity, capsule: { ...f.identity.capsule, sha256: hash(bytes), bytes: bytes.length } } };
}
const emptyWorkspace = ['.owner.json', 'cache', 'empty-npmrc', 'home'];
async function refusedBeforeWrites(f, expectedCode = 'PRODUCT_SDK_CAPSULE_INVALID') {
  await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: expectedCode });
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
}

test('archive entries cannot overwrite the private authenticated extraction input', async t => {
  const f = await capsule(t);
  await refusedBeforeWrites(await replaceArchive(f, tarBytes([{ path: '.capsule-input.tgz', body: 'replacement' }])));
});

for (const [label, entry] of [
  ['parent traversal', { path: '../escaped', body: 'outside' }],
  ['absolute path', { path: '/tmp/lawoss-capsule-forbidden', body: 'outside' }],
  ['Windows drive', { path: 'C:/escaped', body: 'outside' }],
  ['Windows separator', { path: 'node_modules\\escaped', body: 'outside' }],
  ['control byte', { path: 'node_modules/private\nname' }],
  ['non-NFC alias', { path: 'node_modules/cafe\u0301' }],
  ['reserved Windows name', { path: 'node_modules/CON.txt' }],
  ['hard link', { path: 'node_modules/hard', type: 'Link', linkpath: 'package.json' }],
  ['FIFO', { path: 'node_modules/pipe', type: 'FIFO' }],
  ['setuid file', { path: 'node_modules/file', mode: 0o4755 }],
  ['escaping bin link', { path: 'node_modules/.bin/tool', type: 'SymbolicLink', linkpath: '../../../escape' }],
  ['absolute bin link', { path: 'node_modules/.bin/tool', type: 'SymbolicLink', linkpath: '/outside' }],
  ['non-bin link', { path: 'node_modules/tool', type: 'SymbolicLink', linkpath: '../package.json' }],
]) test(`safe listing refuses ${label} before creating any extraction stage`, async t => {
  const f = await capsule(t);
  await refusedBeforeWrites(await replaceArchive(f, tarBytes([entry])));
});

test('duplicates and case aliases are refused before writes', async t => {
  const f = await capsule(t);
  for (const names of [['package.json', 'package.json'], ['Package.json', 'package.json']]) {
    await refusedBeforeWrites(await replaceArchive(f, tarBytes(names.map(name => ({ path: name })))));
  }
});

test('a link cannot be an extraction parent, resolve through a missing target, or form a cycle', async t => {
  const f = await capsule(t);
  const link = (name, target) => ({ path: `node_modules/.bin/${name}`, type: 'SymbolicLink', linkpath: target });
  for (const entries of [
    [link('tool', '../target'), { path: 'node_modules/.bin/tool/child' }, { path: 'node_modules/target', type: 'Directory' }],
    [link('tool', '../missing')],
    [link('first', 'second'), link('second', 'first')],
  ]) await refusedBeforeWrites(await replaceArchive(f, tarBytes(entries)));
});

test('file size, path depth, entry count, and PAX metadata are bounded before writes', async t => {
  const f = await capsule(t);
  for (const entries of [
    [{ path: 'large', size: 32 * 1024 * 1024 + 1 }],
    [{ path: Array(65).fill('part').join('/') }],
    Array.from({ length: 30001 }, (_, i) => ({ path: `file-${i}` })),
    [{ path: 'PaxHeader', type: 'ExtendedHeader', body: 'a'.repeat(65537) }],
  ]) await refusedBeforeWrites(await replaceArchive(f, tarBytes(entries)), 'PRODUCT_SDK_CAPSULE_LIMIT');
});

test('truncated compressed data and missing tar end markers are failures without output', async t => {
  const f = await capsule(t), original = await readFile(path.join(f.resourceRoot, 'payload.tgz'));
  await assert.rejects(extractAndVerifyProductSdkCapsule(await replaceArchive(f, original.subarray(0, -8), true)));
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
  await refusedBeforeWrites(await replaceArchive(f, tarBytes([{ path: 'file' }], false)));
});

test('external archive digest and size mismatches do not create output', async t => {
  const f = await capsule(t);
  for (const capsuleIdentity of [{ ...f.identity.capsule, sha256: 'a'.repeat(64) }, { ...f.identity.capsule, bytes: f.identity.capsule.bytes + 1 }, { ...f.identity.capsule, bytes: 270 * 1024 * 1024 + 1 }]) {
    await refusedBeforeWrites({ ...f, identity: { ...f.identity, capsule: capsuleIdentity } });
  }
});

test('resource verifier is data: any mutation or missing closure member is refused without importing it', async t => {
  const f = await capsule(t), file = path.join(f.resourceRoot, 'verifier', 'validate.mjs');
  await writeFile(file, 'throw new Error("RESOURCE_VERIFIER_EXECUTED");');
  await refusedBeforeWrites(f);
  await rm(file);
  await refusedBeforeWrites(f);
});

test('resource shape and physical archive identity refuse extra files, symlinks and hardlinks', async t => {
  const f = await capsule(t), archive = path.join(f.resourceRoot, 'payload.tgz');
  const extra = path.join(f.resourceRoot, 'adjacent-authority.json');
  await writeFile(extra, JSON.stringify(f.identity)); await refusedBeforeWrites(f); await rm(extra);
  const { link } = await import('node:fs/promises');
  const second = path.join(f.f.buildParent, 'archive-hardlink');
  await link(archive, second); await refusedBeforeWrites(f); await rm(second);
  if (process.platform !== 'win32') {
    const bytes = await readFile(archive); await rm(archive); await writeFile(second, bytes); await symlink(second, archive);
    await refusedBeforeWrites(f);
  }
});

test('existing output and another writer admission remain untouched and retain their original failure codes', async t => {
  const f = await capsule(t), output = path.join(f.workspace, 'payload'), admission = path.join(f.workspace, '.admit-payload');
  await mkdir(output); await writeFile(path.join(output, 'sentinel'), 'existing bytes');
  await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: 'OUTPUT_EXISTS' });
  assert.equal(await readFile(path.join(output, 'sentinel'), 'utf8'), 'existing bytes');
  await rm(output, { recursive: true }); await mkdir(admission); await writeFile(path.join(admission, 'other-writer'), 'do not adopt');
  await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: 'OUTPUT_BUSY' });
  assert.equal(await readFile(path.join(admission, 'other-writer'), 'utf8'), 'do not adopt');
  assert.deepEqual((await readdir(f.workspace)).sort(), ['.admit-payload', ...emptyWorkspace].sort());
});

test('a safe archive with the wrong payload manifest cleans only its owned stage and preserves source', async t => {
  const f = await capsule(t), original = await inventory(f.resourceRoot);
  await assert.rejects(extractAndVerifyProductSdkCapsule({ ...f, identity: { ...f.identity, manifestSha256: 'a'.repeat(64) } }), { code: 'PAYLOAD_INVALID' });
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
  assert.deepEqual(await inventory(f.resourceRoot), original);
});

test('safe existing .bin links, executable modes and inert native-looking bytes survive verified extraction', { skip: process.platform === 'win32' ? 'POSIX symlink and mode contract' : false }, async t => {
  const f = await publication(t);
  await chmod(path.join(f.payloadRoot, 'node_modules/inert.js'), 0o755);
  await mkdir(path.join(f.payloadRoot, 'node_modules/.bin'));
  await symlink('../inert.js', path.join(f.payloadRoot, 'node_modules/.bin/inert'));
  const native = path.join(f.payloadRoot, 'node_modules/inert.node');
  await writeFile(native, Buffer.from([0xcf, 0xfa, 0xed, 0xfe, 0, 1, 2, 3]), { mode: 0o755 });
  f.manifest.files = (await inventory(f.payloadRoot)).filter(record => record.path !== 'payload-manifest.json');
  await writeFile(path.join(f.payloadRoot, 'payload-manifest.json'), JSON.stringify(f.manifest));
  f.expectedManifestSha256 = hash(await readFile(path.join(f.payloadRoot, 'payload-manifest.json')));
  f.compatibilityBinding.payloadManifestSha256 = f.expectedManifestSha256;
  const resource = await publishProductSdkResource({ ...f, transport: 'tar+gzip' });
  const workspace = path.join(f.buildParent, 'link-verification'); await initialize(workspace);
  const result = await extractAndVerifyProductSdkCapsule({ ...resource, workspace });
  assert.deepEqual(await inventory(result.payloadRoot), await inventory(f.payloadRoot));
  assert.equal(await readlink(path.join(result.payloadRoot, 'node_modules/.bin/inert')), '../inert.js');
  assert.equal((await lstat(path.join(result.payloadRoot, 'node_modules/inert.js'))).mode & 0o777, 0o755);
  assert.deepEqual(await readFile(path.join(result.payloadRoot, 'node_modules/inert.node')), await readFile(native));
});

test('only the externally authenticated target, lock and exact identity shape are admitted', async t => {
  const f = await capsule(t);
  for (const identity of [
    { ...f.identity, lockSha256: 'a'.repeat(64) },
    { ...f.identity, adjacentAuthority: true },
    { ...f.identity, target: { ...f.identity.target, unexpected: true } },
    { ...f.identity, capsule: { ...f.identity.capsule, bytes: Number.MAX_SAFE_INTEGER } },
    { ...f.identity, consumerMode: 'native-loaded' },
  ]) await refusedBeforeWrites({ ...f, identity });
  await assert.rejects(extractAndVerifyProductSdkCapsule({ ...f, identity: { ...f.identity, target: { platform: 'darwin', arch: 'arm64' }, consumerMode: 'native-loaded' } }), { code: 'PAYLOAD_INVALID' });
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
});

test('an unowned, aliased or overlapping workspace is never adopted', async t => {
  const f = await capsule(t), ownerFile = path.join(f.workspace, '.owner.json'), original = await readFile(ownerFile);
  const owner = JSON.parse(original); await writeFile(ownerFile, JSON.stringify({ ...owner, ino: owner.ino + 1 }));
  await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: 'WORKSPACE_INVALID' });
  await writeFile(ownerFile, original);
  await assert.rejects(extractAndVerifyProductSdkCapsule({ ...f, workspace: f.resourceRoot }));
  if (process.platform !== 'win32') {
    const alias = path.join(f.f.buildParent, 'workspace-alias'); await symlink(f.workspace, alias);
    await assert.rejects(extractAndVerifyProductSdkCapsule({ ...f, workspace: alias }), { code: 'PRODUCT_SDK_CAPSULE_INVALID' });
  }
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
});

test('a real extraction failure with physically blocked cleanup preserves exact primary identity and retained stage', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'requires ordinary POSIX filesystem permissions' : false,
}, async t => {
  const f = await capsule(t), originalSource = await inventory(f.resourceRoot);
  const descriptor = Object.getOwnPropertyDescriptor(tar, 'x'), original = tar.x;
  const primary = new Error('controlled failure after actual synchronous extraction');
  let extractions = 0, caught;
  Object.defineProperty(tar, 'x', { configurable: true, value: options => {
    original(options); extractions++;
    // tar normally adds owner write permission to archive directories. This
    // controlled post-extraction filesystem fault exercises actual EACCES cleanup.
    chmodSync(path.join(options.cwd, 'node_modules'), 0o555);
    throw primary;
  } });
  try { await extractAndVerifyProductSdkCapsule(f); }
  catch (error) { caught = error; }
  finally { Object.defineProperty(tar, 'x', descriptor); }
  const names = await readdir(f.workspace), stages = names.filter(name => name.startsWith('.stage-'));
  try {
    assert.equal(extractions, 1);
    assert.equal(caught instanceof AggregateError, true);
    assert.equal(caught.errors.length, 2);
    assert.equal(caught.cause, primary);
    assert.equal(caught.errors[0], primary);
    assert.equal(caught.errors[1].code, 'PRODUCT_SDK_CAPSULE_CLEANUP_UNCERTAIN');
    assert.equal(stages.length, 1);
    assert.equal(names.includes('payload'), false);
    assert.equal(names.includes('.admit-payload'), false);
    assert.equal((await lstat(path.join(f.workspace, stages[0], 'node_modules'))).mode & 0o777, 0o555);
    assert.deepEqual(await inventory(f.resourceRoot), originalSource);
  } finally { for (const stage of stages) await chmod(path.join(f.workspace, stage, 'node_modules'), 0o755); }
});

test('aggregate file bytes and all decompressed bytes including trailing padding are bounded', async t => {
  const f = await capsule(t), file = path.join(f.resourceRoot, 'payload.tgz'), block = Buffer.alloc(65536);
  async function admission(chunks) {
    await pipeline(Readable.from(chunks), createGzip({ level: 1 }), createWriteStream(file));
    const bytes = await readFile(file);
    await refusedBeforeWrites({ ...f, identity: { ...f.identity, capsule: { ...f.identity.capsule, bytes: bytes.length, sha256: hash(bytes) } } }, 'PRODUCT_SDK_CAPSULE_LIMIT');
  }
  function* files() {
    for (let index = 0; index < 9; index++) {
      const header = new tar.Header({ path: `file-${index}`, type: 'File', mode: 0o644, size: 32 * 1024 * 1024 });
      header.encode(); yield header.block;
      for (let count = 0; count < 512; count++) yield block;
    }
    yield Buffer.alloc(1024);
  }
  await admission(files());
  function* padding() {
    yield Buffer.alloc(1024); // Genuine tar EOF; parser ignores the subsequent padding.
    for (let count = 0; count < 384 * 16; count++) yield block;
  }
  await admission(padding());
});

test('an original extraction exception remains the exact primary when owned cleanup succeeds', async t => {
  const f = await capsule(t), descriptor = Object.getOwnPropertyDescriptor(tar, 'x'), original = tar.x;
  const primary = new Error('controlled extraction boundary'); let extractions = 0, caught;
  Object.defineProperty(tar, 'x', { configurable: true, value: options => { original(options); extractions++; throw primary; } });
  try { await extractAndVerifyProductSdkCapsule(f); }
  catch (error) { caught = error; }
  finally { Object.defineProperty(tar, 'x', descriptor); }
  assert.equal(extractions, 1); assert.equal(caught, primary);
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
});

test('workspace substitution is refused before inspecting or cleaning substitute children', async t => {
  const { rename } = await import('node:fs/promises');
  const f = await capsule(t), descriptor = Object.getOwnPropertyDescriptor(tar, 'x'), original = tar.x;
  const previous = `${f.workspace}-retained`, primary = new Error('controlled ownership loss');
  let extractions = 0, caught;
  // The real extraction is synchronous; replace the workspace synchronously at
  // its return boundary so the existing transaction encounters genuine loss.
  const { renameSync, mkdirSync, writeFileSync } = await import('node:fs');
  Object.defineProperty(tar, 'x', { configurable: true, value: options => {
    original(options); extractions++;
    renameSync(f.workspace, previous); mkdirSync(f.workspace, { mode: 0o700 });
    writeFileSync(path.join(f.workspace, '.owner.json'), 'substitute sentinel');
    writeFileSync(path.join(f.workspace, 'do-not-inspect-or-delete'), 'retained');
    throw primary;
  } });
  try { await extractAndVerifyProductSdkCapsule(f); }
  catch (error) { caught = error; }
  finally { Object.defineProperty(tar, 'x', descriptor); }
  assert.equal(extractions, 1);
  assert.equal(caught instanceof AggregateError, true);
  assert.equal(caught.cause, primary); assert.equal(caught.errors[0], primary);
  assert.equal(caught.errors[1].code, 'PRODUCT_SDK_CAPSULE_OWNERSHIP_UNCERTAIN');
  assert.equal(await readFile(path.join(f.workspace, '.owner.json'), 'utf8'), 'substitute sentinel');
  assert.equal(await readFile(path.join(f.workspace, 'do-not-inspect-or-delete'), 'utf8'), 'retained');
  const names = await readdir(previous);
  assert.equal(names.filter(name => name.startsWith('.stage-')).length, 1);
  assert.equal(names.includes('.admit-payload'), true);
  await rm(f.workspace, { recursive: true }); await rename(previous, f.workspace);
});

test('nested compressed input is refused before the tar parser can bypass the outer raw-byte cap', async t => {
  const f = await capsule(t);
  await refusedBeforeWrites(await replaceArchive(f, gzipSync(tarBytes([{ path: 'file' }]))));
});

test('authenticated source archive content and physical path must remain unchanged through extraction', async t => {
  const { writeFileSync, renameSync } = await import('node:fs');
  for (const mutation of ['bytes', 'inode']) {
    const f = await capsule(t), archive = path.join(f.resourceRoot, 'payload.tgz');
    const originalBytes = await readFile(archive), descriptor = Object.getOwnPropertyDescriptor(tar, 'x'), original = tar.x;
    let extractions = 0;
    Object.defineProperty(tar, 'x', { configurable: true, value: options => {
      original(options); extractions++;
      if (mutation === 'bytes') writeFileSync(archive, Buffer.alloc(originalBytes.length, 0));
      else { writeFileSync(`${archive}.replacement`, originalBytes); renameSync(`${archive}.replacement`, archive); }
    } });
    try { await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: 'PRODUCT_SDK_CAPSULE_INVALID' }); }
    finally { Object.defineProperty(tar, 'x', descriptor); }
    assert.equal(extractions, 1);
    assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
  }
});

test('the bound static verifier inventory is checked again before payload publication', async t => {
  const { writeFileSync } = await import('node:fs');
  const f = await capsule(t), descriptor = Object.getOwnPropertyDescriptor(tar, 'x'), original = tar.x;
  let extractions = 0;
  Object.defineProperty(tar, 'x', { configurable: true, value: options => {
    original(options); extractions++;
    writeFileSync(path.join(f.resourceRoot, 'verifier/validate.mjs'), 'throw new Error("NEVER_EXECUTE_RESOURCE");');
  } });
  try { await assert.rejects(extractAndVerifyProductSdkCapsule(f), { code: 'PRODUCT_SDK_CAPSULE_INVALID' }); }
  finally { Object.defineProperty(tar, 'x', descriptor); }
  assert.equal(extractions, 1);
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
});

test('the pinned tar version is checked before its implementation can execute', async t => {
  const f = await capsule(t), privateModuleRoot = path.join(f.f.buildParent, 'private-validator-copy');
  await mkdir(privateModuleRoot);
  for (const name of ['product-capsule-validation.mjs', 'prepare.mjs', 'validate.mjs', 'notices.mjs']) {
    await writeFile(path.join(privateModuleRoot, name), await sourceBytes(`./${name}`));
  }
  await cp(new URL('./sdk', import.meta.url), path.join(privateModuleRoot, 'sdk'), { recursive: true });
  const tools = path.join(privateModuleRoot, 'tools'), nodeModules = path.join(tools, 'node_modules');
  await mkdir(path.join(nodeModules, '@npmcli/arborist'), { recursive: true });
  await mkdir(path.join(nodeModules, 'tar'), { recursive: true });
  await writeFile(path.join(tools, 'package.json'), '{}');
  await writeFile(path.join(nodeModules, '@npmcli/arborist/package.json'), '{"name":"@npmcli/arborist","version":"9.4.0"}');
  await writeFile(path.join(nodeModules, 'tar/package.json'), '{"name":"tar","version":"7.5.21","main":"index.cjs"}');
  const sentinel = path.join(privateModuleRoot, 'wrong-tar-executed');
  await writeFile(path.join(nodeModules, 'tar/index.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'executed'); throw new Error('WRONG_TAR_EXECUTED');`);
  const copied = await import(pathToFileURL(path.join(privateModuleRoot, 'product-capsule-validation.mjs')).href);
  await assert.rejects(copied.extractAndVerifyProductSdkCapsule(f), { code: 'SDK_CAPSULE_TOOLS_INVALID' });
  await assert.rejects(lstat(sentinel), { code: 'ENOENT' });
  assert.deepEqual((await readdir(f.workspace)).sort(), emptyWorkspace);
});

test('EOF admits only bounded zero padding before the same bytes reach synchronous extraction', async t => {
  const f = await capsule(t), raw = gunzipSync(await readFile(path.join(f.resourceRoot, 'payload.tgz')));
  await refusedBeforeWrites(await replaceArchive(f, Buffer.concat([raw, Buffer.alloc(128 * 1024)])), 'PRODUCT_SDK_CAPSULE_LIMIT');
  await refusedBeforeWrites(await replaceArchive(f, Buffer.concat([raw, tarBytes([{ path: 'hidden-after-EOF', body: 'hidden' }])])));
  const padded = await replaceArchive(f, Buffer.concat([raw, Buffer.alloc(10240)]));
  const result = await extractAndVerifyProductSdkCapsule(padded);
  assert.deepEqual(await inventory(result.payloadRoot), await inventory(f.f.payloadRoot));
});

test('even an explicitly bound resource verifier is never executed as code', async t => {
  const f = await capsule(t), verifier = path.join(f.resourceRoot, 'verifier');
  await writeFile(path.join(verifier, 'validate.mjs'), 'throw new Error("RESOURCE_SUPPLIED_CODE_EXECUTED");');
  const identity = { ...f.identity, verifierSha256: hash(canonical(await inventory(verifier))) };
  const result = await extractAndVerifyProductSdkCapsule({ ...f, identity });
  assert.equal(result.status, 'verified');
  assert.equal(Object.isFrozen(result.identity.capsule), true);
  assert.deepEqual(await inventory(result.payloadRoot), await inventory(f.f.payloadRoot));
});

for (const entry of [
  { path: '.CAPSULE-INPUT.TGZ', body: 'replacement' },
  { path: '.CAPSULE-INPUT.TGZ', type: 'Directory' },
  ...['<', '>', '"', '|', '?', '*'].map(character => ({ path: `node_modules/file${character}name` })),
]) test(`portable admission refuses reserved aliases and Windows-illegal name ${JSON.stringify(entry.path)} before writes`, async t => {
  const f = await capsule(t);
  await refusedBeforeWrites(await replaceArchive(f, tarBytes([entry])));
});
