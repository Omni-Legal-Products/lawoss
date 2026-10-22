// Disposable hosted CI only. Copy the trusted candidate as data; never run it as root.
import { execFile } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, open, readdir, readlink, realpath, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

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
export function linuxOperationFailure(operation,error,root,rootMetadata) {
  if(!installationOperations.has(operation))return undefined;
  let errorCode='unknown';
  try {const code=Object.getOwnPropertyDescriptor(error,'code')?.value;if(preflightCodes.has(code))errorCode=code;}catch { /* Observation cannot replace the primary. */ }
  const filesystem=operation==='tree-validation'?treeFilesystemFailure(error,root):undefined;
  const rootAccess=filesystem?rootAccessSnapshot(rootMetadata):undefined;
  return Object.freeze({operation,errorCode,...(filesystem?{filesystem}:{}),...(rootAccess?{rootAccess}:{})});
}
export function linuxPreflightFailure(step,error,refusal) {
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
  return Object.freeze({...observation,errorCode,...(stageTrust?{stageTrust}:{})});
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
  const predicate=info.isSymbolicLink()?'symlink':info.uid!==0?'owner':(info.mode&0o022)!==0?'writable':
    (directory?!info.isDirectory():!info.isFile() || info.nlink!==1)?'type':undefined;
  if(predicate) {noteRefusal(observe,predicate);fail();}
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
/** Filesystem metadata validation only; does not execute or grant an application. */
export async function validateProtectedLinuxTree(root,{onRootMetadata}={}) {
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
        if(isAbsolute(target) || !inside(root,resolve(directory,target)) || !inside(root,await realpath(path)))fail();
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
    let preflight,preflightFailure,stageTrustRefusal,operation,operationFailure,rootMetadata;
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
      for(const tool of ['/usr/bin/sudo','/usr/bin/mkdir','/usr/bin/cp','/usr/bin/chmod','/usr/bin/install','/usr/bin/rm','/usr/bin/cat']) {
        const label=posix.basename(tool);
        preflight=`${label}-realpath`;
        const physical=await realpath(tool);
        preflight=`${label}-ancestors`;
        await protectedAncestors(dirname(physical));
        preflight=`${label}-entry`;
        await protectedEntry(physical);
      }
      preflight='restriction-read';
      restricted=await usernsRestriction();
      if(restricted) {
        preflight='parser-realpath';
        const parser=await realpath('/usr/sbin/apparmor_parser');
        preflight='parser-ancestors';
        await protectedAncestors(dirname(parser));
        preflight='parser-entry';
        await protectedEntry(parser);
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
      await validateProtectedLinuxTree(app,{onRootMetadata:value=>{rootMetadata=value;}});
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
    } catch(error) {primary=error;preflightFailure=linuxPreflightFailure(preflight,error,stageTrustRefusal);operationFailure=linuxOperationFailure(operation,error,app,rootMetadata);throw error;}
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
