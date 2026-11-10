import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { awaitEngineInfo, directoryKey } from './startup-readiness.mjs';

// LAWOSS v2: startup proves the selected running engine through the instance-free
// `GET /api/info` (behind the owned proxy: `/info`). No location-bound request is made.
const VERSION = '2.1.4-legalwork.http-policy.3';
async function fixture(run) {
  let release, arrive, onClose, closed = 0, resets = 0;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const closedBody = new Promise(resolve => { onClose = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/ui') { res.end('{"healthy":true}'); return; }
    if (url.pathname === '/tick') { res.end('ok'); return; }
    if (url.pathname === '/reset') { assert.equal(req.method, 'POST'); resets++; res.end('reset'); return; }
    assert.equal(url.pathname, '/info');
    assert.equal(url.search, '', 'Readiness carries no location');
    assert.equal(req.headers.authorization, 'Basic fixture');
    res.once('close', () => { closed++; onClose(); });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"version":');
    release = version => res.end(JSON.stringify(version) + ',"pid":1}');
    arrive();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await run({ baseUrl, arrived, closedBody, release: value => release?.(value), closed: () => closed, resets: () => resets }); }
  finally { release?.(VERSION); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}
const input = (baseUrl, extra = {}) => ({ request: fetch, baseUrl, headers: { authorization: 'Basic fixture' }, expectedVersion: VERSION, deadline: Date.now() + 2000, ...extra });

test('healthy UI cannot start reset before the authenticated engine /api/info whole body', async () => {
  await fixture(async ({ baseUrl, arrived, release, resets }) => {
    assert.equal((await (await fetch(baseUrl + '/ui')).json()).healthy, true);
    const pending = awaitEngineInfo(input(baseUrl)).then(async receipt => { await (await fetch(baseUrl + '/reset', { method: 'POST' })).text(); return receipt; });
    await Promise.race([arrived, pending]);
    await (await fetch(baseUrl + '/tick')).text();
    assert.equal(resets(), 0, 'UI liveness must not acknowledge an unfinished engine body');
    release(VERSION);
    const receipt = await pending;
    assert.equal(resets(), 1);
    assert.deepEqual(receipt, { status: 200, authenticated: true, versionMatches: true, bodyCompleted: true });
  });
});

test('original absolute deadline aborts held real response body and releases its socket', async () => {
  await fixture(async ({ baseUrl, arrived, closedBody, closed }) => {
    const rejected = assert.rejects(awaitEngineInfo(input(baseUrl, { deadline: Date.now() + 100 })), { name: 'TimeoutError' });
    await arrived;
    await rejected;
    await closedBody;
    assert.equal(closed(), 1);
  });
});

test('another engine version (v1 or an unselected build) rejects before reset', async () => {
  for (const version of ['1.18.29', '2.1.4']) await fixture(async ({ baseUrl, arrived, release }) => {
    let resets = 0;
    const pending = awaitEngineInfo(input(baseUrl)).then(() => resets++);
    const rejected = assert.rejects(pending, error => error.message === 'Selected engine readiness version mismatch');
    await arrived; release(version); await rejected;
    assert.equal(resets, 0);
  });
});

test('expired shared budget, missing auth and missing expected version reject without making a request', async () => {
  let requests = 0;
  const base = { ...input('http://127.0.0.1:1'), request: () => requests++, deadline: Date.now() - 1 };
  await assert.rejects(awaitEngineInfo(base), { name: 'TimeoutError' });
  await assert.rejects(awaitEngineInfo({ ...base, headers: {}, deadline: Date.now() + 2000 }), /readiness scope required/);
  await assert.rejects(awaitEngineInfo({ ...base, expectedVersion: '', deadline: Date.now() + 2000 }), /readiness scope required/);
  assert.equal(requests, 0);
});

test('HTTP transport primary error identity survives readiness cleanup', async () => {
  const server = createServer((req, res) => req.socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let original;
  try {
    await assert.rejects(awaitEngineInfo(input(`http://127.0.0.1:${server.address().port}`, { request: async (...args) => { try { return await fetch(...args); } catch (error) { original = error; throw error; } } })), error => error === original);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('HTTP200 malformed JSON publishes no body, auth or URL through error message, stack or cause', async () => {
  const sentinels = ['BODYLEAK', 'Basic fixture-secret', 'https://fixture.invalid/private'];
  const server = createServer((req, res) => {
    assert.equal(req.headers.authorization, sentinels[1]);
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(sentinels.join(' '));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await assert.rejects(awaitEngineInfo(input(`http://127.0.0.1:${server.address().port}`, { headers: { authorization: sentinels[1] } })), error => {
      const disclosure = { message: sentinels.some(value => error.message.includes(value)), stack: sentinels.some(value => error.stack.includes(value)), cause: error.cause !== undefined };
      assert.deepEqual(disclosure, { message: false, stack: false, cause: false }, 'parser details must not publish the malformed body');
      assert.equal(error.message, 'Selected engine readiness JSON contract failed');
      return true;
    });
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('HTTP body transport failure identity survives the JSON syntax boundary', async () => {
  let interrupt, original;
  const server = createServer((req, res) => {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"version":');
    interrupt = () => res.destroy();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const request = async (...args) => {
      const response = await fetch(...args);
      const json = response.json.bind(response);
      response.json = async () => { try { return await json(); } catch (error) { original = error; throw error; } };
      interrupt();
      return response;
    };
    await assert.rejects(awaitEngineInfo(input(`http://127.0.0.1:${server.address().port}`, { request })), error => error === original && error.name === 'TypeError');
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('directory keys normalize Windows separators/case but keep POSIX distinct names distinct', () => {
  assert.equal(directoryKey('C:\\Fixture\\č', 'win32'), directoryKey('c:/fixture/č/', 'win32'));
  assert.notEqual(directoryKey('/fixture/č', 'darwin'), directoryKey('/Fixture/č', 'darwin'));
  assert.notEqual(directoryKey('/fixture\\č', 'darwin'), directoryKey('/fixture/č', 'darwin'));
  assert.equal(directoryKey('relative', 'darwin'), null);
});

test('finite startup observations distinguish held body from verified selected engine', async () => {
  await fixture(async ({ baseUrl, arrived, release }) => {
    const stages = [];
    const pending = awaitEngineInfo(input(baseUrl, { observe: stage => stages.push(stage) }));
    await arrived;
    await (await fetch(baseUrl + '/tick')).text();
    assert.deepEqual(stages, ['request', 'headers']);
    release(VERSION); await pending;
    assert.deepEqual(stages, ['request', 'headers', 'body', 'verified']);
  });
});

test('finite startup observations stop at headers for malformed JSON and body for a wrong version', async () => {
  for (const [body, expected] of [['private-malformed', ['request', 'headers']], [JSON.stringify({ version: '1.18.29' }), ['request', 'headers', 'body']]]) {
    const server = createServer((req, res) => res.end(body));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const stages = [];
      await assert.rejects(awaitEngineInfo(input(`http://127.0.0.1:${server.address().port}`, { observe: stage => stages.push(stage) })));
      assert.deepEqual(stages, expected);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});

test('a held header timeout records only request and preserves primary timeout identity', async () => {
  const server = createServer(() => {}); await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const stages = []; let original;
    await assert.rejects(awaitEngineInfo(input(`http://127.0.0.1:${server.address().port}`, { request: async (...args) => { try { return await fetch(...args); } catch (error) { original = error; throw error; } }, deadline: Date.now() + 60, observe: stage => stages.push(stage) })), error => error === original && error.name === 'TimeoutError');
    assert.deepEqual(stages, ['request']);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('composed native startup completes the cold engine before starting the selected-engine absolute budget, without a location', async t => {
  const { awaitNativeStartup } = await import('./startup-readiness.mjs');
  const { createNativeEngineClient } = await import('./engine-client.mjs');
  t.mock.timers.enable({ apis: ['Date'], now: 1000 });
  let finishCold, finishSelected, coldArrive, selectedArrive, configured = false, deadline;
  const coldStarted = new Promise(resolve => { coldArrive = resolve; });
  const selectedStarted = new Promise(resolve => { selectedArrive = resolve; });
  const calls = [];
  const workspace = { id: 'ws_native_1', path: process.platform === 'win32' ? 'C:\\synthetic\\selected' : '/synthetic/selected' };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    assert.equal(req.headers.authorization, 'Bearer synthetic-owner');
    assert.equal(url.pathname, `/workspace/${workspace.id}/opencode/info`);
    assert.equal(url.search, '', 'Startup never names the selected location');
    calls.push(url.pathname);
    res.writeHead(200, { 'content-type': 'application/json' });
    if (calls.length === 1) { res.write('{"version":'); finishCold = () => res.end(JSON.stringify(VERSION) + '}'); coldArrive(); return; }
    res.write('{"version":'); finishSelected = () => res.end(JSON.stringify(VERSION) + '}'); selectedArrive();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const serverInfo = { baseUrl: `http://127.0.0.1:${server.address().port}`, ownerToken: 'synthetic-owner' };
  const engineRequest = createNativeEngineClient(serverInfo, workspace.id);
  let pending;
  try {
    pending = awaitNativeStartup({ engineRequest, request: fetch, serverInfo, workspace, expectedVersion: VERSION, onDeadline: value => { deadline = value; } }).then(receipt => { configured = true; return receipt; });
    await coldStarted;
    t.mock.timers.tick(120_000);
    assert.equal(deadline, undefined); assert.equal(configured, false);
    finishCold(); await selectedStarted;
    assert.equal(deadline, 211_000, 'Selected 90s starts after the completed cold engine, not before it');
    assert.equal(configured, false, 'Configuration still waits for the selected-engine whole body');
    finishSelected();
    const receipt = await pending;
    assert.equal(receipt.versionMatches, true); assert.equal(receipt.bodyCompleted, true); assert.equal(configured, true);
    assert.equal(calls.length, 2);
  } finally {
    finishCold?.(); finishSelected?.(); await pending?.catch(() => {});
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
  }
});
