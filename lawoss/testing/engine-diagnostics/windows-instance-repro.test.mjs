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
import { IDENTITY, SOURCE_PINS, assertAdmission, verifySources, syntheticEnv, runManaged, observeSpawn, awaitClosed, emptyState, encodeReceipt, validateReceipt, withProduction, boundedResponse, validateArchiveEntries, verifyEngine, acquireArchive } from './windows-instance-repro.mjs';
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
