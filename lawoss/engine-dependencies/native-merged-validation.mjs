// CI entry only. runChild joins direct child close on every settled outcome.
import { mkdir, readFile, realpath, lstat, rm, open } from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { initialize, verifyWorkspace, runChild } from '../build/plugin-payload/prepare.mjs';
import { acceptedArtifacts, ACCEPTED } from '../build/plugin-payload/prime-cache.mjs';
import { RUNTIME_LOCK, VERSIONS, METADATA_LIMITS, publicCode, refuse, OPERATION_RECEIPT, validateOperationReceipt } from './native-merged-cache-worker.mjs';
import { CODES as PROJECTION_CODES, PATHS, LIMITS, FIXTURE_POLICY, canonicalRecordBytes, sha256, inventoryDigest, validateProjectionRequest, validateProjectionFailure, validateProjectionReceipt } from './native-merged-projection-contract.mjs';
import { sourceInventory, writeExclusiveRecord, readBoundedRecord, verifyProjectionArtifacts } from './native-merged-projection-files.mjs';
import { operationScope } from './native-merged-projection-cache.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const TEST_FILES = Object.freeze(['npm-config.test.mjs', 'dependency-lease.test.mjs', 'prepare-target.test.mjs']);
const failureCodes = new Set(['NODE_VERSION', 'CANCELLED', 'PRIMER_DEADLINE', 'OPERATION_TIMEOUT', 'CHILD_OUTPUT_LIMIT', 'CHILD_FAILED', 'INPUT_DRIFT', 'WORKSPACE_INVALID', 'RECEIPT_INVALID', 'TEST_COUNTS_INVALID', 'TEST_SOURCE_INVALID', 'CLEANUP_FAILED', 'NATIVE_VALIDATION_FAILED', 'ACQUISITION_FAILED']);
const phases = new Set(['initialize', 'admission', 'acquisition', 'projection', 'tests', 'cleanup', 'complete']);
function publicProjection(context) {
  try {
    const value = context.projection ?? context.projectionFailure;
    if (!value || canonicalRecordBytes(value).length > LIMITS.receipt) return null;
    return context.projection ? validateProjectionReceipt(value) : validateProjectionFailure(value);
  } catch { return null; }
}
export function failureReceipt(error) {
  const context = error?.private?.context ?? {};
  const child = context.child;
  return { schema: 1, phase: phases.has(context.phase) ? context.phase : 'initialize', status: 'failed',
    code: context.phase === 'projection' ? (PROJECTION_CODES.includes(error?.code) || ['OPERATION_TIMEOUT', 'CHILD_OUTPUT_LIMIT', 'CHILD_FAILED'].includes(error?.code) ? error.code : 'PROJECTION_FAILED') : failureCodes.has(error?.code) ? error.code : publicCode(error) !== 'ACQUISITION_FAILED' ? publicCode(error) : 'NATIVE_VALIDATION_FAILED',
    childClosed: typeof child?.closed === 'boolean' ? child.closed : 'unknown',
    exitCode: Number.isSafeInteger(child?.exitCode) && child.exitCode >= 0 && child.exitCode <= 255 ? child.exitCode : null,
    signal: child?.signal === null ? 'none' : ['SIGTERM', 'SIGKILL', 'SIGINT'].includes(child?.signal) ? child.signal : child?.signal ? 'other' : 'unknown',
    worker: context.worker ?? null, projection: publicProjection(context), tests: context.tests ?? null };
}
export async function readOperationReceipt(workspace, child) {
  if (child?.closed !== true) return null;
  let handle;
  try {
    await verifyWorkspace(workspace);
    const file = path.join(workspace, OPERATION_RECEIPT), before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > 4096) return null;
    handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const same = stat => stat.isFile() && stat.nlink === 1 && stat.ino === before.ino && stat.dev === before.dev && stat.size === before.size && stat.mtimeMs === before.mtimeMs;
    if (!same(await handle.stat())) return null;
    const buffer = Buffer.alloc(4097); let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break; size += bytesRead;
    }
    if (size > 4096 || size !== before.size || !same(await handle.stat()) || !same(await lstat(file))) return null;
    return validateOperationReceipt(JSON.parse(buffer.subarray(0, size).toString('utf8')));
  } catch { return null; } finally { await handle?.close().catch(() => {}); }
}
// Only complete bounded TAP counters and numeric registrations escape. Locations
// must equal a fixed source path and an actual literal test declaration line.
export function failedTap(tap, expected, declarations = []) {
  if (typeof tap !== 'string' || Buffer.byteLength(tap) > 65536 || !Number.isSafeInteger(expected) || expected < 1 || expected > 1000) return null;
  const summary = {};
  for (const key of ['tests', 'suites', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    if (matches.length !== 1) return null;
    summary[key] = Number(matches[0][1]);
    if (!Number.isSafeInteger(summary[key]) || summary[key] > expected) return null;
  }
  const plans = [...tap.matchAll(/^1\.\.(\d+)$/gm)];
  const results = [...tap.matchAll(/^(not ok|ok) (\d+) - .*$/gm)];
  if (plans.length !== 1 || Number(plans[0][1]) !== expected || summary.tests !== expected || summary.suites !== 0 ||
      results.length !== expected || results.some((r, i) => Number(r[2]) !== i + 1) ||
      summary.pass + summary.fail + summary.cancelled + summary.skipped + summary.todo !== expected || summary.fail === 0 ||
      summary.skipped !== 0 || summary.todo !== 0 || summary.cancelled !== 0 || results.filter(r => r[1] === 'not ok').length !== summary.fail) return null;
  const failures = results.filter(r => r[1] === 'not ok').map(r => {
    const next = results.find(candidate => candidate.index > r.index)?.index ?? tap.length;
    const end = tap.indexOf('\n  ...', r.index);
    const block = end < 0 || end >= next ? '' : tap.slice(r.index, end);
    const locations = [...block.matchAll(/^  location: '([^'\n]+):(\d+):(\d+)'$/gm)];
    let source = 'unknown', line = null, column = null;
    if (locations.length === 1) {
      const [, file, l, c] = locations[0], index = TEST_FILES.findIndex(name => file === path.join(here, name));
      if (index >= 0 && declarations[index]?.has(Number(l)) && Number(c) > 0 && Number(c) <= 4096) {
        source = ['config', 'lease', 'target'][index]; line = Number(l); column = Number(c);
      }
    }
    return { source, registration: Number(r[2]), line, column };
  });
  return { plan: expected, ...summary, failures };
}
export function retainAcquisition(value, context, onAcquisition) {
  if (context.child?.closed !== true || context.child.exitCode !== 0) refuse('RECEIPT_INVALID');
  const receipt = validateAcquisition(value);
  context.acquisition = receipt; onAcquisition(receipt); return receipt;
}
export async function validationChild(args, workspace, options, context, declarations = []) {
  context.child = { closed: false }; context.activeChild = true;
  try {
    const value = await runChild(args, workspace, options);
    context.child = { closed: true, exitCode: 0, signal: null }; context.activeChild = false;
    return value;
  } catch (error) {
    context.child = error.child ?? {}; context.activeChild = error.child?.closed !== true;
    if (context.phase === 'acquisition') {
      context.worker = await readOperationReceipt(workspace, error.child);
      if (context.worker && error.code === 'CHILD_FAILED') error.code = context.worker.code;
    } else if (context.phase === 'projection') {
      // runChild's stderr parser is not an authority for projection error codes.
      if (!['CANCELLED', 'OPERATION_TIMEOUT', 'CHILD_OUTPUT_LIMIT'].includes(error.code)) error.code = 'CHILD_FAILED';
      context.projectionFailure = await readProjectionFailure(workspace, error.child, context.projectionNonce);
      if (context.projectionFailure && error.code === 'CHILD_FAILED') error.code = context.projectionFailure.code;
    } else if (context.phase === 'tests' && error.child?.closed === true) context.tests = failedTap(error.output, context.expected, declarations);
    throw error;
  }
}
export function validateAcquisition(value) {
  const expected = { schema: 1, phase: 'acquisition', status: 'complete', ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK,
    node: 'v22.23.2', platform: process.platform, versions: VERSIONS,
    tarballs: 32, names: 32, metadata: 64, offline: 64, archiveBytes: value?.archiveBytes, metadataBytes: value?.metadataBytes };
  if (!isDeepStrictEqual(value, expected) || !Number.isSafeInteger(value.archiveBytes) || value.archiveBytes <= 0 || value.archiveBytes > 256 * 1024 * 1024 || !Number.isSafeInteger(value.metadataBytes) || value.metadataBytes <= 0 || value.metadataBytes > METADATA_LIMITS.totalBytes) refuse('RECEIPT_INVALID');
  return value;
}
// Narrow source registration grammar used by these three fixed suites: literal
// tests and template tests inside literal-array for-of loops. Unknown forms fail
// closed rather than reducing the expected count. Bodies are never executed.
export function sourceTestCount(source) {
  const lines = source.split('\n'); let count = 0, registrations = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(\s*)test\((['"`])/);
    if (!match) continue;
    registrations++;
    if (match[2] !== '`') { count++; continue; }
    let indent = match[1].length, multiplier = 1;
    while (indent > 0) {
      let found = false;
      for (let j = i - 1; j >= 0; j--) {
        const loop = lines[j].match(/^(\s*)for \(const \w+ of (\[[^\]]+\])\) \{$/);
        if (!loop || loop[1].length !== indent - 2) continue;
        let items; try { items = JSON.parse(loop[2].replace(/'/g, '"')); } catch { refuse('TEST_SOURCE_INVALID'); }
        if (!Array.isArray(items) || !items.length || items.some(v => !['string', 'boolean'].includes(typeof v))) refuse('TEST_SOURCE_INVALID');
        multiplier *= items.length; indent -= 2; found = true; break;
      }
      if (!found) refuse('TEST_SOURCE_INVALID');
    }
    count += multiplier;
  }
  if (!count || registrations !== (source.match(/\btest\(/g) ?? []).length) refuse('TEST_SOURCE_INVALID');
  return count;
}
export function validateTap(tap, expected) {
  if (typeof tap !== 'string' || tap.includes('not ok ') || /^ok .*# (?:SKIP|TODO)\b/im.test(tap)) refuse('TEST_COUNTS_INVALID');
  const get = name => {
    const hits = [...tap.matchAll(new RegExp(`^# ${name} (\\d+)$`, 'gm'))];
    if (hits.length !== 1) refuse('TEST_COUNTS_INVALID');
    return Number(hits[0][1]);
  };
  if (get('tests') !== expected || get('pass') !== expected || ['fail', 'cancelled', 'skipped', 'todo'].some(key => get(key) !== 0) || get('suites') !== 0 || [...tap.matchAll(/^ok \d+ - /gm)].length !== expected || !tap.includes(`\n1..${expected}\n`)) refuse('TEST_COUNTS_INVALID');
  return { tests: expected, pass: expected, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
}
export async function ownedValidation(operation, { parent = path.join(here, '.work'), cleanup = rm } = {}) {
  await mkdir(parent, { recursive: true, mode: 0o700 });
  parent = await realpath(parent);
  const workspace = path.join(parent, `native-merged-${randomUUID()}`);
  let identity, primary, result;
  const context = { phase: 'initialize' };
  try {
    await initialize(workspace); identity = await lstat(workspace);
    await mkdir(path.join(workspace, 'cache/_cacache'), { mode: 0o700 });
    result = await operation(workspace, context);
  } catch (error) { primary = error; }
  let cleanupError;
  if (identity && !context.activeChild) {
    if (!primary) context.phase = 'cleanup';
    try {
      await verifyWorkspace(workspace);
      const current = await lstat(workspace);
      if (current.ino !== identity.ino || current.dev !== identity.dev) refuse('WORKSPACE_INVALID');
      await cleanup(workspace, { recursive: true });
    } catch (error) { cleanupError = error; }
  }
  if (primary || cleanupError) {
    const error = Object.assign(new Error('NATIVE_VALIDATION_FAILED'), { code: primary ? primary.code ?? 'NATIVE_VALIDATION_FAILED' : 'CLEANUP_FAILED' });
    Object.defineProperty(error, 'private', { value: { primary, cleanup: cleanupError, context } }); throw error;
  }
  context.phase = 'complete';
  return result;
}
// The original acquisition allowance is absolute, never renewed by settlement.
function remaining(deadline, signal) {
  if (signal?.aborted) refuse('CANCELLED');
  const value = deadline - Date.now();
  if (!Number.isSafeInteger(deadline) || value <= 0 || value > 300000) refuse('PRIMER_DEADLINE');
  return value;
}
export async function prepareProjectionRequest(workspace, acquisition, deadline, signal) {
  remaining(deadline, signal);
  const scope = operationScope(deadline, signal);
  try {
    const sources = await scope.run(() => sourceInventory({ scope }));
    const request = validateProjectionRequest({ schema: 1, policy: FIXTURE_POLICY, nonce: randomUUID(), deadline,
      rawAcquisition: acquisition, rawAcquisitionSha256: sha256(canonicalRecordBytes(acquisition)), sourceInventorySha256: inventoryDigest(sources) });
    await scope.run(() => writeExclusiveRecord(path.join(workspace, PATHS.request), request, LIMITS.request, { scope }));
    scope.check();
    return { request, sources };
  } catch (error) { scope.check(); throw error; }
  finally { await scope.drain(); scope.dispose(); }
}
export async function readProjectionFailure(workspace, child, expectedNonce) {
  if (child?.closed !== true) return null;
  try {
    await verifyWorkspace(workspace);
    const value = validateProjectionFailure(await readBoundedRecord(path.join(workspace, PATHS.failure), LIMITS.failure));
    // The worker keeps nonce null only before admitting its request in admission.
    if (value.nonce === null ? value.stage !== 'admission' : value.nonce !== expectedNonce) return null;
    return value;
  } catch { return null; }
}
async function publishAcceptedPreload(workspace, admitted, scope) {
  const preload = path.join(workspace, 'accepted-cache.mjs');
  let handle, primary;
  try {
    await scope.run(async () => { handle = await open(preload, 'wx', 0o600); });
    await scope.run(() => handle.writeFile(`process.env.LAWOSS_TEST_ACCEPTED_SDK_CACHE = ${JSON.stringify(admitted.cache)};\n`));
  } catch (error) { primary = error; }
  finally {
    if (handle) try { await handle.close(); } catch (error) {
      if (primary) Object.defineProperty(primary, 'closeError', { value: error });
      else primary = error;
    }
  }
  if (primary) throw primary;
  scope.check();
  return preload;
}
export async function projectionThenTests(workspace, context, prepared, testPlan, { signal, onProjection = () => {} } = {}) {
  context.phase = 'projection'; context.child = undefined;
  const { request, sources } = prepared;
  validateProjectionRequest(request);
  context.projectionNonce = request.nonce;
  const deadline = request.deadline;
  if (!isDeepStrictEqual(testPlan.expected, [8, 25, 14]) || !Array.isArray(testPlan.declarations) || testPlan.declarations.length !== TEST_FILES.length || testPlan.declarations.some(rows => !(rows instanceof Set))) refuse('TEST_SOURCE_INVALID');
  let scope, preload;
  try {
    // Let validationChild own launch uncertainty even for a pre-aborted signal.
    const timeout = remaining(deadline);
    const receipt = await validationChild([path.join(here, 'native-merged-cache-projection-worker.mjs'), workspace, String(deadline)], workspace,
      { offline: true, signal, timeout }, context);
    remaining(deadline, signal);
    scope = operationScope(deadline, signal);
    const admitted = await scope.run(() => verifyProjectionArtifacts(workspace, receipt, request, sources, { signal }));
    context.projection = admitted.receipt;
    await scope.run(() => onProjection(admitted.receipt));
    await scope.run(() => acceptedArtifacts());
    preload = await publishAcceptedPreload(workspace, admitted, scope);
    scope.check();
  } finally { if (scope) { await scope.drain(); scope.dispose(); } }
  remaining(deadline, signal);
  context.phase = 'tests'; context.child = undefined;
  const { expected, declarations } = testPlan;
  context.expected = expected.reduce((a, b) => a + b, 0);
  const tap = await validationChild(['--import', pathToFileURL(preload).href, '--test', '--test-reporter=tap', ...TEST_FILES.map(file => path.join(here, file))], workspace, { signal, json: false, timeout: 180000 }, context, declarations);
  const tests = validateTap(tap, context.expected);
  await acceptedArtifacts();
  return { acquisition: context.acquisition, projection: context.projection,
    tests: { schema: 1, phase: 'tests', status: 'complete', node: process.version, platform: process.platform,
      files: TEST_FILES.length, expectedByFile: expected, ...tests, childClosed: true } };
}
export async function nativeValidation({ signal, onAcquisition = () => {}, onProjection = () => {} } = {}) {
  if (process.version !== 'v22.23.2') refuse('NODE_VERSION');
  return ownedValidation(async (workspace, context) => {
    context.phase = 'admission';
    await acceptedArtifacts();
    const expected = await Promise.all(TEST_FILES.map(async file => sourceTestCount(await readFile(path.join(here, file), 'utf8'))));
    const declarations = await Promise.all(TEST_FILES.map(async file => new Set((await readFile(path.join(here, file), 'utf8')).split('\n').flatMap((line, i) => /^\s*test\(/.test(line) ? [i + 1] : []))));
    if (!isDeepStrictEqual(expected, [8, 25, 14])) refuse('TEST_SOURCE_INVALID');
    context.expected = expected.reduce((a, b) => a + b, 0);
    context.phase = 'acquisition';
    const deadline = Date.now() + 300000;
    const acquisition = retainAcquisition(await validationChild([path.join(here, 'native-merged-cache-worker.mjs'), workspace, String(deadline)], workspace,
      { offline: false, signal, timeout: remaining(deadline, signal) }, context), context, onAcquisition);
    context.phase = 'projection'; context.child = undefined;
    remaining(deadline, signal);
    const prepared = await prepareProjectionRequest(workspace, acquisition, deadline, signal);
    remaining(deadline, signal);
    return projectionThenTests(workspace, context, prepared, { expected, declarations }, { signal, onProjection });
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (process.argv.length !== 2) refuse('NATIVE_VALIDATION_FAILED');
    const result = await nativeValidation({ signal: controller.signal, onAcquisition: receipt => console.log(JSON.stringify(receipt)), onProjection: receipt => console.log(JSON.stringify(receipt)) });
    console.log(JSON.stringify(result.tests));
  } catch (error) { console.error(JSON.stringify(failureReceipt(error))); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
