import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as validation from './validate.mjs';
const { verifyRuntimePayload } = validation;
import * as runtime from './runtime-consumer-validation.mjs';
const { runtimeConsumerFailureCode } = runtime;

test('the consumer verifier refuses the build runtime before reading a payload', async () => {
  assert.equal(process.version, 'v24.21.0');
  await assert.rejects(verifyRuntimePayload('must-not-be-read', '0'.repeat(64)), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
});

test('the exact SDK lock distinguishes optional acceleration from six-target functionality', () => {
  const lock = '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053';
  const cases = [
    [{ platform: 'darwin', arch: 'arm64' }, 'native-loaded'],
    [{ platform: 'darwin', arch: 'x64' }, 'native-loaded'],
    [{ platform: 'linux', arch: 'x64', libc: 'glibc' }, 'native-loaded'],
    [{ platform: 'win32', arch: 'x64' }, 'native-loaded'],
    [{ platform: 'linux', arch: 'arm64', libc: 'glibc' }, 'javascript-fallback'],
    [{ platform: 'win32', arch: 'arm64' }, 'javascript-fallback'],
  ];
  for (const [target, expected] of cases) assert.equal(validation.sdkConsumerMode(target, lock), expected);
  for (const target of [undefined, {}, { platform: 'linux', arch: 'arm64', libc: 'musl' },
    { platform: 'linux', arch: 'arm64' }, { platform: 'win32', arch: 'ia32' },
    { platform: 'darwin', arch: 'arm64', libc: 'glibc' },
    { platform: 'linux/arm64', arch: 'glibc' }, { platform: 'win32/x64', arch: '' },
    { platform: 'linux', arch: 'arm64/glibc', libc: '' }]) {
    assert.throws(() => validation.sdkConsumerMode(target, lock), { code: 'CONSUMER_TARGET_UNSUPPORTED' });
  }
  assert.throws(() => validation.sdkConsumerMode(cases[4][0], '0'.repeat(64)), { code: 'CONSUMER_TARGET_UNSUPPORTED' });
});

test('target-bound JavaScript compatibility still requires every import, guard and real roundtrip', async () => {
  const { IMPORTS } = validation;
  const lock = '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053';
  const fallback = { imports: IMPORTS, native: 'fallback', guard: true, roundtrip: true };
  for (const target of [{ platform: 'linux', arch: 'arm64', libc: 'glibc' }, { platform: 'win32', arch: 'arm64' }]) {
    assert.equal(validation.assertTargetSdkProbe(fallback, target, lock), 'javascript-fallback');
    assert.equal(runtime.assertRuntimeConsumerProbe(fallback, () => assert.fail('Expected compatibility is not a failure'), {
      target, lockSha256: lock,
    }), 'javascript-fallback');
    for (const patch of [{ imports: IMPORTS.slice(1) }, { native: 'absent' }, { native: 'loaded' }, { guard: false }, { roundtrip: false }]) {
      assert.throws(() => validation.assertTargetSdkProbe({ ...fallback, ...patch }, target, lock), { code: 'CONSUMER_INVALID' });
    }
    // The original, untargeted assertion never turns a fallback into native PASS.
    assert.throws(() => runtime.assertRuntimeConsumerProbe(fallback), { code: 'CONSUMER_INVALID' });
  }
  for (const target of [{ platform: 'darwin', arch: 'arm64' }, { platform: 'darwin', arch: 'x64' },
    { platform: 'linux', arch: 'x64', libc: 'glibc' }, { platform: 'win32', arch: 'x64' }]) {
    assert.throws(() => validation.assertTargetSdkProbe(fallback, target, lock), { code: 'CONSUMER_INVALID' });
    assert.equal(validation.assertTargetSdkProbe({ ...fallback, native: 'loaded' }, target, lock), 'native-loaded');
  }
});

test('runtime consumer rejection preserves the strict gate and reports only primitive probe facts', async () => {
  const { IMPORTS } = await import('./validate.mjs');
  const good = { imports: IMPORTS, native: 'loaded', guard: true, roundtrip: true };
  assert.doesNotThrow(() => runtime.assertRuntimeConsumerProbe(good, () => assert.fail('Success must not emit failure diagnostics')));
  for (const patch of [{ native: 'fallback' }, { guard: false }, { roundtrip: false }, { imports: [] }]) {
    let observed;
    assert.throws(() => runtime.assertRuntimeConsumerProbe({ ...good, ...patch, private: 'must-not-escape' }, value => { observed = value; }), { code: 'CONSUMER_INVALID' });
    assert.deepEqual(Object.keys(observed).sort(), ['guard', 'imports', 'native', 'roundtrip']);
    assert.equal(JSON.stringify(observed).includes('must-not-escape'), false);
    assert.equal(Object.isFrozen(observed), true);
  }
  const primary = new Error('private primary');
  const hostile = { get imports() { throw primary; }, get native() { assert.fail('Do not invoke native getter for diagnostics'); } };
  let observed;
  assert.throws(() => runtime.assertRuntimeConsumerProbe(hostile, value => { observed = value; throw Error('observer failure'); }), error => error === primary);
  assert.deepEqual(observed, { imports: 'unknown', native: 'unknown', guard: 'unknown', roundtrip: 'unknown' });
  for (const nativeFailure of [
    { stage: 'extract-load', code: 'ERR_DLOPEN_FAILED', path: '/private/loader' },
    { stage: 'native-state', code: 'not-enabled' },
    { stage: 'extract-load', code: { toString() { assert.fail('No coercion'); } } },
    { stage: '/private/loader', code: 'MODULE_NOT_FOUND' },
    { get stage() { assert.fail('No diagnostic getter'); } },
  ]) {
    let actual;
    assert.throws(() => runtime.assertRuntimeConsumerProbe({ ...good, native: 'fallback', nativeFailure }, value => { actual = value; }), { code: 'CONSUMER_INVALID' });
    if (Object.getOwnPropertyDescriptor(nativeFailure, 'stage')?.value === 'native-state' || nativeFailure.code === 'ERR_DLOPEN_FAILED') {
      assert.deepEqual(Object.keys(actual.nativeFailure).sort(), ['code', 'stage']);
      assert.equal(Object.isFrozen(actual.nativeFailure), true);
    } else assert.equal(actual.nativeFailure, undefined);
    assert.doesNotMatch(JSON.stringify(actual), /private|loader|path/);
  }
});

test('public validation error codes cannot serialize coercible objects or execute code getters twice', () => {
  assert.equal(runtimeConsumerFailureCode({ code: 'TOOLS_INVALID' }), 'TOOLS_INVALID');
  const coercible = { private: 'must-not-escape', toString() { return 'TOOLS_INVALID'; } };
  for (const error of [undefined, { code: coercible }, { code: 23 }, { get code() { throw Error('private getter'); } }]) {
    assert.equal(runtimeConsumerFailureCode(error), 'VALIDATION_FAILED');
  }
  let reads = 0;
  const error = { get code() { if (++reads > 1) throw Error('second read'); return 'TOOLS_INVALID'; } };
  assert.equal(runtimeConsumerFailureCode(error), 'TOOLS_INVALID');
  assert.equal(reads, 1);
});
