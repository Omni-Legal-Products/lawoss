import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile, access, realpath, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { runNativeStartupProbe, startupAssetName, ciStartupOptions } from './probe-startup-ci.mjs';
import { runAlphaAcceptance } from './run.mjs';
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
      const observe = async () => ({ok:true,build:{...build,os:build.platform,provenance:'embedded',legalworkDevMode:false},process:{pid:123,userData:join(profileRoot,'userdata'),executable},rendererUrl:pathToFileURL(join(resources,'app-dist/index.html')).href,snapshot:{ok:true,route:change.route ?? '/welcome',readiness:{documentReadyState:'complete',bootOverlayVisible:false,interactiveControls:1}}});
      return {pid:123,observe,capture:async path=>{
        state.captures++;
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
  assert.equal(result.fullAcceptance.status,'blocked'); assert.deepEqual(result.fullAcceptance.unperformed,ALPHA_SCENARIOS.slice(1));
  const publicText=await readFile(join(f.options.outputDir,'startup.json'),'utf8');
  for(const privateValue of [f.root,'ownerPid','profileRoot','rendererUrl','reasons','token'])assert.equal(publicText.includes(privateValue),false);
  assert.equal(result.startup.capture.sha256,digest(await readFile(join(f.options.outputDir,image))));
  await assert.rejects(access(join(f.state.profileRoot,'.alpha-acceptance-baseline.json')));
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
