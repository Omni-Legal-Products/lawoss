import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import * as payload from './validate.mjs';
import { initialize, runChild } from './prepare.mjs';

// Explicit native integration gate: supply a genuine, previously built payload.
// A missing fixture is a failure, never a skipped proof of runtime compatibility.
const workspace = process.env.PAYLOAD_VALIDATION_WORKSPACE;
assert.ok(workspace && path.isAbsolute(workspace), 'PAYLOAD_VALIDATION_WORKSPACE must contain a genuine payload');
const root = path.join(workspace, 'payload');
assert.equal(process.version, 'v22.23.2', 'run with the Node shipped by LAWOSS');

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
  assert.equal(manifest.imports.native, 'loaded');
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

test('consumer admission retains the exact producer, native target and positive native import contract', async t => {
  const fixture = await copy(t);
  for (const mutate of [
    manifest => { manifest.node = 'v22.23.2'; },
    manifest => { manifest.target.arch = process.arch === 'x64' ? 'arm64' : 'x64'; },
    manifest => { manifest.target.platform = process.platform === 'win32' ? 'linux' : 'win32'; },
    manifest => { manifest.imports.native = 'fallback'; },
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

test('the verified payload really imports and loads native acceleration under shipped Node with network denied', async t => {
  const fixture = await copy(t);
  const before = await payload.verifyRuntimePayload(fixture.destination, fixture.digest);
  const probe = path.join(fixture.destination, '.payload-import-check.mjs');
  let result;
  try {
    await writeFile(probe, await readFile(new URL('./import-check.mjs', import.meta.url)), { flag: 'wx' });
    result = await runChild([probe, fixture.destination], fixture.workspace, { timeout: 60000, signal: t.signal });
  } finally { await rm(probe, { force: true }); }
  assert.deepEqual(result, { imports: payload.IMPORTS, native: 'loaded', guard: true, roundtrip: true });
  assert.deepEqual(await payload.verifyRuntimePayload(fixture.destination, fixture.digest), before);
});
