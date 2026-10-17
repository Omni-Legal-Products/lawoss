import assert from 'node:assert/strict';

// Engine credentials are intentionally absent from renderer/workspace snapshots.
// Use the same authenticated workspace proxy as the production SDK instead.
export function createNativeEngineClient(serverInfo, workspaceId, request = fetch) {
  const server = new URL(serverInfo.baseUrl);
  assert.ok(server.protocol === 'http:' && server.hostname === '127.0.0.1' && server.port, 'Owned loopback server required');
  assert.ok(typeof serverInfo.ownerToken === 'string' && serverInfo.ownerToken, 'Native engine setup requires the owned server owner token');
  assert.ok(typeof workspaceId === 'string' && workspaceId, 'Native engine workspace required');
  const baseUrl = `${server.origin}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
  const authenticatedRequest = (url, options = {}, timeout = 30_000) => {
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${serverInfo.ownerToken}`);
    headers.set('content-type', 'application/json');
    return request(url, { ...options, headers }, timeout);
  };
  const engineRequest = (route, options = {}) => {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Native engine route must be relative');
    return authenticatedRequest(`${baseUrl}${route}`, options);
  };
  // Global health and enabled renderer actions do not await instance bootstrap.
  // Finish the real cold instance before configuring and reloading its provider.
  // Cold provisioning includes npm installs; the pinned engine's lock budget is 5m.
  engineRequest.ready = async () => {
    const response = await authenticatedRequest(`${baseUrl}/mcp`, { signal: AbortSignal.timeout(300_000) }, 300_000);
    assert.equal(response.status, 200, 'Owned engine instance must be ready before native configuration');
    const body = await response.json();
    assert.ok(body && typeof body === 'object' && !Array.isArray(body), 'Owned engine readiness requires a valid MCP status object');
    return body;
  };
  // Match provider sign-in in the application: the server awaits rebuilding
  // its derived config before disposing and warming the workspace instance.
  // The production SDK gives instance initialization and MCP restoration 90s.
  // Supply both contracts: diagnostics' explicit deadline and native fetch's signal.
  engineRequest.reload = () => authenticatedRequest(`${server.origin}/workspace/${encodeURIComponent(workspaceId)}/engine/reload`, { method: 'POST', signal: AbortSignal.timeout(90_000) }, 90_000);
  return engineRequest;
}
