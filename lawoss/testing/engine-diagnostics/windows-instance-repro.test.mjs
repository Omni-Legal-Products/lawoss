import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { fileURLToPath } from 'node:url';
import childProcess from 'node:child_process';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { awaitDirectoryInstance } from '../isir/native/startup-readiness.mjs';
import { IDENTITY, SOURCE_PINS, assertAdmission, verifySources, syntheticEnv, runManaged, observeSpawn, awaitClosed, emptyState, finalizeOwned, encodeReceipt, validateReceipt, withProduction, boundedResponse, validateArchiveEntries, verifyEngine, acquireArchive, extractArchive, EXTRACT, emptyExtraction, tinyControlZip, CONTROL_MARKER, verifyControl, verifyArchive, prepareArchives, sha256 } from './windows-instance-repro.mjs';
const repo=fileURLToPath(new URL('../../../',import.meta.url));
const BIN=path.resolve('/synthetic/engine');
const DIRECTORY=path.resolve('/synthetic/workspace');
function fakeChild({close=true,late=false}={}) {
  const result=new EventEmitter();
  Object.assign(result,{stdout:new PassThrough(),stderr:new PassThrough(),exitCode:null,signalCode:null,pid:999});
  result.finish=()=>{result.stdout.end();result.stderr.end();result.emit('close',0,null);};
  result.kill=()=>{
    if(result.exitCode!==null)throw Error('must not signal exited child');
    result.exitCode=0;result.emit('exit',0,null);
    if(late)result.stderr.write('late synthetic bytes');
    if(close)setTimeout(result.finish,2);
    return true;
  };
  return result;
}
function fixture({close=true,pathResponse,spawnInspect=()=>{}}={}) {
  let engine;
  const spawn=function(command,args,options){
    // Production Windows cleanup calls taskkill; fake it too, never a real PID.
    if(command!==BIN){const task=fakeChild();queueMicrotask(()=>task.kill());return task;}
    spawnInspect(command,args,options);
    engine=fakeChild({close});
    const port=args[args.indexOf('--port')+1];
    queueMicrotask(()=>engine.stdout.write(`opencode server listening on http://127.0.0.1:${port}\n`));
    return engine;
  };
  let pathCalls=0;
  const request=async(url,options)=>{
    assert.match(options.headers.authorization??options.headers.Authorization,/^Basic /);
    if(new URL(url).pathname==='/global/health')return Response.json({healthy:true,version:IDENTITY.engineVersion});
    pathCalls++;
    return pathResponse?pathResponse(url,options):Response.json({directory:DIRECTORY,worktree:DIRECTORY});
  };
  return {spawn,request,engine:()=>engine,pathCalls:()=>pathCalls};
}
async function run(options={}) {
  const f=fixture(options);
  const state=await runManaged({repo,bin:BIN,directory:DIRECTORY,env:syntheticEnv('/synthetic','http://127.0.0.1:1/v1'),spawn:f.spawn,request:f.request,selectedMs:25,closeMs:10});
  return {state,f};
}
function pendingResponse(signal) {
  return new Response(new ReadableStream({start(controller){signal.addEventListener('abort',()=>controller.error(signal.reason),{once:true});if(signal.aborted)controller.error(signal.reason);}}));
}
const admitted={GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',LAWOSS_REPRO_PLATFORM:'windows-2022',GITHUB_REF_TYPE:'branch',GITHUB_REF:'refs/heads/chore/windows-instance-repro-20261016'};
test('admission requires exact Node, platform, manual branch and first attempt',()=>{
  assert.doesNotThrow(()=>assertAdmission({node:'24.21.0',platform:'win32',env:admitted}));
  for(const [key,value]of Object.entries({GITHUB_EVENT_NAME:'push',GITHUB_RUN_ATTEMPT:'2',LAWOSS_REPRO_PLATFORM:'all',GITHUB_REF_TYPE:'tag',GITHUB_REF:'refs/heads/dev'}))assert.throws(()=>assertAdmission({node:'24.21.0',platform:'win32',env:{...admitted,[key]:value}}),{diagnosticCode:'REFUSED'});
  for(const platform of ['darwin','linux'])assert.throws(()=>assertAdmission({node:'24.21.0',platform,env:admitted}));
  assert.throws(()=>assertAdmission({node:'24.20.0',platform:'win32',env:admitted}));
});
test('import and refusal do not request, spawn or scrub environment',async()=>{
  const oldFetch=globalThis.fetch,oldSpawn=childProcess.spawn,before={...process.env};let calls=0;
  globalThis.fetch=()=>{calls++;throw Error('network forbidden');};childProcess.spawn=()=>{calls++;throw Error('spawn forbidden');};
  try {await import('./windows-instance-repro.mjs?inert');assert.throws(()=>assertAdmission({env:{}}));assert.equal(calls,0);assert.equal(JSON.stringify(before)===JSON.stringify(process.env),true);}
  finally{globalThis.fetch=oldFetch;childProcess.spawn=oldSpawn;}
});
test('exact production and catalog pins pass, drift or missing source refuses',async()=>{
  await verifySources(repo);
  await assert.rejects(verifySources(repo,async()=>Buffer.from('different')),{diagnosticCode:'SOURCE_MISMATCH'});
  await assert.rejects(verifySources(repo,async()=>{throw Error('private path');}),{diagnosticCode:'SOURCE_MISMATCH'});
  assert.equal(Object.keys(SOURCE_PINS).length,5);
});
test('actual factory excludes credential sentinel and restores parent env/hooks/fetch',async()=>{
  const before={...process.env},oldSpawn=childProcess.spawn,oldFetch=globalThis.fetch;
  process.env.LAWOSS_DIAGNOSTIC_SECRET='synthetic-sentinel';process.env.NODE_OPTIONS='--synthetic-preload';process.env.npm_config_token='synthetic';
  let clean=false;
  try {
    const {state}=await run({spawnInspect(command,args,options){
      clean=!Object.keys(options.env).some(key=>/LAWOSS_DIAGNOSTIC_SECRET|NODE_OPTIONS|npm_config_token/.test(key));
      assert.equal(options.env.OPENCODE_DISABLE_MODELS_FETCH,'1');assert.equal(options.env.OPENCODE_DISABLE_SHARE,'1');assert.equal(options.env.OPENCODE_DISABLE_AUTOUPDATE,'1');
      assert.equal(options.env.OPENCODE_MODELS_PATH,path.join(repo,'lawoss/models-catalog/api.json'));
      assert.deepEqual(args.slice(0,3),['serve','--hostname','127.0.0.1']);
      assert.deepEqual(options.stdio,['ignore','pipe','pipe']);
    }});
    assert.equal(clean,true);assert.equal(state.pathVerified,true);assert.equal(state.outcome,'NOT_REPRODUCED');assert.equal(state.cleanup,'CLOSED');assert.equal(state.pathRequests,1);assert.equal(state.spawnCount,1);
    assert.equal(childProcess.spawn===oldSpawn,true);assert.equal(globalThis.fetch===oldFetch,true);assert.equal(process.env.LAWOSS_DIAGNOSTIC_SECRET==='synthetic-sentinel',true);
  } finally {for(const name of Object.keys(process.env))delete process.env[name];Object.assign(process.env,before);}
  assert.equal(JSON.stringify(before)===JSON.stringify(process.env),true);
});
test('synthetic environment keeps only native OS keys plus owned fixture keys',()=>{
  const env=syntheticEnv('/owned','http://127.0.0.1:1/v1',{SystemRoot:'C:\\Windows',Path:'C:\\Windows',PATHEXT:'.EXE',GITHUB_TOKEN:'sentinel',HTTPS_PROXY:'sentinel',BUN_INSPECT:'sentinel'});
  assert.equal(Object.keys(env).some(key=>/TOKEN|PROXY|BUN_INSPECT/.test(key)),false);
  assert.equal(env.SystemRoot,'C:\\Windows');assert.equal(env.PATHEXT,'.EXE');assert.equal(env.Path,'C:\\Windows');
  const config=JSON.parse(env.OPENCODE_CONFIG_CONTENT);assert.equal(config.model,'isir-native/synthetic');assert.equal(config.provider['isir-native'].options.apiKey,'synthetic-local-only');
});
for(const [label,body,code]of [
  ['wrong HTTP',()=>new Response('{}',{status:503}),'PATH_STATUS'],
  ['HTML',()=>new Response('<html>private bytes</html>'),'PATH_JSON'],
  ['wrong directory',()=>Response.json({directory:'/other'}),'PATH_SCOPE'],
  ['missing directory',()=>Response.json({}),'PATH_SCOPE'],
  ['oversized body',()=>new Response('x'.repeat(65537)),'BODY_LIMIT'],
])test(`actual factory + native helper reject ${label}`,async()=>{
  const {state,f}=await run({pathResponse:body});assert.equal(state.healthVerified,true);assert.equal(state.failure,code);assert.equal(state.pathVerified,false);assert.equal(state.cleanup,'CLOSED');assert.equal(f.pathCalls(),1);
});
test('real helper body timeout after health is REPRODUCED, headers are insufficient',async()=>{
  const {state}=await run({pathResponse:(url,{signal})=>pendingResponse(signal)});
  assert.equal(state.failure,'PATH_TIMEOUT');assert.equal(state.outcome,'REPRODUCED');assert.equal(state.healthBody,true);assert.equal(state.pathHeaders,true);assert.equal(state.pathBody,false);assert.equal(state.failurePhase,'selected-path');
});
test('timeout before headers remains one path request',async()=>{
  const {state}=await run({pathResponse:(url,{signal})=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))});
  assert.equal(state.failure,'PATH_TIMEOUT');assert.equal(state.pathHeaders,false);assert.equal(state.pathRequests,1);
});
test('primary path failure survives unconfirmed close; exit is not pipe close',async()=>{
  const {state,f}=await run({close:false,pathResponse:()=>Response.json({directory:'/wrong'})});
  assert.equal(state.failure,'PATH_SCOPE');assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.exitCount,1);assert.equal(state.closeCount,0);f.engine().finish();
});
test('actual helper Windows separator/case scope and completed-body contract',async()=>{
  const result=await awaitDirectoryInstance({request:async()=>Response.json({directory:'c:/SYNTHETIC/workspace',worktree:'C:\\synthetic\\workspace'}),baseUrl:'http://127.0.0.1',headers:{authorization:'Basic synthetic'},directory:'C:\\synthetic\\workspace',platform:'win32',deadline:Date.now()+100});
  assert.equal(result.directoryMatches,true);assert.equal(result.bodyCompleted,true);assert.equal(result.worktreeMatchesDirectory,true);
});
test('spawn observer transparent receiver/args, exact command only, restore stream on close',async()=>{
  const state=emptyState(),context={synthetic:true},args=[BIN,['serve'],{env:{synthetic:'yes'}}];let passed=false;const target=fakeChild({close:false}),other=fakeChild();
  const emit=target.stdout.emit;
  const observer=observeSpawn({bin:BIN,state,onFailure:()=>{},spawn:function(...actual){passed=this===context&&actual.every((value,i)=>value===args[i]);return actual[0]===BIN?target:other;}});
  assert.equal(Reflect.apply(observer.spawn,context,args),target);assert.equal(passed,true);
  observer.spawn('/different',[],{});assert.equal(state.spawnCount,1);
  target.kill();assert.equal(await awaitClosed(observer.children,5),false);target.stderr.write('late pipes');target.finish();
  assert.equal(state.exitCount,1);assert.equal(state.closeCount,1);assert.equal(await awaitClosed(observer.children,5),true);assert.equal(target.stdout.emit===emit,true);
});
test('combined output cap prevents over-limit buffering and preserves first failure',()=>{
  const state=emptyState(),target=fakeChild();const failures=[];let forwarded=0;
  const observer=observeSpawn({bin:BIN,state,spawn:()=>target,onFailure:code=>{failures.push(code);}});observer.spawn(BIN,[],{});
  target.stdout.on('data',bytes=>{forwarded+=bytes.length;});target.stderr.on('data',bytes=>{forwarded+=bytes.length;});
  target.stdout.write(Buffer.alloc(64000));target.stderr.write(Buffer.alloc(2000));target.stdout.write(Buffer.alloc(9));
  assert.equal(forwarded,64000);assert.equal(state.outputBytes,65537);assert.equal(failures.every(code=>code==='OUTPUT_LIMIT'),true);target.kill();
});
test('late output limit during selected body aborts with primary OUTPUT_LIMIT',async()=>{
  let f;
  f=fixture({pathResponse:(url,{signal})=>{setTimeout(()=>f.engine().stderr.write(Buffer.alloc(65537)),2);return pendingResponse(signal);}});
  const state=await runManaged({repo,bin:BIN,directory:DIRECTORY,env:syntheticEnv('/synthetic','http://127.0.0.1:1'),spawn:f.spawn,request:f.request,selectedMs:50,closeMs:10});
  assert.equal(state.failure,'OUTPUT_LIMIT');assert.equal(state.outcome,'UNKNOWN');assert.equal(state.cleanup,'CLOSED');
});
test('production hook and ambient environment restore on import/work throw',async()=>{
  const original=childProcess.spawn,before={...process.env};
  await assert.rejects(withProduction({repo,spawn:()=>{throw Error('fake');},work:()=>{throw Error('work');}}),/work/);
  assert.equal(childProcess.spawn===original,true);assert.equal(JSON.stringify(before)===JSON.stringify(process.env),true);
  await assert.rejects(import(pathToFileURLForMissingAlias()),/Cannot find module/);
});
function pathToFileURLForMissingAlias(){return new URL('../../../apps/server/src/lawoss/no-such-file.js',import.meta.url).href;}
test('bounded response counts only complete bodies and cancels oversize stream',async()=>{
  let complete=0,limit=0,cancelled=false;
  const response=new Response(new ReadableStream({start(c){c.enqueue(Buffer.alloc(11));},cancel(){cancelled=true;}}));
  await assert.rejects(boundedResponse(response,10,()=>complete++,()=>limit++).text());
  await new Promise(resolve=>setTimeout(resolve,0));assert.equal(limit,1);assert.equal(complete,0);assert.equal(cancelled,true);
});
test('archive exact regular one-member shape, engine hash mismatch refuses',()=>{
  validateArchiveEntries([{name:'opencode.exe',size:1}]);
  for(const entries of [[],[{name:'../opencode.exe',size:1}],[{name:'opencode.exe',size:1,symlink:true}],[{name:'opencode.exe',size:1,directory:true}],[{name:'opencode.exe',size:268435457}],[{name:'opencode.exe',size:1},{name:'extra',size:1}]])assert.throws(()=>validateArchiveEntries(entries),{diagnosticCode:'ARCHIVE_MISMATCH'});
  assert.throws(()=>verifyEngine(Buffer.from('wrong')),{diagnosticCode:'ENGINE_MISMATCH'});
});
test('acquisition fake redirect allowlist/count/status, no real network or engine',async()=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'lawoss-source-test-'));
  try {
    let count=0;
    await acquireArchive(path.join(root,'fake.zip'),async(url,options)=>{count++;assert.equal(options.redirect,'manual');assert.equal(options.credentials,'omit');return count===1?new Response(null,{status:302,headers:{location:'https://release-assets.githubusercontent.com/synthetic'}}):new Response('fake zip');});
    assert.equal(count,2);assert.equal(await fs.readFile(path.join(root,'fake.zip'),'utf8'),'fake zip');
    for(const location of ['http://github.com/unsafe','https://outside.invalid/','https://user:secret@github.com/'])await assert.rejects(acquireArchive(path.join(root,'refused'),async()=>new Response(null,{status:302,headers:{location}})),{diagnosticCode:'ACQUISITION_FAILED'});
    count=0;await assert.rejects(acquireArchive(path.join(root,'loop'),async()=>{count++;return new Response(null,{status:302,headers:{location:'https://github.com/loop'}});}),{diagnosticCode:'ACQUISITION_FAILED'});assert.equal(count,3);
    await assert.rejects(acquireArchive(path.join(root,'status'),async()=>new Response('private',{status:403})),{diagnosticCode:'ACQUISITION_FAILED'});
  } finally {await fs.rm(root,{recursive:true});}
});
test('finite publication closed schema excludes raw paths URLs credentials errors',()=>{
  const state=emptyState();const text=encodeReceipt(state);assert.equal(validateReceipt(text),true);
  for(const bad of ['null','[]','{}','{',text.replace(IDENTITY.engineSha256,'0'.repeat(64))])assert.throws(()=>validateReceipt(bad),{diagnosticCode:'REFUSED'});
  assert.equal(Buffer.byteLength(text)<=32768,true);assert.equal(/https?:|synthetic-sentinel|C:\\|\/Users\/|stack|message/.test(text),false);
  for(const value of [{...state,raw:'private'},{...state,failure:'raw private error'},{...state,phase:'/private/path'},{...state,outputBytes:NaN},{...state,healthBody:'true'}])assert.throws(()=>encodeReceipt(value),{diagnosticCode:'REFUSED'});
});

test('unrelated transport AbortError cannot falsely reproduce selected timeout',async()=>{
  const {state}=await run({pathResponse:()=>{throw new DOMException('transport abort','AbortError');}});
  assert.equal(state.failure,'PATH_FAILED');assert.equal(state.outcome,'UNKNOWN');
});
test('native factory rejects incomplete health before any selected request',async()=>{
  const f=fixture();
  const request=async(url,options)=>{
    if(new URL(url).pathname==='/global/health'){
      setTimeout(()=>f.engine().kill(),2);
      return pendingResponse(options.signal);
    }
    throw Error('selected request forbidden');
  };
  const state=await runManaged({repo,bin:BIN,directory:DIRECTORY,env:syntheticEnv('/synthetic','http://127.0.0.1:1'),spawn:f.spawn,request,selectedMs:25,closeMs:10});
  assert.equal(state.healthHeaders,true);assert.equal(state.healthBody,false);assert.equal(state.healthVerified,false);assert.equal(state.pathRequests,0);assert.equal(state.failure,'MANAGED_START_FAILED');assert.equal(state.cleanup,'CLOSED');
});

test('unconfirmed close preserves timeout primary but downgrades outcome to UNKNOWN',async()=>{
  const {state,f}=await run({close:false,pathResponse:(url,{signal})=>pendingResponse(signal)});
  assert.equal(state.failure,'PATH_TIMEOUT');assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.outcome,'UNKNOWN');f.engine().finish();
});

test('primary path timeout plus engine close rejection retains cleanup evidence and root',async()=>{
  const f=fixture({pathResponse:(url,{signal})=>pendingResponse(signal)});
  const state=await runManaged({repo,bin:BIN,directory:DIRECTORY,env:syntheticEnv('/synthetic','http://127.0.0.1:1'),spawn:f.spawn,request:f.request,selectedMs:25,closeMs:10,closeServer:async server=>{await server.close();throw Error('synthetic close rejection');}});
  let removed=false;
  await finalizeOwned({state,root:'/synthetic/owned',remove:async()=>{removed=true;}});
  assert.equal(state.failure,'PATH_TIMEOUT');assert.equal(state.engineCloseFailed,true);assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.outcome,'UNKNOWN');assert.equal(removed,false);assert.equal(state.rootsRemoved,false);
  assert.equal(validateReceipt(encodeReceipt(state)),true);
});
test('primary path failure plus provider close rejection retains cleanup evidence and root',async()=>{
  const {state}=await run({pathResponse:()=>Response.json({directory:'/other'})});
  let calls=0,removed=false;
  const provider={count:()=>calls,close:async()=>{await Promise.resolve();calls++;throw Error('synthetic provider close rejection');}};
  await finalizeOwned({state,provider,root:'/synthetic/owned',remove:async()=>{removed=true;}});
  assert.equal(state.failure,'PATH_SCOPE');assert.equal(state.providerCloseFailed,true);assert.equal(state.providerCalls,1);assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.outcome,'UNKNOWN');assert.equal(removed,false);assert.equal(state.rootsRemoved,false);
  assert.equal(validateReceipt(encodeReceipt(state)),true);
});
for(const initial of ['REPRODUCED','NOT_REPRODUCED'])test(`provider calls during async close cannot retain ${initial}`,async()=>{
  const {state}=await run(initial==='REPRODUCED'?{pathResponse:(url,{signal})=>pendingResponse(signal)}:{});
  assert.equal(state.outcome,initial);
  let calls=0;
  await finalizeOwned({state,provider:{count:()=>calls,close:async()=>{await Promise.resolve();calls++;}}});
  assert.equal(state.providerCalls,1);assert.equal(state.outcome,'UNKNOWN');assert.equal(state.failure,initial==='REPRODUCED'?'PATH_TIMEOUT':'PROVIDER_CALLED');
  assert.equal(validateReceipt(encodeReceipt(state)),true);
});

for(const initial of ['REPRODUCED','NOT_REPRODUCED'])test(`provider close rejection cannot retain ${initial} even with no calls`,async()=>{
  const {state}=await run(initial==='REPRODUCED'?{pathResponse:(url,{signal})=>pendingResponse(signal)}:{});
  let counted=false,removed=false;
  await finalizeOwned({state,provider:{count:()=>{counted=true;return 0;},close:async()=>{throw Error('synthetic shutdown failure');}},root:'/synthetic/owned',remove:async()=>{removed=true;}});
  assert.equal(counted,true);assert.equal(state.failure,initial==='REPRODUCED'?'PATH_TIMEOUT':'CLEANUP_FAILED');assert.equal(state.providerCloseFailed,true);assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.outcome,'UNKNOWN');assert.equal(removed,false);
  assert.equal(validateReceipt(encodeReceipt(state)),true);
});
test('all cleanup observations survive alongside primary without raw errors',async()=>{
  const state={...emptyState(),failure:'PATH_SCOPE',failurePhase:'selected-path',engineCloseFailed:true,engineCloseUnconfirmed:true,cleanup:'UNKNOWN'};
  await finalizeOwned({state,provider:{count:()=>0,close:async()=>{throw Error('private URL/path');}}});
  const receipt=encodeReceipt(state);
  assert.equal(state.failure,'PATH_SCOPE');assert.equal(state.engineCloseFailed,true);assert.equal(state.engineCloseUnconfirmed,true);assert.equal(state.providerCloseFailed,true);assert.equal(/private URL|path'/.test(receipt),false);assert.equal(validateReceipt(receipt),true);
});
test('root deletion failure independently survives primary and forces UNKNOWN',async()=>{
  const state={...emptyState(),failure:'PATH_TIMEOUT',failurePhase:'selected-path',healthVerified:true,cleanup:'CLOSED',outcome:'REPRODUCED'};
  await finalizeOwned({state,root:'/synthetic/owned',remove:async()=>{throw Error('private filesystem message');}});
  assert.equal(state.failure,'PATH_TIMEOUT');assert.equal(state.rootsRemovalFailed,true);assert.equal(state.rootsRemoved,false);assert.equal(state.cleanup,'UNKNOWN');assert.equal(state.outcome,'UNKNOWN');assert.equal(validateReceipt(encodeReceipt(state)),true);
});
test('positive receipt refuses independent cleanup failure or nonzero final provider count',()=>{
  for(const outcome of ['REPRODUCED','NOT_REPRODUCED']) {
    const state={...emptyState(),healthVerified:true,pathVerified:true,cleanup:'CLOSED',outcome,failure:outcome==='REPRODUCED'?'PATH_TIMEOUT':'NONE'};
    for(const flag of ['engineCloseFailed','engineCloseUnconfirmed','providerCloseFailed','rootsRemovalFailed'])assert.throws(()=>encodeReceipt({...state,[flag]:true}),{diagnosticCode:'REFUSED'});
    assert.throws(()=>encodeReceipt({...state,providerCalls:1}),{diagnosticCode:'REFUSED'});
  }
});

test('extraction success requires source protocol plus positive close',async()=>{
  const state=emptyState();
  await assert.rejects(extractArchive('/owned','/owned/original.zip','/owned/engine',{},state,{write:async()=>{},spawn:()=>{const c=fakeChild();queueMicrotask(()=>c.finish());return c;}}),{diagnosticCode:'ARCHIVE_MISMATCH'});
});

const protocol=['started','assembly-ready','archive-open','metadata-admitted','output-open','copy-complete','dispose-complete'].map(p=>`LAWOSS_EXTRACT:${p}\n`).join('');
async function extractionCase(action,{attempt='extraction'}={}) {
  const state=emptyState(),child=fakeChild({close:false}),timers=[];let clock=100,script,argv,options;
  const run=extractArchive('/owned','/owned/original.zip','/owned/engine',syntheticEnv('/owned','http://127.0.0.1:1',{}),state,{
    attempt,write:async(file,bytes)=>{script=bytes;},spawn:(command,args,opts)=>{argv=args;options=opts;queueMicrotask(()=>action(child,timers,()=>{clock+=11;}));return child;},
    now:()=>clock,schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:()=>{},
  });
  let error;try{await run;}catch(e){error=e;}
  return {state,observation:state[attempt],error,child,timers,script,argv,options};
}
function done(child,code=0,signal=null){child.emit('exit',code,signal);child.emit('close',code,signal);}
test('actual extraction bridge success uses exact script argv native env and positive close',async()=>{
  const r=await extractionCase((c,t,tick)=>{c.stdout.write(protocol);tick();done(c);});
  assert.equal(r.error,undefined);assert.equal(r.observation.status,'PASS');assert.equal(r.observation.elapsedMs,11);assert.equal(r.observation.closed,true);assert.equal(r.state.acquisitionClosed,true);
  assert.equal(r.script,EXTRACT);assert.equal(EXTRACT.indexOf("Mark 'started'")<EXTRACT.indexOf(' Add-Type'),true);
  assert.deepEqual(r.argv.slice(0,5),['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File']);
  assert.equal(r.argv.length,8);assert.deepEqual(r.options.stdio,['ignore','pipe','pipe']);assert.equal(Object.hasOwn(r.options.env,'NODE_OPTIONS'),false);
  assert.equal(r.state.control.status,'NOT_RUN');
});
test('timer fired remains failure even when complete protocol later closes zero',async()=>{
  const r=await extractionCase((c,t)=>{t.find(x=>x.ms===30000).fn();c.stdout.write(protocol);c.finish();});
  assert.equal(r.observation.timerFired,true);assert.equal(r.observation.exitCode,0);assert.equal(r.observation.closed,true);assert.equal(r.observation.status,'FAIL');assert.equal(r.error.diagnosticCode,'ARCHIVE_MISMATCH');
});
for(const [label,action,kind,code,spawnError]of [
  ['nonzero',c=>done(c,7),'CODE',7,false],['signal',c=>done(c,null,'SIGTERM'),'SIGNAL',0,false],
  ['spawn error',c=>{c.emit('error',Error('private path'));c.finish();},'CODE',0,true],
  ['unknown close',c=>done(c,null,null),'UNKNOWN',0,false],
])test(`extraction finite observation distinguishes ${label}`,async()=>{
  const r=await extractionCase(action);assert.equal(r.observation.exitKind,kind);assert.equal(r.observation.exitCode,code);assert.equal(r.observation.spawnError,spawnError);assert.equal(r.observation.status,'FAIL');assert.equal(validateReceipt(encodeReceipt(r.state)),true);
});
test('exit before close cannot succeed and unconfirmed close retains roots and primary',async()=>{
  const r=await extractionCase((c,t)=>{c.stdout.write(protocol);c.exitCode=0;c.emit('exit',0,null);t.find(x=>x.ms===30000).fn();t.find(x=>x.ms===7000).fn();});
  assert.equal(r.state.acquisitionClosed,false);assert.equal(r.observation.closed,false);assert.equal(r.observation.status,'FAIL');
  r.state.failure='ARCHIVE_MISMATCH';r.state.failurePhase='extraction';let removed=false;
  await finalizeOwned({state:r.state,root:'/owned',remove:async()=>{removed=true;}});
  assert.equal(removed,false);assert.equal(r.state.failure,'ARCHIVE_MISMATCH');assert.equal(r.state.cleanup,'UNKNOWN');
  const frozen=encodeReceipt(r.state);r.child.finish();r.child.stderr.write('late');assert.equal(encodeReceipt(r.state),frozen);
});
for(const [label,bytes]of [
  ['unknown','LAWOSS_EXTRACT:private\n'],['duplicate','LAWOSS_EXTRACT:started\nLAWOSS_EXTRACT:started\n'],
  ['order','LAWOSS_EXTRACT:assembly-ready\n'],['trailing',protocol+'extra'],['extra',protocol+'extra\n'],
  ['malformed',Buffer.from([255])],['cap',Buffer.alloc(4097,65)],
])test(`extraction protocol rejects ${label} before unbounded buffering`,async()=>{
  const r=await extractionCase(c=>{c.stdout.write(bytes);c.finish();});
  assert.equal(r.observation.status,'FAIL');assert.equal(r.observation.protocol,'INVALID');assert.equal(r.observation.stdoutBytes<=4097,true);
});
test('extraction counts discarded stderr and rejects overlimit without retaining bytes',async()=>{
  const r=await extractionCase(c=>{c.stdout.write(protocol);c.stderr.write(Buffer.alloc(70000));c.finish();});
  assert.equal(r.observation.stderrBytes,65537);assert.equal(r.observation.status,'FAIL');assert.equal(/private|70000/.test(encodeReceipt(r.state)),false);
});
test('source script operation failure and independent dispose failure survive separately',async()=>{
  const r=await extractionCase(c=>{c.stdout.write('LAWOSS_EXTRACT:started\nLAWOSS_EXTRACT:assembly-ready\nLAWOSS_FAIL:OPEN_ARCHIVE\nLAWOSS_CLEANUP:DISPOSE_FAILED\n');done(c,1);});
  assert.equal(r.observation.phase,'assembly-ready');assert.equal(r.observation.scriptFailure,'OPEN_ARCHIVE');assert.equal(r.observation.disposeFailed,true);
  r.state.failure='ARCHIVE_MISMATCH';let removed=false;await finalizeOwned({state:r.state,root:'/owned',remove:async()=>{removed=true;}});assert.equal(removed,false);assert.equal(r.state.failure,'ARCHIVE_MISMATCH');
});
for(const code of ['COUNT','NAME','DECLARED_SIZE','TYPE','DIRECTORY'])test(`source predicate ${code} is finite and tied to archive-open`,async()=>{
  const r=await extractionCase(c=>{c.stdout.write('LAWOSS_EXTRACT:started\nLAWOSS_EXTRACT:assembly-ready\nLAWOSS_EXTRACT:archive-open\nLAWOSS_FAIL:'+code+'\n');done(c,1);});
  assert.equal(r.observation.scriptFailure,code);assert.equal(r.observation.protocol,'INCOMPLETE');
});
test('partial protocol chunks parse; failed source category at wrong phase refuses',async()=>{
  const good=await extractionCase(c=>{for(const byte of Buffer.from(protocol))c.stdout.write(Buffer.from([byte]));done(c);});assert.equal(good.observation.status,'PASS');
  const bad=await extractionCase(c=>{c.stdout.write('LAWOSS_EXTRACT:started\nLAWOSS_FAIL:COUNT\n');done(c,1);});assert.equal(bad.observation.protocol,'INVALID');
});
test('synchronous native spawn throw remains separate and requires no child cleanup',async()=>{
  const state=emptyState();await assert.rejects(extractArchive('/owned','/owned/original.zip','/owned/bin',{},state,{write:async()=>{},spawn:()=>{throw Error('private');}}),{diagnosticCode:'ARCHIVE_MISMATCH'});
  assert.equal(state.extraction.spawnError,true);assert.equal(state.extraction.closed,false);assert.equal(state.extraction.exitKind,'NONE');assert.equal(state.acquisitionClosed,true);
});
// Independent stored-ZIP structural/CRC oracle for the fixed fixture; no native extraction.
function readTinyZip(bytes){
  assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.equal(bytes.readUInt16LE(8),0);
  const size=bytes.readUInt32LE(18),nameSize=bytes.readUInt16LE(26),name=bytes.subarray(30,30+nameSize).toString('ascii');assert.equal(name,'opencode.exe');
  const content=bytes.subarray(30+nameSize,30+nameSize+size),central=30+nameSize+size;
  let crc=0xffffffff;for(const b of content){crc^=b;for(let bit=0;bit<8;bit++)crc=crc&1?0xedb88320^(crc>>>1):crc>>>1;}assert.equal(bytes.readUInt32LE(14),(crc^0xffffffff)>>>0);
  assert.equal(bytes.readUInt32LE(central),0x02014b50);assert.equal(bytes.readUInt32LE(central+38)>>>16,0x81a4);
  const end=central+46+nameSize;assert.equal(bytes.readUInt32LE(end),0x06054b50);assert.equal(bytes.readUInt16LE(end+10),1);assert.equal(bytes.readUInt32LE(end+16),central);assert.equal(end+22,bytes.length);return content;
}
test('tiny valid regular ZIP contains only fixed marker and exact extracted bytes are required',()=>{
  const zip=tinyControlZip();assert.equal(zip.length<1024,true);verifyControl(readTinyZip(zip));
  for(const bytes of [Buffer.alloc(0),Buffer.from('wrong'),Buffer.concat([CONTROL_MARKER,Buffer.from('x')])])assert.throws(()=>verifyControl(bytes),{diagnosticCode:'ARCHIVE_MISMATCH'});
  const corrupt=Buffer.from(zip);corrupt[45]^=1;assert.throws(()=>readTinyZip(corrupt));
});
function archiveFixture({controlFailure=false,marker=CONTROL_MARKER,verify=()=>{}}={}){
  const state=emptyState(),events=[];
  return {state,events,args:{root:'/owned',env:syntheticEnv('/owned','http://127.0.0.1:1',{}),state,write:async(file,bytes)=>{events.push('write-control');readTinyZip(bytes);},
    read:async file=>file.endsWith('control-output.bin')?marker:Buffer.from('fake original'),download:async()=>{events.push('download');},verify,
    extract:async(root,archive,bin,env,state,opts)=>{
      events.push(opts?.attempt==='control'?'control':'original');
      const result=await extractionCase(c=>{if(!controlFailure||!opts)c.stdout.write(protocol);done(c);},{attempt:opts?.attempt??'extraction'});
      Object.assign(state,{[opts?.attempt??'extraction']:result.observation,acquisitionClosed:result.state.acquisitionClosed});if(result.error)throw result.error;
    }} };
}
test('genuine same-bridge fake control precedes public download and original evidence remains separate',async()=>{
  const f=archiveFixture();await prepareArchives(f.args);assert.deepEqual(f.events,['write-control','control','download','original']);
  assert.equal(f.state.controlVerified,true);assert.equal(f.state.archiveVerified,true);assert.equal(f.state.control.status,'PASS');assert.equal(f.state.extraction.status,'PASS');assert.notEqual(f.state.control,f.state.extraction);
  for(const field of ['controlMeasured','downloadMeasured','archiveVerificationMeasured','acquisitionMeasured'])assert.equal(f.state[field],true);
  assert.equal(validateReceipt(encodeReceipt(f.state)),true);
});
for(const config of [{controlFailure:true},{marker:Buffer.from('wrong')}])test('failed control blocks public download and engine, remains UNKNOWN',async()=>{
  const f=archiveFixture(config);await assert.rejects(prepareArchives(f.args));assert.deepEqual(f.events,['write-control','control']);assert.equal(f.state.controlVerified,false);assert.equal(f.state.archiveVerified,false);assert.equal(f.state.extraction.status,'NOT_RUN');assert.equal(f.state.spawnCount,0);assert.equal(f.state.outcome,'UNKNOWN');assert.equal(f.state.controlMeasured,true);assert.equal(f.state.downloadMeasured,false);
});
test('pinned original ZIP mismatch blocks original extraction independently from passed control',async()=>{
  const f=archiveFixture({verify:verifyArchive});await assert.rejects(prepareArchives(f.args),{diagnosticCode:'ARCHIVE_IDENTITY_MISMATCH'});
  assert.deepEqual(f.events,['write-control','control','download']);assert.equal(f.state.controlVerified,true);assert.equal(f.state.archiveVerified,false);assert.equal(f.state.extraction.status,'NOT_RUN');assert.equal(f.state.phase,'archive-verification');assert.equal(f.state.archiveVerificationMeasured,true);
  assert.equal(IDENTITY.archiveSha256,'81ea8263923572e3e40cbd22f89d0008efa567b8a812389db042082b03bd2582');assert.notEqual(sha256(Buffer.from('fake original')),IDENTITY.archiveSha256);
});
test('failed download finalizes measured failed phase and keeps original extraction unobserved',async()=>{
  const f=archiveFixture();f.args.download=async()=>{throw Error('private');};await assert.rejects(prepareArchives(f.args));assert.equal(f.state.phase,'download');assert.equal(f.state.downloadMeasured,true);assert.equal(f.state.acquisitionMeasured,true);assert.equal(f.state.extraction.status,'NOT_RUN');
});
test('finite v2 publication refuses invalid nested extraction fields and invalid success',()=>{
  for(const patch of [{raw:'private'},{phase:'private'},{exitCode:NaN},{signal:'private'},{stdoutBytes:4098},{stderrBytes:65538},{closed:'yes'},{status:'RUNNING'},{status:'PASS'}]){
    const state=emptyState();state.extraction={...emptyExtraction(),...patch};assert.throws(()=>encodeReceipt(state),{diagnosticCode:'REFUSED'});
  }
  const state=emptyState();assert.equal(JSON.parse(encodeReceipt(state)).schemaVersion,2);
  assert.throws(()=>encodeReceipt({...state,controlVerified:true}),{diagnosticCode:'REFUSED'});
});

test('script assembly failure is observed separately from native spawn failure',async()=>{
  const r=await extractionCase(c=>{c.stdout.write('LAWOSS_EXTRACT:started\nLAWOSS_FAIL:ASSEMBLY\n');done(c,1);});
  assert.equal(r.observation.spawnError,false);assert.equal(r.observation.phase,'started');assert.equal(r.observation.scriptFailure,'ASSEMBLY');assert.equal(r.observation.closed,true);
});
test('boundary stdout and stderr counts accept complete protocol without overlimit buffering',async()=>{
  const r=await extractionCase(c=>{c.stdout.write(protocol);c.stderr.write(Buffer.alloc(65536));done(c);});assert.equal(r.observation.status,'PASS');assert.equal(r.observation.stderrBytes,65536);
});
test('control uses identical PowerShell source bridge and separate owned script filename',async()=>{
  const r=await extractionCase(c=>{c.stdout.write(protocol);done(c);},{attempt:'control'});
  assert.equal(r.script,EXTRACT);assert.equal(r.argv[5].endsWith('control-extract.ps1'),true);assert.equal(r.state.control.status,'PASS');assert.equal(r.state.extraction.status,'NOT_RUN');
});

test('script-write setup failure does not claim process spawn or measured process time',async()=>{
  const state=emptyState();let spawns=0;
  await assert.rejects(extractArchive('/owned','/owned/original.zip','/owned/bin',{},state,{write:async()=>{throw Error('private');},spawn:()=>{spawns++;}}));
  assert.equal(spawns,0);assert.equal(state.extraction.elapsedMeasured,false);assert.equal(state.extraction.spawnError,false);assert.equal(state.extraction.closed,false);assert.equal(state.acquisitionClosed,true);assert.equal(validateReceipt(encodeReceipt(state)),true);
});
