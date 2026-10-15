import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseBoundedJson, assessOriginal, projectBoundary, privateEnvironment, nativeDiagnosticEnvironment, collectChild } from './engine-baseline-probe.mjs';
import { prepareNativeEngineFiles, verifyNativeEngineFiles } from './engine-identity.mjs';

// Behavioral diagnostic only; the original Windows result remains authoritative.
const EXPERIMENT='original-windows-empty-auth-behavioral';
const PIN='32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
const TARGET='opencode-x86_64-pc-windows-msvc.exe', VERSION='1.18.29';
const ACK='producer-ack.private.json';
const repo=fileURLToPath(new URL('../../../../',import.meta.url));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const isHash=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const isCommit=v=>typeof v==='string'&&/^[a-f0-9]{40}$/.test(v);
const integer=(v,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(v)&&v>=0&&v<=max;
const positive=v=>typeof v==='string'&&/^[1-9][0-9]{0,15}$/.test(v)&&integer(Number(v))?Number(v):null;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const keys=(v,names)=>{assert.ok(object(v));assert.deepEqual(Object.keys(v).sort(),[...names].sort());};
const phases=['setup','startup','configure-provider','native-case','preparation-admission','generation','extra-cases','relaunch','recovery','complete'];
const stages=['guard','awaiting-lawoss-build','identity-before','native','identity-after','complete'];
const exits=['not-run','validation-failed','ok','child-error','child-unclosed','output-limit','invalid-output','timeout'];
const delta=()=>({key:'OPENCODE_AUTH_CONTENT',value:'{}',behavioral:true,causeEquivalence:'unknown'});
const acknowledgment=()=>({schemaVersion:1,experiment:EXPERIMENT,producerApplied:true,synthetic:true,fullMatrix:true,ownedRoot:true,engineSha256:PIN});

async function canonicalParent(file) {
  assert.ok(typeof file==='string'&&path.isAbsolute(file));
  const parent=path.dirname(file),stat=await fs.lstat(parent);
  assert.ok(stat.isDirectory()&&!stat.isSymbolicLink());assert.equal(await fs.realpath(parent),parent);
  return parent;
}
async function absent(file) {await assert.rejects(fs.lstat(file),{code:'ENOENT'});}
export async function readBounded(file,limit) {
  await canonicalParent(file);
  const before=await fs.lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=limit);
  const handle=await fs.open(file,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
  try {
    const opened=await handle.stat();assert.ok(opened.isFile()&&opened.ino===before.ino&&opened.dev===before.dev&&opened.size<=limit);
    const bytes=Buffer.alloc(limit+1);let size=0;
    while(size<bytes.length){const read=await handle.read(bytes,size,bytes.length-size,size);if(!read.bytesRead)break;size+=read.bytesRead;}
    const after=await fs.lstat(file);assert.ok(!after.isSymbolicLink()&&after.ino===opened.ino&&after.dev===opened.dev&&after.size===opened.size&&after.mtimeMs===opened.mtimeMs&&size<=limit);
    return bytes.subarray(0,size);
  } finally {await handle.close();}
}
export async function validateProbeOption(argv,env=process.env,platform=process.platform) {
  if(!argv.some(arg=>arg.startsWith('--empty-auth-probe')))return null;
  assert.equal(argv.length,2);assert.equal(argv[0],'--empty-auth-probe');
  assert.equal(env.CI,'true');assert.equal(env.GITHUB_ACTIONS,'true');assert.equal(platform,'win32');
  assert.equal(env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS,'1');
  for(const key of ['LAWOSS_ISIR_CORPUS','LAWOSS_ISIR_NATIVE_ENGINE','LAWOSS_ISIR_NATIVE_ELECTRON'])assert.equal(env[key],undefined);
  const ackFile=argv[1],raw=env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE;
  assert.equal(path.basename(ackFile),ACK);assert.equal(path.basename(raw??''),'native-diagnostics.private.json');
  const parent=await canonicalParent(ackFile);assert.equal(await canonicalParent(raw),parent);
  await absent(ackFile);await absent(raw);
  return Object.freeze({ackFile,raw});
}
export async function applyProducer(env,option,engineHash) {
  if(option===null)return;
  assert.equal(engineHash,PIN);
  // Revalidate immediately before exclusive publication; no caller value exists.
  assert.equal(path.basename(option.ackFile),ACK);
  assert.equal(await canonicalParent(option.ackFile),await canonicalParent(option.raw));
  await absent(option.ackFile);
  env.OPENCODE_AUTH_CONTENT='{}';
  await fs.writeFile(option.ackFile,JSON.stringify(acknowledgment()),{flag:'wx',mode:0o600});
}
export async function readAck(file) {
  const bytes=await readBounded(file,2048),value=parseBoundedJson(bytes,2048);
  assert.deepEqual(value,acknowledgment());return {value,sha256:sha(bytes)};
}
export function compactBoundary(value) {
  assert.equal(value.schema,6);const p=projectBoundary(value);
  assert.equal(p.startupDropped,0);
  const ordered=['request','headers','body','verified'];
  assert.ok(p.startup.length<=4&&p.startup.every((row,i)=>row.stage===ordered[i]));
  const selected=p.requests.filter(row=>row.phase==='startup'&&row.endpoint==='engine.path');
  const health=p.requests.filter(row=>row.phase==='startup'&&row.endpoint==='engine.health');
  // A duplicate/conflicting selected row must never lend the optimistic one proof.
  assert.ok(selected.length<=1&&health.length<=1);
  const row=selected[0];
  return {phase:p.phase,startupStage:p.startup.at(-1)?.stage??'none',pathState:row?.state??'absent',pathStatus:row?.status??null,
    health200:health.length===1&&health[0].state==='headers'&&health[0].status===200,cleanupErrorCount:p.cleanupErrors.length};
}
export function assessInputs(main,runtime) {
  try {const boundary=compactBoundary(main),assessment=assessOriginal(main,runtime);return {decision:assessment.decision,boundary};}
  catch{return {decision:'unknown',boundary:null};}
}
export function newReceipt(env=process.env) {
  return {schemaVersion:1,experiment:EXPERIMENT,checkoutCommit:isCommit(env.GITHUB_SHA)?env.GITHUB_SHA:null,prHeadCommit:isCommit(env.LAWOSS_PR_HEAD)?env.LAWOSS_PR_HEAD:null,
    runId:positive(env.GITHUB_RUN_ID),runAttempt:positive(env.GITHUB_RUN_ATTEMPT),nodeVersion:process.versions.node,
    eligibility:'unknown',stage:'guard',outcome:'unknown',exit:'not-run',delta:delta(),inputs:{mainSha256:null,runtimeSha256:null},producer:{status:'not-run',ackSha256:null},
    engine:{version:VERSION,target:TARGET,beforeSha256:null,afterSha256:null,beforeManifestsSha256:null,afterManifestsSha256:null,beforeVersionVerified:false,afterVersionVerified:false},
    originalBoundary:null,alteredBoundary:null,lifecycle:{closed:false,code:null,descendants:'unknown'}};
}
const identity=r=>r.engine.beforeSha256===PIN&&r.engine.afterSha256===PIN&&isHash(r.engine.beforeManifestsSha256)&&r.engine.afterManifestsSha256===r.engine.beforeManifestsSha256;
const producer=r=>r.producer.status==='applied'&&isHash(r.producer.ackSha256)&&r.engine.beforeVersionVerified;
const progress=b=>b?.startupStage==='verified'&&b.pathState==='headers'&&b.pathStatus===200&&b.health200;
export function classifyAltered(r,main) {
  try {
    const b=compactBoundary(main);
    if(!producer(r)||!identity(r)||!r.lifecycle.closed||!['ok','child-error'].includes(r.exit)||b.cleanupErrorCount!==0)return 'unknown';
    if(r.exit==='ok'&&r.lifecycle.code===0&&b.phase==='complete'&&!main.error&&r.engine.afterVersionVerified)return 'altered-complete';
    if(progress(b))return 'altered-progress';
    return r.exit==='child-error'&&integer(r.lifecycle.code,4294967295)&&r.lifecycle.code!==0?'altered-failure':'unknown';
  }catch{return 'unknown';}
}
function validateBoundary(b) {
  if(b===null)return;
  keys(b,['phase','startupStage','pathState','pathStatus','health200','cleanupErrorCount']);
  assert.ok(phases.includes(b.phase)&&['none','request','headers','body','verified'].includes(b.startupStage)&&['absent','pending','headers','failed'].includes(b.pathState));
  assert.ok(b.pathStatus===null||integer(b.pathStatus,599)&&b.pathStatus>=100);assert.equal(typeof b.health200,'boolean');assert.ok(integer(b.cleanupErrorCount,32));
  if(['absent','pending'].includes(b.pathState))assert.equal(b.pathStatus,null);
}
export function projectReceipt(r) {
  keys(r,['schemaVersion','experiment','checkoutCommit','prHeadCommit','runId','runAttempt','nodeVersion','eligibility','stage','outcome','exit','delta','inputs','producer','engine','originalBoundary','alteredBoundary','lifecycle']);
  assert.equal(r.schemaVersion,1);assert.equal(r.experiment,EXPERIMENT);
  for(const key of ['checkoutCommit','prHeadCommit'])assert.ok(r[key]===null||isCommit(r[key]));
  for(const key of ['runId','runAttempt'])assert.ok(r[key]===null||integer(r[key])&&r[key]>0);
  assert.match(r.nodeVersion,/^24\.\d+\.\d+$/);
  assert.ok(['unknown','not-needed','run'].includes(r.eligibility)&&stages.includes(r.stage)&&exits.includes(r.exit));
  assert.ok(['unknown','not-needed','altered-progress','altered-complete','altered-failure'].includes(r.outcome));
  assert.deepEqual(r.delta,delta());keys(r.inputs,['mainSha256','runtimeSha256']);keys(r.producer,['status','ackSha256']);
  assert.ok(['not-run','applied','unknown'].includes(r.producer.status));
  keys(r.engine,['version','target','beforeSha256','afterSha256','beforeManifestsSha256','afterManifestsSha256','beforeVersionVerified','afterVersionVerified']);
  assert.equal(r.engine.version,VERSION);assert.equal(r.engine.target,TARGET);
  for(const hash of [...Object.values(r.inputs),r.producer.ackSha256,...['beforeSha256','afterSha256','beforeManifestsSha256','afterManifestsSha256'].map(key=>r.engine[key])])assert.ok(hash===null||isHash(hash));
  for(const key of ['beforeVersionVerified','afterVersionVerified'])assert.equal(typeof r.engine[key],'boolean');
  keys(r.lifecycle,['closed','code','descendants']);assert.equal(typeof r.lifecycle.closed,'boolean');assert.equal(r.lifecycle.descendants,'unknown');
  assert.ok(r.lifecycle.code===null||integer(r.lifecycle.code,4294967295));assert.ok(r.lifecycle.closed||r.lifecycle.code===null);
  validateBoundary(r.originalBoundary);validateBoundary(r.alteredBoundary);
  if(r.exit==='ok')assert.ok(r.lifecycle.closed&&r.lifecycle.code===0);
  if(r.exit==='child-error')assert.ok(r.lifecycle.closed&&r.lifecycle.code!==0);
  if(r.exit==='child-unclosed')assert.ok(!r.lifecycle.closed&&r.lifecycle.code===null);
  if(['timeout','output-limit','invalid-output'].includes(r.exit))assert.ok(r.lifecycle.closed);
  if(['not-run','validation-failed'].includes(r.exit))assert.ok(!r.lifecycle.closed&&r.lifecycle.code===null);
  const before=r.engine.beforeSha256===PIN&&isHash(r.engine.beforeManifestsSha256);
  assert.equal(r.engine.beforeSha256===null,r.engine.beforeManifestsSha256===null);assert.equal(r.engine.afterSha256===null,r.engine.afterManifestsSha256===null);
  assert.ok(r.engine.beforeSha256===null||before);assert.ok(r.engine.afterSha256===null||identity(r)&&r.lifecycle.closed);
  assert.ok(r.producer.status==='applied'?isHash(r.producer.ackSha256)&&before&&r.engine.beforeVersionVerified:r.producer.ackSha256===null&&!r.engine.beforeVersionVerified);
  if(r.engine.afterVersionVerified)assert.ok(identity(r)&&producer(r)&&r.lifecycle.closed&&r.lifecycle.code===0&&r.exit==='ok'&&r.alteredBoundary?.phase==='complete'&&r.alteredBoundary.cleanupErrorCount===0);
  if(r.eligibility!=='unknown')assert.ok(isCommit(r.checkoutCommit)&&isCommit(r.prHeadCommit)&&r.runId!==null&&r.runAttempt===1&&isHash(r.inputs.mainSha256)&&r.originalBoundary!==null);
  if(r.eligibility==='run'){assert.ok(isHash(r.inputs.runtimeSha256)&&r.stage!=='guard');assert.deepEqual(r.originalBoundary,{phase:'startup',startupStage:'request',pathState:'failed',pathStatus:null,health200:true,cleanupErrorCount:0});}
  if(r.eligibility==='not-needed')assert.ok(r.originalBoundary.phase==='complete'&&r.originalBoundary.cleanupErrorCount===0);
  if(r.eligibility!=='run')assert.ok(r.stage==='guard'&&r.exit==='not-run'&&r.producer.status==='not-run'&&!before&&r.alteredBoundary===null&&!r.lifecycle.closed);
  if(['guard','awaiting-lawoss-build','identity-before'].includes(r.stage))assert.ok(!before&&r.producer.status==='not-run'&&r.alteredBoundary===null&&!r.lifecycle.closed&&['not-run','validation-failed'].includes(r.exit));
  if(['native','identity-after','complete'].includes(r.stage))assert.ok(r.eligibility==='run'&&before);
  if(r.stage==='identity-after'||r.stage==='complete')assert.ok(r.lifecycle.closed);
  if(r.stage==='native')assert.ok(!r.lifecycle.closed&&r.alteredBoundary===null&&r.producer.status!=='applied'&&r.engine.afterSha256===null&&['not-run','validation-failed','child-unclosed'].includes(r.exit));
  if(r.stage==='awaiting-lawoss-build')assert.equal(r.exit,'not-run');
  if(r.eligibility==='unknown')assert.ok(r.inputs.mainSha256===null&&r.inputs.runtimeSha256===null&&r.originalBoundary===null);
  if(r.engine.afterVersionVerified)assert.ok(r.stage==='complete'&&r.outcome==='altered-complete');
  if(r.outcome==='not-needed')assert.equal(r.eligibility,'not-needed');
  if(r.eligibility==='not-needed')assert.equal(r.outcome,'not-needed');
  if(r.outcome.startsWith('altered-')) {
    assert.ok(r.eligibility==='run'&&['identity-after','complete'].includes(r.stage)&&producer(r)&&identity(r)&&r.lifecycle.closed&&['ok','child-error'].includes(r.exit)&&r.alteredBoundary?.cleanupErrorCount===0);
    if(r.outcome==='altered-complete')assert.ok(r.stage==='complete'&&r.exit==='ok'&&r.lifecycle.code===0&&r.engine.afterVersionVerified&&r.alteredBoundary.phase==='complete');
    if(r.outcome==='altered-progress')assert.ok(progress(r.alteredBoundary));
    if(r.outcome==='altered-failure')assert.ok(r.exit==='child-error'&&r.lifecycle.code!==null&&r.lifecycle.code>0);
  }
  if(r.stage==='complete')assert.equal(r.outcome,'altered-complete');
  return structuredClone(r);
}

// Git identity is a read-only filesystem observation, including at finalization.
// Never start another executable after the native collector has returned.
export async function actualCheckout() {
  let git=path.join(repo,'.git');const stat=await fs.lstat(git);assert.ok(!stat.isSymbolicLink());
  if(stat.isFile()) {const pointer=(await readBounded(git,4096)).toString('utf8').trim();assert.ok(pointer.startsWith('gitdir: '));git=await fs.realpath(path.resolve(repo,pointer.slice(8)));}
  const head=(await readBounded(path.join(git,'HEAD'),4096)).toString('utf8').trim();
  if(isCommit(head))return head;
  assert.match(head,/^ref: refs\/[a-zA-Z0-9._/-]+$/);const ref=head.slice(5);assert.ok(!ref.includes('..'));
  let common=git;
  try {common=await fs.realpath(path.resolve(git,(await readBounded(path.join(git,'commondir'),4096)).toString('utf8').trim()));}catch(error){if(error.code!=='ENOENT')throw error;}
  for(const base of [...new Set([git,common])]) {
    try {const commit=(await readBounded(path.join(base,ref),4096)).toString('utf8').trim();assert.ok(isCommit(commit));return commit;}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const packed=(await readBounded(path.join(common,'packed-refs'),4*1024*1024)).toString('utf8').split('\n').filter(line=>line.endsWith(` ${ref}`));
  assert.equal(packed.length,1);const commit=packed[0].split(' ')[0];assert.ok(isCommit(commit));return commit;
}
async function currentContext(env) {
  assert.equal(env.CI,'true');assert.equal(env.GITHUB_ACTIONS,'true');assert.match(process.versions.node,/^24\.\d+\.\d+$/);
  assert.ok(isCommit(env.GITHUB_SHA)&&isCommit(env.LAWOSS_PR_HEAD)&&positive(env.GITHUB_RUN_ID)!==null);assert.equal(env.GITHUB_RUN_ATTEMPT,'1');
  assert.equal(await actualCheckout(),env.GITHUB_SHA);
}
function boundedJson(bytes,limit) {
  const value=parseBoundedJson(bytes,limit);
  const visit=v=>{if(typeof v==='number')assert.ok(Number.isFinite(v));else if(v&&typeof v==='object')for(const child of Object.values(v))visit(child);};
  visit(value);return value;
}
async function writePrivate(file,value,exclusive=false) {
  assert.notEqual(path.basename(file).replace(/[. ]+$/,'').toLowerCase(),'engine-empty-auth-probe.json');
  await canonicalParent(file);const bytes=Buffer.from(JSON.stringify(projectReceipt(value)));assert.ok(bytes.length<=65536);
  if(exclusive){await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});return;}
  const before=await fs.lstat(file);assert.ok(before.isFile()&&!before.isSymbolicLink());
  const handle=await fs.open(file,constants.O_WRONLY|(constants.O_NOFOLLOW??0));
  try {const opened=await handle.stat();assert.ok(opened.ino===before.ino&&opened.dev===before.dev&&opened.isFile());await handle.truncate(0);await handle.writeFile(bytes);}finally{await handle.close();}
}
async function boundReceipt(file,env) {
  await currentContext(env);const candidate=projectReceipt(boundedJson(await readBounded(file,65536),65536)),now=newReceipt(env);
  for(const key of ['checkoutCommit','prHeadCommit','runId','runAttempt','nodeVersion'])assert.equal(candidate[key],now[key]);return candidate;
}
export async function guard(privateFile,mainFile,runtimeFile,env=process.env) {
  let result=newReceipt(env);
  try {
    await currentContext(env);
    const mainBytes=await readBounded(mainFile,256*1024),main=boundedJson(mainBytes,256*1024);
    let runtimeBytes=null,runtime=null;
    if(assessInputs(main,null).decision!=='not-needed'){runtimeBytes=await readBounded(runtimeFile,4096);runtime=boundedJson(runtimeBytes,4096);}
    const assessed=assessInputs(main,runtime);
    if(assessed.decision==='run'){assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');}
    if(assessed.decision!=='unknown') {
      result.eligibility=assessed.decision;result.originalBoundary=assessed.boundary;result.inputs={mainSha256:sha(mainBytes),runtimeSha256:runtimeBytes?sha(runtimeBytes):null};
      if(assessed.decision==='run')result.stage='awaiting-lawoss-build';else result.outcome='not-needed';
    }
  }catch{result=newReceipt(env);}
  await writePrivate(privateFile,result,true);
  if(env.GITHUB_OUTPUT)await fs.appendFile(env.GITHUB_OUTPUT,`run=${result.eligibility==='run'}\n`);
  return result;
}
export async function preparePinnedIdentity(bundleDir) {
  // No external fixture: the identity helper cannot create an engine alias here.
  await canonicalParent(path.join(bundleDir,TARGET));
  const target=await fs.lstat(path.join(bundleDir,TARGET));assert.ok(target.isFile()&&!target.isSymbolicLink());
  for(const name of ['versions.json',`versions.json-${TARGET.slice('opencode-'.length)}`]) {
    try{boundedJson(await readBounded(path.join(bundleDir,name),65536),65536);}catch(error){if(error.code!=='ENOENT')throw error;}
  }
  const prepared=await prepareNativeEngineFiles({bundleDir,platform:'win32',arch:'x64'});
  assert.equal(path.basename(prepared.path),TARGET);assert.equal(prepared.identitySource,'manifest');assert.equal(prepared.expectedHash,PIN);
  const selected=await fs.lstat(prepared.path);assert.ok(selected.isFile()&&!selected.isSymbolicLink());
  for(const manifest of prepared.manifests)boundedJson(await readBounded(manifest.path,65536),65536);
  const manifestsSha256=sha(JSON.stringify(prepared.manifests.map(m=>[path.basename(m.path),m.hash]).sort(([a],[b])=>Buffer.compare(Buffer.from(a),Buffer.from(b)))));
  return {prepared,manifestsSha256};
}
export async function createPrivateRoot(inherited=process.env) {
  const root=await fs.realpath(await fs.mkdtemp(path.join(tmpdir(),'lawoss-empty-auth-')));await fs.chmod(root,0o700);
  const env=nativeDiagnosticEnvironment(root,privateEnvironment(root,path.dirname(process.execPath),inherited));env.GITHUB_ACTIONS='true';
  for(const key of ['HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TEMP','BUN_INSTALL_CACHE_DIR'])await fs.mkdir(env[key],{recursive:true,mode:0o700});
  await fs.writeFile(env.NPM_CONFIG_USERCONFIG,'',{flag:'wx',mode:0o600});await fs.writeFile(env.GIT_CONFIG_GLOBAL,'',{flag:'wx',mode:0o600});
  return {root,env};
}
export async function run(privateFile,env=process.env) {
  let result;
  try {result=await boundReceipt(privateFile,env);assert.equal(result.eligibility,'run');assert.equal(result.stage,'awaiting-lawoss-build');assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');}
  catch{return;}
  let collected=false;
  try {
    result.stage='identity-before';await writePrivate(privateFile,result);
    const {prepared,manifestsSha256}=await preparePinnedIdentity(path.join(repo,'apps/desktop/resources/sidecars'));
    const owned=await createPrivateRoot(env),ackFile=path.join(owned.root,ACK);
    result.engine.beforeSha256=PIN;result.engine.beforeManifestsSha256=manifestsSha256;result.stage='native';await writePrivate(privateFile,result);
    const child=spawn(process.execPath,[path.join(repo,'scripts/test-isir-native.mjs'),'--empty-auth-probe',ackFile],{cwd:repo,env:owned.env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const observed=await collectChild(child,{timeoutMs:12*60*1000});collected=true;
    result.exit=observed.outcome;result.lifecycle={closed:observed.closed,code:integer(observed.code,4294967295)?observed.code:null,descendants:'unknown'};
    result.producer.status='unknown';
    // Direct-child nonclosure freezes all observations; no probe, retry or deletion.
    if(observed.closed) {
      result.stage='identity-after';
      try {
        const acknowledged=await readAck(ackFile);result.producer={status:'applied',ackSha256:acknowledged.sha256};result.engine.beforeVersionVerified=true;
      }catch{/* Ack is invocation/source proof, not a live engine-env inspection. */}
      try {
        await verifyNativeEngineFiles(prepared,prepared.path);
        result.engine.afterSha256=PIN;result.engine.afterManifestsSha256=manifestsSha256;
      }catch{/* Lost or changed identity cannot support an altered classification. */}
      try {
        const main=boundedJson(await readBounded(owned.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE,256*1024),256*1024);
        result.alteredBoundary=compactBoundary(main);
        result.engine.afterVersionVerified=producer(result)&&identity(result)&&observed.outcome==='ok'&&observed.code===0&&main.phase==='complete'&&!main.error&&main.cleanupErrors.length===0;
        result.outcome=classifyAltered(result,main);if(result.outcome==='altered-complete')result.stage='complete';
      }catch{/* Preserve the primary collector exit and available bounded observations. */}
    }
  }catch {if(!collected)result.exit='validation-failed';result.outcome='unknown';}
  await writePrivate(privateFile,result);return result;
}
export async function finalize(privateFile,publicFile,env=process.env) {
  assert.equal(path.basename(publicFile),'engine-empty-auth-probe.json');assert.notEqual(path.resolve(privateFile),path.resolve(publicFile));await canonicalParent(publicFile);
  let result=newReceipt(env);try{result=await boundReceipt(privateFile,env);}catch{/* Clean unknown is the only fallback. */}
  const bytes=Buffer.from(`${JSON.stringify(projectReceipt(result))}\n`);assert.ok(bytes.length<=65536);
  const temporary=await fs.mkdtemp(path.join(path.dirname(publicFile),'.empty-auth-publish-'));await fs.chmod(temporary,0o700);const staged=path.join(temporary,'receipt');
  // A hard link publishes one complete immutable snapshot without overwriting.
  // Keep staging private for runner teardown, including after a native failure.
  const handle=await fs.open(staged,'wx',0o600);try{await handle.writeFile(bytes);await handle.sync();}finally{await handle.close();}
  await fs.link(staged,publicFile);return result;
}
async function main() {
  const [mode,...args]=process.argv.slice(2);
  assert.ok(args.every(value=>path.isAbsolute(value)));
  if(mode==='guard'&&args.length===3)await guard(...args);
  else if(mode==='run'&&args.length===1)await run(...args);
  else if(mode==='finalize'&&args.length===2)await finalize(...args);
  else throw new Error('invalid command');
}
if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url)main().catch(()=>{console.error('Empty-auth diagnostic validation failed');process.exitCode=1;});
