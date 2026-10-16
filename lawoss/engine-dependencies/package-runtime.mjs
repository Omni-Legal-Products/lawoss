// Build-only distribution. Never imported by the desktop runtime.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
const source = path.dirname(fileURLToPath(import.meta.url));
const marker = '.lawoss-runtime-build';
const identity = 'lawoss-engine-dependencies-v1\n';
const files = ['config-roles.mjs', 'npm-config.mjs', 'dependency-lease.mjs', 'prepare-target.mjs', 'runtime-tools.mjs', 'LICENSE.opencode', 'README.md', 'runtime-tools/package.json', 'runtime-tools/pnpm-lock.yaml'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const fail = code => new Error(code);
async function absent(p) { try { return await fs.lstat(p); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } }
async function directory(p) {
  const s = await fs.lstat(p);
  if (!s.isDirectory() || s.isSymbolicLink()) throw fail('UNSAFE_ROOT');
}
async function owned(p, code) {
  await directory(p);
  const m = await fs.lstat(path.join(p, marker));
  if (!m.isFile() || m.isSymbolicLink() || m.size !== identity.length || await fs.readFile(path.join(p, marker), 'utf8') !== identity) throw fail(code);
}
export async function prepareScratch(p) {
  if (!path.isAbsolute(p)) throw fail('INVALID_PATH');
  if (await absent(p)) {
    await directory(p);
    try { await owned(p, 'UNOWNED_SCRATCH'); } catch { throw fail('UNOWNED_SCRATCH'); }
  } else {
    await directory(path.dirname(p));
    await fs.mkdir(p);
    await fs.writeFile(path.join(p, marker), identity, { flag: 'wx' });
  }
}
export async function removeGeneratedBins(tools) {
  const bins = path.join(tools, 'node_modules', '.bin');
  if (await absent(bins)) {
    await directory(bins);
    await fs.rm(bins, { recursive: true });
  }
}
export async function inspectTree(root) {
  let count = 0;
  const digest = createHash('sha256');
  async function walk(p, relative) {
    const s = await fs.lstat(p);
    if (s.isSymbolicLink() || (!s.isFile() && !s.isDirectory())) throw Object.defineProperty(fail('UNSAFE_TREE'), 'entry', { value: relative });
    if (s.isDirectory()) {
      for (const name of (await fs.readdir(p)).sort()) await walk(path.join(p, name), relative ? `${relative}/${name}` : name);
    } else { count++; digest.update(relative).update('\0').update(hash(await fs.readFile(p))).update('\0'); }
  }
  await walk(root, '');
  return { files: count, sha256: digest.digest('hex') };
}
export function validateFrozenManifest(manifest, lock) {
  const pkg = JSON.parse(manifest);
  if (pkg.name !== '@lawoss/engine-runtime-tools' || pkg.packageManager !== 'pnpm@11.4.0' ||
      pkg.dependencies?.['@npmcli/config'] !== '10.8.1' || pkg.dependencies?.['@npmcli/arborist'] !== '9.4.0' ||
      hash(lock) !== '78b707c0f4ad96a49e52c14c63d594ddbe125f16dc7a09a7ab83d4f20b35ebc6') throw fail('FROZEN_MANIFEST_MISMATCH');
}
export async function validatePnpm(cli) {
  try {
    if (!path.isAbsolute(cli)) throw Error();
    const root = path.dirname(path.dirname(cli));
    const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
    if (pkg.name !== 'pnpm' || pkg.version !== '11.4.0' || pkg.bin?.pnpm !== 'bin/pnpm.mjs' ||
        await fs.realpath(cli) !== path.join(await fs.realpath(root), 'bin', 'pnpm.mjs') || !(await fs.stat(cli)).isFile()) throw Error();
    return cli;
  } catch { throw fail('INVALID_PNPM'); }
}
// Retain no raw stderr. Every success/failure waits for the actual close event.
export function closedChild(node, args, options = {}) {
  return new Promise((resolve, reject) => {
    let output = '', size = 0, primary;
    const child = spawn(node, args, { ...options, shell: false, stdio: ['ignore', 'pipe', 'pipe'] });
    const stop = code => { if (!primary) { primary = fail(code); child.kill('SIGKILL'); } };
    const timer = setTimeout(() => stop('CHILD_TIMEOUT'), 180000);
    child.on('error', () => { primary ??= fail('CHILD_FAILED'); });
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 65536) stop('CHILD_OUTPUT_LIMIT');
      else output += chunk.toString();
    });
    child.stderr.on('data', chunk => { size += chunk.length; if (size > 65536) stop('CHILD_OUTPUT_LIMIT'); });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (primary || code !== 0 || signal) reject(primary ?? fail('CHILD_FAILED'));
      else resolve(output.trim());
    });
  });
}
export function isolatedEnvironment(home) {
  const env = { HOME: home, USERPROFILE: home, APPDATA: path.join(home, 'AppData/Roaming'), LOCALAPPDATA: path.join(home, 'AppData/Local'),
    XDG_CONFIG_HOME: path.join(home, 'config'), XDG_CACHE_HOME: path.join(home, 'cache'), XDG_DATA_HOME: path.join(home, 'data'), XDG_STATE_HOME: path.join(home, 'state'),
    npm_config_userconfig: path.join(home, 'user.npmrc'), npm_config_globalconfig: path.join(home, 'global.npmrc'), npm_config_cache: path.join(home, 'cache'),
    COREPACK_ENABLE_NETWORK: '0', COREPACK_ENABLE_PROJECT_SPEC: '0', CI: 'true' };
  for (const key of ['SystemRoot', 'SYSTEMROOT', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP']) if (process.env[key]) env[key] = process.env[key];
  return env;
}
export function retainCleanupFailure(primary, cleanup) {
  const previous = primary.cleanup;
  const value = previous === undefined ? cleanup : new AggregateError(
    previous instanceof AggregateError ? [...previous.errors, cleanup] : [previous, cleanup],
    'Runtime packaging cleanup failed');
  Object.defineProperty(primary, 'cleanup', { value, configurable: true });
  return primary;
}
// Publish only into an absent or recognized owned output. This is build-local,
// not a transaction against concurrent hostile mutation of trusted parents.
export async function publishRuntime(stage, out) {
  let backup;
  if (await absent(out)) {
    await owned(out, 'UNOWNED_OUTPUT');
    backup = `${stage}-previous`;
    if (await absent(backup)) throw fail('BACKUP_EXISTS');
    await fs.rename(out, backup);
  }
  try { await fs.rename(stage, out); }
  catch (primary) {
    if (backup) {
      try { await fs.rename(backup, out); }
      catch (cleanup) { retainCleanupFailure(primary, cleanup); }
    }
    throw primary;
  }
  if (backup) await fs.rm(backup, { recursive: true });
}
export async function packageRuntime({ node, pnpmCli, out, scratch, store, offline }) {
  if (typeof offline !== 'boolean') throw fail('NETWORK_POLICY_REQUIRED');
  if (!path.isAbsolute(node) || await closedChild(node, ['--version'], { env: isolatedEnvironment(path.dirname(node)) }) !== 'v24.21.0') throw fail('INVALID_NODE');
  await validatePnpm(pnpmCli);
  for (const p of [out, scratch, store]) if (typeof p !== 'string' || !path.isAbsolute(p)) throw fail('INVALID_PATH');
  const storeRelative = path.relative(scratch, store);
  if (!storeRelative || storeRelative.startsWith('..') || path.isAbsolute(storeRelative)) throw fail('UNOWNED_STORE');
  if ([scratch, store].some(p => { const r = path.relative(out, p); return !r || (!r.startsWith('..') && !path.isAbsolute(r)); })) throw fail('OVERLAPPING_PATHS');
  await prepareScratch(scratch);
  await directory(path.dirname(out));
  if (await absent(out)) { try { await owned(out, 'UNOWNED_OUTPUT'); } catch { throw fail('UNOWNED_OUTPUT'); } }
  await fs.mkdir(store, { recursive: true });
  await directory(store);
  const stage = await fs.mkdtemp(path.join(path.dirname(out), '.runtime-stage-'));
  const home = await fs.mkdtemp(path.join(scratch, 'installer-'));
  let published = false, primary;
  try {
    for (const name of ['user.npmrc', 'global.npmrc']) await fs.writeFile(path.join(home, name), '');
    const env = isolatedEnvironment(home);
    if (await closedChild(node, [pnpmCli, '--version'], { env, cwd: home }) !== '11.4.0') throw fail('INVALID_PNPM');
    const sourceHashes = {};
    for (const name of files) {
      const bytes = await fs.readFile(path.join(source, name));
      sourceHashes[name] = hash(bytes);
      await fs.mkdir(path.dirname(path.join(stage, name)), { recursive: true });
      await fs.writeFile(path.join(stage, name), bytes);
    }
    const tools = path.join(stage, 'runtime-tools');
    validateFrozenManifest(await fs.readFile(path.join(tools, 'package.json'), 'utf8'), await fs.readFile(path.join(tools, 'pnpm-lock.yaml')));
    await closedChild(node, [pnpmCli, '--dir', tools, 'install', '--ignore-workspace', '--ignore-scripts', '--frozen-lockfile', '--prod=false',
      '--registry=https://registry.npmjs.org', '--config.node-linker=hoisted', '--config.package-import-method=copy', '--config.bin-links=false',
      '--config.manage-package-manager-versions=false', `--store-dir=${store}`, ...(offline ? ['--offline'] : [])], { cwd: home, env });
    for (const name of ['package.json', 'pnpm-lock.yaml']) if (hash(await fs.readFile(path.join(tools, name))) !== sourceHashes[`runtime-tools/${name}`]) throw fail('MANIFEST_CHANGED');
    for (const [name, version] of [['@npmcli/config', '10.8.1'], ['@npmcli/arborist', '9.4.0']]) {
      const pkg = JSON.parse(await fs.readFile(path.join(tools, 'node_modules', name, 'package.json'), 'utf8'));
      if (pkg.name !== name || pkg.version !== version) throw fail('TOOLING_UNAVAILABLE');
    }
    // pnpm's generated layout metadata is build-local, not a runtime dependency.
    for (const name of ['.modules.yaml', '.pnpm-workspace-state-v1.json']) await fs.rm(path.join(tools, 'node_modules', name), { force: true });
    // pnpm 11 hoisted still emits root bin shims despite bin-links=false.
    // They are installer metadata, never used by the module-relative resolver.
    await removeGeneratedBins(tools);
    const closure = await inspectTree(stage);
    await fs.writeFile(path.join(stage, marker), identity);
    await fs.writeFile(path.join(stage, 'build-manifest.json'), `${JSON.stringify({ schema: 1, sourcePin: '16747470f976aca3d362ad730bcd3fe82ecc2c9a', node: '24.21.0', pnpm: '11.4.0', offline, sourceHashes, closure }, null, 2)}\n`);
    await publishRuntime(stage, out);
    published = true;
    return { schema: 1, status: 'packaged', ...closure, node: '24.21.0', pnpm: '11.4.0' };
  } catch (e) { primary = e; throw e; }
  finally {
    try { if (!published) await fs.rm(stage, { recursive: true, force: true }); await fs.rm(home, { recursive: true, force: true }); }
    catch (cleanup) { if (!primary) throw fail('CLEANUP_FAILED'); retainCleanupFailure(primary, cleanup); }
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const [out, scratch, store, pnpmCli, policy] = process.argv.slice(2);
  try {
    if (!['offline', 'online'].includes(policy)) throw fail('NETWORK_POLICY_REQUIRED');
    console.log(JSON.stringify(await packageRuntime({ node: process.execPath, pnpmCli, out, scratch, store, offline: policy === 'offline' })));
  } catch { console.error('RUNTIME_PACKAGE_FAILED'); process.exitCode = 1; }
}
