import { mkdir, lstat, realpath, readFile, writeFile, rm, rename, rmdir } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fail, verifyPayload, inventory } from './validate.mjs';
export { INPUT, validateInputs } from './validate.mjs';

const networkDisabled = () => globalThis[Symbol.for('lawoss.payload.networkDisabled')] === true || process.env.LAWOSS_PAYLOAD_OFFLINE_ONLY === '1';
export function candidatePreflight(acceptedLockExists) {
  if (acceptedLockExists) fail('CANDIDATE_EXISTS');
  if (networkDisabled()) fail('NETWORK_DISABLED');
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const absent = async name => { try { await lstat(name); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
async function canonicalDirectory(directory) {
  if (!path.isAbsolute(directory) || directory !== path.normalize(directory) || directory.split(path.sep).some(part => part === '.' || part === '..')) fail('WORKSPACE_INVALID');
  let current = path.parse(directory).root;
  for (const part of directory.slice(current.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) fail('WORKSPACE_INVALID');
  }
  if (await realpath(directory) !== directory) fail('WORKSPACE_INVALID');
}
export async function initialize(workspace) {
  await canonicalDirectory(path.dirname(workspace));
  if (workspace !== path.resolve(workspace) || !(await absent(workspace))) fail('WORKSPACE_INVALID');
  await mkdir(workspace, { mode: 0o700 });
  const stat = await lstat(workspace);
  await writeFile(path.join(workspace, '.owner.json'), JSON.stringify({ schema: 1, token: randomUUID(), dev: stat.dev, ino: stat.ino }), { flag: 'wx', mode: 0o600 });
  for (const name of ['home', 'cache']) await mkdir(path.join(workspace, name), { mode: 0o700 });
  await writeFile(path.join(workspace, 'empty-npmrc'), '', { flag: 'wx' });
}
export async function verifyWorkspace(workspace) {
  try {
    await canonicalDirectory(workspace);
    const file = path.join(workspace, '.owner.json');
    const ownerStat = await lstat(file);
    if (!ownerStat.isFile() || ownerStat.nlink !== 1 || ownerStat.size > 512) fail('WORKSPACE_INVALID');
    const owner = JSON.parse(await readFile(file, 'utf8'));
    const stat = await lstat(workspace);
    if (owner.schema !== 1 || !/^[a-f0-9-]{36}$/.test(owner.token) || stat.ino !== owner.ino || stat.dev !== owner.dev) fail('WORKSPACE_INVALID');
    for (const name of ['home', 'cache']) await canonicalDirectory(path.join(workspace, name));
  } catch { fail('WORKSPACE_INVALID'); }
}
export function childEnvironment(workspace) {
  return {
    PATH: `${path.dirname(process.execPath)}${path.delimiter}/usr/bin${path.delimiter}/bin`,
    HOME: path.join(workspace, 'home'), USERPROFILE: path.join(workspace, 'home'),
    APPDATA: path.join(workspace, 'home/AppData/Roaming'), LOCALAPPDATA: path.join(workspace, 'home/AppData/Local'),
    XDG_CONFIG_HOME: path.join(workspace, 'home/config'), XDG_CACHE_HOME: path.join(workspace, 'home/cache'), XDG_DATA_HOME: path.join(workspace, 'home/data'),
    TMPDIR: workspace, TEMP: workspace, TMP: workspace,
    npm_config_userconfig: path.join(workspace, 'empty-npmrc'), npm_config_globalconfig: path.join(workspace, 'empty-npmrc'),
    npm_config_cache: path.join(workspace, 'cache'), npm_config_registry: 'https://registry.npmjs.org/',
    CI: 'true', NO_COLOR: '1',
    ...(networkDisabled() ? { LAWOSS_PAYLOAD_OFFLINE_ONLY: '1' } : {}),
    ...(process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot } : {}),
  };
}
export async function transaction(workspace, outputName, operation) {
  await verifyWorkspace(workspace);
  if (!/^[a-z][a-z0-9-]{0,47}$/.test(outputName) || ['home', 'cache'].includes(outputName)) fail('OUTPUT_INVALID');
  const output = path.join(workspace, outputName);
  const admission = path.join(workspace, `.admit-${outputName}`);
  try { await mkdir(admission); } catch (error) { if (error.code === 'EEXIST') fail('OUTPUT_BUSY'); throw error; }
  const admissionIdentity = await lstat(admission);
  const stage = path.join(workspace, `.stage-${randomUUID()}`);
  let identity;
  try {
    if (!(await absent(output))) fail('OUTPUT_EXISTS');
    await mkdir(stage, { mode: 0o700 });
    identity = await lstat(stage);
    await operation(stage);
    const currentStage = await lstat(stage);
    if (!currentStage.isDirectory() || currentStage.isSymbolicLink() || currentStage.ino !== identity.ino || currentStage.dev !== identity.dev) fail('PUBLICATION_INVALID');
    const receipt = await lstat(path.join(stage, 'payload-manifest.json')).catch(() => null);
    if (!receipt?.isFile()) fail('PUBLICATION_INVALID');
    if (!(await absent(output))) fail('OUTPUT_EXISTS');
    await rename(stage, output);
    identity = null;
    return output;
  } finally {
    // Never remove a substituted stage, existing output, cache, or another writer's admission.
    if (identity) {
      const now = await lstat(stage).catch(() => null);
      if (now?.ino === identity.ino && now.dev === identity.dev && now.isDirectory() && !now.isSymbolicLink()) await rm(stage, { recursive: true, force: true }).catch(() => {});
    }
    const currentAdmission = await lstat(admission).catch(() => null);
    if (currentAdmission?.ino === admissionIdentity.ino && currentAdmission.dev === admissionIdentity.dev && currentAdmission.isDirectory() && !currentAdmission.isSymbolicLink()) await rmdir(admission).catch(() => {});
  }
}
export async function runChild(args, workspace, { signal, offline = true, timeout = 180000, executable = process.execPath, runtime = 'node', json = true, validationWorkspace } = {}) {
  if (signal?.aborted) fail('CANCELLED');
  if (!['node', 'bun'].includes(runtime) || !path.isAbsolute(executable)) fail('CHILD_INVALID');
  const denyNetwork = offline || networkDisabled();
  if (runtime === 'bun' && !denyNetwork) fail('CHILD_INVALID');
  return new Promise((resolve, reject) => {
    const child = spawn(executable, [...(denyNetwork ? runtime === 'bun' ? ['--preload', path.join(HERE, 'network-guard.mjs')] : ['--import', pathToFileURL(path.join(HERE, 'network-guard.mjs')).href] : []), ...args], { cwd: workspace, env: { ...childEnvironment(workspace), ...(validationWorkspace === workspace ? { PAYLOAD_VALIDATION_WORKSPACE: workspace } : {}) }, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe'] });
    let reason;
    let bytes = 0;
    let output = '';
    let diagnostics = '';
    let killer;
    const stop = code => {
      if (reason) return;
      reason = code;
      const kill = signal => { try { if (process.platform === 'win32') child.kill(signal); else process.kill(-child.pid, signal); } catch (error) { if (error.code !== 'ESRCH') throw error; } };
      if (exited) { child.stdout.destroy(); child.stderr.destroy(); }
      else {
        kill('SIGTERM');
        killer = setTimeout(() => { if (!exited) kill('SIGKILL'); }, 2000);
      }
    };
    const abort = () => stop('CANCELLED');
    const timer = setTimeout(() => stop('OPERATION_TIMEOUT'), timeout);
    signal?.addEventListener('abort', abort, { once: true });
    for (const stream of [child.stdout, child.stderr]) stream.on('data', chunk => { bytes += chunk.length; if (bytes > 65536) stop('CHILD_OUTPUT_LIMIT'); else if (stream === child.stdout) output += chunk; else diagnostics += chunk; });
    let exited = false;
    child.on('exit', () => { exited = true; });
    let spawnError;
    child.on('error', error => { spawnError = error; });
    child.on('close', code => {
      clearTimeout(timer); clearTimeout(killer); signal?.removeEventListener('abort', abort);
      let projection;
      try { projection = JSON.parse(diagnostics.trim()); } catch {}
      const safeCode = /^[A-Z_]{1,40}$/.test(projection?.code) ? projection.code : 'CHILD_FAILED';
      if (reason || spawnError || code !== 0) reject(Object.assign(new Error(reason ?? safeCode), { code: reason ?? safeCode, child: { closed: true, exitCode: code, signal: child.signalCode, descendants: 'unknown' }, ...(!json ? { output } : {}) }));
      else { let result = output; if (json) { try { result = JSON.parse(output.trim()); } catch { result = undefined; } } resolve(result); }
    });
  });
}
export async function prepare({ workspace, mode = 'replay', outputName = 'payload', signal } = {}) {
  if (process.version !== 'v24.21.0') fail('NODE_VERSION');
  if (!['candidate', 'replay'].includes(mode)) fail('MODE_INVALID');
  if (signal?.aborted) fail('CANCELLED');
  if (mode === 'candidate') candidatePreflight(!(await absent(path.join(HERE, 'sdk/package-lock.json'))));
  // A failed one-shot primer can never supply replay, even with partial valid bytes.
  await verifyWorkspace(workspace);
  const acquisition = path.join(workspace, 'acquisition.json');
  if (!(await absent(acquisition))) {
    const stat = await lstat(acquisition);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 4096) fail('CACHE_INCOMPLETE');
    let receipt; try { receipt = JSON.parse(await readFile(acquisition)); } catch { fail('CACHE_INCOMPLETE'); }
    if (receipt.schema !== 1 || receipt.outcome !== 'complete') fail('CACHE_INCOMPLETE');
  }
  return transaction(workspace, outputName, async stage => {
    await inventory(path.join(workspace, 'cache'));
    await runChild([path.join(HERE, 'worker.mjs'), workspace, stage, mode], workspace, { offline: mode === 'replay', signal });
    const probe = path.join(stage, '.payload-import-check.mjs');
    await writeFile(probe, await readFile(path.join(HERE, 'import-check.mjs')), { flag: 'wx' });
    let imports;
    let importFailure;
    try { imports = await runChild([probe, stage], workspace, { signal }); }
    catch (error) { importFailure = error; throw error; }
    finally { await rm(probe).catch(error => { if (!importFailure) throw error; }); }
    const file = path.join(stage, 'payload-manifest.json');
    const manifest = JSON.parse(await readFile(file));
    manifest.imports = imports;
    await writeFile(file, `${JSON.stringify(manifest, null, 2)}\n`);
    await verifyPayload(stage);
    if (signal?.aborted) fail('CANCELLED');
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [mode, workspace, outputName, ...extra] = process.argv.slice(2);
  try {
    if (extra.length || !workspace || !['init', 'candidate', 'replay'].includes(mode) || (mode === 'init' && outputName)) fail('ARGUMENT_INVALID');
    const controller = new AbortController();
    const cancel = () => controller.abort();
    process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
    try {
      if (mode === 'init') await initialize(workspace);
      else await prepare({ workspace, mode, outputName: outputName ?? 'payload', signal: controller.signal });
    } finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
    console.log(JSON.stringify({ status: 'complete', mode }));
  } catch (error) {
    console.error(JSON.stringify({ status: 'failed', code: /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'PREPARATION_FAILED' }));
    process.exitCode = 1;
  }
}
