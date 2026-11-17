// LAWOSS #384/#220: observation of the protected provisioning POST in the native ISIR gate.
//
// The harness provisioning oracle (240 s) starts at the Generate click. On expiry the log only
// said `last=undefined`, which cannot tell a POST that was never issued (an earlier Windows
// artifact recorded exactly that, see diagnostics.mjs) from one the server never answered.
// The production VM startup deadline (240 s, vm-engine.ts) starts later than the oracle, so
// a pending POST may still end with a classified server outcome after the harness gave up.
//
// The oracle stays unchanged and still fails. At expiry this module records the state of the
// same request immediately, without any additional wait (AGENTS.md: no waits to diagnose a
// timing failure; freeze before secondary probes), and never retries: the first operation
// still owns its worker slot while it is in flight.

export const KNOWN_PROVISIONING_CODES = Object.freeze(['protected_runtime_capacity','protected_checkpoint_busy','protected_checkpoint_failed','protected_checkpoint_invalid','protected_runtime_unavailable','protected_session_busy','host_decision_stale','protected_directory_denied','protected_source_scope','protected_source_denied','protected_prompt_invalid','protected_ai_denied','protected_ai_profile_missing','protected_runtime_closed']);

/** Exact-owner request/response pair of this case's generation POST in the CDP event log. */
export function provisioningExchange(events, workspaceId) {
  const path = `/workspace/${workspaceId}/lawoss/documents/generation`;
  const request = events.find(event => event.method === 'Network.requestWillBeSent' && event.params.request.method === 'POST' && new URL(event.params.request.url).pathname === path);
  const response = request && events.find(event => event.method === 'Network.responseReceived' && event.params.requestId === request.params.requestId);
  const failed = request && events.find(event => event.method === 'Network.loadingFailed' && event.params.requestId === request.params.requestId);
  return { request, response, failed };
}

/** Closed category of a refusal body; never the message or any other field. */
export function classifyProvisioningRefusal(raw) {
  try {
    const code = JSON.parse(raw)?.code;
    return KNOWN_PROVISIONING_CODES.includes(code) ? code : 'unclassified';
  } catch { return 'unclassified'; }
}

/**
 * Waits for this case's provisioning response under the unchanged oracle. On oracle expiry
 * it logs one closed line with the request state at that moment and rethrows the original
 * expiry error.
 */
export async function awaitProvisioningResponse({ until, events, workspaceId, startedAtMs, log, oracleMs = 240_000, now = Date.now }) {
  try {
    return await until(() => provisioningExchange(events(), workspaceId).response, 'actual confined VM ready response before inference', oracleMs);
  } catch (error) {
    if (error?.code !== 'ISIR_NATIVE_WAIT_EXPIRED') throw error;
    const exchange = provisioningExchange(events(), workspaceId);
    log('Native provisioning at oracle expiry', {
      requestIssued: Boolean(exchange.request),
      state: exchange.response ? 'response' : exchange.failed ? 'loading-failed' : exchange.request ? 'pending' : 'not-issued',
      elapsedMs: now() - startedAtMs,
    });
    throw error;
  }
}
