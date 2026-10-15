import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, lstat, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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
  const env=api.privateEnvironment(root,tools,{PATH:'/bin',GITHUB_TOKEN:'PRIVATE',GH_TOKEN:'PRIVATE',OPENCODE_RELEASE:'0',OPENCODE_CONFIG:'PRIVATE',NODE_OPTIONS:'PRIVATE',npm_config_userconfig:'PRIVATE'});
  assert.equal(env.HOME,path.join(root,'home'));
  assert.equal(env.PATH,`${tools}${path.delimiter}/bin`);
  for(const key of ['GITHUB_TOKEN','GH_TOKEN','OPENCODE_RELEASE','OPENCODE_CONFIG','NODE_OPTIONS','npm_config_userconfig']) assert.equal(env[key],undefined);
  assert.equal(env.NPM_CONFIG_USERCONFIG,path.join(root,'empty.npmrc'));
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
test('final publication reconstructs closed receipts and rejects forged or oversized selected data',()=>{
  const value={schemaVersion:1,experiment:'unmodified-windows-baseline',outcome:'unknown',stage:'source-checkout',exit:'child-unclosed',
    sourceCommit:'16747470f976aca3d362ad730bcd3fe82ecc2c9a',checkoutCommit:'a'.repeat(40),prHeadCommit:'b'.repeat(40),nodeVersion:'24.21.0',
    originalBoundary:api.projectBoundary(boundary()),secret:'PRIVATE',rebuiltBoundary:null};
  const projected=api.projectReceipt(value);
  assert.ok(!JSON.stringify(projected).includes('PRIVATE'));assert.equal(projected.exit,'child-unclosed');assert.equal(projected.checkoutCommit,'a'.repeat(40));
  value.originalBoundary.engineLog.selected=['PRIVATE'];assert.throws(()=>api.projectReceipt(value));
  value.originalBoundary=null;value.stage='PRIVATE';assert.throws(()=>api.projectReceipt(value));
});
test('real CLI missing-artifact guard skips heavy work and finalizer removes unapproved native bytes',async t=>{
  const {spawn}=await import('node:child_process');
  const root=await mkdtemp(path.join(tmpdir(),'lawoss-baseline-cli-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const output=path.join(root,'receipt.json'),native=path.join(root,'native.json'),githubOutput=path.join(root,'github-output');
  const launch=async(args)=>{
    const c=spawn(process.execPath,[new URL('./engine-baseline-probe.mjs',import.meta.url).pathname,...args],{env:{GITHUB_OUTPUT:githubOutput},stdio:['ignore','pipe','pipe']});
    const result=await api.collectChild(c,{timeoutMs:5000});assert.equal(result.outcome,'ok');
  };
  await launch(['guard',output,path.join(root,'missing-main'),path.join(root,'missing-runtime')]);
  assert.equal((await readFile(githubOutput,'utf8')).trim(),'run=false');
  assert.equal(JSON.parse(await readFile(output,'utf8')).outcome,'unknown');
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
    const c=spawn(process.execPath,[new URL('./engine-baseline-probe.mjs',import.meta.url).pathname,...args],{env:{},stdio:['ignore','pipe','pipe']});
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
