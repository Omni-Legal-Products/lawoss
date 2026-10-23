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
import { createNativeAppStop, launchAlphaApp } from './native-app.mjs';
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
      const observe = async () => ({ok:true,windowSourceId:state.captures && change.afterWindow ? 'window:43:0' : 'window:42:0',build:{...build,os:build.platform,provenance:'embedded',legalworkDevMode:false},process:{pid:123,userData:join(profileRoot,'userdata'),executable},rendererUrl:pathToFileURL(join(resources,'app-dist/index.html')).href,snapshot:{ok:true,windowSourceId:state.captures && change.afterWindow ? 'window:43:0' : 'window:42:0',route:change.route ?? '/welcome',readiness:{documentReadyState:'complete',bootOverlayVisible:false,interactiveControls:1,documentTimeOrigin:state.captures && change.afterDocument ? 1700000000001.5 : 1700000000000.5}}});
      return {pid:123,observe,capture:async path=>{
        state.captures++;
        if(change.captureFailure)throw change.captureFailure;
        const bytes = Buffer.alloc(process.platform === 'linux' ? 100 : 24);
        if(process.platform==='linux')bytes.writeUInt32BE(7,4); else Buffer.from([137,80,78,71,13,10,26,10]).copy(bytes);
        if(change.invalidImage)bytes.fill(0);
        await writeFile(path,bytes,{flag:'wx'});
        return {path,sha256:digest(bytes),format:process.platform === 'linux' ? 'xwd':'png',method:change.method ?? method,ownerPid:change.ownerPid ?? 123,...(change.omitBinding ? {} : {windowSourceId:change.captureWindow ?? 'window:42:0',documentTimeOrigin:change.captureDocument ?? 1700000000000.5})};
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
  assert.deepEqual(result.startup.capture.binding,{status:'verified',window:'same',document:'same'});
  assert.equal(JSON.stringify(result).includes('nativeLaunch'),false);
  assert.equal(JSON.stringify(result).includes('nativeReadiness'),false);
  assert.equal(JSON.stringify(result).includes('mainLog'),false);
  assert.equal(result.fullAcceptance.status,'blocked'); assert.deepEqual(result.fullAcceptance.unperformed,ALPHA_SCENARIOS.slice(1));
  const publicText=await readFile(join(f.options.outputDir,'startup.json'),'utf8');
  for(const privateValue of [f.root,'ownerPid','profileRoot','rendererUrl','reasons','token','windowSourceId','documentTimeOrigin','window:42:0','1700000000000.5'])assert.equal(publicText.includes(privateValue),false);
  assert.equal(result.startup.capture.sha256,digest(await readFile(join(f.options.outputDir,image))));
  await assert.rejects(access(join(f.state.profileRoot,'.alpha-acceptance-baseline.json')));
});

test('capture refuses changed window or reloaded same-URL document and missing binding',async t=>{
  for(const [name,change] of Object.entries({
    'replaced window':{afterWindow:true},'same URL new document':{afterDocument:true},
    'different captured window':{captureWindow:'window:99:0'},
    'different captured document':{captureDocument:1700000000099.5},
    'missing capture binding':{omitBinding:true},
  }))await t.test(name,async t=>{
    const f=await fixture(t,change);
    await assert.rejects(runNativeStartupProbe(f.options,f.adapters));
    assert.equal(f.state.captures,1,'refusal must follow the actual bounded capture seam');
    assert.deepEqual(await readdir(f.options.outputDir),[],'a mismatched capture cannot publish a verified receipt or image');
  });
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

test('actual owned POSIX child alive without discovery preserves finite readiness progress before cleanup', {
  skip:process.platform==='win32'?'Controlled POSIX executable fixture requires a POSIX host':false,
  timeout:15_000,
},async t=>{
  const f=await fixture(t);
  const executable=process.platform==='darwin'?join(f.root,'LAWOSS.app/Contents/MacOS/LAWOSS'):join(f.root,'legalwork');
  await writeFile(executable,`#!${process.execPath}\nimport {mkdirSync,writeFileSync} from 'node:fs';import {join} from 'node:path';const root=process.env.LEGALWORK_ELECTRON_USERDATA;writeFileSync(join(root,'fixture-alive'),'PRIVATE-LIVE');mkdirSync(join(root,'logs'));writeFileSync(join(root,'logs/main.log'),'[2026-10-22T00:00:00.000Z] ERROR [main] Unhandled rejection: PRIVATE-TOKEN /private/client pid=778899\\n');setInterval(()=>{},1000);\n`);
  await chmod(executable,0o700);
  let nativeError,ownedProfileRoot;
  f.adapters.launch=async options=>{
    ownedProfileRoot=options.profileRoot;
    try{return await launchAlphaApp({...options,timeoutMs:1200});}
    catch(error){nativeError=error;throw error;}
  };
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
  assert.equal(await readFile(join(ownedProfileRoot,'userdata/fixture-alive'),'utf8'),'PRIVATE-LIVE');
  assert.equal(nativeError.code,'native-readiness-timeout');assert.equal(nativeError.nativeCleanup.descendantClosure,'verified');
  const result=startupProbe.startupFailureProjection(caught);
  assert.equal(result.diagnostic.phase,'launch');assert.equal(result.diagnostic.errorCode,'native-readiness-timeout');assert.equal(result.diagnostic.cleanup,'native-verified');
  assert.equal(result.diagnostic.nativeLaunch.exitObserved,false);
  const readiness=result.diagnostic.nativeReadiness;
  assert.ok(readiness,'Owned readiness retries must retain their finite observations');
  assert.ok(Number.isInteger(readiness.attempts)&&readiness.attempts>0&&readiness.attempts<=128);
  assert.equal(readiness.attemptsCapped,false);
  assert.equal(readiness.progress,'none');assert.equal(readiness.lastBoundary,'discovery');assert.equal(readiness.lastError,'ENOENT');
  assert.ok(Object.isFrozen(readiness));
  assert.ok(result.diagnostic.mainLog,'Verified native closure must retain a bounded private main-log observation');
  assert.ok(JSON.stringify(result.diagnostic.mainLog).includes('main-unhandled-rejection'));
  assert.ok(Object.isFrozen(result.diagnostic.mainLog));
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|fixture-alive|private\/profile|"pid"|token|rendererUrl|baseUrl/);
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
  const f=await fixture(t,{stopFails:true});let caught;
  await assert.rejects(runNativeStartupProbe(f.options,f.adapters),error=>{caught=error;return true;});
  assert.equal('mainLog' in startupProbe.startupFailureProjection(caught).diagnostic,false);
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
    forgedDocument:{mutate:async r=>{const path=r.scenarios[0].evidence,e=JSON.parse(await readFile(path));e.observed.snapshot.readiness.documentTimeOrigin++;await writeFile(path,JSON.stringify(e));}},
    forgedWindow:{mutate:async r=>{const path=r.scenarios[0].evidence,e=JSON.parse(await readFile(path));e.observed.windowSourceId='window:99:0';e.observed.snapshot.windowSourceId='window:99:0';await writeFile(path,JSON.stringify(e));}},
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

test('forged readiness fields and nested causes cannot create startup readiness observations',async t=>{
  const fake={attempts:999999,progress:'PRIVATE',lastBoundary:'/private/profile',lastError:'PRIVATE'};
  const error=Object.assign(new Error('PRIVATE'),{code:'native-readiness-timeout',nativeReadiness:fake,cause:{nativeReadiness:fake}});
  const f=await fixture(t,{launchFailure:error});
  let caught;await assert.rejects(runNativeStartupProbe(f.options,f.adapters),value=>{caught=value;return true;});
  assert.deepEqual(startupProbe.startupFailureProjection(caught).diagnostic,{phase:'launch',errorCode:'native-readiness-timeout',cleanup:'unverified'});
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

test('failure-only Documents observer runs after original projection and exit1 and cannot mask either', async () => {
  const primary = Object.assign(new Error('PRIVATE_ORIGINAL_FAILURE'), { code: 'native-readiness-timeout' });
  const expected = startupProbe.startupFailureProjection(primary), lines = [], previousError = console.error, previousExitCode = process.exitCode;
  console.error = line => lines.push(line);
  try {
    let calls = 0;
    const result = await startupProbe.reportStartupFailure(primary, { privatePath: 'PRIVATE_PATH' }, async (failure, options) => {
      calls++;
      assert.deepEqual(JSON.parse(lines[0]), expected);
      assert.equal(process.exitCode, 1);
      assert.equal(options.privatePath, 'PRIVATE_PATH');
      assert.deepEqual(failure, expected);
      throw new Error('PRIVATE_DIAGNOSTIC_FAILURE');
    });
    assert.equal(calls, 1); assert.deepEqual(result, expected); assert.equal(process.exitCode, 1);
    assert.deepEqual(JSON.parse(lines[0]), expected);
    assert.deepEqual(JSON.parse(lines[1]), { kind: 'lawoss-windows-documents-diagnostic', status: 'incomplete', reason: 'probe-unavailable' });
    assert.equal(lines.some(line => line.includes('PRIVATE')), false);
    assert.equal(primary.message, 'PRIVATE_ORIGINAL_FAILURE');
    await startupProbe.reportStartupFailure(primary, undefined, async () => { process.exitCode = 0; });
    assert.equal(process.exitCode, 1);
  } finally { console.error = previousError; process.exitCode = previousExitCode; }
});


for (const mode of ['written', 'work', 'capture']) test(`cleanup attribution survives actual acceptance catch: ${mode}`, async t => {
  const work = Object.assign(new Error('PRIVATE work reason'), { code: 'EACCES' });
  const stopError = Object.assign(new Error('PRIVATE stop reason /profile/token'), { code: 'profile-lock-ownership-lost' });
  const f = await fixture(t, mode === 'capture' ? { captureFailure: work } : {});
  const launch = f.adapters.launch;
  let savedReceipt, stopIdentity, actualError, stopCount = 0;
  f.adapters.runAcceptance = async (options, ports) => {
    savedReceipt = await runAlphaAcceptance(options, ports);
    return savedReceipt;
  };
  f.adapters.launch = async options => {
    const app = await launch(options);
    if (mode === 'work') {
      const capture = app.capture;
      app.capture = async path => {
        const result = await capture(path);
        // Fail in runAlphaAcceptance's own capture-byte read, after the probe wrapper.
        await rm(path);
        return result;
      };
    }
    stopIdentity = createNativeAppStop({ state: () => ({ child: { pid: 123 }, closed: Promise.resolve() }),
      root: 'MODEL', onStop: () => { stopCount++; }, closeLock: async () => {},
      releaseLock: async () => { actualError = stopError; throw stopError; },
    }, { stopChild: async () => {}, removeLease: async () => {} });
    app.stop = stopIdentity;
    return app;
  };
  let caught;
  try { await runNativeStartupProbe(f.options, f.adapters); } catch (error) { caught = error; }
  assert.ok(caught);
  assert.equal(actualError, stopError);
  assert.equal(stopCount, 1);
  const projection = startupProbe.startupFailureProjection(caught);
  assert.deepEqual(projection.diagnostic, {
    phase: mode === 'capture' ? 'capture' : 'cleanup',
    errorCode: mode === 'capture' ? 'EACCES' : 'profile-lock-ownership-lost', cleanup: 'unverified',
    cleanupAttribution: { schema: 1,
      startup: { record: mode === 'written' ? 'written' : 'not-observed', workFailureCode: mode === 'written' ? null : mode === 'work' ? 'ENOENT' : 'EACCES', finalResult: 'unverified' },
      stop: { failedAt: 'profile-lock', completed: 3, errorCode: 'profile-lock-ownership-lost' } },
  });
  assert.equal(savedReceipt.cleanup, 'unverified');
  assert.equal(savedReceipt.reasons.at(-1), 'Owned process cleanup could not be verified');
  assert.equal(savedReceipt.reasons.length, mode === 'written' ? 1 : 2);
  assert.equal(f.state.retained, true);
  assert.ok(await readFile(join(f.state.profileRoot, '.acceptance-running.lock')));
  assert.deepEqual(await readdir(f.options.outputDir), []);
  assert.doesNotMatch(JSON.stringify(projection), /PRIVATE|profile\/token|ownerPid|stack|cause|reasons/);
});

function trustedModelStop(stage, error) {
  const closed = stage === 'child-close' ? Promise.reject(error) : Promise.resolve();
  closed.catch(() => {});
  return createNativeAppStop({ state: () => ({ child: { pid: 123 }, closed }), root: 'MODEL', onStop: () => {}, closeLock: async () => {},
    releaseLock: async () => { if (stage === 'profile-lock') throw error; },
  }, { stopChild: async () => { if (stage === 'native-stop') throw error; }, removeLease: async () => { if (stage === 'chromium-lease') throw error; } });
}

test('cleanup attribution binds the invoked stop owner even when its method changes during failure', async t => {
  const f = await fixture(t), launch = f.adapters.launch;
  const error = Object.assign(new Error('PRIVATE'), { code: 'EACCES' });
  const earlier = trustedModelStop('native-stop', error), actual = trustedModelStop('profile-lock', error);
  await earlier().catch(() => {});
  let lookups = 0, ownerApp;
  f.adapters.launch = async options => {
    ownerApp = await launch(options);
    Object.defineProperty(ownerApp, 'stop', { enumerable: true, get() { lookups++; return lookups <= 2 ? actual : earlier; } });
    return ownerApp;
  };
  let caught; try { await runNativeStartupProbe(f.options, f.adapters); } catch (error) { caught = error; }
  assert.equal(lookups, 2, 'original spread and actual method invocation only; no catch reread');
  assert.deepEqual(startupProbe.startupFailureProjection(caught).diagnostic.cleanupAttribution.stop,
    { failedAt: 'profile-lock', completed: 3, errorCode: 'EACCES' });
});

test('cleanup attribution rejects unregistered, copied, wrapped, primitive and foreign-owner stop failures', async t => {
  const error = Object.assign(new Error('PRIVATE'), { code: 'EACCES' });
  const foreignStop = trustedModelStop('native-stop', error);
  await foreignStop().catch(() => {});
  let getters = 0;
  const hostile = Object.defineProperty({}, 'code', { get() { getters++; throw new Error('PRIVATE getter'); } });
  for (const [value, code] of [[error, 'EACCES'], [Object.assign(new Error('PRIVATE'), { code: 'EACCES', cleanupAttribution: { failedAt: 'profile-lock', completed: 3 } }), 'EACCES'],
    [new Error('PRIVATE wrapper', { cause: error }), 'unknown'], [{ ...error }, 'EACCES'], ['PRIVATE primitive', 'unknown'], [null, 'unknown'], [hostile, 'unknown']]) {
    const f = await fixture(t), launch = f.adapters.launch;
    let receiver;
    f.adapters.launch = async options => {
      const app = await launch(options);
      app.stop = function () { receiver = this; throw value; };
      f.state.originalApp = app;
      return app;
    };
    let caught; try { await runNativeStartupProbe(f.options, f.adapters); } catch (error) { caught = error; }
    assert.equal(receiver, f.state.originalApp);
    assert.deepEqual(startupProbe.startupFailureProjection(caught).diagnostic,
      { phase: 'cleanup', errorCode: code, cleanup: 'unverified' });
    assert.equal(f.state.retained, true);
    assert.deepEqual(await readdir(f.options.outputDir), []);
  }
  assert.equal(getters, 1, 'only the unchanged first failure classifier reads the hostile code');
});

test('cleanup attribution uses whole closed codes and freezes private-free projection independently of error mutation', async t => {
  const f = await fixture(t), launch = f.adapters.launch;
  const error = Object.assign(new Error('PRIVATE ENOENT /path'), { code: 'EACCES-private-token' });
  f.adapters.launch = async options => ({ ...await launch(options), stop: trustedModelStop('chromium-lease', error) });
  let caught; try { await runNativeStartupProbe(f.options, f.adapters); } catch (error) { caught = error; }
  const before = startupProbe.startupFailureProjection(caught);
  error.code = 'ENOENT'; error.message = 'ENOENT';
  const after = startupProbe.startupFailureProjection(caught);
  assert.deepEqual(after, before);
  assert.equal(after.diagnostic.errorCode, 'unknown');
  assert.deepEqual(after.diagnostic.cleanupAttribution.stop, { failedAt: 'chromium-lease', completed: 2, errorCode: 'unknown' });
  assert.ok(Object.isFrozen(after.diagnostic.cleanupAttribution));
  assert.ok(Object.isFrozen(after.diagnostic.cleanupAttribution.startup));
  assert.ok(Object.isFrozen(after.diagnostic.cleanupAttribution.stop));
  assert.doesNotMatch(JSON.stringify(after), /PRIVATE|private-token|path|message|stack|cause/);
});

test('cleanup attribution cannot make a cleanup failure eligible for Windows documents diagnostics', async () => {
  const { shouldRunWindowsDocumentsProbe } = await import('./windows-documents-probe.mjs');
  const failure = { kind: 'lawoss-ci-native-startup', status: 'failed', reason: 'native-startup-unverified',
    diagnostic: { phase: 'cleanup', errorCode: 'unknown', cleanup: 'unverified' } };
  const context = { platform: 'win32', arch: 'x64', environment: { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' } };
  assert.equal(shouldRunWindowsDocumentsProbe(failure, context), false);
  failure.diagnostic.cleanupAttribution = { schema: 1, startup: { record: 'written', workFailureCode: null, finalResult: 'unverified' },
    stop: { failedAt: 'native-stop', completed: 0, errorCode: 'unknown' } };
  assert.equal(shouldRunWindowsDocumentsProbe(failure, context), false);
});

test('cleanup attribution successful inert startup publishes only after native and extractor joins with original schema', async t => {
  const f = await fixture(t), launch = f.adapters.launch, withArtifact = f.adapters.withArtifact;
  const nativeEntered = Promise.withResolvers(), nativeRelease = Promise.withResolvers();
  const extractorEntered = Promise.withResolvers(), extractorRelease = Promise.withResolvers();
  const order = [];
  f.adapters.launch = async options => ({ ...await launch(options), stop: createNativeAppStop({
    state: () => ({ child: { pid: 123 }, closed: Promise.resolve() }), root: 'MODEL', onStop: () => {}, closeLock: async () => {},
    releaseLock: async () => { nativeEntered.resolve(); await nativeRelease.promise; order.push('native'); },
  }, { stopChild: async () => {}, removeLease: async () => {} }) });
  f.adapters.withArtifact = async (...args) => {
    const result = await withArtifact(...args);
    extractorEntered.resolve(); await extractorRelease.promise; order.push('extractor');
    return result;
  };
  const operation = runNativeStartupProbe(f.options, f.adapters);
  try {
    await nativeEntered.promise;
    assert.deepEqual(await readdir(f.options.outputDir), []);
    nativeRelease.resolve();
    await extractorEntered.promise;
    assert.deepEqual(order, ['native']);
    assert.deepEqual(await readdir(f.options.outputDir), []);
    extractorRelease.resolve();
    const result = await operation;
    assert.deepEqual(order, ['native', 'extractor']);
    assert.deepEqual(Object.keys(result).sort(), ['schemaVersion', 'kind', 'status', 'releaseEligible', 'build', 'assetSha256', 'installation', 'startup', 'cleanup', 'nativeReview', 'fullAcceptance', 'at'].sort());
    assert.equal(result.schemaVersion, 1);
    assert.equal(result.status, 'verified');
    assert.equal(result.cleanup, 'verified');
    assert.equal(result.startup.capture.sha256, digest(await readFile(join(f.options.outputDir, result.startup.capture.file))));
    assert.equal(f.state.retained, false);
  } finally { nativeRelease.resolve(); extractorRelease.resolve(); await operation; }
});
