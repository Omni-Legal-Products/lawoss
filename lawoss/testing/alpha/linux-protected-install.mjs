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
  ['opt-ancestors', {boundary:'opt-trust',tool:null,check:'ancestors'}],
  ['restriction-read', {boundary:'userns-restriction',tool:null,check:'read'}],
  ['initial-policy-presence', {boundary:'initial-policy-presence',tool:null,check:'presence'}],
]);
for(const tool of ['sudo','mkdir','cp','install','rm','cat','parser']) {
  for(const check of ['realpath','ancestors','entry']) {
    preflightSteps.set(`${tool}-${check}`,{boundary:tool==='parser'?'parser-trust':'tool-trust',tool,check});
  }
}
const preflightCodes = new Set(['ENOENT','EACCES','EPERM','ELOOP','ENOTDIR','linux-protected-install-refused','linux-protected-install-unverified']);
export function linuxPreflightFailure(step,error) {
  const observation=preflightSteps.get(step);
  if(!observation)return undefined;
  let errorCode='unknown';
  try {const code=error?.code;if(preflightCodes.has(code))errorCode=code;} catch { /* Diagnostic access cannot replace the primary failure. */ }
  return Object.freeze({...observation,errorCode});
}
export function assertHostedLinuxContext({platform=process.platform,arch=process.arch,uid=process.getuid?.(),euid=process.geteuid?.(),environment=process.env}={}) {
  if(platform!=='linux' || !['x64','arm64'].includes(arch) || !Number.isSafeInteger(uid) || uid<=0 || !Number.isSafeInteger(euid) || euid<=0
    || environment?.GITHUB_ACTIONS!=='true' || environment?.RUNNER_ENVIRONMENT!=='github-hosted')refuse();
}
export function linuxUsernsProfile(stage) {
  if(typeof stage!=='string' || stage.length!==47 || !/^\/opt\/lawoss-ci-[a-f0-9]{32}$/.test(stage))refuse();
  const name=posix.basename(stage),executable=posix.join(stage,'app/legalwork');
  return {name,executable,text:`abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} ${executable} flags=(unconfined) {\n  userns,\n}\n`};
}
async function protectedEntry(path,directory=false) {
  const info=await lstat(path);
  if(info.isSymbolicLink() || info.uid!==0 || (info.mode&0o022)!==0 || (directory?!info.isDirectory():!info.isFile() || info.nlink!==1))fail();
  return info;
}
async function protectedAncestors(path) {
  for(let current=resolve(path);;current=dirname(current)) {
    await protectedEntry(current,true);
    if(dirname(current)===current)break;
  }
  if(await realpath(path)!==resolve(path))fail();
}
/** Filesystem metadata validation only; does not execute or grant an application. */
export async function validateProtectedLinuxTree(root) {
  if(!isAbsolute(root) || resolve(root)!==root)fail();
  await protectedAncestors(root);
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
    const stage=`/opt/lawoss-ci-${randomBytes(16).toString('hex')}`,app=join(stage,'app');
    const policy=linuxUsernsProfile(stage),policyFile=join(stage,'userns.profile');
    let stageIdentity,retained=false,policyState='not-required',stageState='not-created',primary;
    let restricted=false,policyOwned=false,policyUncertain=false,temporary,protectionVerified=false;
    let preflight,preflightFailure;
    try {
      preflight='opt-ancestors';
      await protectedAncestors('/opt');
      // Fixed tools and their canonical targets must also be root protected.
      for(const tool of ['/usr/bin/sudo','/usr/bin/mkdir','/usr/bin/cp','/usr/bin/install','/usr/bin/rm','/usr/bin/cat']) {
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
      await privileged('/usr/bin/mkdir',['--mode=0755','--',stage]);
      stageIdentity=await protectedEntry(stage,true);stageState='created';
      await privileged('/usr/bin/cp',['--recursive','--no-dereference','--preserve=mode','--no-preserve=ownership,xattr','--',`${dirname(source.installedApp)}/.`,app]);
      await validateProtectedLinuxTree(app);
      if(((await lstat(app)).mode&0o7777)!==((await lstat(dirname(source.installedApp))).mode&0o7777))fail();
      const installedApp=join(app,'legalwork');
      const installation=await verifyAlphaInstallation({...artifact,installedApp});
      stageState='protected';protectionVerified=true;
      if(restricted) {
        temporary=await mkdtemp(join(tmpdir(),'lawoss-ci-userns-policy-'));
        const input=join(temporary,'policy');await writeFile(input,policy.text,{flag:'wx',mode:0o600});
        await privileged('/usr/bin/install',['--owner=0','--group=0','--mode=0644','--',input,policyFile]);
        await protectedEntry(policyFile);
        if(await boundedText(policyFile,4096)!==policy.text || await policyPresent(policy.name))fail();
        // A timed out/ambiguous add can still have loaded a kernel policy.
        policyUncertain=true;policyState='loading-uncertain';
        await privileged('/usr/sbin/apparmor_parser',['--add','--skip-cache',policyFile]);
        if(!await policyPresent(policy.name))fail();
        policyOwned=true;policyUncertain=false;policyState='loaded';
      }
      return await use({installedApp,installation,retain(){retained=true;}});
    } catch(error) {primary=error;preflightFailure=linuxPreflightFailure(preflight,error);throw error;}
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
        policyPresenceIsNotAttachmentProof:true,...(preflightFailure?{preflight:preflightFailure}:{})}));
      if(!primary && (cleanupFailure || retained || policyUncertain))fail();
    }
  });
}
