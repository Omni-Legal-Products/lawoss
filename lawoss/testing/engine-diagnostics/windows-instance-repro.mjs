// Temporary, branch-only diagnostic. Import and default invocation are inert.
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { awaitDirectoryInstance } from '../isir/native/startup-readiness.mjs';

export const IDENTITY = Object.freeze({ base:'9e31ec38ead353d44e1f2ab38bac87494373d07d', engineSource:'16747470f976aca3d362ad730bcd3fe82ecc2c9a', engineVersion:'1.18.29', engineSha256:'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d', node:'24.21.0' });
export const SOURCE_PINS = Object.freeze({
  'apps/server/src/managed-opencode.ts':'042d3e1177fc77f245088f66d3e50c35b216d7bbcf1165b07ec5520990bb125b',
  'apps/server/src/lawoss/engine-network.ts':'00bfb4da6fdfcb5fb1952f6b10d4f4bc03ca6c08fa1700695859fe4b673ef7e0',
  'apps/server/src/lawoss/process-tree.ts':'dc5621bb4c946321b3ca3bcdb05cc0ff56efa5e2dd77a217620c169cb7b82bab',
  'lawoss/testing/isir/native/startup-readiness.mjs':'ab9b4724c600db80c8f8e0a8b5b1f2130bd5bb52998feda8b355adb7611f1563',
  'lawoss/models-catalog/api.json':'ac6c8c17f94e3734a7cf186de2a069e51238e437a86418cbde6ee938def04fcd',
});
const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const ASSET = 'https://github.com/anomalyco/opencode/releases/download/v1.18.29/opencode-windows-x64-baseline.zip';
const TARGET = 'opencode-x86_64-pc-windows-msvc.exe';
const OUTPUT_CAP = 65536, RECEIPT_CAP = 32768;
const failure = code => Object.assign(new Error(code), { diagnosticCode:code });
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
export async function verifySources(repo = REPO, read = fs.readFile) {
  for (const [name, expected] of Object.entries(SOURCE_PINS)) {
    let bytes;
    try { bytes = await read(path.join(repo,name)); } catch { throw failure('SOURCE_MISMATCH'); }
    if (sha256(bytes) !== expected) throw failure('SOURCE_MISMATCH');
  }
}
export function assertAdmission({ platform=process.platform, node=process.versions.node, env=process.env } = {}) {
  if (node !== IDENTITY.node || platform !== 'win32' || env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1' || env.LAWOSS_REPRO_PLATFORM !== 'windows-2022' || env.GITHUB_REF_TYPE !== 'branch' || !/^refs\/heads\/chore\/windows-instance-repro-[a-zA-Z0-9-]+$/.test(env.GITHUB_REF ?? '')) throw failure('REFUSED');
}

// Resolve only the two extension aliases actually imported by this factory.
export async function withProduction({ repo=REPO, spawn=childProcess.spawn, work }) {
  const original = childProcess.spawn;
  const parent = pathToFileURL(path.join(repo,'apps/server/src/managed-opencode.ts')).href;
  const aliases = new Map(['engine-network','process-tree'].map(name => [`./lawoss/${name}.js`,pathToFileURL(path.join(repo,`apps/server/src/lawoss/${name}.ts`)).href]));
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL === parent && aliases.has(specifier)) return { url:aliases.get(specifier), shortCircuit:true };
    return next(specifier,context);
  } });
  try {
    childProcess.spawn = spawn;
    syncBuiltinESMExports();
    const { createManagedOpencodeServer } = await import(parent);
    return await work(createManagedOpencodeServer);
  } finally {
    childProcess.spawn = original;
    syncBuiltinESMExports();
    hooks.deregister();
  }
}
function replaceEnv(env) {
  for (const name of Object.keys(process.env)) delete process.env[name];
  Object.assign(process.env,env);
}
export function syntheticEnv(root, providerUrl, ambient=process.env) {
  const env = Object.fromEntries(Object.entries(ambient).filter(([key]) => /^(SystemRoot|WINDIR|COMSPEC|PATHEXT|PATH)$/i.test(key)));
  const home = path.join(root,'home');
  return Object.assign(env, {
    HOME:home, USERPROFILE:home, APPDATA:path.join(root,'appdata'), LOCALAPPDATA:path.join(root,'localappdata'),
    XDG_CONFIG_HOME:path.join(root,'xdg/config'), XDG_DATA_HOME:path.join(root,'xdg/data'), XDG_CACHE_HOME:path.join(root,'xdg/cache'), XDG_STATE_HOME:path.join(root,'xdg/state'),
    TMP:path.join(root,'tmp'), TEMP:path.join(root,'tmp'), TMPDIR:path.join(root,'tmp'),
    OPENCODE_DB:path.join(root,'runtime/opencode.db'), LAWOSS_MODELS_CATALOG:path.join(root,'catalog.json'),
    OPENCODE_DISABLE_AUTOUPDATE:'1', OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',
    OPENCODE_CONFIG_CONTENT:JSON.stringify({ model:'isir-native/synthetic', small_model:'isir-native/synthetic', provider:{ 'isir-native':{ npm:'@ai-sdk/openai-compatible', name:'ISIR synthetic protocol', options:{ baseURL:providerUrl, apiKey:'synthetic-local-only' }, models:{ synthetic:{ name:'ISIR synthetic', limit:{context:128000,output:16000}, tool_call:true, reasoning:true, variants:{low:{reasoningEffort:'low'},high:{reasoningEffort:'high'}} } } } } }),
  });
}

// Count before the production collector sees data. Never retain engine bytes here.
export function observeSpawn({ bin, spawn, state, onFailure }) {
  const children = [];
  function observed(...args) {
    const child = Reflect.apply(spawn,this,args);
    if (args[0] !== bin) return child;
    const entry = { child, exited:false, closed:false };
    children.push(entry); state.spawnCount++;
    child.once('exit', () => { entry.exited=true; state.exitCount++; });
    child.once('close', () => { entry.closed=true; state.closeCount++; });
    child.once('error', () => onFailure('CHILD_ERROR'));
    for (const stream of [child.stdout,child.stderr]) {
      if (!stream) continue;
      const emit = stream.emit;
      stream.emit = function(event,...values) {
        if (event === 'data') {
          const bytes = Buffer.byteLength(values[0]);
          state.outputBytes = Math.min(OUTPUT_CAP+1,state.outputBytes+bytes);
          if (state.outputBytes > OUTPUT_CAP) {
            onFailure('OUTPUT_LIMIT');
            // The real constructor owns termination. Notify its original startup
            // listener, but never forward the over-limit bytes into its buffer.
            if (child.listenerCount('error') > 1) child.emit('error',failure('OUTPUT_LIMIT'));
            return false;
          }
        }
        return Reflect.apply(emit,this,[event,...values]);
      };
      child.once('close', () => { stream.emit=emit; });
    }
    return child;
  }
  return { spawn:observed, children };
}
export async function awaitClosed(entries, timeoutMs=7000) {
  if (entries.every(entry=>entry.closed)) return true;
  let timer;
  const pending = entries.filter(entry=>!entry.closed);
  const listeners = [];
  try {
    return await Promise.race([
      Promise.all(pending.map(entry=>new Promise(resolve=>{
        const listener=()=>resolve(); listeners.push([entry.child,listener]); entry.child.once('close',listener);
        if (entry.closed) resolve();
      }))).then(()=>true),
      new Promise(resolve=>{timer=setTimeout(()=>resolve(false),timeoutMs);}),
    ]);
  } finally { clearTimeout(timer); for (const [child,listener] of listeners) child.off('close',listener); }
}

export function boundedResponse(response, cap, onComplete, onLimit) {
  if (!response.body) return response;
  let size=0;
  const body=response.body.pipeThrough(new TransformStream({
    transform(chunk,controller) {
      size+=chunk.byteLength;
      if (size>cap) { onLimit(); throw failure('BODY_LIMIT'); }
      controller.enqueue(chunk);
    }, flush() { onComplete(); },
  }));
  return new Response(body,{status:response.status,headers:response.headers});
}
const exactPathErrors = new Map([
  ['Selected instance readiness HTTP contract failed','PATH_STATUS'],
  ['Selected instance readiness JSON contract failed','PATH_JSON'],
  ['Selected instance readiness scope mismatch','PATH_SCOPE'],
]);
function classify(error, phase, deadline) {
  if (error?.diagnosticCode) return error.diagnosticCode;
  if (phase==='selected-path' && error?.name==='TimeoutError' && error?.message==='Startup readiness budget expired' && Date.now()>=deadline) return 'PATH_TIMEOUT';
  if (phase==='selected-path' && exactPathErrors.has(error?.message)) return exactPathErrors.get(error.message);
  return phase==='selected-path'?'PATH_FAILED':'MANAGED_START_FAILED';
}
export function emptyState() {
  return { phase:'preflight', failure:'NONE', failurePhase:'none', outcome:'UNKNOWN', sourceVerified:false, engineVerified:false, healthHeaders:false, healthBody:false, healthVerified:false, pathHeaders:false, pathBody:false, pathVerified:false, pathRequests:0, spawnCount:0, exitCount:0, closeCount:0, outputBytes:0, providerCalls:0, acquisitionClosed:true, cleanup:'UNKNOWN', rootsRemoved:false, acquisitionMs:0, managedMs:0, healthMs:0, selectedMs:0, cleanupMs:0, elapsedMs:0 };
}
// Dependencies below are fake-only seams; CLI supplies no overrides or timing inputs.
export async function runManaged({ repo=REPO, bin, directory, env, spawn=childProcess.spawn, request=globalThis.fetch, selectedMs=90000, closeMs=7000, state=emptyState() }) {
  const ambient={...process.env}, originalFetch=globalThis.fetch;
  const originalError=console.error, originalWarn=console.warn;
  const started=performance.now();
  let server, selectedDeadline;
  const controller=new AbortController();
  const fail=code=>{ if(state.failure==='NONE') { state.failure=code; state.failurePhase=state.phase; controller.abort(failure(code)); } };
  let firstHealthAt;
  const observer=observeSpawn({bin,spawn,state,onFailure:fail});
  const boundedRequest=async (url,options)=>{
    const health=new URL(url).pathname==='/global/health';
    if(health){state.phase='health';firstHealthAt??=performance.now();}
    const response=await request(url,{...options,signal:AbortSignal.any([options.signal,controller.signal])});
    if (health) state.healthHeaders=true; else state.pathHeaders=true;
    return boundedResponse(response,health?16384:65536,()=>{if(health)state.healthBody=true;else state.pathBody=true;},()=>fail('BODY_LIMIT'));
  };
  try {
    // options.env alone cannot protect the factory's ...process.env spread.
    replaceEnv(env);
    globalThis.fetch=boundedRequest;
    console.error=()=>{}; console.warn=()=>{};
    const managedAt=performance.now();
    await withProduction({repo,spawn:observer.spawn,work:async factory=>{
      try {
        state.phase='managed-start';
        server=await factory({bin,cwd:directory,env}); // production defaults intact
        state.healthVerified=true;
        state.managedMs=Math.round(performance.now()-managedAt);
        state.healthMs=Math.round(performance.now()-firstHealthAt);
        state.phase='selected-path';
        const selectedAt=performance.now();
        selectedDeadline=Date.now()+selectedMs;
        const readiness=awaitDirectoryInstance({ request:boundedRequest, baseUrl:server.url, headers:{authorization:`Basic ${Buffer.from(`${server.username}:${server.password}`).toString('base64')}`}, directory, deadline:selectedDeadline,
          observe:event=>{if(event==='request')state.pathRequests++;if(event==='verified')state.pathVerified=true;} });
        // A late pipe failure must not become green after PATH_READY.
        try {await readiness;} finally {state.selectedMs=Math.round(performance.now()-selectedAt);}
        state.outcome=state.failure==='NONE'?'NOT_REPRODUCED':'UNKNOWN';
      } catch(error) {
        fail(classify(error,state.phase,selectedDeadline));
        state.outcome=state.healthVerified && state.failure==='PATH_TIMEOUT'?'REPRODUCED':'UNKNOWN';
      } finally {
        if(!state.managedMs)state.managedMs=Math.round(performance.now()-managedAt);
        if(firstHealthAt&&!state.healthMs)state.healthMs=Math.round(performance.now()-firstHealthAt);
        state.phase='cleanup';
        const cleanupAt=performance.now();
        try { await server?.close(); } catch { fail('CLEANUP_FAILED'); }
        // If the factory failed it already ran its own terminator. Do not signal
        // a numeric PID or group, especially after the leader's exit event.
        const closed=await awaitClosed(observer.children,closeMs);
        state.cleanup=closed?'CLOSED':'UNKNOWN';
        if(!closed){fail('CLEANUP_UNKNOWN');state.outcome='UNKNOWN';}
        state.cleanupMs=Math.round(performance.now()-cleanupAt);
        if(state.failure!=='NONE' && state.outcome==='NOT_REPRODUCED')state.outcome='UNKNOWN';
      }
    }});
  } finally {
    globalThis.fetch=originalFetch; console.error=originalError; console.warn=originalWarn;
    replaceEnv(ambient);
    state.elapsedMs=Math.round(performance.now()-started);
  }
  return state;
}

// Exact archive subset from pinned build.ts: ZIP of bin/*, one opencode.exe.
export function validateArchiveEntries(entries) {
  if (!Array.isArray(entries) || entries.length!==1) throw failure('ARCHIVE_MISMATCH');
  const entry=entries[0];
  if(entry.name!=='opencode.exe' || entry.directory || entry.symlink || !Number.isSafeInteger(entry.size) || entry.size<=0 || entry.size>256*1024*1024)throw failure('ARCHIVE_MISMATCH');
}
export function verifyEngine(bytes) {
  if(sha256(bytes)!==IDENTITY.engineSha256)throw failure('ENGINE_MISMATCH');
}
export async function acquireArchive(destination, request=fetch) {
  const signal=AbortSignal.timeout(120000);
  let url=ASSET;
  for(let redirects=0;redirects<=2;redirects++) {
    const response=await request(url,{redirect:'manual',signal,credentials:'omit'});
    if([301,302,303,307,308].includes(response.status)) {
      await response.body?.cancel();
      const next=new URL(response.headers.get('location')??'',url);
      if(redirects===2 || next.protocol!=='https:' || !['github.com','release-assets.githubusercontent.com','objects.githubusercontent.com'].includes(next.hostname) || next.username || next.password || next.port)throw failure('ACQUISITION_FAILED');
      url=next.href;continue;
    }
    if(response.status!==200 || !response.body) { await response.body?.cancel(); throw failure('ACQUISITION_FAILED'); }
    const handle=await fs.open(destination,'wx',0o600);
    let size=0;
    try { for await(const chunk of response.body) { size+=chunk.byteLength; if(size>192*1024*1024)throw failure('ACQUISITION_FAILED'); await handle.writeFile(chunk); } }
    finally { await handle.close(); }
    if(!size)throw failure('ACQUISITION_FAILED');
    return;
  }
  throw failure('ACQUISITION_FAILED');
}
const EXTRACT = `Add-Type -AssemblyName System.IO.Compression.FileSystem
$z=[IO.Compression.ZipFile]::OpenRead($args[0])
try {
 if($z.Entries.Count -ne 1){throw 'ARCHIVE_MISMATCH'}
 $e=$z.Entries[0]
 $mode=($e.ExternalAttributes -shr 16) -band 61440
 if($e.FullName -cne 'opencode.exe' -or $e.Name -cne 'opencode.exe' -or $e.Length -le 0 -or $e.Length -gt 268435456 -or ($mode -ne 0 -and $mode -ne 32768) -or ($e.ExternalAttributes -band 16) -ne 0){throw 'ARCHIVE_MISMATCH'}
 $i=$e.Open(); $o=[IO.File]::Open($args[1],[IO.FileMode]::CreateNew)
 try { $buffer=New-Object byte[] 65536; $total=0L; while(($n=$i.Read($buffer,0,$buffer.Length)) -gt 0){$total+=$n; if($total -gt 268435456 -or $total -gt $e.Length){throw 'ARCHIVE_MISMATCH'}; $o.Write($buffer,0,$n)}; if($total -ne $e.Length){throw 'ARCHIVE_MISMATCH'} } finally {$o.Dispose();$i.Dispose()}
} finally {$z.Dispose()}`;
async function extractArchive(root, archive, bin, env, state) {
  const script=path.join(root,'extract.ps1');
  await fs.writeFile(script,EXTRACT,{flag:'wx',mode:0o600});
  const command=path.win32.join(env.SystemRoot??env.SYSTEMROOT??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const child=childProcess.spawn(command,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,archive,bin],{cwd:root,env,stdio:'ignore',windowsHide:true});
  state.acquisitionClosed=false;
  let timer, backstop, timedOut=false;
  try {
    await new Promise((resolve,reject)=>{
      timer=setTimeout(()=>{timedOut=true;child.kill();backstop=setTimeout(()=>reject(failure('CLEANUP_UNKNOWN')),7000);},30000);
      child.once('error',()=>reject(failure('ARCHIVE_MISMATCH')));
      child.once('close',code=>{state.acquisitionClosed=true;code===0&&!timedOut?resolve():reject(failure('ARCHIVE_MISMATCH'));});
    });
  } finally {clearTimeout(timer);clearTimeout(backstop);}
}
async function providerStub() {
  let calls=0;
  const server=http.createServer((request,response)=>{calls++;request.resume();response.writeHead(503,{'content-type':'application/json'});response.end('{}');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/v1`,count:()=>calls,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
const PHASES=['preflight','acquisition','managed-start','health','selected-path','cleanup','complete'];
const CODES=['NONE','REFUSED','SOURCE_MISMATCH','ACQUISITION_FAILED','ARCHIVE_MISMATCH','ENGINE_MISMATCH','CHILD_ERROR','OUTPUT_LIMIT','BODY_LIMIT','MANAGED_START_FAILED','PATH_TIMEOUT','PATH_STATUS','PATH_JSON','PATH_SCOPE','PATH_FAILED','CLEANUP_FAILED','CLEANUP_UNKNOWN','PROVIDER_CALLED','SETUP_FAILED'];
const STATE_KEYS=Object.keys(emptyState()).sort();
export function encodeReceipt(state) {
  if(Object.keys(state).sort().join()!==STATE_KEYS.join())throw failure('REFUSED');
  if(!PHASES.includes(state.phase)||!['none',...PHASES].includes(state.failurePhase)||!CODES.includes(state.failure)||!['UNKNOWN','REPRODUCED','NOT_REPRODUCED'].includes(state.outcome)||!['UNKNOWN','CLOSED'].includes(state.cleanup))throw failure('REFUSED');
  if(state.outcome==='NOT_REPRODUCED'&&(!state.healthVerified||!state.pathVerified||state.cleanup!=='CLOSED'||state.failure!=='NONE'||state.providerCalls!==0))throw failure('REFUSED');
  if(state.outcome==='REPRODUCED'&&(!state.healthVerified||state.failure!=='PATH_TIMEOUT'||state.cleanup!=='CLOSED'))throw failure('REFUSED');
  for(const [key,value]of Object.entries(state)) {
    if(typeof emptyState()[key]==='boolean' && typeof value!=='boolean')throw failure('REFUSED');
    if(typeof emptyState()[key]==='number' && (!Number.isSafeInteger(value)||value<0||value>1000000000))throw failure('REFUSED');
  }
  const result=JSON.stringify({schemaVersion:1,experiment:'windows-selected-instance',identity:IDENTITY,sourceSha256:SOURCE_PINS,...state});
  if(Buffer.byteLength(result)>RECEIPT_CAP)throw failure('REFUSED');
  return result+'\n';
}

export function validateReceipt(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>RECEIPT_CAP)throw failure('REFUSED');
  let parsed;try {parsed=JSON.parse(text);}catch {throw failure('REFUSED');}
  if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw failure('REFUSED');
  const {schemaVersion,experiment,identity,sourceSha256,...state}=parsed;
  if(schemaVersion!==1||experiment!=='windows-selected-instance'||JSON.stringify(identity)!==JSON.stringify(IDENTITY)||JSON.stringify(sourceSha256)!==JSON.stringify(SOURCE_PINS))throw failure('REFUSED');
  if(JSON.stringify(parsed)!==encodeReceipt(state).trim())throw failure('REFUSED');
  return true;
}
async function validatePublishedReceipt() {
  const filename=path.join(REPO,'windows-instance-receipt.json');
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>RECEIPT_CAP)throw failure('REFUSED');
  validateReceipt(await fs.readFile(filename,'utf8'));
}

export async function runCi() {
  const state=emptyState();
  let root,provider;
  const started=performance.now();
  // Fixed publication path; never accept caller-controlled output or engine paths.
  const receipt=path.join(REPO,'windows-instance-receipt.json');
  await fs.rm(receipt,{force:true});
  try {
    assertAdmission();await verifySources();state.sourceVerified=true;
    const temp=process.env.RUNNER_TEMP;
    if(!temp || !path.isAbsolute(temp))throw failure('REFUSED');
    root=await fs.mkdtemp(path.join(temp,'lawoss-selected-instance-'));
    state.phase='acquisition';
    const archive=path.join(root,'original.zip'), bin=path.join(root,TARGET);
    const acquisitionAt=performance.now();
    await acquireArchive(archive);
    provider=await providerStub();
    const env=syntheticEnv(root,provider.url);
    for(const key of ['HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','TMP'])await fs.mkdir(env[key],{recursive:true});
    await fs.mkdir(path.join(root,'runtime'));
    const directory=path.join(root,'workspace');await fs.mkdir(directory);
    await fs.copyFile(path.join(REPO,'lawoss/models-catalog/api.json'),env.LAWOSS_MODELS_CATALOG);
    await fs.writeFile(path.join(env.XDG_CONFIG_HOME,'opencode.json'),env.OPENCODE_CONFIG_CONTENT,{flag:'wx'});
    await extractArchive(root,archive,bin,env,state);
    const stat=await fs.lstat(bin);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024*1024)throw failure('ENGINE_MISMATCH');
    verifyEngine(await fs.readFile(bin));state.engineVerified=true;
    await verifySources();
    if(sha256(await fs.readFile(env.LAWOSS_MODELS_CATALOG))!==SOURCE_PINS['lawoss/models-catalog/api.json'])throw failure('SOURCE_MISMATCH');
    state.acquisitionMs=Math.round(performance.now()-acquisitionAt);
    await runManaged({bin:await fs.realpath(bin),directory,env,state});
  } catch(error) { if(state.failure==='NONE'){state.failure=CODES.includes(error?.diagnosticCode)?error.diagnosticCode:'SETUP_FAILED';state.failurePhase=state.phase;} }
  finally {
    try { if(provider) {state.providerCalls=provider.count();await provider.close();} } catch {if(state.failure==='NONE'){state.failure='CLEANUP_FAILED';state.failurePhase='cleanup';}}
    if(state.providerCalls){if(state.failure==='NONE'){state.failure='PROVIDER_CALLED';state.failurePhase='selected-path';}state.outcome='UNKNOWN';}
    if(state.spawnCount===0&&state.acquisitionClosed)state.cleanup='CLOSED';
    if(root && state.cleanup==='CLOSED')try {await fs.rm(root,{recursive:true});state.rootsRemoved=true;} catch {if(state.failure==='NONE'){state.failure='CLEANUP_FAILED';state.failurePhase='cleanup';}state.cleanup='UNKNOWN';state.outcome='UNKNOWN';}
    state.elapsedMs=Math.round(performance.now()-started);
    if(state.failure==='NONE')state.phase='complete';
    if(state.failure!=='NONE'&&state.outcome==='NOT_REPRODUCED')state.outcome='UNKNOWN';
    await fs.writeFile(receipt,encodeReceipt(state),{flag:'wx',mode:0o600});
  }
  return state.failure==='NONE'?0:1;
}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) {
  try {
    if(process.argv.length===3&&process.argv[2]==='--run-ci')process.exitCode=await runCi();
    else if(process.argv.length===3&&process.argv[2]==='--validate-receipt')await validatePublishedReceipt();
    else if(process.argv.length!==2)process.exitCode=1;
  } catch {console.error('DIAGNOSTIC_FAILED');process.exitCode=1;}
}
