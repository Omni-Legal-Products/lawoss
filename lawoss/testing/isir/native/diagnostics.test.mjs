import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, summarizeNetwork, errorMetadata, settleCleanup } from './diagnostics.mjs';

test('workspace engine proxy diagnostics keep typed endpoints without workspace identities', () => {
  const result = summarizeNetwork([
    { method:'Network.requestWillBeSent',params:{requestId:'synthetic',timestamp:1,request:{url:'http://127.0.0.1:999/workspace/private-id/opencode/global/health'}} },
  ]);
  assert.equal(result.requests[0].endpoint, 'engine.health');
  assert.doesNotMatch(JSON.stringify(result), /private-id|127\.0/);
});

test('network diagnostics retain pending prepare and streams without payload, IDs, URLs or headers', () => {
  const events = [
    { method:'Network.requestWillBeSent',params:{requestId:'secret-id',timestamp:1,request:{url:'http://127.0.0.1:999/workspace/private/lawoss/documents/prepare?token=secret',method:'POST',headers:{authorization:'secret'},postData:'private-source'}}},
    { method:'Network.requestWillBeSent',params:{requestId:'other-secret',timestamp:2,request:{url:'http://127.0.0.1:999/event?directory=private',method:'GET'}}},
    { method:'Network.responseReceived',params:{requestId:'other-secret',timestamp:3,response:{status:200,mimeType:'text/event-stream',headers:{cookie:'secret'}}}},
  ];
  const result=summarizeNetwork(events);
  assert.equal(result.pending,2); assert.equal(result.streams,1);
  assert.deepEqual(result.requests.map(r=>[r.endpoint,r.status]),[['documents.prepare',null],['events',200]]);
  assert.doesNotMatch(JSON.stringify(result),/secret|private|127\.0|headers|postData/);
});

test('only explicitly enabled CI synthetic diagnostics can publish the allowlisted artifact', async () => {
  assert.throws(()=>createNativeDiagnostics({enabled:true,ci:true,mode:'local',outputFile:'/tmp/nope'}),/synthetic/);
  const root=await mkdtemp(path.join(tmpdir(),'native-diagnostics-test-'));
  try {
    const outputFile=path.join(root,'safe.json');
    const diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    diagnostics.phase('startup');
    await assert.rejects(diagnostics.fetch('http://127.0.0.1:1/provider?token=secret',{},30),Error);
    await diagnostics.write({events:[],error:new Error('credential=secret',{cause:Object.assign(new Error('private'),{code:'UND_ERR_HEADERS_TIMEOUT'})})});
    const result=await readFile(outputFile,'utf8');
    assert.match(result,/UND_ERR_HEADERS_TIMEOUT/);assert.match(result,/provider/);assert.doesNotMatch(result,/secret|private|credential|127\.0/);
    assert.equal(JSON.parse(result).requests[0].state,'failed');
  } finally { await rm(root,{recursive:true,force:true}); }
});

test('cleanup attempts every owned resource and preserves the primary failure', async()=>{
  const primary=new Error('primary');let last=false;
  const result=await settleCleanup(primary,[()=>{throw new Error('cleanup');},()=>{last=true;}]);
  assert.equal(result.error,primary);assert.equal(last,true);assert.equal(result.failures.length,1);
  assert.equal((await settleCleanup(null,[()=>{throw new Error('cleanup');}])).error.name,'AggregateError');
  assert.deepEqual(errorMetadata(Object.assign(new Error('secret'),{code:'EPERM'})),{name:'Error',code:'EPERM'});
});

test('a real stalled HTTP header boundary aborts with endpoint and timing retained',async()=>{
  const { createServer }=await import('node:http');
  const server=createServer(()=>{});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const root=await mkdtemp(path.join(tmpdir(),'native-timeout-test-'));
  try {
    const outputFile=path.join(root,'safe.json');
    const diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    diagnostics.phase('configure-provider');
    await assert.rejects(diagnostics.fetch(`http://127.0.0.1:${server.address().port}/provider?directory=private`,{},40),{name:'TimeoutError'});
    await diagnostics.write();
    const result=JSON.parse(await readFile(outputFile,'utf8'));
    assert.equal(result.requests[0].endpoint,'provider');assert.equal(result.requests[0].state,'failed');
    assert.ok(result.requests[0].elapsedMs>=30&&result.requests[0].elapsedMs<1000);
  }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));await rm(root,{recursive:true,force:true});}
});
