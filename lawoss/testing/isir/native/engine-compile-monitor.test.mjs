import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { collectChild } from './engine-baseline-probe.mjs';
const api=await import('./engine-compile-monitor.mjs').catch(()=>({}));
const preload=await import('./engine-compile-monitor-preload.mjs').catch(()=>({}));
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
// Fixture creation and queries follow the preload's host-platform identity.
const sourceIdentity=file=>process.platform==='win32'?file.toLowerCase():file;
const commit='a'.repeat(40),manifestHash='b'.repeat(64);
const scope=()=>({mode:'build',manifestSha256:manifestHash,fileCount:2});
const position=()=>({status:'absent',sourceRole:'unknown',sourceIndex:null,line:null,column:null,length:null,offset:null});
const projected=()=>({errorClass:'AggregateError',code:'absent',position:position()});
const ack=()=>({schemaVersion:1,experiment:'public-windows-compile-monitor-v1',kind:'registered',mode:'build',manifestSha256:manifestHash});
const exception=()=>({schemaVersion:1,experiment:'public-windows-compile-monitor-v1',kind:'exception',mode:'build',origin:'unhandledRejection',inspection:'observed',root:projected(),aggregateTotal:0,aggregateOmitted:0,countsClamped:false,members:[],membersLimitReached:false});
const frame=value=>Buffer.from(`LAWOSS_PUBLIC_COMPILE_MONITOR ${JSON.stringify(value)}\n`);
function child(){const c=new EventEmitter();c.stdout=new PassThrough();c.stderr=new PassThrough();c.exitCode=null;c.signalCode=null;c.kill=()=>{};c.unref=()=>{};return c;}
async function fixture(t){const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'lawoss-monitor-test-')));await fs.chmod(root,0o700);t.after(()=>fs.rm(root,{recursive:true,force:true}));return root;}
test('finite projection guards poisonous getters, caps members and never serializes errors',()=>{
  const secret='PRIVATE_ERROR';const source=path.resolve('Owned/Source.ts');
  const indexes=new Map([[sourceIdentity(source),{sourceIndex:0,sourceRole:'workspace'}]]);
  const member={name:'ResolveMessage',code:'MODULE_NOT_FOUND',position:{file:source,line:1,column:0,length:2,offset:0,lineText:secret},toJSON(){throw Error(secret);}};
  const value={name:'AggregateError',errors:Array.from({length:12},()=>member),message:secret};
  const out=preload.projectException(value,'unhandledRejection',indexes,'build');
  assert.equal(out.members.length,8);assert.equal(out.aggregateTotal,12);assert.equal(out.aggregateOmitted,4);assert.equal(out.membersLimitReached,true);
  assert.equal(out.members[0].position.sourceIndex,0);assert.equal(out.members[0].position.column,0);assert.ok(!JSON.stringify(out).includes(secret));
  assert.equal(preload.projectException(new Proxy({},{get(){throw Error(secret);}}),'bad',indexes,'build').root.errorClass,'uninspectable');
  member.position.line=-1;assert.equal(preload.projectException(value,'other',indexes,'build').members[0].position.status,'invalid');
  member.position={file:pathToFileURL(source).href,line:2,column:3,length:1,offset:0};assert.equal(preload.projectException(value,'other',indexes,'build').members[0].position.sourceIndex,0);
  member.position.file='source.ts';assert.equal(preload.projectException(value,'other',indexes,'build').members[0].position.sourceIndex,null);
});
test('strict frames reject unknown keys, inconsistent counts, codes and locations',()=>{
  assert.deepEqual(api.projectFrame(ack(),scope()),ack());assert.deepEqual(api.projectFrame(exception(),scope()),exception());
  for(const mutate of [v=>v.secret='PRIVATE',v=>v.mode='other',v=>v.members.push(projected()),v=>v.aggregateOmitted=1,v=>v.root.code='PRIVATE',v=>v.root.position.sourceIndex=0,v=>v.root.position.line=NaN,v=>v.root.position.offset=2147483648]){
    const v=exception();mutate(v);assert.throws(()=>api.projectFrame(v,scope()));
  }
});
test('stderr scanner accepts split complete frames, freezes and detaches late writers',()=>{
  const c=child(),finish=api.observeMonitor(c,scope());const bytes=Buffer.concat([Buffer.from('ignored PRIVATE\n'),frame(ack()),frame(exception())]);
  for(const byte of bytes)c.stderr.write(Buffer.from([byte]));const result=finish();assert.equal(result.status,'observed');assert.equal(result.registeredCount,1);assert.equal(result.exceptionCount,1);
  c.stderr.write(frame(exception()));assert.deepEqual(finish(),result);assert.equal(c.stderr.listenerCount('data'),0);assert.ok(!JSON.stringify(result).includes('PRIVATE'));assert.ok(Object.isFrozen(result.exception));
});
test('scanner refuses poison, duplicate, extra, out of order, partial, oversized and invalid UTF8 frames',()=>{
  for(const bytes of [Buffer.concat([frame(exception()),frame(ack())]),Buffer.concat([frame(ack()),frame(ack()),frame(exception())]),Buffer.from('LAWOSS_PUBLIC_COMPILE_MONITOR {"kind":"registered","kind":"exception"}\n'),Buffer.from('LAWOSS_PUBLIC_COMPILE_MONITOR {}'),Buffer.concat([frame(ack()),frame(exception()),Buffer.from('x'.repeat(4097)+'\n')]),Buffer.concat([Buffer.from('LAWOSS_PUBLIC_COMPILE_MONITOR '),Buffer.from([0xff]),Buffer.from('\n')])]){
    const c=child(),finish=api.observeMonitor(c,scope());c.stderr.write(bytes);assert.equal(finish().status,'invalid');
  }
});
test('manifest is deterministic, regular, bounded and rejects escaping/colliding identity',async t=>{
  const root=await fixture(t);await fs.writeFile(path.join(root,'b.ts'),'b');await fs.writeFile(path.join(root,'a.ts'),'a');
  const rows=[{path:'b.ts',blob:'b'.repeat(40)},{path:'a.ts',blob:'a'.repeat(40)}];
  const manifest=api.makeManifest(rows);assert.deepEqual(manifest.files.map(v=>v.path),['a.ts','b.ts']);
  const map=preload.prepareSourceMap(root,path.join(root,'a.ts'),manifest);assert.equal(map.get(sourceIdentity(path.join(root,'a.ts'))).sourceRole,'build-script');
  for(const rows of [[{path:'../a',blob:commit}],[{path:'a',blob:commit},{path:'A',blob:commit}],[{path:'a',blob:commit},{path:'a',blob:commit}],Array.from({length:8193},(_,i)=>({path:String(i),blob:commit}))])assert.throws(()=>api.makeManifest(rows));
  await fs.symlink(path.join(root,'a.ts'),path.join(root,'link'));assert.throws(()=>preload.prepareSourceMap(root,path.join(root,'a.ts'),api.makeManifest([{path:'link',blob:commit}])));
});
test('entry guard requires exact canonical entry and unchanged full argv',async t=>{
  const root=await fixture(t),entry=path.join(root,'entry.mjs');await fs.writeFile(entry,'');
  const config={root,entry,argv:[process.execPath,entry,'--single'],mode:'build',manifestSha256:manifestHash};
  assert.equal(preload.matchesEntry(config,[process.execPath,entry,'--single']),true);
  for(const argv of [[process.execPath,entry],[process.execPath,path.join(root,'vite.mjs'),'--single'],[process.execPath,entry,'--single','--baseline']])assert.equal(preload.matchesEntry(config,argv),false);
});
test('receipt has exactly 33 roots and rejects poison instead of merging it',()=>{
  const value=api.newReceipt({GITHUB_SHA:commit,LAWOSS_PR_HEAD:commit,GITHUB_RUN_ID:'1',GITHUB_RUN_ATTEMPT:'1'});assert.equal(Object.keys(value).length,33);assert.deepEqual(api.projectMonitorReceipt(value),value);
  for(const mutate of [v=>v.raw='PRIVATE',v=>v.runId=0,v=>v.causeEquivalence='proved',v=>v.manifestFileCount=8193,v=>v.stage='native',v=>v.outcome='exception-observed']){const v=structuredClone(value);mutate(v);assert.throws(()=>api.projectMonitorReceipt(v));}
});

async function lifecycle(code,install=false){
  const c=child(),pending=collectChild(c,{[install?'installObservation':'buildObservation']:{packages:['synthetic']}});
  c.emit('spawn');c.exitCode=code;c.emit('close',code,null);return (await pending)[install?'installObservation':'buildObservation'];
}
async function baseline(){return {
  schemaVersion:3,experiment:'unmodified-windows-baseline',outcome:'unknown',stage:'upstream-build',exit:'child-error',sourceCommit:'16747470f976aca3d362ad730bcd3fe82ecc2c9a',checkoutCommit:commit,prHeadCommit:commit,
  nodeVersion:'24.21.0',bunVersion:'1.3.14',lawossBunVersion:'1.4.2',engineVersion:'1.18.29',target:'windows-x64-baseline',
  sourceInputsSha256:'4156e898aaba4af4188b4a28fd4590ea859c83ac07c5c89212a75d4f6c091f0a',lockSha256:'e4a33f0dce76bd625ceef88b2fe44cfa75d0653a3ccba0c7066ac558896ff239',modelsSha256:manifestHash,
  toolchainSha256:'9005d0d585d80425e9b715690de3e614651124c94458ef3d3a302ca1a6d3d813',originalEngineSha256:'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d',rebuiltEngineSha256:null,originalManifestsSha256:manifestHash,rebuiltManifestsSha256:null,
  originalBoundary:null,rebuiltBoundary:null,installObservation:await lifecycle(0,true),buildObservation:await lifecycle(1),releaseModelsParity:'unknown',signatureParity:'unknown',causeEquivalence:'unknown'};}
const ciEnv=()=>({GITHUB_SHA:commit,LAWOSS_PR_HEAD:commit,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'});
test('strict same-head baseline admission needs full schema3 and exact clean failed-build identities',async()=>{
  const value=await baseline();assert.equal(api.assessBaseline(value,ciEnv()).eligibility,'run');
  // Empty progress is intentional: the source gate must not infer a cause.
  for(const mutate of [v=>v.checkoutCommit='c'.repeat(40),v=>v.prHeadCommit=null,v=>v.sourceCommit='d'.repeat(40),v=>v.schemaVersion=2,v=>v.extra='PRIVATE',v=>v.bunVersion='1.4.2',v=>v.stage='upstream-install',v=>v.stage='build-inputs-after',v=>v.exit='timeout',v=>v.outcome='not-reproduced',v=>v.rebuiltEngineSha256=manifestHash,v=>v.rebuiltManifestsSha256=manifestHash,v=>v.originalEngineSha256=manifestHash,v=>v.sourceInputsSha256=manifestHash,v=>v.lockSha256=manifestHash,v=>v.toolchainSha256=manifestHash,v=>v.modelsSha256=null,
    v=>v.installObservation.spawnObserved=false,v=>v.installObservation.exitCode=1,v=>v.installObservation.pipeFailure=true,v=>v.buildObservation.spawnObserved=false,v=>v.buildObservation.closeObserved=false,v=>v.buildObservation.exitCode=0,v=>v.buildObservation.exitCode=-1,v=>v.buildObservation.signal='SIGTERM',v=>v.buildObservation.childErrorCode='ENOENT',v=>v.buildObservation.pipeFailure=true]){
    const bad=structuredClone(value);mutate(bad);assert.equal(api.assessBaseline(bad,ciEnv()).eligibility,'unknown');
  }
  assert.equal(api.assessBaseline(value,{}).eligibility,'unknown');
});
test('same-head original not-needed remains distinct from malformed or later-stage not-needed',async()=>{
  const v=await baseline();Object.assign(v,{outcome:'not-needed',stage:'original-input',exit:'not-run',installObservation:null,buildObservation:null});
  assert.equal(api.assessBaseline(v,ciEnv()).eligibility,'not-needed');v.stage='complete';assert.equal(api.assessBaseline(v,ciEnv()).eligibility,'unknown');
});
test('CLI guard validates bounded input, records a private receipt and gates unknown/absent/stale artifacts',async t=>{
  const root=await fixture(t),base=path.join(root,'baseline.json'),output=path.join(root,'github-output');const v=await baseline();
  const env={...process.env,...ciEnv(),GITHUB_OUTPUT:output};
  for(const [index,bytes,expected] of [[0,JSON.stringify(v),'run'],[1,'{"schemaVersion":3,"schemaVersion":3,"secret":"PRIVATE"}','unknown'],[2,JSON.stringify({...v,checkoutCommit:'c'.repeat(40)}),'unknown'],[3,'x'.repeat(131073),'unknown'],[4,null,'unknown']]){
    if(bytes!==null)await fs.writeFile(base,bytes);else await fs.unlink(base);
    const receipt=path.join(root,`receipt-${index}.json`);const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-compile-monitor.mjs',import.meta.url)),'guard',receipt,base],{env,stdio:['ignore','pipe','pipe']});
    const observed=await collectChild(c,{timeoutMs:5000,limit:1024,capture:true});assert.equal(observed.outcome,'ok');assert.equal(observed.text,'');
    const result=JSON.parse(await fs.readFile(receipt,'utf8'));assert.equal(result.eligibility,expected);assert.equal(Object.keys(result).length,33);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  assert.equal(await fs.readFile(output,'utf8'),'run=true\nrun=false\nrun=false\nrun=false\nrun=false\n');
});
test('run rechecks changed baseline and refuses non-Windows before any heavy work',async t=>{
  const root=await fixture(t),base=path.join(root,'baseline.json'),receipt=path.join(root,'receipt.json');await fs.writeFile(base,JSON.stringify(await baseline()));
  const env={...ciEnv(),CI:'true',GITHUB_ACTIONS:'true',RUNNER_TEMP:path.join(root,'must-not-exist')};await api.guard(receipt,base,env);
  const original=await fs.readFile(base);await fs.appendFile(base,' ');await assert.rejects(api.run(receipt,base,env));await fs.writeFile(base,original);
  // Even on Windows, no temp root is available. No network or install can start.
  await assert.rejects(api.run(receipt,base,env));await assert.rejects(fs.lstat(env.RUNNER_TEMP),{code:'ENOENT'});
});
test('CLI finalizer publishes fresh clean unknown for poison and rejects overwrite/symlink/oversize',async t=>{
  const root=await fixture(t),helper=fileURLToPath(new URL('./engine-compile-monitor.mjs',import.meta.url));
  for(const [i,input] of [[0,JSON.stringify({...api.newReceipt(ciEnv()),secret:'PRIVATE'})],[1,'{"schemaVersion":1,"schemaVersion":1}'],[2,'x'.repeat(65537)],[3,JSON.stringify(api.newReceipt({...ciEnv(),GITHUB_SHA:'c'.repeat(40)}))]]){
    const directory=path.join(root,String(i));await fs.mkdir(directory);const privateFile=path.join(directory,'private.json'),publicFile=path.join(directory,'engine-compile-monitor.json');await fs.writeFile(privateFile,input);
    const observed=await collectChild(spawn(process.execPath,[helper,'finalize',privateFile,publicFile],{env:{...process.env,...ciEnv()},stdio:['ignore','pipe','pipe']}),{capture:true,limit:1024,timeoutMs:5000});assert.equal(observed.outcome,'ok');assert.equal(observed.text,'');
    const result=JSON.parse(await fs.readFile(publicFile,'utf8'));assert.equal(result.outcome,'unknown');assert.equal(result.capability,null);assert.equal(result.buildObservation,null);assert.equal(result.monitorObservation,null);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
    await assert.rejects(api.finalize(privateFile,publicFile,ciEnv()),{code:'EEXIST'});
    await fs.writeFile(privateFile,'LATE_PRIVATE');assert.deepEqual(JSON.parse(await fs.readFile(publicFile,'utf8')),result);
  }
  const real=path.join(root,'real'),link=path.join(root,'link');await fs.writeFile(real,JSON.stringify(api.newReceipt(ciEnv())));await fs.symlink(real,link);
  assert.equal((await api.finalize(link,path.join(root,'engine-compile-monitor.json'),ciEnv())).outcome,'unknown');
});
test('valid private receipt publishes once with identity intact and no child file ingestion',async t=>{
  const root=await fixture(t),privateFile=path.join(root,'private.json'),publicFile=path.join(root,'engine-compile-monitor.json'),v=api.newReceipt(ciEnv());await fs.writeFile(privateFile,JSON.stringify(v));
  await fs.writeFile(path.join(root,'child.json'),'PRIVATE');assert.deepEqual(await api.finalize(privateFile,publicFile,ciEnv()),v);assert.deepEqual(JSON.parse(await fs.readFile(publicFile,'utf8')),v);
});
test('default real Node child preserves exit1 while monitor frames remain untrusted observations',async()=>{
  const code=`process.stderr.write(${JSON.stringify(Buffer.concat([frame(ack()),frame(exception())]).toString())});process.exitCode=1;`;
  const result=await api.collectMonitored(spawn(process.execPath,['-e',code],{stdio:['ignore','pipe','pipe']}),scope(),{timeoutMs:5000,limit:8192,buildObservation:{packages:['synthetic']}});
  assert.equal(result.outcome,'child-error');assert.equal(result.closed,true);assert.equal(result.buildObservation.exitCode,1);assert.equal(result.monitorObservation.status,'observed');
  assert.equal(api.capabilityPassed({buildObservation:result.buildObservation,monitorObservation:result.monitorObservation}),false);
});
test('timeout, unclosed and pipe errors preserve lifecycle while late callbacks cannot mutate publication data',async()=>{
  for(const kind of ['timeout','output-limit','pipe','unclosed']){
    const c=child(),pending=api.collectMonitored(c,scope(),{timeoutMs:kind==='timeout'||kind==='unclosed'?5:100,drainMs:10,limit:kind==='output-limit'?2:8192,buildObservation:{packages:['synthetic']}});c.emit('spawn');
    if(kind==='output-limit')c.stdout.write('long');if(kind==='pipe')c.stderr.emit('error',Error('PRIVATE'));
    if(kind!=='unclosed'){if(kind==='timeout')await new Promise(r=>setTimeout(r,8));c.exitCode=1;c.emit('close',1,null);}
    const result=await pending;assert.equal(result.outcome,kind==='pipe'?'child-error':kind==='unclosed'?'child-unclosed':kind);
    const frozen=JSON.stringify(result);c.stderr.emit('data',frame(exception()));c.emit('close',0,null);assert.equal(JSON.stringify(result),frozen);assert.ok(!frozen.includes('PRIVATE'));
  }
});
test('scanner enforces independent byte and line bounds without retaining raw tails',()=>{
  for(const bytes of [Buffer.alloc(512*1024+1,97),Buffer.from('\n'.repeat(4097))]){
    const c=child(),finish=api.observeMonitor(c,scope());c.stderr.write(bytes);const v=finish();assert.equal(v.status,'invalid');assert.ok(v.scanLimitReached||v.lineLimitReached);assert.ok(v.scannedBytes<=512*1024);assert.ok(v.lineCount<=4096);assert.ok(JSON.stringify(v).length<2000);
  }
});
test('projection handles native-like getters, revoked proxies and huge/sparse aggregates without iteration',()=>{
  const map=new Map();const {proxy,revoke}=Proxy.revocable([],{});revoke();
  const bad=preload.projectException({name:'AggregateError',errors:proxy},'uncaughtException',map,'build');assert.equal(bad.inspection,'failed');assert.equal(bad.aggregateTotal,null);
  const sparse=[];sparse.length=100000;const value=preload.projectException({name:'AggregateError',errors:sparse},'uncaughtException',map,'build');assert.equal(value.aggregateTotal,65535);assert.equal(value.aggregateOmitted,65527);assert.equal(value.countsClamped,true);assert.equal(value.members.length,8);
  const p={name:'BuildMessage',get position(){throw Error('PRIVATE');}};assert.equal(preload.projectException(p,'other',map,'build').root.position.status,'uninspectable');
  assert.equal(preload.projectException(p,'other',map,'build').root.code,'absent');
  for(const code of ['PRIVATE',null,{},1])assert.equal(preload.projectException({name:'ResolveMessage',code},'other',map,'build').root.code,'other');
  const trap={name:'AggregateError',errors:new Proxy([{}],{get(target,key){if(key==='0')throw Error('PRIVATE');return Reflect.get(target,key);}})};
  assert.equal(preload.projectException(trap,'other',map,'build').members[0].errorClass,'uninspectable');
});
test('post-input verification detects every changed pinned byte and preserves the original build failure',async t=>{
  const root=await fixture(t),source=path.join(root,'source'),other=path.join(root,'model');await fs.writeFile(source,'source');await fs.writeFile(other,'model');let checked=0;
  const options={root,inputs:{source:hash('source')},hashes:[[other,hash('model')]],gitCheck:async()=>{checked++;}};
  assert.equal(await api.verifyPostInputs(options),'passed');assert.equal(checked,1);await fs.writeFile(other,'changed');await assert.rejects(api.verifyPostInputs(options));
  const result={outcome:'unknown',postInputVerification:'failed',exit:'child-error',buildObservation:await lifecycle(1),monitorObservation:{status:'observed'}};assert.equal(api.finishBuild(result).outcome,'unknown');assert.equal(result.exit,'child-error');
  result.postInputVerification='passed';assert.equal(api.finishBuild(result).outcome,'exception-observed');
  result.buildObservation=await lifecycle(0);result.exit='ok';assert.equal(api.finishBuild(result).outcome,'build-completed');
  result.buildObservation={...result.buildObservation,pipeFailure:true};assert.equal(api.finishBuild(result).outcome,'unknown');
});
test('preload is inert on import and a mismatched descendant entry even with explicit config',async t=>{
  const root=await fixture(t),source=path.join(root,'source');await fs.mkdir(source);const entry=path.join(source,'entry.mjs'),other=path.join(source,'vite.mjs');
  const content='process.stdout.write(String(process.listenerCount("uncaughtExceptionMonitor")));\n';await fs.writeFile(entry,content);await fs.writeFile(other,content);
  const manifest=api.makeManifest([{path:'entry.mjs',blob:commit},{path:'vite.mjs',blob:commit}]);const prepared=await api.prepareMonitor(path.join(root,'monitor with # and %'),{root:source,entry,argv:[process.execPath,entry],mode:'build',manifest});
  for(const [file,selected] of [[fileURLToPath(new URL('./engine-compile-monitor-preload.mjs',import.meta.url)),false],[prepared.preloadFile,true]]){
    const c=spawn(process.execPath,['--import',pathToFileURL(file).href,other],{env:{PATH:process.env.PATH,...(selected?{BUN_INSPECT_PRELOAD:file}:{})},stdio:['ignore','pipe','pipe']});const result=await collectChild(c,{capture:true,timeoutMs:5000,limit:1024});assert.equal(result.outcome,'ok');assert.equal(result.text,'0');
  }
});
test('closed receipt rejects future-stage data and unsupported capability evidence',()=>{
  for(const mutate of [v=>{v.stage='toolchain';v.eligibility='unknown';},v=>v.baselineReceiptSha256=manifestHash,v=>v.modelsParity='different']){const v=api.newReceipt(ciEnv());mutate(v);assert.throws(()=>api.projectMonitorReceipt(v));}
  const empty=child(),finish=api.observeMonitor(empty,scope());empty.stderr.write(frame(ack()));const value=structuredClone(finish());value.scannedBytes=1;assert.throws(()=>api.projectMonitorObservation(value,scope()));
});
async function framedLifecycle(mode,manifestSha256,native=false){
  const registration={...ack(),mode,manifestSha256},error={...exception(),mode};
  if(native){error.aggregateTotal=1;error.members=[{errorClass:'ResolveMessage',code:'ERR_MODULE_NOT_FOUND',position:{status:'present',sourceRole:'workspace',sourceIndex:1,line:1,column:8,length:41,offset:7}}];}
  const c=child(),pending=api.collectMonitored(c,{mode,manifestSha256,fileCount:2},{buildObservation:{packages:['synthetic']}});c.emit('spawn');c.stderr.write(frame(registration));c.stderr.write(frame(error));c.exitCode=1;c.emit('close',1,null);return pending;
}
async function completeReceipt(){
  const b=await baseline(),v=api.newReceipt(ciEnv());Object.assign(v,{eligibility:'run',baselineReceiptSha256:hash(JSON.stringify(b)),baselineModelsSha256:b.modelsSha256,baselineToolchainSha256:b.toolchainSha256});
  const blob=bytes=>createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
  const manifest=api.makeManifest([{path:'entry.mjs',blob:blob(api.CAPABILITY_ENTRY)},{path:'source.ts',blob:blob(api.CAPABILITY_SOURCE)}]);
  const cap=await framedLifecycle('capability',hash(JSON.stringify(manifest)),true);
  Object.assign(v,{stage:'complete',outcome:'exception-observed',exit:'child-error',bunVersion:'1.3.14',toolchainArchiveSha256:'538f9c846355d9e847b2671bc00c47da4229a0befb24df3282b739770f3b475f',toolchainSha256:b.toolchainSha256,sourceInputsSha256:b.sourceInputsSha256,lockSha256:b.lockSha256,
    modelsSha256:manifestHash,modelsParity:'same',preloadSha256:manifestHash,configSha256:manifestHash,manifestSha256:manifestHash,manifestFileCount:2,capability:{sourceSha256:hash(JSON.stringify([api.CAPABILITY_ENTRY,api.CAPABILITY_SOURCE])),buildObservation:cap.buildObservation,monitorObservation:cap.monitorObservation},installObservation:b.installObservation,postInputVerification:'passed'});
  const build=await framedLifecycle('build',manifestHash);v.buildObservation=build.buildObservation;v.monitorObservation=build.monitorObservation;return v;
}
test('complete closed receipt retains independent lifecycle/frames and rejects impossible stage/count/parity claims',async()=>{
  const v=await completeReceipt();assert.deepEqual(api.projectMonitorReceipt(v),v);assert.equal(api.capabilityPassed(v.capability),true);
  const mutations=[v=>v.capability.sourceSha256=manifestHash,v=>v.capability.monitorObservation.registered.manifestSha256=manifestHash,v=>v.capability.buildObservation.pipeFailure=true,v=>v.capability.buildObservation.exitCode=0,v=>v.capability.monitorObservation.exception.members[0].code='absent',v=>v.capability.extra='PRIVATE',
    v=>v.baselineToolchainSha256=manifestHash,v=>v.toolchainArchiveSha256=manifestHash,v=>v.sourceInputsSha256=manifestHash,v=>v.modelsParity='different',v=>v.manifestFileCount=null,v=>v.installObservation.exitCode=1,v=>v.buildObservation.closeObserved=false,v=>v.buildObservation.exitCode=0,v=>v.postInputVerification='failed',v=>v.monitorObservation.exception.root.raw='PRIVATE',v=>v.monitorObservation.scannedBytes++,v=>v.monitorObservation.registeredCount=0,v=>v.monitorObservation.exception.aggregateTotal=1,v=>v.monitorObservation.exception.countsClamped=true];
  // fileCount applies to build frames; the capability's independent index=1
  // must remain valid even when a hypothetical build manifest has only one file.
  for(const mutate of mutations){const bad=structuredClone(v);mutate(bad);assert.throws(()=>api.projectMonitorReceipt(bad));}
  const different=structuredClone(v);different.modelsSha256='c'.repeat(64);different.modelsParity='different';assert.equal(api.projectMonitorReceipt(different).causeEquivalence,'unknown');
  for(const stage of ['toolchain','capability','source-checkout','models-freeze','upstream-install','manifest','monitored-build']){const bad=structuredClone(v);bad.stage=stage;bad.outcome='unknown';assert.throws(()=>api.projectMonitorReceipt(bad));}
});
test('capability success requires bounded clean actual child metadata rather than a matching error shape alone',async()=>{
  const v=await completeReceipt();
  for(const mutate of [v=>v.buildObservation.spawnObserved=false,v=>v.buildObservation.closeObserved=false,v=>v.buildObservation.signal='SIGTERM',v=>v.buildObservation.pipeFailure=true,v=>v.buildObservation.childErrorCode='ENOENT',v=>v.buildObservation.scannedBytes=8193,v=>v.monitorObservation.status='missing',v=>v.monitorObservation.exception.members[0].position.status='absent']){
    const bad=structuredClone(v.capability);mutate(bad);assert.equal(api.capabilityPassed(bad),false);
  }
});
test('manifest/config caps reject rather than truncate and intermediate directory symlinks cannot confer identity',async t=>{
  const root=await fixture(t),source=path.join(root,'source');await fs.mkdir(source);await fs.writeFile(path.join(source,'entry'),'');
  assert.throws(()=>api.makeManifest([{path:'x'.repeat(2097152),blob:commit}]));
  // Junction is the native Windows directory-link model; regular-file symlinks
  // above separately exercise the final path component.
  await fs.symlink(source,path.join(root,'alias'),process.platform==='win32'?'junction':'dir');
  assert.throws(()=>preload.prepareSourceMap(root,path.join(source,'entry'),api.makeManifest([{path:'alias/entry',blob:commit}])));
});
test('a synchronous writer after direct close cannot add missing monitor evidence before await resumes',async()=>{
  const c=child(),pending=api.collectMonitored(c,scope(),{buildObservation:{packages:['synthetic']}});c.emit('spawn');c.emit('close',1,null);
  c.stderr.emit('data',Buffer.concat([frame(ack()),frame(exception())]));
  const result=await pending;assert.equal(result.monitorObservation.status,'missing');assert.equal(result.monitorObservation.scannedBytes,0);
});


test('mixed-case Windows identity model covers fixture keys, manifest queries and path/file-URL projection',async t=>{
  const root=path.join(await fixture(t),'MixedRoot');await fs.mkdir(root);
  const entry=path.join(root,'Entry.mjs'),source=path.join(root,'Source.ts');
  await fs.writeFile(entry,'');await fs.writeFile(source,'');
  // Only this isolated child selects the actual preload's win32 identity branch.
  // node:path/file URLs retain host-native semantics: this is not Windows proof.
  const code=`
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    Object.defineProperty(process,'platform',{value:'win32'});
    const sourceIdentity=${sourceIdentity.toString()};
    const preload=await import(process.argv[1]);
    const root=process.argv[2],entry=path.join(root,'Entry.mjs'),source=path.join(root,'Source.ts');
    const fixtureMap=new Map([[sourceIdentity(source),{sourceIndex:0,sourceRole:'workspace'}]]);
    const manifest={sourceCommit:preload.SOURCE,files:[{path:'Entry.mjs',blob:'a'.repeat(40)},{path:'Source.ts',blob:'b'.repeat(40)}]};
    const preparedMap=preload.prepareSourceMap(root,entry,manifest);
    const index=(file,map)=>preload.projectException({name:'ResolveMessage',code:'ERR_MODULE_NOT_FOUND',position:{file,line:1,column:0,length:1,offset:0}},'other',map,'build').root.position.sourceIndex;
    const results=[source,source.toUpperCase(),source.toLowerCase()].map(file=>({
      fixturePath:index(file,fixtureMap),fixtureURL:index(pathToFileURL(file).href,fixtureMap),
      manifestQuery:preparedMap.get(sourceIdentity(file))?.sourceRole??null,
      manifestPath:index(file,preparedMap),manifestURL:index(pathToFileURL(file).href,preparedMap)
    }));
    process.stdout.write(JSON.stringify({entryRole:preparedMap.get(sourceIdentity(entry))?.sourceRole??null,results}));
  `;
  const c=spawn(process.execPath,['--input-type=module','-e',code,new URL('./engine-compile-monitor-preload.mjs',import.meta.url).href,root],{env:{},stdio:['ignore','pipe','pipe']});
  const observed=await collectChild(c,{capture:true,timeoutMs:5000,limit:2048});assert.equal(observed.outcome,'ok');
  assert.deepEqual(JSON.parse(observed.text),{entryRole:'build-script',results:Array.from({length:3},()=>({fixturePath:0,fixtureURL:0,manifestQuery:'workspace',manifestPath:1,manifestURL:1}))});
});
