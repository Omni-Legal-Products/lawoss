import path from 'node:path';

// Match the runtime's separator normalization, preserving POSIX case and
// allowing Windows' case-insensitive canonical directory spelling.
export function directoryKey(value, platform = process.platform) {
  if (typeof value !== 'string' || !value) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(value)) return null;
  const normalized = paths.normalize(value);
  return platform === 'win32' ? normalized.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : normalized.replace(/\/+$/, '');
}

// LAWOSS v2: engine 2.1.4 has no `/path`, and every location-bound request builds that
// location with all of its MCP servers (RAM 2 GB, LOCATION_FREE in engine-mcp-budget.ts).
// Startup therefore proves the selected running engine through the instance-free
// `GET /api/info`: one request and its entire body consume the absolute startup budget, and
// the reported version must be the selected derivative. The first location-bound request is
// the ordinary native provider bootstrap of the opened client (bootstrap.mjs).
export async function awaitEngineInfo({ request, baseUrl, headers, expectedVersion, deadline, observe = () => {} }) {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new DOMException('Startup readiness budget expired', 'TimeoutError');
  if (!new Headers(headers).get('authorization') || typeof expectedVersion !== 'string' || !expectedVersion) throw new Error('Selected engine readiness scope required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Startup readiness budget expired', 'TimeoutError')), remaining);
  let response;
  try {
    observe('request');
    response = await request(`${baseUrl}/info`, { headers, signal: controller.signal });
    observe('headers');
    if (response.status !== 200) throw new Error('Selected engine readiness HTTP contract failed');
    let body;
    try { body = await response.json(); }
    catch (error) {
      // Node's JSON syntax errors may quote response bytes in message/stack.
      // Do not attach that parser error as a cause; transport/abort stays exact.
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Selected engine readiness JSON contract failed');
    }
    observe('body');
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.version !== expectedVersion) throw new Error('Selected engine readiness version mismatch');
    if (Date.now() >= deadline) throw new DOMException('Startup readiness budget expired', 'TimeoutError');
    observe('verified');
    return { status: 200, authenticated: true, versionMatches: true, bodyCompleted: true };
  } finally {
    clearTimeout(timer);
    if (response && !response.bodyUsed) await response.body?.cancel().catch(() => {});
  }
}

/** Cold engine start and the selected-engine identity proof are separate phases. */
export async function awaitNativeStartup({ engineRequest, request, serverInfo, workspace, expectedVersion, observe, onDeadline = () => {} }) {
  await engineRequest.ready();
  const started = performance.now(), deadline = Date.now() + 90_000;
  onDeadline(deadline);
  const receipt = await awaitEngineInfo({
    request: (url, options) => request(url, options, Math.max(1, deadline - Date.now())),
    baseUrl: `${serverInfo.baseUrl}/workspace/${encodeURIComponent(workspace.id)}/opencode`,
    headers: { authorization: `Bearer ${serverInfo.ownerToken || serverInfo.clientToken}` }, expectedVersion, deadline, observe,
  });
  return { ...receipt, elapsedMs: Math.round(performance.now() - started), remainingMs: Math.max(0, deadline - Date.now()) };
}
