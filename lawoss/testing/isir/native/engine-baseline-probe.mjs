import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { prepareNativeEngineFiles, verifyNativeEngineFiles } from './engine-identity.mjs';

// Private CI experiment only. Original failed job, budgets and engine stay authoritative.
const VERSION='1.18.29', SOURCE='16747470f976aca3d362ad730bcd3fe82ecc2c9a';
const ORIGINAL='32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d';
const TARGET='opencode-x86_64-pc-windows-msvc.exe';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const object=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const names=['Error','TypeError','AssertionError','AggregateError','TimeoutError','AbortError'];
const phases=['setup','startup','configure-provider','native-case','preparation-admission','generation','extra-cases','relaunch','recovery','complete'];
const markers=['instance.create-observed','project.resolve-observed','bootstrap.enter-observed'];
const inputs={
  'package.json':'d05714a1572795feca1cc2723ec12b7b341b0a96a82031a8ef40d4af0e120acf',
  'bun.lock':'e4a33f0dce76bd625ceef88b2fe44cfa75d0653a3ccba0c7066ac558896ff239',
  'packages/opencode/script/build.ts':'c98c068580faac0ebcade9a1179827a24bd3f3102e6c08fef637a0636fa9f19d',
  'packages/opencode/script/generate.ts':'6351777e5e8bf0123f3ef31bc4fd13912ea7800249f130cb4893d8c9e8a16c0a',
  '.github/actions/setup-bun/action.yml':'64f62445839788466383af1313b395785594eed6ae47dcfa4b293c8d8cb65f00',
  'packages/script/src/index.ts':'6f6235de4226d93d55276b7caeee846ccd15ea00eca75a8308680f13dc1ef38a',
};

export function parseBoundedJson(bytes,limit) {
  assert.ok(Buffer.isBuffer(bytes)&&bytes.length<=limit);
  const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text),stack=[];
  // JSON.parse accepts duplicate keys, including escaped aliases. Reject them
  // before interpreting even the selected projection of a same-run artifact.
  const tokens=text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|true|false|null|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g)??[];
  for(const token of tokens) {
    const current=stack.at(-1);
    if(token==='{'){stack.push({keys:new Set(),key:true});continue;}
    if(token==='['){stack.push(null);continue;}
    if(token==='}'||token===']'){stack.pop();continue;}
    if(token===','){if(current)current.key=true;continue;}
    if(token===':'){if(current)current.key=false;continue;}
    if(current?.key&&token.startsWith('"')) {const key=JSON.parse(token);assert.ok(!current.keys.has(key));current.keys.add(key);}
  }
  return value;
}
function safeError(error) {
  assert.ok(object(error)&&names.includes(error.name));
  return {name:error.name}; // Cause/code/message cannot affect this experiment's decision.
}
export function projectBoundary(value) {
  assert.ok(object(value)&&[5,6].includes(value.schema)&&value.mode==='synthetic'&&value.platform==='win32'&&phases.includes(value.phase));
  assert.ok(value.recoveryStage===null||typeof value.recoveryStage==='string'&&value.recoveryStage.length<=40);
  assert.ok(Array.isArray(value.cleanupErrors)&&value.cleanupErrors.length<=32);
  assert.ok(Array.isArray(value.startup)&&value.startup.length<=32&&integer(value.startupDropped));
  assert.ok(Array.isArray(value.requests)&&value.requests.length<=128);
  const startup=value.startup.map(row=>{assert.ok(object(row)&&['request','headers','body','verified'].includes(row.stage)&&integer(row.elapsedMs));return {stage:row.stage,elapsedMs:row.elapsedMs};});
  const requests=value.requests.filter(row=>['engine.path','engine.health'].includes(row?.endpoint)).map(row=>{
    assert.ok(object(row)&&phases.includes(row.phase)&&['pending','headers','failed'].includes(row.state)&&integer(row.elapsedMs));
    assert.ok(row.status===null||Number.isInteger(row.status)&&row.status>=100&&row.status<=599);
    return {phase:row.phase,endpoint:row.endpoint,state:row.state,status:row.status,elapsedMs:row.elapsedMs,...(row.error?{error:safeError(row.error)}:{})};
  });
  const log=value.engineLog;assert.ok(object(log)&&['disabled','unavailable','unsafe','missing','unreadable','available'].includes(log.status));
  assert.ok(typeof log.clockWindowValid==='boolean'&&typeof log.fileChanged==='boolean');
  const counts=['unscannedBytesAtOpen','oversizedLineCount','partialLineCount','malformedCount','timestampOutlierCount','droppedEvents'];
  assert.ok(counts.every(key=>integer(log[key]))&&typeof log.lineLimitReached==='boolean'&&typeof log.eventLimitReached==='boolean');
  assert.ok(Array.isArray(log.events)&&log.events.length<=64);
  const selected=log.events.filter(row=>row?.evidenceScope==='selected-directory'&&markers.includes(row.event)).map(row=>row.event);
  return {schema:value.schema,mode:'synthetic',platform:'win32',phase:value.phase,
    recoveryStage:value.recoveryStage===null?null:'other',...(value.error?{error:safeError(value.error)}:{}),
    cleanupErrors:value.cleanupErrors.map(safeError),startup,startupDropped:value.startupDropped,requests,
    engineLog:{status:log.status,clockWindowValid:log.clockWindowValid,fileChanged:log.fileChanged,
      ...Object.fromEntries(counts.map(key=>[key,log[key]])),lineLimitReached:log.lineLimitReached,eventLimitReached:log.eventLimitReached,selected}};
}
function sameBoundary(main) {
  const log=main.engineLog;
  return main.phase==='startup'&&main.error?.name==='TimeoutError'&&main.recoveryStage===null&&main.cleanupErrors.length===0&&main.startupDropped===0&&
    main.startup.length===1&&main.startup[0].stage==='request'&&
    main.requests.some(row=>row.phase==='startup'&&row.endpoint==='engine.health'&&row.state==='headers'&&row.status===200)&&
    main.requests.some(row=>row.phase==='startup'&&row.endpoint==='engine.path'&&row.state==='failed'&&row.status===null&&row.error?.name==='TimeoutError')&&
    log.status==='available'&&log.clockWindowValid&&!log.fileChanged&&!log.lineLimitReached&&!log.eventLimitReached&&
    ['unscannedBytesAtOpen','oversizedLineCount','partialLineCount','malformedCount','timestampOutlierCount','droppedEvents'].every(key=>log[key]===0)&&markers.every(marker=>log.selected.includes(marker));
}
const complete=main=>main.phase==='complete'&&!main.error&&main.cleanupErrors.length===0;
export function assessOriginal(main,runtime) {
  try {
    const projected=projectBoundary(main);
    if(complete(projected))return {decision:'not-needed',boundary:projected};
    assert.deepEqual(Object.keys(runtime).sort(),['schemaVersion','status','outcome','engineVersion','engineSha256','bunVersion','preloadObserved','elapsedMs'].sort());
    assert.ok(runtime.schemaVersion===1&&runtime.status==='observed'&&runtime.outcome==='observed'&&runtime.engineVersion===VERSION&&runtime.engineSha256===ORIGINAL&&runtime.bunVersion==='1.3.14'&&runtime.preloadObserved===true&&integer(runtime.elapsedMs));
    return {decision:sameBoundary(projected)?'run':'unknown',boundary:projected};
  }catch{return {decision:'unknown'};}
}
export function classifyBaseline(main,code) {
  if(code===0)return complete(main)?'not-reproduced':'unknown';
  if(!Number.isInteger(code)||code===0)return 'unknown';
  return sameBoundary(main)?'boundary-reproduced':'different-boundary';
}
export function privateEnvironment(root,toolDirectory,inherited=process.env) {
  const keys=['PATH','Path','SystemRoot','SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE'];
  const env=Object.fromEntries(keys.filter(key=>inherited[key]!==undefined).map(key=>[key,inherited[key]]));
  const inheritedPath=env.PATH??env.Path??'';delete env.Path;
  return {...env,PATH:`${toolDirectory}${path.delimiter}${inheritedPath}`,CI:'true',
    HOME:path.join(root,'home'),USERPROFILE:path.join(root,'home'),APPDATA:path.join(root,'appdata'),LOCALAPPDATA:path.join(root,'local'),
    XDG_CONFIG_HOME:path.join(root,'config'),XDG_CACHE_HOME:path.join(root,'cache'),XDG_DATA_HOME:path.join(root,'data'),XDG_STATE_HOME:path.join(root,'state'),
    TEMP:path.join(root,'tmp'),TMP:path.join(root,'tmp'),TMPDIR:path.join(root,'tmp'),
    NPM_CONFIG_USERCONFIG:path.join(root,'empty.npmrc'),GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:path.join(root,'empty.gitconfig'),GIT_TERMINAL_PROMPT:'0',
    BUN_INSTALL_CACHE_DIR:path.join(root,'bun-cache')};
}
// Own direct child only. No exit event, arbitrary PID/group, shell or process
// census grants cleanup authority. After timeout even a close cannot prove
// descendant exit; caller stops all later staging/native work and retains files.
export function collectChild(child,{timeoutMs=600000,drainMs=1000,limit=64*1024*1024,capture=false}={}) {
  return new Promise(resolve=>{
    let bytes=0,chunks=[],failure=null,done=false,drain;
    const finish=(closed,code)=>{if(done)return;done=true;clearTimeout(timer);clearTimeout(drain);
      const result={outcome:!closed?'child-unclosed':failure??(code===0?'ok':'child-error'),closed,code:integer(code)?code:null};
      if(capture&&result.outcome==='ok')result.text=Buffer.concat(chunks).toString('utf8');chunks=[];resolve(result);};
    const stop=reason=>{if(done||failure)return;failure=reason;chunks=[];
      if(child.exitCode===null&&child.signalCode===null)try{child.kill('SIGTERM');}catch{/* still require close */}
      drain=setTimeout(()=>{finish(false,null);child.stdout?.destroy();child.stderr?.destroy();child.unref?.();},drainMs);};
    const read=chunk=>{if(done||failure)return;bytes+=chunk.length;if(bytes>limit)return stop('output-limit');if(capture)chunks.push(Buffer.from(chunk));};
    child.stdout?.on('data',read);child.stderr?.on('data',capture?chunk=>{if(chunk.length)stop('invalid-output');}:read);
    child.stdout?.on('error',()=>stop('child-error'));child.stderr?.on('error',()=>stop('child-error'));
    child.on('error',()=>stop('child-error'));child.once('close',code=>finish(true,code));
    const timer=setTimeout(()=>stop('timeout'),timeoutMs);
  });
}
const within=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&relative!=='..'&&!relative.startsWith(`..${path.sep}`)&&!path.isAbsolute(relative);};
async function regular(file,root) {const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink());assert.ok(within(await fs.realpath(root),await fs.realpath(file)));return stat;}
export async function verifyInputs(root,expected) {
  const rows=[];
  for(const name of Object.keys(expected).sort()) {const file=path.resolve(root,name);await regular(file,root);const actual=sha(await fs.readFile(file));assert.equal(actual,expected[name]);rows.push([name,actual]);}
  return sha(JSON.stringify(rows));
}
const sameIdentity=(a,b)=>a.dev===b.dev&&a.ino===b.ino;
export async function stageBaseline({bundle,rebuilt,originalHash,expectedRebuiltHash,move=fs.rename}) {
  assert.equal(await fs.realpath(bundle),bundle);await regular(rebuilt,path.dirname(rebuilt));
  const prepared=await prepareNativeEngineFiles({bundleDir:bundle,platform:'win32',arch:'x64'});
  assert.equal(prepared.path,path.join(bundle,TARGET));assert.equal(prepared.expectedHash,originalHash);
  for(const name of [TARGET,'opencode.exe']) {await regular(path.join(bundle,name),bundle);assert.equal(sha(await fs.readFile(path.join(bundle,name))),originalHash);}
  await verifyNativeEngineFiles(prepared,prepared.path);
  const identity=await fs.lstat(bundle,{bigint:true}),parent=path.dirname(bundle);assert.ok(identity.isDirectory()&&identity.ino>0n);
  const stageSlot=await fs.mkdtemp(path.join(parent,'.engine-baseline-stage-'));const stage=path.join(stageSlot,'sidecars');
  const slot=await fs.mkdtemp(path.join(parent,'.engine-baseline-original-'));const original=path.join(slot,'sidecars');
  await fs.cp(bundle,stage,{recursive:true,errorOnExist:true,force:false});
  const bytes=await fs.readFile(rebuilt),rebuiltHash=sha(bytes);if(expectedRebuiltHash!==undefined)assert.equal(rebuiltHash,expectedRebuiltHash);
  for(const name of [TARGET,'opencode.exe'])await fs.writeFile(path.join(stage,name),bytes);
  for(const manifest of prepared.manifests) {
    const file=path.join(stage,path.basename(manifest.path)),metadata=parseBoundedJson(await fs.readFile(file),65536);
    metadata.opencode={...metadata.opencode,version:VERSION,sha256:rebuiltHash};await fs.writeFile(file,`${JSON.stringify(metadata,null,2)}\n`);
  }
  const candidate=await prepareNativeEngineFiles({bundleDir:stage,platform:'win32',arch:'x64'});
  assert.equal(candidate.expectedHash,rebuiltHash);await verifyNativeEngineFiles(candidate,candidate.path);
  assert.deepEqual(candidate.manifests.map(row=>path.basename(row.path)),prepared.manifests.map(row=>path.basename(row.path)));
  await verifyNativeEngineFiles(prepared,prepared.path);assert.ok(sameIdentity(identity,await fs.lstat(bundle,{bigint:true})));
  await move(bundle,original);
  try {await move(stage,bundle);}
  catch {
    // Two directory renames are not a transaction. Roll back only while the
    // captured directory still owns the backup and destination remains absent.
    const absent=await fs.lstat(bundle).then(()=>false,error=>{if(error.code==='ENOENT')return true;throw error;});
    if(absent&&sameIdentity(identity,await fs.lstat(original,{bigint:true})))await move(original,bundle);
    throw new Error('Bundle staging failed');
  }
  const final=await prepareNativeEngineFiles({bundleDir:bundle,platform:'win32',arch:'x64'});assert.equal(final.expectedHash,rebuiltHash);await verifyNativeEngineFiles(final,final.path);
  return {original,rebuiltHash,originalManifestHash:sha(JSON.stringify(prepared.manifests.map(row=>[path.basename(row.path),row.hash]))),rebuiltManifestHash:sha(JSON.stringify(final.manifests.map(row=>[path.basename(row.path),row.hash])))};
}

async function readJson(file,limit) {const stat=await fs.lstat(file);assert.ok(stat.isFile()&&!stat.isSymbolicLink()&&stat.size<=limit);return parseBoundedJson(await fs.readFile(file),limit);}
const writeJson=(file,value)=>fs.writeFile(file,`${JSON.stringify(value)}\n`,{mode:0o600});
async function executable(name,env) {
  for(const directory of (env.PATH??env.Path??'').split(path.delimiter)) {const file=path.resolve(directory,name);try{if((await fs.stat(file)).isFile())return file;}catch{/* not here */}}
  throw new Error('Required tool missing');
}
async function download(url,file,limit) {
  const response=await fetch(url,{signal:AbortSignal.timeout(30000)});assert.ok(response.ok&&response.body);
  const declared=Number(response.headers.get('content-length'));assert.ok(!Number.isFinite(declared)||declared<=limit);
  const reader=response.body.getReader(),parts=[];let size=0;
  try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;assert.ok(size<=limit);parts.push(Buffer.from(value));}}
  finally{await reader.cancel();reader.releaseLock();}
  const bytes=Buffer.concat(parts);await fs.writeFile(file,bytes,{flag:'wx',mode:0o600});return bytes;
}
export function projectReceipt(value) {
  assert.ok(object(value)&&value.schemaVersion===1&&value.experiment==='unmodified-windows-baseline'&&value.sourceCommit===SOURCE);
  const result=receipt();
  const stages=['original-input','awaiting-lawoss-build','checkout-identity','original-identity','source-checkout','models-freeze','toolchain','toolchain-version','upstream-install','upstream-build','build-inputs-after','rebuilt-identity','bundle-staging','native','complete'];
  assert.ok(stages.includes(value.stage)&&['unknown','not-needed','boundary-reproduced','not-reproduced','different-boundary'].includes(value.outcome));
  assert.ok(['not-run','ok','child-error','child-unclosed','output-limit','timeout','invalid-output','validation-failed'].includes(value.exit));
  Object.assign(result,{stage:value.stage,outcome:value.outcome,exit:value.exit});
  for(const key of ['checkoutCommit','prHeadCommit']) {assert.ok(value[key]===null||/^[a-f0-9]{40}$/.test(value[key]??''));result[key]=value[key];}
  assert.match(value.nodeVersion,/^24\.\d+\.\d+$/);result.nodeVersion=value.nodeVersion;
  assert.ok(value.bunVersion==null||value.bunVersion==='1.3.14');result.bunVersion=value.bunVersion??null;
  for(const key of ['sourceInputsSha256','lockSha256','modelsSha256','toolchainSha256','originalEngineSha256','rebuiltEngineSha256','originalManifestsSha256','rebuiltManifestsSha256']) {
    assert.ok(value[key]==null||/^[a-f0-9]{64}$/.test(value[key]));result[key]=value[key]??null;
  }
  for(const key of ['originalBoundary','rebuiltBoundary']) {
    const boundary=value[key];if(boundary==null)continue;
    assert.ok(Array.isArray(boundary.engineLog?.selected)&&boundary.engineLog.selected.length<=64&&boundary.engineLog.selected.every(row=>markers.includes(row)));
    result[key]=projectBoundary({...boundary,engineLog:{...boundary.engineLog,events:boundary.engineLog.selected.map(event=>({event,evidenceScope:'selected-directory'}))}});
  }
  return result;
}
function receipt() {
  const validSha=v=>/^[a-f0-9]{40}$/.test(v??'')?v:null;
  return {schemaVersion:1,experiment:'unmodified-windows-baseline',outcome:'unknown',stage:'original-input',exit:'not-run',
    sourceCommit:SOURCE,checkoutCommit:validSha(process.env.GITHUB_SHA),prHeadCommit:validSha(process.env.LAWOSS_PR_HEAD),
    nodeVersion:process.versions.node,bunVersion:null,lawossBunVersion:'1.4.2',engineVersion:VERSION,target:'windows-x64-baseline',
    sourceInputsSha256:null,lockSha256:null,modelsSha256:null,toolchainSha256:null,originalEngineSha256:null,rebuiltEngineSha256:null,
    originalManifestsSha256:null,rebuiltManifestsSha256:null,originalBoundary:null,rebuiltBoundary:null,
    releaseModelsParity:'unknown',signatureParity:'unknown',causeEquivalence:'unknown'};
}
async function experiment(output,nativeFile) {
  const result=projectReceipt(await readJson(output,131072));assert.equal(result.experiment,'unmodified-windows-baseline');assert.equal(result.stage,'awaiting-lawoss-build');
  assert.equal(process.env.CI,'true');assert.equal(process.env.GITHUB_ACTIONS,'true');
  assert.equal(process.platform,'win32');assert.equal(process.arch,'x64');assert.equal(process.versions.node.split('.')[0],'24');
  const repo=fileURLToPath(new URL('../../../../',import.meta.url));
  const temp=await fs.realpath(process.env.RUNNER_TEMP);const root=await fs.mkdtemp(path.join(temp,'lawoss-engine-baseline-'));
  const env=privateEnvironment(root,path.dirname(process.execPath));
  for(const key of ['HOME','APPDATA','LOCALAPPDATA','XDG_CONFIG_HOME','XDG_CACHE_HOME','XDG_DATA_HOME','XDG_STATE_HOME','TEMP','BUN_INSTALL_CACHE_DIR'])await fs.mkdir(env[key],{recursive:true});
  await fs.writeFile(env.NPM_CONFIG_USERCONFIG,'',{flag:'wx'});await fs.writeFile(env.GIT_CONFIG_GLOBAL,'',{flag:'wx'});
  const run=async(command,args,cwd,options={})=>{
    const child=spawn(command,args,{cwd,env:options.env??env,windowsHide:true,stdio:['ignore','pipe','pipe']});
    const observed=await collectChild(child,options);
    if(observed.outcome!=='ok') {result.exit=observed.outcome;throw new Error('Owned command did not complete');}
    return observed.text;
  };
  const stage=async(name,operation)=>{result.stage=name;await writeJson(output,result);return operation();};
  try {
    const git=await executable('git.exe',env);
    await stage('checkout-identity',async()=>{const commit=(await run(git,['rev-parse','HEAD'],repo,{capture:true,limit:1024})).trim();assert.equal(commit,result.checkoutCommit);});
    const bundle=path.join(repo,'apps/desktop/resources/sidecars');
    await stage('original-identity',async()=>{
      const normal=await prepareNativeEngineFiles({bundleDir:bundle});assert.equal(normal.expectedHash,ORIGINAL);await verifyNativeEngineFiles(normal,normal.path);
      assert.equal((await run(normal.path,['--version'],root,{capture:true,limit:1024,timeoutMs:5000})).trim(),VERSION);
      await verifyNativeEngineFiles(normal,normal.path);result.originalEngineSha256=normal.expectedHash;result.originalManifestsSha256=sha(JSON.stringify(normal.manifests.map(row=>[path.basename(row.path),row.hash])));
    });
    const upstream=path.join(root,'upstream');await fs.mkdir(upstream);
    await stage('source-checkout',async()=>{
      await run(git,['init','--quiet'],upstream);
      await run(git,['-c','credential.helper=','fetch','--quiet','--depth=1','https://github.com/anomalyco/opencode.git',SOURCE],upstream);
      await run(git,['checkout','--quiet','--detach','FETCH_HEAD'],upstream);
      assert.equal((await run(git,['rev-parse','HEAD'],upstream,{capture:true,limit:1024})).trim(),SOURCE);
      await run(git,['diff','--quiet','HEAD','--'],upstream);
      await verifyInputs(upstream,inputs);
    });
    const sourceInputs={...inputs};
    const pkg=await readJson(path.join(upstream,'package.json'),65536);assert.equal(pkg.packageManager,'bun@1.3.14');
    for(const name of Object.values(pkg.patchedDependencies)) {
      assert.ok(typeof name==='string'&&name.startsWith('patches/')&&!name.includes('..'));await regular(path.join(upstream,name),upstream);sourceInputs[name]=sha(await fs.readFile(path.join(upstream,name)));
    }
    result.sourceInputsSha256=await verifyInputs(upstream,sourceInputs);result.lockSha256=inputs['bun.lock'];
    const models=path.join(root,'models.dev.json');
    await stage('models-freeze',async()=>{const bytes=await download('https://models.dev/api.json',models,8*1024*1024);assert.ok(object(parseBoundedJson(bytes,8*1024*1024)));result.modelsSha256=sha(bytes);});
    const toolchain=path.join(root,'toolchain');await fs.mkdir(toolchain);
    const zip=path.join(root,'bun.zip');
    await stage('toolchain',async()=>{
      await download('https://github.com/oven-sh/bun/releases/download/bun-v1.3.14/bun-windows-x64-baseline.zip',zip,64*1024*1024);
      const systemRoot=env.SystemRoot??env.SYSTEMROOT;assert.match(systemRoot??'',/^[a-z]:\\Windows$/i);
      const powershell=path.join(systemRoot,'System32/WindowsPowerShell/v1.0/powershell.exe');
      // Paths are newly allocated owned values, passed as argv to a fixed script.
      await run(powershell,['-NoProfile','-NonInteractive','-Command','& { param($a,$b) Expand-Archive -LiteralPath $a -DestinationPath $b }',zip,toolchain],root);
    });
    const bun=path.join(toolchain,'bun-windows-x64-baseline/bun.exe');await regular(bun,root);
    const buildEnv={...privateEnvironment(root,path.dirname(bun)),OPENCODE_VERSION:VERSION,OPENCODE_CHANNEL:'latest',MODELS_DEV_API_JSON:models};
    assert.equal(buildEnv.OPENCODE_RELEASE,undefined);
    await stage('toolchain-version',async()=>{assert.equal((await run(bun,['--version'],upstream,{capture:true,limit:1024,env:buildEnv,timeoutMs:5000})).trim(),'1.3.14');result.bunVersion='1.3.14';result.toolchainSha256=sha(await fs.readFile(bun));});
    await stage('upstream-install',()=>run(bun,['install','--frozen-lockfile','--linker','hoisted'],upstream,{env:buildEnv}));
    await verifyInputs(upstream,sourceInputs);await run(git,['diff','--quiet','HEAD','--'],upstream);
    await stage('upstream-build',()=>run(bun,['run','packages/opencode/script/build.ts','--single','--baseline'],upstream,{env:buildEnv}));
    await stage('build-inputs-after',async()=>{await verifyInputs(upstream,sourceInputs);await run(git,['diff','--quiet','HEAD','--'],upstream);assert.equal(sha(await fs.readFile(models)),result.modelsSha256);assert.equal(sha(await fs.readFile(bun)),result.toolchainSha256);});
    const rebuilt=path.join(upstream,'packages/opencode/dist/opencode-windows-x64-baseline/bin/opencode.exe');
    await stage('rebuilt-identity',async()=>{await regular(rebuilt,upstream);assert.equal((await run(rebuilt,['--version'],root,{capture:true,limit:1024,timeoutMs:5000})).trim(),VERSION);result.rebuiltEngineSha256=sha(await fs.readFile(rebuilt));});
    await stage('bundle-staging',async()=>{const staged=await stageBaseline({bundle,rebuilt,originalHash:ORIGINAL,expectedRebuiltHash:result.rebuiltEngineSha256});result.originalManifestsSha256=staged.originalManifestHash;result.rebuiltManifestsSha256=staged.rebuiltManifestHash;assert.equal(staged.rebuiltHash,result.rebuiltEngineSha256);});
    await stage('native',async()=>{
      const nativeEnv={...env,NODE_OPTIONS:'--max-old-space-size=6144',LAWOSS_ISIR_NATIVE_DIAGNOSTICS:'1',LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE:nativeFile};
      const child=spawn(process.execPath,[path.join(repo,'scripts/test-isir-native.mjs')],{cwd:repo,env:nativeEnv,windowsHide:true,stdio:['ignore','pipe','pipe']});
      const observed=await collectChild(child,{timeoutMs:12*60*1000});result.exit=observed.outcome;
      if(!observed.closed||!['ok','child-error'].includes(observed.outcome))throw new Error('Native lifecycle unknown');
      const projected=projectBoundary(await readJson(nativeFile,256*1024));result.rebuiltBoundary=projected;
      result.outcome=classifyBaseline(projected,observed.code);
      await writeJson(nativeFile,projected); // Publish only our second explicit projection.
    });
    result.stage='complete';
  }catch {result.outcome='unknown';if(result.exit==='not-run')result.exit='validation-failed';}
  // Retain all private work on every outcome. VM teardown owns any descendants;
  // top-level child close never grants deletion authority over the whole tree.
  await writeJson(output,result);
}
async function main() {
  assert.equal(process.versions.node.split('.')[0],'24');
  const [mode,output,nativeFile,runtimeFile]=process.argv.slice(2);assert.ok(path.isAbsolute(output));
  if(mode==='guard') {
    const result=receipt();let assessed={decision:'unknown'};
    try {const main=await readJson(nativeFile,256*1024);let runtime;try{runtime=await readJson(runtimeFile,4096);}catch{/* main pass needs no runtime */}assessed=assessOriginal(main,runtime);}catch{/* fixed unknown */}
    result.originalBoundary=assessed.boundary??null;result.outcome=assessed.decision==='not-needed'?'not-needed':'unknown';
    result.stage=assessed.decision==='run'?'awaiting-lawoss-build':'original-input';await writeJson(output,result);
    if(process.env.GITHUB_OUTPUT)await fs.appendFile(process.env.GITHUB_OUTPUT,`run=${assessed.decision==='run'}\n`);
  }else if(mode==='run')await experiment(output,nativeFile);
  else if(mode==='finalize') {
    let result;try{result=projectReceipt(await readJson(output,131072));}catch{result=receipt();}
    // A killed process may leave a partial/raw native file. Recreate publication
    // only from the bounded selected projection held in the provenance receipt.
    await fs.rm(nativeFile,{force:true});
    if(result.rebuiltBoundary)await writeJson(nativeFile,result.rebuiltBoundary);
    await writeJson(output,result);
  }else throw new Error('Unknown mode');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(()=>{process.stderr.write('Windows engine baseline could not complete its bounded receipt.\n');process.exitCode=1;});
}
