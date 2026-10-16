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

test('CDP classifies only exact Runtime.evaluate navigation and preserves original error messages',async()=>{
  const { connectRenderer, isNativeShutdownNavigation }=await import('./cdp.mjs');
  const original=globalThis.WebSocket;let response;
  class Socket extends EventTarget {
    constructor(){super();queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    send(raw){const request=JSON.parse(raw);queueMicrotask(()=>this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify({id:request.id,...(response?{error:response}:{result:{}})})})));}
    close(){}
  }
  let cdp;
  try {globalThis.WebSocket=Socket;cdp=await connectRenderer('http://127.0.0.1:9876',async()=>({json:async()=>[{type:'page',url:'http://127.0.0.1:5173',webSocketDebuggerUrl:'ws://127.0.0.1:9876/fixture'}]}));}
  finally {globalThis.WebSocket=original;}
  try {
    for(const [method,error,expected] of [
      ['Runtime.evaluate',{code:-32000,message:'Inspected target navigated or closed'},true],
      ['Network.enable',{code:-32000,message:'Inspected target navigated or closed'},false],
      ['Runtime.evaluate',{code:-32001,message:'Inspected target navigated or closed'},false],
      ['Runtime.evaluate',{code:-32000,message:'Inspected target navigated or closed unexpectedly'},false],
      ['Runtime.evaluate',{code:-32000,message:'generic network failure'},false],
    ]){
      response=error;
      await assert.rejects(cdp.send(method),actual=>{assert.equal(actual.message,JSON.stringify(error));assert.equal(isNativeShutdownNavigation(actual),expected);assert.equal(actual.code,expected?'ISIR_NATIVE_CDP_SHUTDOWN_NAVIGATION':undefined);return true;});
    }
  } finally {cdp.close();}
});
