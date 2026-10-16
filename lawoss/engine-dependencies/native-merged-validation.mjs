// CI entry only. runChild joins direct child close on every settled outcome.
import { mkdir, readFile, writeFile, realpath, lstat, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { initialize, verifyWorkspace, runChild } from '../build/plugin-payload/prepare.mjs';
import { acceptedArtifacts, ACCEPTED } from '../build/plugin-payload/prime-cache.mjs';
import { RUNTIME_LOCK, VERSIONS, METADATA_LIMITS, publicCode, refuse } from './native-merged-cache-worker.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
export const TEST_FILES = Object.freeze(['npm-config.test.mjs', 'dependency-lease.test.mjs', 'prepare-target.test.mjs']);
const failureCodes = new Set(['NODE_VERSION', 'CANCELLED', 'PRIMER_DEADLINE', 'OPERATION_TIMEOUT', 'CHILD_OUTPUT_LIMIT', 'CHILD_FAILED', 'INPUT_DRIFT', 'WORKSPACE_INVALID', 'RECEIPT_INVALID', 'TEST_COUNTS_INVALID', 'TEST_SOURCE_INVALID', 'CLEANUP_FAILED', 'NATIVE_VALIDATION_FAILED']);
export const failureReceipt = error => ({ schema: 1, phase: 'validation', status: 'failed', code: failureCodes.has(error?.code) ? error.code : publicCode(error) !== 'ACQUISITION_FAILED' ? publicCode(error) : 'NATIVE_VALIDATION_FAILED' });
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
  try {
    await initialize(workspace); identity = await lstat(workspace);
    await mkdir(path.join(workspace, 'cache/_cacache'), { mode: 0o700 });
    result = await operation(workspace);
  } catch (error) { primary = error; }
  let cleanupError;
  if (identity) {
    try {
      await verifyWorkspace(workspace);
      const current = await lstat(workspace);
      if (current.ino !== identity.ino || current.dev !== identity.dev) refuse('WORKSPACE_INVALID');
      await cleanup(workspace, { recursive: true });
    } catch (error) { cleanupError = error; }
  }
  if (primary || cleanupError) {
    const error = Object.assign(new Error('NATIVE_VALIDATION_FAILED'), { code: primary?.code ?? 'CLEANUP_FAILED' });
    Object.defineProperty(error, 'private', { value: { primary, cleanup: cleanupError } }); throw error;
  }
  return result;
}
export async function nativeValidation({ signal } = {}) {
  if (process.version !== 'v22.23.2') refuse('NODE_VERSION');
  return ownedValidation(async workspace => {
    await acceptedArtifacts();
    const expected = await Promise.all(TEST_FILES.map(async file => sourceTestCount(await readFile(path.join(here, file), 'utf8'))));
    const deadline = Date.now() + 300000;
    const acquisition = validateAcquisition(await runChild([path.join(here, 'native-merged-cache-worker.mjs'), workspace, String(deadline)], workspace,
      { offline: false, signal, timeout: Math.max(1, deadline - Date.now()) }));
    if (Date.now() >= deadline) refuse('PRIMER_DEADLINE');
    await acceptedArtifacts();
    // runChild's fixed environment intentionally has no arbitrary env passthrough.
    // This owned fixed preload supplies only the test-cache opt-in, never npm config.
    const preload = path.join(workspace, 'accepted-cache.mjs');
    await writeFile(preload, `process.env.LAWOSS_TEST_ACCEPTED_SDK_CACHE = ${JSON.stringify(path.join(workspace, 'cache/_cacache'))};\n`, { flag: 'wx', mode: 0o600 });
    const tap = await runChild(['--import', pathToFileURL(preload).href, '--test', '--test-reporter=tap', ...TEST_FILES.map(file => path.join(here, file))], workspace, { signal, json: false, timeout: 180000 });
    const tests = validateTap(tap, expected.reduce((a, b) => a + b, 0));
    await acceptedArtifacts();
    return { acquisition, tests: { schema: 1, phase: 'tests', status: 'complete', node: process.version, platform: process.platform,
      files: TEST_FILES.length, expectedByFile: expected, ...tests, childClosed: true } };
  });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  try {
    if (process.argv.length !== 2) refuse('NATIVE_VALIDATION_FAILED');
    const result = await nativeValidation({ signal: controller.signal });
    console.log(JSON.stringify(result.acquisition)); console.log(JSON.stringify(result.tests));
  } catch (error) { console.error(JSON.stringify(failureReceipt(error))); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', cancel); process.removeListener('SIGTERM', cancel); }
}
