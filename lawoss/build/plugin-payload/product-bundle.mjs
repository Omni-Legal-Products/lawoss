// Build-only data admission. The caller must independently trust the supplied
// compatibility summary and external manifest digest; adjacent metadata cannot
// supply that authority. This module never imports SDK code or writes a payload.
import { lstat, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { canonical, fail, sha256, SDK_LOCK_SHA256, sdkConsumerMode, verifyBuildPayload } from './validate.mjs';

// Exact source set retained by the existing native runtime compatibility gate.
const sources = ['validate.mjs', 'prepare.mjs', 'worker.mjs', 'import-check.mjs',
  'prime-cache.mjs', 'prime-transfer.mjs', 'network-guard.mjs', 'tools-preflight.mjs',
  'native-validation.mjs', 'native-validation.test.mjs', 'prepare.test.mjs', 'prime-cache.test.mjs',
  '../../engine-dependencies/package-runtime.mjs', 'runtime-consumer-validation.mjs',
  'runtime-consumer.test.mjs', 'runtime-consumer.integration.test.mjs', 'tools/package.json',
  'tools/pnpm-lock.yaml', 'sdk/package.json', 'sdk/package-lock.json', 'notices.mjs', 'notices.test.mjs',
  'sdk/notices/index.json', 'sdk/notices/THIRD_PARTY_NOTICES.md',
  'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt',
  'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
export async function currentProductSdkSourceSetSha256() {
  const binding = Object.fromEntries(await Promise.all(sources.map(async name => [name, sha256(await readFile(new URL(name, import.meta.url)))])));
  return sha256(canonical(binding));
}
const refuse = () => fail('PRODUCT_SDK_BUNDLE_INVALID');
const equal = (a, b) => canonical(a) === canonical(b);
const hex = (value, length = 64) => typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value);
const shape = (value, keys) => {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !equal(Object.keys(value).sort(), [...keys].sort())) refuse();
};
// Snapshot bounded plain data before any await. Accessors/proxies cannot provide
// a different accepted identity on a later read, and no caller objects escape.
// Each complete snapshot admits at most4096 values and65536 aggregate UTF-16
// characters across keys/text, charged before recursive copy or definition.
function data(value, depth = 0, budget = { entries: 0, characters: 0, seen: new WeakSet() }) {
  if (++budget.entries > 4096 || depth > 8) refuse();
  if (value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') {
    if ((budget.characters += value.length) > 65536) refuse();
    return value;
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  if (budget.seen.has(value)) refuse();
  budget.seen.add(value);
  const fields = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(fields).length > 64 || Reflect.ownKeys(fields).some(key => typeof key !== 'string')) refuse();
  const result = {};
  for (const [key, field] of Object.entries(fields)) {
    if (!Object.hasOwn(field, 'value') || !field.enumerable || (budget.characters += key.length) > 65536) refuse();
    Object.defineProperty(result, key, { value: data(field.value, depth + 1, budget), enumerable: true });
  }
  return Object.freeze(result);
}
function runtime(value, version) {
  shape(value, ['version', 'sha256']);
  if (value.version !== version || !hex(value.sha256)) refuse();
}
function tests(value, expected) {
  if (!equal(value, { tests: expected, pass: expected, fail: 0, cancelled: 0, skipped: 0, todo: 0 })) refuse();
}
async function sourceBinding(binding, target, digest, lock, mode) {
  shape(binding, ['schema', 'kind', 'status', 'failedStage', 'code', 'headSha', 'checkoutSha', 'target',
    'accepted', 'sources', 'producer', 'consumer', 'acquisition', 'tests', 'payloadManifestSha256',
    'consumerMode', 'assertions', 'scope']);
  if (binding.schema !== 2 || binding.kind !== 'plugin-sdk-runtime-consumer' || binding.status !== 'complete' ||
    binding.failedStage !== null || binding.code !== null || !hex(binding.headSha, 40) || !hex(binding.checkoutSha, 40) ||
    !equal(binding.target, target) || binding.payloadManifestSha256 !== digest || binding.consumerMode !== mode ||
    binding.scope !== 'dependency compatibility only; no product hook, engine startup or installed-application acceptance') refuse();
  runtime(binding.producer, 'v24.21.0'); runtime(binding.consumer, 'v22.23.2');
  shape(binding.tests, ['producer', 'consumer']);
  tests(binding.tests.producer, 53); tests(binding.tests.consumer, 6);
  if (!equal(binding.assertions, { producerVerified: true, nativeLoaded: mode === 'native-loaded',
    nativeCapability: true, consumerVerified: true, unchanged: true })) refuse();
  shape(binding.acquisition, ['records', 'verified', 'totalBytes', 'outcome', 'receiptSha256']);
  if (binding.acquisition.records !== 32 || binding.acquisition.verified !== 32 || binding.acquisition.outcome !== 'complete' ||
    !Number.isSafeInteger(binding.acquisition.totalBytes) || binding.acquisition.totalBytes < 1 || !hex(binding.acquisition.receiptSha256)) refuse();
  shape(binding.sources, sources);
  for (const name of sources) {
    if (!hex(binding.sources[name]) || binding.sources[name] !== sha256(await readFile(new URL(name, import.meta.url)))) refuse();
  }
  if (!equal(binding.accepted, { lockSha256: lock, inputSha256: binding.sources['sdk/package.json'],
    toolsLockSha256: binding.sources['tools/pnpm-lock.yaml'] }) || binding.sources['sdk/package-lock.json'] !== lock) refuse();
}

/** Authenticate an explicit bundle as data, never as a runtime or startup proof. */
export async function inspectProductSdkBundle(options) {
  try {
    const { payloadRoot, expectedManifestSha256, expectedTarget, acceptedLockSha256, compatibilityBinding } = options;
    const target = data(expectedTarget), binding = data(compatibilityBinding);
    if (JSON.stringify(binding).length > 65536 || !hex(expectedManifestSha256) || acceptedLockSha256 !== SDK_LOCK_SHA256 ||
      typeof payloadRoot !== 'string' || payloadRoot.length > 4096 || !path.isAbsolute(payloadRoot)) refuse();
    const mode = sdkConsumerMode(target, acceptedLockSha256);
    await sourceBinding(binding, target, expectedManifestSha256, acceptedLockSha256, mode);
    const root = await lstat(payloadRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || await realpath(payloadRoot) !== payloadRoot) refuse();
    for (const name of ['package.json', 'package-lock.json']) {
      const stat = await lstat(path.join(payloadRoot, name));
      if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) refuse();
    }
    const manifest = await verifyBuildPayload(payloadRoot, expectedManifestSha256, target);
    const after = await lstat(payloadRoot);
    if (!after.isDirectory() || after.isSymbolicLink() || after.dev !== root.dev || after.ino !== root.ino) refuse();
    return Object.freeze({ schema: 1, kind: 'lawoss-product-sdk-bundle', status: 'verified',
      manifestSha256: expectedManifestSha256, target, lockSha256: manifest.lockSha256,
      inputSha256: manifest.inputSha256, sourceSetSha256: sha256(canonical(binding.sources)), consumerMode: mode });
  } catch { refuse(); }
}
