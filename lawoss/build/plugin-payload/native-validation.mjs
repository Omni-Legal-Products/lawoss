// Windows artifact orchestration; SDK acquisition exists only in prime-cache.mjs.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir, realpath, rm, lstat } from 'node:fs/promises';
import { initialize, prepare, runChild } from './prepare.mjs';
import { primeAcceptedCache, ACCEPTED, acceptedArtifacts } from './prime-cache.mjs';
import { preflightTools } from './tools-preflight.mjs';
import { fail, sha256, IMPORTS, canonical, verifyPayload } from './validate.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
export function assertConsumer(value) {
  if (canonical(value?.imports) !== canonical(IMPORTS) || value.native !== 'loaded' || value.guard !== true || value.roundtrip !== true) fail('CONSUMER_INVALID');
}
function parseCounts(tap) {
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const values = [...tap.matchAll(new RegExp(`^# ${key} (\\d+)$`, 'gm'))];
    if (values.length !== 1) fail('TESTS_FAILED'); result[key] = Number(values[0][1]);
  }
  return result;
}
export function testCounts(tap, expected) {
  const result = parseCounts(tap);
  if (result.tests !== expected || result.pass !== expected || result.fail || result.cancelled || result.skipped || result.todo) fail('TESTS_FAILED');
  return result;
}
function consumerProjection(value) {
  if (!Array.isArray(value?.imports) || value.imports.length > 10 || value.imports.some(spec => !IMPORTS.includes(spec)) || !['loaded', 'fallback', 'absent'].includes(value.native) || typeof value.guard !== 'boolean' || typeof value.roundtrip !== 'boolean') fail('CONSUMER_INVALID');
  return { imports: value.imports, native: value.native, guard: value.guard, roundtrip: value.roundtrip };
}
const safeCode = error => /^[A-Z_]{1,40}$/.test(error?.code) ? error.code : 'VALIDATION_FAILED';
async function executableHash(file) {
  const stat = await lstat(file);
  if (!path.isAbsolute(file) || !stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024 * 1024) fail('EXECUTABLE_INVALID');
  return sha256(await readFile(file));
}
export function checkSummary(summary) {
  const keys = ['schema', 'status', 'failedStage', 'code', 'headSha', 'checkoutSha', 'accepted', 'target', 'tools', 'tests', 'acquisition', 'node', 'bun', 'assertions'];
  if (canonical(Object.keys(summary).sort()) !== canonical(keys.sort()) || summary.schema !== 1 || !['complete', 'failed'].includes(summary.status) || !/^[a-f0-9]{40}$/.test(summary.headSha) || !/^[a-f0-9]{40}$/.test(summary.checkoutSha) || canonical(summary.accepted) !== canonical(ACCEPTED) || summary.target.platform !== 'win32' || summary.target.arch !== 'x64') fail('SUMMARY_INVALID');
  const exact = (value, names) => value && canonical(Object.keys(value).sort()) === canonical(names.sort());
  const hash = value => /^[a-f0-9]{64}$/.test(value ?? '');
  const count = value => Number.isSafeInteger(value) && value >= 0;
  if (!exact(summary.tools, ['node', 'arborist', 'pnpm', 'bun']) || !exact(summary.tests, ['unit', 'integration']) || !exact(summary.assertions, ['twoReplayEquality', 'physicalClosure', 'relocation', 'offlineGraph', 'corruptionNegatives', 'unchangedAfterBun']) || Object.values(summary.assertions).some(value => value !== true && value !== 'unknown')) fail('SUMMARY_INVALID');
  if (summary.tools.node !== null && (!exact(summary.tools.node, ['version', 'sha256']) || summary.tools.node.version !== 'v24.21.0' || !hash(summary.tools.node.sha256))) fail('SUMMARY_INVALID');
  if (![null, '9.4.0'].includes(summary.tools.arborist) || ![null, '11.4.0'].includes(summary.tools.pnpm)) fail('SUMMARY_INVALID');
  if (summary.tools.bun !== null && (!exact(summary.tools.bun, ['version', 'revision', 'sha256', 'origin']) || summary.tools.bun.version !== '1.3.14' || !/^[a-zA-Z0-9.+-]{1,100}$/.test(summary.tools.bun.revision) || !hash(summary.tools.bun.sha256) || summary.tools.bun.origin !== 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6')) fail('SUMMARY_INVALID');
  for (const value of Object.values(summary.tests)) if (value !== null && (!exact(value, ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) || Object.values(value).some(number => !count(number) || number > 64))) fail('SUMMARY_INVALID');
  for (const [key, value] of [['node', summary.node], ['bun', summary.bun]]) if (value !== null) {
    if (!exact(value, ['imports', 'native', 'guard', 'roundtrip', ...(key === 'node' ? ['receiptSha256'] : [])])) fail('SUMMARY_INVALID');
    consumerProjection(value); if (key === 'node' && !hash(value.receiptSha256)) fail('SUMMARY_INVALID');
  }
  if (summary.acquisition !== null && (!exact(summary.acquisition, ['records', 'verified', 'totalBytes', 'outcome', 'receiptSha256']) || !['complete', 'incomplete'].includes(summary.acquisition.outcome) || !hash(summary.acquisition.receiptSha256) || ![summary.acquisition.records, summary.acquisition.verified, summary.acquisition.totalBytes].every(count) || summary.acquisition.records !== 32 || summary.acquisition.verified > 32 || summary.acquisition.totalBytes > 512 * 1024 * 1024)) fail('SUMMARY_INVALID');
  if (summary.status === 'complete') {
    if (summary.code !== null || summary.failedStage !== null || Object.values(summary.assertions).some(value => value !== true) || !summary.node || !summary.bun || summary.acquisition?.outcome !== 'complete' || summary.acquisition.verified !== 32 || summary.acquisition.totalBytes > 256 * 1024 * 1024) fail('SUMMARY_INVALID');
    assertConsumer(summary.node); assertConsumer(summary.bun);
    if (!summary.tests.unit || !summary.tests.integration) fail('SUMMARY_INVALID');
    testCounts(Object.entries(summary.tests.unit).map(([key, value]) => `# ${key} ${value}`).join('\n'), 44);
    testCounts(Object.entries(summary.tests.integration).map(([key, value]) => `# ${key} ${value}`).join('\n'), 4);
  } else if (!['admission', 'unit', 'acquisition', 'integration', 'node', 'bun-identity', 'bun'].includes(summary.failedStage) || !/^[A-Z_]{1,40}$/.test(summary.code ?? '')) fail('SUMMARY_INVALID');
  if (Buffer.byteLength(JSON.stringify(summary)) > 65536) fail('SUMMARY_INVALID');
}
async function validateWindows(bunExecutable) {
  const summary = {
    schema: 1, status: 'failed', failedStage: 'admission', code: null,
    headSha: process.env.LAWOSS_PR_HEAD, checkoutSha: process.env.LAWOSS_CHECKOUT_SHA,
    accepted: ACCEPTED, target: { platform: process.platform, arch: process.arch },
    tools: { node: null, arborist: null, pnpm: null, bun: null }, tests: { unit: null, integration: null },
    acquisition: null, node: null, bun: null,
    assertions: { twoReplayEquality: 'unknown', physicalClosure: 'unknown', relocation: 'unknown', offlineGraph: 'unknown', corruptionNegatives: 'unknown', unchangedAfterBun: 'unknown' },
  };
  const output = path.join(HERE, '.work/windows-summary.json');
  let stage = 'admission';
  try {
    if (process.platform !== 'win32' || process.arch !== 'x64' || process.version !== 'v24.21.0' || process.env.LAWOSS_PNPM_VERSION !== '11.4.0') fail('IDENTITY_INVALID');
    await acceptedArtifacts();
    await preflightTools();
    const require = createRequire(new URL('./tools/package.json', import.meta.url));
    summary.tools.node = { version: process.version, sha256: await executableHash(process.execPath) };
    summary.tools.arborist = '9.4.0'; summary.tools.pnpm = process.env.LAWOSS_PNPM_VERSION;
    const base = path.join(HERE, '.work'); await mkdir(base, { recursive: true });
    const workspace = path.join(await realpath(base), 'windows-validation'); await initialize(workspace);
    stage = 'unit';
    const runTests = async (kind, files, expected, timeout, validationWorkspace) => {
      let tap;
      try { tap = await runChild(['--test', '--test-reporter=tap', ...files.map(name => path.join(HERE, name))], workspace, { timeout, json: false, validationWorkspace }); }
      catch (error) { try { summary.tests[kind] = parseCounts(error.output); } catch {} throw error; }
      summary.tests[kind] = parseCounts(tap); testCounts(tap, expected);
    };
    await runTests('unit', ['prepare.test.mjs', 'prime-cache.test.mjs', 'native-validation.test.mjs'], 44, 180000);
    stage = 'acquisition';
    let acquisition;
    try { acquisition = await primeAcceptedCache({ workspace }); }
    catch (error) {
      if (error.progress) summary.acquisition = { ...error.progress, outcome: 'incomplete', receiptSha256: sha256(await readFile(path.join(workspace, 'acquisition.json'))) };
      throw error;
    }
    if (acquisition.records !== 32 || acquisition.verified !== 32 || acquisition.outcome !== 'complete' || acquisition.totalBytes > 256 * 1024 * 1024) fail('ACQUISITION_INVALID');
    summary.acquisition = { records: acquisition.records, verified: acquisition.verified, totalBytes: acquisition.totalBytes, outcome: acquisition.outcome, receiptSha256: sha256(await readFile(path.join(workspace, 'acquisition.json'))) };
    // Network remains denied for the entire remaining Node process and all children.
    await import('./network-guard.mjs');
    stage = 'integration';
    await runTests('integration', ['integration.test.mjs'], 4, 360000, workspace);
    for (const key of ['twoReplayEquality', 'physicalClosure', 'relocation', 'offlineGraph', 'corruptionNegatives']) summary.assertions[key] = true;
    stage = 'node';
    const root = await prepare({ workspace }); const Arborist = require('@npmcli/arborist');
    const manifest = await verifyPayload(root, Arborist);
    summary.node = { ...consumerProjection(manifest.imports), receiptSha256: sha256(await readFile(path.join(root, 'payload-manifest.json'))) }; assertConsumer(summary.node);
    stage = 'bun-identity';
    const bun = await realpath(bunExecutable);
    const hash = await executableHash(bun);
    const version = (await runChild(['--version'], workspace, { executable: bun, runtime: 'bun', timeout: 60000, json: false })).trim();
    if (version !== '1.3.14') fail('BUN_VERSION');
    let revision = 'unknown';
    try { const value = (await runChild(['--revision'], workspace, { executable: bun, runtime: 'bun', timeout: 60000, json: false })).trim(); if (/^[a-zA-Z0-9.+-]{1,100}$/.test(value)) revision = value; } catch { /* Revision is optional; consumer preload is never optional. */ }
    summary.tools.bun = { version, revision, sha256: hash, origin: 'oven-sh/setup-bun@0c5077e51419868618aeaa5fe8019c62421857d6' };
    stage = 'bun';
    const probe = path.join(root, '.payload-import-check.mjs'); let probeIdentity; let primary;
    try {
      await writeFile(probe, await readFile(path.join(HERE, 'import-check.mjs')), { flag: 'wx' }); probeIdentity = await lstat(probe);
      const observation = await runChild([probe, root], workspace, { executable: bun, runtime: 'bun', timeout: 60000 });
      summary.bun = consumerProjection(observation); assertConsumer(summary.bun);
    } catch (error) { primary = error; throw error; }
    finally {
      const current = await lstat(probe).catch(() => null);
      if (probeIdentity && current?.isFile() && current.ino === probeIdentity.ino && current.dev === probeIdentity.dev) await rm(probe).catch(error => { if (!primary) throw error; });
    }
    if (canonical(await verifyPayload(root, Arborist)) !== canonical(manifest) || await executableHash(bun) !== hash) fail('PAYLOAD_DRIFT');
    summary.assertions.unchangedAfterBun = true; summary.status = 'complete'; summary.failedStage = null;
  } catch (error) { summary.failedStage = stage; summary.code = safeCode(error); process.exitCode = 1; }
  checkSummary(summary); await writeFile(output, JSON.stringify(summary), { flag: 'wx' });
  console.log(JSON.stringify({ status: summary.status, failedStage: summary.failedStage, code: summary.code }));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { const [bun, ...extra] = process.argv.slice(2); if (!bun || extra.length) fail('ARGUMENT_INVALID'); await validateWindows(bun); }
  catch (error) { console.error(JSON.stringify({ status: 'failed', code: safeCode(error) })); process.exitCode = 1; }
}
