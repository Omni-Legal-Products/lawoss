import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBoundedJson, projectReceipt, privateEnvironment, verifyInputs, collectChild, installPackageAllowlist, projectInstallObservation, projectBuildObservation } from './engine-baseline-probe.mjs';
import { EXPERIMENT, SOURCE, PREFIX, PRIVATE_LIMIT, CONFIG_NAME, MANIFEST_NAME, CODES, sha, bounded, keys, validateManifest, prepareSourceMap } from './engine-compile-monitor-preload.mjs';
export { privateEnvironment } from './engine-baseline-probe.mjs';

const HASH=/^[a-f0-9]{64}$/,COMMIT=/^[a-f0-9]{40}$/;
const INPUT_HASH='4156e898aaba4af4188b4a28fd4590ea859c83ac07c5c89212a75d4f6c091f0a';
const LOCK_HASH='e4a33f0dce76bd625ceef88b2fe44cfa75d0653a3ccba0c7066ac558896ff239';
const BUN_HASH='9005d0d585d80425e9b715690de3e614651124c94458ef3d3a302ca1a6d3d813';
const ARCHIVE_HASH='538f9c846355d9e847b2671bc00c47da4229a0befb24df3282b739770f3b475f';
const ORIGINAL_HASH='32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
const INPUTS={
  'package.json':'d05714a1572795feca1cc2723ec12b7b341b0a96a82031a8ef40d4af0e120acf',
  'bun.lock':LOCK_HASH,
  'packages/opencode/script/build.ts':'c98c068580faac0ebcade9a1179827a24bd3f3102e6c08fef637a0636fa9f19d',
  'packages/opencode/script/generate.ts':'6351777e5e8bf0123f3ef31bc4fd13912ea7800249f130cb4893d8c9e8a16c0a',
  '.github/actions/setup-bun/action.yml':'64f62445839788466383af1313b395785594eed6ae47dcfa4b293c8d8cb65f00',
  'packages/script/src/index.ts':'6f6235de4226d93d55276b7caeee846ccd15ea00eca75a8308680f13dc1ef38a',
};
const STAGES=['guard','toolchain','capability','source-checkout','models-freeze','upstream-install','manifest','monitored-build','post-inputs','complete'];
const EXITS=['not-run','ok','child-error','child-unclosed','output-limit','timeout','invalid-output','validation-failed'];
const hashKeys=['baselineReceiptSha256','baselineModelsSha256','baselineToolchainSha256','toolchainArchiveSha256','toolchainSha256','sourceInputsSha256','lockSha256','modelsSha256','preloadSha256','configSha256','manifestSha256'];
const finite=(value,options)=>assert.ok(options.includes(value));
const isHash=v=>typeof v==='string'&&HASH.test(v);
const isCommit=v=>typeof v==='string'&&COMMIT.test(v);
const deepFreeze=value=>{if(value&&typeof value==='object'){Object.values(value).forEach(deepFreeze);Object.freeze(value);}return value;};
const cleanClose=(value,code)=>value!==null&&value.spawnObserved&&value.closeObserved&&value.exitCode===code&&value.signal===null&&value.childErrorCode===null&&!value.pipeFailure;
function projectError(value,fileCount) {
  keys(value,['errorClass','code','position']);finite(value.errorClass,['AggregateError','BuildMessage','ResolveMessage','Error','other','uninspectable']);finite(value.code,['absent','other','uninspectable',...CODES]);
  const p=value.position;keys(p,['status','sourceRole','sourceIndex','line','column','length','offset']);finite(p.status,['present','absent','invalid','uninspectable']);finite(p.sourceRole,['build-script','workspace','unknown']);
  assert.ok(p.sourceIndex===null||bounded(p.sourceIndex,fileCount-1));assert.equal(p.sourceIndex===null,p.sourceRole==='unknown');
  for(const name of ['line','column','length','offset'])assert.ok(p.status==='present'?bounded(p[name],2147483647):p[name]===null);
  if(p.status!=='present')assert.equal(p.sourceIndex,null);
  return {errorClass:value.errorClass,code:value.code,position:{status:p.status,sourceRole:p.sourceRole,sourceIndex:p.sourceIndex,line:p.line,column:p.column,length:p.length,offset:p.offset}};
}
export function projectFrame(value,{mode,manifestSha256,fileCount}) {
  assert.ok(['build','capability'].includes(mode)&&isHash(manifestSha256)&&bounded(fileCount,8192));
  assert.equal(value.schemaVersion,1);assert.equal(value.experiment,EXPERIMENT);assert.equal(value.mode,mode);
  finite(value.kind,['registered','exception']);
  if(value.kind==='registered'){
    keys(value,['schemaVersion','experiment','kind','mode','manifestSha256']);assert.equal(value.manifestSha256,manifestSha256);return {...value};
  }
  keys(value,['schemaVersion','experiment','kind','mode','origin','inspection','root','aggregateTotal','aggregateOmitted','countsClamped','members','membersLimitReached']);
  finite(value.origin,['uncaughtException','unhandledRejection','other','uninspectable']);finite(value.inspection,['observed','failed']);
  const root=projectError(value.root,fileCount);assert.ok(Array.isArray(value.members)&&value.members.length<=8);
  assert.deepEqual(Object.keys(value.members),value.members.map((_,i)=>String(i)));
  const members=value.members.map(v=>projectError(v,fileCount));
  for(const key of ['countsClamped','membersLimitReached'])assert.equal(typeof value[key],'boolean');
  if(value.aggregateTotal===null||value.aggregateOmitted===null){assert.equal(value.inspection,'failed');assert.equal(value.aggregateTotal,null);assert.equal(value.aggregateOmitted,null);assert.equal(members.length,0);assert.equal(value.countsClamped,false);assert.equal(value.membersLimitReached,false);}
  else {
    assert.ok(bounded(value.aggregateTotal,65535)&&bounded(value.aggregateOmitted,65535));assert.equal(value.aggregateTotal,members.length+value.aggregateOmitted);
    assert.equal(members.length,Math.min(value.aggregateTotal,8));assert.equal(value.membersLimitReached,value.aggregateTotal>8);assert.ok(!value.countsClamped||value.aggregateTotal===65535);
    if(root.errorClass!=='AggregateError'){assert.equal(value.aggregateTotal,0);assert.equal(value.countsClamped,false);}
  }
  if(root.errorClass==='uninspectable')assert.equal(value.inspection,'failed');
  return {...value,root,members};
}
const SCAN=512*1024,LINES=4096;
function monitorStatus(value){
  if(value.scanLimitReached||value.lineLimitReached||value.oversizedLineCount||value.incompleteLineCount||value.invalidFrameCount||value.droppedFrameCount||value.registeredCount>1||value.exceptionCount>1)return 'invalid';
  if(value.registered===null||value.exception===null)return 'missing';
  return value.exception.inspection==='failed'?'inspection-failed':'observed';
}
export function projectMonitorObservation(value,scope) {
  keys(value,['status','scannedBytes','scanLimitReached','lineCount','lineLimitReached','oversizedLineCount','incompleteLineCount','invalidFrameCount','droppedFrameCount','registeredCount','exceptionCount','registered','exception']);
  assert.ok(bounded(value.scannedBytes,SCAN)&&bounded(value.lineCount,LINES)&&bounded(value.incompleteLineCount,1));
  for(const key of ['oversizedLineCount','invalidFrameCount','droppedFrameCount','registeredCount','exceptionCount'])assert.ok(bounded(value[key],LINES+1));
  for(const key of ['scanLimitReached','lineLimitReached'])assert.equal(typeof value[key],'boolean');
  assert.ok(!value.scanLimitReached||value.scannedBytes===SCAN);assert.ok(!value.lineLimitReached||value.lineCount===LINES);
  assert.ok(value.lineCount+value.incompleteLineCount<=value.scannedBytes);
  assert.ok(value.oversizedLineCount*4097<=value.scannedBytes);
  assert.ok(value.invalidFrameCount+value.droppedFrameCount<=value.lineCount);
  assert.ok(value.registeredCount+value.exceptionCount<=value.lineCount);
  assert.equal(value.registered===null,value.registeredCount===0);assert.equal(value.exception===null,value.exceptionCount===0);
  const registered=value.registered===null?null:projectFrame(value.registered,scope),exception=value.exception===null?null:projectFrame(value.exception,scope);
  if(registered)assert.equal(registered.kind,'registered');if(exception){assert.equal(exception.kind,'exception');assert.ok(registered!==null);}
  const retainedBytes=[registered,exception].filter(Boolean).reduce((sum,frame)=>sum+Buffer.byteLength(`${PREFIX}${JSON.stringify(frame)}\n`),0);
  assert.ok(retainedBytes<=8192&&retainedBytes<=value.scannedBytes);
  assert.equal(value.status,monitorStatus(value));return deepFreeze({...value,registered,exception});
}
export function observeMonitor(child,scope) {
  const value={status:'missing',scannedBytes:0,scanLimitReached:false,lineCount:0,lineLimitReached:false,oversizedLineCount:0,incompleteLineCount:0,invalidFrameCount:0,droppedFrameCount:0,registeredCount:0,exceptionCount:0,registered:null,exception:null};
  let buffer=Buffer.alloc(4096),size=0,oversized=false,active=true,framedBytes=0,result;
  const line=()=>{
    value.lineCount++;
    if(!oversized&&size){const bytes=buffer.subarray(0,size);if(bytes.subarray(0,Buffer.byteLength(PREFIX)).equals(Buffer.from(PREFIX))){
      try{
        assert.ok(size+1<=4096);framedBytes+=size+1;assert.ok(framedBytes<=8192);
        const projected=projectFrame(parseBoundedJson(bytes.subarray(Buffer.byteLength(PREFIX)),4096),scope);
        if(projected.kind==='registered'){
          value.registeredCount++;if(value.registered!==null||value.exception!==null)value.droppedFrameCount++;else value.registered=projected;
        }else {
          // A frame before registration is invalid, never retained as evidence.
          assert.ok(value.registered!==null);value.exceptionCount++;if(value.exception!==null)value.droppedFrameCount++;else value.exception=projected;
        }
      }catch{value.invalidFrameCount++;}
    }}
    size=0;oversized=false;
  };
  const consume=chunk=>{
    if(!active)return;
    for(const byte of chunk){
      if(value.scannedBytes===SCAN){value.scanLimitReached=true;break;}
      if(value.lineCount===LINES){value.lineLimitReached=true;break;}
      value.scannedBytes++;
      if(byte===10){line();continue;}
      if(size===4096){if(!oversized)value.oversizedLineCount++;oversized=true;continue;}
      buffer[size++]=byte;
    }
  };
  child.stderr?.on('data',consume);
  const finish=()=>{
    if(!active)return result;active=false;child.stderr?.off('data',consume);child.off('close',finish);
    if(size||oversized)value.incompleteLineCount=1;
    buffer.fill(0);buffer=null;value.status=monitorStatus(value);result=projectMonitorObservation(value,scope);return result;
  };
  // Freeze in the close event itself, before Promise continuations. A writer
  // in a later close listener must not fill evidence that was absent at exit.
  child.once('close',finish);return finish;
}
export async function collectMonitored(child,scope,options={}) {
  const finish=observeMonitor(child,scope);
  try {const collected=await collectChild(child,options);return {...collected,monitorObservation:finish()};}
  finally{finish();}
}
export function makeManifest(rows){return validateManifest({sourceCommit:SOURCE,files:rows.map(row=>({path:row.path,blob:row.blob})).sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)))});}
export function newReceipt(env=process.env) {
  const positive=v=>/^[1-9][0-9]*$/.test(v??'')&&Number.isSafeInteger(Number(v))?Number(v):null;
  return {schemaVersion:1,experiment:EXPERIMENT,sourceCommit:SOURCE,checkoutCommit:isCommit(env.GITHUB_SHA)?env.GITHUB_SHA:null,prHeadCommit:isCommit(env.LAWOSS_PR_HEAD)?env.LAWOSS_PR_HEAD:null,
    runId:positive(env.GITHUB_RUN_ID),runAttempt:positive(env.GITHUB_RUN_ATTEMPT),nodeVersion:process.versions.node,bunVersion:null,stage:'guard',outcome:'unknown',eligibility:'unknown',exit:'not-run',
    baselineReceiptSha256:null,baselineModelsSha256:null,baselineToolchainSha256:null,toolchainArchiveSha256:null,toolchainSha256:null,sourceInputsSha256:null,lockSha256:null,modelsSha256:null,modelsParity:'unknown',
    preloadSha256:null,configSha256:null,manifestSha256:null,manifestFileCount:null,capability:null,installObservation:null,buildObservation:null,monitorObservation:null,postInputVerification:'not-run',causeEquivalence:'unknown',cleanupPolicy:'runner-teardown'};
}
export function capabilityPassed(value) {
  return cleanClose(value?.buildObservation??null,1)&&value.buildObservation.scannedBytes<=8192&&value.monitorObservation?.status==='observed'&&value.monitorObservation.exception.root.errorClass==='AggregateError'&&
    value.monitorObservation.exception.members.some(member=>member.errorClass==='ResolveMessage'&&CODES.includes(member.code)&&member.position.status==='present');
}
export function projectMonitorReceipt(value) {
  const result=newReceipt({});keys(value,Object.keys(result));
  for(const key of ['schemaVersion','experiment','sourceCommit','causeEquivalence','cleanupPolicy'])assert.equal(value[key],result[key]);
  for(const key of ['checkoutCommit','prHeadCommit'])assert.ok(value[key]===null||isCommit(value[key]));
  for(const key of ['runId','runAttempt'])assert.ok(value[key]===null||Number.isSafeInteger(value[key])&&value[key]>0);
  assert.equal(typeof value.nodeVersion,'string');assert.match(value.nodeVersion,/^24\.\d+\.\d+$/);assert.ok(value.bunVersion===null||value.bunVersion==='1.3.14');
  finite(value.stage,STAGES);finite(value.exit,EXITS);finite(value.eligibility,['run','not-needed','unknown']);finite(value.outcome,['unknown','not-needed','exception-observed','build-completed']);finite(value.modelsParity,['same','different','unknown']);finite(value.postInputVerification,['not-run','passed','failed','unknown']);
  for(const key of hashKeys)assert.ok(value[key]===null||isHash(value[key]));assert.ok(value.manifestFileCount===null||bounded(value.manifestFileCount,8192));
  Object.assign(result,value);
  const stage=STAGES.indexOf(value.stage);
  if(value.eligibility==='unknown'){assert.equal(value.outcome,'unknown');assert.equal(value.stage,'guard');for(const key of ['baselineReceiptSha256','baselineModelsSha256','baselineToolchainSha256'])assert.equal(value[key],null);}
  if(value.eligibility==='not-needed'){assert.ok(isHash(value.baselineReceiptSha256));assert.equal(value.outcome,'not-needed');assert.equal(value.stage,'guard');assert.equal(value.exit,'not-run');}
  if(value.eligibility==='run'){
    for(const key of ['checkoutCommit','prHeadCommit'])assert.ok(isCommit(value[key]));for(const key of ['runId','runAttempt'])assert.ok(value[key]>0);
    for(const key of ['baselineReceiptSha256','baselineModelsSha256','baselineToolchainSha256'])assert.ok(isHash(value[key]));assert.equal(value.baselineToolchainSha256,BUN_HASH);
  }
  for(const [minimum,names] of [[2,['capability']],[3,['sourceInputsSha256','lockSha256']],[4,['modelsSha256']],[5,['installObservation']],[6,['preloadSha256','configSha256','manifestSha256','manifestFileCount']],[7,['buildObservation','monitorObservation']]])if(stage<minimum)for(const key of names)assert.equal(value[key],null);
  if(stage<1){for(const key of ['toolchainArchiveSha256','toolchainSha256','sourceInputsSha256','lockSha256','modelsSha256','preloadSha256','configSha256','manifestSha256','manifestFileCount','capability','installObservation','buildObservation','monitorObservation','bunVersion'])assert.equal(value[key],null);}
  if(stage>=2){assert.equal(value.toolchainArchiveSha256,ARCHIVE_HASH);assert.equal(value.toolchainSha256,BUN_HASH);assert.equal(value.bunVersion,'1.3.14');}
  if(value.capability!==null){assert.ok(stage>=2);keys(value.capability,['sourceSha256','buildObservation','monitorObservation']);assert.ok(isHash(value.capability.sourceSha256));
    const registered=value.capability.monitorObservation?.registered;
    // A missing ack has no child-provided manifest identity. Its closed missing
    // observation validates against the fixed synthetic manifest built below.
    const scope={mode:'capability',manifestSha256:CAPABILITY_MANIFEST_HASH,fileCount:2};
    if(registered)assert.equal(registered.manifestSha256,CAPABILITY_MANIFEST_HASH);
    result.capability={sourceSha256:value.capability.sourceSha256,buildObservation:projectBuildObservation(value.capability.buildObservation),monitorObservation:projectMonitorObservation(value.capability.monitorObservation,scope)};
    assert.equal(value.capability.sourceSha256,CAPABILITY_SOURCE_HASH);
    assert.ok(result.capability.monitorObservation.scannedBytes<=result.capability.buildObservation.stderr.scannedBytes);
  }
  if(stage>=3)assert.ok(capabilityPassed(result.capability));
  if(stage>=4){assert.equal(value.sourceInputsSha256,INPUT_HASH);assert.equal(value.lockSha256,LOCK_HASH);}
  if(value.modelsSha256!==null){assert.ok(stage>=4);assert.equal(value.modelsParity,value.modelsSha256===value.baselineModelsSha256?'same':'different');}else assert.equal(value.modelsParity,'unknown');
  if(stage>=5)assert.ok(isHash(value.modelsSha256));
  if(value.installObservation!==null){assert.ok(stage>=5);result.installObservation=projectInstallObservation(value.installObservation);}
  if(stage>=6)assert.ok(cleanClose(result.installObservation,0));
  if(value.manifestSha256!==null){assert.ok(stage>=6);assert.ok(value.manifestFileCount!==null);}
  if(stage>=7){for(const key of ['preloadSha256','configSha256','manifestSha256'])assert.ok(isHash(value[key]));assert.ok(value.manifestFileCount>0);}
  if(value.buildObservation!==null){assert.ok(stage>=7);result.buildObservation=projectBuildObservation(value.buildObservation);}
  if(value.monitorObservation!==null){assert.ok(stage>=7);assert.ok(result.buildObservation!==null);result.monitorObservation=projectMonitorObservation(value.monitorObservation,{mode:'build',manifestSha256:value.manifestSha256,fileCount:value.manifestFileCount});}
  if(result.monitorObservation)assert.ok(result.monitorObservation.scannedBytes<=result.buildObservation.stderr.scannedBytes);
  if(stage<8)assert.equal(value.postInputVerification,'not-run');
  if(stage>=8){assert.ok(cleanClose(result.buildObservation,0)||cleanClose(result.buildObservation,1));finite(value.exit,['ok','child-error']);}
  if(value.outcome==='build-completed'||value.outcome==='exception-observed'){
    assert.equal(value.stage,'complete');assert.equal(value.eligibility,'run');assert.equal(value.postInputVerification,'passed');
    if(value.outcome==='build-completed'){assert.equal(value.exit,'ok');assert.ok(cleanClose(result.buildObservation,0));}
    else{assert.equal(value.exit,'child-error');assert.ok(cleanClose(result.buildObservation,1));assert.equal(result.monitorObservation?.status,'observed');}
  }
  return deepFreeze(result);
}

// The only synthetic capability is a real native resolver rejection, through
// top-level await and Bun.build's default throw behavior. No ordinary handler.
export const CAPABILITY_ENTRY='await Bun.build({ entrypoints: ["./source.ts"], target: "bun" });\n';
export const CAPABILITY_SOURCE='import "./deliberately-absent-lawoss-monitor.ts";\n';
const CAPABILITY_SOURCE_HASH=sha(JSON.stringify([CAPABILITY_ENTRY,CAPABILITY_SOURCE]));
const blob=bytes=>createHash('sha1').update(`blob ${Buffer.byteLength(bytes)}\0`).update(bytes).digest('hex');
const CAPABILITY_MANIFEST=makeManifest([{path:'entry.mjs',blob:blob(CAPABILITY_ENTRY)},{path:'source.ts',blob:blob(CAPABILITY_SOURCE)}]);
const CAPABILITY_MANIFEST_HASH=sha(JSON.stringify(CAPABILITY_MANIFEST));
const within=(root,file)=>{const rel=path.relative(root,file);return rel!==''&&rel!=='..'&&!rel.startsWith(`..${path.sep}`)&&!path.isAbsolute(rel);};
async function regular(file,root) {
  const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());
  if(root)assert.ok(within(await fs.realpath(root),await fs.realpath(file)));return stat;
}
async function readBounded(file,limit) {
  const before=await regular(file);assert.ok(before.size<=limit);
  const handle=await fs.open(file,'r');
  try{const opened=await handle.stat();assert.ok(opened.isFile()&&opened.ino===before.ino&&opened.dev===before.dev&&opened.size<=limit);
    // Fixed-size read prevents a concurrent append from growing allocations.
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
    assert.ok(size<=limit);const after=await regular(file);assert.ok(after.ino===opened.ino&&after.dev===opened.dev);return bytes.subarray(0,size);
  }finally{await handle.close();}
}
async function writePrivate(file,value,{exclusive=false}={}) {
  const bytes=Buffer.from(JSON.stringify(projectMonitorReceipt(value)));assert.ok(bytes.length<=65536);
  if(!exclusive)await regular(file);
  await fs.writeFile(file,bytes,{flag:exclusive?'wx':'w',mode:0o600});
}
export function assessBaseline(value,env=process.env) {
  try{
    const baseline=projectReceipt(value);assert.ok(isCommit(env.GITHUB_SHA)&&isCommit(env.LAWOSS_PR_HEAD));
    assert.equal(baseline.checkoutCommit,env.GITHUB_SHA);assert.equal(baseline.prHeadCommit,env.LAWOSS_PR_HEAD);
    if(baseline.outcome==='not-needed'&&baseline.stage==='original-input'&&baseline.exit==='not-run')return {eligibility:'not-needed',baseline};
    assert.equal(baseline.outcome,'unknown');assert.equal(baseline.stage,'upstream-build');assert.equal(baseline.exit,'child-error');
    assert.equal(baseline.bunVersion,'1.3.14');assert.equal(baseline.originalEngineSha256,ORIGINAL_HASH);assert.equal(baseline.sourceInputsSha256,INPUT_HASH);assert.equal(baseline.lockSha256,LOCK_HASH);assert.equal(baseline.toolchainSha256,BUN_HASH);assert.ok(isHash(baseline.modelsSha256));
    for(const key of ['rebuiltEngineSha256','rebuiltManifestsSha256','rebuiltBoundary'])assert.equal(baseline[key],null);
    assert.ok(cleanClose(baseline.installObservation,0)&&cleanClose(baseline.buildObservation,1));
    return {eligibility:'run',baseline};
  }catch{return {eligibility:'unknown',baseline:null};}
}
export async function guard(privateFile,baselineFile,env=process.env) {
  const result=newReceipt(env);let admission;
  try{const bytes=await readBounded(baselineFile,131072);admission=assessBaseline(parseBoundedJson(bytes,131072),env);
    if(admission.eligibility==='run')assert.ok(result.runId!==null&&result.runAttempt!==null);
    if(admission.eligibility!=='unknown'){
      result.eligibility=admission.eligibility;result.baselineReceiptSha256=sha(bytes);result.baselineModelsSha256=admission.baseline.modelsSha256;result.baselineToolchainSha256=admission.baseline.toolchainSha256;
      if(result.eligibility==='not-needed')result.outcome='not-needed';
    }
  }catch{result.eligibility='unknown';}
  await writePrivate(privateFile,result,{exclusive:true});
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`run=${result.eligibility==='run'}\n`);
  return result;
}
export async function finalize(privateFile,publicFile,env=process.env) {
  assert.equal(path.basename(publicFile),'engine-compile-monitor.json');assert.notEqual(path.resolve(privateFile),path.resolve(publicFile));
  let result=newReceipt(env);
  try{const candidate=projectMonitorReceipt(parseBoundedJson(await readBounded(privateFile,65536),65536));
    // The owner binds current job identity; child data never supplies it.
    for(const key of ['checkoutCommit','prHeadCommit','runId','runAttempt','nodeVersion'])assert.equal(candidate[key],result[key]);result=candidate;
  }catch{/* Invalid or absent private input produces only this clean unknown. */}
  const bytes=Buffer.from(`${JSON.stringify(projectMonitorReceipt(result))}\n`);assert.ok(bytes.length<=65536);
  // Hard-link publication is atomic and exclusive: an existing public name is
  // never overwritten, even by a late child or another finalizer.
  const temporary=await fs.mkdtemp(path.join(path.dirname(publicFile),'.compile-monitor-publish-'));await fs.chmod(temporary,0o700);
  const staged=path.join(temporary,'receipt');
  try{const handle=await fs.open(staged,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
    await fs.link(staged,publicFile);
  }finally{await fs.unlink(staged).catch(()=>{});await fs.rmdir(temporary).catch(()=>{});}
  return result;
}
export async function preparePrivateEnvironment(root,toolDirectory,inherited=process.env) {
  const env=privateEnvironment(root,toolDirectory,inherited);
  for(const key of ['HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TEMP','BUN_INSTALL_CACHE_DIR'])await fs.mkdir(env[key],{recursive:true,mode:0o700});
  await fs.writeFile(env.NPM_CONFIG_USERCONFIG,'',{flag:'wx',mode:0o600});await fs.writeFile(env.GIT_CONFIG_GLOBAL,'',{flag:'wx',mode:0o600});return env;
}
export async function prepareMonitor(directory,{root,entry,argv,mode,manifest}) {
  await fs.mkdir(directory,{mode:0o700});validateManifest(manifest);prepareSourceMap(root,entry,manifest);
  const source=fileURLToPath(new URL('./engine-compile-monitor-preload.mjs',import.meta.url));
  const preloadFile=path.join(directory,'engine-compile-monitor-preload.mjs'),manifestFile=path.join(directory,MANIFEST_NAME),configFile=path.join(directory,CONFIG_NAME);
  const preloadBytes=await readBounded(source,PRIVATE_LIMIT),manifestBytes=Buffer.from(JSON.stringify(manifest));
  const manifestSha256=sha(manifestBytes),configBytes=Buffer.from(JSON.stringify({root,entry,argv,mode,manifestSha256}));assert.ok(configBytes.length<=PRIVATE_LIMIT);
  for(const [file,bytes] of [[preloadFile,preloadBytes],[manifestFile,manifestBytes],[configFile,configBytes]])await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});
  return {preloadFile,manifestFile,configFile,preloadSha256:sha(preloadBytes),manifestSha256,configSha256:sha(configBytes),manifestFileCount:manifest.files.length};
}
export async function runCapability({root,bun,env}) {
  const sourceRoot=path.join(root,'capability');await fs.mkdir(sourceRoot,{mode:0o700});
  const entry=path.join(sourceRoot,'entry.mjs');await fs.writeFile(entry,CAPABILITY_ENTRY,{flag:'wx',mode:0o600});await fs.writeFile(path.join(sourceRoot,'source.ts'),CAPABILITY_SOURCE,{flag:'wx',mode:0o600});
  const prepared=await prepareMonitor(path.join(root,'capability-monitor'),{root:sourceRoot,entry,argv:[bun,entry],mode:'capability',manifest:CAPABILITY_MANIFEST});
  const child=spawn(bun,[entry],{cwd:sourceRoot,env:{...env,BUN_INSPECT_PRELOAD:prepared.preloadFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
  const observed=await collectMonitored(child,{mode:'capability',manifestSha256:prepared.manifestSha256,fileCount:2},{timeoutMs:5000,drainMs:1000,limit:8192,buildObservation:{packages:['lawoss-compile-self-check']}});
  const capability={sourceSha256:CAPABILITY_SOURCE_HASH,buildObservation:observed.buildObservation,monitorObservation:observed.monitorObservation};
  return {capability,exit:observed.outcome,passed:observed.outcome==='child-error'&&capabilityPassed(capability),prepared};
}
async function executable(name,env){for(const directory of env.PATH.split(path.delimiter)){const file=path.resolve(directory,name);try{if((await fs.stat(file)).isFile())return file;}catch{/* next fixed executable location */}}throw Error('Unavailable tool');}
async function download(url,file,limit){
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.ok(response.ok&&response.body);const declared=Number(response.headers.get('content-length'));assert.ok(!Number.isFinite(declared)||declared<=limit);
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;assert.ok(size<=limit);parts.push(Buffer.from(value));}}
  finally{await reader.cancel();reader.releaseLock();}
  const bytes=Buffer.concat(parts);await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});return bytes;
}
export async function verifyPostInputs({root,inputs,hashes,gitCheck}) {
  await verifyInputs(root,inputs);await gitCheck();
  for(const [file,expected] of hashes){await regular(file);assert.equal(sha(await fs.readFile(file)),expected);}return 'passed';
}
export function finishBuild(result) {
  result.outcome='unknown';
  if(result.postInputVerification==='passed'){
    if(result.exit==='ok'&&cleanClose(result.buildObservation,0))result.outcome='build-completed';
    else if(result.exit==='child-error'&&cleanClose(result.buildObservation,1)&&result.monitorObservation?.status==='observed')result.outcome='exception-observed';
  }
  return result;
}
export async function run(privateFile,baselineFile,env=process.env) {
  // Every refusal here precedes root creation, downloading, or child execution.
  const result=projectMonitorReceipt(parseBoundedJson(await readBounded(privateFile,65536),65536));assert.equal(result.stage,'guard');assert.equal(result.eligibility,'run');
  const baselineBytes=await readBounded(baselineFile,131072);assert.equal(sha(baselineBytes),result.baselineReceiptSha256);assert.equal(assessBaseline(parseBoundedJson(baselineBytes,131072),env).eligibility,'run');
  const current=newReceipt(env);for(const key of ['checkoutCommit','prHeadCommit','runId','runAttempt','nodeVersion'])assert.equal(result[key],current[key]);
  assert.equal(env.CI,'true');assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.match(process.versions.node,/^24\./);
  const mutable=structuredClone(result),repo=fileURLToPath(new URL('../../../../',import.meta.url));
  const root=await fs.mkdtemp(path.join(await fs.realpath(env.RUNNER_TEMP),'lawoss-compile-monitor-'));await fs.chmod(root,0o700);
  const privateEnv=await preparePrivateEnvironment(root,path.dirname(process.execPath),env);
  const command=async(executable,args,cwd,options={})=>{
    const child=spawn(executable,args,{cwd,env:options.env??privateEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});const observed=await collectChild(child,options);
    if(options.installObservation)mutable.installObservation=observed.installObservation;
    if(observed.outcome!=='ok'){mutable.exit=observed.outcome;throw Error('Owned command failed');}return observed.text;
  };
  const stage=async name=>{mutable.stage=name;await writePrivate(privateFile,mutable);};
  try{
    const git=await executable('git.exe',privateEnv);
    assert.equal((await command(git,['rev-parse','HEAD'],repo,{capture:true,limit:1024,timeoutMs:5000})).trim(),mutable.checkoutCommit);
    await stage('toolchain');const toolchain=path.join(root,'toolchain');await fs.mkdir(toolchain,{mode:0o700});const archive=path.join(root,'bun.zip');
    const archiveBytes=await download('https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64-baseline.zip',archive,64*1024*1024);
    assert.equal(archiveBytes.length,38023440);assert.equal(sha(archiveBytes),ARCHIVE_HASH);mutable.toolchainArchiveSha256=ARCHIVE_HASH;
    const systemRoot=privateEnv.SystemRoot??privateEnv.SYSTEMROOT;assert.match(systemRoot??'',/^[a-z]:\\Windows$/i);
    await command(path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe'),['-NoProfile','-NonInteractive','-Command','& { param($a,$b) Expand-Archive -LiteralPath $a -DestinationPath $b }',archive,toolchain],root);
    const bun=path.join(toolchain,'bun-windows-x64-baseline/bun.exe');await regular(bun,root);assert.equal(sha(await fs.readFile(bun)),BUN_HASH);mutable.toolchainSha256=BUN_HASH;
    const toolEnv=privateEnvironment(root,path.dirname(bun),env);assert.equal((await command(bun,['--version'],root,{env:toolEnv,capture:true,limit:1024,timeoutMs:5000})).trim(),'1.3.14');mutable.bunVersion='1.3.14';
    await stage('capability');const capability=await runCapability({root,bun,env:toolEnv});mutable.capability=capability.capability;
    if(!capability.passed){mutable.exit=capability.exit;throw Error('Capability unknown');}
    await stage('source-checkout');const upstream=path.join(root,'upstream');await fs.mkdir(upstream,{mode:0o700});
    await command(git,['init','--quiet'],upstream);await command(git,['-c','credential.helper=','fetch','--quiet','--depth=1','https://github.com/anomalyco/opencode.git',SOURCE],upstream);
    await command(git,['checkout','--quiet','--detach','FETCH_HEAD'],upstream);assert.equal((await command(git,['rev-parse','HEAD'],upstream,{capture:true,limit:1024})).trim(),SOURCE);await command(git,['diff','--quiet','HEAD','--'],upstream);await verifyInputs(upstream,INPUTS);
    const pkg=parseBoundedJson(await readBounded(path.join(upstream,'package.json'),65536),65536);assert.equal(pkg.packageManager,'bun@1.3.14');const sourceInputs={...INPUTS};
    const patches=Object.values(pkg.patchedDependencies);assert.equal(patches.length,18);
    for(const name of patches){assert.ok(typeof name==='string'&&name.startsWith('patches/')&&!name.includes('..'));const file=path.join(upstream,name);await regular(file,upstream);sourceInputs[name]=sha(await fs.readFile(file));}
    mutable.sourceInputsSha256=await verifyInputs(upstream,sourceInputs);assert.equal(mutable.sourceInputsSha256,INPUT_HASH);mutable.lockSha256=LOCK_HASH;
    await stage('models-freeze');const models=path.join(root,'models.dev.json'),modelBytes=await download('https://models.dev/api.json',models,8*1024*1024);const modelObject=parseBoundedJson(modelBytes,8*1024*1024);assert.ok(modelObject!==null&&typeof modelObject==='object'&&!Array.isArray(modelObject));
    mutable.modelsSha256=sha(modelBytes);mutable.modelsParity=mutable.modelsSha256===mutable.baselineModelsSha256?'same':'different';
    const buildEnv={...toolEnv,OPENCODE_VERSION:'1.18.29',OPENCODE_CHANNEL:'latest',MODELS_DEV_API_JSON:models};
    await stage('upstream-install');await command(bun,['install','--frozen-lockfile','--linker','hoisted'],upstream,{env:buildEnv,installObservation:{packages:installPackageAllowlist(pkg)}});
    await verifyInputs(upstream,sourceInputs);await command(git,['diff','--quiet','HEAD','--'],upstream);
    await stage('manifest');const listing=await command(git,['ls-tree','-rz','--full-tree',SOURCE],upstream,{capture:true,limit:PRIVATE_LIMIT});
    const rows=[];for(const line of listing.split('\0').filter(Boolean)){const match=/^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(line);assert.ok(match);if(match[1]==='100644'||match[1]==='100755')rows.push({path:match[4],blob:match[3]});}
    const manifest=makeManifest(rows),entry=path.join(upstream,'packages/opencode/script/build.ts');
    const monitor=await prepareMonitor(path.join(root,'build-monitor'),{root:upstream,entry,argv:[bun,entry,'--single','--baseline'],mode:'build',manifest});
    for(const key of ['preloadSha256','configSha256','manifestSha256','manifestFileCount'])mutable[key]=monitor[key];
    await stage('monitored-build');
    const child=spawn(bun,['run','packages/opencode/script/build.ts','--single','--baseline'],{cwd:upstream,env:{...buildEnv,BUN_INSPECT_PRELOAD:monitor.preloadFile},windowsHide:true,stdio:['ignore','pipe','pipe']});
    const observed=await collectMonitored(child,{mode:'build',manifestSha256:monitor.manifestSha256,fileCount:manifest.files.length},{buildObservation:{packages:installPackageAllowlist(pkg)}});
    mutable.exit=observed.outcome;mutable.buildObservation=observed.buildObservation;mutable.monitorObservation=observed.monitorObservation;
    // Timeout/output/spawn/pipe ambiguity stops work. Direct close alone never
    // grants descendant-tree cleanup or turns missing frames into a cause.
    if(!['ok','child-error'].includes(observed.outcome)||!(cleanClose(observed.buildObservation,0)||cleanClose(observed.buildObservation,1)))throw Error('Build transport unknown');
    await stage('post-inputs');
    try{mutable.postInputVerification=await verifyPostInputs({root:upstream,inputs:sourceInputs,gitCheck:()=>command(git,['diff','--quiet','HEAD','--'],upstream),hashes:[[models,mutable.modelsSha256],[bun,BUN_HASH],[monitor.preloadFile,monitor.preloadSha256],[monitor.configFile,monitor.configSha256],[monitor.manifestFile,monitor.manifestSha256]]});}
    catch{mutable.postInputVerification='failed';}
    // Secondary verification cannot replace the primary build's exit status.
    mutable.exit=observed.outcome;mutable.stage='complete';finishBuild(mutable);
  }catch{mutable.outcome='unknown';if(mutable.exit==='not-run')mutable.exit='validation-failed';}
  await writePrivate(privateFile,mutable);return mutable;
}
async function main(){
  const [mode,privateFile,other,...rest]=process.argv.slice(2);assert.equal(rest.length,0);assert.ok(privateFile&&other);
  if(mode==='guard')await guard(privateFile,other);
  else if(mode==='run')await run(privateFile,other);
  else if(mode==='finalize')await finalize(privateFile,other);
  else throw Error('Invalid mode');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))main().catch(()=>{process.exitCode=1;});
