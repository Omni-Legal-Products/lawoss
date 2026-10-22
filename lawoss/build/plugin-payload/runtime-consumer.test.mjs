import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntimePayload } from './validate.mjs';
import * as runtime from './runtime-consumer-validation.mjs';
const { runtimeConsumerFailureCode } = runtime;

test('the consumer verifier refuses the build runtime before reading a payload', async () => {
  assert.equal(process.version, 'v24.21.0');
  await assert.rejects(verifyRuntimePayload('must-not-be-read', '0'.repeat(64)), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
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
