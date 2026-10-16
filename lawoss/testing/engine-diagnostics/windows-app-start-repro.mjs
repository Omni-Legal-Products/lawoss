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
// Observation is advisory and content-free; it cannot alter admission errors.
const notify = (observe, event) => { try { observe?.(event); } catch {} };
export const TOOL_EXE_MAX = 128 * 1024 * 1024;
export async function ordinaryFile(filename, root, max = 64 * 1024 * 1024, observe, io = fs) {
  notify(observe, { stage: 'ATTEMPT' });
  const refusal = reason => { notify(observe, { stage: 'REFUSAL', reason }); throw fail('PREREQUISITE_FAILED'); };
  let issued = false;
  const guard = reason => { issued = true; refusal(reason); };
  try {
    const canonicalRoot = await io.realpath(root), canonical = await io.realpath(filename);
    if (canonical !== path.resolve(filename)) guard('LEXICAL');
    if (!canonical.startsWith(canonicalRoot + path.sep)) guard('OUTSIDE');
    notify(observe, { stage: 'CANONICAL' });
    const relative = path.relative(canonicalRoot, canonical);
    let current = canonicalRoot;
    for (const segment of relative.split(path.sep)) {
      current = path.join(current, segment);
      if ((await io.lstat(current)).isSymbolicLink()) guard('SYMLINK');
    }
    notify(observe, { stage: 'NO_SYMLINK' });
    const stat = await io.lstat(filename);
    notify(observe, { stage: 'SIZE', sizeBytes: stat.size });
    if (!stat.isFile()) guard('NONREGULAR');
    if (stat.size <= 0 || stat.size > max) guard('SIZE');
    const identity = { size: stat.size, sha256: sha256(await io.readFile(filename)) };
    notify(observe, { stage: 'HASH' });
    notify(observe, { stage: 'COMPLETE' });
    return identity;
  } catch (error) {
    if (!issued) notify(observe, { stage: 'REFUSAL', reason: ['ENOENT', 'ENOTDIR'].includes(error?.code) ? 'MISSING' : 'UNKNOWN' });
    throw error;
  }
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
// Task44 build observations deliberately do not use the app counter schema.
export const BUILD_PHASES = Object.freeze(['admit', 'node-binding', 'source-pins', 'pnpm-location', 'pnpm-manifest', 'pnpm-file', 'node-file', 'bun-file', 'node-version', 'pnpm-version', 'bun-version', 'fresh-root', 'revision', 'source-before', 'install', 'electron-admission', 'electron-install', 'dist-reset', 'server-build', 'source-after', 'dist-identity', 'electron-identity', 'manifest-write']);
const BUILD_MS = 25 * 60 * 1000;
const BUILD_COMMANDS = Object.freeze({ 'node-version': [1024, 15000], 'pnpm-version': [1024, 15000], 'bun-version': [1024, 15000], revision: [1024, 15000], install: [1048576, 600000], 'electron-install': [65536, 300000], 'server-build': [1048576, 600000] });
const BUILD_CODES = ['NONE', 'UNKNOWN', 'REFUSED', 'PREREQUISITE_FAILED', 'SOURCE_MISMATCH', 'OUTPUT_LIMIT', 'HOST_PENDING'];
const BUILD_REASONS = ['NONE', 'SPAWN_THROW', 'CHILD_ERROR', 'NONZERO_EXIT', 'NO_EXIT', 'TIMER', 'OUTPUT_CAP', 'KEEP_STDERR', 'UNKNOWN'];
const TOOL_REASONS = ['NONE', 'MISSING', 'NONREGULAR', 'SYMLINK', 'OUTSIDE', 'LEXICAL', 'SIZE', 'UNKNOWN'];
const phaseCap = name => BUILD_COMMANDS[name]?.[1] ?? BUILD_MS;
function createCommandObservation(cap, ms) {
  return { capBytes: cap, deadlineMs: ms, attempted: false, spawnReturned: false, spawnError: false, exitObserved: false, exitKind: 'UNMEASURED', exitCode: null, closeObserved: false, timerFired: false, stdoutBytes: 0, stderrBytes: 0, combinedBytes: 0, overflow: false, keepStderrRefused: false, elapsedMeasured: false, elapsedMs: 0, reason: 'NONE' };
}
function createToolObservation(maxBytes) {
  return { attempted: false, sizeMeasured: false, sizeBytes: null, sizeExact: false, maxBytes, refusal: 'NONE', hashVerified: false, identityCompleted: false };
}
function observeTool(tool, event) {
  if (event.stage === 'ATTEMPT') tool.attempted = true;
  if (event.stage === 'SIZE') {
    tool.sizeMeasured = Number.isSafeInteger(event.sizeBytes) && event.sizeBytes >= 0;
    if (tool.sizeMeasured) {
      tool.sizeBytes = Math.min(tool.maxBytes + 1, event.sizeBytes);
      tool.sizeExact = event.sizeBytes <= tool.maxBytes;
    }
  }
  if (event.stage === 'REFUSAL') tool.refusal = event.reason;
  if (event.stage === 'HASH') tool.hashVerified = true;
  if (event.stage === 'COMPLETE') tool.identityCompleted = true;
}
export function createBuildObservation(revision = null) {
  return {
    schema: 1, experiment: 'windows-app-start-build-prerequisite', finalized: false,
    outcome: 'UNKNOWN', appStage: 'NOT_RUN', nativeFacts: 'UNMEASURED', cause: 'UNKNOWN',
    fullAppWindows: 'RED unchanged', fullNativeAcceptance: false,
    elapsedMeasured: false, elapsedMs: 0,
    source: { revision, revisionVerified: false, sourceBeforeMeasured: false, sourceBeforeDigest: null, sourceAfterVerified: false },
    phases: BUILD_PHASES.map(name => ({ name, state: 'NOT_ENTERED', elapsedMeasured: false, elapsedMs: 0, failureCode: 'NONE' })),
    tools: { pnpm: createToolObservation(64 * 1024 * 1024), node: createToolObservation(TOOL_EXE_MAX), bun: createToolObservation(TOOL_EXE_MAX) },
    commands: Object.fromEntries(Object.entries(BUILD_COMMANDS).map(([role, [cap, ms]]) => [role, createCommandObservation(cap, ms)])),
    rootState: 'NOT_CREATED', rootCreationEntered: false, rootCreated: false, rootRetained: false, resourceClosure: 'UNKNOWN'
  };
}
const closedKeys = (value, model) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(Object.keys(model).sort())) throw fail('REFUSED');
};
const finiteInteger = (value, max) => {
  if (!Number.isSafeInteger(value) || value < 0 || value > max) throw fail('REFUSED');
};
const booleanKeys = (value, keys) => { for (const key of keys) if (typeof value[key] !== 'boolean') throw fail('REFUSED'); };
function commandPending(value) { return value.attempted && !value.closeObserved && value.reason !== 'SPAWN_THROW'; }
function buildOutcome(r) {
  const terminal = r.phases.find(p => ['FAILED', 'PENDING'].includes(p.state));
  if (!terminal || terminal.state === 'PENDING' || ['NONE', 'UNKNOWN', 'HOST_PENDING'].includes(terminal.failureCode) || r.elapsedMs > BUILD_MS || r.phases.some(p => p.elapsedMs > phaseCap(p.name))) return 'UNKNOWN';
  return 'PREREQUISITE_FAILED';
}
export function validateBuildObservation(r) {
  const model = createBuildObservation(); closedKeys(r, model);
  for (const key of ['schema', 'experiment', 'appStage', 'nativeFacts', 'cause', 'fullAppWindows', 'fullNativeAcceptance', 'resourceClosure']) if (r[key] !== model[key]) throw fail('REFUSED');
  booleanKeys(r, ['finalized', 'elapsedMeasured', 'rootCreationEntered', 'rootCreated']);
  if (!r.finalized || !r.elapsedMeasured) throw fail('REFUSED');
  finiteInteger(r.elapsedMs, BUILD_MS);
  closedKeys(r.source, model.source);
  booleanKeys(r.source, ['revisionVerified', 'sourceBeforeMeasured', 'sourceAfterVerified']);
  if (r.source.revision !== null && (typeof r.source.revision !== 'string' || !/^[a-f0-9]{40}$/.test(r.source.revision))) throw fail('REFUSED');
  if (r.source.sourceBeforeMeasured ? typeof r.source.sourceBeforeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(r.source.sourceBeforeDigest) || r.source.sourceBeforeDigest === '0'.repeat(64) : r.source.sourceBeforeDigest !== null) throw fail('REFUSED');
  if (!Array.isArray(r.phases) || r.phases.length !== BUILD_PHASES.length) throw fail('REFUSED');
  let stopped = false, failed = false;
  for (let i = 0; i < r.phases.length; i++) {
    const entry = r.phases[i]; closedKeys(entry, model.phases[i]);
    if (entry.name !== BUILD_PHASES[i] || !BUILD_CODES.includes(entry.failureCode) || typeof entry.elapsedMeasured !== 'boolean') throw fail('REFUSED');
    finiteInteger(entry.elapsedMs, phaseCap(entry.name));
    if (entry.state === 'COMPLETED' && !stopped) {
      if (!entry.elapsedMeasured || entry.failureCode !== 'NONE') throw fail('REFUSED');
    } else if (['FAILED', 'PENDING'].includes(entry.state) && !stopped) {
      if (!entry.elapsedMeasured || entry.failureCode === 'NONE') throw fail('REFUSED');
      stopped = true; failed = true;
    } else if (entry.state === 'NOT_ENTERED') {
      if (entry.elapsedMeasured || entry.elapsedMs !== 0 || entry.failureCode !== 'NONE') throw fail('REFUSED');
      stopped = true;
    } else throw fail('REFUSED');
  }
  if (!failed) throw fail('REFUSED');
  const completed = name => r.phases[BUILD_PHASES.indexOf(name)].state === 'COMPLETED';
  const entered = name => r.phases[BUILD_PHASES.indexOf(name)].state !== 'NOT_ENTERED';
  if (r.source.revisionVerified !== completed('revision') || r.source.sourceBeforeMeasured !== completed('source-before') || r.source.sourceAfterVerified !== completed('source-after') || r.source.revisionVerified && !r.source.revision) throw fail('REFUSED');
  if (!['NOT_CREATED', 'UNKNOWN', 'CREATED'].includes(r.rootState) || r.rootCreated !== completed('fresh-root') || r.rootCreated && !r.rootCreationEntered || r.rootCreationEntered && !entered('fresh-root') || r.rootRetained !== (r.rootCreated ? true : r.rootCreationEntered ? null : false) || r.rootState !== (r.rootCreated ? 'CREATED' : r.rootCreationEntered ? 'UNKNOWN' : 'NOT_CREATED')) throw fail('REFUSED');
  closedKeys(r.tools, model.tools);
  for (const role of ['pnpm', 'node', 'bun']) {
    const value = r.tools[role]; closedKeys(value, model.tools[role]);
    booleanKeys(value, ['attempted', 'sizeMeasured', 'sizeExact', 'hashVerified', 'identityCompleted']);
    if (value.maxBytes !== model.tools[role].maxBytes || !TOOL_REASONS.includes(value.refusal)) throw fail('REFUSED');
    if (value.sizeMeasured) {
      finiteInteger(value.sizeBytes, value.maxBytes + 1);
      if (value.sizeExact !== (value.sizeBytes <= value.maxBytes)) throw fail('REFUSED');
    } else if (value.sizeBytes !== null || value.sizeExact) throw fail('REFUSED');
    if (value.refusal === 'SIZE' && (!value.sizeMeasured || value.sizeBytes > 0 && value.sizeBytes <= value.maxBytes) || ['SYMLINK', 'LEXICAL', 'OUTSIDE'].includes(value.refusal) && value.sizeMeasured) throw fail('REFUSED');
    if (value.attempted && !entered(`${role}-file`) || !value.attempted && Object.keys(model.tools[role]).some(key => value[key] !== model.tools[role][key])) throw fail('REFUSED');
    if (completed(`${role}-file`) !== value.identityCompleted || value.hashVerified !== value.identityCompleted || value.identityCompleted && (!value.attempted || !value.sizeMeasured || !value.sizeExact || value.sizeBytes <= 0 || value.refusal !== 'NONE')) throw fail('REFUSED');
  }
  closedKeys(r.commands, model.commands);
  for (const [role, [cap, ms]] of Object.entries(BUILD_COMMANDS)) {
    const value = r.commands[role]; closedKeys(value, model.commands[role]);
    booleanKeys(value, ['attempted', 'spawnReturned', 'spawnError', 'exitObserved', 'closeObserved', 'timerFired', 'overflow', 'keepStderrRefused', 'elapsedMeasured']);
    if (value.capBytes !== cap || value.deadlineMs !== ms || !BUILD_REASONS.includes(value.reason)) throw fail('REFUSED');
    for (const key of ['stdoutBytes', 'stderrBytes', 'combinedBytes']) finiteInteger(value[key], cap + 1);
    finiteInteger(value.elapsedMs, ms);
    if (value.combinedBytes !== Math.min(cap + 1, value.stdoutBytes + value.stderrBytes) || value.overflow !== (value.combinedBytes > cap)) throw fail('REFUSED');
    if (value.exitObserved) {
      if (!value.spawnReturned || !['CODE', 'UNKNOWN'].includes(value.exitKind)) throw fail('REFUSED');
      if (value.exitKind === 'CODE') finiteInteger(value.exitCode, 255); else if (value.exitCode !== null) throw fail('REFUSED');
    } else if (value.exitKind !== 'UNMEASURED' || value.exitCode !== null) throw fail('REFUSED');
    if (!value.attempted) { if (Object.keys(model.commands[role]).some(key => value[key] !== model.commands[role][key])) throw fail('REFUSED'); }
    else if (!entered(role) || !value.elapsedMeasured) throw fail('REFUSED');
    if ((value.spawnReturned || value.spawnError) && !value.attempted || value.closeObserved && !value.spawnReturned || value.timerFired && (!value.spawnReturned || value.closeObserved) || value.keepStderrRefused && (!role.endsWith('version') && role !== 'revision' || !value.stderrBytes)) throw fail('REFUSED');
    const reasonValid = {
      NONE: !value.spawnError && !value.timerFired && !value.overflow && !value.keepStderrRefused,
      SPAWN_THROW: value.spawnError && !value.spawnReturned && !value.exitObserved && !value.closeObserved,
      CHILD_ERROR: value.spawnError && value.spawnReturned,
      NONZERO_EXIT: value.closeObserved && value.exitObserved && value.exitCode !== 0,
      NO_EXIT: value.closeObserved && !value.exitObserved,
      TIMER: value.timerFired,
      OUTPUT_CAP: value.overflow,
      KEEP_STDERR: value.keepStderrRefused,
      UNKNOWN: true
    }[value.reason];
    if (!reasonValid) throw fail('REFUSED');
    if (completed(role) && (!value.spawnReturned || !value.exitObserved || value.exitCode !== 0 || !value.closeObserved || value.reason !== 'NONE')) throw fail('REFUSED');
    if (value.attempted && !completed(role)) {
      const state = r.phases[BUILD_PHASES.indexOf(role)].state;
      if (state !== (commandPending(value) ? 'PENDING' : 'FAILED')) throw fail('REFUSED');
    }
  }
  if (r.outcome !== buildOutcome(r)) throw fail('REFUSED');
  return r;
}
function freezeCopy(value) {
  const copy = structuredClone(value);
  const freeze = item => { if (item && typeof item === 'object') { for (const child of Object.values(item)) freeze(child); Object.freeze(item); } };
  freeze(copy); return copy;
}
export function encodePublication(mode, payload) {
  const copy = freezeCopy({ schema: 1, experiment: 'windows-app-start-diagnostic', mode, payload });
  const text = JSON.stringify(copy) + '\n';
  validatePublication(text);
  return text;
}
export function validatePublication(text, steps) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > LIMITS.receipt) throw fail('REFUSED');
  let r; try { r = JSON.parse(text); } catch { throw fail('REFUSED'); }
  closedKeys(r, { schema: 1, experiment: '', mode: '', payload: {} });
  if (r.schema !== 1 || r.experiment !== 'windows-app-start-diagnostic' || !['APP_START', 'BUILD_PREREQUISITE'].includes(r.mode)) throw fail('REFUSED');
  if (r.mode === 'APP_START') validateReceipt(encodeReceipt(r.payload)); else validateBuildObservation(r.payload);
  if (steps && (r.mode === 'BUILD_PREREQUISITE' ? steps.build !== 'failure' || steps.app !== 'skipped' : steps.build !== 'success' || !['success', 'failure'].includes(steps.app))) throw fail('REFUSED');
  return r;
}
export async function command(exe, args, {
  env = process.env,
  cwd = REPO,
  ms = 120000,
  cap = 65536,
  keep = false,
  track,
  observe,
  schedule = setTimeout,
  cancel = clearTimeout,
  launch = childProcess.spawn
} = {}) {
  // Output is bounded before retention; never echo build/probe/native output.
  return new Promise((resolve, reject) => {
    const frame = boundedFrame(cap), started = performance.now();
    const observed = createCommandObservation(cap, ms);
    let child, timer, exited = false, closed = false, code, problem, settled = false;
    const snapshot = () => {
      if (track && !settled) Object.assign(track, {
        spawn: child ? 1 : 0, exit: exited ? 1 : 0, close: closed ? 1 : 0,
        outputBytes: Math.min(65537, frame.size)
      });
    };
    const publish = () => {
      if (settled) return;
      observed.elapsedMeasured = true;
      observed.elapsedMs = Math.round(performance.now() - started);
      notify(observe, structuredClone(observed));
    };
    const problemAt = (value, reason) => {
      // Build observation retains its first failure. Unobserved app calls keep
      // their existing promise behavior and the separate track protocol.
      if (!problem) observed.reason = reason;
      if (!problem || !observe) problem = value;
    };
    const refuse = value => {
      if (settled) return;
      snapshot(); publish(); settled = true; reject(fail(value));
    };
    observed.attempted = true;
    try {
      child = launch(exe, args, { env, cwd, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      observed.spawnReturned = true;
    } catch {
      observed.spawnError = true; problemAt('PREREQUISITE_FAILED', 'SPAWN_THROW');
      publish(); settled = true; reject(fail('PREREQUISITE_FAILED')); return;
    }
    snapshot(); publish();
    timer = schedule(() => {
      if (settled) return;
      observed.timerFired = true;
      problemAt('HOST_PENDING', 'TIMER');
      // No termination or join is implied. Freeze the observation at rejection.
      refuse(problem);
    }, ms);
    child.on('error', () => {
      if (settled) return;
      observed.spawnError = true; problemAt('PREREQUISITE_FAILED', 'CHILD_ERROR'); publish();
    });
    const output = (bytes, stream) => {
      // Keep enforcing the original bounded quarantine even after publication.
      if (!settled) {
        observed[stream] = Math.min(cap + 1, observed[stream] + bytes.length);
        observed.combinedBytes = Math.min(cap + 1, observed.combinedBytes + bytes.length);
        if (stream === 'stderrBytes' && keep && bytes.length) {
          observed.keepStderrRefused = true; problemAt('OUTPUT_LIMIT', 'KEEP_STDERR');
        }
      }
      if (!frame.push(bytes) && !settled) { observed.overflow = true; problemAt('OUTPUT_LIMIT', 'OUTPUT_CAP'); }
      publish();
    };
    child.stdout.on('data', bytes => output(bytes, 'stdoutBytes'));
    child.stderr.on('data', bytes => output(bytes, 'stderrBytes'));
    child.once('exit', value => {
      exited = true; code = value;
      if (!settled) {
        observed.exitObserved = true;
        observed.exitKind = Number.isInteger(value) && value >= 0 && value <= 255 ? 'CODE' : 'UNKNOWN';
        observed.exitCode = observed.exitKind === 'CODE' ? value : null;
        publish();
      }
    });
    child.once('close', () => {
      closed = true; cancel(timer);
      if (settled) return;
      observed.closeObserved = true; snapshot();
      if (!exited) problemAt('PREREQUISITE_FAILED', 'NO_EXIT');
      else if (code !== 0) problemAt('PREREQUISITE_FAILED', 'NONZERO_EXIT');
      if (problem) refuse(problem);
      else { publish(); settled = true; resolve({ text: keep ? frame.finish() : '', bytes: frame.size, spawn: 1, exit: 1, close: 1 }); }
    });
  });
}
const privateBuildRoot = (env = process.env) => path.join(env.RUNNER_TEMP ?? '', 'lawoss-app-start-build');
export async function tools({ env = process.env, node = process.execPath, io = fs, command: execute = command, phase = (_name, op) => op(), observation } = {}) {
  const dest = env.LAWOSS_PNPM_DEST, bun = env.LAWOSS_BUN_EXE;
  const packageRoot = await phase('pnpm-location', async () => {
    if (!dest || !bun || ![dest, bun, node].every(path.isAbsolute)) throw fail('PREREQUISITE_FAILED');
    return io.realpath(path.join(dest, 'node_modules/pnpm'));
  });
  const cli = path.join(packageRoot, 'bin/pnpm.mjs');
  await phase('pnpm-manifest', async () => {
    const manifest = JSON.parse(await io.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== 'pnpm' || manifest.version !== '11.4.0' || manifest.bin?.pnpm !== 'bin/pnpm.mjs') throw fail('PREREQUISITE_FAILED');
  });
  const file = (role, filename, root, max) => phase(`${role}-file`, () => ordinaryFile(filename, root, max, observation ? event => observeTool(observation.tools[role], event) : undefined, io));
  const pnpmIdentity = await file('pnpm', cli, packageRoot, undefined),
    nodeIdentity = await file('node', node, path.dirname(node), TOOL_EXE_MAX),
    bunIdentity = await file('bun', bun, path.dirname(bun), TOOL_EXE_MAX);
  for (const [role, exe, args, expected] of [['node-version', node, ['--version'], 'v24.21.0'], ['pnpm-version', node, [cli, '--version'], '11.4.0'], ['bun-version', bun, ['--version'], '1.4.2']]) await phase(role, async () => {
    if ((await execute(exe, args, { keep: true, cap: 1024, ms: 15000, env, observe: observation ? value => { observation.commands[role] = value; } : undefined })).text.trim() !== expected) throw fail('PREREQUISITE_FAILED');
  });
  return { cli, bun, node, pnpmIdentity, nodeIdentity, bunIdentity };
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
const publicReceipt = path.join(REPO, 'windows-app-start-receipt.json');
async function assertAbsent(io, filename) {
  try { await io.lstat(filename); } catch (error) { if (error?.code === 'ENOENT') return; throw error; }
  throw fail('REFUSED');
}
async function defaultElectronPackage() {
  const require = createRequire(path.join(REPO, 'apps/desktop/package.json'));
  return path.dirname(await fs.realpath(require.resolve('electron/package.json')));
}
export async function runBuildPreparation({
  io = fs, env = process.env, node = process.execPath, admission = admit,
  verifySources: sources = verifySources, sourceIdentity: source = sourceIdentity,
  distIdentity: dist = distIdentity, electronIdentity: electron = electronIdentity,
  resolveElectron = defaultElectronPackage, command: execute = command
} = {}) {
  const observation = createBuildObservation(/^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') ? env.GITHUB_SHA : null);
  const started = performance.now();
  let primaryError = null, publicationError = null, admitted = false, publicationAbsent = false;
  const phase = async (name, operation) => {
    const entry = observation.phases[BUILD_PHASES.indexOf(name)], start = performance.now();
    entry.state = 'ENTERED';
    try {
      const value = await operation(); entry.state = 'COMPLETED'; return value;
    } catch (error) {
      entry.failureCode = BUILD_CODES.includes(error?.diagnosticCode) && error.diagnosticCode !== 'NONE' ? error.diagnosticCode : 'UNKNOWN';
      entry.state = observation.commands[name] && commandPending(observation.commands[name]) ? 'PENDING' : 'FAILED';
      throw error;
    } finally { entry.elapsedMeasured = true; entry.elapsedMs = Math.round(performance.now() - start); }
  };
  const runCommand = (role, exe, args, options) => execute(exe, args, { ...options, observe: value => { observation.commands[role] = value; } });
  try {
    await phase('admit', async () => {
      admission(); admitted = true;
      // Admission authorizes only this fixed CI publication, never arbitrary CLI writes.
      await assertAbsent(io, publicReceipt); publicationAbsent = true;
    });
    await phase('node-binding', async () => { if (env.LAWOSS_NODE_EXE !== node) throw fail('PREREQUISITE_FAILED'); });
    await phase('source-pins', () => sources());
    const tool = await tools({ env, node, io, command: execute, phase, observation }), root = privateBuildRoot(env);
    await phase('fresh-root', async () => {
      if (!path.isAbsolute(root) || !env.RUNNER_TEMP) throw fail('REFUSED');
      observation.rootState = 'UNKNOWN'; observation.rootCreationEntered = true; observation.rootRetained = null;
      await io.mkdir(root); // refuse reuse; no stale build provenance
      observation.rootCreated = true; observation.rootRetained = true; observation.rootState = 'CREATED';
    });
    await phase('revision', async () => {
      const revision = (await runCommand('revision', 'git', ['rev-parse', 'HEAD'], { keep: true, cap: 1024, ms: 15000, env })).text.trim();
      if (revision !== env.GITHUB_SHA) throw fail('SOURCE_MISMATCH');
      observation.source.revisionVerified = true;
    });
    const before = await phase('source-before', async () => {
      const digest = await source(); observation.source.sourceBeforeMeasured = true; observation.source.sourceBeforeDigest = digest; return digest;
    });
    let buildEnv;
    await phase('install', async () => {
      buildEnv = Object.fromEntries(Object.entries(env).filter(([key]) => !/^electron_|^npm_config_electron_|^npm_config_(arch|platform|target_arch)$|^ELECTRON_|^NODE_OPTIONS$/i.test(key)));
      buildEnv.PATH = [path.dirname(tool.node), path.dirname(tool.bun), env.PATH ?? env.Path ?? ''].join(path.delimiter);
      buildEnv.electron_config_cache = path.join(root, 'electron-cache');
      await runCommand('install', tool.node, [tool.cli, 'install', '--frozen-lockfile'], { env: buildEnv, ms: 600000, cap: 1024 * 1024 });
    });
    const electronPackage = await phase('electron-admission', async () => {
      const packageRoot = await resolveElectron();
      const manifest = JSON.parse(await io.readFile(path.join(packageRoot, 'package.json'), 'utf8'));
      if (manifest.version !== '43.7.5' || manifest.bin?.['install-electron'] !== 'install.js') throw fail('PREREQUISITE_FAILED');
      await ordinaryFile(path.join(packageRoot, 'install.js'), packageRoot, undefined, undefined, io);
      return packageRoot;
    });
    await phase('electron-install', () => runCommand('electron-install', tool.node, [path.join(electronPackage, 'install.js')], { env: buildEnv, ms: 300000, cap: 65536 }));
    await phase('dist-reset', () => io.rm(path.join(REPO, 'apps/server/dist'), { recursive: true, force: true }));
    await phase('server-build', () => runCommand('server-build', tool.node, [tool.cli, '--filter', 'legalwork-server', 'build'], { env: buildEnv, ms: 600000, cap: 1024 * 1024 }));
    await phase('source-after', async () => {
      if (await source() !== before) throw fail('SOURCE_MISMATCH'); observation.source.sourceAfterVerified = true;
    });
    const manifest = {
      schema: 1, revision: env.GITHUB_SHA, source: before, tools: tool, buildSuccess: true,
      dist: await phase('dist-identity', () => dist()),
      electron: await phase('electron-identity', () => electron())
    };
    await phase('manifest-write', () => io.writeFile(path.join(root, 'manifest.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o600 }));
  } catch (error) { primaryError = error; }
  observation.elapsedMeasured = true; observation.elapsedMs = Math.round(performance.now() - started);
  observation.finalized = true; observation.outcome = buildOutcome(observation);
  const frozen = freezeCopy(observation);
  if (primaryError && admitted && publicationAbsent) {
    try { await io.writeFile(publicReceipt, encodePublication('BUILD_PREREQUISITE', frozen), { flag: 'wx', mode: 0o600 }); }
    catch (error) { publicationError = error; }
  }
  return { observation: frozen, primaryError, publicationError };
}
async function buildCi() {
  const result = await runBuildPreparation();
  if (result.primaryError || result.publicationError) throw result.primaryError ?? result.publicationError;
}
export async function verifyBuild(manifest, {
  env = process.env, sourceIdentity: source = sourceIdentity, distIdentity: dist = distIdentity,
  electronIdentity: electron = electronIdentity, ...toolOptions
} = {}) {
  if (manifest?.schema !== 1 || manifest.electron?.cacheRoot !== path.join(privateBuildRoot(env), 'electron-cache') || manifest.revision !== env.GITHUB_SHA || manifest.buildSuccess !== true || manifest.source !== (await source()) || JSON.stringify(manifest.dist) !== JSON.stringify(await dist()) || JSON.stringify(manifest.electron) !== JSON.stringify(await electron(manifest.electron.cacheRoot))) throw fail('BUILD_MISMATCH');
  const current = await tools({ ...toolOptions, env });
  if (JSON.stringify(current) !== JSON.stringify(manifest.tools)) throw fail('BUILD_MISMATCH');
  return sha256(JSON.stringify(manifest));
}

async function runCi() {
  const r = createReceipt(),
    started = performance.now(),
    receipt = path.join(REPO, 'windows-app-start-receipt.json');
  let root, manifest;
  admit();
  if (process.env.LAWOSS_BUILD_CONCLUSION !== 'success') throw fail('REFUSED');
  await assertAbsent(fs, receipt);
  try {
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
  await fs.writeFile(receipt, encodePublication('APP_START', r), {
    flag: 'wx',
    mode: 0o600
  });
  return r.outcome === 'NOT_REPRODUCED' ? 0 : 1;
}
async function validatePublished() {
  const filename = path.join(REPO, 'windows-app-start-receipt.json');
  const stat = await fs.lstat(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > LIMITS.receipt) throw fail('REFUSED');
  validatePublication(await fs.readFile(filename, 'utf8'), { build: process.env.LAWOSS_BUILD_CONCLUSION, app: process.env.LAWOSS_APP_CONCLUSION });
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
