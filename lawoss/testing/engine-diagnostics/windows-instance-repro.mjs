// Temporary, branch-only diagnostic. Import and default invocation are inert.
import childProcess from 'node:child_process';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import * as fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import http from 'node:http';
import { awaitDirectoryInstance } from '../isir/native/startup-readiness.mjs';

export const IDENTITY = Object.freeze({ base:'9e31ec38ead353d44e1f2ab38bac87494373d07d', engineSource:'16747470f976aca3d362ad730bcd3fe82ecc2c9a', engineVersion:'1.18.29', archiveSha256:'81ea8263923572e3e40cbd22f89d0008efa567b8a812389db042082b03bd2582', engineSha256:'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d', node:'24.21.0' });
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
const EXTRACT_PHASES=['none','started','assembly-ready','archive-open','metadata-admitted','output-open','copy-complete','dispose-complete'];
const EXTRACT_FAILURES=['NONE','ASSEMBLY','OPEN_ARCHIVE','METADATA','COUNT','NAME','DECLARED_SIZE','TYPE','DIRECTORY','OPEN_ENTRY','OPEN_OUTPUT','COPY','COPY_SIZE','DISPOSE'];
export function emptyExtraction() {
  return {status:'NOT_RUN',spawnError:false,timerFired:false,closed:false,exitKind:'NONE',exitCode:0,signal:'NONE',phase:'none',scriptFailure:'NONE',disposeFailed:false,protocol:'NONE',stdoutBytes:0,stderrBytes:0,elapsedMeasured:false,elapsedMs:0};
}
export function emptyState() {
  return { phase:'preflight', failure:'NONE', failurePhase:'none', outcome:'UNKNOWN', sourceVerified:false, archiveVerified:false, engineVerified:false, controlVerified:false, control:emptyExtraction(), extraction:emptyExtraction(), healthHeaders:false, healthBody:false, healthVerified:false, pathHeaders:false, pathBody:false, pathVerified:false, pathRequests:0, spawnCount:0, exitCount:0, closeCount:0, outputBytes:0, providerCalls:0, acquisitionClosed:true, cleanup:'UNKNOWN', rootsRemoved:false, engineCloseFailed:false, engineCloseUnconfirmed:false, providerCloseFailed:false, rootsRemovalFailed:false, acquisitionMeasured:false, controlMeasured:false, downloadMeasured:false, archiveVerificationMeasured:false, acquisitionMs:0, controlMs:0, downloadMs:0, archiveVerificationMs:0, managedMs:0, healthMs:0, selectedMs:0, cleanupMs:0, elapsedMs:0 };
}
function hasCleanupFailure(state) {
  return state.engineCloseFailed||state.engineCloseUnconfirmed||state.providerCloseFailed||state.rootsRemovalFailed||state.control.disposeFailed||state.extraction.disposeFailed||!state.acquisitionClosed;
}
function recordCleanupFailure(state,field,code='CLEANUP_FAILED') {
  state[field]=true;state.cleanup='UNKNOWN';state.outcome='UNKNOWN';
  if(state.failure==='NONE'){state.failure=code;state.failurePhase='cleanup';}
}
// Dependencies below are fake-only seams; CLI supplies no overrides or timing inputs.
export async function runManaged({ repo=REPO, bin, directory, env, spawn=childProcess.spawn, request=globalThis.fetch, selectedMs=90000, closeMs=7000, closeServer=server=>server.close(), state=emptyState() }) {
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
        try { if(server)await closeServer(server); } catch { recordCleanupFailure(state,'engineCloseFailed'); }
        // If the factory failed it already ran its own terminator. Do not signal
        // a numeric PID or group, especially after the leader's exit event.
        const closed=await awaitClosed(observer.children,closeMs);
        state.cleanup=closed&&!hasCleanupFailure(state)?'CLOSED':'UNKNOWN';
        if(!closed)recordCleanupFailure(state,'engineCloseUnconfirmed','CLEANUP_UNKNOWN');
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
// Static source protocol. No raw PowerShell diagnostics cross the receipt boundary.
export const EXTRACT = `$ErrorActionPreference='Stop'
function Mark($s){[Console]::Out.WriteLine('LAWOSS_EXTRACT:'+$s)}
$z=$null; $i=$null; $o=$null; $failed='NONE'; $disposeFailed=$false; $op='ASSEMBLY'
Mark 'started'
try {
 [void][System.Reflection.Assembly]::Load('System.IO.Compression.FileSystem, Version=4.0.0.0, Culture=neutral, PublicKeyToken=b77a5c561934e089')
 Mark 'assembly-ready'; $op='OPEN_ARCHIVE'
 $z=[IO.Compression.ZipFile]::OpenRead($args[0])
 Mark 'archive-open'; $op='METADATA'
 if($z.Entries.Count -ne 1){$failed='COUNT';throw 'refused'}
 $e=$z.Entries[0]; $mode=($e.ExternalAttributes -shr 16) -band 61440
 if($e.FullName -cne 'opencode.exe' -or $e.Name -cne 'opencode.exe'){$failed='NAME';throw 'refused'}
 if($e.Length -le 0 -or $e.Length -gt 268435456){$failed='DECLARED_SIZE';throw 'refused'}
 if($mode -ne 0 -and $mode -ne 32768){$failed='TYPE';throw 'refused'}
 if(($e.ExternalAttributes -band 16) -ne 0){$failed='DIRECTORY';throw 'refused'}
 Mark 'metadata-admitted'; $op='OPEN_ENTRY'; $i=$e.Open()
 $op='OPEN_OUTPUT'; $o=[IO.File]::Open($args[1],[IO.FileMode]::CreateNew)
 Mark 'output-open'; $op='COPY'
 [byte[]]$buffer=[System.Array]::CreateInstance([byte],65536); $total=0L
 while(($n=$i.Read($buffer,0,$buffer.Length)) -gt 0){$total+=$n; if($total -gt 268435456 -or $total -gt $e.Length){$failed='COPY_SIZE';throw 'refused'}; $o.Write($buffer,0,$n)}
 if($total -ne $e.Length){$failed='COPY_SIZE';throw 'refused'}
 Mark 'copy-complete'; $op='DISPOSE'
} catch {if($failed -eq 'NONE'){$failed=$op}}
finally {
 foreach($resource in @($o,$i,$z)){if($null -ne $resource){try{$resource.Dispose()}catch{$disposeFailed=$true}}}
}
if($disposeFailed -and $failed -eq 'NONE'){$failed='DISPOSE'}
if($failed -ne 'NONE'){
 [Console]::Out.WriteLine('LAWOSS_FAIL:'+$failed)
 if($disposeFailed){[Console]::Out.WriteLine('LAWOSS_CLEANUP:DISPOSE_FAILED')}
 exit 1
}
Mark 'dispose-complete'
exit 0`;

// Fake-only dependency seam; CLI never accepts overrides. Each attempt freezes
// after close or the unchanged close backstop, so late events cannot revise it.
export async function extractArchive(root, archive, bin, env, state, {spawn=childProcess.spawn,write=fs.writeFile,attempt='extraction',schedule=setTimeout,cancel=clearTimeout,now=()=>performance.now()}={}) {
  const observation=state[attempt]=emptyExtraction(); observation.status='RUNNING';
  let started, child, timer, backstop, ended=false, exited=false, invalid=false, pending='', next=1;
  const script=path.join(root,attempt==='control'?'control-extract.ps1':'extract.ps1');
  const command=path.win32.join(env.SystemRoot??env.SYSTEMROOT??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  try {
    await write(script,EXTRACT,{flag:'wx',mode:0o600});
    await new Promise((resolve,reject)=>{
      const finish=()=>{
        if(ended)return; ended=true; cancel(timer);cancel(backstop);
        observation.elapsedMeasured=true;observation.elapsedMs=Math.max(0,Math.round(now()-started));
        if(pending)invalid=true;
        observation.protocol=invalid?'INVALID':next===EXTRACT_PHASES.length&&observation.scriptFailure==='NONE'?'COMPLETE':'INCOMPLETE';
        const success=observation.closed&&!observation.spawnError&&!observation.timerFired&&observation.exitKind==='CODE'&&observation.exitCode===0&&observation.protocol==='COMPLETE'&&!observation.disposeFailed;
        observation.status=success?'PASS':'FAIL';
        success?resolve():reject(failure('ARCHIVE_MISMATCH'));
      };
      const stop=()=>{
        if(ended)return;
        backstop??=schedule(finish,7000);
        if(!exited){try{child.kill();}catch{/* owned handle only; close still required */}}
      };
      const line=value=>{
        if(value===`LAWOSS_EXTRACT:${EXTRACT_PHASES[next]}`&&next<EXTRACT_PHASES.length&&observation.scriptFailure==='NONE'){
          observation.phase=EXTRACT_PHASES[next++];return;
        }
        if(value.startsWith('LAWOSS_FAIL:')&&observation.scriptFailure==='NONE'){
          const code=value.slice(12);
          const allowed={started:['ASSEMBLY'],'assembly-ready':['OPEN_ARCHIVE'],'archive-open':['METADATA','COUNT','NAME','DECLARED_SIZE','TYPE','DIRECTORY'],'metadata-admitted':['OPEN_ENTRY','OPEN_OUTPUT'],'output-open':['COPY','COPY_SIZE'],'copy-complete':['DISPOSE']};
          if(allowed[observation.phase]?.includes(code)){observation.scriptFailure=code;return;}
        }
        if(value==='LAWOSS_CLEANUP:DISPOSE_FAILED'&&observation.scriptFailure!=='NONE'&&!observation.disposeFailed){observation.disposeFailed=true;return;}
        invalid=true;stop();
      };
      started=now();
      try {child=spawn(command,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',script,archive,bin],{cwd:root,env,stdio:['ignore','pipe','pipe'],windowsHide:true});}
      catch {observation.spawnError=true;finish();return;}
      state.acquisitionClosed=false;
      child.once('exit',()=>{exited=true;});
      child.once('error',()=>{if(ended)return;observation.spawnError=true;stop();});
      child.once('close',(code,signal)=>{
        if(ended)return;
        observation.closed=true;state.acquisitionClosed=true;
        if(Number.isSafeInteger(code)&&code>=-2147483648&&code<=2147483647){observation.exitKind='CODE';observation.exitCode=code;}
        else if(signal){observation.exitKind='SIGNAL';observation.signal=['SIGTERM','SIGKILL','SIGINT','SIGBREAK','SIGHUP'].includes(signal)?signal:'OTHER';}
        else observation.exitKind='UNKNOWN';
        finish();
      });
      child.stdout.on('data',bytes=>{
        if(ended)return;
        observation.stdoutBytes=Math.min(4097,observation.stdoutBytes+Buffer.byteLength(bytes));
        if(observation.stdoutBytes>4096){invalid=true;stop();return;}
        if(invalid)return;
        // Reject non-ASCII before decoding/buffering, including invalid UTF-8.
        if(!Buffer.from(bytes).every(byte=>byte===10||byte===13||(byte>=32&&byte<=126))){invalid=true;stop();return;}
        pending+=Buffer.from(bytes).toString('ascii');
        let end;while(!invalid&&(end=pending.indexOf('\n'))!==-1){const value=pending.slice(0,end).replace(/\r$/,'');pending=pending.slice(end+1);line(value);}
      });
      child.stderr.on('data',bytes=>{
        if(ended)return;
        observation.stderrBytes=Math.min(65537,observation.stderrBytes+Buffer.byteLength(bytes));
        if(observation.stderrBytes>65536){invalid=true;stop();}
      });
      for(const stream of [child.stdout,child.stderr])stream.once('error',()=>{if(!ended){invalid=true;stop();}});
      timer=schedule(()=>{if(ended)return;observation.timerFired=true;stop();},30000);
    });
  } finally {
    cancel(timer);cancel(backstop);
    if(observation.status==='RUNNING')observation.status='FAIL';
  }
}

export const CONTROL_MARKER=Buffer.from('LAWOSS extraction control v1\n','ascii');
function crc32(bytes) {
  let crc=0xffffffff;
  for(const byte of bytes){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  return (crc^0xffffffff)>>>0;
}
export function tinyControlZip() {
  const name=Buffer.from('opencode.exe'), data=CONTROL_MARKER;
  const local=Buffer.alloc(30),central=Buffer.alloc(46),end=Buffer.alloc(22);
  local.writeUInt32LE(0x04034b50);local.writeUInt16LE(20,4);local.writeUInt32LE(crc32(data),14);local.writeUInt32LE(data.length,18);local.writeUInt32LE(data.length,22);local.writeUInt16LE(name.length,26);
  central.writeUInt32LE(0x02014b50);central.writeUInt16LE(0x0314,4);central.writeUInt16LE(20,6);central.writeUInt32LE(crc32(data),16);central.writeUInt32LE(data.length,20);central.writeUInt32LE(data.length,24);central.writeUInt16LE(name.length,28);central.writeUInt32LE(0x81a40000,38);
  const offset=local.length+name.length+data.length;
  end.writeUInt32LE(0x06054b50);end.writeUInt16LE(1,8);end.writeUInt16LE(1,10);end.writeUInt32LE(central.length+name.length,12);end.writeUInt32LE(offset,16);
  return Buffer.concat([local,name,data,central,name,end]);
}
export function verifyControl(bytes) {if(!Buffer.isBuffer(bytes)||!bytes.equals(CONTROL_MARKER))throw failure('ARCHIVE_MISMATCH');}
export function verifyArchive(bytes) {if(sha256(bytes)!==IDENTITY.archiveSha256)throw failure('ARCHIVE_IDENTITY_MISMATCH');}
// This actual controller seam is used unchanged by runCi. Injected I/O is fake-only.
export async function prepareArchives({root,env,state,write=fs.writeFile,read=fs.readFile,download=acquireArchive,extract=extractArchive,verify=verifyArchive}) {
  const archive=path.join(root,'original.zip'),bin=path.join(root,TARGET),controlZip=path.join(root,'control.zip'),controlBin=path.join(root,'control-output.bin');
  const acquisitionAt=performance.now();
  try {
    state.phase='control';const controlAt=performance.now();
    try {await write(controlZip,tinyControlZip(),{flag:'wx',mode:0o600});await extract(root,controlZip,controlBin,env,state,{attempt:'control'});verifyControl(await read(controlBin));state.controlVerified=true;}
    finally {state.controlMeasured=true;state.controlMs=Math.round(performance.now()-controlAt);}
    state.phase='download';const downloadAt=performance.now();
    try {await download(archive);}finally{state.downloadMeasured=true;state.downloadMs=Math.round(performance.now()-downloadAt);}
    state.phase='archive-verification';const verificationAt=performance.now();
    try {verify(await read(archive));state.archiveVerified=true;}finally{state.archiveVerificationMeasured=true;state.archiveVerificationMs=Math.round(performance.now()-verificationAt);}
    state.phase='extraction';await extract(root,archive,bin,env,state);
    return bin;
  } finally {state.acquisitionMeasured=true;state.acquisitionMs=Math.round(performance.now()-acquisitionAt);}
}
async function providerStub() {
  let calls=0;
  const server=http.createServer((request,response)=>{calls++;request.resume();response.writeHead(503,{'content-type':'application/json'});response.end('{}');});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {url:`http://127.0.0.1:${server.address().port}/v1`,count:()=>calls,close:()=>new Promise((resolve,reject)=>{server.close(error=>error?reject(error):resolve());server.closeAllConnections();})};
}
const PHASES=['preflight','acquisition','control','download','archive-verification','extraction','managed-start','health','selected-path','cleanup','complete'];
const CODES=['NONE','REFUSED','SOURCE_MISMATCH','ACQUISITION_FAILED','ARCHIVE_IDENTITY_MISMATCH','ARCHIVE_MISMATCH','ENGINE_MISMATCH','CHILD_ERROR','OUTPUT_LIMIT','BODY_LIMIT','MANAGED_START_FAILED','PATH_TIMEOUT','PATH_STATUS','PATH_JSON','PATH_SCOPE','PATH_FAILED','CLEANUP_FAILED','CLEANUP_UNKNOWN','PROVIDER_CALLED','SETUP_FAILED'];
const STATE_KEYS=Object.keys(emptyState()).sort();
function validateExtraction(value) {
  const shape=emptyExtraction();
  if(!value||typeof value!=='object'||Object.keys(value).sort().join()!==Object.keys(shape).sort().join())throw failure('REFUSED');
  if(!['NOT_RUN','RUNNING','PASS','FAIL'].includes(value.status)||!['NONE','CODE','SIGNAL','UNKNOWN'].includes(value.exitKind)||!['NONE','SIGTERM','SIGKILL','SIGINT','SIGBREAK','SIGHUP','OTHER'].includes(value.signal)||!EXTRACT_PHASES.includes(value.phase)||!EXTRACT_FAILURES.includes(value.scriptFailure)||!['NONE','COMPLETE','INCOMPLETE','INVALID'].includes(value.protocol))throw failure('REFUSED');
  for(const [key,expected]of Object.entries(shape)){
    if(typeof expected==='boolean'&&typeof value[key]!=='boolean')throw failure('REFUSED');
    if(typeof expected==='number'&&(!Number.isSafeInteger(value[key])||value[key]<(key==='exitCode'?-2147483648:0)||value[key]>(key==='exitCode'?2147483647:1000000000)))throw failure('REFUSED');
  }
  if(value.stdoutBytes>4097||value.stderrBytes>65537)throw failure('REFUSED');
  if(value.status==='RUNNING'||(value.status==='NOT_RUN'&&JSON.stringify(value)!==JSON.stringify(shape)))throw failure('REFUSED');
  if(value.status==='PASS'&&(!value.elapsedMeasured||!value.closed||value.spawnError||value.timerFired||value.exitKind!=='CODE'||value.exitCode!==0||value.protocol!=='COMPLETE'||value.phase!=='dispose-complete'||value.scriptFailure!=='NONE'||value.disposeFailed))throw failure('REFUSED');
}
export function encodeReceipt(state) {
  if(Object.keys(state).sort().join()!==STATE_KEYS.join())throw failure('REFUSED');
  if(!PHASES.includes(state.phase)||!['none',...PHASES].includes(state.failurePhase)||!CODES.includes(state.failure)||!['UNKNOWN','REPRODUCED','NOT_REPRODUCED'].includes(state.outcome)||!['UNKNOWN','CLOSED'].includes(state.cleanup))throw failure('REFUSED');
  if(state.outcome!=='UNKNOWN'&&hasCleanupFailure(state))throw failure('REFUSED');
  if(state.outcome==='NOT_REPRODUCED'&&(!state.healthVerified||!state.pathVerified||state.cleanup!=='CLOSED'||state.failure!=='NONE'||state.providerCalls!==0))throw failure('REFUSED');
  if(state.outcome==='REPRODUCED'&&(!state.healthVerified||state.failure!=='PATH_TIMEOUT'||state.cleanup!=='CLOSED'||state.providerCalls!==0))throw failure('REFUSED');
  for(const [key,value]of Object.entries(state)) {
    if(typeof emptyState()[key]==='boolean' && typeof value!=='boolean')throw failure('REFUSED');
    if(typeof emptyState()[key]==='number' && (!Number.isSafeInteger(value)||value<0||value>1000000000))throw failure('REFUSED');
  }
  for(const key of ['control','extraction'])validateExtraction(state[key]);
  if(state.controlVerified&&state.control.status!=='PASS')throw failure('REFUSED');
  if(state.engineVerified&&(!state.archiveVerified||!state.controlVerified||state.extraction.status!=='PASS'))throw failure('REFUSED');
  const result=JSON.stringify({schemaVersion:2,experiment:'windows-selected-instance',identity:IDENTITY,sourceSha256:SOURCE_PINS,...state});
  if(Buffer.byteLength(result)>RECEIPT_CAP)throw failure('REFUSED');
  return result+'\n';
}

export function validateReceipt(text) {
  if(typeof text!=='string'||Buffer.byteLength(text)>RECEIPT_CAP)throw failure('REFUSED');
  let parsed;try {parsed=JSON.parse(text);}catch {throw failure('REFUSED');}
  if(parsed===null||typeof parsed!=='object'||Array.isArray(parsed))throw failure('REFUSED');
  const {schemaVersion,experiment,identity,sourceSha256,...state}=parsed;
  if(schemaVersion!==2||experiment!=='windows-selected-instance'||JSON.stringify(identity)!==JSON.stringify(IDENTITY)||JSON.stringify(sourceSha256)!==JSON.stringify(SOURCE_PINS))throw failure('REFUSED');
  if(JSON.stringify(parsed)!==encodeReceipt(state).trim())throw failure('REFUSED');
  return true;
}
async function validatePublishedReceipt() {
  const filename=path.join(REPO,'windows-instance-receipt.json');
  const stat=await fs.lstat(filename);
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>RECEIPT_CAP)throw failure('REFUSED');
  validateReceipt(await fs.readFile(filename,'utf8'));
}

export async function finalizeOwned({state,provider,root,remove=fs.rm}) {
  state.phase='cleanup';
  if(provider) {
    try {await provider.close();}
    catch {recordCleanupFailure(state,'providerCloseFailed');}
    finally {state.providerCalls=provider.count();}
  }
  if(state.providerCalls) {
    if(state.failure==='NONE'){state.failure='PROVIDER_CALLED';state.failurePhase='cleanup';}
    state.outcome='UNKNOWN';
  }
  if(state.spawnCount===0&&!hasCleanupFailure(state))state.cleanup='CLOSED';
  if(root&&state.cleanup==='CLOSED'&&!hasCleanupFailure(state)) {
    try {await remove(root,{recursive:true});state.rootsRemoved=true;}
    catch {recordCleanupFailure(state,'rootsRemovalFailed');}
  }
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
    provider=await providerStub();
    const env=syntheticEnv(root,provider.url);
    for(const key of ['HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_DATA_HOME','XDG_CACHE_HOME','XDG_STATE_HOME','TMP'])await fs.mkdir(env[key],{recursive:true});
    await fs.mkdir(path.join(root,'runtime'));
    const directory=path.join(root,'workspace');await fs.mkdir(directory);
    await fs.copyFile(path.join(REPO,'lawoss/models-catalog/api.json'),env.LAWOSS_MODELS_CATALOG);
    await fs.writeFile(path.join(env.XDG_CONFIG_HOME,'opencode.json'),env.OPENCODE_CONFIG_CONTENT,{flag:'wx'});
    const bin=await prepareArchives({root,env,state});
    const stat=await fs.lstat(bin);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>256*1024*1024)throw failure('ENGINE_MISMATCH');
    verifyEngine(await fs.readFile(bin));state.engineVerified=true;
    await verifySources();
    if(sha256(await fs.readFile(env.LAWOSS_MODELS_CATALOG))!==SOURCE_PINS['lawoss/models-catalog/api.json'])throw failure('SOURCE_MISMATCH');
    await runManaged({bin:await fs.realpath(bin),directory,env,state});
  } catch(error) { if(state.failure==='NONE'){state.failure=CODES.includes(error?.diagnosticCode)?error.diagnosticCode:'SETUP_FAILED';state.failurePhase=state.phase;} }
  finally {
    await finalizeOwned({state,provider,root});
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
