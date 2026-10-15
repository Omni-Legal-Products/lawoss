import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import * as fs from 'node:fs/promises';
import { mkdtemp, readFile, rm, mkdir, writeFile, realpath, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, summarizeNetwork, errorMetadata, settleCleanup, projectEngineLog, observePromptClick, summarizePromptEvents } from './diagnostics.mjs';

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
    assert.equal(result.schema,6);assert.equal(result.network.requests[0].endpoint,'engine.path');
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
    assert.equal(result.schema,6);assertClosedLog(log);assert.equal(log.status,'available');
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


// A missing stage, an unbounded value or a secondary overwrite would make the
// primary failure ambiguous or disclose operands in the published projection.
test('primary recovery failure publishes only the fixed operation stages',()=>{
  const stages=['snapshot-request','snapshot-body','snapshot-save','snapshot-check',
    'session-open','composer-wait','prompt-insert','prompt-click','prompt-observe',
    'fresh-poll','fresh-check','retained-files','verification-open','verification-folder',
    'verification-prepare','verification-wait','engine-info','engine-health','engine-identity','receipt-write'];
  for(const stage of stages){
    const diagnostics=createNativeDiagnostics({});
    diagnostics.phase('recovery');diagnostics.recoveryStage(stage);
    assert.equal(diagnostics.failure(new Error('private-error')).recoveryStage,stage);
  }
  for(const value of [undefined,null,'','private-path/secret','snapshot-request-private',{},Symbol('private')]){
    const diagnostics=createNativeDiagnostics({});
    diagnostics.phase('recovery');diagnostics.recoveryStage(value);
    const failure=diagnostics.failure(new Error('private-error'));
    assert.equal(failure.recoveryStage,'unknown');
    assert.doesNotMatch(JSON.stringify(failure),/private|secret|path/);
  }
  const unset=createNativeDiagnostics({});unset.phase('recovery');
  assert.equal(unset.failure(new Error()).recoveryStage,'unknown');
});

test('primary recovery stage freezes before secondary diagnostics and cleanup',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-stage-test-'));
  try{
    const outputFile=path.join(root,'safe.json');
    const diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    diagnostics.phase('recovery');diagnostics.recoveryStage('snapshot-body');
    const primary=new Error('private-primary');
    assert.equal(diagnostics.failure(primary).recoveryStage,'snapshot-body');
    diagnostics.recoveryStage('fresh-check');diagnostics.phase('complete');
    await settleCleanup(primary,[()=>{diagnostics.recoveryStage('receipt-write');throw new Error('private-cleanup');}]);
    assert.equal(diagnostics.failure(new Error('private-secondary')).recoveryStage,'snapshot-body');
    await diagnostics.write({error:primary});
    const result=JSON.parse(await readFile(outputFile,'utf8'));
    assert.equal(result.schema,6);assert.equal(result.recoveryStage,'snapshot-body');
    assert.doesNotMatch(JSON.stringify(result),/private/);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('recovery stage is null without a primary recovery failure',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-stage-null-test-'));
  try{
    const outputFile=path.join(root,'safe.json');
    const diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    diagnostics.phase('recovery');diagnostics.recoveryStage('snapshot-save');
    await diagnostics.write();
    assert.equal(JSON.parse(await readFile(outputFile,'utf8')).recoveryStage,null);
    diagnostics.phase('native-case');diagnostics.recoveryStage('snapshot-body');
    assert.equal(diagnostics.failure(new Error()).recoveryStage,null);
    diagnostics.phase('recovery');diagnostics.recoveryStage('snapshot-check');
    await diagnostics.write({error:new Error()});
    assert.equal(JSON.parse(await readFile(outputFile,'utf8')).recoveryStage,null);
  }finally{await rm(root,{recursive:true,force:true});}
});

test('only the exact own wait code is projected and arbitrary messages stay generic',()=>{
  assert.deepEqual(errorMetadata(Object.assign(new Error('private'),{code:'ISIR_NATIVE_WAIT_EXPIRED'})),{name:'Error',code:'ISIR_NATIVE_WAIT_EXPIRED'});
  for(const error of [new Error('ISIR_NATIVE_WAIT_EXPIRED'),new Error('Timed out: private; last=secret'),Object.assign(new Error(),{code:'ISIR_NATIVE_WAIT_EXPIRED-private'}),new SyntaxError('ISIR_NATIVE_WAIT_EXPIRED')]){
    assert.deepEqual(errorMetadata(error),{name:'Error'});
  }
});

// Execute the actual local API helper, avoiding the harness's app/engine side
// effects. Only nativeFetch is controlled; the header/body await seam is real.
test('first snapshot body remains pending or rejected at snapshot-body with one fetch',async()=>{
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const apiSource=source.match(/  const api = (async[\s\S]*?\n  });/)[1];
  for(const rejectBody of [false,true]){
    const diagnostics=createNativeDiagnostics({});diagnostics.phase('recovery');
    diagnostics.recoveryStage('snapshot-request');
    let release,bodyStarted,bodyReads=0,fetches=0;
    const started=new Promise(resolve=>{bodyStarted=resolve;});
    const failure=new SyntaxError('private-body');
    const pending=new Promise((resolve,reject)=>{release=()=>rejectBody?reject(failure):resolve({item:'safe'});});
    const response={json(){bodyReads++;bodyStarted();return pending;}};
    const nativeFetch=async(url,options)=>{
      fetches++;assert.equal(url,'http://controlled/workspace/fixture/snapshot');
      assert.equal(options.headers.authorization,'controlled');return response;
    };
    const api=runInNewContext('('+apiSource+')',{nativeFetch,serverInfo:{baseUrl:'http://controlled'},serverAuth:{authorization:'controlled'}});
    const operation=api({id:'fixture'},'snapshot',undefined,()=>diagnostics.recoveryStage('snapshot-body'));
    await started;
    assert.equal(diagnostics.failure(new Error()).recoveryStage,'snapshot-body');
    assert.equal(fetches,1);assert.equal(bodyReads,1);
    release();
    if(rejectBody)await assert.rejects(operation,error=>error===failure);
    else{const result=await operation;assert.equal(result.response,response);assert.equal(result.body.item,'safe');}
  }
});

test('API after-headers metadata failure cannot replace body result or rejection',async()=>{
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const apiSource=source.match(/  const api = (async[\s\S]*?\n  });/)[1];
  const failure=new Error('private-original');
  for(const rejectBody of [false,true]){
    let fetches=0,bodyReads=0,metadataCalls=0;
    const response={async json(){bodyReads++;if(rejectBody)throw failure;return 'safe';}};
    const api=runInNewContext('('+apiSource+')',{nativeFetch:async()=>{fetches++;return response;},serverInfo:{baseUrl:'http://controlled'},serverAuth:{}});
    const operation=api({id:'fixture'},'snapshot',undefined,()=>{metadataCalls++;throw new Error('private-metadata');});
    if(rejectBody)await assert.rejects(operation,error=>error===failure);
    else assert.equal((await operation).body,'safe');
    assert.equal(fetches,1);assert.equal(bodyReads,1);assert.equal(metadataCalls,1);
    // Existing callers omit the callback and keep their original result.
    if(!rejectBody)assert.equal((await api({id:'fixture'},'snapshot')).body,'safe');
  }
});


const promptContext={sessionId:'PRIVATE-SESSION',workspaceId:'PRIVATE-WORKSPACE',marker:'PRIVATE-MARKER'};
const promptRequest=(id,url='/workspace/PRIVATE-WORKSPACE/opencode/session/PRIVATE-SESSION/prompt_async',body=JSON.stringify({parts:[{type:'text',text:'PRIVATE-MARKER'}]}),method='POST')=>({method:'Network.requestWillBeSent',params:{requestId:id,request:{method,url:url.startsWith('/')?'http://PRIVATE-HOST'+url:url,...(body===null?{}:{postData:body}),headers:{authorization:'PRIVATE-SECRET'}}}});
const promptResponse=(id,status)=>({method:'Network.responseReceived',params:{requestId:id,response:{status,url:'PRIVATE-IGNORED',headers:{cookie:'PRIVATE-SECRET'}}}});
const countKeys=['count','originalSuffix','queryPresent','sessionMatch','sessionMismatch','workspaceMatch','workspaceMismatch','workspaceUnknown','bodyKnown','bodyUnknown','bodyOversized','inlineMarker','jsonValid','jsonInvalid','jsonTextMarker','loadingFailed'];
const statusKeys=['unknown','informational','success','redirect','clientError','serverError'];
function assertPromptClosed(result){
  assert.deepEqual(Object.keys(result),['scannedEvents','droppedEvents','correlationDropped','anyPost','prompt','restore']);
  assert.deepEqual(Object.keys(result.prompt),[...countKeys,'responses']);
  assert.deepEqual(Object.keys(result.restore),['attempted','responses','loadingFailed']);
  for(const row of [result.prompt.responses,result.restore.responses])assert.deepEqual(Object.keys(row),statusKeys);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
}
test('prompt classifier separates original suffix, scope, inline body and correlated response without disclosing operands',()=>{
  const events=[promptRequest('PRIVATE-ID'),promptResponse('PRIVATE-ID',204),promptResponse('PRIVATE-UNRELATED',500),
    promptRequest('query','/workspace/PRIVATE-WORKSPACE/opencode/session/PRIVATE-SESSION/prompt_async?directory=PRIVATE-ROOT'),promptResponse('query',400),
    promptRequest('wrong','/workspace/OTHER/opencode/session/OTHER/prompt_async',null),
    promptRequest('direct','/session/PRIVATE-SESSION/prompt_async',JSON.stringify({parts:[{type:'file',text:'PRIVATE-MARKER'}]})),
    promptRequest('bad','PRIVATE-BAD-URL'),promptRequest('suffix','/session/PRIVATE-SESSION/prompt_async/extra'),
    promptRequest('restore','/workspace/PRIVATE-WORKSPACE/opencode/session/PRIVATE-SESSION',null,'PATCH'),promptResponse('restore',503),
    {method:'Network.loadingFailed',params:{requestId:'direct',errorText:'PRIVATE-ERROR'}}];
  const result=summarizePromptEvents(events,promptContext);assertPromptClosed(result);
  assert.equal(result.anyPost,6);assert.equal(result.prompt.count,4);assert.equal(result.prompt.originalSuffix,3);assert.equal(result.prompt.queryPresent,1);
  assert.equal(result.prompt.sessionMatch,3);assert.equal(result.prompt.sessionMismatch,1);assert.equal(result.prompt.workspaceMatch,2);assert.equal(result.prompt.workspaceMismatch,1);assert.equal(result.prompt.workspaceUnknown,1);
  assert.equal(result.prompt.bodyKnown,3);assert.equal(result.prompt.bodyUnknown,1);assert.equal(result.prompt.inlineMarker,3);assert.equal(result.prompt.jsonTextMarker,2);
  assert.deepEqual(result.prompt.responses,{unknown:2,informational:0,success:1,redirect:0,clientError:1,serverError:0});
  assert.equal(result.prompt.loadingFailed,1);assert.equal(result.restore.attempted,1);assert.equal(result.restore.responses.serverError,1);
});
test('missing, malformed and oversized bodies remain bounded unknown; JSON text marker differs from substring',()=>{
  const result=summarizePromptEvents([promptRequest('missing',undefined,null),promptRequest('invalid',undefined,'PRIVATE-MARKER'),promptRequest('other',undefined,JSON.stringify({parts:[{type:'text',text:'other'}],private:'PRIVATE-MARKER'})),promptRequest('huge',undefined,'PRIVATE-MARKER'.repeat(10000))],promptContext);
  assertPromptClosed(result);assert.equal(result.prompt.bodyUnknown,2);assert.equal(result.prompt.bodyOversized,1);assert.equal(result.prompt.bodyKnown,2);assert.equal(result.prompt.jsonInvalid,1);assert.equal(result.prompt.inlineMarker,2);assert.equal(result.prompt.jsonTextMarker,0);
});
test('prompt correlation and counters are capped, missing responses stay unknown, original event boundary is respected',()=>{
  const events=Array.from({length:9000},(_,i)=>promptRequest('PRIVATE-'+i));events.push(promptResponse('PRIVATE-0',200));
  const result=summarizePromptEvents(events,promptContext,1,9000);assertPromptClosed(result);
  assert.equal(result.scannedEvents,8192);assert.equal(result.droppedEvents,807);assert.equal(result.correlationDropped,128);assert.equal(result.anyPost,128);assert.equal(result.prompt.count,128);assert.equal(result.prompt.responses.unknown,128);
  const bounded=summarizePromptEvents([promptRequest('before'),promptRequest('inside'),promptResponse('inside',204),promptResponse('inside',500)],promptContext,1,3);
  assert.equal(bounded.prompt.count,1);assert.equal(bounded.prompt.responses.success,1);assert.equal(bounded.prompt.responses.serverError,0);
});
const clickKeys=['slicePresent','sessionMatches','workspaceMatches','markerInDraft','draftEmpty','attachmentsPresent','sending','errorPresent','editorCount','markerInEditor','focusInside','selectionInside','nativeButton','disabled','ariaDisabled','uniqueMatch'];
function clickFixture(slice){
  const editor={innerText:'PRIVATE-MARKER',contains:value=>value==='inside'};
  const button={tagName:'BUTTON',disabled:false,getAttribute:()=>null,textContent:'Run task',getBoundingClientRect:()=>({width:1})};
  const document={activeElement:'inside',querySelectorAll:selector=>selector==='[contenteditable="true"]'?[editor]:[button]};
  const window={__legalwork:{slice:()=>slice},getSelection:()=>({anchorNode:'inside',focusNode:'inside'})};
  return {editor,button,document,window};
}
function readClick(fixture){return runInNewContext('('+observePromptClick.toString()+')(context,button)',{...fixture,context:promptContext});}
test('click observation returns only closed booleans and buckets; mismatched or failing hook leaves draft unknown',()=>{
  const fixture=clickFixture({...promptContext,draft:'PRIVATE-MARKER',draftLength:14,attachments:[{name:'PRIVATE-FILE'}],sending:false,error:null});
  const result=readClick(fixture);assert.deepEqual(Object.keys(result),clickKeys);
  assert.equal(result.markerInDraft,true);assert.equal(result.markerInEditor,true);assert.equal(result.focusInside,true);assert.equal(result.selectionInside,true);assert.equal(result.nativeButton,true);assert.equal(result.uniqueMatch,true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  for(const slice of [undefined,{...promptContext,sessionId:'OTHER',draft:'PRIVATE-MARKER'}, {...promptContext,draft:'PRIVATE-MARKER',draftLength:0}]){
    fixture.window.__legalwork.slice=()=>slice;const observed=readClick(fixture);assert.equal(observed.markerInDraft,null);assert.equal(observed.sending,null);
  }
  fixture.window.__legalwork.slice=()=>{throw new Error('PRIVATE-GETTER');};
  assert.equal(readClick(fixture).slicePresent,null);assert.equal(readClick(fixture).markerInEditor,true);
});
test('prompt role projections freeze before secondary events and reject arbitrary observation fields',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'native-prompt-test-'));
  try{
    const outputFile=path.join(root,'safe.json');const d=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
    const events=[promptRequest('before')];d.promptStart('attachment',events,1,promptContext);
    events.push(promptRequest('inside'));d.promptClick('attachment',{markerInDraft:true,editorCount:'many',private:'PRIVATE-SENTINEL'});d.promptEnd('attachment');
    d.promptStart('recovery',events,events.length,promptContext);events.push(promptRequest('recovered'));
    d.phase('recovery');d.recoveryStage('prompt-observe');const primary=new Error('PRIVATE-PRIMARY');d.failure(primary);
    events.push(promptResponse('recovered',500));d.promptClick('recovery',{markerInDraft:true});d.promptStart('PRIVATE-ROLE',events,0,promptContext);
    await d.write({error:primary});const result=JSON.parse(await readFile(outputFile,'utf8'));
    assert.equal(result.schema,6);assert.deepEqual(Object.keys(result.promptObservations),['attachment','recovery']);
    assert.equal(result.promptObservations.attachment.network.prompt.count,1);assert.equal(result.promptObservations.attachment.click.markerInDraft,true);assert.equal(result.promptObservations.attachment.click.editorCount,'many');
    assert.deepEqual(Object.keys(result.promptObservations.attachment.click),clickKeys);
    assert.equal(result.promptObservations.recovery.network.prompt.responses.unknown,1);assert.equal(result.promptObservations.recovery.click,null);
    assert.equal(result.recoveryStage,'prompt-observe');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  }finally{await rm(root,{recursive:true,force:true});}
});

// Execute the actual harness helper in a renderer-shaped VM: evaluate returns
// the result of the real selection/click expression, not a canned click receipt.
test('actual click retries false, observes only successful configured click and preserves primary errors without extra actions',async()=>{
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const helper=source.match(/  const click = (async[\s\S]*?\n  };)/)[1].slice(0,-1);
  for(const configured of [false,true]){
    let clicks=0,evaluations=0,attempts=0,captures=0,captured=null;
    const f=clickFixture({...promptContext,draft:'PRIVATE-MARKER',draftLength:14,attachments:[],sending:false,error:{message:'PRIVATE-ERROR'}});
    f.button.click=()=>{clicks++;};
    const select=f.document.querySelectorAll;
    f.document.querySelectorAll=selector=>selector==='button'?[]:attempts===1?[]:select(selector);
    const cdp={evaluate:async expression=>{evaluations++;return runInNewContext(expression,f);}};
    const until=async read=>{attempts++;assert.equal(await read(),false);attempts++;return await read();};
    const diagnostics={promptClick:(role,value)=>{captures++;captured={role,value};throw new Error('PRIVATE-METADATA');}};
    const click=runInNewContext('('+helper+')',{cdp,until,diagnostics,observePromptClick});
    await click('Run task',configured?{role:'recovery',context:promptContext}:undefined);
    assert.equal(clicks,1);assert.equal(evaluations,3);assert.equal(captures,configured?1:0);
    if(configured){assert.equal(captured.role,'recovery');assert.equal(captured.value.nativeButton,true);assert.equal(captured.value.errorPresent,true);}
    const primary=new Error('PRIVATE-CDP');cdp.evaluate=async()=>{throw primary;};
    await assert.rejects(click('Run task',configured?{role:'recovery',context:promptContext}:undefined),error=>error===primary);
    assert.equal(clicks,1);
  }
});

test('unavailable hook, absent editors and duplicate controls retain explicit unknowns without serializing hook payloads',()=>{
  const f=clickFixture(undefined);delete f.window.__legalwork;
  f.document.querySelectorAll=selector=>selector==='[contenteditable="true"]'?[]:[f.button,f.button];
  const result=readClick(f);assert.deepEqual(Object.keys(result),clickKeys);
  assert.equal(result.slicePresent,false);assert.equal(result.markerInDraft,null);assert.equal(result.editorCount,'0');assert.equal(result.markerInEditor,null);assert.equal(result.selectionInside,null);assert.equal(result.uniqueMatch,false);
  for(const [aria,want] of [['true',true],['false',false],['PRIVATE-ARIA',null]]){
    f.button.getAttribute=()=>aria;assert.equal(readClick(f).ariaDisabled,want);
  }
  f.window.__legalwork={slice:()=>({...promptContext,draft:'',draftLength:0,attachments:[],sending:true,error:null,private:'PRIVATE-SLICE'})};
  const empty=readClick(f);assert.equal(empty.draftEmpty,true);assert.equal(empty.sending,true);assert.equal(empty.attachmentsPresent,false);assert.doesNotMatch(JSON.stringify(empty),/PRIVATE/);
});
test('prompt status classes, restore failure and ID correlations do not borrow unrelated responses or scopes',()=>{
  const events=[];
  for(const [id,status] of [['a',103],['b',302],['c',499],['d',599],['e',999]])events.push(promptRequest(id),promptResponse(id,status));
  events.push(promptRequest('restore','/session/PRIVATE-SESSION',null,'PATCH'),{method:'Network.loadingFailed',params:{requestId:'restore',errorText:'PRIVATE-ERROR'}},promptRequest('wrong-restore','/workspace/OTHER/opencode/session/PRIVATE-SESSION',null,'PATCH'),promptResponse('wrong-restore',200),promptResponse('PRIVATE-NEVER-REQUESTED',200));
  const result=summarizePromptEvents(events,promptContext);assertPromptClosed(result);
  assert.deepEqual(result.prompt.responses,{unknown:1,informational:1,success:0,redirect:1,clientError:1,serverError:1});
  assert.equal(result.restore.attempted,1);assert.equal(result.restore.loadingFailed,1);assert.equal(result.restore.responses.unknown,1);assert.equal(result.restore.responses.success,0);
  const reused=summarizePromptEvents([promptRequest('same'),promptResponse('same',204),{method:'Network.loadingFinished',params:{requestId:'same'}},promptRequest('same')],promptContext);
  assert.equal(reused.prompt.responses.success,1);assert.equal(reused.prompt.responses.unknown,1);
});
test('projection fault cannot replace the primary failure or reopen a frozen role',()=>{
  const d=createNativeDiagnostics({});const primary=new Error('PRIVATE-PRIMARY');
  d.promptStart('recovery',[{get method(){d.recoveryStage('fresh-poll');throw new Error('PRIVATE-METADATA');}}],0,promptContext);
  d.phase('recovery');d.recoveryStage('prompt-observe');
  assert.doesNotThrow(()=>d.failure(primary));assert.equal(d.failure(primary).recoveryStage,'prompt-observe');
});
