import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import * as payload from './validate.mjs';
import { initialize, runChild } from './prepare.mjs';
import { assertRuntimeConsumerProbe } from './runtime-consumer-validation.mjs';

// Explicit native integration gate: supply a genuine, previously built payload.
// A missing fixture is a failure, never a skipped proof of runtime compatibility.
const workspace = process.env.PAYLOAD_VALIDATION_WORKSPACE;
assert.ok(workspace && path.isAbsolute(workspace), 'PAYLOAD_VALIDATION_WORKSPACE must contain a genuine payload');
const root = path.join(workspace, 'payload');
assert.equal(process.version, 'v22.23.2', 'run with the Node shipped by LAWOSS');
// Golden target expectations come from the accepted archive/loader inspection,
// independently of the policy function being exercised. These are native tests
// only when this file actually runs on that target; unit model cases are not.
const nativeStates = new Map([
  ['darwin/arm64', 'loaded'], ['darwin/x64', 'loaded'], ['linux/x64/glibc', 'loaded'],
  ['win32/x64', 'loaded'], ['linux/arm64/glibc', 'fallback'], ['win32/arm64', 'fallback'],
]);
const targetKey = [process.platform, process.arch, ...(process.platform === 'linux'
  ? [process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl'] : [])].join('/');
const expectedNative = nativeStates.get(targetKey);
assert.ok(expectedNative, 'the native test must run on a supported product target');
const expectedMode = expectedNative === 'loaded' ? 'native-loaded' : 'javascript-fallback';

async function copy(t) {
  const base = new URL('./.work/test-fixtures/', import.meta.url);
  await mkdir(base, { recursive: true });
  const parent = await realpath(await mkdtemp(path.join(await realpath(base), 'runtime-consumer-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  const workspace = path.join(parent, 'owned');
  await initialize(workspace);
  const destination = path.join(workspace, 'payload');
  await cp(root, destination, { recursive: true, verbatimSymlinks: true });
  const receipt = path.join(destination, 'payload-manifest.json');
  const bytes = await readFile(receipt);
  return { workspace, destination, receipt, bytes, digest: payload.sha256(bytes) };
}

test('shipped Node verifies a Node24-produced payload against the build-bound manifest digest', async () => {
  const bytes = await readFile(path.join(root, 'payload-manifest.json'));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.node, 'v24.21.0');
  assert.equal(manifest.imports.native, expectedNative);
  assert.equal(manifest.files.filter(record => record.path.startsWith('third-party-notices/')).length, 5);
  const notices = JSON.parse(await readFile(path.join(root, 'third-party-notices/index.json')));
  assert.equal(notices.lockSha256, manifest.lockSha256);
  const result = await payload.verifyRuntimePayload(root, payload.sha256(bytes));
  assert.deepEqual(result, manifest);
  assert.deepEqual(await readFile(path.join(root, 'payload-manifest.json')), bytes);
});

test('changed package bytes and a self-consistent replacement receipt cannot replace the build-bound payload', async t => {
  const fixture = await copy(t);
  const target = path.join(fixture.destination, 'node_modules/zod/index.js');
  await writeFile(target, 'untrusted replacement');
  await assert.rejects(payload.verifyRuntimePayload(fixture.destination, fixture.digest), { code: 'PAYLOAD_INVALID' });
  // An attacker can rewrite adjacent metadata; the trusted build digest stays fixed.
  const replacement = JSON.parse(fixture.bytes);
  replacement.files = await payload.inventory(fixture.destination);
  replacement.files = replacement.files.filter(record => record.path !== 'payload-manifest.json');
  await writeFile(fixture.receipt, JSON.stringify(replacement));
  await assert.rejects(payload.verifyRuntimePayload(fixture.destination, fixture.digest), { code: 'PAYLOAD_INVALID' });
  assert.equal(await readFile(target, 'utf8'), 'untrusted replacement', 'admission never repairs or rewrites content');
});

test('consumer admission retains the exact producer, actual target and its required import contract', async t => {
  const fixture = await copy(t);
  for (const mutate of [
    manifest => { manifest.node = 'v22.23.2'; },
    manifest => { manifest.target.arch = process.arch === 'x64' ? 'arm64' : 'x64'; },
    manifest => { manifest.target.platform = process.platform === 'win32' ? 'linux' : 'win32'; },
    manifest => { manifest.imports.native = expectedNative === 'loaded' ? 'fallback' : 'loaded'; },
    manifest => { manifest.imports.guard = false; },
    manifest => { manifest.imports.roundtrip = false; },
  ]) {
    const manifest = JSON.parse(fixture.bytes); mutate(manifest);
    const bytes = Buffer.from(JSON.stringify(manifest));
    await writeFile(fixture.receipt, bytes);
    await assert.rejects(payload.verifyRuntimePayload(fixture.destination, payload.sha256(bytes)), { code: 'PAYLOAD_INVALID' });
  }
});

test('runtime admission requires an external digest and does not relax the original producer verifier', async () => {
  const bytes = await readFile(path.join(root, 'payload-manifest.json'));
  for (const digest of [undefined, '', 'not-a-digest', '0'.repeat(64), payload.sha256(bytes).toUpperCase()]) {
    await assert.rejects(payload.verifyRuntimePayload(root, digest), { code: 'PAYLOAD_INVALID' });
  }
  await assert.rejects(payload.verifyPayload(root), { code: 'PAYLOAD_INVALID' });
});

test('the verified payload performs all imports and its target codec path under shipped Node with network denied', async t => {
  const fixture = await copy(t);
  const before = await payload.verifyRuntimePayload(fixture.destination, fixture.digest);
  const probe = path.join(fixture.destination, '.payload-import-check.mjs');
  let result;
  try {
    await writeFile(probe, await readFile(new URL('./import-check.mjs', import.meta.url)), { flag: 'wx' });
    result = await runChild([probe, fixture.destination], fixture.workspace, { timeout: 60000, signal: t.signal });
  } finally { await rm(probe, { force: true }); }
  const required = { imports: payload.IMPORTS, native: expectedNative, guard: true, roundtrip: true };
  assert.deepEqual({ imports: result.imports, native: result.native, guard: result.guard, roundtrip: result.roundtrip }, required);
  if (expectedNative === 'loaded') assert.deepEqual(result, required, 'native-positive success JSON remains unchanged');
  assert.equal(assertRuntimeConsumerProbe(result, () => assert.fail('Supported target functionality is not a failure'), {
    target: before.target, lockSha256: before.lockSha256,
  }), expectedMode);
  assert.deepEqual(await payload.verifyRuntimePayload(fixture.destination, fixture.digest), before);
});

test('corrupted target payload stays refused and required native targets retain the fixed loader boundary', async t => {
  const fixture = await copy(t);
  const manifest = JSON.parse(fixture.bytes);
  const binaries = manifest.files.filter(record => record.path.startsWith('node_modules/@msgpackr-extract/') && record.path.endsWith('.node'));
  if (expectedNative === 'loaded') {
    assert.ok(binaries.length > 0, 'the genuine native-positive fixture contains its applicable binary');
    for (const record of binaries) await writeFile(path.join(fixture.destination, record.path), 'invalid native fixture');
  } else {
    const tool = 'node_modules/@opencode-ai/plugin/dist/tool.js';
    assert.ok(manifest.files.some(record => record.path === tool));
    await writeFile(path.join(fixture.destination, tool), "throw new Error('synthetic corrupt SDK fixture');\n");
  }
  await assert.rejects(payload.verifyRuntimePayload(fixture.destination, fixture.digest), { code: 'PAYLOAD_INVALID' });
  const probe = path.join(fixture.destination, '.payload-import-check.mjs');
  let result;
  try {
    await writeFile(probe, await readFile(new URL('./import-check.mjs', import.meta.url)), { flag: 'wx' });
    const operation = runChild([probe, fixture.destination], fixture.workspace, { timeout: 60000, signal: t.signal });
    if (expectedNative === 'loaded') result = await operation;
    else await assert.rejects(operation, { code: 'IMPORT_FAILED' });
  } finally { await rm(probe, { force: true }); }
  if (expectedNative !== 'loaded') return; // Executed refusal assertion above, never a skipped case.
  assert.equal(result.native, 'fallback');
  assert.equal(result.roundtrip, true);
  assert.deepEqual(result.nativeFailure, { stage: 'extract-load', code: 'ERR_DLOPEN_FAILED' });
  let observation;
  assert.throws(() => assertRuntimeConsumerProbe(result, value => { observation = value; }), { code: 'CONSUMER_INVALID' });
  assert.deepEqual(observation.nativeFailure, { stage: 'extract-load', code: 'ERR_DLOPEN_FAILED' });
  assert.doesNotMatch(JSON.stringify(result.nativeFailure), /invalid native fixture|node_modules|private|\.node/);
});
