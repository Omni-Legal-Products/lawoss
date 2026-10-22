import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { initialize } from './prepare.mjs';
import { validateRuntimeConsumer } from './runtime-consumer-validation.mjs';

const execute = promisify(execFile);
const entry = new URL('./runtime-consumer-validation.mjs', import.meta.url);
const repository = fileURLToPath(new URL('../../../', import.meta.url));
const defaultSummary = new URL('./.work/runtime-consumer-summary.json', import.meta.url);

async function fixture(t) {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-output-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const parent = path.join(temporary, 'owned');
  await initialize(parent);
  return { temporary, parent };
}
async function defaultReceipt() {
  try {
    const bytes = await readFile(defaultSummary), stat = await lstat(defaultSummary);
    return { bytes, dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

// The permission child is only a test envelope. It cannot write the default SDK
// workspace or execute validation children. It never runs a genuine producer;
// invalid explicit authority must refuse before admission or network work.
test('invalid explicit output authority refuses before touching the default SDK workspace', async t => {
  const temporary = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-output-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const code = `
    import assert from 'node:assert/strict';
    import { validateRuntimeConsumer } from ${JSON.stringify(entry.href)};
    await assert.rejects(validateRuntimeConsumer(undefined, undefined, { outputParent: 'relative' }), { code: 'WORKSPACE_INVALID' });
  `;
  await execute(process.execPath, ['--permission', '--allow-fs-read=' + repository,
    '--allow-fs-read=' + temporary, '--allow-fs-write=' + temporary,
    '--input-type=module', '-e', code], { env: { ...process.env, LAWOSS_PR_HEAD: '', LAWOSS_CHECKOUT_SHA: '' }, timeout: 10000 });
});

test('missing, malformed, noncanonical and unowned explicit parents never receive a summary', async t => {
  const { temporary, parent } = await fixture(t), before = await defaultReceipt();
  const unowned = path.join(temporary, 'unowned'); await mkdir(unowned);
  const ownedBefore = (await readdir(parent)).sort();
  for (const outputParent of [null, 23, '', 'relative', path.join(temporary, 'missing'), unowned,
    `${parent}${path.sep}child${path.sep}..`]) {
    await assert.rejects(validateRuntimeConsumer(undefined, undefined, { outputParent }), { code: 'WORKSPACE_INVALID' });
  }
  assert.deepEqual((await readdir(parent)).sort(), ownedBefore);
  assert.deepEqual(await readdir(unowned), []);
  assert.deepEqual(await defaultReceipt(), before);
});

test('a symlink cannot supply an initialized output parent', {
  skip: process.platform === 'win32' ? 'Ordinary Windows symlink creation is not guaranteed' : false,
}, async t => {
  const { temporary, parent } = await fixture(t), before = await readdir(parent);
  const alias = path.join(temporary, 'alias'); await symlink(parent, alias);
  await assert.rejects(validateRuntimeConsumer(undefined, undefined, { outputParent: alias }), { code: 'WORKSPACE_INVALID' });
  assert.deepEqual(await readdir(parent), before);
});

test('an initialized explicit parent receives only the finite original early-failure receipt', async t => {
  const { parent } = await fixture(t), beforeDefault = await defaultReceipt();
  const before = (await readdir(parent)).sort();
  const names = ['LAWOSS_PR_HEAD', 'LAWOSS_CHECKOUT_SHA'];
  const original = names.map(name => process.env[name]);
  for (const name of names) process.env[name] = 'a'.repeat(40);
  let result;
  try {
    // A non-string executable refuses before any validation child or tool probe.
    result = await validateRuntimeConsumer(undefined, undefined, { outputParent: parent });
  } finally {
    for (const [index, name] of names.entries()) {
      if (original[index] === undefined) delete process.env[name]; else process.env[name] = original[index];
    }
  }
  assert.equal(result.schema, 2);
  assert.equal(result.kind, 'plugin-sdk-runtime-consumer');
  assert.equal(result.status, 'failed');
  assert.equal(result.failedStage, 'admission');
  assert.equal(result.code, 'EXECUTABLE_INVALID');
  assert.equal(result.producer, null);
  assert.equal(result.consumer, null);
  assert.equal(result.acquisition, null);
  assert.deepEqual(result.tests, { producer: null, consumer: null });
  assert.equal(Object.keys(result.sources).length, 27);
  assert.deepEqual(JSON.parse(await readFile(path.join(parent, 'runtime-consumer-summary.json'))), result);
  assert.deepEqual((await readdir(parent)).sort(), [...before, 'runtime-consumer-summary.json'].sort());
  assert.deepEqual(await defaultReceipt(), beforeDefault);
});

test('existing workspace or summary refuses before probes and preserves every owned entry', async t => {
  for (const name of ['runtime-consumer-validation', 'runtime-consumer-summary.json']) await t.test(name, async t => {
    const { parent } = await fixture(t), existing = path.join(parent, name);
    if (name === 'runtime-consumer-validation') await initialize(existing);
    else await writeFile(existing, 'preserve existing summary', { flag: 'wx' });
    const before = await lstat(existing), entries = (await readdir(parent)).sort();
    await assert.rejects(validateRuntimeConsumer(undefined, undefined, { outputParent: parent }), { code: 'OUTPUT_EXISTS' });
    const after = await lstat(existing);
    assert.equal(after.dev, before.dev); assert.equal(after.ino, before.ino);
    assert.deepEqual((await readdir(parent)).sort(), entries);
    if (name.endsWith('.json')) assert.equal(await readFile(existing, 'utf8'), 'preserve existing summary');
  });
});

test('CLI refuses unknown, partial, relative and repeated optional output arguments before validation', async t => {
  const { parent } = await fixture(t), before = await defaultReceipt();
  for (const extra of [['--unknown', parent], ['--output-parent'], ['--output-parent', 'relative'],
    ['--output-parent', parent, '--output-parent', parent]]) {
    await assert.rejects(execute(process.execPath, [fileURLToPath(entry), 'unused-node', 'unused-pnpm', ...extra], { timeout: 10000 }), error => {
      assert.equal(error.code, 1);
      assert.deepEqual(JSON.parse(error.stderr), { code: 'ARGUMENT_INVALID' });
      return true;
    });
  }
  assert.deepEqual(await defaultReceipt(), before);
  assert.equal((await readdir(parent)).includes('runtime-consumer-summary.json'), false);
});

test('CLI exact output-parent pair reaches owned admission without a default workspace write', async t => {
  const { temporary } = await fixture(t), before = await defaultReceipt();
  await assert.rejects(execute(process.execPath, [fileURLToPath(entry), 'unused-node', 'unused-pnpm',
    '--output-parent', path.join(temporary, 'missing')], { timeout: 10000 }), error => {
    assert.equal(error.code, 1);
    assert.deepEqual(JSON.parse(error.stderr), { code: 'WORKSPACE_INVALID' });
    return true;
  });
  assert.deepEqual(await defaultReceipt(), before);
});
