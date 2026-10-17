import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, realpath, rm, writeFile, readdir, readFile, symlink } from 'node:fs/promises';
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
  const counts = number => ({ tests: number, pass: number, fail: 0, cancelled: 0, skipped: 0, todo: 0 });
  const consumer = { imports: IMPORTS, native: 'loaded', guard: true, roundtrip: true };
  const complete = {
    ...structuredClone(failed), status: 'complete', failedStage: null, code: null,
    tools: { node: { version: 'v24.21.0', sha256: '1'.repeat(64) }, arborist: '9.4.0', pnpm: '11.4.0', bun: { version: '1.3.14', revision: 'unknown', sha256: '2'.repeat(64), origin: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' } },
    tests: { unit: counts(44), integration: counts(4) },
    acquisition: { records: 32, verified: 32, totalBytes: 1, outcome: 'complete', receiptSha256: '3'.repeat(64) },
    node: { ...consumer, receiptSha256: '4'.repeat(64) }, bun: consumer,
    assertions: { twoReplayEquality: true, physicalClosure: true, relocation: true, offlineGraph: true, corruptionNegatives: true, unchangedAfterBun: true },
  };
  assert.doesNotThrow(() => checkSummary(complete));
  for (const mutation of [value => { value.tests.unit = counts(33); }, value => { value.tests.unit = counts(43); }, value => { value.tests.integration = counts(3); }, value => { value.tests.unit.skipped = 1; }, value => { value.tests.unit.fail = 1; }, value => { value.node.native = 'fallback'; }]) {
    const value = structuredClone(complete); mutation(value); assert.throws(() => checkSummary(value));
  }
});


async function toolsFixture(t) {
  const base = new URL('./.work/test-fixtures/tools-preflight/', import.meta.url); await mkdir(base, { recursive: true });
  const root = await realpath(await mkdtemp(path.join(await realpath(base), 'case-'))); t.after(() => rm(root, { recursive: true, force: true }));
  const tools = path.join(root, 'tools'); await mkdir(tools); await writeFile(path.join(tools, 'package.json'), '{}');
  return { root, tools, entry: path.join(tools, 'node_modules/@npmcli/arborist'), url: pathToFileURL(path.join(tools, 'package.json')) };
}
async function fixtureManifest(entry, value = { name: '@npmcli/arborist', version: '9.4.0' }) {
  await mkdir(entry, { recursive: true }); await writeFile(path.join(entry, 'package.json'), JSON.stringify(value));
}
async function toolsRefusal(url, code) {
  const { preflightTools } = await import('./tools-preflight.mjs');
  await assert.rejects(preflightTools(url), error => {
    assert.equal(error.code, code); assert.equal(error.message, code);
    assert.deepEqual(Object.keys(error), ['code']); return true;
  });
}

test('tools preflight refuses an absent local entry with a fixed code', async t => {
  const fixture = await toolsFixture(t); await toolsRefusal(fixture.url, 'TOOLS_LINK_ABSENT');
});

test('tools preflight distinguishes an entry with no manifest', async t => {
  const fixture = await toolsFixture(t); await mkdir(fixture.entry, { recursive: true });
  await toolsRefusal(fixture.url, 'TOOLS_MANIFEST_ABSENT');
});

test('tools preflight sanitizes malformed manifest parse failure', async t => {
  const fixture = await toolsFixture(t); await mkdir(fixture.entry, { recursive: true });
  await writeFile(path.join(fixture.entry, 'package.json'), '{private-malformed');
  await toolsRefusal(fixture.url, 'TOOLS_ADMISSION_FAILED');
});

test('tools preflight refuses wrong manifest name version and shape', async t => {
  const fixture = await toolsFixture(t);
  for (const value of [null, [], 'private', {}, { name: '@npmcli/arborist', version: '9.4.1' }, { name: 'other', version: '9.4.0' }]) {
    await fixtureManifest(fixture.entry, value); await toolsRefusal(fixture.url, 'TOOLS_INVALID');
  }
});

test('tools preflight bounds manifest bytes before parsing', async t => {
  const fixture = await toolsFixture(t); await mkdir(fixture.entry, { recursive: true });
  await writeFile(path.join(fixture.entry, 'package.json'), ' '.repeat(65537));
  await toolsRefusal(fixture.url, 'TOOLS_INVALID');
});

test('tools preflight accepts the local manifest without executing Arborist', async t => {
  const fixture = await toolsFixture(t); await fixtureManifest(fixture.entry);
  const sentinel = path.join(fixture.root, 'implementation-loaded');
  await writeFile(path.join(fixture.entry, 'index.js'), `require('node:fs').writeFileSync(${JSON.stringify(sentinel)}, 'loaded'); throw Error('must not execute');`);
  const { preflightTools } = await import('./tools-preflight.mjs');
  assert.deepEqual(await preflightTools(fixture.url), { name: '@npmcli/arborist', version: '9.4.0' });
  await assert.rejects(readFile(sentinel), { code: 'ENOENT' });
});

test('tools preflight refuses an ancestor-only matching manifest', async t => {
  const fixture = await toolsFixture(t); await fixtureManifest(path.join(fixture.root, 'node_modules/@npmcli/arborist'));
  await toolsRefusal(fixture.url, 'TOOLS_LINK_ABSENT');
});

test('tools preflight accepts the actual local symlink or Windows junction identity', async t => {
  const fixture = await toolsFixture(t); const target = path.join(fixture.tools, 'node_modules/.pnpm/arborist/node_modules/@npmcli/arborist');
  await fixtureManifest(target); await mkdir(path.dirname(fixture.entry), { recursive: true });
  await symlink(target, fixture.entry, process.platform === 'win32' ? 'junction' : 'dir');
  const { preflightTools } = await import('./tools-preflight.mjs');
  assert.deepEqual(await preflightTools(fixture.url), { name: '@npmcli/arborist', version: '9.4.0' });
});

test('tools preflight refuses a resolver manifest with a different realpath', async t => {
  const fixture = await toolsFixture(t);
  await fixtureManifest(fixture.entry, { name: '@npmcli/arborist', version: '9.4.0', exports: { './package.json': './different.json' } });
  await writeFile(path.join(fixture.entry, 'different.json'), '{"name":"@npmcli/arborist","version":"9.4.0"}');
  await toolsRefusal(fixture.url, 'TOOLS_ADMISSION_FAILED');
});

test('tools preflight sanitizes a resolver refusal without interpreting its message', async t => {
  const fixture = await toolsFixture(t);
  await fixtureManifest(fixture.entry, { name: '@npmcli/arborist', version: '9.4.0', exports: {} });
  await toolsRefusal(fixture.url, 'TOOLS_ADMISSION_FAILED');
});

test('tools preflight CLI refuses a fixture override with no private output', async t => {
  const fixture = await toolsFixture(t); await fixtureManifest(fixture.entry);
  const child = spawnSync(process.execPath, ['--import', new URL('./network-guard.mjs', import.meta.url).href, fileURLToPath(new URL('./tools-preflight.mjs', import.meta.url)), fixture.tools], { encoding: 'utf8', env: childEnvironment(fixture.root), timeout: 5000 });
  assert.equal(child.status, 1); assert.equal(child.stdout, '');
  assert.deepEqual(JSON.parse(child.stderr), { status: 'failed', code: 'TOOLS_ADMISSION_FAILED' });
});
