// Native CI/build validation only. This entry never installs into an app profile
// or starts an engine. The SDK cache and payload belong to a fresh owned workspace.
import { createRequire } from 'node:module';
import { lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initialize, prepare, runChild } from './prepare.mjs';
import { primeAcceptedCache, ACCEPTED } from './prime-cache.mjs';
import { assertConsumer, testCounts } from './native-validation.mjs';
import { preflightTools } from './tools-preflight.mjs';
import { verifyPayload, sha256, fail } from './validate.mjs';
import { validatePnpm } from '../../engine-dependencies/package-runtime.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const sources = ['validate.mjs', 'prepare.mjs', 'worker.mjs', 'import-check.mjs',
  'prime-cache.mjs', 'prime-transfer.mjs', 'network-guard.mjs', 'tools-preflight.mjs',
  'native-validation.mjs', 'native-validation.test.mjs', 'prepare.test.mjs', 'prime-cache.test.mjs',
  '../../engine-dependencies/package-runtime.mjs',
  'runtime-consumer-validation.mjs', 'runtime-consumer.test.mjs',
  'runtime-consumer.integration.test.mjs', 'tools/package.json', 'tools/pnpm-lock.yaml',
  'sdk/package.json', 'sdk/package-lock.json'];
const sourceHashes = async () => Object.fromEntries(await Promise.all(sources.map(async name => [name, sha256(await readFile(path.join(HERE, name)))])));
export function runtimeConsumerFailureCode(error) {
  try {
    const code = error?.code;
    return typeof code === 'string' && /^[A-Z_]{1,40}$/.test(code) ? code : 'VALIDATION_FAILED';
  } catch { return 'VALIDATION_FAILED'; }
}
async function executable(input) {
  if (typeof input !== 'string' || !path.isAbsolute(input)) fail('EXECUTABLE_INVALID');
  const resolved = await realpath(input);
  const stat = await lstat(resolved);
  if (!stat.isFile() || stat.size === 0 || stat.size > 256 * 1024 * 1024) fail('EXECUTABLE_INVALID');
  return { path: resolved, sha256: sha256(await readFile(resolved)) };
}

export async function validateRuntimeConsumer(consumerNode, pnpmCli) {
  const summary = {
    schema: 1, kind: 'plugin-sdk-runtime-consumer', status: 'failed', failedStage: 'admission', code: null,
    headSha: null, checkoutSha: null, target: { platform: process.platform, arch: process.arch },
    accepted: ACCEPTED, sources: null, producer: null, consumer: null,
    acquisition: null, tests: { producer: null, consumer: null }, payloadManifestSha256: null,
    assertions: { producerVerified: false, nativeLoaded: false, consumerVerified: false, unchanged: false },
    scope: 'dependency compatibility only; no product hook, engine startup or installed-application acceptance',
  };
  let stage = 'admission';
  const base = path.join(HERE, '.work');
  let workspace;
  try {
    if (process.version !== 'v24.21.0' || !['darwin', 'linux', 'win32'].includes(process.platform) || !['x64', 'arm64'].includes(process.arch)) fail('IDENTITY_INVALID');
    for (const [field, name] of [['headSha', 'LAWOSS_PR_HEAD'], ['checkoutSha', 'LAWOSS_CHECKOUT_SHA']]) {
      const value = process.env[name];
      if (!/^[a-f0-9]{40}$/.test(value ?? '')) fail('IDENTITY_INVALID');
      summary[field] = value;
    }
    if (process.platform === 'linux') summary.target.libc = process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
    summary.sources = await sourceHashes();
    const consumer = await executable(consumerNode);
    const producer = await executable(process.execPath);
    const pnpm = await validatePnpm(pnpmCli);
    await mkdir(base, { recursive: true });
    workspace = path.join(await realpath(base), 'runtime-consumer-validation');
    await initialize(workspace); // Existing runs are refused rather than refreshed.
    const version = (await runChild(['--version'], workspace, { executable: consumer.path, json: false, timeout: 10000 })).trim();
    if (version !== 'v22.23.2') fail('CONSUMER_VERSION');
    summary.producer = { version: process.version, sha256: producer.sha256 };
    summary.consumer = { version, sha256: consumer.sha256 };

    stage = 'tools';
    await runChild([pnpm, '--dir', path.join(HERE, 'tools'), 'install', '--prod=false',
      '--ignore-workspace', '--ignore-scripts', '--frozen-lockfile', '--registry=https://registry.npmjs.org/',
      '--store-dir', path.join(workspace, 'tool-store'),
      `--config.cache-dir=${path.join(workspace, 'tool-cache')}`,
      `--config.state-dir=${path.join(workspace, 'tool-state')}`], workspace, { offline: false, json: false });
    await preflightTools();

    stage = 'producer-tests';
    const producerTap = await runChild(['--test', '--test-reporter=tap', ...[
      'prepare.test.mjs', 'prime-cache.test.mjs', 'native-validation.test.mjs', 'runtime-consumer.test.mjs',
    ].map(name => path.join(HERE, name))], workspace, { json: false });
    summary.tests.producer = testCounts(producerTap, 46);

    stage = 'acquisition';
    const acquired = await primeAcceptedCache({ workspace });
    summary.acquisition = { records: acquired.records, verified: acquired.verified,
      totalBytes: acquired.totalBytes, outcome: acquired.outcome,
      receiptSha256: sha256(await readFile(path.join(workspace, 'acquisition.json'))) };
    if (acquired.records !== 32 || acquired.verified !== 32 || acquired.outcome !== 'complete') fail('ACQUISITION_INVALID');
    await import('./network-guard.mjs');

    stage = 'producer';
    const payload = await prepare({ workspace });
    const require = createRequire(new URL('./tools/package.json', import.meta.url));
    const before = await verifyPayload(payload, require('@npmcli/arborist'));
    assertConsumer(before.imports);
    summary.payloadManifestSha256 = sha256(await readFile(path.join(payload, 'payload-manifest.json')));
    summary.assertions.producerVerified = true;
    summary.assertions.nativeLoaded = true;

    stage = 'consumer';
    const consumerTap = await runChild(['--test', '--test-reporter=tap', path.join(HERE, 'runtime-consumer.integration.test.mjs')],
      workspace, { executable: consumer.path, json: false, timeout: 120000, validationWorkspace: workspace });
    summary.tests.consumer = testCounts(consumerTap, 5);
    summary.assertions.consumerVerified = true;

    stage = 'postflight';
    if (JSON.stringify(before) !== JSON.stringify(await verifyPayload(payload, require('@npmcli/arborist'))) ||
      JSON.stringify(summary.sources) !== JSON.stringify(await sourceHashes()) ||
      (await executable(consumer.path)).sha256 !== consumer.sha256 ||
      (await executable(producer.path)).sha256 !== producer.sha256) fail('INPUT_DRIFT');
    summary.assertions.unchanged = true;
    summary.status = 'complete'; summary.failedStage = null;
  } catch (error) { summary.failedStage = stage; summary.code = runtimeConsumerFailureCode(error); }
  // Constructed finite projection only: never publish the private cache, payload,
  // paths, installer output, raw TAP or exception messages.
  await mkdir(base, { recursive: true });
  await writeFile(path.join(base, 'runtime-consumer-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  return summary;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const [node, pnpm, ...extra] = process.argv.slice(2);
    if (extra.length) fail('ARGUMENT_INVALID');
    const result = await validateRuntimeConsumer(node, pnpm);
    console.log(JSON.stringify({ status: result.status, stage: result.failedStage, code: result.code }));
    if (result.status !== 'complete') process.exitCode = 1;
  } catch (error) { console.error(JSON.stringify({ code: runtimeConsumerFailureCode(error) })); process.exitCode = 1; }
}
