// Independent, after-failure API observation. Never an acceptance or cause proof.
import { createHash, randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { constants } from 'node:fs';
import { lstat, mkdir, mkdtemp, open, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { validateBuildInfo } from '../../../apps/desktop/electron/build-info.mjs';
import { alphaStartupPhases } from '../../../apps/desktop/electron/lawoss-startup-checkpoints.mjs';
import { prepareAcceptanceProfile, ownedProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { nativeAppEnvironment } from './native-app.mjs';
import { launchWindowsJob } from './windows-job.mjs';
import { documentsProbeCases, readDocumentsProbeJson } from './windows-documents-probe-child.mjs';

const own = (value, name) => {
  try { const field = value && Object.getOwnPropertyDescriptor(value, name); return field && Object.hasOwn(field, 'value') ? field.value : undefined; }
  catch { return undefined; }
};
const refuse = () => { throw Object.assign(new Error('windows-documents-probe-refused'), { code: 'windows-documents-probe-refused' }); };
const phases = new Set(alphaStartupPhases.map(phase => `startup-${phase}`));
function failureContext(failure, { platform = process.platform, arch = process.arch, environment = process.env } = {}) {
  if (platform !== 'win32' || !['x64', 'arm64'].includes(arch) || own(environment, 'GITHUB_ACTIONS') !== 'true' || own(environment, 'RUNNER_ENVIRONMENT') !== 'github-hosted' ||
    own(failure, 'kind') !== 'lawoss-ci-native-startup' || own(failure, 'status') !== 'failed' || own(failure, 'reason') !== 'native-startup-unverified') return null;
  const diagnostic = own(failure, 'diagnostic'), readiness = own(diagnostic, 'nativeReadiness');
  const current = own(own(diagnostic, 'mainLog'), 'current'), categories = own(current, 'categories');
  const length = own(categories, 'length'), attempts = own(readiness, 'attempts'), bytes = own(current, 'scannedBytes');
  if (own(diagnostic, 'phase') !== 'launch' || own(diagnostic, 'errorCode') !== 'native-readiness-timeout' || own(diagnostic, 'cleanup') !== 'native-verified' ||
    own(readiness, 'progress') !== 'none' || own(readiness, 'lastBoundary') !== 'discovery' || own(readiness, 'lastError') !== 'ENOENT' ||
    !Number.isSafeInteger(attempts) || attempts < 1 || attempts > 128 || typeof own(readiness, 'attemptsCapped') !== 'boolean' ||
    own(current, 'availability') !== 'read' || own(current, 'truncated') !== false || !Number.isSafeInteger(bytes) || bytes < 1 || bytes > 65536 ||
    !Array.isArray(categories) || !Number.isSafeInteger(length) || length < 1 || length > 32) return null;
  const values = Array.from({ length }, (_, index) => own(categories, String(index)));
  if (!values.every(value => phases.has(value)) || !values.includes('startup-runtime-home-returned') || values.includes('startup-runtime-documents-returned')) return null;
  return Object.freeze({ phase: 'launch', errorCode: 'native-readiness-timeout', cleanup: 'native-verified', lastBoundary: 'discovery', lastError: 'ENOENT', mainLogBytes: bytes });
}
export const shouldRunWindowsDocumentsProbe = (failure, context) => failureContext(failure, context) !== null;

function record(value, fixture, arch, entered = false) {
  const keys = ['schema', 'nonce', 'caseId', 'electron', 'arch', 'phase', 'beforeReady',
    ...(entered ? [] : ['outcome', 'scope', 'durationMs', 'durationCapped', 'errorName', 'errorCode'])];
  const fields = value && Object.getOwnPropertyDescriptors(value);
  if (!fields || Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) refuse();
  const data = Object.fromEntries(keys.map(key => [key, fields[key].value]));
  if (data.schema !== 1 || data.nonce !== fixture.nonce || data.caseId !== fixture.caseId || data.electron !== '43.7.5' || data.arch !== arch ||
    ![true, false, null].includes(data.beforeReady) || !['user-data-setup', 'logs-setup', 'documents-override', 'userData', 'home', 'ready-state', 'record-entered', 'documents'].includes(data.phase)) refuse();
  if (entered) { if (data.phase !== 'documents' || data.beforeReady === null) refuse(); }
  else if (!['returned', 'threw', 'before-documents-failure'].includes(data.outcome) ||
    !['inside-owned-root', 'outside-owned-root', 'not-absolute', 'not-string', 'oversized', 'not-observed'].includes(data.scope) ||
    !['none', 'Error', 'TypeError', 'other'].includes(data.errorName) || !['none', 'ENOENT', 'EACCES', 'EPERM', 'other'].includes(data.errorCode) ||
    typeof data.durationCapped !== 'boolean' || (data.durationMs !== null && (!Number.isSafeInteger(data.durationMs) || data.durationMs < 0 || data.durationMs > 60000)) ||
    ((data.outcome === 'returned' || data.outcome === 'threw') && (data.phase !== 'documents' || data.beforeReady === null || data.durationMs === null)) ||
    (data.outcome === 'before-documents-failure' && (data.phase === 'documents' || data.durationMs !== null || data.durationCapped)) ||
    (data.durationCapped && data.durationMs !== 60000) ||
    (data.outcome === 'returned' && (data.scope === 'not-observed' || data.errorName !== 'none' || data.errorCode !== 'none')) ||
    (data.outcome !== 'returned' && data.scope !== 'not-observed')) refuse();
  const { nonce, ...finite } = data;
  return Object.freeze(finite);
}
const absent = async file => { try { await lstat(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } };
const childFile = fileURLToPath(new URL('./windows-documents-probe-child.mjs', import.meta.url));
const unavailable = caseId => ({ caseId, status: 'unavailable', outcome: 'not-run', beforeReady: null, scope: 'not-observed', apiElapsedMs: null,
  apiElapsedCapped: false, errorName: 'none', errorCode: 'other', parentObservationElapsedMs: 0, jobRunningBeforeStop: null, cleanup: 'not-started' });

export function documentsProbeStatus(cases, sourceStable) {
  return sourceStable === true && Array.isArray(cases) && own(cases, 'length') === documentsProbeCases.length &&
    documentsProbeCases.every((caseId, index) => {
      const result = own(cases, String(index));
      return own(result, 'caseId') === caseId && own(result, 'status') === 'observed' && own(result, 'cleanup') === 'verified';
    }) ? 'observed' : 'incomplete';
}

/** Collector seam: modeled drivers are unit evidence only, never public proof. */
export async function collectWindowsDocumentsCase({ fixture, executable, env, arch }, { launch = launchWindowsJob, now = () => performance.now(), pause = delay } = {}) {
  const result = unavailable(fixture.caseId);
  let job, started;
  try {
    job = await launch({ executable, args: [childFile, path.join(fixture.root, 'documents-probe-input.json')], cwd: fixture.root, env, timeoutMs: 15000 });
    started = now();
    const final = path.join(fixture.root, 'documents-result.json');
    while (true) {
      if (!await absent(final)) {
        const observed = record(readDocumentsProbeJson(final), fixture, arch);
        Object.assign(result, { status: 'observed', outcome: observed.outcome, beforeReady: observed.beforeReady, scope: observed.scope,
          apiElapsedMs: observed.durationMs, apiElapsedCapped: observed.durationCapped, errorName: observed.errorName, errorCode: observed.errorCode });
        break;
      }
      if (!job.isRunning()) { result.outcome = 'root-unavailable'; break; }
      const remaining = 15000 - (now() - started);
      if (remaining <= 0) {
        const file = path.join(fixture.root, 'documents-entered.json');
        const entered = await absent(file) ? null : record(readDocumentsProbeJson(file), fixture, arch, true);
        Object.assign(result, { status: 'observed', outcome: entered ? 'entered-timeout' : 'not-entered-timeout',
          beforeReady: entered?.beforeReady ?? null, errorCode: 'none' });
        break;
      }
      await pause(Math.min(20, remaining));
    }
  } catch { result.errorCode = 'probe-unavailable'; }
  finally {
    if (started !== undefined) result.parentObservationElapsedMs = Math.min(60000, Math.max(0, Math.round(now() - started)));
    if (job) {
      try { result.jobRunningBeforeStop = job.isRunning(); } catch { /* Observation must not bypass owned stop. */ }
      try {
        const stopped = await job.stop();
        result.cleanup = stopped.status === 'stopped' && stopped.descendantClosure === 'verified' && stopped.method === 'windows-atomic-job-object' ? 'verified' : 'unverified';
      } catch { result.cleanup = 'unverified'; }
    } else result.cleanup = 'unverified';
  }
  return Object.freeze(result);
}
async function physical(root) {
  const stat = await lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink() || await realpath(root) !== root) refuse();
  return stat;
}
async function hashFile(file) {
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 512 * 1024 * 1024 || await realpath(file) !== file) refuse();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const equal = stat => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => stat[key] === before[key]);
    if (!equal(await handle.stat())) refuse();
    const hash = createHash('sha256'); let bytes = 0;
    for await (const chunk of handle.createReadStream({ start: 0, end: before.size - 1, autoClose: false })) { bytes += chunk.length; hash.update(chunk); }
    if (bytes !== before.size || !equal(await handle.stat()) || !equal(await lstat(file)) || await realpath(file) !== file) refuse();
    return hash.digest('hex');
  } finally { await handle.close(); }
}
export async function readElectronPackageMetadata(file) {
  // Read-only installed package metadata may share pnpm-store hardlinks. This
  // exception does not apply to executables, private inputs or result records.
  const before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink < 1 || before.size < 1 || before.size > 8192 || await realpath(file) !== file) refuse();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const equal = stat => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => stat[key] === before[key]);
    if (!equal(await handle.stat())) refuse();
    const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
    if (bytesRead !== before.size || !equal(await handle.stat()) || !equal(await lstat(file)) || await realpath(file) !== file) refuse();
    const data = bytes.subarray(0, bytesRead), text = data.toString('utf8');
    if (!Buffer.from(text).equals(data)) refuse();
    const metadata = JSON.parse(text);
    if (metadata?.name !== 'electron' || metadata.version !== '43.7.5') refuse();
    return Object.freeze({ version: metadata.version, sha256: createHash('sha256').update(data).digest('hex') });
  } finally { await handle.close(); }
}
const sourceFiles = ['windows-documents-probe.mjs', 'windows-documents-probe-child.mjs', 'native-app.mjs', 'windows-job.mjs', 'windows-job.ps1',
  '../../../apps/desktop/electron/runtime.mjs', '../../../apps/desktop/electron/main.mjs'];
async function sourceHashes() {
  return Object.fromEntries(await Promise.all(sourceFiles.map(async name => [name, await hashFile(fileURLToPath(new URL(name, import.meta.url)))])));
}

export async function runWindowsDocumentsProbe({ originalFailure, temporaryRoot, expectedBuild, output }) {
  const originalContext = failureContext(originalFailure);
  if (!originalContext || process.version !== 'v24.21.0') refuse();
  const fields = expectedBuild && Object.getOwnPropertyDescriptors(expectedBuild);
  const keys = ['schemaVersion', 'product', 'version', 'gitSha', 'buildEpoch', 'platform', 'arch', 'channel', 'workflowRunUrl'];
  if (!fields || Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value') ||
    (key === 'schemaVersion' ? fields[key].value !== 1 : typeof fields[key].value !== 'string' || fields[key].value.length > 4096))) refuse();
  const build = Object.freeze(validateBuildInfo(Object.fromEntries(keys.map(key => [key, fields[key].value]))));
  if (build.platform !== 'win32' || build.arch !== process.arch || typeof temporaryRoot !== 'string' ||
    typeof process.env.RUNNER_TEMP !== 'string' || !path.isAbsolute(process.env.RUNNER_TEMP) ||
    temporaryRoot !== await realpath(process.env.RUNNER_TEMP) || output !== path.join(temporaryRoot, `windows-documents-probe-${process.arch}.json`)) refuse();
  const temporary = await physical(temporaryRoot);
  if (!await absent(output)) refuse();
  const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
  const packageFile = await realpath(require.resolve('electron/package.json'));
  const packageMetadata = await readElectronPackageMetadata(packageFile);
  const executable = path.join(path.dirname(packageFile), 'dist/electron.exe');
  const executableSha256 = await hashFile(executable), packageSha256 = packageMetadata.sha256, sources = await sourceHashes();
  const scratch = await mkdtemp(path.join(temporaryRoot, 'lawoss-documents-probe-'));
  const results = [];
  for (const caseId of documentsProbeCases) {
    if (results.some(result => result.cleanup !== 'verified')) { results.push(Object.freeze(unavailable(caseId))); continue; }
    try {
      const root = path.join(scratch, caseId), profile = await prepareAcceptanceProfile({ root, kind: 'fresh' }), before = await physical(root);
      for (const name of ['userdata', 'runtime', 'workspace', 'home', 'config', 'data', 'cache', 'tmp']) await mkdir(path.join(root, name), { mode: 0o700 });
      if (caseId === 'home-documents-present') await mkdir(path.join(root, 'home/Documents'), { mode: 0o700 });
      if (caseId === 'explicit-documents-control') await mkdir(path.join(root, 'documents'), { mode: 0o700 });
      const fixture = { schema: 1, root, owner: profile.owner, nonce: randomBytes(32).toString('hex'), caseId };
      await writeFile(path.join(root, 'documents-probe-input.json'), JSON.stringify(fixture), { flag: 'wx', mode: 0o600 });
      // Same path environment in every case; two fixed CI admission flags are
      // added only for this diagnostic child's own standalone entry guard.
      const env = { ...nativeAppEnvironment(root), GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
      const observed = await collectWindowsDocumentsCase({ fixture, executable, env, arch: process.arch });
      const after = await physical(root);
      if (before.dev !== after.dev || before.ino !== after.ino || (await ownedProfile(root, 'fresh')).owner !== profile.owner) refuse();
      results.push(observed);
    } catch { results.push(Object.freeze({ ...unavailable(caseId), cleanup: 'unverified', errorCode: 'probe-unavailable' })); }
  }
  let sourceStable = false;
  try { sourceStable = JSON.stringify(sources) === JSON.stringify(await sourceHashes()) && executableSha256 === await hashFile(executable) && packageSha256 === (await readElectronPackageMetadata(packageFile)).sha256; } catch {}
  const afterTemporary = await physical(temporaryRoot);
  if (temporary.dev !== afterTemporary.dev || temporary.ino !== afterTemporary.ino) refuse();
  const result = { schema: 1, kind: 'lawoss-windows-documents-diagnostic', status: documentsProbeStatus(results, sourceStable),
    acceptance: 'not-asserted', cause: 'not-asserted', build, electron: { version: '43.7.5', executableSha256, packageSha256 }, sources, sourceStable,
    originalFailure: originalContext, plannedCases: 3, cases: results };
  const text = JSON.stringify(result, null, 2) + '\n';
  if (Buffer.byteLength(text) > 32768) refuse();
  await writeFile(output, text, { flag: 'wx', mode: 0o600 });
  return Object.freeze(result);
}
