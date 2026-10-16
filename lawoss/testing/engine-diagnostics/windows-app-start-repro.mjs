// Temporary Task43 diagnostic. All imports and default invocation are inert.
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { IDENTITY, verifySources, sha256, prepareArchives, emptyState, verifyEngine } from './windows-instance-repro.mjs';
export const REPO = fileURLToPath(new URL('../../../', import.meta.url));
export const LIMITS = Object.freeze({
  receipt: 32768,
  probe: 8192,
  output: 65536,
  selected: 90000,
  stop: 60000,
  pipes: 7000,
  probeMs: 15000,
  hostMs: 300000,
  appStartMs: 120000
});
export const FIXED = Object.freeze({
  ...IDENTITY,
  base: '371852f87def6ec373dfab551fbe1fa790894278',
  node: '24.21.0',
  pnpm: '11.4.0',
  bun: '1.4.2',
  electron: '43.7.5',
  engineBun: '1.3.14'
});
const CAPABILITIES = ['store', 'devEnvironment', 'distinctCwd', 'projectSeed', 'globalSeed', 'runtimeConfig', 'builtPlugins', 'httpHost', 'automaticMcp', 'renderer', 'main'];
const CODES = ['NONE', 'REFUSED', 'PREREQUISITE_FAILED', 'SOURCE_MISMATCH', 'BUILD_MISMATCH', 'ACQUISITION_FAILED', 'ENGINE_MISMATCH', 'CHILD_ERROR', 'OUTPUT_LIMIT', 'BODY_LIMIT', 'START_FAILED', 'START_PENDING', 'HEALTH_FAILED', 'PATH_TIMEOUT', 'PATH_FAILED', 'PROVIDER_CALLED', 'IDENTITY_FAILED', 'STOP_FAILED', 'STOP_PENDING', 'PIPES_PENDING', 'PROVIDER_CLOSE_FAILED', 'REMOVE_FAILED', 'HOST_PENDING'];
export const fail = code => Object.assign(new Error(code), {
  diagnosticCode: code
});
export function admit({
  platform = process.platform,
  node = process.versions.node,
  env = process.env,
  arch = process.arch
} = {}) {
  if (arch !== 'x64' || platform !== 'win32' || node !== FIXED.node || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1' || env.LAWOSS_REPRO_PLATFORM !== 'windows-2022' || env.GITHUB_REF_TYPE !== 'branch' || !/^refs\/heads\/chore\/windows-app-start-repro-[A-Za-z0-9-]+$/.test(env.GITHUB_REF ?? '') || !/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '')) throw fail('REFUSED');
}
export function createReceipt() {
  return {
    schema: 1,
    experiment: 'windows-app-start',
    identity: FIXED,
    finalized: false,
    outcome: 'UNKNOWN',
    primary: 'NONE',
    cleanupFailure: 'NONE',
    identityFailure: 'NONE',
    cause: 'UNKNOWN',
    fullAppWindows: 'RED unchanged',
    fullNativeAcceptance: false,
    hostKind: 'electron-run-as-node',
    source: {
      revision: '0'.repeat(40),
      digest: '0'.repeat(64),
      verified: false,
      finalVerified: false
    },
    build: {
      digest: '0'.repeat(64),
      verified: false,
      finalVerified: false
    },
    preflight: {
      attempted: false,
      verified: false,
      features: false,
      sqlite: false,
      imports: false,
      electronIdentity: false,
      node: '0.0.0'
    },
    coverage: Object.fromEntries(CAPABILITIES.map(k => [k, ['renderer', 'main'].includes(k) ? 'not-in-scope' : 'unknown'])),
    registrationCount: 0,
    acquisition: {
      control: false,
      archive: false,
      engine: false,
      closed: true
    },
    health: {
      headers: false,
      body: false,
      verified: false
    },
    path: {
      requests: 0,
      headers: false,
      body: false,
      verified: false,
      timeout: false
    },
    mcp: {
      requests: 0,
      headers: 0,
      body: 0,
      overlap: 0
    },
    engine: {
      spawn: 0,
      exit: 0,
      close: 0,
      outputBytes: 0
    },
    doctor: {
      calls: 0,
      exited: 0,
      timeout: 0,
      overflow: 0,
      failed: 0
    },
    host: {
      spawn: 0,
      exit: 0,
      close: 0,
      outputBytes: 0
    },
    stop: {
      invoked: 0,
      fulfilled: 0,
      rejected: 0,
      pending: 0
    },
    input: {
      env: false,
      cwd: false,
      engine: false,
      runtimeConfig: false,
      plugins: false,
      shim: false
    },
    provider: {
      calls: 0,
      modelCalls: 0,
      closed: false
    },
    consoleBytes: 0,
    consoleObjects: 0,
    cleanup: 'UNKNOWN',
    rootsRemoved: false,
    appStartMeasured: false,
    appStartMs: 0,
    selectedMeasured: false,
    selectedMs: 0,
    stopMeasured: false,
    stopMs: 0,
    elapsedMeasured: false,
    elapsedMs: 0,
    selectedDeadlineMs: 90000,
    normalStopCapMs: 60000,
    pipeCloseCapMs: 7000,
    appStartCapMs: 120000,
    outerHostCapMs: 300000,
    externalTransport: 'unknown'
  };
}
function shape(actual, expected, key = '') {
  if (expected && typeof expected === 'object') {
    if (!actual || typeof actual !== 'object' || Array.isArray(actual) || Object.keys(actual).sort().join() !== Object.keys(expected).sort().join()) throw fail('REFUSED');
    for (const k of Object.keys(expected)) shape(actual[k], expected[k], k);
  } else if (typeof expected === 'boolean') {
    if (typeof actual !== 'boolean') throw fail('REFUSED');
  } else if (typeof expected === 'number') {
    if (!Number.isSafeInteger(actual) || actual < 0 || actual > (key.endsWith('Ms') ? 1500000 : key.endsWith('Bytes') ? 65537 : key === 'consoleObjects' ? 1001 : 1000)) throw fail('REFUSED');
  } else if (typeof actual !== 'string' || actual.length > 96) throw fail('REFUSED');
}
export function classifyReceipt(r) {
  const outputBounded = r.engine.outputBytes <= 65536 && r.consoleBytes <= 65536 && r.host.outputBytes <= 32768 && r.consoleObjects <= 1000;
  const admitted = r.source.verified && r.source.finalVerified && r.build.verified && r.build.finalVerified && r.preflight.verified && r.registrationCount === 1 && Object.values(r.acquisition).every(Boolean);
  const coverageObserved = CAPABILITIES.filter(k => !['renderer', 'main'].includes(k)).every(k => r.coverage[k] === 'verified-observed');
  const engineClosed = r.engine.spawn >= 1 && r.engine.spawn === r.engine.exit && r.engine.exit === r.engine.close;
  const hostClosed = r.host.spawn === 1 && r.host.exit === 1 && r.host.close === 1;
  const stopped = r.stop.invoked === 1 && r.stop.fulfilled === 1 && r.stop.rejected === 0 && r.stop.pending === 0;
  const pure = r.provider.closed && r.provider.calls === 0 && r.provider.modelCalls === 0 && r.doctor.calls === 0;
  const closed = r.cleanup === 'CLOSED' && r.rootsRemoved && r.cleanupFailure === 'NONE';
  const measured = r.appStartMeasured && r.selectedMeasured && r.stopMeasured;
  const gates = r.identityFailure === 'NONE' && r.mcp.requests > 0 && r.mcp.requests === r.mcp.headers && r.mcp.headers === r.mcp.body && outputBounded && admitted && coverageObserved && engineClosed && hostClosed && stopped && pure && closed && measured && r.health.verified && r.health.headers && r.health.body && Object.values(r.input).every(Boolean);
  if (gates && r.primary === 'NONE' && r.path.requests === 1 && r.path.headers && r.path.body && r.path.verified && !r.path.timeout && r.selectedMs < 90000) return 'NOT_REPRODUCED';
  if (gates && r.primary === 'PATH_TIMEOUT' && r.path.requests === 1 && r.path.timeout && !r.path.verified && r.selectedMs >= 90000) return 'REPRODUCED';
  if (r.primary === 'PREREQUISITE_FAILED' && !r.acquisition.engine && r.engine.spawn === 0) return 'PREREQUISITE_FAILED';
  return 'UNKNOWN';
}
export function recordIdentityFailure(r, code) {
  if (!['SOURCE_MISMATCH', 'BUILD_MISMATCH', 'IDENTITY_FAILED'].includes(code)) throw fail('REFUSED');
  r.source.finalVerified = false;
  r.build.finalVerified = false;
  r.identityFailure = code;
  if (r.primary === 'NONE') r.primary = code;
  r.outcome = 'UNKNOWN';
}
function validate(r) {
  shape(r, createReceipt());
  if (r.schema !== 1 || r.experiment !== 'windows-app-start' || JSON.stringify(r.identity) !== JSON.stringify(FIXED) || !r.finalized || !r.elapsedMeasured || r.cause !== 'UNKNOWN' || r.fullAppWindows !== 'RED unchanged' || r.fullNativeAcceptance !== false || r.hostKind !== 'electron-run-as-node' || r.externalTransport !== 'unknown' || r.selectedDeadlineMs !== 90000 || r.normalStopCapMs !== 60000 || r.pipeCloseCapMs !== 7000 || r.appStartCapMs !== 120000 || r.outerHostCapMs !== 300000 || !['NONE', 'SOURCE_MISMATCH', 'BUILD_MISMATCH', 'IDENTITY_FAILED'].includes(r.identityFailure) || !CODES.includes(r.primary) || !CODES.includes(r.cleanupFailure)) throw fail('REFUSED');
  if (!/^[a-f0-9]{40}$/.test(r.source.revision) || ![r.source.digest, r.build.digest].every(x => /^[a-f0-9]{64}$/.test(x)) || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(r.preflight.node)) throw fail('REFUSED');
  for (const v of Object.values(r.coverage)) if (!['verified-observed', 'source-only', 'unknown', 'not-in-scope'].includes(v)) throw fail('REFUSED');
  if (r.coverage.renderer !== 'not-in-scope' || r.coverage.main !== 'not-in-scope' || !['UNKNOWN', 'CLOSED'].includes(r.cleanup) || r.outcome !== classifyReceipt(r)) throw fail('REFUSED');
  if (r.source.finalVerified && !r.source.verified || r.build.finalVerified && !r.build.verified) throw fail('REFUSED');
  if (r.preflight.verified && (!r.source.verified || !r.build.verified || !r.preflight.attempted || !r.preflight.features || !r.preflight.sqlite || !r.preflight.imports || !r.preflight.electronIdentity)) throw fail('REFUSED');
  if (r.source.verified && (r.source.revision === '0'.repeat(40) || r.source.digest === '0'.repeat(64)) || r.build.verified && r.build.digest === '0'.repeat(64)) throw fail('REFUSED');
  if (r.acquisition.archive && !r.acquisition.control || r.acquisition.engine && (!r.acquisition.archive || !r.preflight.verified)) throw fail('REFUSED');
  for (const group of [r.engine, r.host]) if (group.close > group.spawn || group.exit > group.spawn) throw fail('REFUSED');
  if (r.engine.spawn > 4 || r.host.spawn > 1 || r.path.requests > 1 || r.registrationCount > 1 || r.stop.invoked > 1 || r.stop.fulfilled + r.stop.rejected + r.stop.pending !== r.stop.invoked || r.mcp.body > r.mcp.headers || r.mcp.headers > r.mcp.requests || r.mcp.overlap > r.mcp.requests) throw fail('REFUSED');
  if (r.coverage.automaticMcp === 'verified-observed' && !(r.mcp.requests > 0 && r.mcp.requests === r.mcp.headers && r.mcp.headers === r.mcp.body)) throw fail('REFUSED');
  if (r.doctor.calls > 2 || Object.values(r.doctor).some(count => count > r.doctor.calls)) throw fail('REFUSED');
  if (r.path.verified && (!r.path.headers || !r.path.body || r.path.requests !== 1 || r.path.timeout) || r.path.body && !r.path.headers || r.health.verified && (!r.health.headers || !r.health.body) || r.path.timeout && r.primary !== 'PATH_TIMEOUT') throw fail('REFUSED');
  if (r.rootsRemoved && r.cleanup !== 'CLOSED' || r.cleanup === 'CLOSED' && (r.doctor.calls !== 0 || !r.provider.closed || r.cleanupFailure !== 'NONE' || !r.acquisition.closed || r.engine.close !== r.engine.spawn || r.engine.exit !== r.engine.spawn || r.stop.pending || r.stop.rejected || r.engine.spawn > 0 && r.stop.fulfilled !== 1)) throw fail('REFUSED');
  if (r.outcome !== 'UNKNOWN' && r.outcome !== 'PREREQUISITE_FAILED' && (!r.host.close || r.primary === 'NONE' && !r.path.verified)) throw fail('REFUSED');
  return r;
}
export function encodeReceipt(r) {
  validate(r);
  const text = JSON.stringify(r) + '\n';
  if (Buffer.byteLength(text) > LIMITS.receipt) throw fail('REFUSED');
  return text;
}
export function validateReceipt(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.receipt) throw fail('REFUSED');
  let r;
  try {
    r = JSON.parse(text);
  } catch {
    throw fail('REFUSED');
  }
  return validate(r);
}
export function boundedFrame(cap = LIMITS.receipt) {
  let chunks = [],
    size = 0,
    refused = false;
  return {
    push(bytes) {
      const n = Buffer.byteLength(bytes);
      size = Math.min(cap + 1, size + n);
      if (size > cap) {
        chunks = [];
        refused = true;
        return false;
      }
      if (!refused) chunks.push(Buffer.from(bytes));
      return !refused;
    },
    get size() {
      return size;
    },
    finish() {
      if (refused) throw fail('OUTPUT_LIMIT');
      return Buffer.concat(chunks).toString('utf8');
    }
  };
}
export async function runGates({
  preflight,
  acquire,
  run
}) {
  await preflight();
  const bin = await acquire();
  return run(bin);
}
export async function ordinaryFile(filename, root, max = 64 * 1024 * 1024) {
  const canonicalRoot = await fs.realpath(root),
    canonical = await fs.realpath(filename);
  if (canonical !== path.resolve(filename) || !canonical.startsWith(canonicalRoot + path.sep)) throw fail('PREREQUISITE_FAILED');
  const relative = path.relative(canonicalRoot, canonical);
  let current = canonicalRoot;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if ((await fs.lstat(current)).isSymbolicLink()) throw fail('PREREQUISITE_FAILED');
  }
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.size <= 0 || stat.size > max) throw fail('PREREQUISITE_FAILED');
  return {
    size: stat.size,
    sha256: sha256(await fs.readFile(filename))
  };
}
async function tree(root, base = root) {
  const rows = [];
  for (const entry of (await fs.readdir(root, {
    withFileTypes: true
  })).sort((a, b) => a.name.localeCompare(b.name))) {
    const filename = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw fail('PREREQUISITE_FAILED');
    if (entry.isDirectory()) rows.push(...(await tree(filename, base)));else rows.push({
      name: path.relative(base, filename).split(path.sep).join('/'),
      ...(await ordinaryFile(filename, base, 32 * 1024 * 1024))
    });
    if (rows.length > 10000) throw fail('PREREQUISITE_FAILED');
  }
  return rows;
}
export async function sourceIdentity(repo = REPO) {
  await verifySources(repo);
  const inputs = ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'apps/server/package.json', 'apps/server/tsconfig.json', 'apps/desktop/package.json', '.github/workflows/storage-oauth-review.yml', ...['repro', 'host', 'embedded-observer', 'repro.test'].map(n => `lawoss/testing/engine-diagnostics/windows-app-start-${n}.mjs`)];
  const rows = [];
  for (const name of inputs) rows.push({
    name,
    ...(await ordinaryFile(path.join(repo, name), repo))
  });
  for (const name of ['apps/server/src', 'apps/server/resources', 'apps/desktop/electron']) for (const row of await tree(path.join(repo, name))) rows.push({
    ...row,
    name: `${name}/${row.name}`
  });
  return sha256(JSON.stringify(rows));
}
export const PLUGINS = ['legalwork-extensions-preview', 'legalwork-capabilities-knowledge', 'legalwork-legalmemory-knowledge', 'legalwork-anthropic-adaptive-thinking', 'legalwork-anthropic-tool-schema', 'legalwork-word-tools', 'legalwork-excel-tools', 'legalwork-powerpoint-tools', 'legalwork-benchmark-tools', 'legalwork-skill-tools', 'legalwork-storage-tools', 'legalwork-task-tools', 'legalwork-project-tools', 'legalwork-review-tools', 'lawoss-okf-handoff'];
export async function distIdentity() {
  const rows = await tree(path.join(REPO, 'apps/server/dist'));
  for (const name of ['embedded.js', 'server.js', 'managed-opencode.js', 'config.js', 'workspaces.js', 'runtime-db.js', 'runtime-db-lifecycle.js', 'legalwork-runtime-config.js', 'runtime-opencode-config-store.js', 'workspace-init.js', 'core-skills.js', ...PLUGINS.map(n => `opencode-plugins/${n}.js`)]) if (!rows.some(row => row.name === name)) throw fail('PREREQUISITE_FAILED');
  return rows;
}
export async function command(exe, args, {
  env = process.env,
  cwd = REPO,
  ms = 120000,
  cap = 65536,
  keep = false,
  track,
  launch = childProcess.spawn
} = {}) {
  // Output is bounded before retention; never echo build/probe/native output.
  return new Promise((resolve, reject) => {
    const frame = boundedFrame(cap);
    let child,
      timer,
      exited = false,
      closed = false,
      code,
      problem,
      settled = false;
    const snapshot = () => {
      if (track && !settled) Object.assign(track, {
        spawn: child ? 1 : 0,
        exit: exited ? 1 : 0,
        close: closed ? 1 : 0,
        outputBytes: Math.min(65537, frame.size)
      });
    };
    const refuse = code => {
      snapshot();
      settled = true;
      reject(fail(code));
    };
    try {
      child = launch(exe, args, {
        env,
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      });
    } catch {
      reject(fail('PREREQUISITE_FAILED'));
      return;
    }
    snapshot();
    timer = setTimeout(() => {
      problem = 'HOST_PENDING';
      refuse(problem);
    }, ms);
    child.on('error', () => {
      problem = 'PREREQUISITE_FAILED';
    });
    child.stdout.on('data', bytes => {
      if (!frame.push(bytes)) problem = 'OUTPUT_LIMIT';
    });
    child.stderr.on('data', bytes => {
      if (keep && bytes.length) problem = 'OUTPUT_LIMIT';
      if (!frame.push(bytes)) problem = 'OUTPUT_LIMIT';
    });
    child.once('exit', value => {
      exited = true;
      code = value;
    });
    child.once('close', () => {
      closed = true;
      clearTimeout(timer);
      snapshot();
      if (problem || !exited || code !== 0) refuse(problem ?? 'PREREQUISITE_FAILED');else {
        settled = true;
        resolve({
          text: keep ? frame.finish() : '',
          bytes: frame.size,
          spawn: 1,
          exit: 1,
          close: 1
        });
      }
    });
  });
}
const privateBuildRoot = () => path.join(process.env.RUNNER_TEMP ?? '', 'lawoss-app-start-build');
async function tools() {
  const dest = process.env.LAWOSS_PNPM_DEST,
    bun = process.env.LAWOSS_BUN_EXE;
  if (!dest || !bun || ![dest, bun, process.execPath].every(path.isAbsolute)) throw fail('PREREQUISITE_FAILED');
  const packageRoot = await fs.realpath(path.join(dest, 'node_modules/pnpm')),
    cli = path.join(packageRoot, 'bin/pnpm.mjs');
  const manifest = JSON.parse(await fs.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  if (manifest.name !== 'pnpm' || manifest.version !== '11.4.0' || manifest.bin?.pnpm !== 'bin/pnpm.mjs') throw fail('PREREQUISITE_FAILED');
  const pnpmIdentity = await ordinaryFile(cli, packageRoot),
    nodeIdentity = await ordinaryFile(process.execPath, path.dirname(process.execPath)),
    bunIdentity = await ordinaryFile(bun, path.dirname(bun));
  for (const [exe, args, expected] of [[process.execPath, ['--version'], 'v24.21.0'], [process.execPath, [cli, '--version'], '11.4.0'], [bun, ['--version'], '1.4.2']]) if ((await command(exe, args, {
    keep: true,
    cap: 1024,
    ms: 15000
  })).text.trim() !== expected) throw fail('PREREQUISITE_FAILED');
  return {
    cli,
    bun,
    node: process.execPath,
    pnpmIdentity,
    nodeIdentity,
    bunIdentity
  };
}
export async function electronIdentity(cacheRoot = path.join(privateBuildRoot(), 'electron-cache')) {
  const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
  const packageFile = await fs.realpath(require.resolve('electron/package.json'));
  const packageRoot = path.dirname(packageFile),
    pkg = JSON.parse(await fs.readFile(packageFile, 'utf8'));
  const lock = await fs.readFile(path.join(REPO, 'pnpm-lock.yaml'), 'utf8');
  if (pkg.name !== 'electron' || pkg.version !== '43.7.5' || !lock.includes('electron@43.7.5:') || !packageRoot.startsWith((await fs.realpath(path.join(REPO, 'node_modules'))) + path.sep)) throw fail('PREREQUISITE_FAILED');
  const relative = (await fs.readFile(path.join(packageRoot, 'path.txt'), 'utf8')).trim();
  if (relative !== 'electron.exe') throw fail('PREREQUISITE_FAILED');
  const executable = path.join(packageRoot, 'dist', relative),
    identity = await ordinaryFile(executable, packageRoot, 512 * 1024 * 1024);
  const checksumFile = path.join(packageRoot, 'checksums.json'),
    checksumBytes = await fs.readFile(checksumFile);
  const checksums = JSON.parse(checksumBytes),
    archiveName = 'electron-v43.7.5-win32-x64.zip';
  const expected = '7acfa0646793f912ff983c8db8c3a145dc18ee40fe3d11a01840fd59cb76e5a2';
  if (checksums[archiveName] !== expected || sha256(checksumBytes) !== '96c214b09dc054cb9c00cdaa23751b12066456e7417008502f568196cca01eda' || (await fs.readFile(path.join(packageRoot, 'dist/version'), 'utf8')).trim() !== '43.7.5') throw fail('PREREQUISITE_FAILED');
  const archive = await ordinaryFile(path.join(cacheRoot, '2dc4f83cdcc3b8446f9d909bd697caa69bbfef832d7e01faba947002008f886b', archiveName), cacheRoot, 256 * 1024 * 1024);
  if (archive.sha256 !== expected) throw fail('PREREQUISITE_FAILED');
  return {
    executable,
    identity,
    packageSha256: sha256(await fs.readFile(packageFile)),
    checksumsSha256: sha256(checksumBytes),
    archiveSha256: archive.sha256,
    cacheRoot
  };
}
async function buildCi() {
  admit();
  if (process.env.LAWOSS_NODE_EXE !== process.execPath) throw fail('PREREQUISITE_FAILED');
  await verifySources();
  const tool = await tools(),
    root = privateBuildRoot();
  if (!path.isAbsolute(root) || !process.env.RUNNER_TEMP) throw fail('REFUSED');
  await fs.mkdir(root); // refuse reuse; no stale build provenance
  const revision = (await command('git', ['rev-parse', 'HEAD'], {
    keep: true,
    cap: 1024,
    ms: 15000
  })).text.trim();
  if (revision !== process.env.GITHUB_SHA) throw fail('SOURCE_MISMATCH');
  const before = await sourceIdentity();
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^electron_|^npm_config_electron_|^npm_config_(arch|platform|target_arch)$|^ELECTRON_|^NODE_OPTIONS$/i.test(key)));
  env.PATH = [path.dirname(tool.node), path.dirname(tool.bun), process.env.PATH ?? process.env.Path ?? ''].join(path.delimiter);
  env.electron_config_cache = path.join(root, 'electron-cache');
  await command(tool.node, [tool.cli, 'install', '--frozen-lockfile'], {
    env,
    ms: 600000,
    cap: 1024 * 1024
  });
  const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
  const electronPackage = path.dirname(await fs.realpath(require.resolve('electron/package.json')));
  const electronManifest = JSON.parse(await fs.readFile(path.join(electronPackage, 'package.json'), 'utf8'));
  if (electronManifest.version !== '43.7.5' || electronManifest.bin?.['install-electron'] !== 'install.js') throw fail('PREREQUISITE_FAILED');
  await ordinaryFile(path.join(electronPackage, 'install.js'), electronPackage);
  await command(tool.node, [path.join(electronPackage, 'install.js')], {
    env,
    ms: 300000,
    cap: 65536
  });
  await fs.rm(path.join(REPO, 'apps/server/dist'), {
    recursive: true,
    force: true
  });
  await command(tool.node, [tool.cli, '--filter', 'legalwork-server', 'build'], {
    env,
    ms: 600000,
    cap: 1024 * 1024
  });
  if ((await sourceIdentity()) !== before) throw fail('SOURCE_MISMATCH');
  const manifest = {
    schema: 1,
    revision: process.env.GITHUB_SHA,
    source: before,
    tools: tool,
    buildSuccess: true,
    dist: await distIdentity(),
    electron: await electronIdentity()
  };
  await fs.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), {
    flag: 'wx',
    mode: 0o600
  });
}
export async function verifyBuild(manifest) {
  if (manifest?.schema !== 1 || manifest.electron?.cacheRoot !== path.join(privateBuildRoot(), 'electron-cache') || manifest.revision !== process.env.GITHUB_SHA || manifest.buildSuccess !== true || manifest.source !== (await sourceIdentity()) || JSON.stringify(manifest.dist) !== JSON.stringify(await distIdentity()) || JSON.stringify(manifest.electron) !== JSON.stringify(await electronIdentity(manifest.electron.cacheRoot))) throw fail('BUILD_MISMATCH');
  const current = await tools();
  if (JSON.stringify(current) !== JSON.stringify(manifest.tools)) throw fail('BUILD_MISMATCH');
  return sha256(JSON.stringify(manifest));
}
async function runCi() {
  const r = createReceipt(),
    started = performance.now(),
    receipt = path.join(REPO, 'windows-app-start-receipt.json');
  let root, manifest;
  await fs.rm(receipt, {
    force: true
  });
  try {
    admit();
    r.source.revision = process.env.GITHUB_SHA;
    manifest = JSON.parse(await fs.readFile(path.join(privateBuildRoot(), 'manifest.json'), 'utf8'));
    r.source.digest = await sourceIdentity();
    r.source.verified = true;
    r.build.digest = await verifyBuild(manifest);
    r.build.verified = true;
    if (!process.env.RUNNER_TEMP || !path.isAbsolute(process.env.RUNNER_TEMP)) throw fail('REFUSED');
    root = await fs.mkdtemp(path.join(process.env.RUNNER_TEMP, 'lawoss-app-start-'));
    const {
      privateEnvironment
    } = await import('./windows-app-start-host.mjs');
    const env = {
      ...privateEnvironment(root, 'http://127.0.0.1:1/v1', process.env),
      ELECTRON_RUN_AS_NODE: '1',
      NODE_NO_WARNINGS: '1',
      LAWOSS_APP_ROOT: root,
      LAWOSS_APP_MANIFEST: path.join(privateBuildRoot(), 'manifest.json'),
      LAWOSS_APP_CONTEXT: JSON.stringify(Object.fromEntries(['GITHUB_EVENT_NAME', 'GITHUB_RUN_ATTEMPT', 'LAWOSS_REPRO_PLATFORM', 'GITHUB_REF_TYPE', 'GITHUB_REF', 'GITHUB_SHA'].map(k => [k, process.env[k]])))
    };
    r.preflight.attempted = true;
    const probe = await command(manifest.electron.executable, [fileURLToPath(new URL('./windows-app-start-host.mjs', import.meta.url)), '--probe'], {
      env,
      ms: LIMITS.probeMs,
      cap: LIMITS.probe,
      keep: true
    });
    const p = JSON.parse(probe.text);
    if (Object.keys(p).sort().join() !== 'electron,features,imports,node,sqlite' || p.electron !== '43.7.5' || p.features !== true || p.imports !== true || p.sqlite !== true || !/^\d+\.\d+\.\d+$/.test(p.node)) throw fail('PREREQUISITE_FAILED');
    Object.assign(r.preflight, {
      verified: true,
      features: true,
      imports: true,
      sqlite: true,
      electronIdentity: true,
      node: p.node
    });
    const old = emptyState();
    await runGates({
      preflight: () => verifyBuild(manifest),
      acquire: async () => {
        try {
          return await prepareArchives({
            root,
            env,
            state: old
          });
        } finally {
          r.acquisition = {
            control: old.controlVerified,
            archive: old.archiveVerified,
            engine: false,
            closed: old.acquisitionClosed && old.control.closed && old.extraction.closed
          };
        }
      },
      run: async bin => {
        await ordinaryFile(bin, root, 256 * 1024 * 1024);
        verifyEngine(await fs.readFile(bin));
        r.acquisition.engine = true;
        await verifyBuild(manifest);
        await fs.writeFile(path.join(root, 'input.json'), JSON.stringify(r), {
          flag: 'wx',
          mode: 0o600
        });
        env.LAWOSS_APP_EXPIRES_AT = String(Date.now() + LIMITS.hostMs);
        const host = await command(manifest.electron.executable, [fileURLToPath(new URL('./windows-app-start-host.mjs', import.meta.url)), '--run'], {
          env,
          ms: LIMITS.hostMs,
          cap: LIMITS.receipt,
          keep: true,
          track: r.host
        });
        const result = validateReceipt(host.text);
        for (const key of ['source', 'build', 'preflight', 'acquisition']) {
          const {
            finalVerified: observedFinal,
            ...observed
          } = result[key];
          const {
            finalVerified: expectedFinal,
            ...expected
          } = r[key];
          if (JSON.stringify(observed) !== JSON.stringify(expected)) throw fail('IDENTITY_FAILED');
        }
        Object.assign(r, result);
        r.host = {
          spawn: host.spawn,
          exit: host.exit,
          close: host.close,
          outputBytes: host.bytes
        };
        await verifyBuild(manifest);
        r.source.finalVerified = true;
        r.build.finalVerified = true;
        r.outcome = classifyReceipt(r);
      }
    });
  } catch (error) {
    if (['SOURCE_MISMATCH', 'BUILD_MISMATCH'].includes(error?.diagnosticCode)) {
      recordIdentityFailure(r, error.diagnosticCode);
    }
    if (r.primary === 'NONE') r.primary = r.host.spawn ? CODES.includes(error?.diagnosticCode) ? error.diagnosticCode : 'HOST_PENDING' : r.preflight.verified ? 'ACQUISITION_FAILED' : 'PREREQUISITE_FAILED';
    r.outcome = classifyReceipt(r);
  }
  r.elapsedMs = Math.round(performance.now() - started);
  r.elapsedMeasured = true;
  r.finalized = true;
  r.outcome = classifyReceipt(r);
  await fs.writeFile(receipt, encodeReceipt(r), {
    flag: 'wx',
    mode: 0o600
  });
  return r.outcome === 'NOT_REPRODUCED' ? 0 : 1;
}
async function validatePublished() {
  const filename = path.join(REPO, 'windows-app-start-receipt.json');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.receipt) throw fail('REFUSED');
  validateReceipt(await fs.readFile(filename, 'utf8'));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  const mode = process.argv[2];
  if (process.argv.length === 3 && ['--build-ci', '--run-ci', '--validate-receipt'].includes(mode)) {
    try {
      if (mode === '--build-ci') await buildCi();else if (mode === '--run-ci') process.exitCode = await runCi();else await validatePublished();
    } catch {
      process.exitCode = 1;
    }
  }
}
