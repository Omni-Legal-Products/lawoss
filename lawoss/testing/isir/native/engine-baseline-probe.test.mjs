import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
const api = await import('./engine-baseline-probe.mjs').catch(() => ({}));
const hash = value => createHash('sha256').update(value).digest('hex');
const originalHash = '32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
function boundary(schema=5) {
  return { schema, mode:'synthetic', platform:'win32', phase:'startup', recoveryStage:null,
    error:{name:'TimeoutError'}, cleanupErrors:[], startup:[{stage:'request',elapsedMs:1}], startupDropped:0,
    requests:[{phase:'startup',caseIndex:null,endpoint:'engine.health',state:'headers',status:200,elapsedMs:13},
      {phase:'startup',caseIndex:null,endpoint:'engine.path',state:'failed',status:null,elapsedMs:88284,error:{name:'TimeoutError'}}],
    engineLog:{status:'available',clockWindowValid:true,absenceInconclusive:true,correlation:'unavailable',
      unscannedBytesAtOpen:0,fileChanged:false,oversizedLineCount:0,partialLineCount:0,malformedCount:0,unknownCount:0,timestampOutlierCount:0,
      lineLimitReached:false,eventLimitReached:false,droppedEvents:0,events:['instance.create-observed','project.resolve-observed','bootstrap.enter-observed'].map(event=>({event,evidenceScope:'selected-directory'}))},
  };
}
const runtime=()=>({schemaVersion:1,status:'observed',outcome:'observed',engineVersion:'1.18.29',engineSha256:originalHash,bunVersion:'1.3.14',preloadObserved:true,elapsedMs:1450});
test('baseline helper is present before the experiment can be wired',()=>assert.equal(typeof api.assessOriginal,'function'));
test('only exact original runtime and positive selected boundary permit heavy work; elapsed is not an SLA',()=>{
  for(const schema of [5,6]) for(const elapsedMs of [0,1,88284,95000]) {
    const main=boundary(schema); main.requests[1].elapsedMs=elapsedMs;
    assert.equal(api.assessOriginal(main,runtime()).decision,'run');
  }
  for(const mutate of [v=>v.engineLog.events.pop(),v=>v.requests[1].status=200,v=>v.requests[1].elapsedMs=-1,v=>v.startup.push({stage:'headers',elapsedMs:2}),v=>v.platform='darwin',v=>v.schema=7]) {
    const main=boundary(); mutate(main); assert.equal(api.assessOriginal(main,runtime()).decision,'unknown');
  }
  for(const mutate of [v=>v.engineSha256='0'.repeat(64),v=>v.bunVersion='1.3.15',v=>v.extra='secret',v=>v.preloadObserved=false]) {
    const rt=runtime(); mutate(rt); assert.equal(api.assessOriginal(boundary(),rt).decision,'unknown');
  }
});
test('Windows full pass is not-needed and projected evidence never repeats unknown payload fields',()=>{
  const main=boundary(); main.phase='complete'; delete main.error; main.startup=[];
  assert.equal(api.assessOriginal(main,runtime()).decision,'not-needed');
  const original=boundary(); original.secret='PRIVATE'; original.requests[1].url='PRIVATE';
  const projected=api.projectBoundary(original);
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));
  assert.equal(api.classifyBaseline(projected,1),'boundary-reproduced');
  assert.equal(api.classifyBaseline(api.projectBoundary(main),0),'not-reproduced');
  assert.equal(api.classifyBaseline(projected,0),'unknown');
  original.phase='recovery'; assert.equal(api.classifyBaseline(api.projectBoundary(original),1),'different-boundary');
});
test('bounded JSON rejects duplicate escaped keys, excess bytes and malformed JSON',()=>{
  assert.deepEqual(api.parseBoundedJson(Buffer.from('{"a":1}'),20),{a:1});
  for(const input of ['{"a":1,"\\u0061":2}','{"a":{"x":1,"x":2}}','{']) assert.throws(()=>api.parseBoundedJson(Buffer.from(input),100));
  assert.throws(()=>api.parseBoundedJson(Buffer.alloc(21),20));
});
test('private environment discards credentials/config and pins synthetic paths and toolchain',()=>{
  const root=path.resolve('/owned'), tools=path.resolve('/tool');
  const env=api.privateEnvironment(root,tools,{PATH:'/bin',GITHUB_TOKEN:'PRIVATE',GH_TOKEN:'PRIVATE',OPENCODE_RELEASE:'0',OPENCODE_CONFIG:'PRIVATE',NODE_OPTIONS:'PRIVATE',npm_config_userconfig:'PRIVATE',GIT_CONFIG_COUNT:'4',GIT_CONFIG_KEY_0:'credential.helper',GIT_CONFIG_VALUE_0:'PRIVATE',GIT_CONFIG_KEY_1:'PRIVATE',GIT_CONFIG_VALUE_1:'PRIVATE',GIT_CONFIG_SYSTEM:'PRIVATE',GIT_CONFIG_PARAMETERS:'PRIVATE'});
  assert.equal(env.HOME,path.join(root,'home'));
  assert.equal(env.PATH,`${tools}${path.delimiter}/bin`);
  for(const key of ['GITHUB_TOKEN','GH_TOKEN','OPENCODE_RELEASE','OPENCODE_CONFIG','NODE_OPTIONS','npm_config_userconfig']) assert.equal(env[key],undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG,path.join(root,'empty.npmrc'));
  assert.equal(env.GIT_CONFIG_COUNT,'1');assert.equal(env.GIT_CONFIG_KEY_0,'core.longpaths');assert.equal(env.GIT_CONFIG_VALUE_0,'true');
  assert.equal(env.GIT_CONFIG_NOSYSTEM,'1');assert.equal(env.GIT_CONFIG_GLOBAL,path.join(root,'empty.gitconfig'));
  for(const key of ['GIT_CONFIG_KEY_1','GIT_CONFIG_VALUE_1','GIT_CONFIG_SYSTEM','GIT_CONFIG_PARAMETERS'])assert.equal(env[key],undefined);
  assert.deepEqual(env,{PATH:`${tools}${path.delimiter}/bin`,CI:'true',HOME:path.join(root,'home'),USERPROFILE:path.join(root,'home'),APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'local'),
    XDG_CONFIG_HOME:path.join(root,'config'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp'),TMPDIR:path.join(root,'tmp'),
    NPM_CONFIG_USERCONFIG:path.join(root,'empty.npmrc'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'empty.gitconfig'),GIT_TERMINAL_PROMPT:'0',GIT_CONFIG_COUNT:'1',GIT_CONFIG_KEY_0:'core.longpaths',GIT_CONFIG_VALUE_0:'true',BUN_INSTALL_CACHE_DIR:path.join(root,'bun-cache')});
});
function child() {
  const c=new EventEmitter(); c.stdout=new PassThrough(); c.stderr=new PassThrough(); c.exitCode=null;c.signalCode=null;c.killCount=0;
  c.kill=()=>{c.killCount++;}; return c;
}
test('owned collector waits for close rather than exit and discards raw child output',async()=>{
  const c=child(); const pending=api.collectChild(c,{timeoutMs:100,drainMs:20,limit:32}); let settled=false;pending.then(()=>settled=true);
  c.stdout.write('PRIVATE');c.emit('exit',0);await new Promise(r=>setImmediate(r));assert.equal(settled,false);
  c.emit('close',0); const result=await pending;
  assert.deepEqual(result,{outcome:'ok',closed:true,code:0}); assert.ok(!JSON.stringify(result).includes('PRIVATE'));
});
test('output limit and deadline retain unknown ownership unless close is observed',async()=>{
  for(const kind of ['limit','timeout']) {
    const c=child();const pending=api.collectChild(c,{timeoutMs:kind==='timeout'?5:100,drainMs:5,limit:2});
    if(kind==='limit')c.stdout.write('PRIVATE');
    const result=await pending;assert.equal(result.closed,false);assert.equal(result.outcome,'child-unclosed');assert.equal(c.killCount,1);
  }
  const c=child();const pending=api.collectChild(c,{timeoutMs:100,drainMs:20,limit:2});c.stdout.write('abc');c.emit('close',1);
  assert.equal((await pending).outcome,'output-limit');
});
async function fixture(t, manifests=2) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'lawoss-baseline-unit-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const bundle=path.join(root,'sidecars');await mkdir(bundle);
  const bytes=Buffer.from('original');
  for(const name of ['opencode-x86_64-pc-windows-msvc.exe','opencode.exe'])await writeFile(path.join(bundle,name),bytes);
  for(const name of ['versions.json','versions.json-x86_64-pc-windows-msvc.exe'].slice(0,manifests)) await writeFile(path.join(bundle,name),JSON.stringify({opencode:{version:'1.18.29',sha256:hash(bytes)},other:{version:'untouched'}}));
  const rebuilt=path.join(root,'rebuilt.exe');await writeFile(rebuilt,'rebuilt');return {root,bundle,rebuilt};
}
test('staging preserves actual manifest set and strict selected hash; original retained',async t=>{
  for(const count of [1,2]) {
    const {bundle,rebuilt}=await fixture(t,count);
    const result=await api.stageBaseline({bundle,rebuilt,originalHash:hash('original')});
    assert.equal(hash(await readFile(path.join(bundle,'opencode-x86_64-pc-windows-msvc.exe'))),hash('rebuilt'));
    assert.equal(hash(await readFile(path.join(result.original,'opencode.exe'))),hash('original'));
    const manifest=JSON.parse(await readFile(path.join(bundle,'versions.json'),'utf8'));assert.deepEqual(manifest.other,{version:'untouched'});assert.equal(manifest.opencode.sha256,hash('rebuilt'));
    if(count===1)await assert.rejects(lstat(path.join(bundle,'versions.json-x86_64-pc-windows-msvc.exe')),{code:'ENOENT'});
  }
});
test('hash mismatch refuses staging before mutation',async t=>{
  const {bundle,rebuilt}=await fixture(t);
  await assert.rejects(api.stageBaseline({bundle,rebuilt,originalHash:'0'.repeat(64)}));
  assert.equal(hash(await readFile(path.join(bundle,'opencode.exe'))),hash('original'));
});
test('failure between directory renames restores only the captured own original identity',async t=>{
  const {bundle,rebuilt}=await fixture(t);let moves=0;
  const {rename}=await import('node:fs/promises');
  await assert.rejects(api.stageBaseline({bundle,rebuilt,originalHash:hash('original'),move:async(a,b)=>{if(++moves===2)throw new Error('PRIVATE');return rename(a,b);}}));
  assert.equal(hash(await readFile(path.join(bundle,'opencode.exe'))),hash('original'));
  assert.equal(moves,3);
});
test('source input hash mismatch refuses changed lock even when source tree exists',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'lawoss-input-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'bun.lock'),'original');
  assert.equal(await api.verifyInputs(root,{'bun.lock':hash('original')}),hash(JSON.stringify([['bun.lock',hash('original')]])));
  await writeFile(path.join(root,'bun.lock'),'changed'); await assert.rejects(api.verifyInputs(root,{'bun.lock':hash('original')}));
});
test('rollback failure retains the captured original and staged candidate without a native selection',async t=>{
  const {root,bundle,rebuilt}=await fixture(t);let moves=0;const {rename,readdir}=await import('node:fs/promises');
  await assert.rejects(api.stageBaseline({bundle,rebuilt,originalHash:hash('original'),move:async(a,b)=>{moves++;if(moves>=2)throw new Error('PRIVATE');return rename(a,b);}}));
  await assert.rejects(lstat(bundle),{code:'ENOENT'});
  const entries=await readdir(root);const original=entries.find(name=>name.startsWith('.engine-baseline-original-'));const staged=entries.find(name=>name.startsWith('.engine-baseline-stage-'));
  assert.equal(hash(await readFile(path.join(root,original,'sidecars','opencode.exe'))),hash('original'));
  assert.equal(hash(await readFile(path.join(root,staged,'sidecars','opencode.exe'))),hash('rebuilt'));
});
test('deadline stays unknown even when direct child closes after the stop request',async()=>{
  const c=child();c.kill=()=>{c.killCount++;setImmediate(()=>c.emit('close',0));};
  const result=await api.collectChild(c,{timeoutMs:5,drainMs:50});
  assert.deepEqual(result,{outcome:'timeout',closed:true,code:0});
});
test('only the target-specific manifest remains target-specific after staging',async t=>{
  const {bundle,rebuilt}=await fixture(t);await rm(path.join(bundle,'versions.json'));
  await api.stageBaseline({bundle,rebuilt,originalHash:hash('original')});
  await assert.rejects(lstat(path.join(bundle,'versions.json')),{code:'ENOENT'});
  assert.equal(JSON.parse(await readFile(path.join(bundle,'versions.json-x86_64-pc-windows-msvc.exe'),'utf8')).opencode.sha256,hash('rebuilt'));
});
function baselineReceipt() {
  return {schemaVersion:3,experiment:'unmodified-windows-baseline',outcome:'unknown',stage:'source-checkout',exit:'child-unclosed',
    sourceCommit:'16747470f976aca3d362ad730bcd3fe82ecc2c9a',checkoutCommit:'a'.repeat(40),prHeadCommit:'b'.repeat(40),nodeVersion:'24.21.0',
    bunVersion:null,lawossBunVersion:'1.4.2',engineVersion:'1.18.29',target:'windows-x64-baseline',sourceInputsSha256:null,lockSha256:null,
    modelsSha256:null,toolchainSha256:null,originalEngineSha256:null,rebuiltEngineSha256:null,originalManifestsSha256:null,rebuiltManifestsSha256:null,
    originalBoundary:api.projectBoundary(boundary()),rebuiltBoundary:null,releaseModelsParity:'unknown',signatureParity:'unknown',causeEquivalence:'unknown',installObservation:null,buildObservation:null};
}
test('final publication reconstructs closed receipts and rejects forged or oversized selected data',()=>{
  const value=baselineReceipt();
  const projected=api.projectReceipt(value);
  assert.equal(projected.schemaVersion,3);assert.equal(projected.installObservation,null);assert.equal(projected.exit,'child-unclosed');assert.equal(projected.checkoutCommit,'a'.repeat(40));
  value.secret='PRIVATE';assert.throws(()=>api.projectReceipt(value));delete value.secret;
  value.originalBoundary.engineLog.selected=['PRIVATE'];assert.throws(()=>api.projectReceipt(value));
  value.originalBoundary=null;value.stage='PRIVATE';assert.throws(()=>api.projectReceipt(value));
});
test('real CLI missing-artifact guard skips heavy work and finalizer removes unapproved native bytes',async t=>{
  const {spawn}=await import('node:child_process');
  const root=await mkdtemp(path.join(tmpdir(),'lawoss-baseline-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'receipt.json'),native=path.join(root,'native.json'),githubOutput=path.join(root,'github-output');
  const launch=async(args)=>{
    const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-baseline-probe.mjs',import.meta.url)),...args],{env:{GITHUB_OUTPUT:githubOutput},stdio:['ignore','pipe','pipe']});
    const result=await api.collectChild(c,{timeoutMs:5000});assert.equal(result.outcome,'ok');
  };
  await launch(['guard',output,path.join(root,'missing-main'),path.join(root,'missing-runtime')]);
  assert.equal((await readFile(githubOutput,'utf8')).trim(),'run=false');
  assert.equal(JSON.parse(await readFile(output,'utf8')).outcome,'unknown');
  assert.equal(JSON.parse(await readFile(output,'utf8')).schemaVersion,3);
  assert.equal(JSON.parse(await readFile(output,'utf8')).installObservation,null);
  await writeFile(native,'PRIVATE unapproved bytes');await launch(['finalize',output,native]);
  await assert.rejects(lstat(native),{code:'ENOENT'});
  assert.ok(!JSON.stringify(JSON.parse(await readFile(output,'utf8'))).includes('PRIVATE'));
});
test('rebuilt bytes changed after readiness are rejected before replacing any original file',async t=>{
  const {bundle,rebuilt}=await fixture(t);
  await assert.rejects(api.stageBaseline({bundle,rebuilt,originalHash:hash('original'),expectedRebuiltHash:'0'.repeat(64)}));
  assert.equal(hash(await readFile(path.join(bundle,'opencode.exe'))),hash('original'));
});
test('native cleanup failure remains unknown for startup and complete phases; clean other boundary remains distinct',()=>{
  const startup=boundary();startup.cleanupErrors=[{name:'Error'}];
  assert.equal(api.classifyBaseline(api.projectBoundary(startup),1),'unknown');
  const completed=boundary();completed.phase='complete';delete completed.error;completed.cleanupErrors=[{name:'Error'}];
  assert.equal(api.classifyBaseline(api.projectBoundary(completed),1),'unknown');
  const different=boundary();different.phase='recovery';
  assert.equal(api.classifyBaseline(api.projectBoundary(different),1),'different-boundary');
});
test('late native writer can only change private raw diagnostics after public finalization',async t=>{
  const {spawn}=await import('node:child_process');
  const root=await mkdtemp(path.join(tmpdir(),'lawoss-baseline-late-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const owned=path.join(root,'owned');await mkdir(owned);
  const output=path.join(root,'receipt.json'),published=path.join(root,'native-public.json');
  const nativeEnv=api.nativeDiagnosticEnvironment(owned,{});
  const privateFile=nativeEnv.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE;
  assert.equal(path.dirname(privateFile),owned);assert.notEqual(privateFile,published);
  const cli=async(args)=>{
    const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-baseline-probe.mjs',import.meta.url)),...args],{env:{},stdio:['ignore','pipe','pipe']});
    assert.equal((await api.collectChild(c,{timeoutMs:5000})).outcome,'ok');
  };
  await cli(['guard',output,path.join(root,'missing-main'),path.join(root,'missing-runtime')]);
  const retained=JSON.parse(await readFile(output,'utf8'));
  // The stopped/unclosed writer is released only after finalization, without
  // timing races. It retains exactly the filename supplied to the real child.
  const lateWrite=()=>writeFile(privateFile,'PRIVATE unapproved late payload');
  await cli(['finalize',output,published]);await lateWrite();
  await assert.rejects(lstat(published),{code:'ENOENT'});
  assert.equal(await readFile(privateFile,'utf8'),'PRIVATE unapproved late payload');
  retained.rebuiltBoundary=api.projectBoundary(boundary());await writeFile(output,JSON.stringify(retained));
  await cli(['finalize',output,published]);const approved=await readFile(published,'utf8');
  await lateWrite();assert.equal(await readFile(published,'utf8'),approved);
  assert.ok(!approved.includes('PRIVATE'));
});

const installOptions=()=>({installObservation:{packages:api.installPackageAllowlist({name:'opencode',trustedDependencies:['esbuild','node-pty']})},timeoutMs:100,drainMs:10});
async function installLines(chunks,code=1,signal=null) {
  const c=child(),pending=api.collectChild(c,installOptions());c.emit('spawn');
  for(const chunk of chunks)c.stderr.write(chunk);
  c.emit('close',code,signal);return pending;
}
test('install lifecycle distinguishes nonzero close, spawn errors and pipe failure without retaining error data',async()=>{
  const normal=await installLines(['PRIVATE\n'],-1,'SIGABRT');
  assert.equal(normal.outcome,'child-error');assert.equal(normal.code,null);
  assert.deepEqual({...normal.installObservation,stderr:undefined},{spawnObserved:true,closeObserved:true,exitCode:-1,signal:'SIGABRT',childErrorCode:null,pipeFailure:false,stderr:undefined});
  for(const code of ['ENOENT','EACCES','EPERM','PRIVATE',undefined]) {
    const c=child(),pending=api.collectChild(c,installOptions());
    c.emit('error',Object.assign(new Error('PRIVATE path'),{code}));c.emit('close',null,null);
    const result=await pending;assert.equal(result.outcome,'child-error');assert.equal(result.installObservation.spawnObserved,false);
    assert.equal(result.installObservation.childErrorCode,['ENOENT','EACCES','EPERM'].includes(code)?code:'other');
    assert.equal(result.installObservation.closeObserved,true);assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  }
  for(const pipe of ['stdout','stderr']) {
    const c=child(),pending=api.collectChild(c,installOptions());c.emit('spawn');c[pipe].emit('error',new Error('PRIVATE'));c.emit('close',2,'PRIVATE');
    const result=await pending;assert.equal(result.outcome,'child-error');assert.equal(result.installObservation.pipeFailure,true);
    assert.equal(result.installObservation.childErrorCode,null);assert.equal(result.installObservation.signal,'other');
  }
});
test('install observation survives timeout and direct close without changing the primary result; late events are inert',async()=>{
  for(const closed of [false,true]) {
    const c=child(),pending=api.collectChild(c,{...installOptions(),timeoutMs:5,drainMs:5});c.emit('spawn');
    if(closed)c.kill=()=>{c.killCount++;setImmediate(()=>c.emit('close',0,'SIGTERM'));};
    const result=await pending;assert.equal(result.outcome,closed?'timeout':'child-unclosed');
    assert.equal(result.installObservation.closeObserved,closed);assert.equal(result.installObservation.exitCode,closed?0:null);
    const frozen=JSON.stringify(result);c.emit('spawn');c.emit('close',9,'SIGKILL');c.emit('error',new Error('PRIVATE'));c.stderr.emit('data',Buffer.from('error: lockfile had changes, but lockfile is frozen\n'));
    assert.equal(JSON.stringify(result),frozen);assert.equal(c.listenerCount('spawn'),0);
  }
  const c=child(),pending=api.collectChild(c,{...installOptions(),limit:1});c.stderr.write('ab');c.emit('close',1);
  assert.equal((await pending).outcome,'output-limit');
});
test('only complete source-shaped install stderr summaries and pinned package tokens are observed',async()=>{
  const frozen='error: lockfile had changes, but lockfile is frozen';
  const result=await installLines([
    `\u001b[31m${frozen}\u001b[0m\r\n`,
    'error: postinstall script from "opencode" exited with 1\r\n',
    'error: install script from "esbuild" exited with -2\n',
    'error: prepare script from "node-pty" exited with 4294967295\n',
    'error: install script from "unknown" exited with 1\n',
    'error: other script from "esbuild" exited with 1\n',
    'error: install script from "esbuild" exited with 1 trailing\n',
    'error: install script from "esbuild" exited with 4294967296\n',
    'error: install script from "esbuild" exited with +1\n',
    `prefix ${frozen}\n`,`${frozen} trailing\n`,`lock frozen changed patch\n`,`\u001b[2K${frozen}\n`,`\ufeff${frozen}\n`,frozen,
  ]);
  const s=result.installObservation.stderr;
  assert.equal(s.frozenRefusalSummaryCount,1);assert.equal(s.lineCount,14);assert.equal(s.unrecognizedLineCount,10);assert.equal(s.incompleteLineCount,1);
  assert.deepEqual(s.lifecycleExitSummaries,[{script:'postinstall',exitCode:1,count:1},{script:'install',exitCode:-2,count:1},{script:'prepare',exitCode:4294967295,count:1}]);
  assert.ok(!JSON.stringify(result).includes('opencode'));assert.ok(!JSON.stringify(result).includes('esbuild'));
  const c=child(),pending=api.collectChild(c,installOptions());c.stdout.write(`${frozen}\n`);c.emit('close',0);
  assert.equal((await pending).installObservation.stderr.frozenRefusalSummaryCount,0);
});
test('install stderr scanning bounds partial bytes, UTF8, complete lines, counters and conflicting records',async()=>{
  const marker=Buffer.from('error: lockfile had changes, but lockfile is frozen\r\n');
  const result=await installLines([marker.subarray(0,12),marker.subarray(12),Buffer.from('ž\n').subarray(0,1),Buffer.from('ž\n').subarray(1),Buffer.from([0xff,10]),'x'.repeat(4097),'\n',marker]);
  assert.equal(result.installObservation.stderr.frozenRefusalSummaryCount,2);
  assert.equal(result.installObservation.stderr.unrecognizedLineCount,2);assert.equal(result.installObservation.stderr.oversizedLineCount,1);
  const observations=[];
  for(let n=0;n<18;n++)observations.push(`error: install script from "esbuild" exited with ${n}\n`);
  observations.push('error: install script from "esbuild" exited with 0\n');
  const multi=(await installLines(observations)).installObservation.stderr;
  assert.equal(multi.lifecycleExitSummaries.length,16);assert.deepEqual(multi.lifecycleExitSummaries[0],{script:'install',exitCode:0,count:2});assert.equal(multi.lifecycleExitSummaryDropped,2);
  const lineBound=(await installLines(['\n'.repeat(4096),marker])).installObservation.stderr;
  assert.equal(lineBound.lineCount,4096);assert.equal(lineBound.lineLimitReached,true);assert.equal(lineBound.frozenRefusalSummaryCount,0);
  const byteBound=(await installLines(['x'.repeat(512*1024),marker])).installObservation.stderr;
  assert.equal(byteBound.scannedBytes,512*1024);assert.equal(byteBound.scanLimitReached,true);assert.equal(byteBound.oversizedLineCount,1);assert.equal(byteBound.incompleteLineCount,1);assert.equal(byteBound.frozenRefusalSummaryCount,0);
  const oneChunk=(await installLines([Buffer.concat([Buffer.alloc(512*1024,120),marker])])).installObservation.stderr;
  assert.deepEqual(oneChunk,byteBound);
  const maxCount=(await installLines([Buffer.concat(Array(4096).fill(marker)),marker])).installObservation.stderr;
  assert.equal(maxCount.frozenRefusalSummaryCount,4096);assert.equal(maxCount.lineLimitReached,true);
  const allScripts=['preinstall','install','postinstall','prepare','preprepare','postprepare'];
  const known=(await installLines(allScripts.map(script=>`error: ${script} script from "node-pty" exited with 1\n`))).installObservation.stderr;
  assert.deepEqual(known.lifecycleExitSummaries,allScripts.map(script=>({script,exitCode:1,count:1})));
  const c=child(),pending=api.collectChild(c,installOptions());c.stderr.write(marker);c.emit('close',0,'SIGSEGV');const immutable=(await pending).installObservation;
  assert.ok(Object.isFrozen(immutable)&&Object.isFrozen(immutable.stderr)&&Object.isFrozen(immutable.stderr.lifecycleExitSummaries));
  assert.throws(()=>{immutable.stderr.frozenRefusalSummaryCount=99;});assert.equal(immutable.signal,'SIGSEGV');
});
test('manifest-derived install package allowlist is finite, bounded and rejects unsafe tokens',()=>{
  assert.deepEqual(api.installPackageAllowlist({name:'opencode',trustedDependencies:['esbuild','@safe/pkg','esbuild']}),['opencode','esbuild','@safe/pkg']);
  for(const pkg of [{name:'../private',trustedDependencies:[]},{name:'ok',trustedDependencies:['https://private']},{name:'ok',trustedDependencies:['a'.repeat(215)]},{name:'ok',trustedDependencies:Array.from({length:128},(_,i)=>`pkg-${i}`)},{name:'ok',trustedDependencies:'PRIVATE'}])assert.throws(()=>api.installPackageAllowlist(pkg));
});
test('schema3 install publication is closed at every nested boundary and retains historical install failures',async()=>{
  const observation=(await installLines(['error: install script from "opencode" exited with 7\n'])).installObservation;
  const value=baselineReceipt();value.stage='upstream-install';value.exit='child-error';value.installObservation=observation;
  const valid=api.projectReceipt(value);assert.deepEqual(valid.installObservation,observation);assert.notEqual(valid.installObservation,observation);
  value.stage='complete';assert.deepEqual(api.projectReceipt(value).installObservation,observation);
  for(const mutate of [
    v=>v.schemaVersion=1,v=>v.installObservation.extra='PRIVATE',v=>v.installObservation.exitCode=1.5,v=>v.installObservation.exitCode=-2147483649,
    v=>v.installObservation.signal='PRIVATE',v=>v.installObservation.childErrorCode='PRIVATE',v=>v.installObservation.pipeFailure=1,
    v=>v.installObservation.spawnObserved='true',v=>v.installObservation.stderr.extra='PRIVATE',v=>v.installObservation.stderr.scannedBytes=524289,
    v=>v.installObservation.stderr.lineCount=4097,v=>v.installObservation.stderr.incompleteLineCount=2,v=>v.installObservation.stderr.scanLimitReached=1,
    v=>v.installObservation.stderr.lifecycleExitSummaries[0].package='PRIVATE',v=>v.installObservation.stderr.lifecycleExitSummaries[0].script='PRIVATE',
    v=>v.installObservation.stderr.lifecycleExitSummaries[0].count=0,v=>v.installObservation.stderr.lifecycleExitSummaries.push({...v.installObservation.stderr.lifecycleExitSummaries[0]}),
    v=>v.installObservation.stderr.lifecycleExitSummaryDropped=-1,v=>v.installObservation.stderr.lifecycleExitSummaries=Array(17).fill({script:'install',exitCode:1,count:1}),
    v=>v.originalBoundary.engineLog.extra='PRIVATE',v=>v.originalBoundary.requests[0].url='PRIVATE',v=>v.originalBoundary.requests[0].error=null,v=>v.originalBoundary.error=null,v=>v.lawossBunVersion='PRIVATE',
    v=>v.installObservation.stderr.lineCount=0,v=>{v.installObservation.stderr.incompleteLineCount=1;v.installObservation.stderr.scannedBytes=0;},v=>v.installObservation.stderr.oversizedLineCount=1,
  ]) {const forged=structuredClone(value);mutate(forged);assert.throws(()=>api.projectReceipt(forged));}
  value.stage='toolchain';assert.throws(()=>api.projectReceipt(value));
});
test('default child collection does not install observers or change result and capture behavior',async()=>{
  const c=child(),pending=api.collectChild(c,{timeoutMs:100});assert.equal(c.listenerCount('spawn'),0);
  c.stderr.write('error: lockfile had changes, but lockfile is frozen\n');c.emit('close',1);
  assert.deepEqual(await pending,{outcome:'child-error',closed:true,code:1});
  const captured=child(),capture=api.collectChild(captured,{timeoutMs:100,capture:true});captured.stdout.write('version');captured.emit('close',0);
  assert.deepEqual(await capture,{outcome:'ok',closed:true,code:0,text:'version'});
});
test('real finalizer retains bounded install metadata and discards forged schema3 observations',async t=>{
  const {spawn}=await import('node:child_process');
  const root=await mkdtemp(path.join(tmpdir(),'lawoss-install-finalizer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'receipt.json'),native=path.join(root,'native.json');
  const value=baselineReceipt();value.stage='upstream-install';value.exit='child-error';value.installObservation=(await installLines(['error: lockfile had changes, but lockfile is frozen\n'])).installObservation;
  const finalize=async()=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-baseline-probe.mjs',import.meta.url)),'finalize',output,native],{env:{},stdio:['ignore','pipe','pipe']});assert.equal((await api.collectChild(c,{timeoutMs:5000})).outcome,'ok');return JSON.parse(await readFile(output,'utf8'));};
  await writeFile(output,JSON.stringify(value));assert.deepEqual((await finalize()).installObservation,value.installObservation);
  value.installObservation=structuredClone(value.installObservation);value.installObservation.stderr.raw='PRIVATE';await writeFile(output,JSON.stringify(value));
  const refused=await finalize();assert.equal(refused.schemaVersion,3);assert.equal(refused.installObservation,null);assert.equal(refused.outcome,'unknown');assert.ok(!JSON.stringify(refused).includes('PRIVATE'));
});


const buildOptions=()=>({buildObservation:{packages:api.installPackageAllowlist({name:'opencode',trustedDependencies:['esbuild','node-pty']})},timeoutMs:1000,drainMs:10});
const buildMarkers=[
  'Loaded models.dev snapshot','Building Web UI to embed in the binary',
  'building opencode-windows-x64','Running smoke test: dist/opencode-windows-x64/bin/opencode --version','Smoke test passed: 1.18.29',
  'building opencode-windows-x64-baseline','Running smoke test: dist/opencode-windows-x64-baseline/bin/opencode --version','Smoke test passed: 1.18.29',
];
async function buildLines(stdout=[],stderr=[],code=1,signal=null) {
  const c=child(),pending=api.collectChild(c,buildOptions());c.emit('spawn');
  for(const chunk of stdout)c.stdout.write(chunk);
  for(const chunk of stderr)c.stderr.write(chunk);
  c.emit('close',code,signal);return pending;
}
test('build observation preserves ordered stdout events including unassigned smoke passes and separated stderr summaries',async()=>{
  const result=await buildLines([`${buildMarkers.join('\n')}\n`],[
    'error: script "build" exited with code -1\n','error during build:\n',
    'error: lockfile had changes, but lockfile is frozen\n','error: install script from "esbuild" exited with 4294967295\n',
    'error: script "build" exited with code -1\n',
  ],4294967295,'SIGABRT');
  const b=result.buildObservation;
  assert.equal(result.outcome,'child-error');assert.equal(result.code,4294967295);
  assert.deepEqual(b.stdout.progressEvents,['models-loaded','web-ui-enter','normal-target-enter','normal-smoke-enter','smoke-pass','baseline-target-enter','baseline-smoke-enter','smoke-pass']);
  assert.deepEqual(b.stderr.exitSummaries,[{role:'nested-build',exitCode:-1,count:2},{role:'lifecycle',script:'install',exitCode:4294967295,count:1}]);
  assert.equal(b.stderr.viteBuildFailureSummaryCount,1);assert.equal(b.stderr.frozenRefusalSummaryCount,1);
  assert.equal(b.exitCode,4294967295);assert.equal(b.signal,'SIGABRT');assert.equal(b.closeObserved,true);assert.equal(b.spawnObserved,true);
  const unassigned=(await buildLines(['Smoke test passed: 1.18.29\n'])).buildObservation;
  assert.deepEqual(unassigned.stdout.progressEvents,['smoke-pass']);assert.equal(Object.hasOwn(unassigned,'failedStage'),false);
  assert.ok(!JSON.stringify(b).includes('opencode'));assert.ok(!JSON.stringify(b).includes('esbuild'));
});
test('build observation frames each pipe separately and accepts only complete exact bounded SGR UTF8 lines',async()=>{
  const marker=Buffer.from('\x1b[31mLoaded models.dev snapshot\x1b[0m\r\n');
  const c=child(),pending=api.collectChild(c,buildOptions());
  c.stdout.write(marker.subarray(0,11));c.stderr.write('Loaded models.dev snapshot\n');c.stdout.write(marker.subarray(11));
  c.stdout.write('building opencode-');c.stderr.write('windows-x64\n');c.stdout.write('windows-x64\n');
  for(const line of ['prefix Loaded models.dev snapshot','Loaded models.dev snapshot trailing','\ufeffLoaded models.dev snapshot','\x1b[2KLoaded models.dev snapshot',`\x1b[${'1'.repeat(33)}mLoaded models.dev snapshot`,'PRIVATE https://private/path','    at PRIVATE (C:\\private\\build.ts:1:2)'])c.stdout.write(`${line}\n`);
  const utf8=Buffer.from('ž\n');c.stdout.write(utf8.subarray(0,1));c.stdout.write(utf8.subarray(1));c.stdout.write(Buffer.from([255,10]));
  c.stdout.write('Smoke test passed: 1.18.29');c.stderr.write('error during build:');c.emit('close',-1073741819);
  const b=(await pending).buildObservation;
  assert.deepEqual(b.stdout.progressEvents,['models-loaded','normal-target-enter']);assert.equal(b.stdout.unrecognizedLineCount,9);
  assert.equal(b.stdout.incompleteLineCount,1);assert.equal(b.stderr.incompleteLineCount,1);assert.equal(b.stderr.viteBuildFailureSummaryCount,0);
  assert.equal(b.stderr.unrecognizedLineCount,2);assert.equal(b.exitCode,-1073741819);assert.ok(!JSON.stringify(b).includes('PRIVATE'));
  const poisoned=(await buildLines(['error during build:\n'],[
    'Loaded models.dev snapshot\n','error during build: trailing\n','prefix error during build:\n',
    'error: script "build" exited with code +1\n','error: script "build" exited with code 01\n','error: script "build" exited with code 4294967296\n',
    'error: install script from "unknown" exited with 1\n','error: other script from "esbuild" exited with 1\n','error: install script from "esbuild" exited with 1 trailing\n',
    'error: install script from "https://PRIVATE" exited with 1\n','    at PRIVATE (C:\\private\\build.ts:1:2)\n',
  ])).buildObservation;
  assert.equal(poisoned.stdout.unrecognizedLineCount,1);assert.equal(poisoned.stderr.unrecognizedLineCount,11);assert.deepEqual(poisoned.stderr.exitSummaries,[]);
});
test('build observation caps events and shared summary tuples while counting later repeated tuples',async()=>{
  const stderr=Array.from({length:17},(_,n)=>`error: script "build" exited with code ${n}\n`);
  stderr.push('error: install script from "esbuild" exited with 1\n','error: script "build" exited with code 0\n');
  const b=(await buildLines(['Smoke test passed: 1.18.29\n'.repeat(34)],stderr)).buildObservation;
  assert.equal(b.stdout.progressEvents.length,32);assert.equal(b.stdout.progressEventDropped,2);assert.equal(b.stdout.eventLimitReached,true);
  assert.equal(b.stderr.exitSummaries.length,16);assert.deepEqual(b.stderr.exitSummaries[0],{role:'nested-build',exitCode:0,count:2});
  assert.equal(b.stderr.exitSummaryDropped,2);assert.equal(b.stderr.summaryLimitReached,true);
});
test('build observation bounds lines per stream, oversized and incomplete buffers without killing a child',async()=>{
  const c=child(),pending=api.collectChild(c,buildOptions());
  c.stdout.write('\n'.repeat(65536));c.stdout.write('Loaded models.dev snapshot\n');c.stderr.write('error during build:\n');
  c.emit('close',0);const b=(await pending).buildObservation;
  assert.equal(b.stdout.lineCount,65536);assert.equal(b.stdout.lineLimitReached,true);assert.equal(b.stderr.viteBuildFailureSummaryCount,1);assert.equal(c.killCount,0);
  const d=(await buildLines(['x'.repeat(4096),'y','\n','x'.repeat(4097)],['x'.repeat(4096),'\n'])).buildObservation;
  assert.equal(d.stdout.oversizedLineCount,2);assert.equal(d.stdout.incompleteLineCount,1);assert.equal(d.stdout.lineCount,1);assert.equal(d.stderr.oversizedLineCount,0);assert.equal(d.stderr.unrecognizedLineCount,1);
  const e=(await buildLines([],['\n'.repeat(65536),'error during build:\n'])).buildObservation;
  assert.equal(e.stderr.lineLimitReached,true);assert.equal(e.stderr.lineCount,65536);assert.equal(e.stderr.viteBuildFailureSummaryCount,0);
});
test('build observation shares the original 64 MiB scan ceiling across both pipes without changing collector output limits',async()=>{
  const c=child(),pending=api.collectChild(c,buildOptions());const half=Buffer.alloc(32*1024*1024,120);
  c.stdout.write(half);c.stderr.write(half);assert.equal(c.killCount,0);
  c.stderr.write('error during build:\n');c.emit('close',1);const result=await pending,b=result.buildObservation;
  assert.equal(result.outcome,'output-limit');assert.equal(c.killCount,1);assert.equal(b.scannedBytes,64*1024*1024);assert.equal(b.scanLimitReached,true);
  for(const s of [b.stdout,b.stderr]){assert.equal(s.scannedBytes,32*1024*1024);assert.equal(s.oversizedLineCount,1);assert.equal(s.incompleteLineCount,1);}
  assert.equal(b.stderr.viteBuildFailureSummaryCount,0);
});
test('build observation distinguishes spawn and pipe failures, direct close, deadline and inert late events',async()=>{
  for(const code of ['ENOENT','EACCES','EPERM','PRIVATE']) {
    const c=child(),pending=api.collectChild(c,buildOptions());c.emit('error',Object.assign(new Error('PRIVATE'),{code}));c.emit('close',-1,'PRIVATE');
    const b=(await pending).buildObservation;assert.equal(b.spawnObserved,false);assert.equal(b.childErrorCode,code==='PRIVATE'?'other':code);assert.equal(b.signal,'other');assert.equal(b.exitCode,-1);
  }
  for(const pipe of ['stdout','stderr']) {
    const c=child(),pending=api.collectChild(c,buildOptions());c.emit('spawn');c[pipe].emit('error',new Error('PRIVATE'));c.emit('close',null,'SIGKILL');
    const b=(await pending).buildObservation;assert.equal(b.pipeFailure,true);assert.equal(b.childErrorCode,null);assert.equal(b.signal,'SIGKILL');
  }
  for(const closed of [true,false]) {
    const c=child(),pending=api.collectChild(c,{...buildOptions(),timeoutMs:5,drainMs:30});c.emit('spawn');c.stdout.write('Loaded models.dev snapshot');
    if(closed)setTimeout(()=>c.emit('close',0),10);
    const result=await pending,b=result.buildObservation,snapshot=JSON.stringify(b);
    assert.equal(result.outcome,closed?'timeout':'child-unclosed');assert.equal(b.closeObserved,closed);assert.equal(b.exitCode,closed?0:null);
    assert.equal(c.listenerCount('spawn'),0);assert.equal(c.listenerCount('close'),closed?0:1);assert.equal(c.stdout.listenerCount('data'),1);assert.equal(c.stderr.listenerCount('data'),1);
    c.emit('spawn');c.emit('close',4294967295,'SIGSEGV');c.emit('error',new Error('PRIVATE'));c.stdout.emit('data',Buffer.from('\nLoaded models.dev snapshot\n'));c.stderr.emit('data',Buffer.from('error during build:\n'));c.stderr.emit('error',new Error('PRIVATE'));
    assert.equal(JSON.stringify(b),snapshot);assert.ok(Object.isFrozen(b)&&Object.isFrozen(b.stdout)&&Object.isFrozen(b.stdout.progressEvents)&&Object.isFrozen(b.stderr)&&Object.isFrozen(b.stderr.exitSummaries));
  }
});
test('build publication closes every nested field and rejects impossible bounds and pre-build stages',async()=>{
  const value=baselineReceipt();value.stage='upstream-build';value.buildObservation=(await buildLines(['Loaded models.dev snapshot\n'],['error: script "build" exited with code 1\n'])).buildObservation;
  const valid=api.projectReceipt(value);assert.deepEqual(valid.buildObservation,value.buildObservation);assert.notEqual(valid.buildObservation,value.buildObservation);assert.ok(Object.isFrozen(valid.buildObservation.stderr.exitSummaries[0]));
  for(const mutate of [
    v=>v.schemaVersion=2,v=>v.stage='upstream-install',v=>v.buildObservation.extra='PRIVATE',v=>v.buildObservation.spawnObserved=1,v=>v.buildObservation.closeObserved=false,
    v=>v.buildObservation.exitCode=-2147483649,v=>v.buildObservation.exitCode=4294967296,v=>v.buildObservation.exitCode=1.2,v=>v.buildObservation.signal='PRIVATE',v=>v.buildObservation.childErrorCode='PRIVATE',v=>v.buildObservation.pipeFailure=1,
    v=>v.buildObservation.scannedBytes++,v=>v.buildObservation.scannedBytes=67108865,v=>v.buildObservation.scanLimitReached=true,
    v=>v.buildObservation.stdout.extra='PRIVATE',v=>v.buildObservation.stdout.scannedBytes=0,v=>v.buildObservation.stdout.lineCount=65537,v=>v.buildObservation.stdout.incompleteLineCount=2,v=>v.buildObservation.stdout.oversizedLineCount=1,v=>v.buildObservation.stdout.unrecognizedLineCount++,
    v=>v.buildObservation.stdout.progressEvents=['PRIVATE'],v=>v.buildObservation.stdout.progressEvents=Array(33).fill('smoke-pass'),v=>v.buildObservation.stdout.progressEventDropped=-1,v=>v.buildObservation.stdout.eventLimitReached=true,v=>v.buildObservation.stdout.lineLimitReached=true,
    v=>v.buildObservation.stderr.extra='PRIVATE',v=>v.buildObservation.stderr.viteBuildFailureSummaryCount++,v=>v.buildObservation.stderr.frozenRefusalSummaryCount=-1,v=>v.buildObservation.stderr.exitSummaryDropped=1,v=>v.buildObservation.stderr.summaryLimitReached=true,
    v=>v.buildObservation.stderr.exitSummaries[0].raw='PRIVATE',v=>v.buildObservation.stderr.exitSummaries[0].role='PRIVATE',v=>v.buildObservation.stderr.exitSummaries[0].script='install',v=>v.buildObservation.stderr.exitSummaries[0].exitCode=4294967296,v=>v.buildObservation.stderr.exitSummaries[0].count=0,
    v=>v.buildObservation.stderr.exitSummaries.push({...v.buildObservation.stderr.exitSummaries[0]}),
  ]) {const forged=structuredClone(value);mutate(forged);assert.throws(()=>api.projectReceipt(forged));}
  for(const stage of ['upstream-build','build-inputs-after','rebuilt-identity','bundle-staging','native','complete']){value.stage=stage;assert.deepEqual(api.projectReceipt(value).buildObservation,value.buildObservation);}
});
test('build observation disabled preserves exact result shape, capture and original collector lifecycle limits',async()=>{
  for(const options of [{},{buildObservation:null}]) {
    const c=child(),pending=api.collectChild(c,{timeoutMs:100,...options});assert.equal(c.listenerCount('spawn'),0);c.stdout.write('Loaded models.dev snapshot\n');c.emit('close',-1);
    assert.deepEqual(await pending,{outcome:'child-error',closed:true,code:null});
  }
  const c=child(),pending=api.collectChild(c,{...buildOptions(),limit:1});c.stdout.write('xx');c.emit('close',0);assert.equal((await pending).outcome,'output-limit');
});
test('real CLI build finalizer publishes only closed schema3 build observations and refuses poisoned historical schemas',async t=>{
  const {spawn}=await import('node:child_process');const root=await mkdtemp(path.join(tmpdir(),'lawoss-build-finalizer-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'receipt.json'),native=path.join(root,'native.json'),value=baselineReceipt();value.stage='upstream-build';value.exit='child-error';
  value.buildObservation=(await buildLines(['Smoke test passed: 1.18.29\n'],['error during build:\n'])).buildObservation;
  value.installObservation=(await installLines([] ,0)).installObservation;
  const finalize=async()=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-baseline-probe.mjs',import.meta.url)),'finalize',output,native],{env:{},stdio:['ignore','pipe','pipe']});assert.equal((await api.collectChild(c,{timeoutMs:5000})).outcome,'ok');return JSON.parse(await readFile(output,'utf8'));};
  await writeFile(output,JSON.stringify(value));const published=await finalize();assert.deepEqual(published.buildObservation,value.buildObservation);assert.deepEqual(published.installObservation,value.installObservation);
  for(const mutate of [v=>v.schemaVersion=2,v=>v.buildObservation.stdout.raw='PRIVATE',v=>v.stage='toolchain']) {
    const forged=structuredClone(value);mutate(forged);await writeFile(output,JSON.stringify(forged));await writeFile(native,'PRIVATE');const refused=await finalize();
    assert.equal(refused.schemaVersion,3);assert.equal(refused.buildObservation,null);assert.equal(refused.outcome,'unknown');assert.ok(!JSON.stringify(refused).includes('PRIVATE'));await assert.rejects(lstat(native),{code:'ENOENT'});
  }
});
test('build observation removes bounded terminal SGR before optional final CR',async()=>{
  const b=(await buildLines(['Loaded models.dev snapshot\r\x1b[0m\n'],['error during build:\r\x1b[0m\n'])).buildObservation;
  assert.deepEqual(b.stdout.progressEvents,['models-loaded']);assert.equal(b.stderr.viteBuildFailureSummaryCount,1);
});
test('build publication rejects sparse event arrays and unclosed array properties',async()=>{
  const observation=(await buildLines(['Loaded models.dev snapshot\n'],['error: script "build" exited with code 1\n'])).buildObservation;
  for(const mutate of [b=>b.stdout.progressEvents=Array(1),b=>b.stdout.progressEvents.raw='PRIVATE',b=>b.stderr.exitSummaries.raw='PRIVATE']) {
    const forged=structuredClone(observation);mutate(forged);assert.throws(()=>api.projectBuildObservation(forged));
  }
});
test('upstream-build invocation retains exact executable argv cwd environment and default budgets before preserving failure',async()=>{
  // Execute the real local run/stage closures and upstream-build invocation
  // against a synthetic owned child. This never enters experiment setup or Bun.
  const source=await readFile(new URL('./engine-baseline-probe.mjs',import.meta.url),'utf8');
  const start=source.indexOf('  const run=async(command,args,cwd,options={})=>{');
  const end=source.indexOf('  try {\n    const git=',start);
  const invocation=source.split('\n').find(line=>line.startsWith("    await stage('upstream-build',"));
  assert.ok(start>=0&&end>start&&invocation);
  const execute=new Function('spawn','collectChild','result','bun','upstream','buildEnv','env','installPackageAllowlist','pkg','writeJson','output',`return (async()=>{${source.slice(start,end)}${invocation}})()`);
  const env=Object.freeze({CI:'true',OPENCODE_VERSION:'1.18.29',OPENCODE_CHANNEL:'latest',MODELS_DEV_API_JSON:'synthetic-models'}),result=baselineReceipt();
  const pkg={name:'opencode',trustedDependencies:['esbuild']};
  let calls=0;
  const spawn=(command,args,options)=>{
    calls++;assert.equal(command,'synthetic-bun');assert.deepEqual(args,['run','packages/opencode/script/build.ts','--single','--baseline']);
    assert.deepEqual(options,{cwd:'synthetic-upstream',env,windowsHide:true,stdio:['ignore','pipe','pipe']});assert.equal(options.env,env);
    const c=child();setImmediate(()=>{c.emit('spawn');c.stdout.write('Building Web UI to embed in the binary\n');c.stderr.write('error during build:\n');c.emit('close',1);});return c;
  };
  const collect=(c,options)=>{
    assert.deepEqual(Object.keys(options).sort(),['buildObservation','env']);assert.equal(options.env,env);assert.deepEqual(options.buildObservation.packages,['opencode','esbuild']);
    return api.collectChild(c,options);
  };
  const timerCalls=[];const originalTimer=globalThis.setTimeout;
  try {
    globalThis.setTimeout=(callback,delay,...args)=>{timerCalls.push(delay);return originalTimer(callback,delay,...args);};
    await assert.rejects(execute(spawn,collect,result,'synthetic-bun','synthetic-upstream',env,env,api.installPackageAllowlist,pkg,async()=>{},'synthetic-receipt'),/Owned command did not complete/);
  }finally{globalThis.setTimeout=originalTimer;}
  assert.equal(calls,1);assert.deepEqual(timerCalls,[600000]);assert.equal(result.stage,'upstream-build');assert.equal(result.exit,'child-error');assert.equal(result.outcome,'unknown');
  assert.deepEqual(result.buildObservation.stdout.progressEvents,['web-ui-enter']);assert.equal(result.buildObservation.stderr.viteBuildFailureSummaryCount,1);
  assert.ok(Object.isFrozen(result.buildObservation));assert.equal(result.installObservation,null);
});

function recoveryOptionalFixtures(){
  const poll={attempt:1,enteredPredicate:true,boundary:'runtime-state-check',completedPrefix:9,outcome:'ready'};
  return [{},{recoveryReadinessObservation:{schema:1,attempts:1,attemptsCapped:false,first:poll,last:poll,waitOutcome:'returned'},cleanupObservation:{schema:1,scope:'inner-harness-cleanup',operations:7,operationsCapped:false,failures:0,failuresCapped:false,current:null,last:{operation:7,boundary:'prepared-engine-cleanup',childSlot:null,childSlotCapped:false,outcome:'completed'},firstFailure:null,lastFailure:null,interiorFailuresOmitted:false}},
    {recoveryReadinessObservation:{schema:999,attempts:-1,boundary:'PRIVATE',extra:'PRIVATE'},cleanupObservation:['PRIVATE']},
    {recoveryReadinessObservation:'PRIVATE',cleanupObservation:null}];
}
test('raw recovery additions preserve exact baseline projection and cannot repair selected failures',()=>{
  const expected=JSON.stringify(api.projectBoundary(boundary(6))),decision=api.assessOriginal(boundary(6),runtime());
  for(const extra of recoveryOptionalFixtures()){
    const raw={...boundary(6),...extra};assert.equal(JSON.stringify(api.projectBoundary(raw)),expected);assert.deepEqual(api.assessOriginal(raw,runtime()),decision);
    raw.platform='darwin';assert.equal(api.assessOriginal(raw,runtime()).decision,'unknown');
    raw.platform='win32';raw.startup.push({stage:'headers',elapsedMs:2});assert.equal(api.assessOriginal(raw,runtime()).decision,'unknown');
    raw.cleanupErrors=[{name:'Error'}];assert.equal(api.assessOriginal(raw,runtime()).decision,'unknown');
  }
  const raw=boundary(6);Object.defineProperty(raw,'recoveryReadinessObservation',{get(){throw Error('must not read ignored data');}});assert.equal(JSON.stringify(api.projectBoundary(raw)),expected);
});
test('actual baseline guard and finalize ignore raw optional records while retaining byte parser and strict receipt boundaries',async t=>{
  const {spawn}=await import('node:child_process');const root=await mkdtemp(path.join(tmpdir(),'recovery-baseline-entry-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'receipt.json'),native=path.join(root,'native.json'),input=path.join(root,'input.json'),rt=path.join(root,'runtime.json');
  await writeFile(rt,JSON.stringify(runtime()));
  const launch=async(args)=>{const c=spawn(process.execPath,[fileURLToPath(new URL('./engine-baseline-probe.mjs',import.meta.url)),...args],{env:{},stdio:['ignore','pipe','pipe']});assert.equal((await api.collectChild(c,{timeoutMs:5000})).outcome,'ok');return JSON.parse(await readFile(output,'utf8'));};
  for(const extra of recoveryOptionalFixtures()){
    await writeFile(input,JSON.stringify({...boundary(6),...extra}));const guarded=await launch(['guard',output,input,rt]);
    assert.equal(guarded.stage,'awaiting-lawoss-build');assert.deepEqual(guarded.originalBoundary,api.projectBoundary(boundary(6)));assert.deepEqual(api.projectReceipt(guarded),guarded);
    const finalized=await launch(['finalize',output,native]);assert.deepEqual(finalized,guarded);assert.doesNotMatch(JSON.stringify(finalized),/recoveryReadinessObservation|cleanupObservation|PRIVATE/);
  }
  const bytes=JSON.stringify(boundary(6));
  for(const invalid of [Buffer.from(bytes.slice(0,-1)+',"cleanupObservation":{"x":1,"x":2}}'),Buffer.concat([Buffer.from(bytes.slice(0,-1)+',"cleanupObservation":"'),Buffer.from([255]),Buffer.from('"}')]),Buffer.from(bytes.slice(0,-1)+',"cleanupObservation":"'+'x'.repeat(256*1024)+'"}')]){
    await writeFile(input,invalid);const guarded=await launch(['guard',output,input,rt]);assert.equal(guarded.originalBoundary,null);assert.equal(guarded.stage,'original-input');
  }
  // Baseline intentionally has no whole-tree nonfinite walk.
  await writeFile(input,bytes.slice(0,-1)+',"cleanupObservation":1e999}');assert.equal((await launch(['guard',output,input,rt])).stage,'awaiting-lawoss-build');
  for(const mutate of [r=>r.cleanupObservation={},r=>r.originalBoundary.recoveryReadinessObservation={},r=>{r.rebuiltBoundary=structuredClone(r.originalBoundary);r.rebuiltBoundary.cleanupObservation={};}]){
    const r=baselineReceipt();mutate(r);assert.throws(()=>api.projectReceipt(r));await writeFile(output,JSON.stringify(r));await writeFile(native,'PRIVATE');
    const cleaned=await launch(['finalize',output,native]);assert.equal(cleaned.outcome,'unknown');assert.equal(cleaned.originalBoundary,null);assert.equal(cleaned.rebuiltBoundary,null);await assert.rejects(lstat(native),{code:'ENOENT'});
  }
});
