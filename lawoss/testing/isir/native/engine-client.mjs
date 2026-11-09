import assert from 'node:assert/strict';

// Engine credentials are intentionally absent from renderer/workspace snapshots.
// Use the same authenticated workspace proxy as the production SDK instead.
export function createNativeEngineClient(serverInfo, workspaceId, request = fetch) {
  const server = new URL(serverInfo.baseUrl);
  assert.ok(server.protocol === 'http:' && server.hostname === '127.0.0.1' && server.port, 'Owned loopback server required');
  // Upstream v0.2.18 retired owner bearer tokens; the desktop client token authenticates the renderer.
  const token = serverInfo.ownerToken || serverInfo.clientToken;
  assert.ok(typeof token === 'string' && token, 'Native engine setup requires the owned server client token');
  assert.ok(typeof workspaceId === 'string' && workspaceId, 'Native engine workspace required');
  const baseUrl = `${server.origin}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
  const authenticatedRequest = (url, options = {}, timeout = 30_000) => {
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${token}`);
    headers.set('content-type', 'application/json');
    return request(url, { ...options, headers }, timeout);
  };
  // The proxy prepends `/api`: `/info` reaches engine v2 `GET /api/info`.
  const engineRequest = (route, options = {}, timeout = 30_000) => {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Native engine route must be relative');
    return authenticatedRequest(`${baseUrl}${route}`, options, timeout);
  };
  // LAWOSS v2: engine readiness is the instance-free `GET /api/info` (AGENTS.md, RAM 2 GB). A
  // location-bound probe (v1 `/mcp`) would build the selected location with all of its MCP servers.
  // The 5 min budget covers a cold engine process behind the owned workspace proxy.
  engineRequest.ready = async () => {
    const response = await authenticatedRequest(`${baseUrl}/info`, { signal: AbortSignal.timeout(300_000) }, 300_000);
    assert.equal(response.status, 200, 'Owned engine must answer authenticated /api/info before native configuration');
    const body = await response.json();
    assert.ok(body && typeof body === 'object' && !Array.isArray(body) && typeof body.version === 'string' && body.version, 'Owned engine readiness requires a valid /api/info object');
    return body;
  };
  // Match provider sign-in in the application: the server awaits rebuilding
  // its derived config before disposing and warming the workspace instance.
  // The production SDK gives instance initialization and MCP restoration 90s.
  // Supply both contracts: diagnostics' explicit deadline and native fetch's signal.
  engineRequest.reload = () => authenticatedRequest(`${server.origin}/workspace/${encodeURIComponent(workspaceId)}/engine/reload`, { method: 'POST', signal: AbortSignal.timeout(90_000) }, 90_000);
  return engineRequest;
}
