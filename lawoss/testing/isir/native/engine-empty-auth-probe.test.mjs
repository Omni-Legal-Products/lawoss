import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { collectChild, parseBoundedJson, privateEnvironment, nativeDiagnosticEnvironment } from './engine-baseline-probe.mjs';
import { prepareNativeEngineFiles, verifyNativeEngineFiles } from './engine-identity.mjs';
const api=await import('./engine-empty-auth-probe.mjs').catch(()=>({}));
const PIN='32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
const TARGET='opencode-x86_64-pc-windows-msvc.exe';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const entry=fileURLToPath(new URL('./engine-empty-auth-probe.mjs',import.meta.url));
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
async function root(t){const dir=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'empty-auth unit #%-')));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
function main(){return {schema:6,mode:'synthetic',platform:'win32',phase:'startup',recoveryStage:null,error:{name:'TimeoutError'},cleanupErrors:[],startup:[{stage:'request',elapsedMs:1}],startupDropped:0,
  requests:[{phase:'startup',endpoint:'engine.health',state:'headers',status:200,elapsedMs:691},{phase:'startup',endpoint:'engine.path',state:'failed',status:null,elapsedMs:88012,error:{name:'TimeoutError'}}],
  engineLog:{status:'available',clockWindowValid:true,fileChanged:false,unscannedBytesAtOpen:0,oversizedLineCount:0,partialLineCount:0,malformedCount:0,timestampOutlierCount:0,droppedEvents:0,lineLimitReached:false,eventLimitReached:false,events:['instance.create-observed','project.resolve-observed','bootstrap.enter-observed'].map(event=>({event,evidenceScope:'selected-directory'}))}};}
const runtime=()=>({schemaVersion:1,status:'observed',outcome:'observed',engineVersion:'1.18.29',engineSha256:PIN,bunVersion:'1.3.14',preloadObserved:true,elapsedMs:1374});
const context=()=>({CI:'true',GITHUB_ACTIONS:'true',GITHUB_SHA:'a'.repeat(40),LAWOSS_PR_HEAD:'b'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'});
const ack=()=>({schemaVersion:1,experiment:'original-windows-empty-auth-behavioral',producerApplied:true,synthetic:true,fullMatrix:true,ownedRoot:true,engineSha256:PIN});
function progressed(){const m=main();m.phase='configure-provider';delete m.error;m.startup=['request','headers','body','verified'].map((stage,i)=>({stage,elapsedMs:i}));m.requests[1]={phase:'startup',endpoint:'engine.path',state:'headers',status:200,elapsedMs:2};return m;}
function observedReceipt(){const r=api.newReceipt(context());r.eligibility='run';r.stage='identity-after';r.exit='child-error';r.inputs={mainSha256:hash('main'),runtimeSha256:hash('runtime')};r.originalBoundary=api.compactBoundary(main());r.producer={status:'applied',ackSha256:hash(JSON.stringify(ack()))};r.engine={...r.engine,beforeSha256:PIN,afterSha256:PIN,beforeManifestsSha256:hash('manifest'),afterManifestsSha256:hash('manifest'),beforeVersionVerified:true};r.lifecycle={closed:true,code:1,descendants:'unknown'};return r;}
test('default producer leaves exact env object untouched and performs no ack I/O',async()=>{assert.equal(typeof api.applyProducer,'function');const env={PATH:'owned',OPENCODE_CONFIG_CONTENT:'fixture'};const before={...env};assert.equal(await api.validateProbeOption([],{}),null);await api.applyProducer(env,null);assert.deepEqual(env,before);});
test('fixed producer adds only the literal and tiny child sees no inherited credentials',async t=>{assert.equal(typeof api.applyProducer,'function');const dir=await root(t),dest=path.join(dir,'producer-ack.private.json');const settings={CI:'true',GITHUB_ACTIONS:'true',LAWOSS_ISIR_NATIVE_DIAGNOSTICS:'1',LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE:path.join(dir,'native-diagnostics.private.json')};const option=await api.validateProbeOption(['--empty-auth-probe',dest],settings,'win32');const env=privateEnvironment(dir,path.dirname(process.execPath),{PATH:process.env.PATH,OPENCODE_AUTH_CONTENT:'HOSTILE',GITHUB_TOKEN:'PRIVATE'});const before={...env};await api.applyProducer(env,option,PIN);assert.deepEqual(env,{...before,OPENCODE_AUTH_CONTENT:'{}'});assert.deepEqual(await api.readAck(dest),{value:ack(),sha256:hash(await fs.readFile(dest))});const child=spawn(process.execPath,['-e',`process.stdout.write(process.env.OPENCODE_AUTH_CONTENT==='{}'&&!process.env.GITHUB_TOKEN&&!Object.values(process.env).includes(${JSON.stringify(dest)})?'yes':'no')`],{env,stdio:['ignore','pipe','pipe']});assert.deepEqual(await collectChild(child,{capture:true,limit:10}),{outcome:'ok',closed:true,code:0,text:'yes'});await assert.rejects(api.applyProducer(env,option,PIN));});
test('early admission rejects malformed options, external inputs, partial mode and unsafe destinations',async t=>{assert.equal(typeof api.validateProbeOption,'function');const dir=await root(t),dest=path.join(dir,'producer-ack.private.json');const env={CI:'true',GITHUB_ACTIONS:'true',LAWOSS_ISIR_NATIVE_DIAGNOSTICS:'1',LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE:path.join(dir,'native-diagnostics.private.json')};for(const args of [['--empty-auth-probe'],['--empty-auth-probe',dest,'--empty-auth-probe',dest],['--empty-auth-probe='+dest],['--debug-case-pair','--empty-auth-probe',dest],['--empty-auth-probe','relative'],['--empty-auth-probe',dest,'extra']])await assert.rejects(api.validateProbeOption(args,env,'win32'));for(const [key,value] of [['CI',''],['GITHUB_ACTIONS','false'],['LAWOSS_ISIR_NATIVE_DIAGNOSTICS','0'],['LAWOSS_ISIR_CORPUS',''],['LAWOSS_ISIR_NATIVE_ENGINE','fixture'],['LAWOSS_ISIR_NATIVE_ELECTRON','fixture']])await assert.rejects(api.validateProbeOption(['--empty-auth-probe',dest],{...env,[key]:value},'win32'));await assert.rejects(api.validateProbeOption(['--empty-auth-probe',dest],env,'darwin'));await assert.rejects(api.validateProbeOption(['--empty-auth-probe',path.join(dir,'other')],env,'win32'));await fs.writeFile(dest,'exists');await assert.rejects(api.validateProbeOption(['--empty-auth-probe',dest],env,'win32'));});
test('schema6 original admission rejects conflicting selected rows and retains only compact boundary',()=>{assert.equal(typeof api.assessInputs,'function');assert.equal(api.assessInputs(main(),runtime()).decision,'run');const complete=main();complete.phase='complete';delete complete.error;assert.equal(api.assessInputs(complete,null).decision,'not-needed');for(const mutate of [m=>m.schema=5,m=>m.requests.push({...m.requests[1],state:'headers',status:200}),m=>m.startupDropped=1,m=>m.cleanupErrors.push({name:'Error'})]){const m=main();mutate(m);assert.equal(api.assessInputs(m,runtime()).decision,'unknown');}for(const mutate of [v=>v.extra='PRIVATE',v=>v.engineSha256='0'.repeat(64),v=>v.elapsedMs=Infinity]){const r=runtime();mutate(r);assert.equal(api.assessInputs(main(),r).decision,'unknown');}assert.deepEqual(api.compactBoundary(main()),{phase:'startup',startupStage:'request',pathState:'failed',pathStatus:null,health200:true,cleanupErrorCount:0});});
test('closed receipt refuses extra nested fields, invalid flags, numbers and inconsistent stage proofs',()=>{assert.equal(typeof api.projectReceipt,'function');const r=api.newReceipt(context());assert.equal(Object.keys(api.projectReceipt(r)).length,18);for(const mutate of [v=>v.extra='PRIVATE',v=>v.delta.value='caller',v=>v.producer.status='applied',v=>v.inputs.mainSha256='A'.repeat(64),v=>v.engine.beforeVersionVerified=1,v=>v.lifecycle.code=-1,v=>v.lifecycle.code=4294967296,v=>v.runId=Infinity,v=>{v.runAttempt=2;v.eligibility='run';},v=>v.stage='native',v=>v.engine.afterVersionVerified=true,v=>v.lifecycle.descendants='closed']){const v=structuredClone(r);mutate(v);assert.throws(()=>api.projectReceipt(v));}});
test('altered classifications require ack, unchanged identity and positive selected verification',()=>{assert.equal(typeof api.classifyAltered,'function');const r=observedReceipt();assert.equal(api.classifyAltered(r,progressed()),'altered-progress');assert.equal(api.classifyAltered(r,main()),'altered-failure');const c=progressed();c.phase='complete';r.exit='ok';r.lifecycle.code=0;r.engine.afterVersionVerified=true;assert.equal(api.classifyAltered(r,c),'altered-complete');for(const mutate of [v=>v.producer.status='unknown',v=>v.engine.afterSha256=null,v=>v.engine.afterManifestsSha256=hash('changed'),v=>v.lifecycle.closed=false,v=>v.exit='timeout']){const v=structuredClone(r);mutate(v);assert.equal(api.classifyAltered(v,c),'unknown');}const noProof=progressed();noProof.startup=[];r.exit='child-error';r.lifecycle.code=1;r.engine.afterVersionVerified=false;assert.equal(api.classifyAltered(r,noProof),'altered-failure');});
test('bounded ack reader rejects unsafe files, duplicates, malformed UTF8, extras and excess bytes',async t=>{assert.equal(typeof api.readAck,'function');const dir=await root(t),file=path.join(dir,'ack');for(const bytes of [Buffer.from('{"schemaVersion":1,"schemaVersion":1}'),Buffer.from([0xff]),Buffer.from(JSON.stringify({...ack(),secret:'PRIVATE'})),Buffer.alloc(2049),Buffer.from(JSON.stringify({...ack(),ownedRoot:1})),Buffer.from(JSON.stringify(ack()).replace('"schemaVersion":1','"schemaVersion":1e999'))]){await fs.writeFile(file,bytes);await assert.rejects(api.readAck(file));}await fs.rm(file);await fs.symlink(path.join(dir,'missing'),file);await assert.rejects(api.readAck(file));});
test('guard binds actual checkout and first attempt before admission and CLI never performs heavy work on unsafe context',async t=>{assert.equal(typeof api.actualCheckout,'function');assert.equal(typeof api.guard,'function');const dir=await root(t),mainFile=path.join(dir,'main.json'),runtimeFile=path.join(dir,'runtime.json');await fs.writeFile(mainFile,JSON.stringify(main()));await fs.writeFile(runtimeFile,JSON.stringify(runtime()));const commit=await api.actualCheckout();assert.match(commit,/^[a-f0-9]{40}$/);for(const [index,patch] of [{GITHUB_RUN_ATTEMPT:'2'},{GITHUB_SHA:'0'.repeat(40)},{GITHUB_RUN_ID:'0'},{GITHUB_ACTIONS:'false'},{LAWOSS_PR_HEAD:'bad'}].entries()){const env={...process.env,...context(),GITHUB_SHA:commit,...patch};const file=path.join(dir,`guard-${index}.json`);const result=await api.guard(file,mainFile,runtimeFile,env);assert.equal(result.eligibility,'unknown');assert.equal(result.exit,'not-run');const observed=await collectChild(spawn(process.execPath,[entry,'run',file],{cwd:repo,env,stdio:['ignore','pipe','pipe']}),{capture:true,limit:1024});assert.equal(observed.outcome,'ok');assert.equal(observed.text,'');assert.equal(JSON.parse(await fs.readFile(file)).stage,'guard');}
  const env={...context(),GITHUB_SHA:commit};const f=path.join(dir,'current.json');const current=await api.guard(f,mainFile,runtimeFile,env);assert.equal(current.eligibility,process.platform==='win32'&&process.arch==='x64'?'run':'unknown');
  const complete=main();complete.phase='complete';delete complete.error;await fs.writeFile(mainFile,JSON.stringify(complete));const pass=await api.guard(path.join(dir,'pass.json'),mainFile,path.join(dir,'absent'),env);assert.equal(pass.eligibility,'not-needed');assert.equal(pass.inputs.runtimeSha256,null);assert.equal(pass.inputs.mainSha256,hash(await fs.readFile(mainFile)));
  await fs.writeFile(mainFile,'{"schema":6,"schema":6}');assert.equal((await api.guard(path.join(dir,'invalid.json'),mainFile,runtimeFile,env)).eligibility,'unknown');});
test('sole finalizer is exclusive, current-bound, closed and immutable after late private writes',async t=>{assert.equal(typeof api.finalize,'function');const dir=await root(t),privateFile=path.join(dir,'owner.private.json'),publicFile=path.join(dir,'engine-empty-auth-probe.json');const env={...context(),GITHUB_SHA:await api.actualCheckout()};const r=api.newReceipt(env);await fs.writeFile(privateFile,JSON.stringify(r));await api.finalize(privateFile,publicFile,env);const frozen=await fs.readFile(publicFile);assert.equal(Object.keys(JSON.parse(frozen)).length,18);await fs.writeFile(privateFile,'PRIVATE LATE');assert.deepEqual(await fs.readFile(publicFile),frozen);await assert.rejects(api.finalize(privateFile,publicFile,env));assert.equal((await fs.readdir(dir)).filter(x=>x==='engine-empty-auth-probe.json').length,1);
  for(const [index,payload] of ['bad',JSON.stringify({...r,checkoutCommit:'0'.repeat(40)}),JSON.stringify({...r,producer:{status:'applied',ackSha256:hash('fake')}})].entries()){const sub=path.join(dir,String(index));await fs.mkdir(sub);const output=path.join(sub,'engine-empty-auth-probe.json');await fs.writeFile(privateFile,payload);assert.deepEqual(await api.finalize(privateFile,output,env),api.newReceipt(env));assert.ok(!(await fs.readFile(output,'utf8')).includes('PRIVATE'));}});
test('real bundle helpers verify synthetic file identity but probe refuses all nonpinned bytes',async t=>{assert.equal(typeof api.preparePinnedIdentity,'function');const dir=await root(t),bundle=path.join(dir,'bundle');await fs.mkdir(bundle);const binary=path.join(bundle,TARGET);await fs.writeFile(binary,'synthetic-not-executable');const manifest=path.join(bundle,'versions.json');await fs.writeFile(manifest,JSON.stringify({opencode:{version:'1.18.29',sha256:hash('synthetic-not-executable')}}));const prepared=await prepareNativeEngineFiles({bundleDir:bundle,platform:'win32',arch:'x64'});assert.equal((await verifyNativeEngineFiles(prepared,binary)).hash,hash('synthetic-not-executable'));await assert.rejects(api.preparePinnedIdentity(bundle));await fs.writeFile(manifest,JSON.stringify({opencode:{version:'1.18.29',sha256:hash('synthetic-not-executable')},extra:true}));await assert.rejects(verifyNativeEngineFiles(prepared,binary));await fs.writeFile(binary,'changed');await assert.rejects(api.preparePinnedIdentity(bundle));});
test('fresh owner roots discard inherited auth, config and credentials',async t=>{assert.equal(typeof api.createPrivateRoot,'function');const first=await api.createPrivateRoot({PATH:process.env.PATH,GITHUB_TOKEN:'PRIVATE',OPENCODE_AUTH_CONTENT:'PRIVATE',NODE_OPTIONS:'PRIVATE'}),second=await api.createPrivateRoot({PATH:process.env.PATH});for(const item of [first,second])t.after(()=>fs.rm(item.root,{recursive:true,force:true}));assert.notEqual(first.root,second.root);assert.equal(first.env.GITHUB_ACTIONS,'true');assert.equal(first.env.CI,'true');assert.equal(first.env.OPENCODE_AUTH_CONTENT,undefined);assert.equal(first.env.GITHUB_TOKEN,undefined);assert.equal(first.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE,path.join(first.root,'native-diagnostics.private.json'));assert.equal(await fs.readFile(first.env.NPM_CONFIG_USERCONFIG,'utf8'),'');assert.equal(await fs.readFile(first.env.GIT_CONFIG_GLOBAL,'utf8'),'');});
test('actual collector children freeze close, error, timeout and bounded-output results without retaining raw text',async()=>{for(const [source,want,options] of [['process.stdout.write("PRIVATE");','ok',{}],['process.exitCode=7','child-error',{}],['setInterval(()=>{},1000)','timeout',{timeoutMs:100,drainMs:1000}],['process.stdout.write("x".repeat(10000));setInterval(()=>{},1000)','output-limit',{limit:10,drainMs:1000}]]){const result=await collectChild(spawn(process.execPath,['-e',source],{stdio:['ignore','pipe','pipe']}),options);assert.equal(result.outcome,want);assert.equal(result.closed,true);assert.equal(result.text,undefined);assert.ok(!JSON.stringify(result).includes('PRIVATE'));}const failed=await collectChild(spawn(path.join(tmpdir(),'absent-empty-auth-executable'),[],{stdio:['ignore','pipe','pipe']}),{timeoutMs:200,drainMs:100});assert.equal(failed.outcome,'child-error');assert.equal(failed.closed,true);});
test('inert import is quiet from paths containing spaces hash and percent',async t=>{const dir=await root(t),script=path.join(dir,'quiet #%.mjs');await fs.writeFile(script,`await import(${JSON.stringify(pathToFileURL(entry).href)});`);const result=await collectChild(spawn(process.execPath,[script],{stdio:['ignore','pipe','pipe']}),{capture:true,limit:10});assert.deepEqual(result,{outcome:'ok',closed:true,code:0,text:''});});
function assertIntegratedHarness(source,startup) {
  const added=[`import { validateProbeOption, applyProducer } from "../lawoss/testing/isir/native/engine-empty-auth-probe.mjs";\n`,`const emptyAuthProbe = await validateProbeOption(process.argv.slice(2));\n`,`await applyProducer(env, emptyAuthProbe, preparedEngine.expectedHash);\n`];
  for(const line of added)assert.equal(source.split(line).length,2);
  assert.ok(source.indexOf(added[1])<source.indexOf('const electron ='));
  assert.ok(source.indexOf(added[1])<source.indexOf('probeNativeEngineVersion(externalEngine)'));
  assert.ok(source.indexOf('probeNativeEngineVersion(engine)')<source.indexOf(added[2]));
  assert.ok(source.indexOf('Object.assign(env, {')<source.indexOf(added[2]));
  assert.ok(source.indexOf(added[2])<source.indexOf('const launch ='));
  assert.ok(source.includes('spawn(command, args, { cwd, env, detached:'));
  assert.match(source,/await awaitNativeStartup\(\{engineRequest,request:nativeFetch,serverInfo,workspace:workspaces\[0\]/);
  assert.ok(!/liveEngine\.(?:opencodeUsername|opencodePassword)/.test(source));
  assert.ok(startup.includes('await engineRequest.ready();'));
  assert.ok(startup.indexOf('await engineRequest.ready();')<startup.indexOf('deadline = Date.now() + 90_000'));
  assert.ok(startup.indexOf('deadline = Date.now() + 90_000')<startup.indexOf('const receipt = await awaitDirectoryInstance'));
  assert.match(startup,/await response\.json\(\)/);
  assert.ok(source.lastIndexOf('verifyNativeEngineRuntime')<source.indexOf('diagnostics.phase("complete")'));
}
test('integrated harness keeps early producer admission and cold-to-selected scope proof',async()=>{
  const source=await fs.readFile(path.join(repo,'scripts/test-isir-native.mjs'),'utf8');
  const startup=await fs.readFile(path.join(repo,'lawoss/testing/isir/native/startup-readiness.mjs'),'utf8');
  assertIntegratedHarness(source,startup);
  assert.throws(()=>assertIntegratedHarness(source.replace('await applyProducer(env, emptyAuthProbe, preparedEngine.expectedHash);',''),startup));
  assert.throws(()=>assertIntegratedHarness(source.replace('await awaitNativeStartup({engineRequest','await awaitNativeStartup({wrongRequest'),startup));
  assert.throws(()=>assertIntegratedHarness(source,startup.replace('await engineRequest.ready();','')));
});
function assertFrozenAdmissions(source) {
  for(const name of ['windows-engine-baseline','windows-engine-compile-monitor','windows-engine-empty-auth-probe']){
    const start=source.indexOf('  '+name+':\n');assert.ok(start>=0);
    const rest=source.slice(start),next=rest.slice(3).search(/^  [a-z][a-z-]*:/m);
    const block=next<0?rest:rest.slice(0,next+3);
    assert.match(block,/^    if: false$/m);
  }
  const start=source.indexOf('  package-smoke:\n'),end=source.indexOf('  windows-engine-baseline:\n');
  const normal=source.slice(start,end);
  assert.ok(!/^    if: false$/m.test(normal));
  assert.ok(normal.includes('pnpm test:isir:native'));
}
test('frozen diagnostic jobs cannot automatically renew while normal native packaging stays active',async()=>{
  const source=await fs.readFile(path.join(repo,'.github/workflows/ci-desktop-packaging.yml'),'utf8');
  assertFrozenAdmissions(source);
  assert.throws(()=>assertFrozenAdmissions(source.replace('    if: false','    if: true')));
  const added=source.slice(source.indexOf('  windows-engine-empty-auth-probe:\n'));
  assert.ok(added.includes('needs: [package-smoke]'));
  assert.ok(added.includes('node-version: 24.21.0'));
  assert.ok(added.indexOf('node --test ')<added.indexOf('actions/download-artifact@'));
  assert.equal((added.match(/build:electron/g)??[]).length,1);
  assert.ok(!/electron-builder|engine-baseline-probe|engine-compile-monitor/.test(added));
  assert.ok(added.includes('if: always() && steps.empty-auth-finalize.outcome'));
  assert.ok(added.includes('name: isir-engine-empty-auth-probe-windows-2022'));
  assert.ok(added.includes('retention-days: 7'));
});
test('complete phase proves final version even if bounded request retention has evicted initial HTTP rows',()=>{const r=observedReceipt(),m=progressed();m.phase='complete';m.requests=[];r.exit='ok';r.lifecycle.code=0;r.engine.afterVersionVerified=true;assert.equal(api.classifyAltered(r,m),'altered-complete');r.stage='complete';r.outcome='altered-complete';r.alteredBoundary=api.compactBoundary(m);assert.doesNotThrow(()=>api.projectReceipt(r));});
test('receipt rejects forged origin, incomplete stages and contradictory collector exit codes',()=>{const r=observedReceipt();for(const mutate of [v=>v.originalBoundary.phase='complete',v=>v.originalBoundary.health200=false,v=>v.originalBoundary.startupStage='verified',v=>v.exit='ok',v=>{v.exit='child-unclosed';},v=>{v.stage='awaiting-lawoss-build';},v=>{v.engine.afterVersionVerified=true;},v=>{v.producer.status='not-run';v.producer.ackSha256=null;},v=>{v.exit='not-run';}]){const v=structuredClone(r);mutate(v);assert.throws(()=>api.projectReceipt(v));}});
test('timeout and unclosed outcomes cannot be promoted by late bounded child evidence',()=>{const r=observedReceipt(),m=progressed();r.exit='timeout';r.lifecycle.code=0;assert.equal(api.classifyAltered(r,m),'unknown');const unclosed=structuredClone(r);unclosed.exit='child-unclosed';unclosed.lifecycle.closed=false;unclosed.lifecycle.code=null;unclosed.stage='native';unclosed.engine.afterSha256=null;unclosed.engine.afterManifestsSha256=null;unclosed.producer={status:'unknown',ackSha256:null};unclosed.engine.beforeVersionVerified=false;unclosed.alteredBoundary=null;assert.doesNotThrow(()=>api.projectReceipt(unclosed));assert.equal(api.classifyAltered(unclosed,m),'unknown');});
function assertManagedCredentialBoundary(managed) {
  assert.match(managed,/const env = withoutServerCredentials\(\{\s+\.\.\.process.env,\s+\.\.\.features,\s+\.\.\.options.env,\s+\.\.\.lawossEnv,/);
  assert.match(managed,/Object.entries\(withoutServerCredentials\(\{\s+\.\.\.features,/);
  assert.match(managed,/spawn\(command, args, \{\s+cwd: options.cwd,\s+env,/);
}
test('source propagation retains reserved filters and current-dev credential stripping',async()=>{
  const runtime=await fs.readFile(path.join(repo,'apps/desktop/electron/runtime.mjs'),'utf8');
  const managed=await fs.readFile(path.join(repo,'apps/server/src/managed-opencode.ts'),'utf8');
  const network=await fs.readFile(path.join(repo,'apps/server/src/lawoss/engine-network.ts'),'utf8');
  assert.ok(runtime.includes('const USER_ENV_RESERVED_PREFIXES = ["LEGALWORK_", "OPENCODE_"];'));
  assert.ok(runtime.includes('if (USER_ENV_RESERVED_PREFIXES.some((p) => key.startsWith(p))) continue;'));
  assert.match(runtime,/\.\.\.loadUserEnvFile\(\),\s+\.\.\.process\.env,/);
  assert.ok(runtime.includes('const serverEnv = await buildChildEnv({});\n    Object.assign(process.env, serverEnv);'));
  assertManagedCredentialBoundary(managed);
  assert.throws(()=>assertManagedCredentialBoundary(managed.replace('const env = withoutServerCredentials({','const env = ({')));
  assert.ok(!network.includes('OPENCODE_AUTH_CONTENT'));
});
test('closed publication CLI rejects wrong filename with fixed nonraw error and missing private receipt publishes unknown',async t=>{const dir=await root(t),privateFile=path.join(dir,'missing'),env={...process.env,...context(),GITHUB_SHA:await api.actualCheckout()};const bad=await collectChild(spawn(process.execPath,[entry,'finalize',privateFile,path.join(dir,'PRIVATE-wrong')],{env,stdio:['ignore','pipe','pipe']}),{limit:1024});assert.equal(bad.outcome,'child-error');assert.equal(bad.text,undefined);const good=await collectChild(spawn(process.execPath,[entry,'finalize',privateFile,path.join(dir,'engine-empty-auth-probe.json')],{env,stdio:['ignore','pipe','pipe']}),{capture:true,limit:1024});assert.deepEqual(good,{outcome:'ok',closed:true,code:0,text:''});const result=JSON.parse(await fs.readFile(path.join(dir,'engine-empty-auth-probe.json')));assert.equal(result.outcome,'unknown');assert.equal(result.exit,'not-run');assert.ok(!JSON.stringify(result).includes(dir));});
test('owner finalizer maps oversized, duplicate, nonfinite, malformed and symlink receipts to clean unknown',async t=>{const dir=await root(t),env={...context(),GITHUB_SHA:await api.actualCheckout()},r=api.newReceipt(env);const poisoned=[Buffer.alloc(65537),Buffer.from([0xff]),Buffer.from(JSON.stringify(r).replace('"schemaVersion":1','"schemaVersion":1,"schemaVersion":1')),Buffer.from(JSON.stringify(r).replace('"runId":123','"runId":1e999')),Buffer.from(JSON.stringify({...r,delta:{...r.delta,private:'PRIVATE'}}))];for(const [i,payload] of poisoned.entries()){const sub=path.join(dir,String(i));await fs.mkdir(sub);const file=path.join(sub,'owner.private.json');await fs.writeFile(file,payload);assert.deepEqual(await api.finalize(file,path.join(sub,'engine-empty-auth-probe.json'),env),r);}const linked=path.join(dir,'linked');await fs.symlink(path.join(dir,'0','owner.private.json'),linked);assert.deepEqual(await api.finalize(linked,path.join(dir,'engine-empty-auth-probe.json'),env),r);});
test('raw artifact limits and unsafe paths close admission before any build',async t=>{const dir=await root(t),env={...context(),GITHUB_SHA:await api.actualCheckout()},mainFile=path.join(dir,'main'),runtimeFile=path.join(dir,'runtime');const cases=[[Buffer.alloc(256*1024+1),Buffer.from(JSON.stringify(runtime()))],[Buffer.from(JSON.stringify(main())),Buffer.alloc(4097)],[Buffer.from(JSON.stringify({...main(),unselected:Infinity}).replace('"unselected":null','"unselected":1e999')),Buffer.from(JSON.stringify(runtime()))],[Buffer.from([0xff]),Buffer.from(JSON.stringify(runtime()))]];for(const [i,[m,r]] of cases.entries()){await fs.writeFile(mainFile,m);await fs.writeFile(runtimeFile,r);assert.equal((await api.guard(path.join(dir,`owner-${i}`),mainFile,runtimeFile,env)).eligibility,'unknown');}await fs.rm(mainFile);await fs.symlink(runtimeFile,mainFile);assert.equal((await api.guard(path.join(dir,'owner-linked'),mainFile,runtimeFile,env)).eligibility,'unknown');});
test('guard cannot publish through the reserved sole-finalizer public filename',async t=>{const dir=await root(t);await assert.rejects(api.guard(path.join(dir,'engine-empty-auth-probe.json'),path.join(dir,'missing'),path.join(dir,'missing'),context()));await assert.rejects(fs.lstat(path.join(dir,'engine-empty-auth-probe.json')),{code:'ENOENT'});});
const fixturePause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function fixtureDeadline(promise,label,ms=5000){
  let timer;
  try{return await Promise.race([promise,new Promise((_,reject)=>{timer=setTimeout(()=>reject(new Error(label)),ms);})]);}
  finally{clearTimeout(timer);}
}
async function inheritedPipePublication(t,driverDelayMs=0){
  // This root has one combined cleanup; root(t)'s unconditional removal would
  // race a still-running writer on setup/assertion failure.
  const dir=await fs.mkdtemp(path.join(await fs.realpath(tmpdir()),'empty-auth pipe #%-'));
  const privateFile=path.join(dir,'owner.private.json'),releaseFile=path.join(dir,'release'),pidFile=path.join(dir,'writer.pid');
  let child,writerPid,parentExited=false,childClosed=false,stdoutClosed=false,streamError=false,primary;
  const cleanup=async()=>{
    if(!child){await fs.rm(dir,{recursive:true,force:true});return;}
    // Release only this prestarted fixture, including when startup/assertions fail.
    await fs.writeFile(releaseFile,'release',{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
    const deadline=Date.now()+12000;
    while(Date.now()<deadline){
      if(writerPid===undefined){
        try{
          const bytes=await fs.readFile(pidFile);
          if(bytes.length<=12&&/^[1-9][0-9]*\n$/.test(bytes.toString()))writerPid=Number(bytes.toString().trim());
        }catch(error){if(error.code!=='ENOENT')throw error;}
      }
      let writerGone=false;
      if(Number.isSafeInteger(writerPid)&&writerPid>1){
        // Read-only disappearance observation, never PID-based signaling. A
        // live/reused/ambiguous PID retains the root and fails conservatively.
        try{process.kill(writerPid,0);}catch(error){if(error.code==='ESRCH')writerGone=true;else throw error;}
      }
      if(childClosed&&((parentExited&&writerGone)||child.pid===undefined)){
        await fs.rm(dir,{recursive:true,force:true});return;
      }
      await fixturePause(25);
    }
    throw new Error('fixture termination unproven; private root retained');
  };
  try{
    const env={...context(),GITHUB_SHA:await api.actualCheckout()},receipt=api.newReceipt(env);
    const original=Buffer.from(JSON.stringify(receipt));
    await fs.writeFile(privateFile,original);
    const writer=`
      const fs=require('node:fs');
      const watchdog=setTimeout(()=>process.exit(2),10000);
      const gate=setInterval(()=>{
        if(!fs.existsSync(process.argv[2]))return;
        fs.writeFileSync(process.argv[1],'PRIVATE LATE');
        clearInterval(gate);clearTimeout(watchdog);
      },10);
      process.stdout.write('WRITER_READY:'+process.pid+'\\n');
    `;
    const parent=`
      const fs=require('node:fs'),{spawn}=require('node:child_process');
      const watchdog=setTimeout(()=>process.exit(2),10000);
      const child=spawn(process.execPath,['-e',${JSON.stringify(writer)},process.argv[1],process.argv[2]],{detached:process.platform==='win32',stdio:['ignore',process.stdout,process.stderr]});
      child.once('error',()=>process.exit(3));
      child.once('spawn',()=>{
        fs.writeFileSync(process.argv[3],String(child.pid)+'\\n',{flag:'wx'});
        child.unref();clearTimeout(watchdog);
      });
    `;
    let readyResolve,readyReject,exitResolve,exitReject,readyBytes=Buffer.alloc(0);
    const ready=new Promise((resolve,reject)=>{readyResolve=resolve;readyReject=reject;});
    const exited=new Promise((resolve,reject)=>{exitResolve=resolve;exitReject=reject;});
    // Register observations synchronously before launch can deliver any events.
    ready.catch(()=>{});exited.catch(()=>{});
    child=spawn(process.execPath,['-e',parent,privateFile,releaseFile,pidFile],{stdio:['ignore','pipe','pipe']});
    const observeReady=chunk=>{
      if(readyBytes.length+chunk.length>64){readyReject(new Error('fixture ready record exceeds bound'));return;}
      readyBytes=Buffer.concat([readyBytes,chunk]);
      if(!readyBytes.includes(10))return;
      const match=/^WRITER_READY:([1-9][0-9]*)\n$/.exec(readyBytes.toString());
      if(!match||!Number.isSafeInteger(Number(match[1]))||Number(match[1])<=1){readyReject(new Error('invalid fixture ready record'));return;}
      writerPid=Number(match[1]);readyResolve();
    };
    child.stdout.on('data',observeReady);
    child.stdout.once('close',()=>{stdoutClosed=true;readyReject(new Error('fixture pipe closed before ready'));});
    for(const stream of [child.stdout,child.stderr])stream.on('error',()=>{streamError=true;readyReject(new Error('fixture stream error'));});
    child.once('error',()=>{readyReject(new Error('fixture parent launch failed'));exitReject(new Error('fixture parent launch failed'));});
    child.once('exit',(code,signal)=>{parentExited=true;exitResolve({code,signal});});
    child.once('close',()=>{childClosed=true;});
    const [,parentExit]=await fixtureDeadline(Promise.all([ready,exited]),'fixture startup timeout');
    assert.deepEqual(parentExit,{code:0,signal:null});
    assert.equal(await fs.readFile(pidFile,'utf8'),`${writerPid}\n`);
    child.stdout.off('data',observeReady);
    if(driverDelayMs)Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,driverDelayMs);
    // Exit belongs to the direct parent; ready belongs to its real writer.
    // Its inherited read stream must still be held before the real collector.
    assert.equal(childClosed,false);assert.equal(stdoutClosed,false);
    assert.equal(child.stdout.destroyed,false);assert.equal(child.stdout.readableEnded,false);assert.equal(streamError,false);
    const result=await collectChild(child,{timeoutMs:50,drainMs:50});
    assert.deepEqual(result,{outcome:'child-unclosed',closed:false,code:null});
    const output=path.join(dir,'engine-empty-auth-probe.json');
    await api.finalize(privateFile,output,env);
    const frozen=await fs.readFile(output);
    assert.deepEqual(await fs.readFile(privateFile),original);
    await assert.rejects(fs.lstat(releaseFile),{code:'ENOENT'});
    await fs.writeFile(releaseFile,'release',{flag:'wx'});
    const writeDeadline=Date.now()+5000;
    while((await fs.readFile(privateFile,'utf8'))!=='PRIVATE LATE'&&Date.now()<writeDeadline)await fixturePause(25);
    assert.equal(await fs.readFile(privateFile,'utf8'),'PRIVATE LATE');
    assert.deepEqual(await fs.readFile(output),frozen);
    assert.deepEqual(result,{outcome:'child-unclosed',closed:false,code:null});
  }catch(error){primary=error;}
  try{await cleanup();}catch(error){if(!primary)throw error;t.diagnostic('fixture cleanup failed; private root retained');}
  if(primary)throw primary;
}
test('actual inherited pipe stays unclosed and late private writer cannot alter sole publication',async t=>{await inheritedPipePublication(t);});
test('inherited pipe publication stays unclosed after a 650ms delayed driver',async t=>{await inheritedPipePublication(t,650);});
test('receipt cannot move closed evidence back into pre-native stages or hide it in unknown admission',()=>{for(const mutate of [v=>v.stage='native',v=>{v.eligibility='unknown';v.stage='guard';},v=>{v.stage='native';v.lifecycle={closed:false,code:null,descendants:'unknown'};v.exit='child-unclosed';v.engine.afterSha256=null;v.engine.afterManifestsSha256=null;}]){const r=observedReceipt();mutate(r);assert.throws(()=>api.projectReceipt(r));}const unknown=api.newReceipt(context());unknown.inputs.mainSha256=hash('unbound');assert.throws(()=>api.projectReceipt(unknown));});
const reservedAliases = [
  'ENGINE-EMPTY-AUTH-PROBE.JSON',
  'Engine-Empty-Auth-Probe.Json',
  'engine-empty-auth-probe.json.',
  'engine-empty-auth-probe.json ',
  'EnGine-empty-auth-probe.JSON. . ',
];
for (const alias of reservedAliases) {
  test(`guard rejects Windows reserved public alias ${JSON.stringify(alias)} before creation`, async t => {
    const dir = await root(t), file = path.join(dir, alias);
    await assert.rejects(api.guard(file, path.join(dir, 'missing-main'), path.join(dir, 'missing-runtime'), context()));
    await assert.rejects(fs.lstat(file), { code: 'ENOENT' });
    assert.deepEqual(await fs.readdir(dir), []);
  });
}
test('guard alias refusal preserves existing sole-finalizer public bytes', async t => {
  const dir = await root(t), publicFile = path.join(dir, 'engine-empty-auth-probe.json');
  const bytes = Buffer.from('existing public snapshot');
  await fs.writeFile(publicFile, bytes, { flag: 'wx' });
  for (const alias of reservedAliases) {
    await assert.rejects(
      api.guard(path.join(dir, alias), path.join(dir, 'missing-main'), path.join(dir, 'missing-runtime'), context()),
      { code: 'ERR_ASSERTION' },
    );
    assert.deepEqual(await fs.readFile(publicFile), bytes);
    assert.deepEqual(await fs.readdir(dir), ['engine-empty-auth-probe.json']);
  }
});
test('same normalized reserved-name check precedes both private create and update branches in source', async () => {
  // The pinned Windows run gate remains intact: this is source-order evidence,
  // not a claim that the internal update branch executed on the current host.
  const source = await fs.readFile(entry, 'utf8');
  const start = source.indexOf('async function writePrivate(file,value,exclusive=false) {');
  assert.ok(start >= 0);
  const end = source.indexOf('\nasync function boundReceipt(', start);
  assert.ok(end > start);
  const writer = source.slice(start, end);
  const check = "assert.notEqual(path.basename(file).replace(/[. ]+$/,'').toLowerCase(),'engine-empty-auth-probe.json');";
  assert.equal(writer.split(check).length, 2);
  for (const operation of ['await canonicalParent(file)', 'if(exclusive)', 'await fs.writeFile(file', 'await fs.open(file', 'await handle.truncate(0)']) {
    assert.ok(writer.indexOf(check) < writer.indexOf(operation), operation);
  }
});

async function workflowInputs(t, value=main()) {
  const nativeRoot=await root(t);
  await fs.mkdir(path.join(nativeRoot,'empty-auth-input','native'),{recursive:true});
  await fs.mkdir(path.join(nativeRoot,'empty-auth-input','runtime'),{recursive:true});
  const mainBytes=Buffer.from(JSON.stringify(value)),runtimeBytes=Buffer.from(JSON.stringify(runtime()));
  await fs.writeFile(path.join(nativeRoot,'empty-auth-input','native','isir-native-diagnostics.json'),mainBytes);
  await fs.writeFile(path.join(nativeRoot,'empty-auth-input','runtime','isir-engine-runtime-smoke.json'),runtimeBytes);
  return {
    nativeRoot,mainBytes,runtimeBytes,
    mainFile:`${nativeRoot}/empty-auth-input/native/isir-native-diagnostics.json`,
    runtimeFile:`${nativeRoot}/empty-auth-input/runtime/isir-engine-runtime-smoke.json`,
  };
}
test('actual workflow-style native and runtime input paths preserve exact bounded bytes',async t=>{
  const input=await workflowInputs(t);
  if(process.platform==='win32') {
    assert.ok(input.nativeRoot.includes(path.sep));
    assert.ok(input.mainFile.includes('/')&&input.runtimeFile.includes('/'));
  }
  assert.deepEqual(await api.readBounded(input.mainFile,256*1024),input.mainBytes);
  assert.deepEqual(await api.readBounded(input.runtimeFile,4096),input.runtimeBytes);
});
test('actual workflow-style complete guard binds current checkout and the same main file hash',async t=>{
  const complete=main();complete.phase='complete';delete complete.error;
  const input=await workflowInputs(t,complete),env={...context(),GITHUB_SHA:await api.actualCheckout()};
  const privateFile=`${input.nativeRoot}/empty-auth-owner.private.json`;
  const receipt=await api.guard(privateFile,input.mainFile,input.runtimeFile,env);
  assert.equal(receipt.eligibility,'not-needed');assert.equal(receipt.outcome,'not-needed');
  assert.equal(receipt.checkoutCommit,env.GITHUB_SHA);assert.equal(receipt.prHeadCommit,env.LAWOSS_PR_HEAD);
  assert.deepEqual(receipt.inputs,{mainSha256:hash(input.mainBytes),runtimeSha256:null});
  assert.equal(receipt.originalBoundary.phase,'complete');assert.equal(receipt.stage,'guard');
  assert.deepEqual(JSON.parse(await fs.readFile(privateFile,'utf8')),receipt);
});
test('actual workflow-style startup guard preserves the original Windows x64 run admission',async t=>{
  const input=await workflowInputs(t),env={...context(),GITHUB_SHA:await api.actualCheckout()};
  const receipt=await api.guard(`${input.nativeRoot}/empty-auth-owner.private.json`,input.mainFile,input.runtimeFile,env);
  if(process.platform==='win32'&&process.arch==='x64') {
    assert.equal(receipt.eligibility,'run');assert.equal(receipt.stage,'awaiting-lawoss-build');
    assert.deepEqual(receipt.inputs,{mainSha256:hash(input.mainBytes),runtimeSha256:hash(input.runtimeBytes)});
    assert.deepEqual(receipt.originalBoundary,api.compactBoundary(main()));
  } else {
    assert.equal(receipt.eligibility,'unknown');assert.equal(receipt.stage,'guard');
    assert.deepEqual(receipt.inputs,{mainSha256:null,runtimeSha256:null});
  }
});
test('actual workflow-style input paths still reject dot-parent spellings',async t=>{
  const input=await workflowInputs(t);
  for(const parent of ['empty-auth-input/./native','empty-auth-input/native/../native']) {
    const file=`${input.nativeRoot}/${parent}/isir-native-diagnostics.json`;
    assert.deepEqual(await fs.readFile(file),input.mainBytes);
    await assert.rejects(api.readBounded(file,256*1024),{code:'ERR_ASSERTION'});
  }
});
test('actual workflow-style input paths still reject symlink or junction parents and ancestors',async t=>{
  const input=await workflowInputs(t),linked=path.join(input.nativeRoot,'linked-input');
  await fs.writeFile(path.join(input.nativeRoot,'empty-auth-input','parent.json'),input.mainBytes);
  await fs.symlink(path.join(input.nativeRoot,'empty-auth-input'),linked,process.platform==='win32'?'junction':'dir');
  for(const suffix of ['parent.json','native/isir-native-diagnostics.json']) {
    const file=`${input.nativeRoot}/linked-input/${suffix}`;
    assert.deepEqual(await fs.readFile(file),input.mainBytes);
    await assert.rejects(api.readBounded(file,256*1024),{code:'ERR_ASSERTION'});
  }
});
