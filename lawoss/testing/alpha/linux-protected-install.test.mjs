import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readlink, readdir, realpath, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertHostedLinuxContext, linuxPreflightFailure, linuxUsernsProfile, validateProtectedLinuxTree } from './linux-protected-install.mjs';
import * as protectedInstall from './linux-protected-install.mjs';

const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
const context = { platform: 'linux', arch: 'x64', uid: 1000, euid: 1000, environment };
const stage = `/var/lib/lawoss-ci-${'a'.repeat(32)}`;
const refused = { code: 'linux-protected-install-refused' };
const unverified = { code: 'linux-protected-install-unverified' };

const toolRefusals = [{predicate:'symlink'},{predicate:'owner'},{predicate:'writable'},
  {predicate:'type',typeDetail:'non-regular'},{predicate:'type',typeDetail:'link-count'}];

test('tool-entry observation freezes only five closed shapes on exact eligible steps', () => {
  for(const tool of ['sudo','mkdir','cp','chmod','install','rm','cat','parser']) for(const input of toolRefusals) {
    const mutable={...input},error=Object.assign(new Error('private message'),unverified);
    const descriptors=Object.getOwnPropertyDescriptors(error);
    const value=linuxPreflightFailure(`${tool}-entry`,error,{ancestor:'var-lib',predicate:'owner'},mutable);
    assert.deepEqual(value,{boundary:tool==='parser'?'parser-trust':'tool-trust',tool,check:'entry',errorCode:unverified.code,toolTrust:input});
    assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.toolTrust),true);
    mutable.predicate='private';assert.deepEqual(value.toolTrust,input);
    assert.deepEqual(Object.getOwnPropertyDescriptors(error),descriptors);
    assert.doesNotMatch(JSON.stringify(value),/private|Stats|path|uid|mode|nlink/);
  }
});

test('tool-entry observation rejects malformed own data without getters or unrelated inspection', () => {
  let reads=0;
  const accessor={};Object.defineProperty(accessor,'predicate',{get(){reads++;return 'owner';},enumerable:true});
  const detailAccessor={predicate:'type'};Object.defineProperty(detailAccessor,'typeDetail',{get(){reads++;return 'non-regular';},enumerable:true});
  const throws=new Proxy({}, {ownKeys(){reads++;throw new Error('private');}});
  for(const input of [undefined,null,1,'owner',[],{},Object.create({predicate:'owner'}),accessor,detailAccessor,
    {predicate:new String('owner')},{predicate:'unknown'},{predicate:'type'},{predicate:'type',typeDetail:'other'},
    {predicate:'owner',typeDetail:'non-regular'},{predicate:'owner',path:'/private'},
    {predicate:'type',typeDetail:'link-count',nlink:2},{predicate:'owner',[Symbol('private')]:true}]) {
    assert.equal(Object.hasOwn(linuxPreflightFailure('mkdir-entry',unverified,undefined,input),'toolTrust'),false);
  }
  assert.equal(reads,0);
  assert.equal(Object.hasOwn(linuxPreflightFailure('mkdir-entry',unverified,undefined,throws),'toolTrust'),false);
  assert.equal(reads,1);reads=0;
  const unrelated=new Proxy({}, {get(){reads++;throw 0;},ownKeys(){reads++;throw 0;},getOwnPropertyDescriptor(){reads++;throw 0;}});
  for(const step of [undefined,'unknown','mkdir-entry-more','mkdir-realpath','mkdir-ancestors','restriction-read','initial-policy-presence','stage-ancestors']) {
    const value=linuxPreflightFailure(step,unverified,undefined,unrelated);
    assert.equal(value && Object.hasOwn(value,'toolTrust'),value?false:undefined);
  }
  for(const code of ['ENOENT','EACCES','EPERM','ELOOP','ENOTDIR','linux-protected-install-refused','unknown']) {
    const value=linuxPreflightFailure('mkdir-entry',{code},unrelated,unrelated);
    assert.equal(Object.hasOwn(value,'toolTrust'),false);
  }
  for(const input of toolRefusals) {
    const value=linuxPreflightFailure('mkdir-entry',unverified,unrelated,input);
    assert.deepEqual(value.toolTrust,input);
  }
  assert.equal(reads,0);
  assert.deepEqual(linuxPreflightFailure('stage-ancestors',unverified,{ancestor:'var-lib',predicate:'type'},unrelated),
    {boundary:'stage-trust',tool:null,check:'ancestors',errorCode:unverified.code,stageTrust:{ancestor:'var-lib',predicate:'type'}});
  assert.equal(reads,0);
  assert.deepEqual(linuxPreflightFailure('mkdir-entry',unverified),{boundary:'tool-trust',tool:'mkdir',check:'entry',errorCode:unverified.code});
});

// POSIX metadata model on every host: exact production bytes, no native proof.
async function productionToolMetadataFixture(moduleUrl,guardOnly,initialPathModel) {
  const assert=(await import('node:assert/strict')).default;
  const fs=(await import('node:fs/promises')).default;
  const nativeFs=(await import('node:fs')).default;
  const childProcess=(await import('node:child_process')).default;
  const nativePath=(await import('node:path')).default;
  const {syncBuiltinESMExports}=await import('node:module');
  const source=await fs.readFile(new URL(moduleUrl),'utf8');
  const pathMembers=['dirname','isAbsolute','join','relative','resolve','sep'];
  const posixPath=Object.fromEntries(pathMembers.map(key=>[key,nativePath.posix[key]]));
  const win32Path=Object.fromEntries(pathMembers.map(key=>[key,nativePath.win32[key]]));
  if(initialPathModel==='win32')Object.assign(nativePath,win32Path);
  // Capture before mutation: the default path object aliases a platform model.
  Object.assign(nativePath,posixPath);
  const labels=['sudo','mkdir','cp','chmod','install','rm','cat','parser'];
  const logical=['/usr/bin/sudo','/usr/bin/mkdir','/usr/bin/cp','/usr/bin/chmod','/usr/bin/install','/usr/bin/rm','/usr/bin/cat','/usr/sbin/apparmor_parser'];
  const targets=labels.map(label=>`/lawoss-metadata-fixture/bin/${label}`);
  const ancestors=['/lawoss-metadata-fixture/bin','/lawoss-metadata-fixture','/'];
  let unexpected=0,events=[],record,refusedAncestor=false,canonical=false,realpathError,lstatError;
  const reject=()=>{unexpected++;throw new Error('unexpected operation');};
  // Deny all other filesystem and subprocess functions before source import.
  for(const object of [nativeFs,fs,childProcess]) for(const key of Object.keys(object)) if(typeof object[key]==='function')Object.defineProperty(object,key,{value:reject,writable:true,configurable:true,enumerable:true});
  const directory=()=>({isSymbolicLink:()=>false,uid:0,mode:0o755,isDirectory:()=>true});
  fs.lstat=async filename=>{
    if(!targets.includes(filename) && !ancestors.includes(filename))return reject();
    events.push(`lstat:${filename}`);
    if(targets.includes(filename)) {if(lstatError)throw lstatError;return record;}
    if(refusedAncestor && filename==='/lawoss-metadata-fixture')return {...directory(),uid:1};
    return directory();
  };
  fs.realpath=async filename=>{
    if(!logical.includes(filename) && !ancestors.includes(filename))return reject();
    events.push(`realpath:${filename}`);
    if(realpathError)throw realpathError;
    if(logical.includes(filename))return targets[logical.indexOf(filename)];
    return canonical?'/unexpected-canonical-result':filename;
  };
  syncBuiltinESMExports();
  const modeledPath=await import('node:path');
  for(const key of pathMembers)assert.equal(modeledPath[key],posixPath[key]);
  const production=await import(`data:text/javascript;base64,${Buffer.from(`${source}\nexport { protectedEntry${guardOnly?'':', protectedToolPreflight'} };`).toString('base64')}`);
  function input(kind) {
    const fields={symlink:false,uid:0,mode:0o755,isFile:true,nlink:1,isDirectory:true};
    Object.assign(fields,{
      symlink:{symlink:true},owner:{uid:1},writable:{mode:0o777},'non-regular':{isFile:false},
      'link-zero':{nlink:0},'link-many':{nlink:2},directory:{isDirectory:false},
    }[kind]);
    return {
      isSymbolicLink(){events.push('symlink');return fields.symlink;},
      get uid(){events.push('uid');return fields.uid;},
      get mode(){events.push('mode');return fields.mode;},
      isFile(){events.push('isFile');return fields.isFile;},
      get nlink(){events.push('nlink');return fields.nlink;},
      isDirectory(){events.push('isDirectory');return fields.isDirectory;},
    };
  }
  const cases=[
    ['symlink',['symlink'],['symlink',undefined]],
    ['owner',['symlink','uid'],['owner',undefined]],
    ['writable',['symlink','uid','mode'],['writable',undefined]],
    ['non-regular',['symlink','uid','mode','isFile'],['type','non-regular']],
    ['link-zero',['symlink','uid','mode','isFile','nlink'],['type','link-count']],
    ['link-many',['symlink','uid','mode','isFile','nlink'],['type','link-count']],
    ['directory',['symlink','uid','mode','isDirectory'],['type',undefined]],
    ['admitted',['symlink','uid','mode','isFile','nlink'],undefined],
  ];
  let guards=0,helpers=0;
  for(const [kind,reads,expected] of cases) {
    record=input(kind);events=[];const observations=[];
    const error=await production.protectedEntry(targets[1],kind==='directory',(predicate,typeDetail)=>{observations.push([predicate,typeDetail]);throw new Error('observer');}).then(value=>{assert.equal(value,record);return null;},error=>error);
    assert.deepEqual(events,[`lstat:${targets[1]}`,...reads]);
    assert.deepEqual(observations,expected?[expected]:[]);
    if(expected)assert.equal(error.code,'linux-protected-install-unverified');else assert.equal(error,null);
    guards++;
  }
  lstatError=Object.assign(new Error('private lstat'),{code:'EACCES'});events=[];
  await assert.rejects(production.protectedEntry(targets[1],false,()=>reject()),error=>error===lstatError);
  assert.deepEqual(events,[`lstat:${targets[1]}`]);lstatError=undefined;guards++;
  if(!guardOnly) {
    const expectedPrefix=index=>[`step:${labels[index]}-realpath`,`realpath:${logical[index]}`,
      `step:${labels[index]}-ancestors`,...ancestors.map(value=>`lstat:${value}`),
      'realpath:/lawoss-metadata-fixture/bin',`step:${labels[index]}-entry`,`lstat:${targets[index]}`];
    for(let index=0;index<labels.length;index++)for(const [kind,reads,expected] of cases.filter(value=>value[0]!=='directory')) {
      record=input(kind);events=[];let step,refusal;
      const error=await production.protectedToolPreflight(labels[index],value=>{step=value;events.push(`step:${value}`);},(predicate,typeDetail)=>{
        refusal=typeDetail?{predicate,typeDetail}:{predicate};
      }).then(()=>null,error=>error);
      assert.deepEqual(events,[...expectedPrefix(index),...reads]);
      if(expected) {
        const descriptors=Object.getOwnPropertyDescriptors(error);
        const result=production.linuxPreflightFailure(step,error,undefined,refusal);
        assert.deepEqual(result.toolTrust,expected[1]?{predicate:expected[0],typeDetail:expected[1]}:{predicate:expected[0]});
        assert.equal(result.boundary,labels[index]==='parser'?'parser-trust':'tool-trust');
        assert.equal(result.tool,labels[index]);assert.equal(result.check,'entry');
        assert.equal(Object.isFrozen(result.toolTrust),true);
        assert.deepEqual(Object.getOwnPropertyDescriptors(error),descriptors);
        refusal.predicate='private';assert.notEqual(result.toolTrust.predicate,'private');
        assert.doesNotMatch(JSON.stringify(result),/private|fixture|uid|mode|nlink/);
      } else {assert.equal(error,null);assert.equal(refusal,undefined);}
      helpers++;
    }
    // Step/refusal callbacks can throw on both admission and each refusal.
    for(const kind of ['admitted','symlink','owner','writable','non-regular','link-zero']) {
      record=input(kind);events=[];let refusal;
      const error=await production.protectedToolPreflight('mkdir',()=>{throw new Error('step observer');},(...args)=>{refusal=args;throw new Error('refusal observer');}).then(()=>null,error=>error);
      if(kind==='admitted')assert.equal(error,null);else {assert.equal(error.code,'linux-protected-install-unverified');assert.ok(refusal);}
      assert.equal(events.filter(value=>value===`lstat:${targets[1]}`).length,1);helpers++;
    }
    realpathError=Object.assign(new Error('private realpath'),{code:'ELOOP'});events=[];
    await assert.rejects(production.protectedToolPreflight('mkdir',()=>{throw 1;},()=>reject()),error=>error===realpathError);
    assert.deepEqual(events,[`realpath:${logical[1]}`]);realpathError=undefined;helpers++;
    lstatError=Object.assign(new Error('private entry lstat'),{code:'EPERM'});record=input('admitted');events=[];
    await assert.rejects(production.protectedToolPreflight('mkdir',()=>{throw 1;},()=>reject()),error=>error===lstatError);
    assert.deepEqual(events,[`realpath:${logical[1]}`,...ancestors.map(value=>`lstat:${value}`),'realpath:/lawoss-metadata-fixture/bin',`lstat:${targets[1]}`]);
    lstatError=undefined;helpers++;
    for(const rejection of ['ancestor','canonical']) {
      refusedAncestor=rejection==='ancestor';canonical=rejection==='canonical';events=[];let step,refusal;
      const error=await production.protectedToolPreflight('mkdir',value=>{step=value;},value=>{refusal=value;}).then(()=>null,error=>error);
      assert.equal(error.code,'linux-protected-install-unverified');assert.equal(step,'mkdir-ancestors');assert.equal(refusal,undefined);
      assert.equal(events.includes(`lstat:${targets[1]}`),false);
      assert.equal(Object.hasOwn(production.linuxPreflightFailure(step,error,undefined,refusal),'toolTrust'),false);
      helpers++;
    }
    refusedAncestor=false;canonical=false;events=[];
    await assert.rejects(production.protectedToolPreflight('unrecognized'),{code:'linux-protected-install-unverified'});
    assert.deepEqual(events,[]);helpers++;
  }
  assert.equal(unexpected,0);
  console.log(JSON.stringify({guardCases:guards,helperCases:helpers,unexpectedOperations:unexpected,source:'unaltered-plus-private-exports',metadata:'modeled-only'}));
}

for(const guardOnly of [true,false]) for(const initialPathModel of (guardOnly?[undefined]:[undefined,'win32'])) test(`tool-entry ${guardOnly?'guard preserves cached predicate order':'production helper executes all fixed tool metadata paths'}${initialPathModel?' with initial Win32 path model':''}`, t => {
  const child=spawnSync(process.execPath,['--input-type=module'],{
    input:`await (${productionToolMetadataFixture.toString()})(${JSON.stringify(new URL('./linux-protected-install.mjs',import.meta.url).href)},${guardOnly},${JSON.stringify(initialPathModel)});`,
    encoding:'utf8',timeout:10000,maxBuffer:65536,
  });
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,'');
  assert.deepEqual(JSON.parse(child.stdout),{guardCases:9,helperCases:guardOnly?0:67,unexpectedOperations:0,source:'unaltered-plus-private-exports',metadata:'modeled-only'});
  t.diagnostic(child.stdout.trim());
});

test('failed tree validation freezes only admitted root permission bits', () => {
  const root='/PRIVATE/app', primary=Object.assign(new Error('private'),{code:'EACCES',syscall:'scandir',path:root});
  const metadata={modeBits:0o700,otherRead:false,otherSearch:false};
  const observed=protectedInstall.linuxOperationFailure('tree-validation',primary,root,metadata);
  assert.deepEqual(observed,{operation:'tree-validation',errorCode:'EACCES',
    filesystem:{action:'scandir',scope:'payload-root',depth:0},rootAccess:metadata});
  metadata.modeBits=0o755;
  assert.equal(observed.rootAccess.modeBits,0o700);
  assert.equal(Object.isFrozen(observed.rootAccess),true);
  assert.equal(primary.code,'EACCES');
  assert.doesNotMatch(JSON.stringify(observed),/PRIVATE|private|uid|owner|acl|effective/);
});

test('root access projection accepts only closed consistent own data and bounded mode bits', () => {
  const root='/payload/app',error={code:'EACCES'};
  for(const metadata of [
    {modeBits:0,otherRead:false,otherSearch:false},
    {modeBits:0o004,otherRead:true,otherSearch:false},
    {modeBits:0o001,otherRead:false,otherSearch:true},
    {modeBits:0o755,otherRead:true,otherSearch:true},
    {modeBits:0o777,otherRead:true,otherSearch:true},
  ])assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',error,root,metadata).rootAccess,metadata);
  let reads=0;
  const accessor={otherRead:false,otherSearch:false};Object.defineProperty(accessor,'modeBits',{enumerable:true,get(){reads++;return 0o700;}});
  for(const metadata of [undefined,null,{},accessor,Object.create({modeBits:0o700,otherRead:false,otherSearch:false}),
    {modeBits:-1,otherRead:false,otherSearch:false},{modeBits:0o1000,otherRead:false,otherSearch:false},
    {modeBits:1.5,otherRead:false,otherSearch:false},{modeBits:'448',otherRead:false,otherSearch:false},
    {modeBits:NaN,otherRead:false,otherSearch:false},{modeBits:0o700,otherRead:true,otherSearch:false},
    {modeBits:0o700,otherRead:false,otherSearch:1},{modeBits:0o700,otherRead:false,otherSearch:false,path:'/private'},
    {...{modeBits:0o700,otherRead:false,otherSearch:false},[Symbol('private')]:true},
  ])assert.equal(Object.hasOwn(protectedInstall.linuxOperationFailure('tree-validation',error,root,metadata),'rootAccess'),false);
  assert.equal(reads,0);
});

test('root metadata is never inspected for unrelated operations or invalid root context', () => {
  let reads=0;
  const metadata=new Proxy({}, {ownKeys(){reads++;throw new Error('Do not inspect unrelated metadata');}});
  for(const operation of [undefined,'private','tree-copy','root-mode','native-use']) {
    const result=protectedInstall.linuxOperationFailure(operation,{code:'EACCES'},'/payload/app',metadata);
    assert.equal(result && Object.hasOwn(result,'rootAccess'),result?false:undefined);
  }
  for(const root of [undefined,'relative','/','/payload/../app','/payload/app/'])
    assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',{code:'EACCES'},root,metadata),{operation:'tree-validation',errorCode:'EACCES'});
  assert.equal(reads,0);
});

test('root metadata observer is not called before actual ownership and ancestor guards pass', async t => {
  const {payload}=await temporaryTree(t);
  let observations=0;
  await assert.rejects(validateProtectedLinuxTree(payload,{onRootMetadata(){observations++;throw new Error('Observer must not run');}}),unverified);
  assert.equal(observations,0);
});

test('root access projection preserves the exact actual ordinary-user scandir error', {
  skip:process.platform==='win32' || !(process.getuid?.()>0 && process.geteuid?.()>0)
    ? 'Ordinary POSIX owned fixture only; this does not claim root-owned admission' : false,
}, async t => {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'lawoss-root-mode-error-')));
  t.after(()=>rm(root,{recursive:true,force:true}));
  let primary,fields,observed;
  try {
    await chmod(root,0o000);
    const info=await lstat(root),modeBits=info.mode&0o777;
    await assert.rejects(async()=>{
      try {await readdir(root);}
      catch(error){
        primary=error;fields=Object.getOwnPropertyDescriptors(error);
        observed=protectedInstall.linuxOperationFailure('tree-validation',error,root,
          {modeBits,otherRead:!!(modeBits&0o004),otherSearch:!!(modeBits&0o001)});
        throw error;
      }
    },error=>error===primary && error.code==='EACCES');
    assert.deepEqual(observed.rootAccess,{modeBits:0,otherRead:false,otherSearch:false});
    assert.deepEqual(observed.filesystem,{action:'scandir',scope:'payload-root',depth:0});
    assert.deepEqual(Object.getOwnPropertyDescriptors(primary),fields);
  } finally {await chmod(root,0o700);}
});

test('protected installation freezes the failed post-preflight operation before an unrelated cleanup error', () => {
  const primary = Object.assign(new Error('private payload path'), { code: 'EACCES' });
  const observed = protectedInstall.linuxOperationFailure?.('tree-validation', primary);
  primary.code = 'EPERM';
  assert.deepEqual(observed, { operation: 'tree-validation', errorCode: 'EACCES' });
  assert.equal(Object.isFrozen(observed), true);
  assert.equal(protectedInstall.linuxOperationFailure?.(undefined, primary), undefined);
  assert.equal(protectedInstall.linuxOperationFailure?.('/private/path', primary), undefined);
});

test('post-preflight observations cannot read accessors, inherited codes or arbitrary error text', () => {
  let codeReads=0,messageReads=0;
  const error = Object.create({ code: 'EACCES' });
  Object.defineProperty(error, 'message', { get() { messageReads++;throw new Error('Private text read'); } });
  Object.defineProperty(error, 'code', { get() { codeReads++;throw new Error('Accessor read'); } });
  assert.deepEqual(protectedInstall.linuxOperationFailure?.('installed-tree', error), { operation: 'installed-tree', errorCode: 'unknown' });
  assert.deepEqual(protectedInstall.linuxOperationFailure?.('tree-copy', Object.create({ code: 'EACCES' })), { operation: 'tree-copy', errorCode: 'unknown' });
  assert.equal(codeReads,0);assert.equal(messageReads,0);
});

test('tree filesystem projection preserves an actual ordinary-user readdir EACCES', {
  skip: process.platform === 'win32' || !(process.getuid?.() > 0 && process.geteuid?.() > 0)
    ? 'Requires ordinary-user POSIX directory permissions; no root-positive claim' : false,
}, async () => {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-tree-error-')));
  const denied = path.join(root, 'PRIVATE-denied');
  await mkdir(denied);
  let primary, originalFields, observation;
  try {
    await chmod(denied, 0o000);
    await assert.rejects(async () => {
      try { await readdir(denied); }
      catch (error) {
        primary = error;
        originalFields = Object.getOwnPropertyDescriptors(error);
        observation = protectedInstall.linuxOperationFailure('tree-validation', error, denied);
        throw error;
      }
    }, error => error === primary && error.code === 'EACCES');
    assert.deepEqual(observation, { operation:'tree-validation',errorCode:'EACCES',
      filesystem:{action:'scandir',scope:'payload-root',depth:0} });
    assert.deepEqual(Object.getOwnPropertyDescriptors(primary), originalFields);
    assert.doesNotMatch(JSON.stringify(observation), /PRIVATE|denied|path|syscall/);
  } finally {
    await chmod(denied, 0o700);
    await rm(root, { recursive:true,force:true });
  }
});

test('tree filesystem projection reports only allowlisted actions and bounded lexical scopes', () => {
  const root = '/PRIVATE-PAYLOAD/app';
  for (const action of ['scandir','lstat','realpath','readlink']) {
    for (const [filename,scope,depth] of [
      [root,'payload-root',0], [`${root}/nested/file`,'payload-descendant',2],
      [`${root}/${Array(129).fill('n').join('/')}`,'payload-descendant',129],
      [`${root}/${Array(130).fill('n').join('/')}`,'unknown',null],
      ['/PRIVATE-PAYLOAD','payload-ancestor',null], ['/','payload-ancestor',null],
      ['/PRIVATE-PAYLOAD/app-sibling/file','unknown',null], ['/elsewhere','unknown',null],
    ]) {
      const value = protectedInstall.linuxOperationFailure('tree-validation', {code:'EACCES',syscall:action,path:filename}, root);
      assert.deepEqual(value, {operation:'tree-validation',errorCode:'EACCES',filesystem:{action,scope,depth}});
      assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value.filesystem),true);
    }
  }
});

test('tree filesystem projection refuses invalid context and ignores unrelated operations without reading private fields', () => {
  let reads=0;
  const error={code:'EACCES',get path(){reads++;return '/private';},get syscall(){reads++;return 'scandir';}};
  for (const root of [undefined,null,{},42,'','/','relative','/root/','/root//app','/root/../app',
    '/root/./app','/root\napp','/root\u007fapp','/root\u0085app','/root\\app',`/${'x'.repeat(4096)}`]) {
    assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',error,root),{operation:'tree-validation',errorCode:'EACCES'});
  }
  const unrelated=new Proxy(error,{getOwnPropertyDescriptor(target,key){
    if(key==='path' || key==='syscall')reads++;
    return Reflect.getOwnPropertyDescriptor(target,key);
  }});
  for (const operation of ['tree-copy','installed-tree','native-use']) {
    assert.deepEqual(protectedInstall.linuxOperationFailure(operation,unrelated,'/payload/app'),{operation,errorCode:'EACCES'});
  }
  assert.equal(reads,0);
});

test('tree filesystem projection rejects malformed paths and never infers an action from error text', () => {
  const root='/payload/app';
  for (const filename of [undefined,null,{},42,'relative','/payload/app/','/payload//app/file',
    '/payload/app/../other','/payload/app/./file','/payload/app/PRIVATE\nfile','/payload/app/PRIVATE\u007ffile',
    '/payload/app/PRIVATE\u0085file','/payload/app/PRIVATE\\file',`/${'x'.repeat(4096)}`]) {
    assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',{code:'EACCES',syscall:'scandir',path:filename},root).filesystem,
      {action:'scandir',scope:'unknown',depth:null});
  }
  for (const action of [undefined,null,{},42,'SCANDIR','scandir\n','open','scandir /PRIVATE']) {
    assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',{code:'EACCES',syscall:action,path:root},root).filesystem,
      {action:'unknown',scope:'payload-root',depth:0});
  }
  assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',new Error('EACCES scandir /payload/app'),root).filesystem,
    {action:'unknown',scope:'unknown',depth:null});
});

test('tree filesystem projection uses own data only and freezes fields before later error changes', () => {
  let reads=0;
  const root='/payload/app',error=Object.create({syscall:'scandir',path:root});
  error.code='EACCES';
  for (const key of ['syscall','path','message','cause','stack']) Object.defineProperty(error,key,{get(){reads++;return key==='syscall'?'scandir':root;}});
  assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',error,root),{operation:'tree-validation',errorCode:'EACCES',
    filesystem:{action:'unknown',scope:'unknown',depth:null}});
  assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',Object.create({code:'EACCES',syscall:'scandir',path:root}),root),
    {operation:'tree-validation',errorCode:'unknown',filesystem:{action:'unknown',scope:'unknown',depth:null}});
  assert.equal(reads,0);
  const original={code:'EACCES',syscall:'scandir',path:root,private:'SECRET'};
  const result=protectedInstall.linuxOperationFailure('tree-validation',original,root);
  original.code='EPERM';original.syscall='readlink';original.path='/elsewhere';
  assert.equal(JSON.stringify(result),'{"operation":"tree-validation","errorCode":"EACCES","filesystem":{"action":"scandir","scope":"payload-root","depth":0}}');
  assert.throws(()=>{result.filesystem.scope='PRIVATE';},TypeError);
  const coercible={toString(){reads++;return root;}};
  assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',{code:'EACCES',syscall:coercible,path:coercible},root).filesystem,
    {action:'unknown',scope:'unknown',depth:null});
  assert.deepEqual(protectedInstall.linuxOperationFailure('tree-validation',error,coercible),{operation:'tree-validation',errorCode:'EACCES'});
  assert.equal(reads,0);
});

test('protected Linux preflight publishes a finite failed guard without changing the original error', () => {
  const error = Object.assign(new Error('private source and command content'), { code: 'EACCES' });
  assert.deepEqual(linuxPreflightFailure('stage-ancestors', error), {
    boundary: 'stage-trust', tool: null, check: 'ancestors', errorCode: 'EACCES',
  });
  assert.equal(error.message, 'private source and command content');
  assert.equal(error.code, 'EACCES');
});

test('protected Linux stage trust identifies only the fixed ancestor and its first rejected predicate', () => {
  assert.deepEqual(linuxPreflightFailure('stage-ancestors', unverified, {
    ancestor:'var-lib',predicate:'owner',path:'/private/source',uid:1000,mode:511,
  }), {
    boundary:'stage-trust',tool:null,check:'ancestors',errorCode:'linux-protected-install-unverified',
    stageTrust:{ancestor:'var-lib',predicate:'owner'},
  });
});

test('protected Linux stage trust accepts only reachable finite ancestor predicates and freezes them', () => {
  for(const ancestor of ['var-lib','var','root'])for(const predicate of ['symlink','owner','writable','type','canonical']) {
    if(ancestor!=='var-lib' && predicate==='canonical')continue;
    const result=linuxPreflightFailure('stage-ancestors',unverified,{ancestor,predicate});
    assert.deepEqual(result.stageTrust,{ancestor,predicate});
    assert.equal(Object.isFrozen(result.stageTrust),true);
    assert.throws(()=>{result.stageTrust.predicate='private';},TypeError);
  }
  for(const refusal of [undefined,null,{}, {ancestor:'/var/lib',predicate:'owner'},
    {ancestor:'root',predicate:'canonical'}, {ancestor:'var',predicate:'canonical'}, {ancestor:'var-lib/private',predicate:'type'},
    {ancestor:'var-lib',predicate:'owner\n'}, {ancestor:new String('var-lib'),predicate:'owner'},
    {ancestor:'var-lib',predicate:{}}, {get ancestor(){throw Error('private');}},
    {ancestor:'var-lib',get predicate(){throw Error('private');}}]) {
    assert.equal(linuxPreflightFailure('stage-ancestors',unverified,refusal).stageTrust,undefined);
  }
});

test('protected Linux stage trust never reads unrelated refusal or private metadata', () => {
  const unreadable={get ancestor(){assert.fail('Unrelated refusal must not be read');}};
  for(const step of [undefined,'cat-entry','parser-ancestors']) {
    assert.equal(linuxPreflightFailure(step,unverified,unreadable)?.stageTrust,undefined);
  }
  assert.equal(linuxPreflightFailure('stage-ancestors',{code:'ENOENT'},unreadable).stageTrust,undefined);
  const refusal={ancestor:'var-lib',predicate:'owner'};
  for(const key of ['path','uid','mode','message','token'])Object.defineProperty(refusal,key,{
    enumerable:true,get(){assert.fail('Private metadata must not be read');},
  });
  assert.deepEqual(linuxPreflightFailure('stage-ancestors',unverified,refusal).stageTrust,{ancestor:'var-lib',predicate:'owner'});
});

test('protected Linux preflight distinguishes each fixed tool and guard call site', () => {
  const cases = [
    ['sudo-realpath', 'tool-trust', 'sudo', 'realpath'],
    ['sudo-ancestors', 'tool-trust', 'sudo', 'ancestors'],
    ['sudo-entry', 'tool-trust', 'sudo', 'entry'],
    ['mkdir-realpath', 'tool-trust', 'mkdir', 'realpath'],
    ['mkdir-ancestors', 'tool-trust', 'mkdir', 'ancestors'],
    ['mkdir-entry', 'tool-trust', 'mkdir', 'entry'],
    ['cp-realpath', 'tool-trust', 'cp', 'realpath'],
    ['cp-ancestors', 'tool-trust', 'cp', 'ancestors'],
    ['cp-entry', 'tool-trust', 'cp', 'entry'],
    ['chmod-realpath', 'tool-trust', 'chmod', 'realpath'],
    ['chmod-ancestors', 'tool-trust', 'chmod', 'ancestors'],
    ['chmod-entry', 'tool-trust', 'chmod', 'entry'],
    ['install-realpath', 'tool-trust', 'install', 'realpath'],
    ['install-ancestors', 'tool-trust', 'install', 'ancestors'],
    ['install-entry', 'tool-trust', 'install', 'entry'],
    ['rm-realpath', 'tool-trust', 'rm', 'realpath'],
    ['rm-ancestors', 'tool-trust', 'rm', 'ancestors'],
    ['rm-entry', 'tool-trust', 'rm', 'entry'],
    ['cat-realpath', 'tool-trust', 'cat', 'realpath'],
    ['cat-ancestors', 'tool-trust', 'cat', 'ancestors'],
    ['cat-entry', 'tool-trust', 'cat', 'entry'],
    ['parser-realpath', 'parser-trust', 'parser', 'realpath'],
    ['parser-ancestors', 'parser-trust', 'parser', 'ancestors'],
    ['parser-entry', 'parser-trust', 'parser', 'entry'],
    ['restriction-read', 'userns-restriction', null, 'read'],
    ['initial-policy-presence', 'initial-policy-presence', null, 'presence'],
  ];
  for (const [step, boundary, tool, check] of cases) {
    assert.deepEqual(linuxPreflightFailure(step, { code: 'ENOENT' }), { boundary, tool, check, errorCode: 'ENOENT' });
  }
});

test('protected Linux preflight omits completed, absent and unrecognized observations without reading an error', () => {
  const error = { get code() { assert.fail('No preflight failure must not inspect error content'); } };
  for (const step of [undefined, null, '', 'complete', 'toString', '__proto__', 'constructor',
    'sudo-entry/private/secret', 'parser-entry\n', '/usr/bin/cat-entry', 1, {}, new String('stage-ancestors')]) {
    assert.equal(linuxPreflightFailure(step, error), undefined);
  }
});

test('protected Linux preflight accepts only exact closed error codes', () => {
  for (const code of ['ENOENT', 'EACCES', 'EPERM', 'ELOOP', 'ENOTDIR', 'linux-protected-install-refused', 'linux-protected-install-unverified']) {
    assert.equal(linuxPreflightFailure('parser-realpath', { code }).errorCode, code);
  }
  for (const error of [null, undefined, 'ENOENT', { code: 'ENOENT/private/secret' }, { code: 'EACCES\n' },
    { code: 'linux-protected-install-unverified-private' }, { code: 1 }, { code: {} }, { code: Symbol('ENOENT') },
    { get code() { throw new Error('private diagnostic getter'); } }]) {
    assert.equal(linuxPreflightFailure('parser-realpath', error).errorCode, 'unknown');
  }
});

test('protected Linux preflight freezes finite fields and never serializes private exception content', () => {
  let codeReads = 0;
  const error = { get code() { codeReads++; return 'linux-protected-install-unverified'; } };
  for (const key of ['message', 'stack', 'cause', 'path', 'pid', 'token', 'stdout', 'stderr']) {
    Object.defineProperty(error, key, { enumerable: true, get() { assert.fail(`Private ${key} must not be read`); } });
  }
  const result = linuxPreflightFailure('initial-policy-presence', error);
  assert.equal(codeReads, 1);
  assert.equal(JSON.stringify(result), '{"boundary":"initial-policy-presence","tool":null,"check":"presence","errorCode":"linux-protected-install-unverified"}');
  assert.equal(Object.isFrozen(result), true);
  assert.throws(() => { result.errorCode = 'cleanup'; }, TypeError);
  assert.equal(result.errorCode, 'linux-protected-install-unverified');
});

test('protected Linux installation requires an ordinary user on an explicit hosted supported Linux runner', () => {
  for (const arch of ['x64', 'arm64']) assert.doesNotThrow(() => assertHostedLinuxContext({ ...context, arch }));
  for (const patch of [
    { platform: 'darwin' }, { platform: 'win32' }, { arch: 'ia32' }, { arch: 'ARM64' },
    ...[0, -1, 1000.5, NaN, Infinity, '1000', null, true].map(uid => ({ uid })),
    ...[0, -1, 1000.5, NaN, Infinity, '1000', null, true].map(euid => ({ euid })),
    { environment: {} }, { environment: null },
    { environment: { ...environment, GITHUB_ACTIONS: true } },
    { environment: { ...environment, GITHUB_ACTIONS: 'false' } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: 'self-hosted' } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: 'github-hosted\n' } },
  ]) assert.throws(() => assertHostedLinuxContext({ ...context, ...patch }), refused);
});

test('user namespace profile grants only the exact protected staging executable', () => {
  for (const suffix of ['a'.repeat(32), '0123456789abcdef'.repeat(2)]) {
    const root = `/var/lib/lawoss-ci-${suffix}`, name = `lawoss-ci-${suffix}`, executable = `${root}/app/legalwork`;
    assert.deepEqual(linuxUsernsProfile(root), {
      name, executable,
      text: `abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} ${executable} flags=(unconfined) {\n  userns,\n}\n`,
    });
  }
});

test('user namespace profile refuses alternate, writable temporary and injected paths', () => {
  for (const root of [
    undefined, null, 42, '', '/var/lib', '/var', '/opt', `/opt/lawoss-ci-${'a'.repeat(32)}`, '/tmp', `/tmp/lawoss-ci-${'a'.repeat(32)}`,
    `/home/runner/lawoss-ci-${'a'.repeat(32)}`, `/var/lib/lawoss-ci-${'a'.repeat(31)}`,
    `/var/lib/lawoss-ci-${'a'.repeat(33)}`, `/var/lib/lawoss-ci-${'A'.repeat(32)}`,
    `${stage}/`, `${stage}/app`, `${stage}/../other`, `/var/lib/../lib/lawoss-ci-${'a'.repeat(32)}`,
    `/var/lib//lawoss-ci-${'a'.repeat(32)}`, `${stage}\n`, `${stage}\0`, `${stage} *`,
    `/var/lib/lawoss-ci-${'*'.repeat(32)}`, `/var/lib/lawoss-ci-${'?'.repeat(32)}`,
    `${stage} { userns, }`, `${stage}\nprofile injected /** flags=(unconfined) { userns, }`,
  ]) assert.throws(() => linuxUsernsProfile(root), refused);
});

async function temporaryTree(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-protected-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload');
  await mkdir(path.join(payload, 'app'), { recursive: true });
  await writeFile(path.join(payload, 'app', 'legalwork'), 'Inert filesystem fixture; never execute.\n', { mode: 0o755 });
  return { root, payload };
}

test('actual temporary payload cannot satisfy root ownership and protected physical ancestry', { skip: typeof process.getuid !== 'function' }, async t => {
  const { payload } = await temporaryTree(t);
  assert.equal((await lstat(payload)).uid, process.getuid());
  // A root-run container still has to reject writable /tmp ancestry; no fabricated root-positive proof.
  await assert.rejects(validateProtectedLinuxTree(payload), unverified);
});

test('actual writable payload refuses protected-tree verification', { skip: typeof process.getuid !== 'function' }, async t => {
  const { payload } = await temporaryTree(t);
  await chmod(path.join(payload, 'app', 'legalwork'), 0o777);
  assert.notEqual((await lstat(path.join(payload, 'app', 'legalwork'))).mode & 0o022, 0);
  await assert.rejects(validateProtectedLinuxTree(payload), unverified);
});

test('an actual symbolic-link root refuses protected-tree verification', { skip: typeof process.getuid !== 'function' }, async t => {
  const { root, payload } = await temporaryTree(t), alias = path.join(root, 'alias');
  await symlink(payload, alias);
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
  await assert.rejects(validateProtectedLinuxTree(alias), unverified);
});

const ownedMetadataContainer = process.platform === 'linux' && process.getuid?.() === 0 && process.env.LAWOSS_OWNED_METADATA_CONTAINER === '1';
test('explicit owned Linux metadata container verifies protected files and refuses unsafe mutations', { skip: !ownedMetadataContainer }, async t => {
  const root = `/var/lib/lawoss-ci-${randomBytes(16).toString('hex')}`;
  await mkdir(root, { mode: 0o755 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), executable = path.join(app, 'legalwork');
  await mkdir(app, { mode: 0o755 });
  await writeFile(executable, 'Inert root-owned metadata fixture; never execute.\n', { mode: 0o755 });
  assert.equal(await validateProtectedLinuxTree(root), undefined);

  await t.test('admitted root metadata uses its actual cached mode and throwing observers cannot change success', async () => {
    const observations=[];
    await chmod(root,0o700);
    try {
      assert.equal(await validateProtectedLinuxTree(root,{onRootMetadata(value){observations.push(value);throw new Error('Ignore observer exception');}}),undefined);
      assert.deepEqual(observations,[{modeBits:0o700,otherRead:false,otherSearch:false}]);
      assert.equal(Object.isFrozen(observations[0]),true);
      assert.deepEqual(Object.keys(observations[0]),['modeBits','otherRead','otherSearch']);
    } finally {await chmod(root,0o755);}
  });

  await t.test('group-writable regular payload refuses verification', async () => {
    await chmod(executable, 0o775);
    try { await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await chmod(executable, 0o755); }
  });
  await t.test('hard-linked regular payload refuses verification', async () => {
    const alias = path.join(app, 'hardlink');
    await link(executable, alias);
    try { assert.equal((await lstat(executable)).nlink, 2); await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await unlink(alias); }
  });
  await t.test('absolute and escaping symbolic links refuse verification', async () => {
    const alias = path.join(app, 'unsafe-link');
    for (const target of ['/etc/passwd', '../../outside']) {
      await symlink(target, alias);
      try { await assert.rejects(validateProtectedLinuxTree(root), unverified); }
      finally { await unlink(alias); }
    }
  });
  await t.test('relative internal link to protected payload verifies', async () => {
    const alias = path.join(app, 'internal-link');
    await symlink('legalwork', alias);
    try { assert.equal(await validateProtectedLinuxTree(root), undefined); }
    finally { await unlink(alias); }
  });
  await t.test('set-user-ID regular payload refuses verification', async () => {
    await chmod(executable, 0o4755);
    try { assert.equal((await lstat(executable)).mode & 0o4000, 0o4000); await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await chmod(executable, 0o755); }
  });
  await t.test('actual GNU copy preserves bytes modes and internal links in a protected copied tree', async () => {
    const source = path.join(root, 'copy-source'), destination = path.join(root, 'copy-destination');
    await mkdir(path.join(source, 'nested'), { recursive: true, mode: 0o755 });
    const filename = path.join('nested', 'žluťoučký kůň.txt');
    await writeFile(path.join(source, filename), Buffer.from('Příliš žluťoučký kůň 🐎\n', 'utf8'), { mode: 0o744 });
    await symlink(filename, path.join(source, 'internal-link'));
    const child = spawnSync('/usr/bin/cp', ['--recursive', '--no-dereference', '--preserve=mode', '--no-preserve=ownership,xattr', '--', `${source}/.`, destination], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, '');
    assert.deepEqual(await readFile(path.join(destination, filename)), await readFile(path.join(source, filename)));
    for (const relative of ['', 'nested', filename, 'internal-link']) {
      const original = await lstat(path.join(source, relative)), copy = await lstat(path.join(destination, relative));
      assert.equal(copy.mode & 0o7777, original.mode & 0o7777);
      assert.equal(copy.uid, 0);
    }
    assert.equal((await lstat(path.join(source, filename))).mode & 0o7777, 0o744);
    assert.equal((await lstat(source)).mode & 0o7777, 0o755);
    assert.equal((await lstat(path.join(source, 'nested'))).mode & 0o7777, 0o755);
    assert.equal((await lstat(path.join(destination, 'internal-link'))).isSymbolicLink(), true);
    assert.equal(await readlink(path.join(destination, 'internal-link')), await readlink(path.join(source, 'internal-link')));
    assert.equal(await validateProtectedLinuxTree(destination), undefined);
  });
  assert.equal(await validateProtectedLinuxTree(root), undefined);
});

// Removing the production root policy must break ordinary-user traversal after
// GNU cp preserves a 0700 extraction root. This child models only sudo dispatch;
// copy/chmod, root ownership and uid/gid 65534 access are real Linux operations.
async function productionCopyContainerFixture(moduleUrl) {
  const assert = (await import('node:assert/strict')).default;
  const childProcess = (await import('node:child_process')).default;
  const { syncBuiltinESMExports } = await import('node:module');
  const { readFile, writeFile, mkdir, mkdtemp, lstat, readdir, readlink, symlink, chmod, rename, rm } = await import('node:fs/promises');
  const { createHash } = await import('node:crypto');
  const path = (await import('node:path')).default;
  const originalExecFile = childProcess.execFile;
  let afterCopy, afterChmod, chmodCalls=0;
  childProcess.execFile = (tool,args,options,callback) => {
    assert.equal(tool,'/usr/bin/sudo');
    assert.deepEqual(args.slice(0,2),['--non-interactive','--']);
    assert.ok(['/usr/bin/mkdir','/usr/bin/cp','/usr/bin/chmod'].includes(args[2]));
    if(args[2]==='/usr/bin/chmod')chmodCalls++;
    return originalExecFile(args[2],args.slice(3),options,(error,stdout,stderr)=>{
      const after=args[2]==='/usr/bin/cp'?afterCopy:args[2]==='/usr/bin/chmod'?afterChmod:undefined;
      if(error || !after)return callback(error,stdout,stderr);
      Promise.resolve().then(after).then(()=>callback(null,stdout,stderr),callback);
    });
  };
  syncBuiltinESMExports();
  // Expose the private operation only in this isolated in-memory test module.
  // Production exports, routes and invocation authority remain unchanged.
  const sourceText=await readFile(new URL(moduleUrl),'utf8');
  const production=await import(`data:text/javascript;base64,${Buffer.from(`${sourceText}\nexport { copyProtectedLinuxTree };`).toString('base64')}`);
  const root=await mkdtemp('/var/lib/lawoss-copy-policy-');
  await chmod(root,0o755); // Owned outer fixture ancestry, never the copied app root.
  const source=path.join(root,'source');
  await mkdir(source,{mode:0o700});
  await mkdir(path.join(source,'nested'),{mode:0o755});
  await writeFile(path.join(source,'legalwork'),'Inert data; never execute.\n',{mode:0o755});
  await writeFile(path.join(source,'nested','data'),'Preserve exact bytes 🐎\n',{mode:0o744});
  await symlink('nested/data',path.join(source,'internal-link'));
  async function inventory(directory) {
    const entries=[];
    async function visit(relative='') {
      const filename=path.join(directory,relative),info=await lstat(filename);
      const type=info.isSymbolicLink()?'link':info.isDirectory()?'directory':'file';
      entries.push({relative,type,mode:info.mode&0o7777,uid:info.uid,gid:info.gid,
        ...(type==='link'?{target:await readlink(filename)}:type==='file'?{sha256:createHash('sha256').update(await readFile(filename)).digest('hex')}:{})});
      if(type==='directory')for(const name of (await readdir(filename)).sort())await visit(path.join(relative,name));
    }
    await visit();return entries;
  }
  const original=await inventory(source),sourceIdentity=await lstat(source);
  function ordinaryReader(app,expected) {
    const reader=childProcess.spawnSync(process.execPath,['--input-type=module'],{
      uid:65534,gid:65534,encoding:'utf8',timeout:10000,maxBuffer:4096,
      input:`import { validateProtectedLinuxTree } from ${JSON.stringify(moduleUrl)};
        import { readFile } from 'node:fs/promises';
        if(process.getuid()!==65534 || process.getgid()!==65534)process.exit(9);
        try {await validateProtectedLinuxTree(${JSON.stringify(app)});await readFile(${JSON.stringify(path.join(app,'internal-link'))});console.log('readable');}
        catch(error){if(${JSON.stringify(expected)}==='EACCES' && (error.path!==${JSON.stringify(app)} || error.syscall!=='scandir'))process.exit(8);console.log(error.code);process.exit(3);}`,
    });
    assert.equal(reader.error,undefined);assert.equal(reader.signal,null);assert.equal(reader.stderr,'');
    assert.equal(reader.status,expected==='readable'?0:3,reader.stdout);assert.equal(reader.stdout.trim(),expected);
  }
  async function createCase(label) {
    const stage=path.join(root,label);await mkdir(stage,{mode:0o755});
    return {stage,app:path.join(stage,'app'),identity:await lstat(stage)};
  }
  try {
    const good=await createCase('good');
    let beforeCopyObserved=false,copiedIdentity;
    afterCopy=async()=>{
      copiedIdentity=await lstat(good.app);
      assert.equal(copiedIdentity.uid,0);
      assert.equal((await lstat(good.app)).mode&0o7777,0o700);
      ordinaryReader(good.app,'EACCES');beforeCopyObserved=true;
    };
    await production.copyProtectedLinuxTree(source,good.app,good.identity,()=>{});
    assert.equal(beforeCopyObserved,true);
    assert.equal((await lstat(good.app)).mode&0o7777,0o755);
    assert.equal(chmodCalls,1);
    const installedIdentity=await lstat(good.app);
    assert.equal(installedIdentity.uid,0);assert.equal(installedIdentity.ino,copiedIdentity.ino);assert.equal(installedIdentity.dev,copiedIdentity.dev);
    ordinaryReader(good.app,'readable');
    assert.deepEqual((await inventory(good.app)).slice(1),original.slice(1));
    assert.deepEqual(await inventory(source),original);
    assert.equal((await lstat(source)).ino,sourceIdentity.ino);
    assert.equal((await lstat(source)).uid,sourceIdentity.uid);

    const writable=await createCase('writable'),beforeWritable=chmodCalls;
    afterCopy=()=>chmod(writable.app,0o777);
    await assert.rejects(production.copyProtectedLinuxTree(source,writable.app,writable.identity,()=>{}),{code:'linux-protected-install-unverified'});
    assert.equal(chmodCalls,beforeWritable);
    assert.equal((await lstat(writable.app)).mode&0o7777,0o777);

    const substituted=await createCase('substituted'),beforeSubstitution=chmodCalls;
    afterCopy=async()=>{await rename(substituted.app,`${substituted.app}-original`);await mkdir(substituted.app,{mode:0o700});};
    await assert.rejects(production.copyProtectedLinuxTree(source,substituted.app,substituted.identity,()=>{}),{code:'linux-protected-install-unverified'});
    assert.equal(chmodCalls,beforeSubstitution);
    assert.equal((await lstat(substituted.app)).mode&0o7777,0o700);
    assert.equal((await lstat(`${substituted.app}-original`)).isDirectory(),true);

    const preexisting=await createCase('preexisting'),beforeExisting=chmodCalls;
    afterCopy=undefined;
    await mkdir(preexisting.app,{mode:0o700});
    await writeFile(path.join(preexisting.app,'unknown'),'Do not adopt.');
    await assert.rejects(production.copyProtectedLinuxTree(source,preexisting.app,preexisting.identity,()=>{}),{code:'linux-protected-install-unverified'});
    assert.equal(chmodCalls,beforeExisting);
    assert.equal(await readFile(path.join(preexisting.app,'unknown'),'utf8'),'Do not adopt.');

    const wrongMode=await createCase('wrong-mode');
    afterChmod=()=>chmod(wrongMode.app,0o750);
    await assert.rejects(production.copyProtectedLinuxTree(source,wrongMode.app,wrongMode.identity,()=>{}),{code:'linux-protected-install-unverified'});
    assert.equal((await lstat(wrongMode.app)).mode&0o7777,0o750);
    afterChmod=undefined;

    const unsafe=await createCase('unsafe');afterCopy=undefined;
    await chmod(path.join(source,'nested','data'),0o777);
    await production.copyProtectedLinuxTree(source,unsafe.app,unsafe.identity,()=>{});
    ordinaryReader(unsafe.app,'linux-protected-install-unverified');
    assert.equal((await lstat(path.join(unsafe.app,'nested','data'))).mode&0o7777,0o777);
    await chmod(path.join(source,'nested','data'),0o744);
    assert.deepEqual(await inventory(source),original);
    console.log(JSON.stringify({sudo:'modeled-exact-prefix',tools:'genuine-GNU',readerUid:65534,readerGid:65534,
      before:'EACCES',after:'readable',sourceRootMode:'0700',installedRootMode:'0755',descendants:'unchanged',unsafeRoot:'refused',substitution:'refused',unsafeDescendant:'refused'}));
  } finally {await rm(root,{recursive:true,force:true});}
}

test('production copy root policy makes only the owned 0700 container readable to an actual ordinary Linux user', { skip: !ownedMetadataContainer }, () => {
  const child=spawnSync(process.execPath,['--input-type=module'],{
    input:`await (${productionCopyContainerFixture.toString()})(${JSON.stringify(new URL('./linux-protected-install.mjs',import.meta.url).href)});`,
    encoding:'utf8',timeout:30000,maxBuffer:65536,
  });
  assert.equal(child.error,undefined);assert.equal(child.signal,null);
  assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,'');
  assert.deepEqual(JSON.parse(child.stdout),{sudo:'modeled-exact-prefix',tools:'genuine-GNU',readerUid:65534,readerGid:65534,
    before:'EACCES',after:'readable',sourceRootMode:'0700',installedRootMode:'0755',descendants:'unchanged',unsafeRoot:'refused',substitution:'refused',unsafeDescendant:'refused'});
});

const actualHostedLinuxUser = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch) && Number.isSafeInteger(process.getuid?.()) && process.getuid() > 0 && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
test('actual ordinary non-hosted CLI refuses with finite output before creating its output directory', { skip: actualHostedLinuxUser }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-protected-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'must-not-be-created');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./probe-linux-protected-startup-ci.mjs', import.meta.url)), '--output-dir', output], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { kind: 'lawoss-ci-linux-protected-installation', status: 'refused', reason: 'native-hosted-nonroot-linux-required' });
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});

// This ordinary isolated child executes the unchanged complete production source
// against POSIX metadata only; modeled uid0/0755 is not native/root proof.
async function productionLinkResolutionFixture(moduleUrl,initialPathModel) {
  const assert=(await import('node:assert/strict')).default;
  const fs=(await import('node:fs/promises')).default;
  const nativeFs=(await import('node:fs')).default;
  const childProcess=(await import('node:child_process')).default;
  const nativePath=(await import('node:path')).default;
  const {syncBuiltinESMExports}=await import('node:module');
  const source=await fs.readFile(new URL(moduleUrl),'utf8');
  const pathMembers=['dirname','isAbsolute','join','relative','resolve','sep'];
  const posixPath=Object.fromEntries(pathMembers.map(key=>[key,nativePath.posix[key]]));
  const win32Path=Object.fromEntries(pathMembers.map(key=>[key,nativePath.win32[key]]));
  if(initialPathModel==='win32')Object.assign(nativePath,win32Path);
  // Select POSIX before capturing the resolve function used by the observer.
  Object.assign(nativePath,posixPath);
  const originalResolve=nativePath.resolve,originalFreeze=Object.freeze;
  assert.equal(originalResolve,posixPath.resolve);
  const root='/link-metadata/payload',directory=`${root}/nested`;
  let unexpected=0,events=[],kind,entry,linkTarget,primary,validatorCases=0,projectionCases=0;
  const reject=()=>{unexpected++;throw new Error('unexpected operation');};
  for(const object of [nativeFs,fs,childProcess]) for(const key of Object.keys(object)) if(typeof object[key]==='function')Object.defineProperty(object,key,{value:reject,writable:true,configurable:true,enumerable:true});
  nativePath.resolve=(...args)=>{if(args.length===2 && args[0]===directory && args[1]===linkTarget)events.push('resolve-target');return originalResolve(...args);};
  const dir=()=>({uid:0,mode:0o755,isSymbolicLink:()=>false,isDirectory:()=>true});
  fs.lstat=async filename=>{
    if(![root,directory,'/link-metadata','/',entry].includes(filename))return reject();
    events.push(filename===entry?'lstat-entry':'lstat-directory');
    if(filename===entry)return {get uid(){events.push('uid-entry');return kind==='owner'?1:0;},isSymbolicLink(){events.push('symlink-entry');return true;}};
    if(kind==='ancestor' && filename==='/link-metadata')return {...dir(),uid:1};
    if(kind==='type' && filename===root)return {...dir(),isDirectory:()=>false};
    return dir();
  };
  fs.readdir=async filename=>{
    if(filename===root){events.push('readdir-root');return ['nested'];}
    if(filename===directory){events.push('readdir-directory');return [entry.slice(directory.length+1)];}
    return reject();
  };
  fs.readlink=async filename=>{
    if(filename!==entry)return reject();events.push('readlink');
    if(kind==='readlink')throw primary;return linkTarget;
  };
  fs.realpath=async filename=>{
    if(filename===root){events.push('realpath-root');return kind==='canonical'?'/different':root;}
    if(filename!==entry)return reject();events.push('realpath-entry');
    if(kind==='success')return `${root}/resolved`;
    if(kind==='physical')return '/outside';
    if(kind==='construction')Object.freeze=()=>{throw new Error('snapshot construction');};
    throw primary;
  };
  syncBuiltinESMExports();
  const modeledPath=await import('node:path');
  for(const key of pathMembers)assert.equal(modeledPath[key],key==='resolve'?nativePath.resolve:posixPath[key]);
  const production=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
  async function run(caseKind,expectedSnapshot) {
    kind=caseKind;events=[];entry=`${directory}/link`;linkTarget='target/leaf';
    if(kind==='root-target')linkTarget='..';
    if(kind==='deep-target')linkTarget=Array(130).fill('d').join('/');
    if(kind==='long-target')linkTarget='x'.repeat(4097);
    if(kind==='control-entry')entry=`${directory}/line\nentry`;
    if(kind==='long-entry')entry=`${directory}/${'x'.repeat(4097)}`;
    if(kind==='absolute')linkTarget='/outside';
    if(kind==='lexical')linkTarget='../../outside';
    primary=Object.assign(new Error('private original'),{code:'EACCES',syscall:kind==='readlink'?'readlink':'realpath',path:`${root}/error-component`});
    const descriptors=Object.getOwnPropertyDescriptors(primary),roots=[],snapshots=[];
    let caught,value;
    try {
      value=await production.validateProtectedLinuxTree(kind==='noncanonical'?`${root}/../payload`:root,{
        onRootMetadata(metadata){roots.push(metadata);},
        onLinkResolutionFailure(metadata){snapshots.push(metadata);if(kind==='observer')throw new Error('observer');},
      });
    } catch(error){caught=error;} finally {Object.freeze=originalFreeze;}
    validatorCases++;
    if(kind==='success'){assert.equal(caught,undefined);assert.equal(value,undefined);}
    else if(['absolute','lexical','physical','owner','ancestor','type','canonical','noncanonical'].includes(kind))assert.equal(caught.code,'linux-protected-install-unverified');
    else {assert.equal(caught,primary);assert.deepEqual(Object.getOwnPropertyDescriptors(primary),descriptors);}
    if(expectedSnapshot){
      assert.deepEqual(snapshots,[expectedSnapshot]);
      for(const object of [snapshots[0],snapshots[0].entry,snapshots[0].lexicalTarget])assert.equal(Object.isFrozen(object),true);
      assert.throws(()=>{snapshots[0].entry.depth=9;},TypeError);
      const observation=production.linuxOperationFailure('tree-validation',caught,root,roots[0],snapshots[0]);
      assert.deepEqual(observation.linkResolution,expectedSnapshot);
      assert.notEqual(observation.linkResolution,snapshots[0]);assert.notEqual(observation.linkResolution.entry,snapshots[0].entry);
      assert.deepEqual(observation.filesystem,{action:'realpath',scope:'payload-descendant',depth:1});
      assert.deepEqual(observation.rootAccess,{modeBits:493,otherRead:true,otherSearch:true});
    } else assert.deepEqual(snapshots,[]);
    if(!['ancestor','type','canonical','noncanonical'].includes(kind))assert.deepEqual(roots,[{modeBits:493,otherRead:true,otherSearch:true}]);
    else assert.deepEqual(roots,[]);
    if(kind==='failure')assert.deepEqual(events.slice(-6),['lstat-entry','uid-entry','symlink-entry','readlink','resolve-target','realpath-entry']);
    const reached=['failure','root-target','deep-target','long-target','long-entry','control-entry','observer','construction','success','physical'].includes(kind);
    assert.equal(events.filter(value=>value==='realpath-entry').length,reached?1:0);
    assert.equal(events.filter(value=>value==='resolve-target').length,reached || kind==='lexical'?1:0);
    assert.equal(events.filter(value=>value==='readlink').length,['owner','ancestor','type','canonical','noncanonical'].includes(kind)?0:1);
    assert.equal(events.filter(value=>value==='lstat-entry').length,['ancestor','type','canonical','noncanonical'].includes(kind)?0:1);
    assert.equal(unexpected,0);
  }
  const expected={entry:{scope:'payload-descendant',depth:2},lexicalTarget:{scope:'payload-descendant',depth:3}};
  await run('failure',expected);
  await run('observer',expected);
  await run('root-target',{entry:expected.entry,lexicalTarget:{scope:'payload-root',depth:0}});
  for(const caseKind of ['deep-target','long-target'])await run(caseKind,{entry:expected.entry,lexicalTarget:{scope:'unknown',depth:null}});
  for(const caseKind of ['long-entry','control-entry','construction','readlink','absolute','lexical','physical','owner','ancestor','type','canonical','noncanonical','success'])await run(caseKind);

  const error={code:'EACCES',syscall:'realpath',path:`${root}/error-component`};
  const rootMetadata={modeBits:493,otherRead:true,otherSearch:true};
  const baseline={operation:'tree-validation',errorCode:'EACCES',filesystem:{action:'realpath',scope:'payload-descendant',depth:1},rootAccess:rootMetadata};
  assert.deepEqual(production.linuxOperationFailure('tree-validation',error,root,rootMetadata),baseline);
  for(const entryDepth of [1,2,129])for(const [scope,depth] of [['payload-root',0],['payload-descendant',1],['payload-descendant',129],['unknown',null]]){
    const input={entry:{scope:'payload-descendant',depth:entryDepth},lexicalTarget:{scope,depth}};
    const value=production.linuxOperationFailure('tree-validation',error,root,rootMetadata,input);
    assert.deepEqual(value,{...baseline,linkResolution:input});
    assert.notEqual(value.linkResolution,input);assert.notEqual(value.linkResolution.entry,input.entry);assert.notEqual(value.linkResolution.lexicalTarget,input.lexicalTarget);
    for(const part of [value,value.linkResolution,value.linkResolution.entry,value.linkResolution.lexicalTarget])assert.equal(Object.isFrozen(part),true);
    input.entry.depth=7;assert.equal(value.linkResolution.entry.depth,entryDepth);
    assert.doesNotMatch(JSON.stringify(value),/private|link-metadata|component/);projectionCases++;
  }
  const nullPrototype=Object.assign(Object.create(null),{entry:Object.assign(Object.create(null),expected.entry),lexicalTarget:Object.assign(Object.create(null),expected.lexicalTarget)});
  assert.deepEqual(production.linuxOperationFailure('tree-validation',error,root,rootMetadata,nullPrototype).linkResolution,expected);projectionCases++;
  let traps=0;
  const trap=()=>{traps++;throw new Error('must not inspect');};
  const handler={get:trap,ownKeys:trap,getOwnPropertyDescriptor:trap,getPrototypeOf:trap};
  const proxy=new Proxy(expected,handler),transparent=new Proxy(expected,{}),revoked=Proxy.revocable(expected,{});revoked.revoke();
  const nestedProxy=new Proxy(expected.entry,handler),nestedRevoked=Proxy.revocable(expected.lexicalTarget,{});nestedRevoked.revoke();
  const accessor={get entry(){traps++;return expected.entry;},lexicalTarget:expected.lexicalTarget};
  const inherited=Object.create(expected),custom=Object.assign(Object.create({private:true}),expected);
  const bad=[undefined,null,1,'private',[],{},new String('private'),inherited,custom,accessor,proxy,transparent,revoked.proxy,
    {...expected,entry:nestedProxy},{...expected,entry:new Proxy(expected.entry,{})},{...expected,lexicalTarget:nestedRevoked.proxy},
    {...expected,lexicalTarget:new Proxy(expected.lexicalTarget,handler)},
    {...expected,private:'value'},{...expected,[Symbol('private')]:true},
    {...expected,entry:{...expected.entry,private:true}},
    {...expected,entry:{get scope(){traps++;return 'payload-descendant';},depth:2}},
    {...expected,lexicalTarget:Object.create(expected.lexicalTarget)},
    {...expected,lexicalTarget:{...expected.lexicalTarget,[Symbol('private')]:true}}];
  for(const depth of [undefined,'2',NaN,Infinity,-1,0,130,1.5,true,null,{},new Number(2)])bad.push({...expected,entry:{scope:'payload-descendant',depth}});
  for(const entry of [{scope:'payload-root',depth:0},{scope:'unknown',depth:null},[],null,{scope:new String('payload-descendant'),depth:2}])bad.push({...expected,entry});
  for(const lexicalTarget of [{scope:'payload-root',depth:1},{scope:'payload-descendant',depth:0},{scope:'payload-descendant',depth:130},{scope:'unknown',depth:0},{scope:'unknown',depth:'null'},{scope:'other',depth:3},{scope:'payload-descendant',depth:NaN},{scope:'payload-descendant',depth:1.5},[],null])bad.push({...expected,lexicalTarget});
  for(const input of bad){assert.deepEqual(production.linuxOperationFailure('tree-validation',error,root,rootMetadata,input),baseline);projectionCases++;}
  assert.equal(traps,0);
  for(const [operation,context,errorValue] of [
    ['tree-copy',root,error],['unknown',root,error],['tree-validation','/',error],['tree-validation',`${root}/..`,error],
    ...['readlink','scandir','unknown'].map(syscall=>['tree-validation',root,{...error,syscall}]),
    ['tree-validation',root,{...error,code:'unknown'}],
  ]){
    const result=production.linuxOperationFailure(operation,errorValue,context,rootMetadata,proxy);
    assert.equal(result?.linkResolution,undefined);projectionCases++;
  }
  assert.equal(traps,0);
  assert.deepEqual(production.linuxPreflightFailure('mkdir-entry',{code:'linux-protected-install-unverified'},undefined,{predicate:'owner'}),{boundary:'tool-trust',tool:'mkdir',check:'entry',errorCode:'linux-protected-install-unverified',toolTrust:{predicate:'owner'}});
  assert.equal(unexpected,0);
  console.log(JSON.stringify({validatorCases,projectionCases,unexpectedOperations:unexpected,proxyTraps:traps,source:'unchanged-full-module',metadata:'modeled-only'}));
}

for(const initialPathModel of [undefined,'win32']) test(`link-resolution actual validator separates cached entry lexical target and original error path${initialPathModel?' with initial Win32 path model':''}`, t => {
  const child=spawnSync(process.execPath,['--input-type=module'],{
    input:`await (${productionLinkResolutionFixture.toString()})(${JSON.stringify(new URL('./linux-protected-install.mjs',import.meta.url).href)},${JSON.stringify(initialPathModel)});`,
    encoding:'utf8',timeout:10000,maxBuffer:65536,
  });
  assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,0,child.stderr);
  assert.equal(child.stderr,'');
  const result=JSON.parse(child.stdout);
  assert.equal(result.validatorCases,18);assert.equal(result.projectionCases,71);
  t.diagnostic(JSON.stringify(result));
  assert.deepEqual({...result,validatorCases:0,projectionCases:0},{validatorCases:0,projectionCases:0,unexpectedOperations:0,proxyTraps:0,source:'unchanged-full-module',metadata:'modeled-only'});
});
