// Disposable hosted CI only. Copy the trusted candidate as data; never run it as root.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify, types } from 'node:util';

const refuse = () => { throw Object.assign(new Error('linux-protected-install-refused'), {code:'linux-protected-install-refused'}); };
const fail = () => { throw Object.assign(new Error('linux-protected-install-unverified'), {code:'linux-protected-install-unverified'}); };
const inside = (root,path) => { const rel=relative(root,path);return rel==='' || !isAbsolute(rel) && rel!=='..' && !rel.startsWith(`..${sep}`); };
const same = (a,b) => a.dev===b.dev && a.ino===b.ino;
const preflightSteps = new Map([
  ['stage-ancestors', {boundary:'stage-trust',tool:null,check:'ancestors'}],
  ['restriction-read', {boundary:'userns-restriction',tool:null,check:'read'}],
  ['initial-policy-presence', {boundary:'initial-policy-presence',tool:null,check:'presence'}],
]);
for(const tool of ['sudo','mkdir','cp','chmod','install','rm','cat','parser']) {
  for(const check of ['realpath','ancestors','entry']) {
    preflightSteps.set(`${tool}-${check}`,{boundary:tool==='parser'?'parser-trust':'tool-trust',tool,check});
  }
}
const preflightCodes = new Set(['ENOENT','EACCES','EPERM','ELOOP','ENOTDIR','linux-protected-install-refused','linux-protected-install-unverified']);
const stageAncestors = new Set(['var-lib','var','root']);
const stagePredicates = new Set(['symlink','owner','writable','type','canonical']);
const installationOperations = new Set(['stage-create','stage-bind','tree-copy','tree-validation','root-mode','installed-tree',
  'policy-input','policy-install','policy-validation','policy-load','policy-presence-after-load','native-use']);
const filesystemActions = new Set(['scandir','lstat','realpath','readlink']);
function canonicalPosixPath(value) {
  return typeof value==='string' && value.length<=4096 && !/[\\\x00-\x1f\x7f-\x9f]/.test(value)
    && posix.isAbsolute(value) && posix.normalize(value)===value && (value==='/' || !value.endsWith('/'));
}
function treeFilesystemFailure(error,root) {
  if(!canonicalPosixPath(root) || root==='/')return undefined;
  let action='unknown',scope='unknown',depth=null;
  try {
    const syscall=Object.getOwnPropertyDescriptor(error,'syscall')?.value;
    if(typeof syscall==='string' && syscall.length<=8 && filesystemActions.has(syscall))action=syscall;
  } catch { /* Never invoke an error getter or replace the primary. */ }
  try {
    const filename=Object.getOwnPropertyDescriptor(error,'path')?.value;
    if(canonicalPosixPath(filename)) {
      if(filename===root) {scope='payload-root';depth=0;}
      else if(filename.startsWith(`${root}/`)) {
        const components=filename.slice(root.length+1).split('/').length;
        if(components<=129) {scope='payload-descendant';depth=components;}
      } else if(filename==='/' || root.startsWith(`${filename}/`))scope='payload-ancestor';
    }
  } catch { /* Paths are lexical observations only, never filesystem proof. */ }
  return Object.freeze({action,scope,depth});
}
function rootAccessSnapshot(value) {
  try {
    if(!value || typeof value!=='object')return undefined;
    const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
    if(keys.length!==3 || !['modeBits','otherRead','otherSearch'].every(key=>Object.hasOwn(fields,key) && Object.hasOwn(fields[key],'value')))return undefined;
    const modeBits=fields.modeBits.value,otherRead=fields.otherRead.value,otherSearch=fields.otherSearch.value;
    if(!Number.isInteger(modeBits) || modeBits<0 || modeBits>0o777 || otherRead!==!!(modeBits&0o004) || otherSearch!==!!(modeBits&0o001))return undefined;
    return Object.freeze({modeBits,otherRead,otherSearch});
  } catch {return undefined;}
}
// Closed own-data records only. Reject even transparent/revoked proxies before
// reflection, so optional metadata never executes foreign traps or getters.
function linkRecord(value,keys,optional=[]) {
  if(!value || typeof value!=='object' || types.isProxy(value))return undefined;
  const prototype=Object.getPrototypeOf(value);
  if(prototype!==Object.prototype && prototype!==null)return undefined;
  const fields=Object.getOwnPropertyDescriptors(value),actual=Reflect.ownKeys(fields);
  if(actual.length<keys.length || actual.length>keys.length+optional.length || !keys.every(key=>Object.hasOwn(fields,key))
    || !actual.every(key=>(keys.includes(key) || optional.includes(key)) && Object.hasOwn(fields[key],'value')))return undefined;
  return fields;
}
function linkResolutionSnapshot(value) {
  try {
    const fields=linkRecord(value,['entry','lexicalTarget']);
    if(!fields)return undefined;
    const entry=linkRecord(fields.entry.value,['scope','depth']),target=linkRecord(fields.lexicalTarget.value,['scope','depth']);
    if(!entry || !target)return undefined;
    const entryScope=entry.scope.value,entryDepth=entry.depth.value,targetScope=target.scope.value,targetDepth=target.depth.value;
    const descendantDepth=depth=>Number.isInteger(depth) && depth>=1 && depth<=129;
    if(entryScope!=='payload-descendant' || !descendantDepth(entryDepth) ||
      !(targetScope==='payload-root' && targetDepth===0 || targetScope==='payload-descendant' && descendantDepth(targetDepth) || targetScope==='unknown' && targetDepth===null))return undefined;
    return Object.freeze({entry:Object.freeze({scope:entryScope,depth:entryDepth}),lexicalTarget:Object.freeze({scope:targetScope,depth:targetDepth})});
  } catch {return undefined;}
}
function linkCallsiteSnapshot(root,entry,target) {
  if(!canonicalPosixPath(root) || root==='/' || !canonicalPosixPath(entry) || !entry.startsWith(`${root}/`))return undefined;
  const depth=entry.slice(root.length+1).split('/').length;
  if(depth<1 || depth>129)return undefined;
  let scope='unknown',targetDepth=null;
  if(canonicalPosixPath(target)) {
    if(target===root){scope='payload-root';targetDepth=0;}
    else if(target.startsWith(`${root}/`)) {
      const components=target.slice(root.length+1).split('/').length;
      if(components<=129){scope='payload-descendant';targetDepth=components;}
    }
  }
  return Object.freeze({entry:Object.freeze({scope:'payload-descendant',depth}),lexicalTarget:Object.freeze({scope,depth:targetDepth})});
}
const targetReadCodes=new Set(['EACCES','EPERM','ENOENT','ENOTDIR','ELOOP','unknown']);
const trustedSampleDirectory=record=>record.kind==='directory' && record.rootOwned && (record.modeBits&0o022)===0;
function linkTargetContextSnapshot(value,targetDepth) {
  try {
    const fields=linkRecord(value,['sampling','prefixes','stop']);
    if(!fields || fields.sampling.value!=='post-failure')return undefined;
    const input=fields.prefixes.value;
    if(types.isProxy(input) || !Array.isArray(input) || Object.getPrototypeOf(input)!==Array.prototype)return undefined;
    const elements=Object.getOwnPropertyDescriptors(input),keys=Reflect.ownKeys(elements),length=elements.length?.value;
    if(!Number.isInteger(length) || length<0 || length>16 || length>targetDepth || keys.length!==length+1)return undefined;
    const prefixes=[];
    for(let index=0;index<length;index++) {
      if(!Object.hasOwn(elements,index) || !Object.hasOwn(elements[index],'value'))return undefined;
      const record=linkRecord(elements[index].value,['depth','kind','modeBits','rootOwned']);
      if(!record)return undefined;
      const depth=record.depth.value,kind=record.kind.value,modeBits=record.modeBits.value,rootOwned=record.rootOwned.value;
      if(depth!==index+1 || !['directory','regular','symlink','other'].includes(kind) || !Number.isInteger(modeBits) || modeBits<0 || modeBits>511 || typeof rootOwned!=='boolean')return undefined;
      const sample={depth,kind,modeBits,rootOwned};
      if(index<length-1 && !trustedSampleDirectory(sample))return undefined;
      prefixes.push(Object.freeze(sample));
    }
    const stopFields=linkRecord(fields.stop.value,['reason','depth'],['errorCode']);
    if(!stopFields)return undefined;
    const reason=stopFields.reason.value,depth=stopFields.depth.value,errorCode=stopFields.errorCode?.value;
    if(reason!=='read-error' && Object.hasOwn(stopFields,'errorCode'))return undefined;
    const last=prefixes[length-1],allTrusted=!last || trustedSampleDirectory(last);
    if(reason==='complete') {
      if(!last || depth!==length || length!==targetDepth || !(last.kind==='regular' || trustedSampleDirectory(last)))return undefined;
    } else if(['symlink','non-directory','untrusted-directory','unsupported-type'].includes(reason)) {
      if(!last || depth!==length)return undefined;
      if(reason==='symlink' && last.kind!=='symlink' ||
        reason==='non-directory' && (!(last.kind==='regular' || last.kind==='other') || length>=targetDepth) ||
        reason==='untrusted-directory' && (last.kind!=='directory' || trustedSampleDirectory(last)) ||
        reason==='unsupported-type' && (last.kind!=='other' || length!==targetDepth))return undefined;
    } else if(reason==='read-error' || reason==='malformed') {
      if(length>=16 || depth!==length+1 || depth>targetDepth || !allTrusted || reason==='read-error' && !targetReadCodes.has(errorCode))return undefined;
    } else if(reason==='cap') {
      if(length!==16 || depth!==17 || targetDepth<=16 || !allTrusted)return undefined;
    } else if(reason==='unavailable') {
      if(length!==0 || depth!==null)return undefined;
    } else return undefined;
    return Object.freeze({sampling:'post-failure',prefixes:Object.freeze(prefixes),stop:Object.freeze({reason,depth,...(reason==='read-error'?{errorCode}:{})})});
  } catch {return undefined;}
}
// These are post-failure lexical samples, not the original denied component or
// effective access. Path-based lstat can race ancestor replacement; only call
// count is bounded. Never descend after a sampled trust/type failure.
async function sampleLinkTarget(root,target,targetDepth) {
  const components=target.slice(root.length+1).split('/'),prefixes=[];
  const finish=(reason,depth,errorCode)=>Object.freeze({sampling:'post-failure',prefixes:Object.freeze(prefixes),stop:Object.freeze({reason,depth,...(reason==='read-error'?{errorCode}:{})})});
  let path=root;
  for(let depth=1;depth<=targetDepth;depth++) {
    if(depth>16)return finish('cap',depth);
    path+=`/${components[depth-1]}`;
    let info;
    try {info=await lstat(path);}catch(error) {
      let errorCode='unknown';
      try {if(!types.isProxy(error)){const code=Object.getOwnPropertyDescriptor(error,'code')?.value;if(targetReadCodes.has(code))errorCode=code;}}catch { /* No foreign getters or raw error strings. */ }
      return finish('read-error',depth,errorCode);
    }
    let fields;
    try {if(info && typeof info==='object' && !types.isProxy(info))fields=Object.getOwnPropertyDescriptors(info);}catch { /* Malformed metadata is a stop, not authority. */ }
    const mode=fields && Object.hasOwn(fields,'mode')?fields.mode.value:undefined,uid=fields && Object.hasOwn(fields,'uid')?fields.uid.value:undefined;
    if(!Number.isSafeInteger(mode) || mode<0 || mode>0xffffffff || !Number.isSafeInteger(uid) || uid<0 || uid>0xffffffff)return finish('malformed',depth);
    const type=mode&constants.S_IFMT,kind=type===constants.S_IFDIR?'directory':type===constants.S_IFREG?'regular':type===constants.S_IFLNK?'symlink':'other';
    const sample=Object.freeze({depth,kind,modeBits:mode&0o777,rootOwned:uid===0});
    prefixes.push(sample);
    if(kind==='symlink')return finish('symlink',depth);
    if(kind==='directory' && !trustedSampleDirectory(sample))return finish('untrusted-directory',depth);
    if(depth===targetDepth)return finish(kind==='other'?'unsupported-type':'complete',depth);
    if(kind!=='directory')return finish('non-directory',depth);
  }
}
export function linuxOperationFailure(operation,error,root,rootMetadata,linkMetadata,targetMetadata) {
  if(!installationOperations.has(operation))return undefined;
  let errorCode='unknown';
  try {const code=Object.getOwnPropertyDescriptor(error,'code')?.value;if(preflightCodes.has(code))errorCode=code;}catch { /* Observation cannot replace the primary. */ }
  const filesystem=operation==='tree-validation'?treeFilesystemFailure(error,root):undefined;
  const rootAccess=filesystem?rootAccessSnapshot(rootMetadata):undefined;
  const linkResolution=filesystem?.action==='realpath' && errorCode!=='unknown'?linkResolutionSnapshot(linkMetadata):undefined;
  const linkTargetContext=errorCode==='EACCES' && linkResolution?.lexicalTarget.scope==='payload-descendant'?linkTargetContextSnapshot(targetMetadata,linkResolution.lexicalTarget.depth):undefined;
  return Object.freeze({operation,errorCode,...(filesystem?{filesystem}:{}),...(rootAccess?{rootAccess}:{}),...(linkResolution?{linkResolution}:{}),...(linkTargetContext?{linkTargetContext}:{})});
}
function linkCountSnapshot(value) {
  try {
    const fields=linkRecord(value,['value','capped']);
    if(!fields)return undefined;
    const count=fields.value.value,capped=fields.capped.value;
    if(!Number.isSafeInteger(count) || count<0 || count>65535 || count===1 || typeof capped!=='boolean' || capped && count!==65535)return undefined;
    return Object.freeze({value:count,capped});
  } catch {return undefined;}
}
function toolRefusalSnapshot(value) {
  try {
    if(!value || typeof value!=='object')return undefined;
    const fields=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(fields);
    if(!Object.hasOwn(fields,'predicate') || !Object.hasOwn(fields.predicate,'value'))return undefined;
    const predicate=fields.predicate.value;
    if(['symlink','owner','writable'].includes(predicate) && keys.length===1)return Object.freeze({predicate});
    if(predicate!=='type' || !Object.hasOwn(fields,'typeDetail') || !Object.hasOwn(fields.typeDetail,'value'))return undefined;
    const typeDetail=fields.typeDetail.value;
    if(keys.length===2 && (typeDetail==='non-regular' || typeDetail==='link-count'))return Object.freeze({predicate,typeDetail});
    if(keys.length===3 && typeDetail==='link-count' && Object.hasOwn(fields,'linkCount') && Object.hasOwn(fields.linkCount,'value')) {
      const linkCount=linkCountSnapshot(fields.linkCount.value);
      return Object.freeze({predicate,typeDetail,...(linkCount?{linkCount}:{})});
    }
  } catch { /* Reflection failures omit diagnostics without changing the guard. */ }
  return undefined;
}
export function linuxPreflightFailure(step,error,refusal,toolRefusal) {
  const observation=preflightSteps.get(step);
  if(!observation)return undefined;
  let errorCode='unknown';
  try {const code=error?.code;if(preflightCodes.has(code))errorCode=code;} catch { /* Diagnostic access cannot replace the primary failure. */ }
  let stageTrust;
  if(step==='stage-ancestors' && errorCode==='linux-protected-install-unverified') {
    try {
      const ancestor=refusal?.ancestor,predicate=refusal?.predicate;
      if(stageAncestors.has(ancestor) && stagePredicates.has(predicate) && !(ancestor!=='var-lib' && predicate==='canonical'))stageTrust=Object.freeze({ancestor,predicate});
    } catch { /* Refusal metadata cannot replace the primary failure. */ }
  }
  const toolTrust=observation.check==='entry' && errorCode==='linux-protected-install-unverified'?toolRefusalSnapshot(toolRefusal):undefined;
  return Object.freeze({...observation,errorCode,...(stageTrust?{stageTrust}:{}),...(toolTrust?{toolTrust}:{})});
}
export function assertHostedLinuxContext({platform=process.platform,arch=process.arch,uid=process.getuid?.(),euid=process.geteuid?.(),environment=process.env}={}) {
  if(platform!=='linux' || !['x64','arm64'].includes(arch) || !Number.isSafeInteger(uid) || uid<=0 || !Number.isSafeInteger(euid) || euid<=0
    || environment?.GITHUB_ACTIONS!=='true' || environment?.RUNNER_ENVIRONMENT!=='github-hosted')refuse();
}
export function linuxUsernsProfile(stage) {
  if(typeof stage!=='string' || stage.length!==51 || !/^\/var\/lib\/lawoss-ci-[a-f0-9]{32}$/.test(stage))refuse();
  const name=posix.basename(stage),executable=posix.join(stage,'app/legalwork');
  return {name,executable,text:`abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} ${executable} flags=(unconfined) {\n  userns,\n}\n`};
}
function noteRefusal(observe,...args) {
  try {observe?.(...args);}catch { /* Observation cannot change admission or its original exception. */ }
}
async function protectedEntry(path,directory=false,observe) {
  const info=await lstat(path);
  // Same short-circuit predicates and cached lstat record as admission originally
  // used; no additional filesystem read or permission change for diagnostics.
  let typeDetail,cachedLinkCount;
  const predicate=info.isSymbolicLink()?'symlink':info.uid!==0?'owner':(info.mode&0o022)!==0?'writable':
    (directory?!info.isDirectory():!info.isFile()?(typeDetail='non-regular',true):(cachedLinkCount=info.nlink)!==1?(typeDetail='link-count',true):false)?'type':undefined;
  if(predicate) {
    let linkCount;
    if(typeDetail==='link-count' && Number.isSafeInteger(cachedLinkCount) && cachedLinkCount>=0) {
      try {linkCount=Object.freeze({value:Math.min(cachedLinkCount,65535),capped:cachedLinkCount>65535});}catch { /* Optional observation only. */ }
    }
    if(linkCount)noteRefusal(observe,predicate,typeDetail,linkCount);
    else noteRefusal(observe,predicate,typeDetail);
    fail();
  }
  return info;
}
async function protectedAncestors(path,observe) {
  let rootInfo;
  for(let current=resolve(path);;current=dirname(current)) {
    const info=await protectedEntry(current,true,observe?predicate=>noteRefusal(observe,current,predicate):undefined);
    rootInfo??=info;
    if(dirname(current)===current)break;
  }
  if(await realpath(path)!==resolve(path)) {noteRefusal(observe,path,'canonical');fail();}
  return rootInfo;
}
const toolPaths=new Map([
  ['sudo','/usr/bin/sudo'],['mkdir','/usr/bin/mkdir'],['cp','/usr/bin/cp'],['chmod','/usr/bin/chmod'],
  ['install','/usr/bin/install'],['rm','/usr/bin/rm'],['cat','/usr/bin/cat'],['parser','/usr/sbin/apparmor_parser'],
]);
// Private fixed-tool metadata sequence only; observers grant no execution authority.
async function protectedToolPreflight(label,onStep,onRefusal) {
  const tool=toolPaths.get(label);
  if(!tool)fail();
  noteRefusal(onStep,`${label}-realpath`);
  const physical=await realpath(tool);
  noteRefusal(onStep,`${label}-ancestors`);
  await protectedAncestors(dirname(physical));
  noteRefusal(onStep,`${label}-entry`);
  return await protectedEntry(physical,false,onRefusal);
}
/** Filesystem metadata validation only; does not execute or grant an application. */
export async function validateProtectedLinuxTree(root,{onRootMetadata,onLinkResolutionFailure,onLinkTargetContext}={}) {
  if(!isAbsolute(root) || resolve(root)!==root)fail();
  const info=await protectedAncestors(root);
  const modeBits=info.mode&0o777;
  noteRefusal(onRootMetadata,Object.freeze({modeBits,otherRead:!!(modeBits&0o004),otherSearch:!!(modeBits&0o001)}));
  let count=0;
  async function visit(directory,depth=0) {
    if(depth>128)fail();
    for(const name of await readdir(directory)) {
      if(++count>100000)fail();
      const path=join(directory,name),info=await lstat(path);
      if(info.uid!==0)fail();
      if(info.isSymbolicLink()) {
        const target=await readlink(path);
        if(isAbsolute(target))fail();
        const lexicalTarget=resolve(directory,target);
        if(!inside(root,lexicalTarget))fail();
        let physicalTarget;
        try {physicalTarget=await realpath(path);}
        catch(error) {
          let eligible=false,snapshot;
          if(typeof onLinkTargetContext==='function') {
            try {eligible=!types.isProxy(error) && Object.getOwnPropertyDescriptor(error,'code')?.value==='EACCES';}catch { /* No new authority from foreign error metadata. */ }
          }
          try {
            snapshot=linkCallsiteSnapshot(root,path,lexicalTarget);
            if(snapshot)noteRefusal(onLinkResolutionFailure,snapshot);
          } catch { /* Snapshot construction cannot replace the original error. */ }
          if(eligible && snapshot?.lexicalTarget.scope==='payload-descendant') {
            try {noteRefusal(onLinkTargetContext,await sampleLinkTarget(root,lexicalTarget,snapshot.lexicalTarget.depth));}catch { /* Optional sampling cannot replace the primary error. */ }
          }
          throw error;
        }
        if(!inside(root,physicalTarget))fail();
      } else if(info.isDirectory()) {await protectedEntry(path,true);await visit(path,depth+1);}
      else {await protectedEntry(path);if(info.mode&0o6000)fail();}
    }
  }
  await visit(root);
}
async function boundedText(path,maximum) {
  const info=await lstat(path);
  if(!info.isFile() || info.isSymbolicLink() || info.nlink!==1)fail();
  const handle=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
  try {
    if(!same(info,await handle.stat()))fail();
    const bytes=Buffer.alloc(maximum+1),{bytesRead}=await handle.read(bytes,0,bytes.length,0);
    if(bytesRead>maximum)fail();
    return bytes.subarray(0,bytesRead).toString('utf8');
  } finally {await handle.close();}
}
async function privileged(tool,args) {
  // Do not search PATH or invoke a shell; command output is private and bounded.
  try {return (await promisify(execFile)('/usr/bin/sudo',['--non-interactive','--',tool,...args],{
    timeout:120000,maxBuffer:65536,encoding:'utf8',env:{PATH:'/usr/sbin:/usr/bin:/sbin:/bin',LANG:'C',LC_ALL:'C'},
  })).stdout;} catch {fail();}
}
async function copyProtectedLinuxTree(sourceRoot,app,stageIdentity,onOperation) {
  async function appRootIdentity() {
    await protectedAncestors(app);
    const info=await lstat(app,{bigint:true});
    if(!info.isDirectory() || info.uid!==0n || (info.mode&0o022n)!==0n)fail();
    return info;
  }
  if(!same(stageIdentity,await protectedAncestors(dirname(app))))fail();
  // Exclusive creation binds this container before cp can preserve source mode.
  // Never merge into or adopt an existing app entry, even inside an owned stage.
  await privileged('/usr/bin/mkdir',['--mode=0755','--',app]);
  const appIdentity=await appRootIdentity();
  await privileged('/usr/bin/cp',['--recursive','--no-dereference','--preserve=mode','--no-preserve=ownership,xattr','--',`${sourceRoot}/.`,app]);
  onOperation('root-mode');
  if(!same(appIdentity,await appRootIdentity()) || !same(stageIdentity,await protectedEntry(dirname(app),true)))fail();
  // Explicit installation-container policy replaces extraction-root mode equality.
  // Only this bound root becomes 0755; source and descendant metadata stay exact.
  await privileged('/usr/bin/chmod',['0755','--',app]);
  const installedRoot=await appRootIdentity();
  if(!same(appIdentity,installedRoot) || !same(stageIdentity,await protectedEntry(dirname(app),true)) || (installedRoot.mode&0o7777n)!==0o755n)fail();
}
async function policyPresent(name) {
  // Kernel policy listing requires AppArmor policy-view privilege. Read only
  // this fixed file; retain bounded text privately and return one boolean.
  const text=await privileged('/usr/bin/cat',['--','/sys/kernel/security/apparmor/profiles']);
  return text.split('\n').some(line=>line===name || line.startsWith(`${name} (`));
}
async function usernsRestriction() {
  try {
    const value=(await boundedText('/proc/sys/kernel/apparmor_restrict_unprivileged_userns',64)).trim();
    if(!['0','1'].includes(value))fail();return value==='1';
  } catch(error) {if(error.code==='ENOENT')return false;throw error;}
}

export async function withProtectedLinuxArtifact(artifact,use) {
  assertHostedLinuxContext();
  if(artifact.platform!=='linux' || artifact.arch!==process.arch || !artifact.asset.endsWith('.AppImage'))refuse();
  const {withExtractedAlphaArtifact,verifyAlphaInstallation}=await import('./installed-artifact.mjs');
  return withExtractedAlphaArtifact(artifact,async source=>{
    const stage=`/var/lib/lawoss-ci-${randomBytes(16).toString('hex')}`,app=join(stage,'app');
    const policy=linuxUsernsProfile(stage),policyFile=join(stage,'userns.profile');
    let stageIdentity,retained=false,policyState='not-required',stageState='not-created',primary;
    let restricted=false,policyOwned=false,policyUncertain=false,temporary,protectionVerified=false;
    let preflight,preflightFailure,stageTrustRefusal,toolTrustRefusal,operation,operationFailure,rootMetadata,linkMetadata,linkTargetContext;
    try {
      preflight='stage-ancestors';
      // Hosted image scripts make /opt world-writable. Select a fixed different
      // parent; never repair shared permissions or relax protected ancestry.
      await protectedAncestors('/var/lib',(ancestor,predicate)=>{
        // This observer runs only for the three fixed initial ancestors, before
        // the same original refusal. Never retain an arbitrary filesystem path.
        stageTrustRefusal={ancestor:ancestor==='/var/lib'?'var-lib':ancestor==='/var'?'var':ancestor==='/'?'root':'unknown',predicate};
      });
      // Fixed tools and their canonical targets must also be root protected.
      for(const label of ['sudo','mkdir','cp','chmod','install','rm','cat']) {
        toolTrustRefusal=undefined;
        await protectedToolPreflight(label,value=>{preflight=value;},(predicate,typeDetail,linkCount)=>{
          toolTrustRefusal=typeDetail?{predicate,typeDetail,...(linkCount?{linkCount}:{})}:{predicate};
        });
      }
      preflight='restriction-read';
      restricted=await usernsRestriction();
      if(restricted) {
        toolTrustRefusal=undefined;
        await protectedToolPreflight('parser',value=>{preflight=value;},(predicate,typeDetail,linkCount)=>{
          toolTrustRefusal=typeDetail?{predicate,typeDetail,...(linkCount?{linkCount}:{})}:{predicate};
        });
        preflight='initial-policy-presence';
        if(await policyPresent(policy.name))fail();
        policyState='not-loaded';
      }
      preflight=undefined;
      // Failure may occur after mkdir had an effect. Never adopt or delete an
      // unbound stage, and never describe an ambiguous creation as absent.
      stageState='creation-uncertain';
      operation='stage-create';
      await privileged('/usr/bin/mkdir',['--mode=0755','--',stage]);
      operation='stage-bind';
      stageIdentity=await protectedEntry(stage,true);stageState='created';
      operation='tree-copy';
      await copyProtectedLinuxTree(dirname(source.installedApp),app,stageIdentity,value=>{operation=value;});
      operation='tree-validation';
      await validateProtectedLinuxTree(app,{onRootMetadata:value=>{rootMetadata=value;},onLinkResolutionFailure:value=>{linkMetadata=value;},onLinkTargetContext:value=>{linkTargetContext=value;}});
      const installedApp=join(app,'legalwork');
      operation='installed-tree';
      const installation=await verifyAlphaInstallation({...artifact,installedApp});
      stageState='protected';protectionVerified=true;
      if(restricted) {
        operation='policy-input';
        temporary=await mkdtemp(join(tmpdir(),'lawoss-ci-userns-policy-'));
        const input=join(temporary,'policy');await writeFile(input,policy.text,{flag:'wx',mode:0o600});
        operation='policy-install';
        await privileged('/usr/bin/install',['--owner=0','--group=0','--mode=0644','--',input,policyFile]);
        operation='policy-validation';
        await protectedEntry(policyFile);
        if(await boundedText(policyFile,4096)!==policy.text || await policyPresent(policy.name))fail();
        // A timed out/ambiguous add can still have loaded a kernel policy.
        policyUncertain=true;policyState='loading-uncertain';
        operation='policy-load';
        await privileged('/usr/sbin/apparmor_parser',['--add','--skip-cache',policyFile]);
        operation='policy-presence-after-load';
        if(!await policyPresent(policy.name))fail();
        policyOwned=true;policyUncertain=false;policyState='loaded';
      }
      operation='native-use';
      return await use({installedApp,installation,retain(){retained=true;}});
    } catch(error) {primary=error;preflightFailure=linuxPreflightFailure(preflight,error,stageTrustRefusal,toolTrustRefusal);operationFailure=linuxOperationFailure(operation,error,app,rootMetadata,linkMetadata,linkTargetContext);throw error;}
    finally {
      let cleanupFailure;
      try {
        if(retained || policyUncertain)stageState=stageIdentity?'retained':stageState;
        else if(stageIdentity) {
          if(!same(stageIdentity,await protectedEntry(stage,true)))fail();
          if(policyOwned) {
            await protectedEntry(policyFile);
            if(await boundedText(policyFile,4096)!==policy.text || !await policyPresent(policy.name))fail();
            policyState='removal-uncertain';
            await privileged('/usr/sbin/apparmor_parser',['--remove','--skip-cache',policyFile]);
            if(await policyPresent(policy.name))fail();
            policyState='removed';
          }
          await privileged('/usr/bin/rm',['--recursive','--force','--one-file-system','--',stage]);
          try {await lstat(stage);fail();}catch(error){if(error.code!=='ENOENT')throw error;}
          stageState='removed';
        }
      } catch {cleanupFailure=true;stageState=stageIdentity?'retained':stageState;}
      if(temporary)await rm(temporary,{recursive:true,force:true}).catch(()=>{});
      console.log(JSON.stringify({kind:'lawoss-ci-linux-protected-installation',assetSha256:artifact.expectedSha256,
        protection:protectionVerified?'verified':'not-verified',policy:policyState,
        installationCleanup:stageState,retentionRequested:retained,
        policyPresenceIsNotAttachmentProof:true,...(preflightFailure?{preflight:preflightFailure}:{}),...(operationFailure?{operationFailure}:{})}));
      if(!primary && (cleanupFailure || retained || policyUncertain))fail();
    }
  });
}
