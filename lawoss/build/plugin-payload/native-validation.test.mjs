import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { initialize, prepare, childEnvironment } from './prepare.mjs';
import { IMPORTS } from './validate.mjs';

test('probe refuses missing preload before attempting any SDK resolution', () => {
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./import-check.mjs', import.meta.url)), path.resolve('missing-sdk')], { encoding: 'utf8', env: childEnvironment(path.resolve('owned')), timeout: 5000 });
  assert.equal(child.status, 1); assert.equal(JSON.parse(child.stderr).code, 'GUARD_NOT_ADMITTED');
  const admitted = spawnSync(process.execPath, ['--import', new URL('./network-guard.mjs', import.meta.url).href, fileURLToPath(new URL('./import-check.mjs', import.meta.url)), path.resolve('missing-sdk')], { encoding: 'utf8', env: childEnvironment(path.resolve('owned')), timeout: 5000 });
  assert.equal(admitted.status, 1); assert.equal(JSON.parse(admitted.stderr).code, 'ERR_MODULE_NOT_FOUND');
});

test('guard denies global fetch itself and probe observes admission', () => {
  const child = spawnSync(process.execPath, ['--import', new URL('./network-guard.mjs', import.meta.url).href, '--input-type=module', '-e', `if(globalThis[Symbol.for('lawoss.payload.networkDisabled')]!==true)process.exit(2);try{await fetch('data:,synthetic');process.exit(3)}catch(e){if(e.code!=='NETWORK_DISABLED')throw e}`], { encoding: 'utf8', env: childEnvironment(path.resolve('owned')), timeout: 5000 });
  assert.equal(child.status, 0, child.stderr);
});

test('incomplete primer blocks replay before creating a stage', async t => {
  const base = new URL('./.work/native-tests/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(await realpath(base), 'case-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'owned'); await initialize(workspace);
  await writeFile(path.join(workspace, 'acquisition.json'), '{"schema":1,"outcome":"incomplete"}');
  await assert.rejects(prepare({ workspace }), { code: 'CACHE_INCOMPLETE' });
  assert.equal((await readdir(workspace)).some(name => name.startsWith('.stage-')), false);
});

test('native consumer gate refuses absent/fallback native, bad imports and missing guard/roundtrip', async () => {
  const { assertConsumer } = await import('./native-validation.mjs');
  const good = { imports: IMPORTS, native: 'loaded', guard: true, roundtrip: true };
  assert.doesNotThrow(() => assertConsumer(good));
  for (const value of [{ ...good, native: 'fallback' }, { ...good, native: 'absent' }, { ...good, guard: false }, { ...good, roundtrip: false }, { ...good, imports: IMPORTS.slice(1) }]) assert.throws(() => assertConsumer(value), { code: 'CONSUMER_INVALID' });
});

test('test acceptance requires every expected test and zero skip/fail/cancel', async () => {
  const { testCounts } = await import('./native-validation.mjs');
  const good = '# tests 4\n# pass 4\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
  assert.deepEqual(testCounts(good, 4), { tests: 4, pass: 4, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  for (const bad of [good.replace('# skipped 0', '# skipped 1'), good.replace('# fail 0', '# fail 1'), good.replace('# tests 4', '# tests 3'), '', good + good]) assert.throws(() => testCounts(bad, 4), { code: 'TESTS_FAILED' });
});


test('closed summary rejects extra nested fields and never accepts unknown assertions as success', async () => {
  const { checkSummary } = await import('./native-validation.mjs'); const { ACCEPTED } = await import('./prime-cache.mjs');
  const failed = { schema: 1, status: 'failed', failedStage: 'acquisition', code: 'HTTP_STATUS', headSha: 'a'.repeat(40), checkoutSha: 'b'.repeat(40), accepted: ACCEPTED, target: { platform: 'win32', arch: 'x64' }, tools: { node: null, arborist: null, pnpm: null, bun: null }, tests: { unit: null, integration: null }, acquisition: null, node: null, bun: null, assertions: { twoReplayEquality: 'unknown', physicalClosure: 'unknown', relocation: 'unknown', offlineGraph: 'unknown', corruptionNegatives: 'unknown', unchangedAfterBun: 'unknown' } };
  assert.doesNotThrow(() => checkSummary(failed));
  for (const mutation of [value => { value.tools.path = 'private'; }, value => { value.assertions.secret = true; }, value => { value.status = 'complete'; value.code = null; value.failedStage = null; }, value => { value.node = { imports: IMPORTS, native: 'loaded', guard: true, roundtrip: true, receiptSha256: 'f'.repeat(64), raw: 'private' }; }]) {
    const value = structuredClone(failed); mutation(value); assert.throws(() => checkSummary(value));
  }
});
