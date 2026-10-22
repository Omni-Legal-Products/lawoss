import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from './product-identity.mjs';
const hash = 'a'.repeat(64);
const lock = '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053';
function identity(mode = 'sdk') {
  return { schema: 1, kind: 'lawoss-product-sdk-packaging', mode,
    applicationBuild: { schemaVersion: 1, product: 'lawoss-desktop', version: '0.0.0', gitSha: 'b'.repeat(40),
      buildEpoch: '1792663200', platform: 'win32', arch: 'arm64', channel: 'stable', workflowRunUrl: '' },
    target: { platform: 'win32', arch: 'arm64' },
    sdk: mode === 'without-sdk' ? null : { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified',
      manifestSha256: hash, target: { platform: 'win32', arch: 'arm64' }, lockSha256: lock, inputSha256: hash,
      sourceSetSha256: hash, consumerMode: 'javascript-fallback', verifierSha256: hash,
      capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: hash, bytes: 100 } } };
}
const invalid = { code: 'PRODUCT_SDK_IDENTITY_INVALID' };
test('enabled and explicitly disabled private modules roundtrip as frozen data without evaluation', () => {
  for (const mode of ['sdk', 'without-sdk']) {
    const input = identity(mode), module = createProductSdkIdentityModule(input);
    const result = readProductSdkIdentityModule(module);
    assert.deepEqual(result, input);
    for (const item of [result, result.target, result.applicationBuild, ...(result.sdk ? [result.sdk, result.sdk.target, result.sdk.capsule] : [])]) assert.equal(Object.isFrozen(item), true);
    input.applicationBuild.gitSha = 'c'.repeat(40);
    assert.equal(result.applicationBuild.gitSha, 'b'.repeat(40));
  }
});
test('wrong target, lock, backend, archive and disabled resource identity are refused', () => {
  for (const mutate of [
    x => x.target.arch = 'x64', x => x.sdk.target.arch = 'x64', x => x.sdk.lockSha256 = hash,
    x => x.sdk.consumerMode = 'native-loaded', x => x.sdk.kind = 'lawoss-product-sdk-resource',
    x => x.sdk.capsule.file = '../payload.tgz', x => x.sdk.capsule.bytes = 270 * 1024 * 1024 + 1,
    x => x.sdk.capsule.sha256 = 'invalid', x => x.mode = 'without-sdk', x => x.sdk = null,
    x => x.applicationBuild.extra = true, x => x.sdk.extra = true,
  ]) { const input = identity(); mutate(input); assert.throws(() => createProductSdkIdentityModule(input), invalid); }
});
test('private module parsing refuses appended or substituted executable statements and malformed data', () => {
  const source = createProductSdkIdentityModule(identity());
  for (const text of [source + '\nglobalThis.SDK_IDENTITY_EXECUTED=true;', source.replace('const identity = ', 'const identity = globalThis.SDK_IDENTITY_EXECUTED=true; '),
    source.replace('"payload.tgz"', '"../payload.tgz"'), source.replace('Object.freeze(identity.target);', ''), 'x'.repeat(65537), Buffer.from(source)]) {
    assert.throws(() => readProductSdkIdentityModule(text), invalid);
  }
  assert.equal(globalThis.SDK_IDENTITY_EXECUTED, undefined);
});
test('caller accessors, cycles, symbols and oversized data refuse before reading their values', () => {
  let reads = 0;
  const getter = identity(); Object.defineProperty(getter, 'sdk', { enumerable: true, get() { reads++; return identity().sdk; } });
  const cycle = identity(); cycle.sdk = cycle;
  const symbol = identity(); symbol[Symbol('extra')] = true;
  const large = identity(); large.applicationBuild.workflowRunUrl = 'https://example.test/' + 'x'.repeat(65536);
  for (const value of [getter, cycle, symbol, large]) assert.throws(() => createProductSdkIdentityModule(value), invalid);
  assert.equal(reads, 0);
});
test('generated module freezes nested identity when trusted application code imports it', async () => {
  const input = identity();
  const imported = await import(`data:text/javascript,${encodeURIComponent(createProductSdkIdentityModule(input))}`);
  assert.deepEqual(imported.default, input);
  assert.equal(Object.isFrozen(imported.default.sdk.capsule), true);
  assert.equal(Object.isFrozen(imported.default.applicationBuild), true);
});

test('development is an explicit null-build mode that cannot carry SDK authority', async () => {
  const input = { ...identity('without-sdk'), mode: 'development', applicationBuild: null };
  const module = createProductSdkIdentityModule(input);
  assert.deepEqual(readProductSdkIdentityModule(module), input);
  assert.deepEqual((await import(`data:text/javascript,${encodeURIComponent(module)}`)).default, input);
  for (const bad of [
    { ...input, mode: 'without-sdk' }, { ...input, mode: 'sdk' },
    { ...input, applicationBuild: identity().applicationBuild },
    { ...input, sdk: identity().sdk }, { ...input, target: { platform: 'win32', arch: 'ia32' } },
  ]) assert.throws(() => createProductSdkIdentityModule(bad), invalid);
});
