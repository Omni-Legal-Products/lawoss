import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { test } from 'node:test';
import { awaitDirectoryInstance } from './startup-readiness.mjs';

async function fixture(run) {
  let release, arrive, onClose, closed = 0, resets = 0;
  const arrived = new Promise(resolve => { arrive = resolve; });
  const closedBody = new Promise(resolve => { onClose = resolve; });
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://fixture');
    if (url.pathname === '/global/health') { res.end('{"healthy":true}'); return; }
    if (url.pathname === '/tick') { res.end('ok'); return; }
    if (url.pathname === '/reset') { assert.equal(req.method, 'POST'); resets++; res.end('reset'); return; }
    assert.equal(url.pathname, '/path');
    assert.equal(req.headers.authorization, 'Basic fixture');
    assert.equal(url.searchParams.get('directory'), '/fixture/č');
    res.once('close', () => { closed++; onClose(); });
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"directory":');
    release = directory => res.end(JSON.stringify(directory) + ',"worktree":"/different-worktree"}');
    arrive();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try { await run({ baseUrl, arrived, closedBody, release: value => release?.(value), closed: () => closed, resets: () => resets }); }
  finally { release?.('/fixture/č'); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

test('healthy UI/global endpoint cannot start reset before authenticated selected-instance whole body', async () => {
  await fixture(async ({ baseUrl, arrived, release, resets }) => {
    const uiReady = true;
    assert.equal(uiReady, true);
    assert.equal((await (await fetch(baseUrl + '/global/health')).json()).healthy, true);
    const pending = awaitDirectoryInstance({ request: fetch, baseUrl, headers: { authorization: 'Basic fixture' }, directory: '/fixture/č', deadline: Date.now() + 2000 }).then(async receipt => { await (await fetch(baseUrl + '/reset', { method: 'POST' })).text(); return receipt; });
    await Promise.race([arrived, pending]);
    await (await fetch(baseUrl + '/tick')).text();
    assert.equal(resets(), 0, 'UI and global liveness must not acknowledge an unfinished instance body');
    release('/fixture/č');
    const receipt = await pending;
    assert.equal(resets(), 1);
    assert.deepEqual(receipt, { status: 200, authenticated: true, directoryMatches: true, worktreeMatchesDirectory: false, bodyCompleted: true });
  });
});

test('original absolute deadline aborts held real response body and releases its socket', async () => {
  await fixture(async ({ baseUrl, arrived, closedBody, closed }) => {
    const pending = awaitDirectoryInstance({ request: fetch, baseUrl, headers: { authorization: 'Basic fixture' }, directory: '/fixture/č', deadline: Date.now() + 100 });
    const rejected = assert.rejects(pending, { name: 'TimeoutError' });
    await arrived;
    await rejected;
    await closedBody;
    assert.equal(closed(), 1);
  });
});

test('wrong selected-directory response rejects before reset without leaking scope', async () => {
  await fixture(async ({ baseUrl, arrived, release }) => {
    let resets = 0;
    const pending = awaitDirectoryInstance({ request: fetch, baseUrl, headers: { authorization: 'Basic fixture' }, directory: '/fixture/č', deadline: Date.now() + 2000 }).then(() => resets++);
    const rejected = assert.rejects(pending, error => error.message === 'Selected instance readiness scope mismatch');
    await arrived; release('/previous-owner/private'); await rejected;
    assert.equal(resets, 0);
  });
});

test('expired shared budget and missing auth reject without making a request', async () => {
  let requests = 0;
  const input = { request: () => requests++, baseUrl: 'http://127.0.0.1:1', headers: { authorization: 'Basic fixture' }, directory: '/fixture/č', deadline: Date.now() - 1 };
  await assert.rejects(awaitDirectoryInstance(input), { name: 'TimeoutError' });
  await assert.rejects(awaitDirectoryInstance({ ...input, headers: {}, deadline: Date.now() + 2000 }), /readiness scope required/);
  assert.equal(requests, 0);
});

test('HTTP transport primary error identity survives readiness cleanup', async () => {
  const server = createServer((req, res) => req.socket.destroy());
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let original;
  try {
    await assert.rejects(awaitDirectoryInstance({ request: async (...args) => { try { return await fetch(...args); } catch (error) { original = error; throw error; } }, baseUrl: `http://127.0.0.1:${server.address().port}`, headers: { authorization: 'Basic fixture' }, directory: '/fixture', deadline: Date.now() + 2000 }), error => error === original);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

test('Windows separators/case normalize but POSIX distinct names remain distinct', async () => {
  for (const [platform, directory, returned, success] of [
    ['win32', 'C:\\Fixture\\č', 'c:/fixture/č/', true],
    ['darwin', '/fixture/č', '/Fixture/č', false],
    ['darwin', '/fixture\\č', '/fixture/č', false],
  ]) {
    const server = createServer((req, res) => { assert.equal(new URL(req.url, 'http://fixture').searchParams.get('directory'), directory); res.end(JSON.stringify({ directory: returned, worktree: returned })); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const pending = awaitDirectoryInstance({ request: fetch, baseUrl: `http://127.0.0.1:${server.address().port}`, headers: { authorization: 'Basic fixture' }, directory, platform, deadline: Date.now() + 2000 });
      if (success) assert.equal((await pending).directoryMatches, true);
      else await assert.rejects(pending, /scope mismatch/);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  }
});
