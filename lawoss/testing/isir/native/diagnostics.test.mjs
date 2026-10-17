import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, summarizeNetwork, errorMetadata, settleCleanup } from './diagnostics.mjs';

test('recovered renderer identity waits for the actual settled moved root and owned client', async () => {
  const { recoveryRendererIdentity } = await import('./diagnostics.mjs');
  assert.equal(typeof recoveryRendererIdentity, 'function');
  const expected={workspaceId:'synthetic-workspace',root:'/synthetic/moved',baseUrl:'http://127.0.0.1:4321/'};
  const ready={selectedWorkspaceId:expected.workspaceId,workspaces:[{id:expected.workspaceId,path:expected.root}],baseUrl:'http://127.0.0.1:4321',connected:true,loading:false,retryingWorkspaceIds:[]};
  assert.equal(recoveryRendererIdentity(ready,expected).ready,true);
  for (const snapshot of [undefined,null,{}, {...ready,selectedWorkspaceId:'old'}, {...ready,workspaces:[{id:expected.workspaceId,path:'/synthetic/old'}]}, {...ready,baseUrl:'http://127.0.0.1:1234'}, {...ready,baseUrl:'https://private.example'}, {...ready,baseUrl:'http://private:secret@127.0.0.1:4321'}, {...ready,loading:true}, {...ready,connected:false}, {...ready,retryingWorkspaceIds:[expected.workspaceId]}, {...ready,retryingWorkspaceIds:null}, {...ready,retryingWorkspaceIds:[null]}, {...ready,workspaces:null}]) {
    assert.equal(recoveryRendererIdentity(snapshot,expected).ready,false);
  }
  assert.equal(recoveryRendererIdentity(ready,{}).ready,false);
  assert.equal(recoveryRendererIdentity(ready,null).ready,false);
  assert.doesNotMatch(JSON.stringify(recoveryRendererIdentity({...ready,raw:'private DOM',error:'secret'},expected)),/synthetic|private|secret|4321|baseUrl/);
});

test('recovery diagnostics project fixed panel states and bounded values without arbitrary metadata', async () => {
  const { summarizeRecoveryVerification } = await import('./diagnostics.mjs');
  assert.equal(typeof summarizeRecoveryVerification, 'function');
  const result = summarizeRecoveryVerification({
    visibility:'visible',focused:true,viewportWidth:1800,viewportHeight:1400,panelCount:2,visiblePanelCount:1,firstPanelVisible:false,firstPanelVerified:false,visible:true,folderMatches:true,selectedFiles:4,alerts:1,
    badges:{verified:0,checking:2,invalid:1,secret:'private DOM'},
    controls:{prepareFolder:{count:1,disabled:0,error:'private error'},validate:{count:2,disabled:2},secret:'private URL'},
    identity:{ready:true,workspaceRoot:false,serverOrigin:true,private:'private identity'},
    text:'private source',url:'https://private.example',error:'private message',
  }, []);
  assert.equal(result.panel.focused,true);
  assert.equal(result.panel.selectedFiles,4);
  assert.deepEqual(result.panel.viewport,{width:1800,height:1400});
  assert.equal(result.panel.visiblePanelCount,1);assert.equal(result.panel.firstPanelVisible,false);
  assert.equal(result.panel.badges.checking,2);
  assert.deepEqual(result.panel.controls.validate,{count:2,disabled:2});
  assert.equal(result.identity.ready,true);assert.equal(result.identity.workspaceRoot,false);
  assert.doesNotMatch(JSON.stringify(result),/private|secret|text|url|error/);
  const malformed=summarizeRecoveryVerification({visibility:'private source',focused:'private',panelCount:Infinity,selectedFiles:21,badges:{checking:-1},controls:{validate:{count:1e99,disabled:NaN}}},[]);
  assert.equal(malformed.panel.visibility,'unknown');assert.equal(malformed.panel.focused,null);
  assert.equal(malformed.panel.selectedFiles,null);assert.equal(malformed.panel.panelCount,0);
  assert.equal(malformed.panel.badges.checking,0);assert.equal(malformed.panel.controls.validate.count,0);
});

test('recovery request timings use fixed document categories and monotonic network timestamps', async () => {
  const { summarizeRecoveryVerification } = await import('./diagnostics.mjs');
  assert.equal(typeof summarizeRecoveryVerification, 'function');
  const event=(method,params)=>({method,params});
  const request=(requestId,url,timestamp,method='GET')=>event('Network.requestWillBeSent',{requestId,timestamp,request:{url,method,headers:{authorization:'private'},postData:'private'}});
  const result=summarizeRecoveryVerification({},[
    request('private-read','http://127.0.0.1:1234/workspace/private/lawoss/documents/private-id/read?token=private',1),
    event('Network.responseReceived',{requestId:'private-read',timestamp:1.4,response:{status:200}}),
    event('Network.loadingFinished',{requestId:'private-read',timestamp:1.5}),
    request('private-outputs','http://127.0.0.1:1234/workspace/private/lawoss/documents/outputs',1.5),
    request('external','https://private.example/workspace/private/lawoss/documents/outputs',1.6),
    request('prepare','http://127.0.0.1:1234/workspace/private/lawoss/documents/prepare',1.7,'POST'),
    event('Network.loadingFailed',{requestId:'prepare',timestamp:2,errorText:'private'}),
    event('Runtime.exceptionThrown',{timestamp:1792219181652,exceptionDetails:{text:'private'}}),
  ]);
  assert.deepEqual(result.requests.read,{started:1,pending:0,finished:1,failed:0,httpOk:1,httpFailure:0,maxElapsedMs:500,maxHeadersMs:400});
  assert.equal(result.requests.outputs.pending,1);assert.equal(result.requests.outputs.maxElapsedMs,500);
  assert.equal(result.requests.prepare.failed,1);assert.equal(result.requests.prepare.maxElapsedMs,300);
  const bounded=summarizeRecoveryVerification({},[
    request('bounded','http://127.0.0.1:1234/workspace/private/lawoss/documents',1),
    event('Network.loadingFinished',{requestId:'bounded',timestamp:1e99}),
  ]);
  assert.equal(bounded.requests.sources.maxElapsedMs,300_000);
  assert.deepEqual(Object.keys(bounded.requests),['sources','read','outputs','prepare']);
  assert.doesNotMatch(JSON.stringify(result),/private|https|127\.0|requestId|headers|postData|errorText/);
});

test('workspace engine proxy diagnostics keep typed endpoints without workspace identities', () => {
  const result = summarizeNetwork([
    { method:'Network.requestWillBeSent',params:{requestId:'synthetic',timestamp:1,request:{url:'http://127.0.0.1:999/workspace/private-id/opencode/global/health'}} },
    { method:'Network.requestWillBeSent',params:{requestId:'reload',timestamp:2,request:{url:'http://127.0.0.1:999/workspace/private-id/engine/reload'}} },
  ]);
  assert.equal(result.requests[0].endpoint, 'engine.health');
  assert.equal(result.requests[1].endpoint, 'engine.reload');
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

test('renderer aggregates retain failed imports under pending tail pressure without private paths or exception text', () => {
  const events = [
    { method:'Network.requestWillBeSent',params:{requestId:'private-dependency',timestamp:1,request:{url:'http://127.0.0.1:999/node_modules/private-client.js?token=secret'}} },
    { method:'Network.responseReceived',params:{requestId:'private-dependency',timestamp:2,response:{status:500}} },
    { method:'Network.loadingFinished',params:{requestId:'private-dependency',timestamp:3} },
    ...Array.from({length:130},(_,i)=>({method:'Network.requestWillBeSent',params:{requestId:`private-${i}`,timestamp:4,request:{url:`http://127.0.0.1:999/src/private-case-${i}.tsx`}}})),
    { method:'Runtime.exceptionThrown',params:{timestamp:1792219181651,exceptionDetails:{text:'secret private-case',exception:{className:'TypeError',description:'secret'}}} },
    { method:'Runtime.exceptionThrown',params:{timestamp:1792219181652,exceptionDetails:{exception:{className:'PrivateClientError'}}} },
  ];
  const result=summarizeNetwork(events);
  assert.equal(result.requests.length,128);
  assert.ok(result.renderer,'All renderer requests must contribute to bounded aggregates');
  assert.deepEqual(result.renderer.network,[
    {category:'dependency',statusFamily:'5xx',state:'finished',count:1},
    {category:'source',statusFamily:'none',state:'pending',count:130},
  ]);
  assert.equal(result.renderer.http500Count,1);
  assert.deepEqual(result.renderer.exceptions,[{name:'TypeError',count:1},{name:'Error',count:1}]);
  assert.equal(result.requests[0].ageMs,0,'Runtime epoch timestamps must not enter the Network monotonic clock');
  assert.doesNotMatch(JSON.stringify(result),/private|secret|127\.0|PrivateClientError|tsx|\.js/);
});

test('adversarial renderer statuses cannot create unbounded aggregate keys', () => {
  const events=Array.from({length:2000},(_,i)=>[
    {method:'Network.requestWillBeSent',params:{requestId:String(i),timestamp:1,request:{url:'http://127.0.0.1:999/src/private.ts'}}},
    {method:'Network.responseReceived',params:{requestId:String(i),timestamp:2,response:{status:i-1000}}},
    {method:'Network.loadingFinished',params:{requestId:String(i),timestamp:3}},
  ]).flat();
  const result=summarizeNetwork(events);
  assert.ok(result.renderer.network.length<=84,'Four fixed categories, seven status families and three states bound the aggregate');
  assert.equal(result.renderer.network.reduce((sum,r)=>sum+r.count,0),2000);
  assert.equal(result.renderer.http500Count,1);
  assert.ok(result.renderer.network.every(r=>['none','1xx','2xx','3xx','4xx','5xx','other'].includes(r.statusFamily)));
});

test('renderer request categories and monotonic ages use fixed labels only', () => {
  const result=summarizeNetwork([
    ...['/assets/private.png','/@vite/client','/@fs/private/node_modules/pkg/index.js'].map((pathname,i)=>({method:'Network.requestWillBeSent',params:{requestId:String(i),timestamp:1,request:{url:`http://127.0.0.1:999${pathname}`}}})),
    {method:'Network.loadingFailed',params:{requestId:'0',timestamp:2,errorText:'private failure'}},
    {method:'Runtime.consoleAPICalled',params:{timestamp:1792219181652,args:[{value:'secret'}]}},
  ]);
  assert.ok(result.renderer,'Renderer categories must be summarized');
  assert.deepEqual(result.renderer.network.map(r=>[r.category,r.state]),[['asset','failed'],['internal','pending'],['dependency','pending']]);
  assert.ok(result.requests.every(r=>r.ageMs===1000));
  assert.doesNotMatch(JSON.stringify(result),/private|secret|127\.0|errorText/);
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
