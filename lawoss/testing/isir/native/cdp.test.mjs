import assert from 'node:assert/strict';
import test from 'node:test';
import { until } from './cdp.mjs';
import { errorMetadata } from './diagnostics.mjs';

test('until own expiry keeps the Error and adds only the fixed diagnostic code',async()=>{
  let reads=0;
  await assert.rejects(until(()=>{reads++;return true;},'controlled deadline',0),error=>{
    assert.equal(error.constructor,Error);
    assert.equal(error.message,'Timed out: controlled deadline; last=undefined');
    assert.equal(error.code,'ISIR_NATIVE_WAIT_EXPIRED');
    assert.deepEqual(errorMetadata(error),{name:'Error',code:'ISIR_NATIVE_WAIT_EXPIRED'});
    return true;
  });
  assert.equal(reads,0);
});

test('until returns the actual first truthy read and keeps false/throwing retries',async()=>{
  const result={ready:true};let reads=0;
  assert.equal(await until(()=>{reads++;return result;},'immediate'),result);
  assert.equal(reads,1);
  reads=0;
  assert.equal(await until(()=>{reads++;if(reads===1)return false;if(reads===2)throw new Error('controlled read');return result;},'retry',2000),result);
  assert.equal(reads,3);
});

test('until false and throwing reads retain last-value expiry semantics',async t=>{
  t.mock.timers.enable({apis:['Date'],now:1000});
  for(const [read,last] of [[()=>false,'false'],[()=>{throw new Error('controlled read');},'Error: controlled read']]){
    let reads=0;
    await assert.rejects(until(()=>{reads++;t.mock.timers.tick(2);return read();},'controlled retry deadline',1),error=>{
      assert.equal(error.constructor,Error);
      assert.equal(error.message,`Timed out: controlled retry deadline; last=${last}`);
      assert.equal(error.code,'ISIR_NATIVE_WAIT_EXPIRED');return true;
    });
    assert.equal(reads,1);
  }
});

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
