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
