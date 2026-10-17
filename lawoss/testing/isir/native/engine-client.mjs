import assert from 'node:assert/strict';

// Engine credentials are intentionally absent from renderer/workspace snapshots.
// Use the same authenticated workspace proxy as the production SDK instead.
export function createNativeEngineClient(serverInfo, workspaceId, request = fetch) {
  const server = new URL(serverInfo.baseUrl);
  assert.ok(server.protocol === 'http:' && server.hostname === '127.0.0.1' && server.port, 'Owned loopback server required');
  assert.ok(typeof serverInfo.ownerToken === 'string' && serverInfo.ownerToken, 'Native engine setup requires the owned server owner token');
  assert.ok(typeof workspaceId === 'string' && workspaceId, 'Native engine workspace required');
  const baseUrl = `${server.origin}/workspace/${encodeURIComponent(workspaceId)}/opencode`;
  return (route, options = {}) => {
    assert.ok(route.startsWith('/') && !route.startsWith('//'), 'Native engine route must be relative');
    const headers = new Headers(options.headers);
    headers.set('authorization', `Bearer ${serverInfo.ownerToken}`);
    headers.set('content-type', 'application/json');
    return request(`${baseUrl}${route}`, { ...options, headers });
  };
}
