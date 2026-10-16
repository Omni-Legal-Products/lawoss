import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, writeFile, readFile, rm, access, symlink } from 'node:fs/promises';
import path from 'node:path';
import { homedir } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { loadEngineNpmConfig } from './npm-config.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(new URL('./runtime-tools/package.json', import.meta.url));
const Config = require('@npmcli/config');
const definitions = require('@npmcli/config/lib/definitions');
async function fixture(t) {
  const root = await mkdtemp(path.join(here, '.work/test-fixtures/npm-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'project');
  const engineNpmPath = path.join(root, 'core');
  const home = path.join(root, 'home');
  await Promise.all([directory, engineNpmPath, home].map(p => mkdir(p, { recursive: true })));
  const environment = { HOME: home, npm_config_userconfig: path.join(home, '.npmrc'), npm_config_globalconfig: path.join(root, 'global.npmrc') };
  await writeFile(path.join(directory, 'package.json'), '{"name":"fixture","private":true}\n');
  await writeFile(path.join(directory, 'package-lock.json'), '{"fixture":"untouched"}\n');
  return { root, directory, engineNpmPath, engineExecPath: path.join(root, 'engine/bin/opencode'), environment, nativeHome: homedir() };
}
async function reference(input, execPath = input.engineExecPath) {
  const config = new Config({ ...definitions, npmPath: input.engineNpmPath, cwd: input.directory,
    env: { ...input.environment }, argv: [execPath, execPath], execPath, platform: process.platform, warn: false });
  await config.load();
  return config;
}
await mkdir(path.join(here, '.work/test-fixtures'), { recursive: true });
test('engine tuple wins over helper-derived prefix and relocation', async t => {
  const f = await fixture(t);
  delete f.environment.npm_config_globalconfig;
  const expected = process.platform === 'win32' ? path.dirname(f.engineExecPath) : path.dirname(path.dirname(f.engineExecPath));
  const ref = await reference(f);
  const naive = await reference(f, process.execPath);
  assert.equal(ref.get('prefix'), expected);
  assert.notEqual(naive.get('prefix'), expected);
  assert.equal(ref.get('globalconfig'), path.join(expected, 'etc/npmrc'));
  const actual = await loadEngineNpmConfig(f);
  assert.deepEqual(actual, ref.flat);
  assert.equal(actual.nodeBin, f.engineExecPath);
  assert.equal(actual.npmBin, path.join(f.engineNpmPath, 'bin/npm-cli.js'));
  const relocated = path.join(f.root, 'relocated-helper');
  await mkdir(relocated);
  await writeFile(path.join(relocated, 'runtime-tools.mjs'), await readFile(new URL('./runtime-tools.mjs', import.meta.url)));
  await writeFile(path.join(relocated, 'npm-config.mjs'), await readFile(new URL('./npm-config.mjs', import.meta.url)));
  await symlink(path.join(here, 'runtime-tools'), path.join(relocated, 'runtime-tools'), 'dir');
  const other = await import(pathToFileURL(path.join(relocated, 'npm-config.mjs')));
  assert.deepEqual(await other.loadEngineNpmConfig(f), actual);
});
test('PREFIX, DESTDIR and builtin/environment prefix preserve reference defaults', async t => {
  const f = await fixture(t);
  for (const change of [{ PREFIX: path.join(f.root, 'explicit') }, ...(process.platform === 'win32' ? [] : [{ DESTDIR: path.join(f.root, 'dest') }])]) {
    f.environment = { ...f.environment, ...change };
    const ref = await reference(f);
    assert.equal(ref.get('prefix'), change.PREFIX || path.join(change.DESTDIR, path.dirname(path.dirname(f.engineExecPath))));
    assert.deepEqual(await loadEngineNpmConfig(f), ref.flat);
    delete f.environment.PREFIX; delete f.environment.DESTDIR;
  }
  await writeFile(path.join(f.engineNpmPath, 'npmrc'), `prefix=${path.join(f.root, 'builtin-prefix')}\n`);
  assert.deepEqual(await loadEngineNpmConfig(f), (await reference(f)).flat);
  f.environment.npm_config_prefix = path.join(f.root, 'env-prefix');
  assert.deepEqual(await loadEngineNpmConfig(f), (await reference(f)).flat);
});
test('real builtin/global/user/project/environment precedence, credentials and target invariants', async t => {
  const f = await fixture(t);
  await writeFile(path.join(f.engineNpmPath, 'npmrc'), 'registry=https://builtin.invalid/\n');
  assert.equal((await loadEngineNpmConfig(f)).registry, 'https://builtin.invalid/');
  await writeFile(f.environment.npm_config_globalconfig, 'registry=https://global.invalid/\n');
  assert.equal((await loadEngineNpmConfig(f)).registry, 'https://global.invalid/');
  await writeFile(f.environment.npm_config_userconfig, 'registry=https://user.invalid/\n');
  assert.equal((await loadEngineNpmConfig(f)).registry, 'https://user.invalid/');
  await writeFile(path.join(f.directory, '.npmrc'), 'registry=https://project.invalid/\ncache=${HOME}/chosen-cache\nomit[]=dev\noffline=true\n//project.invalid/:_authToken=fixture-only-sentinel\n');
  const files = ['package.json', 'package-lock.json', '.npmrc'];
  const before = await Promise.all(files.map(p => readFile(path.join(f.directory, p))));
  const actual = await loadEngineNpmConfig(f);
  assert.deepEqual(actual, (await reference(f)).flat);
  assert.equal(actual.registry, 'https://project.invalid/');
  assert.equal(actual.cache, path.join(f.environment.HOME, 'chosen-cache', '_cacache'));
  assert.deepEqual(actual.omit, ['dev']); assert.equal(actual.offline, true);
  assert.ok(actual['//project.invalid/:_authToken']);
  f.environment.npm_config_registry = 'https://env.invalid/';
  assert.equal((await loadEngineNpmConfig(f)).registry, 'https://env.invalid/');
  assert.deepEqual(await Promise.all(files.map(p => readFile(path.join(f.directory, p)))), before);
  await assert.rejects(access(path.join(f.directory, 'node_modules')));
});
test('environment captured synchronously and caller inputs remain untouched', async t => {
  const f = await fixture(t); const environment = { ...f.environment, npm_config_registry: 'https://captured.invalid/' };
  const input = { ...f, environment }; const originalProcess = { ...process.env };
  const unchanged = JSON.stringify(environment);
  await loadEngineNpmConfig(input);
  assert.ok(JSON.stringify(environment) === unchanged, 'unchanged caller environment remains identical');
  const pending = loadEngineNpmConfig(input);
  environment.npm_config_registry = 'https://later.invalid/';
  assert.equal((await pending).registry, 'https://captured.invalid/');
  assert.equal(environment.npm_config_registry, 'https://later.invalid/');
  assert.ok(JSON.stringify({ ...process.env }) === JSON.stringify(originalProcess), 'ambient environment unchanged');
});
test('ordinary absent files and ENOTDIR are accepted; read/invalid config failures refuse without content', async t => {
  const f = await fixture(t);
  await loadEngineNpmConfig(f);
  const nonDirectory = path.join(f.root, 'file'); await writeFile(nonDirectory, 'file');
  f.environment.npm_config_userconfig = path.join(nonDirectory, 'npmrc');
  await loadEngineNpmConfig(f);
  f.environment.npm_config_userconfig = f.environment.HOME; // EISDIR on the actual host
  await assert.rejects(loadEngineNpmConfig(f), { code: 'CONFIG_LOAD_FAILED', message: 'CONFIG_LOAD_FAILED' });
  f.environment.npm_config_userconfig = path.join(f.environment.HOME, '.npmrc');
  await writeFile(f.environment.npm_config_userconfig, 'fetch-retries=invalid-fixture-value\n');
  await assert.rejects(loadEngineNpmConfig(f), { code: 'CONFIG_LOAD_FAILED', message: 'CONFIG_LOAD_FAILED' });
});
test('strict inputs and absent-HOME native parity', async t => {
  const f = await fixture(t);
  for (const change of [{ directory: 'relative' }, { engineExecPath: 'relative' }, { engineNpmPath: 'relative' }, { environment: null }, { environment: { HOME: 4 } }]) {
    await assert.rejects(loadEngineNpmConfig({ ...f, ...change }), { code: 'INVALID_INPUT' });
  }
  delete f.environment.HOME;
  await assert.rejects(loadEngineNpmConfig({ ...f, nativeHome: path.join(f.root, 'wrong') }), { code: 'NATIVE_HOME_MISMATCH' });
  // Explicit user/global paths still isolate this successful fallback from profile reads.
  await loadEngineNpmConfig(f);
});

test('local tooling required: ancestor fallback and wrong local version refuse', async t => {
  const f = await fixture(t);
  const helper = path.join(f.root, 'missing-tools'); await mkdir(helper);
  await writeFile(path.join(helper, 'runtime-tools.mjs'), await readFile(new URL('./runtime-tools.mjs', import.meta.url)));
  await writeFile(path.join(helper, 'npm-config.mjs'), await readFile(new URL('./npm-config.mjs', import.meta.url)));
  const other = await import(pathToFileURL(path.join(helper, 'npm-config.mjs')));
  await assert.rejects(other.loadEngineNpmConfig(f), { code: 'TOOLING_UNAVAILABLE', message: 'TOOLING_UNAVAILABLE' });
  const fake = path.join(helper, 'runtime-tools/node_modules/@npmcli/config'); await mkdir(fake, { recursive: true });
  await writeFile(path.join(fake, 'package.json'), '{"name":"@npmcli/config","version":"0.0.0","main":"index.js"}');
  await writeFile(path.join(fake, 'index.js'), 'throw new Error("must not evaluate wrong tooling")');
  await assert.rejects(other.loadEngineNpmConfig(f), { code: 'TOOLING_UNAVAILABLE', message: 'TOOLING_UNAVAILABLE' });
});

test('invalid values and legacy auth refuse without raw sentinel events; native validation survives', async t => {
  const f = await fixture(t);
  const sentinel = 'synthetic-diagnostic-sentinel';
  let sentinelEvents = 0;
  const listener = (...args) => {
    if (args.some(value => typeof value === 'string' && value.includes(sentinel))) sentinelEvents++;
  };
  process.on('log', listener);
  try {
    await writeFile(f.environment.npm_config_userconfig, `fetch-retries=${sentinel}\n`);
    await assert.rejects(loadEngineNpmConfig(f), { code: 'CONFIG_LOAD_FAILED', message: 'CONFIG_LOAD_FAILED' });
    assert.equal(sentinelEvents, 0, 'invalid typed value must not emit its raw value');
    await writeFile(f.environment.npm_config_userconfig, `registry=https://${sentinel}.invalid/\n_authToken=${sentinel}\n`);
    await assert.rejects(loadEngineNpmConfig(f), { code: 'CONFIG_LOAD_FAILED', message: 'CONFIG_LOAD_FAILED' });
    assert.equal(sentinelEvents, 0, 'legacy auth refusal must not emit credential/registry values');
  } finally {
    process.removeListener('log', listener);
  }
  // The refused helper must not strand nopt's module-global callback. A new
  // ordinary Config still uses its original invalid handler/validity machinery.
  const configRequire = createRequire(require.resolve('@npmcli/config'));
  const nopt = configRequire('nopt');
  assert.ok(nopt.invalidHandler == null, 'callback cleared after refused helper');
  await writeFile(f.environment.npm_config_userconfig, 'fetch-retries=ordinary-invalid-number\n');
  const normal = await reference(f);
  assert.equal(normal.validate(), false);
  assert.equal(normal.valid, false);
  assert.ok(nopt.invalidHandler == null, 'native validation clears callback');
});
