import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile, access, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runNativeStartupProbe, startupAssetName, ciStartupOptions } from './probe-startup-ci.mjs';
import * as startupProbe from './probe-startup-ci.mjs';
import { runAlphaAcceptance } from './run.mjs';
import { launchAlphaApp } from './native-app.mjs';
import { ALPHA_SCENARIOS } from './coverage.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fixture(t, change = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'lawoss-ci-startup-test-')));
  t.after(() => rm(root, { recursive: true, force: true }));
  const build = { schemaVersion:1,product:'lawoss-desktop',version:'1.2.3-alpha',gitSha:'a'.repeat(40),buildEpoch:'123',platform:process.platform,arch:process.arch,channel:'alpha',workflowRunUrl:'' };
  const installedApp = process.platform === 'darwin' ? join(root,'LAWOSS.app') : join(root,process.platform === 'win32' ? 'LAWOSS.exe' : 'legalwork');
  const executable = process.platform === 'darwin' ? join(installedApp,'Contents/MacOS/LAWOSS') : installedApp;
  const resources = process.platform === 'darwin' ? join(installedApp,'Contents/Resources') : join(root,'resources');
  await mkdir(join(resources,'app-dist'),{recursive:true}); await mkdir(join(executable,'..'),{recursive:true});
  await writeFile(executable,'test-only executable'); await writeFile(join(resources,'build-info.json'),JSON.stringify({...build,...change.embedded}));
  await writeFile(join(resources,'app-dist/index.html'),'synthetic');
  const asset = join(root,'candidate'); await writeFile(asset,'pinned final bytes');
  const expectedSha256 = digest(await readFile(asset));
  const method = {darwin:'macos-owned-window-screencapture',linux:'x11-owned-window-xwd',win32:'windows-owned-window-printwindow'}[process.platform];
  const installation = {status:'verified',method:process.platform === 'darwin' ? 'sha256-zip-installed-tree' : process.platform === 'linux' ? 'sha256-appimage-installed-tree' : 'sha256-nsis-installed-tree',signing:'not-asserted',assetSha256:expectedSha256};
  const state = {launched:0,captures:0,retained:false};
  const adapters = {
    withArtifact: async (_options,use) => use({installedApp,installation,retain:()=>{state.retained=true;}}),
    launch: async ({profileRoot}) => {
      state.launched++; state.profileRoot=profileRoot;
      if(change.launchFailure)throw change.launchFailure;
      const observe = async () => ({ok:true,build:{...build,os:build.platform,provenance:'embedded',legalworkDevMode:false},process:{pid:123,userData:join(profileRoot,'userdata'),executable},rendererUrl:pathToFileURL(join(resources,'app-dist/index.html')).href,snapshot:{ok:true,route:change.route ?? '/welcome',readiness:{documentReadyState:'complete',bootOverlayVisible:false,interactiveControls:1}}});
      return {pid:123,observe,capture:async path=>{
        state.captures++;
        if(change.captureFailure)throw change.captureFailure;
        const bytes = Buffer.alloc(process.platform === 'linux' ? 100 : 24);
        if(process.platform==='linux')bytes.writeUInt32BE(7,4); else Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
        if(change.invalidImage)bytes.fill(0);
        await writeFile(path,bytes,{flag:'wx'});
        return {path,sha256:digest(bytes),format:process.platform === 'linux' ? 'xwd':'png',method:change.method ?? method,ownerPid:change.ownerPid ?? 123};
      },stop:async()=>{if(change.stopFails)throw new Error('private profile /private/token secret');}};
    },
    runAcceptance: async (options,ports) => {
      const receipt = await runAlphaAcceptance(options,ports);
      if(change.mutate)await change.mutate(receipt);
      return receipt;
    },
  };
  return {root,state,build,adapters,options:{asset,expectedSha256,expectedBuild:build,outputDir:join(root,'public'),temporaryRoot:root,installedApp:process.platform==='win32'?installedApp:undefined}};
}

test('startup publishes exactly finite receipt and native image after startup-only acceptance',async t=>{
  const f=await fixture(t); const result=await runNativeStartupProbe(f.options,f.adapters);
  const image=process.platform==='linux'?'startup.xwd':'startup.png';
  assert.deepEqual((await readdir(f.options.outputDir)).sort(),[image,'startup.json'].sort());
  assert.equal(result.status,'verified'); assert.equal(result.kind,'lawoss-ci-native-startup');
  assert.equal(result.cleanup,'verified'); assert.equal(result.nativeReview,'pending');
  assert.equal(JSON.stringify(result).includes('nativeLaunch'),false);
  assert.equal(result.fullAcceptance.status,'blocked'); assert.deepEqual(result.fullAcceptance.unperformed,ALPHA_SCENARIOS.slice(1));
  const publicText=await readFile(join(f.options.outputDir,'startup.json'),'utf8');
  for(const privateValue of [f.root,'ownerPid','profileRoot','rendererUrl','reasons','token'])assert.equal(publicText.includes(privateValue),false);
  assert.equal(result.startup.capture.sha256,digest(await readFile(join(f.options.outputDir,image))));
  await assert.rejects(access(join(f.state.profileRoot,'.alpha-acceptance-baseline.json')));
});

test('actual owned POSIX launch exit publishes finite original exit and Chromium marker observations without private output', {
  skip:process.platform==='win32'?'Controlled POSIX executable fixture requires a POSIX host':false,
  timeout:15_000,
},async t=>{
  const f=await fixture(t);
  const executable=process.platform==='darwin'?join(f.root,'LAWOSS.app/Contents/MacOS/LAWOSS'):join(f.root,'legalwork');
  const stderr='PRIVATE-PREFIX credential=private-token /private/client pid=778899\nNo usable sandbox!\nPRIVATE-SUFFIX\n';
  await writeFile(executable,`#!${process.execPath}\nprocess.stdout.write('PRIVATE-STDOUT /private/client\\n');process.stderr.write(${JSON.stringify(stderr)},()=>process.exit(73));\n`);
  await chmod(executable,0o700);
  let nativeError;
  f.adapters.launch=async options=>{
    try{return await launchAlphaApp({...options,timeoutMs:3000});}
    catch(error){nativeError=error;throw error;}
  };
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
  assert.equal(nativeError.code,'installed-app-exited');
  assert.equal(nativeError.nativeCleanup.descendantClosure,'verified');
  const result=startupProbe.startupFailureProjection(caught);
  assert.equal(result.diagnostic.phase,'launch');assert.equal(result.diagnostic.errorCode,'installed-app-exited');assert.equal(result.diagnostic.cleanup,'native-verified');
  assert.deepEqual(result.diagnostic.nativeLaunch,{exitObserved:true,exitCode:73,signal:null,
    stderr:{categories:['no-usable-sandbox'],scannedBytes:Buffer.byteLength(stderr),truncated:false}});
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|private-token|private\/client|778899|No usable sandbox|stdout|"pid"/);
  assert.deepEqual(await readdir(f.options.outputDir),[]);
});
test('changed final archive and embedded identity refuse before native launch',async t=>{
  for(const change of [{hash:true},{embedded:{gitSha:'b'.repeat(40)}}])await t.test(JSON.stringify(change),async t=>{
    const f=await fixture(t,change);if(change.hash)await writeFile(f.options.asset,'different');
    await assert.rejects(runNativeStartupProbe(f.options,f.adapters));assert.equal(f.state.launched,0);
  });
});
test('wrong welcome route refuses before native capture',async t=>{
  const f=await fixture(t,{route:'/client/private'});await assert.rejects(runNativeStartupProbe(f.options,f.adapters));
  assert.equal(f.state.captures,0);assert.deepEqual(await readdir(f.options.outputDir),[]);
});
test('unverified cleanup retains the owned extraction and profile lease and publishes nothing',async t=>{
  const f=await fixture(t,{stopFails:true});await assert.rejects(runNativeStartupProbe(f.options,f.adapters));
  assert.equal(f.state.retained,true);await access(join(f.state.profileRoot,'.acceptance-running.lock'));
  assert.deepEqual(await readdir(f.options.outputDir),[]);
});
test('missing, altered, foreign-owned or malformed capture and partial receipt cannot publish',async t=>{
  for(const [name,change] of Object.entries({
    missing:{mutate:async r=>rm(JSON.parse(await readFile(r.scenarios[0].evidence,'utf8')).capture.path)},
    altered:{mutate:async r=>writeFile(JSON.parse(await readFile(r.scenarios[0].evidence,'utf8')).capture.path,'changed')},
    owner:{ownerPid:999},method:{method:'browser-screenshot'},image:{invalidImage:true},
    partial:{mutate:async r=>{r.reasons.push('private reason');}},
    fullpass:{mutate:async r=>{r.status='pass';}},
    startupblocked:{mutate:async r=>{r.scenarios[0].status='blocked';}},
    missingcase:{mutate:async r=>{r.scenarios.pop();}},
    forgedpid:{mutate:async r=>{const path=r.scenarios[0].evidence,e=JSON.parse(await readFile(path));e.capture.ownerPid=999;e.observed.process.pid=999;await writeFile(path,JSON.stringify(e));}},
  }))await t.test(name,async t=>{
    const f=await fixture(t,change);await assert.rejects(runNativeStartupProbe(f.options,f.adapters));assert.deepEqual(await readdir(f.options.outputDir),[]);
  });
});
test('existing output is never overwritten',async t=>{
  const f=await fixture(t);await mkdir(f.options.outputDir);await writeFile(join(f.options.outputDir,'sentinel'),'preserve');
  await assert.rejects(runNativeStartupProbe(f.options,f.adapters));assert.equal(f.state.launched,0);
  assert.equal(await readFile(join(f.options.outputDir,'sentinel'),'utf8'),'preserve');
});
test('all six final names are fixed and CLI refuses non-hosted use with finite error',()=>{
  for(const platform of ['darwin','linux','win32'])for(const arch of ['x64','arm64']) {
    const expected=platform==='darwin'?`lawoss-mac-${arch}-1.2.3.zip`:platform==='win32'?`lawoss-win-${arch}-1.2.3.exe`:`lawoss-linux-${arch==='x64'?'x86_64':arch}-1.2.3.AppImage`;
    assert.equal(startupAssetName(platform,arch,'1.2.3'),expected);
  }
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('./probe-startup-ci.mjs',import.meta.url)),'--output-dir','/private/secret'],{encoding:'utf8',env:{...process.env,GITHUB_ACTIONS:'false'}});
  assert.equal(result.error,undefined);assert.equal(result.signal,null);
  assert.equal(result.status,1);assert.equal(result.stderr.includes('/private/secret'),false);assert.equal(JSON.parse(result.stderr).reason,'native-startup-unverified');
  assert.deepEqual(JSON.parse(result.stderr).diagnostic,{phase:'preflight',errorCode:'unknown',cleanup:'not-observed'});
});

test('failure diagnostics locate actual guarded boundaries without publishing private errors',async t=>{
  const secret='credential=private-token /private/client/profile pid=778899';
  const failures=[
    ['hash',{},async f=>writeFile(f.options.asset,'altered'), 'unknown','not-observed'],
    ['embed',{embedded:{gitSha:'b'.repeat(40)}},null,'unknown','not-observed'],
    ['launch',{launchFailure:Object.assign(new Error(secret),{code:'native-readiness-timeout'})},null,'native-readiness-timeout','unverified'],
    ['welcome',{route:'/private/client'},null,'unknown','native-verified'],
    ['capture',{captureFailure:Object.assign(new Error(secret),{code:'native-window-capture-unavailable'})},null,'native-window-capture-unavailable','native-verified'],
    ['cleanup',{stopFails:true},null,'unknown','unverified'],
    ['receipt-projection',{mutate:async receipt=>{receipt.status='pass';}},null,'unknown','native-verified'],
  ];
  for(const [phase,change,prepare,errorCode,cleanup] of failures)await t.test(phase,async t=>{
    const f=await fixture(t,change);await prepare?.(f);
    let observed;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{observed=error;return true;});
    const projection=startupProbe.startupFailureProjection?.(observed);
    assert.deepEqual(projection,{kind:'lawoss-ci-native-startup',status:'failed',reason:'native-startup-unverified',diagnostic:{phase,errorCode,cleanup}});
    assert.equal(JSON.stringify(projection).includes(secret),false);assert.equal(JSON.stringify(projection).includes(f.root),false);
    if(phase!=='hash')assert.deepEqual(await readdir(f.options.outputDir),[]);
  });
});

test('extraction and extractor cleanup preserve original error identity and report only closed observations',async t=>{
  for(const cleanup of [false,true])await t.test(cleanup?'extractor cleanup':'extraction',async t=>{
    const f=await fixture(t),original=f.adapters.withArtifact;
    const primary=Object.assign(new Error('secret /private/client profile=owned'),{code:cleanup?'private-token':'EACCES'});
    f.adapters.withArtifact=async(...args)=>{if(cleanup)await original(...args);throw primary;};
    await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>error===primary);
    assert.deepEqual(startupProbe.startupFailureProjection?.(primary)?.diagnostic,{phase:cleanup?'cleanup':'extraction',errorCode:cleanup?'unknown':'EACCES',cleanup:cleanup?'native-verified':'not-observed'});
    assert.deepEqual(await readdir(f.options.outputDir),[]);
  });
});

test('caught private receipt reasons match only exact allowlisted codes and remain observations',async t=>{
  for(const reason of ['native-readiness-timeout','native-readiness-timeout token=private','/private/token'])await t.test(reason,async t=>{
    const f=await fixture(t,{mutate:async receipt=>{receipt.reasons.push(reason);}});
    let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
    assert.deepEqual(startupProbe.startupFailureProjection?.(caught)?.diagnostic,{phase:'receipt-projection',errorCode:reason==='native-readiness-timeout'?reason:'unknown',cleanup:'native-verified'});
  });
});

test('failed publication reports the finite boundary and preserves foreign entries without a verified marker',async t=>{
  const f=await fixture(t),original=f.adapters.withArtifact;
  f.adapters.withArtifact=async(...args)=>{const result=await original(...args);await mkdir(join(f.options.outputDir,'startup.json'));return result;};
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
  assert.deepEqual(startupProbe.startupFailureProjection?.(caught)?.diagnostic,{phase:'publish',errorCode:'EEXIST',cleanup:'verified'});
  assert.deepEqual(await readdir(f.options.outputDir),['startup.json']);
});

test('secondary cleanup failure does not relabel the first observed failure or release its lease',async t=>{
  const f=await fixture(t,{captureFailure:Object.assign(new Error('secret /private/client'),{code:'native-window-owner-mismatch'}),stopFails:true});
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
  assert.deepEqual(startupProbe.startupFailureProjection?.(caught)?.diagnostic,{phase:'capture',errorCode:'native-window-owner-mismatch',cleanup:'unverified'});
  assert.equal(f.state.retained,true);await access(join(f.state.profileRoot,'.acceptance-running.lock'));
  assert.deepEqual(await readdir(f.options.outputDir),[]);
});

test('unregistered errors and hostile code accessors cannot leak text or replace the original failure',async t=>{
  const secret='ENOENT token=private /private/profile pid=998877';
  const error=new Error(secret);Object.defineProperty(error,'code',{get(){throw new Error(secret);}});
  const f=await fixture(t);f.adapters.withArtifact=async()=>{throw error;};
  await assert.rejects(runNativeStartupProbe(f.options,f.adapters),caught=>caught===error);
  assert.deepEqual(startupProbe.startupFailureProjection?.(error)?.diagnostic,{phase:'extraction',errorCode:'unknown',cleanup:'not-observed'});
  const unregistered=Object.assign(new Error(secret),{code:secret});
  assert.deepEqual(startupProbe.startupFailureProjection?.(unregistered)?.diagnostic,{phase:'preflight',errorCode:'unknown',cleanup:'not-observed'});
});

test('forged native-launch fields and nested causes are ignored at the startup projection boundary',async t=>{
  const fake={exitObserved:true,exitCode:73,signal:'PRIVATE-SIGNAL',stderr:{categories:['PRIVATE'],scannedBytes:1,truncated:false},path:'/private/profile'};
  const error=Object.assign(new Error('PRIVATE'),{code:'installed-app-exited',nativeLaunch:fake,cause:{nativeLaunch:fake}});
  const f=await fixture(t,{launchFailure:error});
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),value=>{caught=value;return true;});
  assert.deepEqual(startupProbe.startupFailureProjection(caught).diagnostic,{phase:'launch',errorCode:'installed-app-exited',cleanup:'unverified'});
});

test('symlinked output parent and native image refuse without following links', {skip:process.platform==='win32'?'Windows symlink privilege unavailable in hosted fixture':false},async t=>{
  const f=await fixture(t);const linked=join(f.root,'linked');await symlink(f.root,linked);
  await assert.rejects(runNativeStartupProbe({...f.options,outputDir:join(linked,'out')},f.adapters));assert.equal(f.state.launched,0);
  const g=await fixture(t,{mutate:async receipt=>{const capture=JSON.parse(await readFile(receipt.scenarios[0].evidence)).capture;const target=join(f.root,'foreign.png');await writeFile(target,await readFile(capture.path));await rm(capture.path);await symlink(target,capture.path);}});
  await assert.rejects(runNativeStartupProbe(g.options,g.adapters));assert.deepEqual(await readdir(g.options.outputDir),[]);
});
test('extractor cleanup must finish before verified public marker is written',async t=>{
  const f=await fixture(t);const original=f.adapters.withArtifact;
  f.adapters.withArtifact=async(...args)=>{await original(...args);throw new Error('detach unverified');};
  await assert.rejects(runNativeStartupProbe(f.options,f.adapters));assert.deepEqual(await readdir(f.options.outputDir),[]);
});
test('CI preflight refuses unhosted, invalid flags, output escapes, and wrong source HEAD before launch',async t=>{
  const f=await fixture(t),environment={GITHUB_ACTIONS:'true',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_TEMP:f.root};
  for(const [args,env] of [
    [['--output-dir',f.options.outputDir],{...environment,RUNNER_ENVIRONMENT:'self-hosted'}],
    [['--output-dir',join(f.root,'..','escape')],environment],
    [['--output-dir',f.options.outputDir,'--source-sha','override'],environment],
    [['--output-dir',f.options.outputDir,'--output-dir',f.options.outputDir],environment],
  ])await assert.rejects(ciStartupOptions(args,{environment:env,repoRoot:f.root}));
  await mkdir(join(f.root,'apps/desktop/resources'),{recursive:true});
  await writeFile(join(f.root,'apps/desktop/package.json'),JSON.stringify({version:f.build.version}));
  await writeFile(join(f.root,'apps/desktop/resources/build-info.json'),JSON.stringify(f.build));
  // A fixture outside any Git checkout cannot establish current source provenance.
  await assert.rejects(ciStartupOptions(['--output-dir',f.options.outputDir,...(process.platform==='win32'?['--installed-app',f.options.installedApp]:[])],{environment,repoRoot:f.root}));
});
