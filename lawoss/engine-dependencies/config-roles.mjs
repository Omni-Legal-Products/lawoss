import path from 'node:path';
import fs from 'node:fs/promises';
import { realpath } from 'node:fs';
import { promisify } from 'node:util';
import { spawn } from 'node:child_process';

const nativeRealpath = promisify(realpath.native);
const OUTPUT_BYTES = 64 * 1024;
const resourceCodes = new Set(['EMFILE', 'ENFILE', 'ENOMEM', 'ENOSPC', 'EAGAIN']);

export class ConfigRoleDiscoveryError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ConfigRoleDiscoveryError';
    this.code = code;
  }
}
const failure = code => new ConfigRoleDiscoveryError(code);
function resourceError(error) {
  if (resourceCodes.has(error?.code)) throw failure('RESOURCE_EXHAUSTED');
}

// One absolute wall-clock deadline covers metadata and every query. Only metadata
// awaits may race cancellation; a Git query must settle after its owned child closes.
function budget(deadline, callerSignal) {
  const controller = new AbortController();
  const stop = code => { if (!controller.signal.aborted) controller.abort(failure(code)); };
  const onAbort = () => stop('ABORTED');
  const check = () => {
    if (callerSignal?.aborted) onAbort();
    if (Date.now() >= deadline) stop('BUDGET_EXCEEDED');
    if (controller.signal.aborted) throw controller.signal.reason;
  };
  callerSignal?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => stop('BUDGET_EXCEEDED'), Math.max(0, deadline - Date.now()));
  return {
    signal: controller.signal,
    check,
    async metadata(operation) {
      check();
      let onCancel;
      const cancelled = new Promise((_, reject) => {
        onCancel = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', onCancel, { once: true });
      });
      try {
        const result = await Promise.race([Promise.resolve().then(operation), cancelled]);
        check();
        return result;
      } catch (error) { check(); resourceError(error); throw error; }
      finally { controller.signal.removeEventListener('abort', onCancel); }
    },
    dispose() { clearTimeout(timer); callerSignal?.removeEventListener('abort', onAbort); },
  };
}

async function exists(filename) {
  try { await fs.access(filename); return true; }
  catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return false;
    throw error;
  }
}

// Fixed read-only Git queries only. Never retain or report raw stderr. On refusal,
// kill the exact owned direct child, then await 'close' (not just 'exit').
function gitQuery({ cwd, args, environment, signal }) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn('git', args, { cwd, env: environment, windowsHide: true, stdio: ['ignore', 'pipe', 'ignore'] }); }
    catch (error) { reject(error); return; }
    let primary;
    let terminationRequested = false;
    let size = 0;
    const chunks = [];
    const terminate = error => {
      primary ??= error;
      if (!terminationRequested && child.exitCode === null && child.signalCode === null) {
        terminationRequested = true;
        child.kill('SIGKILL');
      }
    };
    const onAbort = () => terminate(signal.reason);
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) onAbort();
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > OUTPUT_BYTES) { terminate(failure('GIT_OUTPUT_LIMIT')); return; }
      if (!primary) chunks.push(chunk);
    });
    child.stdout.on('error', error => terminate(error));
    child.once('error', error => { primary ??= error; });
    child.once('close', code => {
      signal.removeEventListener('abort', onAbort);
      if (primary) reject(primary);
      else resolve({ exitCode: code ?? 1, text: Buffer.concat(chunks).toString('utf8') });
    });
  });
}

/**
 * Discover pinned-engine roles for ONE captured, current managed-local instance.
 * No directories are created, contents read or dependencies prepared.
 * deadline is an unchanged absolute Date.now() deadline; all inputs are captured
 * before the first await. Adapters are narrow metadata/Git seams, not installers.
 */
export async function discoverConfigRoles(input = {}, adapters = {}) {
  input ??= {};
  const { instanceDirectory, engineCwd, homeDirectory, deadline, signal } = input;
  const environment = Object.freeze({ ...input.environment });
  const p = adapters.pathModel?.path ?? path;
  const platform = adapters.pathModel?.platform ?? process.platform;
  const filesystem = { realpath: fs.realpath, realpathNative: nativeRealpath, exists, ...adapters.filesystem };
  const query = adapters.gitQuery ?? gitQuery;
  if (typeof instanceDirectory !== 'string' || typeof engineCwd !== 'string' || !p.isAbsolute(engineCwd)
    || (platform === 'win32' && !/^(?:[a-zA-Z]:[\\/]|[\\/]{2})/.test(engineCwd))
    || (signal !== undefined && !(signal instanceof AbortSignal))
    || typeof homeDirectory !== 'string' || !Number.isFinite(deadline) || deadline - Date.now() > 2 ** 31 - 1
    || !input.environment || Object.values(environment).some(value => value !== undefined && typeof value !== 'string')) {
    throw failure('INVALID_INPUT');
  }
  const scope = budget(deadline, signal);
  const windowsPath = value => platform !== 'win32' ? value : value
    .replace(/^\/([a-zA-Z]):(?:[\\/]|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
    .replace(/^\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
    .replace(/^\/cygdrive\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`)
    .replace(/^\/mnt\/([a-zA-Z])(?:\/|$)/, (_, drive) => `${drive.toUpperCase()}:/`);
  // node:path.win32.resolve otherwise consults live =D: / process.cwd for
  // cross-drive relative strings. Use the captured child's drive cwd (or its
  // drive root fallback) before calling path.resolve with an absolute anchor.
  function resolveCaptured(cwd, value) {
    if (platform !== 'win32' || !/^[a-zA-Z]:(?![\\/])/.test(value)) return p.resolve(cwd, value);
    const drive = value.slice(0, 2);
    if (cwd.slice(0, 2).toLowerCase() === drive.toLowerCase()) return p.resolve(cwd, value);
    const driveKey = `=${drive}`.toLowerCase();
    const driveCwd = Object.entries(environment).find(([key]) => key.toLowerCase() === driveKey)?.[1];
    const anchor = driveCwd || `${drive}\\`;
    if (!p.isAbsolute(anchor) || anchor.slice(0, 2).toLowerCase() !== drive.toLowerCase()) {
      throw failure('INVALID_INPUT');
    }
    return p.resolve(anchor, value);
  }
  const physical = value => resolveCaptured(engineCwd, value);
  const metadata = operation => scope.metadata(operation);
  async function up(start, target, stop) {
    const found = [];
    let current = start;
    while (true) {
      scope.check();
      const candidate = p.join(current, target);
      if (await metadata(() => filesystem.exists(physical(candidate)))) found.push(candidate);
      if (current === stop) break;
      const parent = p.dirname(current);
      if (parent === current) break;
      current = parent;
    }
    return found;
  }
  async function canonical(value) {
    const resolved = resolveCaptured(engineCwd, windowsPath(value));
    let result;
    try { result = await metadata(() => filesystem.realpath(resolved)); }
    catch (error) { if (error.code !== 'ENOENT') throw error; result = resolved; }
    if (platform !== 'win32') return result;
    const normalized = resolveCaptured(engineCwd, windowsPath(result));
    try { return await metadata(() => filesystem.realpathNative(normalized)); }
    catch (error) { if (error instanceof ConfigRoleDiscoveryError) throw error; return normalized; }
  }
  function resolveGitPath(cwd, value) {
    const trimmed = value.replace(/[\r\n]+$/, '');
    if (!trimmed) return cwd;
    const normalized = windowsPath(trimmed);
    return p.isAbsolute(normalized) ? p.normalize(normalized) : resolveCaptured(cwd, normalized);
  }
  async function queryAt(cwd, flag) {
    scope.check();
    try {
      const result = await query({ cwd, args: ['rev-parse', flag], environment, signal: scope.signal, deadline });
      scope.check();
      if (!result || typeof result.text !== 'string' || !Number.isInteger(result.exitCode)) throw failure('GIT_QUERY_INVALID');
      if (Buffer.byteLength(result.text, 'utf8') > OUTPUT_BYTES) throw failure('GIT_OUTPUT_LIMIT');
      return result;
    } catch (error) {
      if (error instanceof ConfigRoleDiscoveryError) throw error;
      scope.check();
      resourceError(error);
      // Pinned Git.run converts ordinary command errors (including missing Git)
      // to exit1; it still executes the remaining discovery queries.
      return { exitCode: 1, text: '' };
    }
  }
  try {
    scope.check();
    const directory = await canonical(instanceDirectory);
    let marker;
    try { marker = (await up(directory, '.git'))[0]; }
    catch (error) {
      resourceError(error);
      if (error instanceof ConfigRoleDiscoveryError) throw error;
      // Git.repo.discover catches marker metadata errors as no repository.
    }
    let worktree = p.parse(directory).root;
    if (marker) {
      const cwd = p.dirname(marker);
      const topLevel = await queryAt(cwd, '--show-toplevel');
      const gitDir = await queryAt(cwd, '--git-dir');
      const commonDir = await queryAt(cwd, '--git-common-dir');
      if (gitDir.exitCode === 0 && commonDir.exitCode === 0) {
        worktree = topLevel.exitCode === 0 ? resolveGitPath(cwd, topLevel.text) : cwd;
      }
    }
    const configHome = environment.XDG_CONFIG_HOME || (homeDirectory ? p.join(homeDirectory, '.config') : undefined);
    // xdg5.1 returns undefined without a native home or truthy override; join
    // cannot produce a legitimate G in that case, so refuse explicitly.
    if (configHome === undefined) throw failure('INVALID_INPUT');
    const candidates = [{ path: p.join(configHome, 'opencode'), role: 'global' }];
    const flag = environment.OPENCODE_DISABLE_PROJECT_CONFIG?.toLowerCase();
    if (flag !== 'true' && flag !== '1') {
      candidates.push(...(await up(directory, '.opencode', worktree)).map(value => ({ path: value, role: 'project' })));
    }
    const home = environment.OPENCODE_TEST_HOME ?? homeDirectory;
    candidates.push(...(await up(home, '.opencode', home)).map(value => ({ path: value, role: 'home' })));
    if (environment.OPENCODE_CONFIG_DIR) candidates.push({ path: environment.OPENCODE_CONFIG_DIR, role: 'explicit' });
    const unique = new Map();
    for (const candidate of candidates) {
      const record = unique.get(candidate.path);
      if (record) { if (!record.roles.includes(candidate.role)) record.roles.push(candidate.role); }
      else unique.set(candidate.path, { path: candidate.path, physicalPath: physical(candidate.path), roles: [candidate.role] });
    }
    scope.check();
    return { directory, worktree, roles: [...unique.values()] };
  } catch (error) {
    if (error instanceof ConfigRoleDiscoveryError) throw error;
    scope.check();
    resourceError(error);
    throw failure('FILESYSTEM_FAILED');
  } finally { scope.dispose(); }
}
