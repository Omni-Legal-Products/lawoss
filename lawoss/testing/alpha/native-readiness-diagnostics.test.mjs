import assert from 'node:assert/strict';
import test from 'node:test';
import { createNativeReadinessDiagnostics, nativeReadinessDiagnostic } from './native-readiness-diagnostics.mjs';

test('readiness retains capped attempts, highest completed progress and immutable pre-cleanup observations', () => {
  const collector = createNativeReadinessDiagnostics();
  for (let i = 0; i < 129; i++) collector.attempt();
  collector.passed('process-identity');collector.passed('discovery');
  collector.boundary('snapshot');collector.failure(Object.assign(new Error('PRIVATE /profile'), { code: 'shipping-control-request-timeout' }));
  const frozen = collector.freeze(), primary = new Error('PRIVATE-PRIMARY');
  collector.associate(primary);
  assert.deepEqual(nativeReadinessDiagnostic(primary), { attempts: 128, attemptsCapped: true, progress: 'process-identity', lastBoundary: 'snapshot', lastError: 'shipping-control-request-timeout' });
  collector.attempt();collector.passed('ready');collector.boundary('ready');collector.failure(new Error('PRIVATE-CLEANUP'));
  assert.strictEqual(collector.freeze(), frozen);assert.strictEqual(nativeReadinessDiagnostic(primary), frozen);
  assert.equal(primary.message, 'PRIVATE-PRIMARY');assert.throws(() => { frozen.progress = 'PRIVATE'; });
});

test('a newer retry boundary and its failure remain independent of highest completed progress', () => {
  const cases = [
    ['UI failure', () => {}, { attempts: 1, attemptsCapped: false, progress: 'renderer-identity', lastBoundary: 'interactive-ui', lastError: 'native-ui-not-ready' }],
    ['next owner boundary', collector => { collector.attempt();collector.boundary('process-owner'); },
      { attempts: 2, attemptsCapped: false, progress: 'renderer-identity', lastBoundary: 'process-owner', lastError: 'native-ui-not-ready' }],
    ['next snapshot failure', collector => {
      collector.attempt();collector.boundary('process-owner');collector.passed('process-identity');collector.boundary('snapshot');
      collector.failure(Object.assign(new Error('PRIVATE-SNAPSHOT'), { code: 'shipping-control-request-timeout' }));
    }, { attempts: 2, attemptsCapped: false, progress: 'renderer-identity', lastBoundary: 'snapshot', lastError: 'shipping-control-request-timeout' }],
  ];
  for (const [name, advance, expected] of cases) {
    const collector = createNativeReadinessDiagnostics();
    collector.attempt();collector.passed('renderer-identity');collector.boundary('interactive-ui');
    collector.failure(Object.assign(new Error('PRIVATE-UI'), { code: 'native-ui-not-ready' }));
    advance(collector);
    const frozen = collector.freeze(), primary = new Error('PRIVATE-PRIMARY');
    collector.associate(primary);
    assert.deepEqual(frozen, expected, name);assert.strictEqual(nativeReadinessDiagnostic(primary), frozen);
    collector.attempt();collector.passed('ready');collector.boundary('ready');collector.failure(new Error('PRIVATE-CLEANUP'));
    assert.strictEqual(collector.freeze(), frozen);assert.deepEqual(nativeReadinessDiagnostic(primary), expected, name);
  }
});

test('only whole known codes and the four exact validator messages produce fixed readiness categories', () => {
  const cases = [
    [new Error('Live packaged IPC identity differs'), 'packaged-identity-mismatch'],
    [new Error('Live process or profile ownership differs'), 'process-identity-mismatch'],
    [new Error('Expected the packaged file renderer'), 'packaged-file-renderer-required'],
    [new Error('Packaged renderer or shipping snapshot unavailable'), 'renderer-or-snapshot-unavailable'],
    [Object.assign(new Error('PRIVATE'), { code: 'ENOENT' }), 'ENOENT'],
    [Object.assign(new Error('PRIVATE'), { code: 'unsafe-discovery' }), 'unsafe-discovery'],
    [Object.assign(new Error('PRIVATE'), { code: 'native-ui-not-ready' }), 'native-ui-not-ready'],
    [new Error('Live packaged IPC identity differs PRIVATE /profile'), 'unknown'],
    [new Error('PRIVATE Expected the packaged file renderer'), 'unknown'],
    [Object.assign(new Error('PRIVATE'), { code: 'ENOENT PRIVATE' }), 'unknown'],
    [new Error('PRIVATE', { cause: { code: 'ENOENT' } }), 'unknown'],
  ];
  for (const [error, expected] of cases) {
    const collector = createNativeReadinessDiagnostics();collector.failure(error);
    assert.equal(collector.freeze().lastError, expected);
    assert.doesNotMatch(JSON.stringify(collector.freeze()), /PRIVATE|profile|Live packaged|Expected the packaged|shipping snapshot/);
  }
});

test('hostile error getters and arbitrary boundaries never leak or replace an error', () => {
  const collector = createNativeReadinessDiagnostics(), error = new Error('PRIVATE');
  Object.defineProperty(error, 'code', { get() { throw new Error('PRIVATE /profile'); } });
  assert.doesNotThrow(() => collector.failure(error));
  collector.boundary('PRIVATE /profile');collector.passed('PRIVATE /profile');
  collector.freeze();collector.associate(error);
  assert.deepEqual(nativeReadinessDiagnostic(error), { attempts: 0, attemptsCapped: false, progress: 'none', lastBoundary: 'unknown', lastError: 'unknown' });
  const messageGetter = Object.defineProperty({}, 'message', { get() { throw new Error('PRIVATE'); } });
  const other = createNativeReadinessDiagnostics();assert.doesNotThrow(() => other.failure(messageGetter));
  assert.equal(other.freeze().lastError, 'unknown');
});

test('readiness facts belong only to the registered error, never public fields or nested causes', () => {
  const collector = createNativeReadinessDiagnostics(), error = Object.assign(new Error('PRIVATE'), { nativeReadiness: { attempts: 999999, lastError: 'PRIVATE' } });
  collector.associate(error);assert.equal(nativeReadinessDiagnostic(error), null);
  collector.attempt();collector.freeze();collector.associate(error);
  assert.equal(nativeReadinessDiagnostic(error).attempts, 1);
  assert.equal(nativeReadinessDiagnostic(new Error('PRIVATE', { cause: error })), null);
  assert.equal(nativeReadinessDiagnostic(new Proxy({}, { get() { throw new Error('PRIVATE'); } })), null);
  assert.equal(nativeReadinessDiagnostic(null), null);
});
