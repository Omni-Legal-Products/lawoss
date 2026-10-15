import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import childProcess, { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { discoverConfigRoles } from './config-roles.mjs';

const owned = path.join(path.dirname(fileURLToPath(import.meta.url)), '.work', 'test-fixtures');
const queryNames = ['--show-toplevel', '--git-dir', '--git-common-dir'];
async function fixture(t) {
  await fs.mkdir(owned, { recursive: true });
  const root = await fs.mkdtemp(path.join(owned, 'roles-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  // Isolate this fixture from the enclosing checkout's .git marker. This
  // deliberately invalid local marker produces the engine's non-repo fallback.
  await fs.writeFile(path.join(root, '.git'), 'synthetic invalid Git marker');
  const home = path.join(root, 'home');
  const cwd = path.join(root, 'engine');
  const repo = path.join(root, 'repo');
  const selected = path.join(repo, 'case');
  await Promise.all([home, cwd, selected].map(p => fs.mkdir(p, { recursive: true })));
  const env = { PATH: process.env.PATH, HOME: home, XDG_CONFIG_HOME: path.join(root, 'xdg'),
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: path.join(root, 'no-global'),
    GIT_CONFIG_SYSTEM: path.join(root, 'no-system'), GIT_TERMINAL_PROMPT: '0' };
  const input = { instanceDirectory: selected, engineCwd: cwd, homeDirectory: home,
    environment: env, deadline: Date.now() + 10_000 };
  const mkdir = async p => { await fs.mkdir(p, { recursive: true }); return p; };
  return { root, home, cwd, repo, selected, env, input, mkdir };
}
const paths = result => result.roles.map(role => role.path);
const fakeRepo = repo => ({ gitQuery: async ({ args }) => ({ exitCode: 0,
  text: args[1] === '--show-toplevel' ? repo + '\n' : '.git\n' }) });

// Oracles: pinned ConfigPaths.directories ordered G/P/H/E, FSUtil.up existence,
// Global.Path (not Global.make), xdg5.1 index.js and Flag.truthy.
test('inside keeps all five ordered roles, including a file .opencode', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.repo, '.git'));
  await f.mkdir(path.join(f.selected, '.opencode'));
  await fs.writeFile(path.join(f.repo, '.opencode'), 'ordinary file');
  await f.mkdir(path.join(f.home, '.opencode'));
  f.env.OPENCODE_CONFIG_DIR = path.join(f.root, 'custom-nonexistent');
  f.env.OPENCODE_CONFIG = path.join(f.root, 'runtime', 'config.json');
  const result = await discoverConfigRoles(f.input, fakeRepo(f.repo));
  assert.deepEqual(paths(result), [path.join(f.root, 'xdg', 'opencode'),
    path.join(f.selected, '.opencode'), path.join(f.repo, '.opencode'),
    path.join(f.home, '.opencode'), path.join(f.root, 'custom-nonexistent')]);
  assert.deepEqual(result.roles.map(r => r.roles), [['global'], ['project'], ['project'], ['home'], ['explicit']]);
  assert.equal(result.worktree, f.repo);
});

test('outside flag removes only P; CLI inherited E is not replaced', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.selected, '.opencode'));
  await f.mkdir(path.join(f.home, '.opencode'));
  f.env.OPENCODE_CONFIG_DIR = 'inherited';
  f.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'TrUe';
  assert.deepEqual(paths(await discoverConfigRoles(f.input)), [path.join(f.root, 'xdg', 'opencode'),
    path.join(f.home, '.opencode'), 'inherited']);
  f.env.OPENCODE_DISABLE_PROJECT_CONFIG = '';
  assert.ok(paths(await discoverConfigRoles(f.input)).includes(path.join(f.selected, '.opencode')));
  assert.equal(paths(await discoverConfigRoles(f.input)).at(-1), 'inherited');
});

test('relative G H E resolve against engine cwd, not selected instance; empty home survives nullish default', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.cwd, 'relative-home', '.opencode'));
  Object.assign(f.env, { XDG_CONFIG_HOME: 'relative-xdg', OPENCODE_TEST_HOME: 'relative-home',
    OPENCODE_CONFIG_DIR: '../explicit', OPENCODE_DISABLE_PROJECT_CONFIG: '1' });
  const result = await discoverConfigRoles(f.input);
  assert.deepEqual(paths(result), [path.join('relative-xdg', 'opencode'), path.join('relative-home', '.opencode'), '../explicit']);
  assert.deepEqual(result.roles.map(r => r.physicalPath), [path.join(f.cwd, 'relative-xdg', 'opencode'),
    path.join(f.cwd, 'relative-home', '.opencode'), path.join(f.root, 'explicit')]);
  f.env.OPENCODE_TEST_HOME = '';
  await f.mkdir(path.join(f.cwd, '.opencode'));
  assert.equal(paths(await discoverConfigRoles(f.input))[1], '.opencode');
});

test('only true and 1 disable projects; empty XDG and explicit fall back faithfully', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.selected, '.opencode'));
  f.env.XDG_CONFIG_HOME = '';
  f.env.OPENCODE_CONFIG_DIR = '';
  for (const [flag, enabled] of [['TRUE', false], ['1', false], ['', true], ['false', true], ['0', true], [' true ', true]]) {
    f.env.OPENCODE_DISABLE_PROJECT_CONFIG = flag;
    const result = await discoverConfigRoles(f.input);
    assert.equal(paths(result)[0], path.join(f.home, '.config', 'opencode'));
    assert.equal(result.roles.some(r => r.roles.includes('project')), enabled, flag);
    assert.ok(!result.roles.some(r => r.roles.includes('home') || r.roles.includes('explicit')));
  }
});

test('string dedup combines roles while symlink aliases retain logical identity', async t => {
  const f = await fixture(t);
  const shared = await f.mkdir(path.join(f.selected, '.opencode'));
  const alias = path.join(f.root, 'alias');
  await fs.symlink(shared, alias, 'dir');
  f.env.XDG_CONFIG_HOME = f.selected;
  f.env.OPENCODE_CONFIG_DIR = shared;
  f.env.OPENCODE_TEST_HOME = f.selected;
  const result = await discoverConfigRoles(f.input);
  const entry = result.roles.find(r => r.path === shared);
  assert.deepEqual(entry.roles, ['project', 'home', 'explicit']);
  assert.equal(result.roles.filter(r => r.path === shared).length, 1);
  f.env.OPENCODE_CONFIG_DIR = alias;
  const aliased = await discoverConfigRoles(f.input);
  assert.ok(paths(aliased).includes(alias));
  assert.ok(paths(aliased).includes(shared));
});

test('captures caller environment and paths before first async metadata operation', async t => {
  const f = await fixture(t);
  f.env.OPENCODE_CONFIG_DIR = 'original';
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const operation = discoverConfigRoles(f.input, { filesystem: {
    realpath: async p => { await blocked; return fs.realpath(p); },
  } });
  f.env.OPENCODE_CONFIG_DIR = 'changed';
  f.env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true';
  f.input.engineCwd = f.repo;
  release();
  const result = await operation;
  assert.equal(paths(result).at(-1), 'original');
  assert.equal(result.roles.at(-1).physicalPath, path.join(f.cwd, 'original'));
});

// Project.resolve non-Git filesystem-root fallback; FSUtil.resolve realpath/ENOENT.
test('non-Git walks through filesystem root and canonicalizes a selected symlink', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.root, '.opencode'));
  await f.mkdir(path.join(f.repo, '.opencode'));
  const link = path.join(f.root, 'selected-link');
  await fs.symlink(f.selected, link, 'dir');
  f.input.instanceDirectory = link;
  const seen = [];
  const result = await discoverConfigRoles(f.input, { filesystem: { exists: async p => {
    seen.push(p); if (path.basename(p) === '.git') return false;
    try { await fs.access(p); return true; } catch (e) {
      if (e.code === 'ENOENT' || e.code === 'ENOTDIR') return false; throw e;
    }
  } } });
  assert.equal(result.directory, await fs.realpath(f.selected));
  assert.equal(result.worktree, path.parse(f.selected).root);
  assert.ok(paths(result).includes(path.join(f.root, '.opencode')));
  assert.ok(seen.includes(path.join(path.parse(f.selected).root, '.opencode')));
  assert.ok(seen.every(p => ['.git', '.opencode'].includes(path.basename(p))));
});

test('nonexistent canonical directory falls back only on ENOENT', async t => {
  const f = await fixture(t);
  f.input.instanceDirectory = path.join(f.repo, 'missing');
  assert.equal((await discoverConfigRoles(f.input)).directory, path.join(f.repo, 'missing'));
  await assert.rejects(discoverConfigRoles(f.input, { filesystem: { realpath: async () => {
    throw Object.assign(new Error('private path'), { code: 'EACCES' });
  } } }), { code: 'FILESYSTEM_FAILED', message: 'FILESYSTEM_FAILED' });
});

// Git.repo.discover queries all three in order; run errors become exit1, only
// git-dir/common-dir failure selects filesystem root; toplevel failure uses marker parent.
test('Git fallback branches preserve source query ordering and top-level error cwd', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.repo, '.git'));
  for (const failed of ['--show-toplevel', '--git-dir', '--git-common-dir', 'missing', 'error']) {
    const seen = [];
    const result = await discoverConfigRoles(f.input, { gitQuery: async ({ cwd, args }) => {
      assert.equal(cwd, f.repo); seen.push(args[1]);
      if (failed === 'missing' || failed === 'error') throw Object.assign(new Error('secret stderr'), { code: failed === 'missing' ? 'ENOENT' : 'EACCES' });
      return { exitCode: args[1] === failed ? 1 : 0, text: args[1] === '--show-toplevel' ? f.repo : '.git' };
    } });
    assert.deepEqual(seen, queryNames);
    assert.equal(result.worktree, failed === '--show-toplevel' ? f.repo : path.parse(f.repo).root);
  }
});

test('Git marker lookup failure falls back, project lookup failure remains typed', async t => {
  const f = await fixture(t);
  const adapter = { filesystem: { exists: async p => {
    if (path.basename(p) === '.git') throw new Error('private marker');
    return false;
  } } };
  assert.equal((await discoverConfigRoles(f.input, adapter)).worktree, path.parse(f.repo).root);
  await assert.rejects(discoverConfigRoles(f.input, { filesystem: { exists: async p => {
    if (path.basename(p) === '.opencode') throw new Error('private config'); return false;
  } } }), { code: 'FILESYSTEM_FAILED', message: 'FILESYSTEM_FAILED' });
});

async function gitFixture(f, args) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', args, { cwd: f.root, env: f.env, stdio: ['ignore', 'ignore', 'ignore'] });
    let error;
    child.once('error', e => { error = e; });
    child.once('close', code => error ? reject(error) : code === 0 ? resolve() : reject(new Error('fixture git failed')));
  });
}

test('actual isolated Git subdirectory and linked .git-file worktree stop inclusively', async t => {
  const f = await fixture(t);
  await gitFixture(f, ['init', '--quiet', f.repo]);
  const linked = path.join(f.root, 'linked');
  await gitFixture(f, ['-C', f.repo, 'worktree', 'add', '--quiet', '--orphan', '-b', 'fixture', linked]);
  await f.mkdir(path.join(f.root, '.opencode'));
  await f.mkdir(path.join(f.repo, '.opencode'));
  const main = await discoverConfigRoles(f.input);
  assert.equal(main.worktree, await fs.realpath(f.repo));
  assert.ok(!paths(main).includes(path.join(f.root, '.opencode')));
  const subdir = await f.mkdir(path.join(linked, 'nested'));
  await f.mkdir(path.join(linked, '.opencode'));
  const other = await discoverConfigRoles({ ...f.input, instanceDirectory: subdir });
  assert.equal(other.worktree, await fs.realpath(linked));
  assert.ok(paths(other).includes(path.join(linked, '.opencode')));
  assert.ok(!paths(other).includes(path.join(f.repo, '.opencode')));
  assert.ok(!paths(other).includes(path.join(f.root, '.opencode')));
});

test('Git successful empty toplevel and CRLF result use source resolvePath semantics', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.repo, '.git'));
  for (const text of ['', '\r\n', './\r\n']) {
    const result = await discoverConfigRoles(f.input, { gitQuery: async () => ({ exitCode: 0, text }) });
    assert.equal(result.worktree, f.repo);
  }
});

test('same absolute deadline and cancellation propagate; exhaustion never becomes fallback authority', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.repo, '.git'));
  const aborter = new AbortController();
  const deadline = Date.now() + 1000;
  await assert.rejects(discoverConfigRoles({ ...f.input, signal: aborter.signal, deadline }, {
    gitQuery: async context => {
      assert.equal(context.deadline, deadline);
      assert.ok(context.signal instanceof AbortSignal);
      aborter.abort(new Error('private reason'));
      throw new Error('secondary query failure');
    },
  }), { code: 'ABORTED', message: 'ABORTED' });
  await assert.rejects(discoverConfigRoles({ ...f.input, deadline: Date.now() - 1 }), { code: 'BUDGET_EXCEEDED' });
  await assert.rejects(discoverConfigRoles(f.input, { gitQuery: async () => {
    throw Object.assign(new Error('private resource'), { code: 'EMFILE' });
  } }), { code: 'RESOURCE_EXHAUSTED', message: 'RESOURCE_EXHAUSTED' });
});

test('one deadline spans metadata awaits, not just Git queries', async t => {
  const f = await fixture(t);
  await assert.rejects(discoverConfigRoles({ ...f.input, deadline: Date.now() + 30 }, {
    filesystem: { realpath: () => new Promise(() => {}) },
  }), { code: 'BUDGET_EXCEEDED', message: 'BUDGET_EXCEEDED' });
});

test('bounded Git adapter output is refusal and never selects a fallback root', async t => {
  const f = await fixture(t);
  await f.mkdir(path.join(f.repo, '.git'));
  await assert.rejects(discoverConfigRoles(f.input, { gitQuery: async () => ({ exitCode: 0, text: 'x'.repeat(70_000) }) }),
    { code: 'GIT_OUTPUT_LIMIT', message: 'GIT_OUTPUT_LIMIT' });
});

// Explicit win32 path MODEL: no claim of execution on Windows.
test('win32 MODEL canonical /mnt spelling, relative roots and drive-root ancestor stop', async () => {
  const seen = [];
  const result = await discoverConfigRoles({ instanceDirectory: '/mnt/c/repo/case', engineCwd: 'C:\\engine',
    homeDirectory: 'C:\\native-home', environment: { XDG_CONFIG_HOME: 'relative', OPENCODE_CONFIG_DIR: '..\\extra' },
    deadline: Date.now() + 1000 }, { pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
    realpath: async p => p,
    realpathNative: async p => p,
    exists: async p => { seen.push(p); return p === 'C:\\repo\\.opencode'; },
  } });
  assert.equal(result.directory, 'C:\\repo\\case');
  assert.equal(result.worktree, 'C:\\');
  assert.deepEqual(paths(result), ['relative\\opencode', 'C:\\repo\\.opencode', '..\\extra']);
  assert.deepEqual(result.roles.map(r => r.physicalPath), ['C:\\engine\\relative\\opencode', 'C:\\repo\\.opencode', 'C:\\extra']);
  assert.ok(seen.includes('C:\\.opencode'));
});


// A real owned child runs a synthetic fixed Git response. Capturing its close
// event tests the production collector's lifecycle, not a mocked close result.
async function interceptGit(t, f, source, onClose = () => {}) {
  const script = path.join(f.root, 'synthetic-git.mjs');
  await fs.writeFile(script, source);
  const original = childProcess.spawn;
  const children = [];
  const replacement = t.mock.method(childProcess, 'spawn', (command, args, options) => {
    assert.equal(command, 'git');
    assert.equal(args[0], 'rev-parse');
    assert.ok(queryNames.includes(args[1]));
    const child = original(process.execPath, [script, ...args], options);
    const observed = { child, closed: false };
    child.once('close', () => { observed.closed = true; onClose(); });
    children.push(observed);
    return child;
  });
  syncBuiltinESMExports();
  t.after(() => { replacement.mock.restore(); syncBuiltinESMExports(); });
  return children;
}

test('native Git cancellation awaits owned child close before returning', async t => {
  const f = await fixture(t);
  const aborter = new AbortController();
  const children = await interceptGit(t, f, "process.stdout.write('ready'); setInterval(() => {}, 1000);");
  const pending = discoverConfigRoles({ ...f.input, signal: aborter.signal });
  // Readiness is a real stdout handshake, not an arbitrary wall-clock wait.
  while (!children.length) await new Promise(resolve => setImmediate(resolve));
  children[0].child.stdout.once('data', () => aborter.abort());
  await assert.rejects(pending, { code: 'ABORTED', message: 'ABORTED' });
  assert.equal(children.length, 1);
  assert.equal(children[0].closed, true);
});

test('native Git output limit is primary even when caller aborts during close', async t => {
  const f = await fixture(t);
  const aborter = new AbortController();
  const children = await interceptGit(t, f,
    "process.stderr.write('private diagnostic'); process.stdout.write(Buffer.alloc(70000)); setInterval(() => {}, 1000);",
    () => aborter.abort());
  await assert.rejects(discoverConfigRoles({ ...f.input, signal: aborter.signal }),
    { code: 'GIT_OUTPUT_LIMIT', message: 'GIT_OUTPUT_LIMIT' });
  assert.equal(children.length, 1);
  assert.ok(children.every(c => c.closed));
});

test('native Git deadline closes the owned child and never retries', async t => {
  const f = await fixture(t);
  const children = await interceptGit(t, f, 'setInterval(() => {}, 1000);');
  await assert.rejects(discoverConfigRoles({ ...f.input, deadline: Date.now() + 100 }),
    { code: 'BUDGET_EXCEEDED', message: 'BUDGET_EXCEEDED' });
  assert.equal(children.length, 1);
  assert.ok(children.every(c => c.closed));
});

test('native missing Git uses source fallback after three spawn-close failures', async t => {
  const f = await fixture(t);
  f.env.PATH = path.join(f.root, 'no-executables');
  const original = childProcess.spawn;
  let closed = 0;
  const replacement = t.mock.method(childProcess, 'spawn', (...args) => {
    const child = original(...args);
    child.once('close', () => { closed += 1; });
    return child;
  });
  syncBuiltinESMExports();
  try {
    assert.equal((await discoverConfigRoles(f.input)).worktree, path.parse(f.repo).root);
    assert.equal(closed, 3);
  } finally { replacement.mock.restore(); syncBuiltinESMExports(); }
});

test('discovery never reads config contents or creates global/home directories', async t => {
  const f = await fixture(t);
  const read = t.mock.method(fs, 'readFile', () => { throw new Error('content read prohibited'); });
  const mkdir = t.mock.method(fs, 'mkdir', () => { throw new Error('creation prohibited'); });
  try {
    const result = await discoverConfigRoles(f.input, { gitQuery: async () => ({ exitCode: 1, text: '' }) });
    assert.equal(paths(result)[0], path.join(f.root, 'xdg', 'opencode'));
    await assert.rejects(fs.access(path.join(f.root, 'xdg')), { code: 'ENOENT' });
    await assert.rejects(fs.access(path.join(f.home, '.opencode')), { code: 'ENOENT' });
  } finally { read.mock.restore(); mkdir.mock.restore(); }
});

test('global and explicit exact-string collision keeps first position and both roles', async t => {
  const f = await fixture(t);
  f.env.OPENCODE_CONFIG_DIR = path.join(f.root, 'xdg', 'opencode');
  f.env.OPENCODE_DISABLE_PROJECT_CONFIG = '1';
  const result = await discoverConfigRoles(f.input);
  assert.equal(result.roles.length, 1);
  assert.deepEqual(result.roles[0].roles, ['global', 'explicit']);
});

test('relative instance canonicalization uses captured engine cwd', async t => {
  const f = await fixture(t);
  const result = await discoverConfigRoles({ ...f.input, instanceDirectory: '../repo/case' });
  assert.equal(result.directory, await fs.realpath(f.selected));
});

test('win32 MODEL normalizes all supported drive spellings and native casing', async () => {
  for (const spelling of ['/c:/repo/case', '/c/repo/case', '/cygdrive/c/repo/case', '/mnt/c/repo/case']) {
    const result = await discoverConfigRoles({ instanceDirectory: spelling, engineCwd: 'C:\\engine',
      homeDirectory: 'C:\\home', environment: {}, deadline: Date.now() + 1000 }, {
      pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
        realpath: async p => { assert.equal(p, 'C:\\repo\\case'); return p; },
        realpathNative: async () => 'C:\\Repo\\Case', exists: async () => false,
      },
    });
    assert.equal(result.directory, 'C:\\Repo\\Case');
    assert.equal(result.worktree, 'C:\\');
    assert.deepEqual(paths(result), ['C:\\home\\.config\\opencode']);
  }
});

test('typed refusal for malformed inputs and malformed query results never exposes their content', async t => {
  const f = await fixture(t);
  await assert.rejects(discoverConfigRoles(), { code: 'INVALID_INPUT', message: 'INVALID_INPUT' });
  for (const change of [{ engineCwd: 'relative' }, { environment: null }, { deadline: Infinity }, { signal: 'secret signal' }]) {
    await assert.rejects(discoverConfigRoles({ ...f.input, ...change }), { code: 'INVALID_INPUT', message: 'INVALID_INPUT' });
  }
  await assert.rejects(discoverConfigRoles(f.input, { gitQuery: async () => ({ text: 'private path' }) }),
    { code: 'GIT_QUERY_INVALID', message: 'GIT_QUERY_INVALID' });
});

test('win32 MODEL cross-drive relative roles use captured drive cwd, never live process cwd', async () => {
  const result = await discoverConfigRoles({ instanceDirectory: 'C:\\case', engineCwd: 'C:\\engine',
    homeDirectory: 'C:\\home', environment: { XDG_CONFIG_HOME: 'D:config', OPENCODE_CONFIG_DIR: 'D:extra',
      '=D:': 'D:\\captured' }, deadline: Date.now() + 1000 }, {
    pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
      realpath: async p => p, realpathNative: async p => p, exists: async () => false,
    },
  });
  assert.deepEqual(paths(result), ['D:config\\opencode', 'D:extra']);
  assert.deepEqual(result.roles.map(r => r.physicalPath), ['D:\\captured\\config\\opencode', 'D:\\captured\\extra']);
});


test('win32 MODEL missing drive cwd falls back to that drive root and malformed capture refuses', async () => {
  const input = { instanceDirectory: 'C:\\case', engineCwd: 'C:\\engine', homeDirectory: 'C:\\home',
    environment: { OPENCODE_CONFIG_DIR: 'D:extra' }, deadline: Date.now() + 1000 };
  const adapters = { pathModel: { path: path.win32, platform: 'win32' }, filesystem: {
    realpath: async p => p, realpathNative: async p => p, exists: async () => false,
  } };
  assert.equal((await discoverConfigRoles(input, adapters)).roles.at(-1).physicalPath, 'D:\\extra');
  input.environment['=D:'] = 'relative-private';
  await assert.rejects(discoverConfigRoles(input, adapters), { code: 'INVALID_INPUT', message: 'INVALID_INPUT' });
});

test('preaborted operation does not begin filesystem discovery', async t => {
  const f = await fixture(t);
  const aborter = new AbortController();
  aborter.abort(new Error('private reason'));
  let reads = 0;
  await assert.rejects(discoverConfigRoles({ ...f.input, signal: aborter.signal }, { filesystem: {
    realpath: async () => { reads += 1; throw new Error('unexpected read'); },
  } }), { code: 'ABORTED', message: 'ABORTED' });
  assert.equal(reads, 0);
});
