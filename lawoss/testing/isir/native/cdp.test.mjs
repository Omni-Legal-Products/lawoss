import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { connectRenderer } from './cdp.mjs';

const { WebSocketServer } = createRequire(new URL('../../../../apps/desktop/package.json', import.meta.url))('ws');

test('owned renderer connection keeps the page active for foreground-only UI polling', async () => {
  const commands = [];
  const server = createServer((_request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify([{ type: 'page', url: `http://127.0.0.1:${server.address().port}/synthetic`, webSocketDebuggerUrl: `ws://127.0.0.1:${server.address().port}/devtools/page/synthetic` }]));
  });
  const sockets = new WebSocketServer({ server });
  sockets.on('connection', socket => socket.on('message', data => {
    const command = JSON.parse(String(data)); commands.push(command);
    socket.send(JSON.stringify({ id: command.id, result: {} }));
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let renderer;
  try {
    renderer = await connectRenderer(`http://127.0.0.1:${server.address().port}`);
    assert.ok(commands.some(command => command.method === 'Emulation.setFocusEmulationEnabled' && command.params.enabled === true), 'Native connection must activate its owned page before returning');
  } finally {
    renderer?.close();
    await new Promise(resolve => sockets.close(resolve));
    await new Promise(resolve => server.close(resolve));
  }
});
