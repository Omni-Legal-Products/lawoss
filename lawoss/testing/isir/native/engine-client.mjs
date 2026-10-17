import assert from 'node:assert/strict';

// Engine credentials are intentionally absent from renderer/workspace snapshots.
// Use the same authenticated workspace proxy as the production SDK instead.
export function createNativeEngineClient(serverInfo, workspaceId, request = fetch) {
  const server = new URL(serverInfo.baseUrl);
  assert.ok(server.protocol === 'http:' && server.hostname === '127.0.0.1' && server.port, 'Owned loopback server required');
  assert.ok(typeof serverInfo.ownerToken === 'string' && serverInfo.ownerToken, 'Native engine setup requires the owned server owner token');
  assert.ok(typeof workspaceId === 'string' && workspaceId, 'Native engine workspace required');
  const baseUrl = `${server.origin}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
  const authenticatedRequest = (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${serverInfo.ownerToken}`);
    headers.set('content-type', 'application/json');
    return request(url, { ...options, headers });
  };
  const engineRequest = (route, options = {}) => {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Native engine route must be relative');
    return authenticatedRequest(`${baseUrl}${route}`, options);
  };
  // Match provider sign-in in the application: the server awaits rebuilding
  // its derived config before disposing and warming the workspace instance.
  engineRequest.reload = () => authenticatedRequest(`${server.origin}/workspace/${encodeURIComponent(workspaceId)}/engine/reload`, { method: 'POST' });
  return engineRequest;
}
