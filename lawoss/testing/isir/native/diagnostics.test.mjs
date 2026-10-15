import assert from 'node:assert/strict';
import test from 'node:test';
import * as fs from 'node:fs/promises';
import { mkdtemp, readFile, rm, mkdir, writeFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, summarizeNetwork, errorMetadata, settleCleanup, projectEngineLog } from './diagnostics.mjs';

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
    assert.equal(result.schema,4);assert.equal(result.network.requests[0].endpoint,'engine.path');
    assert.equal(result.startup.length,32);assert.equal(result.startupDropped,8);
    assert.equal(result.ownedProcesses.length,128);assert.equal(result.ownedProcessesDropped,22);
    assert.deepEqual(result.ownedProcesses[0],{phase:'startup',stage:'term-wait',index:23,elapsedMs:22,knownLive:1,unknown:0,moved:0,mismatched:0,leaderExited:true,anchored:true});
    assert.doesNotMatch(text,/PRIVATE|private-host|987654|"pid"|"uid"|command|"directory"/);
  }finally{await rm(root,{recursive:true,force:true});}
});

// Source-format synthetic fixtures only. Removing the scope, grammar or bounded
// read checks must make these assertions fail, without publishing fixture bytes.
const logLaunch=Date.parse('2026-10-15T10:00:00.000Z');
const logLine=(message,extra='',level='INFO',time=logLaunch+1,run='PRIVATE-RUN')=>
  `timestamp=${new Date(time).toISOString()} level=${level} run=${run} message=${JSON.stringify(message)}${extra?' '+extra:''}\n`;
async function logFixture(run){
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'lawoss-isir-native-')));
  try{
    const selectedDirectory=path.join(root,'cases','PRIVATE-CASE');
    await mkdir(selectedDirectory,{recursive:true});
    const logFile=path.join(root,'profile/legalwork-dev-data/xdg/data/opencode/log/opencode.log');
    await mkdir(path.dirname(logFile),{recursive:true});
    const outputFile=path.join(root,'safe.json');
    const capture={error:new Error('PRIVATE-PRIMARY'),selectedDirectory,launchWallMs:logLaunch,deadlineWallMs:logLaunch+90000,captureWallMs:logLaunch+90001};
    const make=(options={})=>{const d=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',ownedRoot:root,outputFile,...options});d.phase('startup');return d;};
    await run({root,selectedDirectory,logFile,outputFile,capture,make});
  }finally{await rm(root,{recursive:true,force:true});}
}
async function capturedLog(f,d=f.make(),capture=f.capture){
  await d.captureEngineLog(capture);
  await d.write({error:capture.error});
  return JSON.parse(await readFile(f.outputFile,'utf8'));
}
function assertClosedLog(value){
  const keys=['status','clockWindowValid','correlation','absenceInconclusive','bytesRead','unscannedBytesAtOpen','fileChanged','scannedLines','oversizedLineCount','partialLineCount','malformedCount','unknownCount','timestampOutlierCount','otherDirectoryCount','runCount','directoryCount','ambiguous','lineLimitReached','eventLimitReached','droppedEvents','events'];
  assert.deepEqual(Object.keys(value).sort(),keys.sort());
  assert.ok(['disabled','unavailable','missing','unreadable','unsafe','available'].includes(value.status));
  assert.equal(value.correlation,'unavailable');assert.equal(value.absenceInconclusive,true);
  for(const key of ['bytesRead','unscannedBytesAtOpen','scannedLines','oversizedLineCount','partialLineCount','malformedCount','unknownCount','timestampOutlierCount','otherDirectoryCount','runCount','directoryCount','droppedEvents'])assert.ok(Number.isSafeInteger(value[key])&&value[key]>=0&&value[key]<=Number.MAX_SAFE_INTEGER,key);
  for(const key of ['clockWindowValid','absenceInconclusive','fileChanged','ambiguous','lineLimitReached','eventLimitReached'])assert.equal(typeof value[key],'boolean',key);
  assert.ok(value.bytesRead<=262144);assert.ok(value.scannedLines<=4096);assert.ok(value.events.length<=64);
  for(const event of value.events){
    assert.deepEqual(Object.keys(event).sort(),['event','evidenceScope']);
    assert.ok(['selected-directory','engine-run'].includes(event.evidenceScope));
    assert.match(event.event,/^(instance\.(create|reload|dispose)|project\.resolve|bootstrap\.(enter|service-error)|config\.(read|dependency-error|global-error)|post-plugin\.(lsp|format)|plugin\.(internal-error|apply-error|config-error))-observed$/);
  }
}
test('default engine log uses exact tuples, private fields and selected-directory scope only',async()=>{
  await logFixture(async f=>{
    const sentinels=['PRIVATE-AUTH','https://PRIVATE-URL','PRIVATE-BODY','PRIVATE-ERROR','PRIVATE-CAUSE','PRIVATE-STACK','PRIVATE-COMMAND','PRIVATE-PLUGIN','PRIVATE-RUN','PRIVATE-CASE','PRIVATE-ANNOTATION'];
    const extras=sentinels.map((v,i)=>`field${i}=${JSON.stringify(v+' \"quoted\" \\ escaped')}`).join(' ');
    const known=[['all LSPs are disabled','INFO','post-plugin.lsp-observed'],['enabled LSP servers','INFO','post-plugin.lsp-observed'],['all formatters are disabled','INFO','post-plugin.format-observed'],['loading','INFO','config.read-observed'],['background dependency install failed','WARN','config.dependency-error-observed'],['failed to load global config, using defaults','ERROR','config.global-error-observed'],['failed to load internal plugin','ERROR','plugin.internal-error-observed'],['failed to load plugin','ERROR','plugin.apply-error-observed'],['plugin config hook failed','ERROR','plugin.config-error-observed'],['init failed','WARN','bootstrap.service-error-observed']];
    const selected=['creating instance','fromDirectory','bootstrapping','reloading instance','disposing instance'];
    await writeFile(f.logFile,selected.map(m=>logLine(m,`directory=${JSON.stringify(f.selectedDirectory)} ${extras}`)).join('')+known.map(([m,l])=>logLine(m,extras,l)).join(''));
    const result=await capturedLog(f),log=result.engineLog;
    assert.equal(result.schema,4);assertClosedLog(log);assert.equal(log.status,'available');
    assert.deepEqual(log.events.slice(0,5),['instance.create-observed','project.resolve-observed','bootstrap.enter-observed','instance.reload-observed','instance.dispose-observed'].map(event=>({event,evidenceScope:'selected-directory'})));
    assert.deepEqual(log.events.slice(5),known.map(([, ,event])=>({event,evidenceScope:'engine-run'})));
    assert.equal(log.runCount,1);assert.equal(log.directoryCount,1);assert.equal(log.ambiguous,false);
    for(const sentinel of sentinels)assert.ok(!JSON.stringify(result).includes(sentinel),sentinel);
  });
});
test('engine records reject spoofed fields, duplicate keys, malformed, partial and time outliers',async()=>{
  await logFixture(async f=>{
    const dir=`directory=${JSON.stringify(f.selectedDirectory)}`;
    const records=[
      logLine('bootstrapping',dir),
      logLine('PRIVATE-UNKNOWN',`fake=${JSON.stringify('message=bootstrapping')} ${dir}`),
      logLine('bootstrapping',dir,'ERROR'),
      logLine('bootstrapping',dir+' message=bootstrapping'),
      logLine('bootstrapping',dir+' level=INFO'),
      logLine('bootstrapping',dir+' directory=PRIVATE-OTHER'),
      logLine('bootstrapping',`directory=${JSON.stringify(path.join(f.root,'PRIVATE-OTHER'))}`),
      logLine('bootstrapping',dir,'INFO',logLaunch-1),
      logLine('bootstrapping',dir,'INFO',logLaunch+90001),
      'timestamp=PRIVATE-TIME level=INFO run=PRIVATE-RUN message=bootstrapping\n',
      'timestamp=2026-10-15T10:00:00.001Z level=INFO run=PRIVATE-RUN message="bad\\q"\n',
      logLine('bootstrapping',dir+' bad="unterminated'),
      'x'.repeat(16385)+'\n',
      logLine('bootstrapping',dir).trimEnd(),
    ];
    await writeFile(f.logFile,records.join(''));
    const {engineLog:log}=await capturedLog(f);assertClosedLog(log);
    assert.equal(log.events.length,1);assert.equal(log.malformedCount,6);assert.equal(log.unknownCount,2);
    assert.equal(log.otherDirectoryCount,1);assert.equal(log.timestampOutlierCount,2);
    assert.equal(log.oversizedLineCount,1);assert.equal(log.partialLineCount,1);
    assert.doesNotMatch(JSON.stringify(log),/PRIVATE/);
  });
});
test('engine log guard has zero filesystem operations without authorized primary startup context',async()=>{
  await logFixture(async f=>{
    const io=new Proxy({}, {get(){throw new Error('PRIVATE-FS-MUST-NOT-RUN');}});
    for(const [options,capture,phase] of [[{enabled:false},f.capture,'startup'],[{enabled:false,ci:false,mode:'local'},f.capture,'startup'],[{}, {...f.capture,selectedDirectory:path.dirname(f.root)},'startup'],[{}, {...f.capture,error:null},'startup'],[{ownedRoot:path.dirname(f.root)},f.capture,'startup'],[{},f.capture,'complete']]){
      const d=f.make({...options,engineLogFs:io});d.phase(phase);
      await d.captureEngineLog(capture);
      // Disabled diagnostics intentionally do not write an artifact.
      if(options.enabled!==false){await d.write();assertClosedLog(JSON.parse(await readFile(f.outputFile,'utf8')).engineLog);}
    }
    for(const options of [{ci:false},{mode:'local'}])assert.throws(()=>f.make({...options,engineLogFs:io}),/synthetic/);
  });
});
test('engine log reports missing, unreadable and unsafe files without replacing the primary error',async()=>{
  await logFixture(async f=>{
    assert.equal((await capturedLog(f)).engineLog.status,'missing');
    await writeFile(f.logFile,logLine('loading'));
    const denied={...fs,open:async()=>{throw Object.assign(new Error('PRIVATE-ACCESS'),{code:'EACCES'});}};
    assert.equal((await capturedLog(f,f.make({engineLogFs:denied}))).engineLog.status,'unreadable');
    await rm(f.logFile);await mkdir(f.logFile);
    assert.equal((await capturedLog(f)).engineLog.status,'unsafe');
    await rm(f.logFile,{recursive:true});
    const outside=path.join(f.root,'PRIVATE-OUTSIDE');await writeFile(outside,logLine('loading'));
    await symlink(outside,f.logFile);
    assert.equal((await capturedLog(f)).engineLog.status,'unsafe');
    await rm(f.logFile);await rm(path.join(f.root,'profile'),{recursive:true});
    await symlink(f.root,path.join(f.root,'profile'),process.platform==='win32'?'junction':'dir');
    assert.equal((await capturedLog(f)).engineLog.status,'unsafe');
    const primary=f.capture.error;
    assert.equal((await settleCleanup(primary,[()=>f.make().captureEngineLog(f.capture)])).error,primary);
  });
});
test('one prefix read bounds bytes, line and event retention and reports concurrent change',async()=>{
  await logFixture(async f=>{
    let reads=0,requested=0;
    await writeFile(f.logFile,logLine('loading').repeat(6000));
    const io={...fs,open:async(...args)=>{
      const handle=await fs.open(...args);
      return {stat:options=>handle.stat(options),close:()=>handle.close(),read:async(...readArgs)=>{
        reads++;requested=readArgs[2];const result=await handle.read(...readArgs);
        await fs.appendFile(f.logFile,'PRIVATE-CONCURRENT\n');return result;
      }};
    }};
    const d=f.make({engineLogFs:io});const {engineLog:log}=await capturedLog(f,d);
    await d.captureEngineLog(f.capture);
    assertClosedLog(log);assert.equal(reads,1);assert.equal(requested,262144);
    assert.equal(log.bytesRead,262144);assert.ok(log.unscannedBytesAtOpen>0);assert.equal(log.fileChanged,true);
    assert.equal(log.events.length,64);assert.equal(log.eventLimitReached,true);assert.ok(log.droppedEvents>0);
    assert.equal(log.partialLineCount,1);assert.doesNotMatch(JSON.stringify(log),/PRIVATE/);
    await writeFile(f.logFile,'x\n'.repeat(5000));
    const limited=(await capturedLog(f)).engineLog;
    assert.equal(limited.scannedLines,4096);assert.equal(limited.lineLimitReached,true);assert.equal(limited.malformedCount,4096);
  });
});
test('engine log distinguishes ambiguous runs and directories; invalid clock cannot confer evidence',async()=>{
  await logFixture(async f=>{
    await writeFile(f.logFile,logLine('bootstrapping',`directory=${JSON.stringify(f.selectedDirectory)}`)+logLine('creating instance',`directory=${JSON.stringify(path.join(f.root,'cases','OTHER'))}`,'INFO',logLaunch+2,'OTHER-RUN')+logLine('all LSPs are disabled'));
    const log=(await capturedLog(f)).engineLog;
    assert.equal(log.runCount,2);assert.equal(log.directoryCount,2);assert.equal(log.ambiguous,true);
    assert.deepEqual(log.events.map(e=>e.evidenceScope),['selected-directory','engine-run']);
    const invalid=(await capturedLog(f,f.make(),{...f.capture,launchWallMs:NaN})).engineLog;
    assert.equal(invalid.status,'unavailable');assert.equal(invalid.clockWindowValid,false);assert.equal(invalid.events.length,0);
  });
});

test('selected directory matching preserves Windows normalization and excludes neighboring roots',()=>{
  const context={selectedDirectory:'C:\\owned\\Case',platform:'win32',launchWallMs:logLaunch,deadlineWallMs:logLaunch+90000,captureWallMs:logLaunch+90001};
  const log=projectEngineLog(Buffer.from(logLine('bootstrapping','directory="c:/OWNED/case/"')+logLine('bootstrapping','directory="c:/owned/case-other"')+logLine('bootstrapping','directory="C:relative"')),context);
  assertClosedLog(log);assert.equal(log.events.length,1);assert.equal(log.otherDirectoryCount,1);assert.equal(log.unknownCount,1);
  assert.deepEqual(log.events[0],{event:'bootstrap.enter-observed',evidenceScope:'selected-directory'});
  assert.doesNotMatch(JSON.stringify(log),/owned|case-other|C:/);
});
test('read/open identity races and projector failures become finite status and retain primary failure',async()=>{
  await logFixture(async f=>{
    await writeFile(f.logFile,logLine('loading'));
    let reads=0;
    const io={...fs,open:async(...args)=>{
      const handle=await fs.open(...args);
      return {close:()=>handle.close(),stat:async options=>Object.assign(Object.create(Object.getPrototypeOf(await handle.stat(options))),await handle.stat(options),{ino:0n}),read:async()=>{reads++;throw new Error('PRIVATE-READ');}};
    }};
    const d=f.make({engineLogFs:io}),primary=f.capture.error;
    assert.equal((await capturedLog(f,d)).engineLog.status,'unsafe');assert.equal(reads,0);
    assert.equal((await settleCleanup(primary,[()=>d.captureEngineLog(f.capture)])).error,primary);
    const broken=f.make({engineLogFs:{...fs,lstat:async()=>{throw new Error('PRIVATE-PROJECTOR');}}});
    const result=await capturedLog(f,broken);
    assertClosedLog(result.engineLog);assert.equal(result.engineLog.status,'unreadable');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  });
});

test('all reserved-key duplication and unsupported levels stay unrecognized, never inferred markers',()=>{
  const context={selectedDirectory:'/PRIVATE-ROOT',launchWallMs:logLaunch,deadlineWallMs:logLaunch+90000,captureWallMs:logLaunch+90001};
  const lines=['timestamp=2026-10-15T10:00:00.001Z','level=INFO','run=PRIVATE-ALIAS','message=bootstrapping','directory=/PRIVATE-ROOT'].map(extra=>logLine('bootstrapping','directory=/PRIVATE-ROOT '+extra));
  lines.push(logLine('bootstrapping','directory=/PRIVATE-ROOT','PRIVATE-LEVEL'));
  lines.push(logLine('bootstrapping','directory=/PRIVATE-ROOT trailing=PRIVATE-END '));
  lines.push(logLine('init','path=/PRIVATE-ROOT'));
  const log=projectEngineLog(Buffer.from(lines.join('')),context);
  assertClosedLog(log);assert.equal(log.events.length,0);assert.equal(log.malformedCount,7);assert.equal(log.unknownCount,1);
  assert.doesNotMatch(JSON.stringify(log),/PRIVATE/);
});
test('root aliases and component replacement refuse log reads outside the exact owned file',async()=>{
  await logFixture(async f=>{
    await writeFile(f.logFile,logLine('loading'));
    const alias=f.root+'alias';let reads=0;
    const io={...fs,open:async(...args)=>{
      const handle=await fs.open(...args);
      await rm(f.logFile);await symlink(path.join(f.root,'PRIVATE-FOREIGN'),f.logFile);
      return {stat:options=>handle.stat(options),close:()=>handle.close(),read:async(...args)=>{reads++;return handle.read(...args);}};
    }};
    await writeFile(path.join(f.root,'PRIVATE-FOREIGN'),logLine('loading'));
    await symlink(f.root,alias,process.platform==='win32'?'junction':'dir');
    try{
      const aliasDiagnostic=f.make({ownedRoot:alias});
      const aliased=await capturedLog(f,aliasDiagnostic,{...f.capture,selectedDirectory:path.join(alias,'cases','PRIVATE-CASE')});
      assert.equal(aliased.engineLog.status,'unsafe');
      assert.equal((await capturedLog(f,f.make({engineLogFs:io}))).engineLog.status,'unsafe');assert.equal(reads,0);
    }finally{await rm(alias);}
  });
});
test('replacement after the single read discards parsed evidence and reports the actual read bytes',async()=>{
  await logFixture(async f=>{
    const data=logLine('loading');await writeFile(f.logFile,data);
    const io={...fs,open:async(...args)=>{
      const handle=await fs.open(...args);
      return {stat:options=>handle.stat(options),close:()=>handle.close(),read:async(...args)=>{
        const result=await handle.read(...args);await rm(f.logFile);await writeFile(f.logFile,logLine('PRIVATE-REPLACEMENT'));return result;
      }};
    }};
    const {engineLog:log}=await capturedLog(f,f.make({engineLogFs:io}));
    assertClosedLog(log);assert.equal(log.status,'unsafe');assert.equal(log.bytesRead,Buffer.byteLength(data));assert.equal(log.fileChanged,true);assert.equal(log.events.length,0);
  });
});

test('late root binding performs no filesystem operation and cannot replace the owned root',async()=>{
  await logFixture(async f=>{
    const io=new Proxy({}, {get(){throw new Error('PRIVATE-NO-BIND-IO');}});
    const unbound=f.make({ownedRoot:undefined,engineLogFs:io});
    assert.equal((await capturedLog(f,unbound)).engineLog.status,'unavailable');
    const d=f.make({ownedRoot:undefined,engineLogFs:io});
    assert.doesNotThrow(()=>d.bindOwnedRoot(f.root));
    assert.doesNotThrow(()=>d.bindOwnedRoot(f.root));
    assert.throws(()=>d.bindOwnedRoot(f.root+'other'),/root/);
    assert.throws(()=>f.make({ownedRoot:undefined,engineLogFs:io}).bindOwnedRoot(path.dirname(f.root)),/root/);
    await writeFile(f.logFile,logLine('loading'));
    const real=f.make({ownedRoot:undefined});real.bindOwnedRoot(f.root);
    assert.equal((await capturedLog(f,real)).engineLog.status,'available');
  });
});
