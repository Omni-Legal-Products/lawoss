import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, summarizeNetwork, errorMetadata, settleCleanup } from './diagnostics.mjs';

test('network diagnostics retain pending prepare and streams without payload, IDs, URLs or headers', () => {
  const events = [
    { method:'Network.requestWillBeSent',params:{requestId:'secret-id',timestamp:1,request:{url:'http://127.0.0.1:999/workspace/private/lawoss/documents/prepare?token=secret',method:'POST',headers:{authorization:'secret'},postData:'private-source'}}},
    { method:'Network.requestWillBeSent',params:{requestId:'other-secret',timestamp:2,request:{url:'http://127.0.0.1:999/event?directory=private',method:'GET'}}},
    { method:'Network.responseReceived',params:{requestId:'other-secret',timestamp:3,response:{status:200,mimeType:'text/event-stream',headers:{cookie:'secret'}}}},
  ];
  const result=summarizeNetwork(events);
  assert.equal(result.pending,2); assert.equal(result.streams,1);
  assert.deepEqual(result.requests.map(r=>[r.endpoint,r.status]),[['documents.prepare',null],['scoped-workspace-engine',200]]);
  assert.doesNotMatch(JSON.stringify(result),/secret|private|127\.0|headers|postData/);
});

test('network durations use only monotonic Network timestamps and stop at completion',()=>{
  const result=summarizeNetwork([
    {method:'Network.requestWillBeSent',params:{requestId:'a',timestamp:10,request:{url:'http://localhost/provider'}}},
    {method:'Runtime.consoleAPICalled',params:{timestamp:1800000000000,args:[{value:'private'}]}},
    {method:'Network.loadingFinished',params:{requestId:'a',timestamp:10.25}},
    {method:'Network.requestWillBeSent',params:{requestId:'b',timestamp:11,request:{url:'http://localhost/provider'}}},
  ]);
  assert.equal(result.requests.find(r=>r.state==='finished').ageMs,250);
  assert.equal(result.requests.find(r=>r.state==='pending').ageMs,0);
});

test('document epochs separate historical pending requests and classify independent subscriptions',()=>{
  const request=(id,loader,url,time,type='Fetch')=>({method:'Network.requestWillBeSent',params:{requestId:id,loaderId:loader,frameId:'private-frame',type,timestamp:time,request:{url:`http://localhost${url}`}}});
  const result=summarizeNetwork([
    request('a','old','/sync/events',1),
    request('b','old','/event',2),
    request('c','old','/event?directory=private-root',3),
    request('d','old','/workspace/ws_native_7/events',4),
    request('navigation','new','/',5,'Document'),
    {method:'Page.frameNavigated',params:{frame:{id:'private-frame',loaderId:'new',url:'http://localhost/?secret=private'}}},
    request('e','new','/workspace/ws_native_8/opencode/event',6),
    {method:'Network.responseReceived',params:{requestId:'e',timestamp:6.1,response:{status:200,mimeType:'text/event-stream'}}},
  ]);
  assert.equal(result.pending,2);assert.equal(result.streams,1);
  assert.equal(result.history.pending,4);assert.equal(result.history.total,4);
  assert.deepEqual(result.history.requests.map(r=>r.endpoint),['app-sync','unscoped-engine','scoped-workspace-engine','reload-poll']);
  assert.equal(result.requests.find(r=>r.stream).workspaceIndex,8);
  assert.ok(result.history.requests.every(r=>r.epoch<result.epoch));
  assert.doesNotMatch(JSON.stringify(result),/private|localhost|frame|loader|directory/);
});

test('redirects and request ID reuse preserve bounded history without silently finishing old requests',()=>{
  const events=[];
  for(let i=0;i<300;i++){
    events.push({method:'Network.requestWillBeSent',params:{requestId:'reused',loaderId:`loader-${i}`,type:'Document',frameId:'frame',timestamp:i+1,request:{url:'http://localhost/'}}});
    events.push({method:'Page.frameNavigated',params:{frame:{id:'frame',loaderId:`loader-${i}`}}});
  }
  events.push({method:'Network.requestWillBeSent',params:{requestId:'reused',loaderId:'loader-299',timestamp:301,redirectResponse:{status:302},request:{url:'http://localhost/provider'}}});
  const result=summarizeNetwork(events);
  assert.equal(result.total,2);assert.equal(result.pending,1);
  assert.equal(result.history.total,299);assert.equal(result.history.pending,299);
  assert.ok(result.history.requests.length<=128);assert.ok(result.requests.length<=128);
  assert.equal(result.requests.find(r=>r.state==='redirected').status,302);
});

test('late old-document completion updates history and subframe navigation does not reset the main epoch',()=>{
  const result=summarizeNetwork([
    {method:'Network.requestWillBeSent',params:{requestId:'old',loaderId:'one',frameId:'main',timestamp:1,request:{url:'http://localhost/event'}}},
    {method:'Network.responseReceived',params:{requestId:'old',timestamp:2,response:{status:200,mimeType:'text/event-stream'}}},
    {method:'Page.frameNavigated',params:{frame:{id:'main',loaderId:'two'}}},
    {method:'Page.frameNavigated',params:{frame:{id:'child',parentId:'main',loaderId:'three'}}},
    {method:'Network.requestWillBeSent',params:{requestId:'new',loaderId:'two',frameId:'main',timestamp:3,request:{url:'http://localhost/provider'}}},
    {method:'Network.loadingFailed',params:{requestId:'old',timestamp:4}},
  ]);
  assert.equal(result.epoch,1);assert.equal(result.pending,1);
  assert.equal(result.history.pending,0);assert.equal(result.history.streams,0);
  assert.equal(result.history.requests[0].state,'failed');
  assert.equal(result.history.requests[0].ageMs,3000);
});

test('diagnostic storage is bounded and lost request correlation is explicit',()=>{
  const events=Array.from({length:5000},(_,i)=>({method:'Network.requestWillBeSent',params:{requestId:`private-${i}`,timestamp:i,request:{url:`http://origin-${i}/provider`}}}));
  const result=summarizeNetwork(events);
  assert.equal(result.total,5000);assert.equal(result.pending,5000);
  assert.equal(result.trackingDropped,904);
  assert.equal(result.requests.length,128);assert.equal(result.history.requests.length,0);
  assert.ok(result.requests.every(r=>r.origin===null));
  assert.doesNotMatch(JSON.stringify(result),/private|origin-/);
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

test('failure probes reach the actual failing case and otherwise the selected workspace',async()=>{
  const {createServer}=await import('node:http');
  const received=[];
  const server=createServer((req,res)=>{received.push(req.url);res.writeHead(200).end('{"documents":[],"secret":"private"}');});
  const root=await mkdtemp(path.join(tmpdir(),'native-probe-test-'));
  try {
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    const outputFile=path.join(root,'safe.json');
    const diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    const args={serverInfo:{baseUrl:`http://127.0.0.1:${server.address().port}`},serverAuth:{authorization:'Bearer private'},workspaces:Array.from({length:10},(_,i)=>({id:`ws_native_${i+1}`})),selectedIndex:4};
    diagnostics.phase('preparation-admission',7);
    await diagnostics.probeWorkspace(args);
    diagnostics.phase('extra-cases');
    await diagnostics.probeWorkspace(args);
    assert.deepEqual(received,['/workspace/ws_native_7/lawoss/documents','/workspace/ws_native_4/lawoss/documents']);
    await diagnostics.write();
    const text=await readFile(outputFile,'utf8'),result=JSON.parse(text);
    assert.deepEqual(result.requests.map(r=>[r.probeCaseIndex,r.status]),[[7,200],[4,200]]);
    assert.doesNotMatch(text,/private|secret|Bearer|127\.0|ws_native/);
  } finally {
    server.closeAllConnections();await new Promise(resolve=>server.close(resolve));
    await rm(root,{recursive:true});
  }
});

test('selected-instance category and finite startup/census projections are bounded and exclude raw identity',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-stages-test-'));
  try{
    const outputFile=path.join(root,'safe.json'),d=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    d.phase('startup');
    for(let i=0;i<40;i++)d.startup(['request','headers','body','verified'][i%4]);
    for(let i=0;i<150;i++)d.ownedProcess({stage:'term-wait',index:i+1,elapsedMs:i,knownLive:1,unknown:0,moved:0,mismatched:0,leaderExited:true,anchored:true,pid:987654,uid:987654,start:'PRIVATE-IDENTITY',command:'PRIVATE-COMMAND',directory:'PRIVATE-ROOT'});
    assert.throws(()=>d.startup('PRIVATE-STAGE'),/stage/);
    assert.throws(()=>d.ownedProcess({stage:'PRIVATE-STAGE'}),/stage/);
    assert.throws(()=>d.ownedProcess({stage:'term-wait',index:-1}),/census/);
    await d.write({events:[{method:'Network.requestWillBeSent',params:{requestId:'PRIVATE-ID',timestamp:1,request:{url:'http://private-host/path?directory=PRIVATE-ROOT&token=PRIVATE-TOKEN'}}}]});
    const text=await readFile(outputFile,'utf8'),result=JSON.parse(text);
    assert.equal(result.schema,3);assert.equal(result.network.requests[0].endpoint,'engine.path');
    assert.equal(result.startup.length,32);assert.equal(result.startupDropped,8);
    assert.equal(result.ownedProcesses.length,128);assert.equal(result.ownedProcessesDropped,22);
    assert.deepEqual(result.ownedProcesses[0],{phase:'startup',stage:'term-wait',index:23,elapsedMs:22,knownLive:1,unknown:0,moved:0,mismatched:0,leaderExited:true,anchored:true});
    assert.doesNotMatch(text,/PRIVATE|private-host|987654|"pid"|"uid"|command|directory/);
  }finally{await rm(root,{recursive:true,force:true});}
});
