// Genuine Electron RUN_AS_NODE entry. Default/import is inert; no main/renderer import.
import path from 'node:path';
import * as fs from 'node:fs/promises';
import childProcess from 'node:child_process';
import * as moduleApi from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import http from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import { REPO, FIXED, LIMITS, fail, admit, createReceipt, encodeReceipt, ordinaryFile, PLUGINS, sourceIdentity, distIdentity, recordIdentityFailure } from './windows-app-start-repro.mjs';
import { syntheticEnv, observeSpawn, awaitClosed, boundedResponse, verifyEngine, sha256, emptyState } from './windows-instance-repro.mjs';
import { awaitDirectoryInstance } from '../isir/native/startup-readiness.mjs';
import { BRIDGE, exactResolver, createObservation } from './windows-app-start-embedded-observer.mjs';
export function privateEnvironment(root, url, ambient = {}) {
  const p = /^[A-Za-z]:[\\/]/.test(root) ? path.win32 : path;
  // Exactly one case-insensitive PATH spelling; never spread inherited providers.
  const osKeys = {};
  for (const key of ['SystemRoot', 'WINDIR', 'COMSPEC', 'PATHEXT', 'PATH']) {
    const found = Object.keys(ambient).find(k => k.toLowerCase() === key.toLowerCase());
    if (found) osKeys[key] = ambient[found];
  }
  const env = syntheticEnv(root, url, osKeys);
  // syntheticEnv uses the native host path API; pure topology tests use Windows paths.
  if (p === path.win32 && process.platform !== 'win32') for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMP', 'TEMP', 'TMPDIR', 'OPENCODE_DB', 'LAWOSS_MODELS_CATALOG']) env[key] = env[key].replaceAll('/', '\\');
  return {
    ...env,
    LEGALWORK_DEV_MODE: '1',
    LEGALWORK_ELECTRON_USERDATA: p.join(root, 'profile'),
    LEGALWORK_DATA_DIR: p.join(root, 'runtime'),
    LEGALWORK_SERVER_CONFIG: p.join(root, 'runtime', 'server.json'),
    LEGALWORK_RUNTIME_DB: p.join(root, 'runtime', 'runtime.db'),
    LEGALWORK_ENV_STORE: p.join(root, 'empty-env.json'),
    LEGALWORK_WORD_ADDIN: '0',
    LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY: '1'
  };
}
export function replaceEnvironment(env) {
  for (const key of Object.keys(process.env)) delete process.env[key];
  Object.assign(process.env, env);
}
export async function observeNormalStop({
  stop,
  observation,
  timeoutMs = LIMITS.stop
}) {
  let timer,
    managerRejected = false;
  const settled = Promise.resolve().then(stop).catch(() => {
    managerRejected = true;
  });
  try {
    const completed = await Promise.race([settled.then(() => true), new Promise(resolve => {
      timer = setTimeout(() => resolve(false), timeoutMs);
    })]);
    const s = observation?.state;
    return Object.freeze({
      closed: completed && !managerRejected && s?.starts === 1 && s.startRejected === 0 && s.stops === 1 && s.fulfilled === 1 && s.rejected === 0 && s.pending === 0,
      pending: !completed || Boolean(s?.pending),
      rejected: managerRejected || Boolean(s?.rejected)
    });
  } finally {
    clearTimeout(timer);
  }
}
export async function withObservation({
  runtimeURL,
  targetURL,
  work,
  register = moduleApi.registerHooks,
  observation,
  release = () => true,
  onRestore = () => {}
}) {
  const prior = globalThis[BRIDGE];
  let hook;
  try {
    if (prior) throw fail('REFUSED');
    const realStart = async options => (await import(targetURL)).startEmbeddedServer(options);
    const observer = observation ?? createObservation(realStart);
    globalThis[BRIDGE] = {
      target: targetURL,
      observation: observer
    };
    hook = register({
      resolve: exactResolver({
        parent: runtimeURL,
        target: targetURL,
        observer: new URL('./windows-app-start-embedded-observer.mjs', import.meta.url).href
      })
    });
    onRestore(restore);
    return await work(observer);
  } finally {
    if (!hook || release()) restore();
  }
  function restore() {
    hook?.deregister();
    hook = undefined;
    if (prior === undefined) delete globalThis[BRIDGE];else globalThis[BRIDGE] = prior;
  }
}
export function quarantine(state) {
  const originalConsole = Object.fromEntries(['log', 'info', 'warn', 'error', 'debug', 'trace', 'dir', 'table', 'assert', 'time', 'timeEnd', 'timeLog', 'group', 'groupCollapsed', 'groupEnd', 'count', 'countReset'].map(k => [k, console[k]]));
  const stdout = process.stdout.write,
    stderr = process.stderr.write;
  let frozen = false;
  const counts = {
    bytes: state.consoleBytes,
    objects: state.consoleObjects
  };
  const sink = (...args) => {
    let bytes = 0;
    for (const value of args) {
      if (typeof value === 'string') bytes += Buffer.byteLength(value);else if (ArrayBuffer.isView(value) || value instanceof ArrayBuffer) bytes += value.byteLength;else counts.objects = Math.min(1001, counts.objects + 1);
    }
    counts.bytes = Math.min(65537, counts.bytes + bytes);
    if (!frozen) {
      state.consoleBytes = counts.bytes;
      state.consoleObjects = counts.objects;
    }
  };
  for (const key of Object.keys(originalConsole)) console[key] = sink;
  const write = function (bytes, encoding, callback) {
    sink(bytes);
    if (typeof encoding === 'function') encoding();
    if (typeof callback === 'function') callback();
    return true;
  };
  process.stdout.write = write;
  process.stderr.write = write;
  return {
    publish: bytes => Reflect.apply(stdout, process.stdout, [bytes]),
    freeze() {
      frozen = true;
    },
    counts,
    restore() {
      Object.assign(console, originalConsole);
      process.stdout.write = stdout;
      process.stderr.write = stderr;
    }
  };
}
async function providerStub() {
  let calls = 0,
    overflow = false;
  const server = http.createServer((request, response) => {
    calls = Math.min(1000, calls + 1);
    let bytes = 0;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 65536) {
        overflow = true;
        request.destroy();
      }
    });
    request.resume();
    response.writeHead(503, {
      'content-type': 'application/json'
    });
    response.end('{}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    count: () => calls,
    overflow: () => overflow,
    close: () => new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    })
  };
}
export function boundedDoctor({
  bin,
  doctor,
  spawnSync
}) {
  return function (command, args, options) {
    const exact = command === bin && Array.isArray(args) && (args.length === 1 && args[0] === '--version' || args.length === 2 && args[0] === 'serve' && args[1] === '--help');
    if (!exact) return Reflect.apply(spawnSync, this, [command, args, options]);
    doctor.calls++;
    try {
      const result = Reflect.apply(spawnSync, this, [command, args, {
        ...options,
        timeout: 15000,
        maxBuffer: 65536
      }]);
      if (Number.isInteger(result.status)) doctor.exited++;
      if (result.error?.code === 'ETIMEDOUT') doctor.timeout++;
      if (result.error?.code === 'ENOBUFS' || [result.stdout, result.stderr].some(value => value && Buffer.byteLength(value) > 65536)) doctor.overflow++;
      if (result.error || result.status !== 0) doctor.failed++;
      return result;
    } catch (error) {
      doctor.failed++;
      throw error;
    }
  };
}
export function trafficKind(url, origins, directory) {
  const parsed = new URL(url instanceof Request ? url.url : url);
  if (!origins.has(parsed.origin)) return 'other';
  if (parsed.pathname === '/global/health') return 'health';
  if (parsed.pathname === '/mcp' && parsed.searchParams.get('directory') === directory) return 'mcp';
  return 'other';
}
function inside(root, filename) {
  const relative = path.relative(root, filename ?? '');
  return path.isAbsolute(filename ?? '') && relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}
async function prerequisites(root, manifest) {
  if (process.platform !== 'win32' || process.arch !== 'x64' || process.versions.electron !== '43.7.5' || typeof moduleApi.registerHooks !== 'function' || typeof moduleApi.syncBuiltinESMExports !== 'function' || process.execPath !== manifest.electron.executable || !inside(process.env.RUNNER_TEMP ?? path.dirname(root), root)) throw fail('PREREQUISITE_FAILED');
  if (manifest.source !== (await sourceIdentity()) || !isDeepStrictEqual(manifest.dist, await distIdentity())) throw fail('PREREQUISITE_FAILED');
  if (JSON.stringify(await ordinaryFile(process.execPath, path.dirname(process.execPath), 512 * 1024 * 1024)) !== JSON.stringify(manifest.electron.identity)) throw fail('PREREQUISITE_FAILED');
}
async function probe(root, manifest) {
  await prerequisites(root, manifest);
  const sqlite = await import('node:sqlite'),
    filename = path.join(root, 'probe.db');
  const db = new sqlite.DatabaseSync(filename);
  try {
    const row = db.prepare('SELECT 1 AS value').get();
    if (row.value !== 1) throw fail('PREREQUISITE_FAILED');
  } finally {
    db.close();
  }
  await fs.rm(filename); // ordinary close/remove while same host lives
  const hook = moduleApi.registerHooks({
    resolve(specifier, context, next) {
      return next(specifier, context);
    }
  });
  try {
    moduleApi.syncBuiltinESMExports();
    await import(pathToFileURL(path.join(REPO, 'apps/server/dist/embedded.js')).href);
    await import(pathToFileURL(path.join(REPO, 'apps/desktop/electron/workspace-store.mjs')).href);
    await import(pathToFileURL(path.join(REPO, 'apps/desktop/electron/runtime.mjs')).href);
  } finally {
    hook.deregister();
  }
  return {
    electron: process.versions.electron,
    node: process.versions.node,
    features: true,
    sqlite: true,
    imports: true
  };
}
async function inspectInputs({
  root,
  directory,
  bin,
  captured,
  manifest,
  r
}) {
  if (!captured) throw fail('IDENTITY_FAILED');
  const {
      options
    } = captured,
    env = options.env,
    dev = path.join(root, 'profile', 'legalwork-dev-data');
  r.input.env = env.HOME === path.join(dev, 'home') && env.USERPROFILE === env.HOME && env.OPENCODE_TEST_HOME === env.HOME && env.XDG_CONFIG_HOME === path.join(dev, 'xdg/config') && env.XDG_DATA_HOME === path.join(dev, 'xdg/data') && env.XDG_CACHE_HOME === path.join(dev, 'xdg/cache') && env.XDG_STATE_HOME === path.join(dev, 'xdg/state') && env.OPENCODE_CONFIG_DIR === path.join(dev, 'config/opencode') && !('ELECTRON_RUN_AS_NODE' in env) && env.OPENCODE_DB === path.join(root, 'runtime/opencode.db');
  r.input.cwd = options.cwd === path.join(root, 'profile', 'managed-opencode-workdir') && options.cwd !== directory;
  await ordinaryFile(bin, root, 256 * 1024 * 1024);
  verifyEngine(await fs.readFile(bin));
  r.input.engine = true;
  if (!inside(root, env.OPENCODE_CONFIG)) throw fail('IDENTITY_FAILED');
  await ordinaryFile(env.OPENCODE_CONFIG, root);
  const config = JSON.parse(await fs.readFile(env.OPENCODE_CONFIG, 'utf8'));
  r.input.runtimeConfig = true;
  const plugins = config.plugin;
  if (!Array.isArray(plugins) || !plugins.includes('opencode-chrome-devtools') || !plugins.includes('opencode-anthropic-auth')) throw fail('IDENTITY_FAILED');
  const local = plugins.filter(value => typeof value === 'string' && value.startsWith('file:'));
  if (local.length !== 15) throw fail('IDENTITY_FAILED');
  for (const name of PLUGINS) {
    const spec = local.find(value => path.basename(fileURLToPath(value)) === `${name}.js`);
    if (!spec) throw fail('IDENTITY_FAILED');
    const copy = await ordinaryFile(fileURLToPath(spec), root);
    const original = manifest.dist.find(row => row.name === `opencode-plugins/${name}.js`);
    if (!original || copy.sha256 !== original.sha256 || copy.size !== original.size) throw fail('IDENTITY_FAILED');
  }
  r.input.plugins = true;
  const shim = path.join(root, 'profile', 'node-shim', 'node.cmd');
  await ordinaryFile(shim, root);
  const text = await fs.readFile(shim, 'utf8');
  r.input.shim = text.includes(process.execPath) && text.includes('ELECTRON_RUN_AS_NODE=1');
  await ordinaryFile(path.join(directory, '.opencode', 'legalwork.json'), root);
  await ordinaryFile(path.join(directory, '.opencode', 'opencode.jsonc'), root);
  const {
    BUNDLED_WORKFLOW_FILES
  } = await import(pathToFileURL(path.join(REPO, 'apps/server/dist/core-skills.js')).href);
  const {
    globalSkillsDir
  } = await import(pathToFileURL(path.join(REPO, 'apps/server/dist/workspace-files.js')).href);
  for (const file of BUNDLED_WORKFLOW_FILES) {
    const target = path.join(globalSkillsDir(), file.path);
    const actual = await ordinaryFile(target, root);
    if (actual.sha256 !== sha256(Buffer.from(file.content, file.encoding))) throw fail('IDENTITY_FAILED');
  }
  for (const [cap, key] of [['devEnvironment', 'env'], ['distinctCwd', 'cwd'], ['runtimeConfig', 'runtimeConfig'], ['builtPlugins', 'plugins']]) if (r.input[key]) r.coverage[cap] = 'verified-observed';
  r.coverage.projectSeed = 'verified-observed';
  r.coverage.globalSeed = 'verified-observed';
  if (!Object.values(r.input).every(Boolean)) throw fail('IDENTITY_FAILED');
}
export function hostDecision(expiresAt, now = Date.now) {
  let expired = false;
  return {
    canRemove() {
      expired ||= now() >= expiresAt;
      return !expired;
    }
  };
}
export async function finalizeCase({
  r,
  startSettled,
  stopResult,
  children,
  provider,
  root,
  remove = fs.rm,
  close = awaitClosed,
  decision = hostDecision(Date.now() + LIMITS.hostMs)
}) {
  // A frozen local decision controls removal; no late producer continuation reaches it.
  const stopped = stopResult?.closed === true && startSettled;
  if (!stopped) r.cleanupFailure = stopResult?.pending ? 'STOP_PENDING' : 'STOP_FAILED';
  const pipes = await close(children, LIMITS.pipes);
  if (!pipes && r.cleanupFailure === 'NONE') r.cleanupFailure = 'PIPES_PENDING';
  try {
    await provider.close();
    r.provider.closed = true;
  } catch {
    if (r.cleanupFailure === 'NONE') r.cleanupFailure = 'PROVIDER_CLOSE_FAILED';
  }
  r.provider.calls = provider.count();
  r.provider.modelCalls = r.provider.calls;
  if (r.provider.calls && r.primary === 'NONE') r.primary = 'PROVIDER_CALLED';
  const released = stopped && pipes && r.provider.closed && r.doctor.calls === 0;
  if (!decision.canRemove() && r.primary === 'NONE') r.primary = 'HOST_PENDING';
  if (decision.canRemove() && stopped && pipes && r.provider.closed && r.acquisition.closed && r.doctor.calls === 0 && r.source.finalVerified && r.build.finalVerified && r.cleanupFailure === 'NONE' && r.identityFailure === 'NONE' && !['OUTPUT_LIMIT', 'BODY_LIMIT', 'IDENTITY_FAILED', 'SOURCE_MISMATCH', 'BUILD_MISMATCH'].includes(r.primary) && r.consoleBytes <= 65536 && r.consoleObjects <= 1000) {
    try {
      await remove(root, {
        recursive: true
      });
      r.rootsRemoved = true;
      r.cleanup = 'CLOSED';
    } catch {
      r.cleanupFailure = 'REMOVE_FAILED';
    }
  }
  return released;
}
export async function runEntry(root, manifest, r, dependencies = {}) {
  const preflight = dependencies.preflight ?? prerequisites;
  const verifyIdentity = dependencies.verifyIdentity ?? (async () => manifest.source === (await sourceIdentity()) && isDeepStrictEqual(manifest.dist, await distIdentity()));
  const decision = dependencies.decision ?? hostDecision(Date.now() + LIMITS.hostMs);
  const doctor = {
    ...r.doctor
  };
  let released = false,
    restoreHook;
  const start = performance.now(),
    directory = path.join(root, 'case space#%'),
    bin = path.join(root, 'opencode-x86_64-pc-windows-msvc.exe');
  let manager,
    provider,
    observation,
    captured,
    startSettled = false,
    startPending = false,
    selectedActive = false,
    finalized = false;
  const originalFetch = globalThis.fetch,
    originalSpawn = childProcess.spawn,
    originalSpawnSync = childProcess.spawnSync;
  let selectedDeadline = 0;
  const legacy = emptyState(),
    origins = new Set();
  const recordFailure = code => {
    if (!finalized && r.primary === 'NONE') r.primary = code;
  };
  const engineObserver = observeSpawn({
    bin,
    spawn: originalSpawn,
    state: legacy,
    onFailure: recordFailure
  });
  const observedSpawn = function (...args) {
    if (args[0] === bin) {
      captured = {
        options: args[2]
      };
      const port = args[1]?.[args[1].indexOf('--port') + 1];
      if (!/^\d+$/.test(port ?? '')) recordFailure('IDENTITY_FAILED');else origins.add(`http://127.0.0.1:${port}`);
    }
    return Reflect.apply(engineObserver.spawn, this, args);
  };
  const activeMcp = new Set();
  globalThis.fetch = async (url, options = {}) => {
    const kind = trafficKind(url, origins, directory),
      health = kind === 'health',
      mcp = kind === 'mcp';
    const phase = {
      overlap: false
    };
    if (mcp && !finalized) {
      if (r.mcp.requests >= 1000) throw fail('OUTPUT_LIMIT');
      r.mcp.requests++;
      activeMcp.add(phase);
      if (selectedActive) {
        r.mcp.overlap++;
        phase.overlap = true;
      }
    }
    let response;
    try {
      response = await originalFetch(url, options);
    } catch (error) {
      activeMcp.delete(phase);
      throw error;
    }
    if (health && !finalized) r.health.headers = true;
    if (mcp && !finalized) r.mcp.headers++;
    return boundedResponse(response, health ? 16384 : 65536, () => {
      if (finalized) return;
      if (health) r.health.body = true;
      if (mcp) {
        r.mcp.body++;
        activeMcp.delete(phase);
      }
    }, () => recordFailure('BODY_LIMIT'));
  };
  try {
    await preflight(root, manifest);
    provider = await (dependencies.provider ?? providerStub)();
    const env = privateEnvironment(root, provider.url, process.env);
    replaceEnvironment(env); // before ALL production imports/private spreads
    for (const key of ['HOME', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'XDG_STATE_HOME', 'TMP', 'LEGALWORK_ELECTRON_USERDATA', 'LEGALWORK_DATA_DIR']) await fs.mkdir(env[key], {
      recursive: true
    });
    await fs.mkdir(directory);
    await fs.mkdir(path.join(root, 'documents'));
    await fs.writeFile(env.LEGALWORK_ENV_STORE, JSON.stringify({
      variables: []
    }), {
      flag: 'wx',
      mode: 0o600
    });
    await fs.copyFile(path.join(REPO, 'lawoss/models-catalog/api.json'), env.LAWOSS_MODELS_CATALOG);
    const globalDir = path.join(root, 'profile', 'legalwork-dev-data', 'xdg/config/opencode');
    await fs.mkdir(globalDir, {
      recursive: true
    });
    await fs.writeFile(path.join(globalDir, 'opencode.json'), env.OPENCODE_CONFIG_CONTENT, {
      flag: 'wx'
    });
    const facadePaths = {
      userData: env.LEGALWORK_ELECTRON_USERDATA,
      sessionData: env.LEGALWORK_ELECTRON_USERDATA,
      appData: env.APPDATA,
      home: env.HOME,
      documents: path.join(root, 'documents'),
      exe: process.execPath
    };
    const app = {
      isPackaged: false,
      getPath(key) {
        if (!Object.hasOwn(facadePaths, key)) throw fail('REFUSED');
        return facadePaths[key];
      },
      focus() {
        throw fail('REFUSED');
      }
    };
    const runtimeURL = pathToFileURL(path.join(REPO, 'apps/desktop/electron/runtime.mjs')).href,
      targetURL = pathToFileURL(path.join(REPO, 'apps/server/dist/embedded.js')).href;
    childProcess.spawn = observedSpawn;
    childProcess.spawnSync = boundedDoctor({
      bin,
      doctor,
      spawnSync: originalSpawnSync
    });
    moduleApi.syncBuiltinESMExports();
    await withObservation({
      runtimeURL,
      targetURL,
      register: dependencies.register ?? moduleApi.registerHooks,
      release: () => false,
      onRestore: restore => {
        restoreHook = restore;
      },
      work: async observed => {
        observation = observed;
        const {
          createWorkspaceStore
        } = await (dependencies.loadStore ?? (() => import(pathToFileURL(path.join(REPO, 'apps/desktop/electron/workspace-store.mjs')).href)))();
        const store = createWorkspaceStore({
          app,
          defaultDenBaseUrl: '',
          defaultRequireSignin: false,
          forceRequireSignin: false
        });
        const entry = {
          id: 'ws_native_1',
          name: 'Synthetic case',
          path: directory,
          preset: 'starter',
          workspaceType: 'local',
          appFiles: 'inside'
        };
        await store.writeWorkspaceState({
          workspaces: [entry],
          selectedId: entry.id,
          activeId: entry.id,
          watchedId: entry.id
        });
        const registered = await store.readWorkspaceState();
        if (registered.workspaces.length !== 1 || registered.selectedId !== entry.id || registered.watchedId !== entry.id || (await store.listLocalWorkspacePaths())[0] !== directory) throw fail('IDENTITY_FAILED');
        r.registrationCount = 1;
        r.coverage.store = 'verified-observed';
        const {
          createRuntimeManager
        } = await (dependencies.loadRuntime ?? (() => import(runtimeURL)))();
        manager = createRuntimeManager({
          app,
          desktopRoot: path.join(REPO, 'apps/desktop'),
          getApprovalWindow: () => null,
          listLocalWorkspacePaths: () => store.listLocalWorkspacePaths(),
          listLocalWorkspaces: async () => (await store.readWorkspaceState()).workspaces.filter(w => w.workspaceType !== 'remote'),
          reconnectHostWorkspace: (workspace, previous) => store.reconnectHostWorkspace(workspace, previous),
          listLocalWorkspaceAppFiles: async () => (await store.readWorkspaceState()).workspaces.filter(w => w.workspaceType === 'local').map(w => ({
            path: w.path,
            appFiles: w.appFiles
          }))
        });
        let startTimer;
        const started = performance.now();
        const actualStart = manager.engineStart(directory, {
          runtime: 'direct',
          workspacePaths: [directory],
          appFiles: 'inside',
          opencodeBinPath: bin
        }).then(value => {
          startSettled = true;
          return value;
        }, error => {
          startSettled = true;
          throw error;
        });
        try {
          await Promise.race([actualStart, new Promise((_, reject) => {
            startTimer = setTimeout(() => {
              startPending = true;
              reject(fail('START_PENDING'));
            }, dependencies.startMs ?? LIMITS.appStartMs);
          })]);
        } finally {
          clearTimeout(startTimer);
          r.appStartMeasured = true;
          r.appStartMs = Math.round(performance.now() - started);
        }
        if (startPending || r.primary !== 'NONE') throw fail(r.primary === 'NONE' ? 'START_PENDING' : r.primary);
        const info = await manager.engineInfo(),
          server = await manager.legalworkServerInfo();
        if (!info.baseUrl || !info.opencodeUsername || !info.opencodePassword || info.projectDir !== directory || info.opencodeBinSource !== 'custom' || !server.baseUrl || !server.inProcess || !observation.handle || observation.state.starts !== 1) throw fail('IDENTITY_FAILED');
        r.coverage.httpHost = 'verified-observed';
        await inspectInputs({
          root,
          directory,
          bin,
          captured,
          manifest,
          r
        });
        const headers = {
          authorization: `Basic ${Buffer.from(`${info.opencodeUsername}:${info.opencodePassword}`).toString('base64')}`
        };
        const health = await globalThis.fetch(`${info.baseUrl}/global/health`, {
          headers,
          signal: AbortSignal.timeout(5000)
        });
        if (health.status !== 200) throw fail('HEALTH_FAILED');
        const payload = await health.json();
        if (payload.healthy !== true || payload.version !== '1.18.29') throw fail('HEALTH_FAILED');
        r.health.verified = true;
        selectedDeadline = Date.now() + LIMITS.selected;
        const at = performance.now();
        selectedActive = true;
        for (const phase of activeMcp) if (!phase.overlap) {
          r.mcp.overlap++;
          phase.overlap = true;
        }
        try {
          await awaitDirectoryInstance({
            request: globalThis.fetch,
            baseUrl: info.baseUrl,
            headers,
            directory,
            deadline: selectedDeadline,
            observe: event => {
              if (finalized) return;
              if (event === 'request') r.path.requests++;
              if (event === 'headers') r.path.headers = true;
              if (event === 'body') r.path.body = true;
              if (event === 'verified') r.path.verified = true;
            }
          });
        } finally {
          selectedActive = false;
          r.selectedMs = Math.round(performance.now() - at);
          r.selectedMeasured = true;
        }
      }
    });
  } catch (error) {
    if (error?.name === 'TimeoutError' && error?.message === 'Startup readiness budget expired' && selectedDeadline && Date.now() >= selectedDeadline) {
      r.path.timeout = true;
      recordFailure('PATH_TIMEOUT');
    } else recordFailure(CODE_SET.has(error?.diagnosticCode) ? error.diagnosticCode : selectedDeadline ? 'PATH_FAILED' : 'START_FAILED');
  } finally {
    if (r.consoleBytes > 65536 || r.consoleObjects > 1000) recordFailure('OUTPUT_LIMIT');
    const at = performance.now();
    let stopResult;
    try {
      stopResult = await observeNormalStop({
        stop: () => manager?.engineStop(),
        observation,
        timeoutMs: dependencies.stopMs ?? LIMITS.stop
      });
    } catch {
      stopResult = {
        closed: false,
        pending: false,
        rejected: true
      };
    }
    r.stopMeasured = true;
    r.stopMs = Math.round(performance.now() - at);
    if (observation) {
      const s = observation.state;
      r.stop = {
        invoked: s.stops,
        fulfilled: s.fulfilled,
        rejected: s.rejected,
        pending: s.pending
      };
    }
    try {
      if (!(await verifyIdentity())) throw fail('IDENTITY_FAILED');
      if (captured) await inspectInputs({
        root,
        directory,
        bin,
        captured,
        manifest,
        r
      });
      r.source.finalVerified = true;
      r.build.finalVerified = true;
    } catch {
      recordIdentityFailure(r, 'IDENTITY_FAILED');
    }
    r.doctor = doctor;
    if (provider) released = await finalizeCase({
      r,
      startSettled: startSettled && !startPending,
      stopResult,
      children: engineObserver.children,
      provider,
      root,
      decision,
      remove: dependencies.remove ?? fs.rm,
      close: dependencies.close ?? awaitClosed
    });else r.cleanupFailure = 'STOP_FAILED';
    finalized = true;
    r.doctor = {
      ...doctor
    };
    r.engine = {
      spawn: legacy.spawnCount,
      exit: legacy.exitCount,
      close: legacy.closeCount,
      outputBytes: legacy.outputBytes
    };
    if (r.mcp.requests > 0 && r.mcp.body === r.mcp.requests) r.coverage.automaticMcp = 'verified-observed';
    if (released) {
      childProcess.spawn = originalSpawn;
      childProcess.spawnSync = originalSpawnSync;
      moduleApi.syncBuiltinESMExports();
      globalThis.fetch = originalFetch;
      restoreHook?.();
    }
    // This host received an already scrubbed environment; keep RUN_AS_NODE absent
    // for any still-pending producer rather than restoring a launch-only flag.
    delete process.env.ELECTRON_RUN_AS_NODE;
    r.elapsedMeasured = true;
    r.elapsedMs = Math.round(performance.now() - start);
    r.finalized = true;
    r.outcome = 'UNKNOWN';
  }
  return {
    receipt: r,
    released,
    doctor
  };
}
const CODE_SET = new Set(['REFUSED', 'PREREQUISITE_FAILED', 'IDENTITY_FAILED', 'START_PENDING', 'BODY_LIMIT', 'OUTPUT_LIMIT']);
async function entry(mode) {
  const original = {
      ...process.env
    },
    root = original.LAWOSS_APP_ROOT,
    manifestFile = original.LAWOSS_APP_MANIFEST,
    context = JSON.parse(original.LAWOSS_APP_CONTEXT ?? 'null');
  admit({
    platform: process.platform,
    node: FIXED.node,
    env: context ?? {}
  }); // embedded Node measured separately
  if (!root || !path.isAbsolute(root) || !manifestFile || manifestFile !== path.join(path.dirname(root), 'lawoss-app-start-build', 'manifest.json') || (await fs.realpath(root)) !== root) throw fail('REFUSED');
  const r = createReceipt(),
    output = quarantine(r);
  let released = true;
  try {
    replaceEnvironment(privateEnvironment(root, 'http://127.0.0.1:1/v1', original));
    const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
    if (manifest.revision !== context.GITHUB_SHA) throw fail('PREREQUISITE_FAILED');
    if (mode === '--probe') output.publish(JSON.stringify(await probe(root, manifest)) + '\n');else {
      const input = JSON.parse(await fs.readFile(path.join(root, 'input.json'), 'utf8'));
      Object.assign(r, input);
      const expiresAt = Number(original.LAWOSS_APP_EXPIRES_AT);
      if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() || expiresAt - Date.now() > LIMITS.hostMs) throw fail('REFUSED');
      released = false;
      const result = await runEntry(root, manifest, r, {
        decision: hostDecision(expiresAt)
      });
      released = result.released;
      try {
        if (manifest.source !== (await sourceIdentity()) || !isDeepStrictEqual(manifest.dist, await distIdentity())) throw fail('BUILD_MISMATCH');
      } catch {
        recordIdentityFailure(r, 'BUILD_MISMATCH');
      }
      output.freeze();
      output.publish(encodeReceipt(r));
    }
  } finally {
    if (released) output.restore();
  }
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url && process.argv.length === 3 && ['--probe', '--run'].includes(process.argv[2])) {
  try {
    await entry(process.argv[2]);
  } catch {
    process.exitCode = 1;
  }
}
