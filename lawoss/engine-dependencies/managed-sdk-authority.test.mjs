import '../build/plugin-payload/network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

const module = await import('./managed-sdk-authority.mjs').catch(error => {
  if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes('managed-sdk-authority.mjs')) throw error;
  return {};
});
const plan = (...args) => {
  assert.equal(typeof module.planManagedSdkConfigRoles, 'function', 'standalone authority planner API must exist');
  return module.planManagedSdkConfigRoles(...args);
};
function identity(mode = 'sdk') {
  const hash = 'a'.repeat(64);
  return { schema: 1, kind: 'lawoss-product-sdk-packaging', mode,
    applicationBuild: mode === 'development' ? null : { schemaVersion: 1, product: 'lawoss-desktop', version: '0.0.0',
      gitSha: 'b'.repeat(40), buildEpoch: '1792663200', platform: 'win32', arch: 'arm64', channel: 'stable', workflowRunUrl: '' },
    target: { platform: 'win32', arch: 'arm64' }, sdk: mode !== 'sdk' ? null : {
      schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', manifestSha256: hash,
      target: { platform: 'win32', arch: 'arm64' }, lockSha256: '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053',
      inputSha256: hash, sourceSetSha256: hash, consumerMode: 'javascript-fallback', verifierSha256: hash,
      capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: hash, bytes: 100 } } };
}
const scope = () => ({ product: 'desktop-managed-local', agentSandboxEnabled: true, appFiles: 'inside', inheritEnvironment: true });
const key = stat => ({ dev: stat.dev, ino: stat.ino });
async function grant(role, logicalPath, ancestor, physicalPath = logicalPath, alias = false) {
  let target = null;
  try { target = key(await fs.lstat(physicalPath)); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  return { role, path: logicalPath, physicalPath, alias, ancestor: { path: ancestor, ...key(await fs.lstat(ancestor)) },
    target, provenance: { kind: 'active-app-runtime', lifetimeId: 'fixture-lifetime' } };
}
async function fixture(t, { missingG = false } = {}) {
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'sdk-authority-')));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const engineHome = path.join(root, 'engine-home'), config = path.join(engineHome, 'config');
  const g = path.join(config, 'opencode'), e = path.join(root, 'org-policy-engine'), cwd = path.join(root, 'case');
  for (const dir of [config, e, cwd, ...(missingG ? [] : [g])]) await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const input = { privateProductIdentity: identity(), scope: scope(),
    captured: { environment: { XDG_CONFIG_HOME: config, OPENCODE_CONFIG_DIR: e, OPENCODE_TEST_HOME: engineHome,
      OPENCODE_DISABLE_PROJECT_CONFIG: 'true', PROVIDER_AUTH: 'PROVIDER_SECRET_SENTINEL' },
    cwd, instanceDirectory: cwd, nativeHome: path.join(root, 'native-home'), globalState: path.join(root, 'state') },
    ownedRoots: [await grant('global', g, root), await grant('explicit', e, root)], deadline: Date.now() + 10000 };
  return { root, engineHome, config, g, e, cwd, input };
}
const reason = (result, code) => assert.ok(result.uncovered.some(item => item.code === code), code);
function frozen(value) {
  if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); }
}
async function tree(root) {
  const result = [];
  async function visit(dir) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const filename = path.join(dir, entry.name), stat = await fs.lstat(filename);
      result.push([path.relative(root, filename), stat.mode, stat.ino, stat.size,
        entry.isFile() ? createHash('sha256').update(await fs.readFile(filename)).digest('hex') : null]);
      if (entry.isDirectory()) await visit(filename);
    }
  }
  await visit(root); return result;
}

test('inert actual FS preserves distinct G and E plus all custom config bytes without writes or content reads', async t => {
  const f = await fixture(t);
  for (const name of ['policy.json', 'providers.json', 'config.json', 'skills/tool.txt']) {
    await fs.mkdir(path.dirname(path.join(f.e, name)), { recursive: true });
    await fs.writeFile(path.join(f.e, name), 'PROVIDER_SECRET_SENTINEL:' + name);
  }
  const before = await tree(f.root);
  const read = t.mock.method(fs, 'readFile', () => { throw Error('content read forbidden'); });
  const mkdir = t.mock.method(fs, 'mkdir', () => { throw Error('mkdir forbidden'); });
  let result;
  try { result = await plan(f.input); } finally { read.mock.restore(); mkdir.mock.restore(); }
  assert.equal(result.status, 'planned');
  assert.deepEqual(result.roles.map(r => [r.path, r.roles]), [[f.g, ['global']], [f.e, ['explicit']]]);
  assert.equal(result.targets.length, 2); assert.deepEqual(result.leaseKeys, [f.g, f.e]); frozen(result);
  assert.equal(JSON.stringify(result).includes('PROVIDER_SECRET_SENTINEL'), false);
  assert.deepEqual(await tree(f.root), before);
});

test('all captures including grants and identity are copied before first metadata await', async t => {
  const f = await fixture(t); let start; let resume;
  const started = new Promise(resolve => start = resolve), held = new Promise(resolve => resume = resolve);
  let once = true;
  const operation = plan(f.input, { filesystem: { realpath: async filename => {
    if (once) { once = false; start(); await held; } return fs.realpath(filename);
  } } });
  await started;
  f.input.captured.environment.OPENCODE_CONFIG_DIR = '/mutated'; f.input.ownedRoots[0].path = '/mutated';
  f.input.scope.appFiles = 'outside'; f.input.privateProductIdentity.sdk.target.arch = 'x64'; resume();
  const result = await operation;
  assert.equal(result.status, 'planned'); assert.deepEqual(result.leaseKeys, [f.g, f.e]);
});

test('final captured overrides determine G/E and do not grant inherited old paths', async t => {
  const f = await fixture(t);
  f.input.captured.environment = { ...f.input.captured.environment, XDG_CONFIG_HOME: f.config, OPENCODE_CONFIG_DIR: f.e };
  const result = await plan(f.input); assert.equal(result.status, 'planned');
  assert.equal(result.roles[0].path, path.join(f.engineHome, 'config', 'opencode'));
  assert.equal(result.roles[1].path, path.join(f.root, 'org-policy-engine'));
});

test('sandbox project-disable never hides existing H and unknown extra roots stay incomplete', async t => {
  const f = await fixture(t); const h = path.join(f.engineHome, '.opencode'); await fs.mkdir(h);
  const result = await plan(f.input); assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.roles.at(-1).roles, ['explicit']);
  assert.ok(result.roles.some(r => r.path === h && r.roles.includes('home'))); reason(result, 'UNGRANTED_ROLE');
});

test('enabled project discovery retains P with home and refuses uncovered physical roots', async t => {
  const f = await fixture(t); delete f.input.captured.environment.OPENCODE_DISABLE_PROJECT_CONFIG;
  await fs.mkdir(path.join(f.cwd, '.opencode')); await fs.mkdir(path.join(f.engineHome, '.opencode'));
  const result = await plan(f.input); assert.equal(result.status, 'incomplete');
  assert.ok(result.roles.some(r => r.roles.includes('project'))); assert.ok(result.roles.some(r => r.roles.includes('home')));
});

test('missing either G or E grant and absent E cannot report complete managed coverage', async t => {
  for (const index of [0, 1]) {
    const f = await fixture(t); f.input.ownedRoots.splice(index, 1);
    const result = await plan(f.input); assert.equal(result.status, 'incomplete'); reason(result, 'UNGRANTED_ROLE');
  }
  const f = await fixture(t); delete f.input.captured.environment.OPENCODE_CONFIG_DIR;
  const result = await plan(f.input); assert.equal(result.status, 'incomplete'); reason(result, 'EXPLICIT_ROLE_MISSING');
});

test('fresh missing G is absent target under authenticated ancestor with exact suffix and no invented inode', async t => {
  const f = await fixture(t, { missingG: true }); const before = await tree(f.root);
  const result = await plan(f.input); assert.equal(result.status, 'planned');
  const target = result.targets.find(r => r.logicalPaths.includes(f.g));
  assert.equal(target.classification, 'absent-target'); assert.equal(target.identity, null);
  assert.equal(target.ancestor.path, f.root); assert.equal(target.suffix, path.relative(f.root, f.g));
  assert.deepEqual(await tree(f.root), before);
});

test('missing or substituted granted ancestor is refused before target child metadata', async t => {
  for (const missing of [false, true]) {
    const f = await fixture(t);
    f.input.ownedRoots[0].ancestor = { path: f.root, ...key(await fs.lstat(f.root)), ino: 123 };
    if (missing) f.input.ownedRoots[0].ancestor.path = path.join(f.root, 'absent-parent');
    const seen = [];
    const result = await plan(f.input, { filesystem: { lstat: async p => { seen.push(p); return fs.lstat(p); } } });
    assert.equal(result.status, 'incomplete'); assert.equal(seen.some(p => p.startsWith(f.g + path.sep)), false);
  }
});

test('root inode substitution or a regular file refuses before fixed dependency-child inspection', async t => {
  for (const file of [false, true]) {
    const f = await fixture(t); await fs.rename(f.g, f.g + '-old');
    if (file) await fs.writeFile(f.g, 'private'); else await fs.mkdir(f.g);
    const seen = [];
    const result = await plan(f.input, { filesystem: { lstat: async p => { seen.push(p); return fs.lstat(p); } } });
    assert.equal(result.status, 'incomplete'); reason(result, file ? 'TARGET_NOT_DIRECTORY' : 'ROOT_SUBSTITUTED');
    assert.equal(seen.some(p => p.startsWith(f.g + path.sep)), false);
  }
});

test('unexpected intermediate symlink escape refuses before target children', async t => {
  const f = await fixture(t); const moved = path.join(f.root, 'moved-config');
  await fs.rename(f.config, moved); await fs.symlink(moved, f.config, 'dir');
  const result = await plan(f.input); assert.equal(result.status, 'incomplete'); reason(result, 'UNEXPECTED_SYMLINK');
});

test('explicitly granted G/E symlink alias groups actual identity while retaining both lease spellings', async t => {
  const f = await fixture(t); await fs.rm(f.e, { recursive: true }); await fs.symlink(f.g, f.e, 'dir');
  f.input.ownedRoots[1] = await grant('explicit', f.e, f.root, f.g, true);
  const result = await plan(f.input); assert.equal(result.status, 'planned'); assert.equal(result.targets.length, 1);
  assert.deepEqual(result.targets[0].roles, ['global', 'explicit']);
  assert.deepEqual(result.targets[0].logicalPaths, [f.g, f.e]); assert.deepEqual(result.leaseKeys, [f.g, f.e]);
});

test('unknown alias and alias escaping its granted physical target refuse', async t => {
  for (const authorized of [false, true]) {
    const f = await fixture(t); await fs.rm(f.e, { recursive: true }); await fs.symlink(f.g, f.e, 'dir');
    if (authorized) f.input.ownedRoots[1] = await grant('explicit', f.e, f.root, path.join(f.root, 'wrong'), true);
    const result = await plan(f.input); assert.equal(result.status, 'incomplete');
    reason(result, authorized ? 'ALIAS_TARGET_MISMATCH' : 'UNEXPECTED_SYMLINK');
  }
});

test('ancestor replacement during target inspection is detected before reading its dependency children', async t => {
  const f = await fixture(t); let replaced = false; const seen = [];
  const result = await plan(f.input, { filesystem: { lstat: async p => {
    seen.push(p);
    if (p === f.g && !replaced) { replaced = true; const stat = await fs.lstat(p); return stat; }
    if (p === f.root && replaced) return { ...await fs.lstat(p), ino: 123, isDirectory: () => true, isSymbolicLink: () => false };
    return fs.lstat(p);
  } } });
  assert.equal(result.status, 'incomplete'); reason(result, 'ANCESTOR_SUBSTITUTED');
  assert.equal(seen.some(p => p.startsWith(f.g + path.sep)), false);
});

test('existing dependency entries remain unadmitted with metadata only and byte hashes unchanged', async t => {
  for (const filename of ['package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'node_modules']) {
    const f = await fixture(t); const target = path.join(f.e, filename);
    if (filename === 'node_modules') await fs.mkdir(target); else await fs.writeFile(target, 'PROVIDER_SECRET_SENTINEL');
    const before = await tree(f.root); const read = t.mock.method(fs, 'readFile', () => { throw Error('forbidden'); });
    let result; try { result = await plan(f.input); } finally { read.mock.restore(); }
    assert.equal(result.status, 'incomplete'); reason(result, 'EXISTING_PLANE_UNADMITTED');
    assert.deepEqual(await tree(f.root), before);
  }
});

test('outside/unmanaged/sandboxoff/public-scratch/noninherited and disabled identities have zero adapter calls', async () => {
  for (const change of [
    { scope: { ...scope(), appFiles: 'outside' } }, { scope: { ...scope(), product: 'external' } },
    { scope: { ...scope(), product: 'unmanaged' } }, { scope: { ...scope(), product: 'public-scratch' } },
    { scope: { ...scope(), agentSandboxEnabled: false } }, { scope: { ...scope(), inheritEnvironment: false } },
    { privateProductIdentity: null }, { privateProductIdentity: identity('development') }, { privateProductIdentity: identity('without-sdk') },
  ]) {
    let calls = 0; const forbidden = () => { calls++; throw Error('forbidden'); };
    const result = await plan({ privateProductIdentity: identity(), scope: scope(), ...change },
      { filesystem: { lstat: forbidden, realpath: forbidden, exists: forbidden }, gitQuery: forbidden, discoverConfigRoles: forbidden });
    assert.equal(result.status, 'not-applicable'); assert.equal(calls, 0);
  }
});

test('public snapshots env JSON status strings and malformed private targets never authenticate', async t => {
  const f = await fixture(t); let calls = 0; const forbidden = () => { calls++; throw Error('forbidden'); };
  const invalid = [ 'verified', { status: 'verified' }, { ...identity(), target: { platform: 'win32', arch: 'x64' } },
    { ...identity(), sdk: { ...identity().sdk, status: 'ready' } } ];
  for (const privateProductIdentity of invalid) {
    await assert.rejects(plan({ ...f.input, privateProductIdentity }, { filesystem: { lstat: forbidden, realpath: forbidden } }),
      { code: 'PRODUCT_SDK_IDENTITY_INVALID' });
  }
  await assert.rejects(plan({ ...f.input, publicSnapshot: identity() }), { code: 'INVALID_INPUT' });
  const result = await plan({ ...f.input, privateProductIdentity: null, captured: { environment: { SDK_IDENTITY: JSON.stringify(identity()) } } });
  assert.equal(result.status, 'not-applicable'); assert.equal(calls, 0);
});

test('own-data admission refuses getters cycles symbols prototypes and oversized captures without invoking accessors', async t => {
  const f = await fixture(t); let reads = 0;
  for (const make of [
    () => { const x = { ...f.input }; Object.defineProperty(x, 'scope', { enumerable: true, get() { reads++; return scope(); } }); return x; },
    () => { const x = structuredClone(f.input); Object.defineProperty(x.captured.environment, 'TOKEN', { enumerable: true, get() { reads++; return 'PROVIDER_SECRET_SENTINEL'; } }); return x; },
    () => { const x = structuredClone(f.input); x.captured.environment.loop = x; return x; },
    () => { const x = structuredClone(f.input); x.captured[Symbol('extra')] = 1; return x; },
    () => { const x = structuredClone(f.input); x.captured.environment = Object.create({ TOKEN: 'secret' }); return x; },
    () => { const x = structuredClone(f.input); x.captured.environment.TOKEN = 'x'.repeat(65537); return x; },
  ]) {
    await assert.rejects(plan(make()), error => { assert.equal(error.message.includes('PROVIDER_SECRET_SENTINEL'), false); return error.code === 'INVALID_INPUT'; });
  }
  assert.equal(reads, 0);
});

test('original absolute deadline and abort refuse pending metadata without resetting allowance or leaking raw errors', async t => {
  const f = await fixture(t); const controller = new AbortController();
  controller.abort(Error('PROVIDER_SECRET_SENTINEL'));
  await assert.rejects(plan({ ...f.input, signal: controller.signal }), { code: 'ABORTED', message: 'ABORTED' });
  await assert.rejects(plan({ ...f.input, deadline: Date.now() - 1 }), { code: 'BUDGET_EXCEEDED' });
  const deadline = Date.now() + 50;
  await assert.rejects(plan({ ...f.input, deadline }, { filesystem: { realpath: () => new Promise(() => {}) } }), { code: 'BUDGET_EXCEEDED' });
  const aborter = new AbortController(); let entered;
  const started = new Promise(resolve => entered = resolve);
  const operation = plan({ ...f.input, signal: aborter.signal }, { filesystem: { realpath: () => { entered(); return new Promise(() => {}); } } });
  await started; aborter.abort(Error('PROVIDER_SECRET_SENTINEL'));
  await assert.rejects(operation, { code: 'ABORTED', message: 'ABORTED' });
});

test('metadata failures cannot report planned and raw error messages remain private', async t => {
  const f = await fixture(t);
  const result = await plan(f.input, { filesystem: { lstat: async () => { throw Error('PROVIDER_SECRET_SENTINEL'); } } });
  assert.equal(result.status, 'incomplete'); reason(result, 'METADATA_FAILED');
  assert.equal(JSON.stringify(result).includes('PROVIDER_SECRET_SENTINEL'), false);
});

test('POSIX writable ownership metadata is checked but uid alone never grants a root', async t => {
  if (process.platform === 'win32') return t.skip('POSIX permission check');
  const f = await fixture(t); await fs.chmod(f.g, 0o777);
  const result = await plan(f.input); assert.equal(result.status, 'incomplete'); reason(result, 'UNSAFE_POSIX_METADATA');
});

test('win32 MODEL captured case-insensitive env and cross-drive relative aliases never consult live drive cwd', async () => {
  const input = { privateProductIdentity: identity(), scope: scope(), captured: {
    environment: { xdg_config_home: 'D:config', opencode_config_dir: 'D:extra', '=d:': 'D:\\captured', opencode_disable_project_config: '1' },
    cwd: 'C:\\engine', instanceDirectory: 'C:\\case', nativeHome: 'C:\\home', globalState: 'C:\\state' }, ownedRoots: [], deadline: Date.now() + 1000 };
  const result = await plan(input, { pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
    realpath: async p => p, realpathNative: async p => p, exists: async () => false,
  } });
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.roles.map(r => r.physicalPath), ['D:\\captured\\config\\opencode', 'D:\\captured\\extra']);
  assert.deepEqual(result.leaseKeys, ['D:config\\opencode', 'D:extra']);
  input.captured.environment.OPENCODE_CONFIG_DIR = 'D:conflict';
  await assert.rejects(plan(input, { pathModel: { path: path.win32, platform: 'win32' } }), { code: 'AMBIGUOUS_ENVIRONMENT' });
});

test('win32 MODEL relative drive-cwd malformed capture refuses before filesystem', async () => {
  let calls = 0; const input = { privateProductIdentity: identity(), scope: scope(), captured: {
    environment: { '=D:': 'relative', OPENCODE_CONFIG_DIR: 'D:extra' }, cwd: 'C:\\engine', instanceDirectory: 'C:\\case',
    nativeHome: 'C:\\home', globalState: 'C:\\state' }, ownedRoots: [], deadline: Date.now() + 1000 };
  await assert.rejects(plan(input, { pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
    realpath: () => { calls++; throw Error('forbidden'); },
  } }), { code: 'INVALID_INPUT' }); assert.equal(calls, 0);
});

test('no lease/Arborist/extractor/seeder or worker capability is reachable from a plan', async t => {
  const f = await fixture(t); let calls = 0; const forbidden = () => { calls++; throw Error('forbidden'); };
  const result = await plan(f.input, { withEngineDependencyLease: forbidden, prepareTarget: forbidden, arborist: forbidden,
    importSdk: forbidden, extract: forbidden, seed: forbidden, spawn: forbidden });
  assert.equal(result.status, 'planned'); assert.equal(calls, 0);
  for (const field of ['ready', 'verified', 'worker', 'environment', 'privateProductIdentity']) assert.equal(Object.hasOwn(result, field), false);
});

test('intermediate ancestry substitution before dependency inspection refuses even when target inode is unchanged', async t => {
  const f = await fixture(t); let replaced = false; const seen = [];
  const result = await plan(f.input, { filesystem: { lstat: async filename => {
    seen.push(filename);
    if (filename === f.g) replaced = true;
    if (filename === f.config && replaced) return { isSymbolicLink: () => true };
    return fs.lstat(filename);
  } } });
  assert.equal(result.status, 'incomplete'); reason(result, 'UNEXPECTED_SYMLINK');
  assert.equal(seen.some(filename => filename.startsWith(f.g + path.sep)), false);
});

test('original deadline and exact captured environment reach discovery Git queries and wait for their settlement', async t => {
  const f = await fixture(t); await fs.mkdir(path.join(f.cwd, '.git'));
  let calls = 0;
  const result = await plan(f.input, { gitQuery: async ({ cwd, args, environment, deadline, signal }) => {
    calls++; assert.equal(cwd, f.cwd); assert.equal(deadline, f.input.deadline);
    assert.equal(environment.XDG_CONFIG_HOME, f.config); assert.equal(environment.PROVIDER_AUTH, 'PROVIDER_SECRET_SENTINEL');
    assert.ok(signal instanceof AbortSignal); assert.equal(args[0], 'rev-parse');
    return { exitCode: 1, text: '' };
  } });
  assert.equal(result.status, 'planned'); assert.equal(calls, 3);
});

test('grant provenance absent or UID-only authority cannot authorize managed coverage', async t => {
  const f = await fixture(t); f.input.ownedRoots[0].provenance.kind = 'same-uid';
  await assert.rejects(plan(f.input), { code: 'INVALID_INPUT' });
});

test('metadata error code getters are never evaluated or exposed', async t => {
  const f = await fixture(t); let reads = 0;
  const error = Object.defineProperty({}, 'code', { get() { reads++; throw Error('PROVIDER_SECRET_SENTINEL'); } });
  const result = await plan(f.input, { filesystem: { lstat: async () => { throw error; } } });
  assert.equal(result.status, 'incomplete'); reason(result, 'METADATA_FAILED'); assert.equal(reads, 0);
  assert.equal(JSON.stringify(result).includes('PROVIDER_SECRET_SENTINEL'), false);
});

test('explicit alias changed during canonical inspection refuses the old logical binding', async t => {
  const f = await fixture(t); await fs.rm(f.e, { recursive: true }); await fs.symlink(f.g, f.e, 'dir');
  f.input.ownedRoots[1] = await grant('explicit', f.e, f.root, f.g, true);
  let aliasResolved = false, replaced = false;
  const result = await plan(f.input, { filesystem: {
    realpath: async filename => { if (filename === f.e) aliasResolved = true; return fs.realpath(filename); },
    lstat: async filename => {
      if (aliasResolved && !replaced && filename === f.g) {
        replaced = true; await fs.unlink(f.e); await fs.mkdir(f.e);
      }
      return fs.lstat(filename);
    },
  } });
  assert.equal(result.status, 'incomplete'); reason(result, 'ALIAS_TARGET_MISMATCH');
});
