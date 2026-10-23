import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, readFile, readdir, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import childProcess from 'node:child_process';
import { builtinModules, syncBuiltinESMExports } from 'node:module';
import { runInNewContext } from 'node:vm';
import path from 'node:path';
import { buildProductSdkStageWorker, admitProductSdkWorkerBun } from './product-stage-worker.mjs';
import { canonical } from './validate.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const refusal = { code: 'PRODUCT_SDK_WORKER_INVALID' };
async function root(t) {
  const directory = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-worker-build-')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
test('explicit compiler admission refuses missing, relative, wrong actual version and aliases before output', async t => {
  const directory = await root(t);
  for (const bunPath of [undefined, 'bun', process.execPath]) await assert.rejects(admitProductSdkWorkerBun(bunPath), refusal);
  if (process.platform !== 'win32') {
    const alias = path.join(directory, 'bun'); await symlink(process.env.LAWOSS_TEST_BUN, alias);
    await assert.rejects(admitProductSdkWorkerBun(alias), refusal);
  }
});
test('actual fixed Bun compiler produces finite worker binding and rejects malformed closure and emitted requires', async t => {
  const applicationCodeRoot = await root(t);
  const spawn = childProcess.spawn, compilerClosures = [];
  childProcess.spawn = function(...args) {
    const child = Reflect.apply(spawn, this, args);
    const state = { child: false, stdout: false, stderr: false }; compilerClosures.push(state);
    child.once('close', () => { state.child = true; });
    for (const name of ['stdout', 'stderr']) child[name].once('close', () => { state[name] = true; });
    return child;
  };
  syncBuiltinESMExports();
  let worker;
  try { worker = await buildProductSdkStageWorker({ applicationCodeRoot, bunPath: process.env.LAWOSS_TEST_BUN }); }
  finally { childProcess.spawn = spawn; syncBuiltinESMExports(); }
  assert.equal(compilerClosures.length, 2);
  assert.ok(compilerClosures.every(state => Object.values(state).every(Boolean)));
  const bytes = await readFile(path.join(applicationCodeRoot, 'worker.cjs'));
  assert.equal(worker.bytes, bytes.length); assert.equal(worker.sha256, hash(bytes)); assert.match(worker.compositionSha256, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(worker), true);
  // Run the exact private pure validator against the actual compiler's output.
  // This is mutation coverage, not the positive actual preparation/ASAR proof.
  const source = await readFile(new URL('./product-stage-worker.mjs', import.meta.url), 'utf8');
  const pure = source.slice(source.indexOf('function object('), source.indexOf('export async function buildProductSdkStageWorker'));
  const builtin = new Set(builtinModules.flatMap(name => [name, `node:${name}`]).filter(name => !['child_process', 'node:child_process', 'module', 'node:module'].includes(name)));
  const check = runInNewContext(pure + '\ngraphCheck;', { path, canonical, builtin, Buffer, invalid() { throw Object.assign(new Error('PRODUCT_SDK_WORKER_INVALID'), refusal); } });
  const graph = JSON.parse(await readFile(path.join(applicationCodeRoot, 'worker-closure.json'), 'utf8'));
  const expected = new Map(await Promise.all(Object.keys(graph.inputs).map(async name => {
    const file = path.resolve(applicationCodeRoot, name); return [file, { bytes: await readFile(file) }];
  })));
  const output = path.join(applicationCodeRoot, 'worker.cjs'), text = bytes.toString('utf8');
  check(graph, applicationCodeRoot, expected, output, text);
  for (const mutate of [
    value => { delete value.inputs[Object.keys(value.inputs)[0]]; },
    value => { value.inputs['foreign.js'] = { bytes: 10, imports: [] }; },
    value => { Object.values(value.inputs)[0].imports[0].path = 'foreign.js'; },
    value => { Object.values(value.inputs)[0].imports.push({ path: 'node:child_process', kind: 'require-call', external: true }); },
    value => { Object.values(value.inputs)[0].bytes++; },
    value => { Object.values(value.outputs)[0].bytes++; },
    value => { Object.values(value.outputs)[0].entryPoint = 'foreign.js'; },
    value => { Object.values(value.outputs)[0].imports.push({ path: 'node:module', kind: 'require-call', external: true }); },
  ]) { const changed = structuredClone(graph); mutate(changed); assert.throws(() => check(changed, applicationCodeRoot, expected, output, text), refusal); }
  for (const suffix of ['\nrequire("foreign-package");', '\nrequire(variable);', '\nrequire("node:child_process");']) {
    const changed = structuredClone(graph); Object.values(changed.outputs)[0].bytes = Buffer.byteLength(text + suffix);
    assert.throws(() => check(changed, applicationCodeRoot, expected, output, text + suffix), refusal);
  }
  assert.deepEqual((await readdir(applicationCodeRoot)).sort(), ['worker-closure.json', 'worker-entry.mjs', 'worker.cjs']);
  t.diagnostic(JSON.stringify({ worker, graph, compilerClosures, bunSha256: hash(await readFile(process.env.LAWOSS_TEST_BUN)) }));
});
