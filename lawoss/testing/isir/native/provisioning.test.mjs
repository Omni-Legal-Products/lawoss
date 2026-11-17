import test from 'node:test';
import assert from 'node:assert/strict';
import { until } from './cdp.mjs';
import { awaitProvisioningResponse, classifyProvisioningRefusal, provisioningExchange } from './provisioning.mjs';

const origin = 'http://127.0.0.1:4100';
const post = (id, workspace = 'ws_native_2') => ({ method: 'Network.requestWillBeSent', params: { requestId: id, request: { method: 'POST', url: `${origin}/workspace/${workspace}/lawoss/documents/generation` } } });
const response = (id, status) => ({ method: 'Network.responseReceived', params: { requestId: id, response: { status } } });
const expired = () => Object.assign(new Error('Timed out: actual confined VM ready response before inference; last=undefined'), { code: 'ISIR_NATIVE_WAIT_EXPIRED' });

test('exchange binds only the exact owner POST and its own response', () => {
  const events = [post('a', 'ws_native_1'), response('a', 200), post('b'), response('x', 200)];
  assert.equal(provisioningExchange(events, 'ws_native_2').request.params.requestId, 'b');
  assert.equal(provisioningExchange(events, 'ws_native_2').response, undefined);
  events.push(response('b', 500));
  assert.equal(provisioningExchange(events, 'ws_native_2').response.params.response.status, 500);
});

test('a response within the oracle is returned unchanged and logs nothing', async () => {
  const events = [post('b'), response('b', 200)], logs = [];
  const result = await awaitProvisioningResponse({ until, events: () => events, workspaceId: 'ws_native_2', startedAtMs: 0, log: (...line) => logs.push(line), oracleMs: 500 });
  assert.equal(result.params.response.status, 200);
  assert.deepEqual(logs, []);
});

test('oracle expiry logs the request state at that moment, adds no wait and rethrows the original error', async () => {
  const cases = [
    [[], 'not-issued', false],
    [[post('b')], 'pending', true],
    [[post('b'), { method: 'Network.loadingFailed', params: { requestId: 'b' } }], 'loading-failed', true],
    // A response observed only after the oracle's last read still never turns the failure into success.
    [[post('b'), response('b', 200)], 'response', true],
  ];
  for (const [events, state, issued] of cases) {
    const logs = [], error = expired();
    let reads = 0;
    const counted = () => { reads++; return events; };
    await assert.rejects(awaitProvisioningResponse({ until: async () => { throw error; }, events: counted, workspaceId: 'ws_native_2', startedAtMs: 1_000, log: (...line) => logs.push(line), now: () => 241_500 }), e => e === error);
    assert.equal(reads, 1, 'one immediate observation, no polling window');
    assert.deepEqual(logs, [['Native provisioning at oracle expiry', { requestIssued: issued, state, elapsedMs: 240_500 }]]);
  }
});

test('other failures (for example a refused native review) are not observed or masked', async () => {
  const refused = Object.assign(new Error('Native synthetic review refused: x'), { code: 'NATIVE_SYNTHETIC_REVIEW_REFUSED' }), logs = [];
  await assert.rejects(awaitProvisioningResponse({ until: async () => { throw refused; }, events: () => [], workspaceId: 'ws_native_2', startedAtMs: 0, log: (...line) => logs.push(line) }), e => e === refused);
  assert.deepEqual(logs, []);
});

test('refusal classification publishes only known closed codes', () => {
  assert.equal(classifyProvisioningRefusal('{"code":"protected_runtime_capacity","message":"secret"}'), 'protected_runtime_capacity');
  assert.equal(classifyProvisioningRefusal('{"code":"something_else"}'), 'unclassified');
  assert.equal(classifyProvisioningRefusal('not json'), 'unclassified');
});

test('host-error log projection stays null until the closed capture ran', async () => {
  const { createNativeDiagnostics } = await import('./diagnostics.mjs');
  assert.equal(createNativeDiagnostics({ enabled: true, ci: true, mode: 'synthetic', outputFile: '/nonexistent/unused.json' }).hostErrors(), null);
  assert.equal(createNativeDiagnostics({ enabled: false }).hostErrors(), null);
});
