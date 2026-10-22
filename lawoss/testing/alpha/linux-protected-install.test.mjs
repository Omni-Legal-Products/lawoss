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
