import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { prepareNativeEngineFiles, verifyNativeEngineFiles, PINNED_ENGINE_VERSION } from './engine-identity.mjs';
import { syntheticRuntimeEnvironment } from './engine-runtime-smoke.mjs';
import { awaitDirectoryInstance } from './startup-readiness.mjs';
import { parseBoundedJson } from './engine-baseline-probe.mjs';
import { killProcessTree } from '../../../../apps/desktop/electron/lawoss-process-tree.mjs';

const PIN='32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
const FIXED=Object.freeze({OPENCODE_CONFIG_CONTENT:'{}',OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_SHARE:'1',OPENCODE_DISABLE_AUTOUPDATE:'1'});
const settingsHash=createHash('sha256').update(JSON.stringify(FIXED)).digest('hex');
const reasons=['none','admission','identity','health','selected','body-limit','deadline','output-limit','child-error','child-unclosed','tree-cleanup','root-cleanup','unexpected-close'];
const stages=['not-started','request','headers','body','verified'];
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const count=value=>Number.isSafeInteger(value)&&value>=0&&value<=300000;
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
function provenance(env) {
  return {head:/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??'')?env.GITHUB_SHA:null,
    runId:/^[1-9]\d{0,14}$/.test(env.GITHUB_RUN_ID??'')?env.GITHUB_RUN_ID:null,
    runAttempt:/^[1-9]\d{0,3}$/.test(env.GITHUB_RUN_ATTEMPT??'')?Number(env.GITHUB_RUN_ATTEMPT):null};
}
function initial(env) {
  return {namespace:'engine-direct-bare-control-v1',engineVersion:PINNED_ENGINE_VERSION,...provenance(env),
    expectedBinarySha256:PIN,observedBinarySha256:null,manifestBefore:false,manifestAfter:false,
    fixedSettingsSha256:settingsHash,bundledModelsSnapshot:true,healthStatus:null,healthVersion:null,
    selectedStage:'not-started',selectedStatus:null,selectedBodyCompleted:false,selectedDirectoryMatches:false,selectedElapsedMs:0,
    directClosed:false,treeCleanup:false,rootRemoved:false,descendantsUnknown:true,stdioBytes:0,outcome:'UNKNOWN',reason:'admission'};
}
export function projectReceipt(value) {
  assert.deepEqual(Object.keys(value).sort(),Object.keys(initial({})).sort());
  assert.equal(value.namespace,'engine-direct-bare-control-v1');assert.equal(value.engineVersion,PINNED_ENGINE_VERSION);
  assert.equal(value.expectedBinarySha256,PIN);assert.ok(value.observedBinarySha256===null||hash(value.observedBinarySha256));assert.equal(value.fixedSettingsSha256,settingsHash);
  assert.ok(value.head===null||typeof value.head==='string'&&/^[a-f0-9]{40}$/.test(value.head));assert.ok(value.runId===null||typeof value.runId==='string'&&/^[1-9]\d{0,14}$/.test(value.runId));assert.ok(value.runAttempt===null||Number.isInteger(value.runAttempt)&&value.runAttempt>0&&value.runAttempt<=9999);
  for(const key of ['manifestBefore','manifestAfter','bundledModelsSnapshot','selectedBodyCompleted','selectedDirectoryMatches','directClosed','treeCleanup','rootRemoved','descendantsUnknown'])assert.equal(typeof value[key],'boolean');
  for(const key of ['healthStatus','selectedStatus'])assert.ok(value[key]===null||Number.isInteger(value[key])&&value[key]>=100&&value[key]<=599);
  assert.equal(value.bundledModelsSnapshot,true);assert.equal(value.descendantsUnknown,true);
  assert.ok(value.healthVersion===null||value.healthVersion===PINNED_ENGINE_VERSION);assert.ok(stages.includes(value.selectedStage));assert.ok(count(value.selectedElapsedMs));assert.ok(count(value.stdioBytes)&&value.stdioBytes<=65537);
  assert.ok(['DIRECT_READY','DIRECT_SELECTED_FAILED','UNKNOWN'].includes(value.outcome));assert.ok(reasons.includes(value.reason));
  if(value.outcome!=='UNKNOWN')assert.ok(value.manifestBefore&&value.manifestAfter&&value.directClosed&&value.treeCleanup&&value.rootRemoved);
  if(value.outcome==='DIRECT_READY')assert.ok(value.healthStatus===200&&value.healthVersion===PINNED_ENGINE_VERSION&&value.selectedStage==='verified'&&value.selectedStatus===200&&value.selectedBodyCompleted&&value.selectedDirectoryMatches&&value.reason==='none');
  return Object.freeze({...value}); // Flat primitives only; no retained mutable references.
}

async function portReservation() {
  const server=net.createServer();
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {port:server.address().port,close:()=>new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()))};
}
function live(child,pid) {return Number.isInteger(pid)&&pid>0&&child.pid===pid&&child.exitCode===null&&child.signalCode===null;}
function supervise(child,abort) {
  const pid=child.pid;let closed=false,error=null,bytes=0;
  let resolveClose;const close=new Promise(resolve=>{resolveClose=resolve;});
  const fail=reason=>{error??=reason;abort.abort();};
  child.once('close',()=>{closed=true;resolveClose();if(!abort.signal.aborted)fail('unexpected-close');});
  child.on('error',()=>fail('child-error'));
  for(const pipe of [child.stdout,child.stderr]) {
    pipe?.on('data',chunk=>{bytes=Math.min(65537,bytes+chunk.length);if(bytes>65536)fail('output-limit');});
    pipe?.on('error',()=>fail('child-error'));
  }
  return {
    failure:()=>error,bytes:()=>bytes,
    async stop(cleanup,closeMs,drainMs) {
      let tree=false;
      // A live, exact owned leader is required before taskkill. Success is not a descendant census.
      if(live(child,pid)&&!closed) {try {tree=await cleanup(child);}catch{tree=false;}}
      if(!closed)await Promise.race([close,sleep(closeMs)]);
      if(!closed&&live(child,pid)) {try{child.kill('SIGKILL');}catch{}}
      if(!closed)await Promise.race([close,sleep(drainMs)]);
      if(!closed){child.stdout?.destroy();child.stderr?.destroy();child.unref?.();}
      return {directClosed:closed,treeCleanup:tree,failure:error,stdioBytes:bytes};
    },
  };
}

// fetch headers AND full body share the absolute spawn deadline. Cancel unread bytes.
async function boundedResponse(url,options,deadline,ownerSignal) {
  assert.equal(new URL(url).origin,options.origin);
  const signal=AbortSignal.any([ownerSignal,options.signal??new AbortController().signal,AbortSignal.timeout(Math.max(1,deadline-Date.now()))]);
  const response=await fetch(url,{headers:options.headers,signal,redirect:'error'});
  let used=false;
  return {status:response.status,get bodyUsed(){return used;},body:response.body,
    async json() {
      used=true;const reader=response.body.getReader();const chunks=[];let size=0;
      try {
        while(true) {
          const {done,value}=await reader.read();if(done)break;
          size+=value.byteLength;if(size>65536)throw Object.assign(new Error(),{code:'BODY_LIMIT'});
          chunks.push(value);
        }
        if(Date.now()>=deadline)throw new DOMException('','TimeoutError');
        return parseBoundedJson(Buffer.concat(chunks),65536);
      } finally {await reader.cancel().catch(()=>{});reader.releaseLock();}
    },
  };
}
async function run(bundleDir,testing) {
  const receipt=initial(process.env);let prepared,root,supervisor,reservation;let startupDeadline,cleanupEnv;
  const abort=new AbortController();let deadlineTimer;
  const expected=testing?.fixtureSha256??PIN;
  try {
    prepared=await prepareNativeEngineFiles({bundleDir,platform:'win32',arch:'x64'});
    await verifyNativeEngineFiles(prepared,prepared.path);receipt.manifestBefore=true;receipt.observedBinarySha256=prepared.expectedHash;
    assert.equal(prepared.expectedHash,expected); // CLI can never change expected SHA.
    if(!testing)assert.equal(process.platform,'win32');
    root=await fs.mkdtemp(path.join(tmpdir(),'lawoss-direct-bare-'));testing?.onRoot?.(root);
    const environment=syntheticRuntimeEnvironment(root,undefined,process.platform);
    delete environment.BUN_INSPECT_PRELOAD;cleanupEnv=environment;
    for(const dir of new Set(Object.values(environment).filter(v=>v!==environment.SystemRoot)))await fs.mkdir(dir,{recursive:true});
    const project=path.join(root,'project'),config=path.join(root,'empty-config');
    await fs.mkdir(project);await fs.mkdir(config);await fs.writeFile(path.join(config,'opencode.json'),'{}',{flag:'wx'});
    const directory=await fs.realpath(project);
    const user=randomBytes(16).toString('hex'),password=randomBytes(32).toString('hex');
    const env={...environment,...FIXED,OPENCODE_CONFIG_DIR:config,OPENCODE_SERVER_USERNAME:user,OPENCODE_SERVER_PASSWORD:password};
    reservation=await portReservation();const origin=`http://127.0.0.1:${reservation.port}`;
    await reservation.close();reservation=null; // Bind races fail safely; never scan/retry another port.
    startupDeadline=Date.now()+(testing?.startupMs??90000);
    deadlineTimer=setTimeout(()=>abort.abort(),Math.max(1,startupDeadline-Date.now()));
    receipt.reason='child-error';
    const child=(testing?.spawn??spawn)(prepared.path,['serve','--hostname','127.0.0.1','--port',new URL(origin).port],{cwd:directory,env,stdio:['ignore','pipe','pipe'],windowsHide:true});
    supervisor=supervise(child,abort);
    const headers={authorization:`Basic ${Buffer.from(`${user}:${password}`).toString('base64')}`};
    const request=(url,options={})=>boundedResponse(url,{...options,origin,headers},startupDeadline,abort.signal);
    receipt.reason='health';
    while(true) {
      if(abort.signal.aborted||Date.now()>=startupDeadline)throw new DOMException('','TimeoutError');
      try {
        const response=await request(`${origin}/global/health`);receipt.healthStatus=response.status;
        const body=await response.json();assert.equal(response.status,200);assert.equal(body?.healthy,true);assert.equal(body?.version,PINNED_ENGINE_VERSION);receipt.healthVersion=body.version;break;
      } catch(error) {
        // Retry only initial listener connection refusal, never bad health/body/identity.
        if(error?.cause?.code!=='ECONNREFUSED')throw error;
        await sleep(Math.min(50,Math.max(1,startupDeadline-Date.now())));
      }
    }
    receipt.reason='selected';const selectedStart=Date.now();
    try {
      const selected=await awaitDirectoryInstance({request:async(url,options)=>{const response=await request(url,options);receipt.selectedStatus=response.status;return response;},baseUrl:origin,headers,directory,deadline:startupDeadline,
        observe:stage=>{receipt.selectedStage=stage;if(stage==='body')receipt.selectedBodyCompleted=true;}});
      receipt.selectedDirectoryMatches=selected.directoryMatches;receipt.outcome='DIRECT_READY';receipt.reason='none';
    } catch(error) {
      receipt.outcome=error?.code==='BODY_LIMIT'?'UNKNOWN':'DIRECT_SELECTED_FAILED';receipt.reason=error?.code==='BODY_LIMIT'?'body-limit':Date.now()>=startupDeadline?'deadline':'selected';
    } finally {receipt.selectedElapsedMs=Math.min(300000,Math.max(0,Date.now()-selectedStart));}
  } catch(error) {
    receipt.outcome='UNKNOWN';if(error?.code==='BODY_LIMIT')receipt.reason='body-limit';
  } finally {
    clearTimeout(deadlineTimer);abort.abort();
    if(reservation)await reservation.close().catch(()=>{});
    if(supervisor) {
      const result=await supervisor.stop(testing?.cleanupTree??(child=>killProcessTree(child.pid,{env:cleanupEnv})),testing?.closeMs??0,testing?.drainMs??1000);
      receipt.directClosed=result.directClosed;receipt.treeCleanup=result.treeCleanup;receipt.stdioBytes=result.stdioBytes;
      const failure=!result.directClosed?'child-unclosed':result.failure??(!result.treeCleanup?'tree-cleanup':null);
      if(failure){receipt.outcome='UNKNOWN';receipt.reason=failure;}
    }
    if(prepared) {
      try {await verifyNativeEngineFiles(prepared,prepared.path);receipt.manifestAfter=true;}
      catch{receipt.manifestAfter=false;receipt.outcome='UNKNOWN';receipt.reason='identity';}
    }
    if(root&&receipt.outcome!=='UNKNOWN'&&receipt.directClosed&&receipt.treeCleanup&&receipt.manifestAfter) {
      try{await fs.rm(root,{recursive:true,force:true});receipt.rootRemoved=true;}
      catch{receipt.outcome='UNKNOWN';receipt.reason='root-cleanup';}
    }
  }
  return projectReceipt(receipt);
}
export function runDirectBareControl(bundleDir) {return run(bundleDir);}
// Only Node's test runner exposes this narrow fixture seam. CLI never reads it or an env SHA.
export function testOnlyRun(options) {
  assert.ok(process.env.NODE_TEST_CONTEXT);assert.ok(hash(options.fixtureSha256));
  for(const [key,max] of [['startupMs',90000],['closeMs',5000],['drainMs',1000]])assert.ok(Number.isInteger(options[key])&&options[key]>0&&options[key]<=max);
  return run(options.bundleDir,options);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    assert.equal(process.versions.node.split('.')[0],'24');assert.equal(process.argv.length,4);
    assert.ok(path.isAbsolute(process.argv[2])&&path.isAbsolute(process.argv[3]));
    const receipt=await runDirectBareControl(process.argv[3]);
    await fs.writeFile(process.argv[2],`${JSON.stringify(receipt)}\n`,{flag:'wx'});
    process.stdout.write('Direct bare control receipt written.\n');
  } catch {process.stderr.write('Direct bare control receipt unavailable.\n');process.exitCode=1;}
}
