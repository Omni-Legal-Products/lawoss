import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createNativeEngineClient } from './engine-client.mjs';

test('native engine setup uses the owner workspace proxy without exported engine credentials', async () => {
  const receipts = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    receipts.push({ route: req.url, method: req.method, auth: req.headers.authorization, directory: req.headers['x-opencode-directory'], body });
    if (req.headers.authorization !== 'Bearer synthetic-owner') { res.writeHead(401).end(); return; }
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ version: '2.1.4-legalwork.http-policy.3' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    // Match the hardened native bridge: there is no engine username/password.
    const request = createNativeEngineClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, ownerToken: 'synthetic-owner' }, 'ws_native_1');
    // LAWOSS v2: engine 2.1.4 routes behind the proxy (it prepends `/api`).
    assert.equal((await (await request('/info')).json()).version, '2.1.4-legalwork.http-policy.3');
    assert.equal((await request('/integration/isir-native/connect/key', { method: 'POST', body: JSON.stringify({ key: 'synthetic-local-only' }) })).status, 200);
    assert.equal((await request('/debug/location', { method: 'DELETE' })).status, 200);
    assert.equal((await request('/provider?location%5Bdirectory%5D=fixture')).status, 200);
    assert.equal((await request('/session?limit=50', { headers: { 'x-opencode-directory': 'synthetic-directory' } })).status, 200);
    assert.ok(receipts.every(r => r.route.startsWith('/workspace/ws_native_1/opencode/') && r.auth === 'Bearer synthetic-owner'));
    assert.equal(receipts[1].method, 'POST');
    assert.deepEqual(JSON.parse(receipts[1].body), { key: 'synthetic-local-only' });
    assert.equal(receipts[4].directory, 'synthetic-directory');
  } finally { await new Promise(resolve => server.close(resolve)); }
});

// Upstream v0.2.18: owner bearer tokens are retired; the owned server's client token is required.
test('native engine client rejects a remote server or missing client capability', () => {
  assert.throws(() => createNativeEngineClient({ baseUrl: 'https://example.com', clientToken: 'synthetic-client' }, 'ws_native_1'), /loopback/);
  assert.throws(() => createNativeEngineClient({ baseUrl: 'http://127.0.0.1:1234' }, 'ws_native_1'), /client token/);
});

test('startup readiness and workspace reload are bounded separately from ordinary engine requests', async () => {
  const calls=[];
  const request=createNativeEngineClient({baseUrl:'http://127.0.0.1:4321',ownerToken:'synthetic-owner'},'ws_native_1',async(url,options,timeout=30_000)=>{
    calls.push({url,options,timeout});
    return new Response('{"version":"2.1.4-legalwork.http-policy.3"}');
  });
  await request('/info');
  assert.equal(typeof request.ready, 'function');
  await request.ready();
  await request.reload();
  assert.equal(calls[0].timeout,30_000,'Ordinary engine requests retain their existing deadline');
  assert.equal(calls[1].timeout,300_000,'A cold engine process keeps its five-minute budget');
  assert.equal(calls[1].url,'http://127.0.0.1:4321/workspace/ws_native_1/opencode/info','Readiness is the instance-free /api/info, never a location-bound probe');
  assert.equal(calls[2].timeout,90_000,'Diagnostics must not shorten the production reload contract');
  for (const call of calls.slice(1)) {
    assert.ok(call.options.signal instanceof AbortSignal,'Default fetch also receives an explicit bounded signal');
    assert.equal(call.options.signal.aborted,false);
  }
});

test('native configuration waits for authenticated instance readiness headers and complete JSON', async () => {
  const calls = [];
  let finishBody;
  let readyStarted;
  const started = new Promise(resolve => { readyStarted = resolve; });
  const request = createNativeEngineClient({baseUrl:'http://127.0.0.1:4321',ownerToken:'synthetic-owner'}, 'ws_native_1', async (url, options, timeout) => {
    calls.push({url, method:options.method ?? 'GET', auth:options.headers.get('authorization'), timeout});
    if (url.endsWith('/opencode/info')) {
      readyStarted();
      return new Response(new ReadableStream({start(controller) {
        finishBody = () => { controller.enqueue(new TextEncoder().encode('{"version":"2.1.4-legalwork.http-policy.3"}')); controller.close(); };
      }}));
    }
    return new Response('{}');
  });
  assert.equal(typeof request.ready, 'function', 'Native setup must await real instance readiness before configuration');
  const setup = (async () => {
    await request.ready();
    await request('/integration/isir-native/connect/key', {method:'POST'});
    await request.reload();
  })();
  await started;
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, [{url:'http://127.0.0.1:4321/workspace/ws_native_1/opencode/info',method:'GET',auth:'Bearer synthetic-owner',timeout:300_000}]);
  finishBody();
  await setup;
  assert.deepEqual(calls.slice(1).map(call => call.method), ['POST', 'POST']);
});

test('native readiness rejects unsuccessful or malformed instance responses before configuration', async () => {
  for (const response of [new Response('{"version":"2.1.4"}',{status:503}),new Response('not JSON'),new Response('null'),new Response('[]'),new Response('{}'),new Response('{"version":""}')]) {
    let configured = false;
    const request = createNativeEngineClient({baseUrl:'http://127.0.0.1:4321',ownerToken:'synthetic-owner'},'ws_native_1',async()=>response);
    assert.equal(typeof request.ready, 'function');
    await assert.rejects(async () => { await request.ready(); configured = true; });
    assert.equal(configured, false);
  }
});

test('native provider discovery waits for the production workspace reload to finish', async () => {
  let completeReload;
  let reloadStarted;
  const started = new Promise(resolve => { reloadStarted = resolve; });
  let ready = false;
  const receipts = [];
  const server = createServer((req, res) => {
    receipts.push({ route: req.url, method: req.method, auth: req.headers.authorization });
    reloadStarted();
    res.setHeader('content-type', 'application/json');
    if (req.url === '/workspace/ws_native_1/engine/reload') {
      completeReload = () => { ready = true; res.end(JSON.stringify({ ok: true })); };
      return;
    }
    res.end(JSON.stringify({ connected: ready ? ['isir-native'] : [] }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = createNativeEngineClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, ownerToken: 'synthetic-owner' }, 'ws_native_1');
    assert.equal(typeof request.reload, 'function', 'Native setup must expose the awaited production workspace reload');
    const discovery = (async () => {
      assert.equal((await request.reload()).status, 200);
      return (await request('/provider')).json();
    })();
    await started;
    assert.deepEqual(receipts, [{ route: '/workspace/ws_native_1/engine/reload', method: 'POST', auth: 'Bearer synthetic-owner' }]);
    completeReload();
    assert.deepEqual((await discovery).connected, ['isir-native']);
    assert.equal(receipts[1].route, '/workspace/ws_native_1/opencode/provider');
  } finally { completeReload?.(); await new Promise(resolve => server.close(resolve)); }
});
