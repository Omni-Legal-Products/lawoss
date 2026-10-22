import './network-guard.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntimePayload } from './validate.mjs';
import { runtimeConsumerFailureCode } from './runtime-consumer-validation.mjs';

test('the consumer verifier refuses the build runtime before reading a payload', async () => {
  assert.equal(process.version, 'v24.21.0');
  await assert.rejects(verifyRuntimePayload('must-not-be-read', '0'.repeat(64)), { code: 'PAYLOAD_RUNTIME_UNSUPPORTED' });
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
