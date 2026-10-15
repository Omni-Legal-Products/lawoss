import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { pathToFileURL } from 'node:url';
import * as api from './engine-direct-bare-control.mjs';
import { syntheticRuntimeEnvironment } from './engine-runtime-smoke.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
const noopSource = "import { writeFile } from 'node:fs/promises';\nexport default async function () {\n  await writeFile(new URL('./owned-noop-activation', import.meta.url), 'lawoss-owned-noop-invoked-v1\\n', { flag: 'wx' });\n  return {};\n}\n";
async function fixture(t, mode = 'ready', sdkMetadata = false) {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'direct-control-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'opencode-x86_64-pc-windows-msvc.exe');
  const source = `const http=require('node:http');const args=process.argv;const port=Number(args[args.indexOf('--port')+1]);const mode=${JSON.stringify(mode.startsWith('noop-')?mode.slice(5):mode)};const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Basic '+Buffer.from(process.env.OPENCODE_SERVER_USERNAME+':'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')){res.writeHead(401).end();return;}if(req.url==='/global/health'){const send=()=>res.end(JSON.stringify({healthy:true,version:'1.18.29'}));if(mode==='deadline')setTimeout(send,150);else send();return;}const dir=new URL(req.url,'http://localhost').searchParams.get('directory');if(mode==='stall'||mode==='deadline'){res.writeHead(200);res.write('{');return;}if(mode==='abort'){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),10);return;}if(mode==='oversized'){res.end('x'.repeat(65537));return;}if(mode==='invalid-utf8'){res.end(Buffer.from([255]));return;}if(mode==='duplicate'){res.end('{"directory":"x","directory":"y"}');return;}if(mode==='malformed'){res.end('{PRIVATE');return;}if(mode==='flood'){process.stdout.write('x'.repeat(65537));}res.end(JSON.stringify({directory:mode==='scope'?'/wrong':dir,worktree:dir}));});server.listen(port,'127.0.0.1');`;
  const metadataCheck = sdkMetadata ? `const assert=require('node:assert/strict');const root=process.env.HOME;assert.equal(await fs.realpath(root),path.dirname(process.cwd()));assert.equal(process.env.XDG_CONFIG_HOME,path.join(root,'config'));assert.equal(process.env.OPENCODE_CONFIG_DIR,path.join(root,'empty-config'));for(const role of [path.join(root,'config','opencode'),path.join(root,'empty-config')]){assert.equal(await fs.readFile(path.join(role,'package.json'),'utf8'),'{'+'"private":true,"dependencies":{"@opencode-ai/plugin":"1.18.29"}}');assert.equal(await fs.readFile(path.join(role,'package-lock.json'),'utf8'),'{'+'"lockfileVersion":3,"packages":{"":{"dependencies":{"@opencode-ai/plugin":"1.18.29"}}}}');assert.deepEqual(await fs.readdir(path.join(role,'node_modules')),[]);await assert.rejects(fs.lstat(path.join(role,'node_modules','@opencode-ai','plugin')));}assert.equal(await fs.readFile(path.join(root,'empty-config','opencode.json'),'utf8'),'{}');` : '';
  const activation = mode.startsWith('noop') ? `const fs=require('node:fs/promises');const path=require('node:path');const {fileURLToPath}=require('node:url');(async()=>{${metadataCheck}const config=JSON.parse(process.env.OPENCODE_CONFIG_CONTENT);require('node:assert/strict').deepEqual(Object.keys(config),['plugin']);require('node:assert/strict').equal(config.plugin.length,1);const url=config.plugin[0];const plugin=fileURLToPath(url);require('node:assert/strict').equal(await fs.realpath(plugin),path.join(path.dirname(process.cwd()),'owned-noop-plugin.mjs'));require('node:assert/strict').equal(await fs.readFile(plugin,'utf8'),${JSON.stringify(noopSource)});const ack=path.join(path.dirname(plugin),'owned-noop-activation');await require('node:assert/strict').rejects(fs.lstat(ack));const loaded=await import(url);await require('node:assert/strict').rejects(fs.lstat(ack));if(${JSON.stringify(mode)}==='noop-ready')await loaded.default();else if(${JSON.stringify(mode)}==='noop-wrong')await fs.writeFile(ack,'lawoss-owned-noop-invoked-v0\\n');else if(${JSON.stringify(mode)}==='noop-symlink'){const target=${JSON.stringify(path.join(root,'outside-ack'))};await fs.writeFile(target,'lawoss-owned-noop-invoked-v1\\n');await fs.symlink(target,ack);} ${source}})();` : source;
  await fs.writeFile(file, activation);
  await fs.writeFile(path.join(root, 'versions.json'), JSON.stringify({ opencode: { version: '1.18.29', sha256: sha(activation) } }));
  let privateRoot, spawnCount = 0, child;
  const options = { bundleDir: root, fixtureSha256: sha(activation), startupMs: 1500, closeMs: 100, drainMs: 100,
    onRoot: value => { privateRoot = value; },
    spawn: (executable,args,options) => { spawnCount++; child=spawn(process.execPath,[executable,...args],options); return child; },
    cleanupTree: async owned => { owned.kill('SIGTERM'); return true; } };
  return { root, file, options, get privateRoot(){return privateRoot;}, get spawnCount(){return spawnCount;}, get child(){return child;} };
}

test('noop child sees one fixed owned module and acknowledges only actual invocation',async t=>{
  const f=await fixture(t,'noop-ready'),original=f.options.spawn;f.options.ownedNoopPlugin=true;
  f.options.spawn=(exe,args,options)=>{
    const config=JSON.parse(options.env.OPENCODE_CONFIG_CONTENT);assert.deepEqual(config,{plugin:[pathToFileURL(path.join(f.privateRoot,'owned-noop-plugin.mjs')).href]});
    assert.equal(options.env.OPENCODE_DISABLE_DEFAULT_PLUGINS,'1');assert.equal(options.env.OPENCODE_DISABLE_MODELS_FETCH,'1');assert.equal(options.env.OPENCODE_DISABLE_SHARE,'1');assert.equal(options.env.OPENCODE_DISABLE_AUTOUPDATE,'1');
    assert.equal(options.env.PATH,undefined);assert.equal(options.env.OPENCODE_MODELS_PATH,undefined);assert.equal(options.env.BUN_INSPECT_PRELOAD,undefined);
    const environment=syntheticRuntimeEnvironment(f.privateRoot,undefined,process.platform);delete environment.BUN_INSPECT_PRELOAD;
    assert.deepEqual(options.env,{...environment,OPENCODE_CONFIG_CONTENT:JSON.stringify(config),OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_SHARE:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_CONFIG_DIR:path.join(f.privateRoot,'empty-config'),OPENCODE_SERVER_USERNAME:options.env.OPENCODE_SERVER_USERNAME,OPENCODE_SERVER_PASSWORD:options.env.OPENCODE_SERVER_PASSWORD});
    return original(exe,args,options);
  };
  const r=await api.testOnlyRun(f.options);
  assert.equal(r.namespace,'engine-direct-noop-plugin-control-v1');assert.equal(r.pluginObserved,true);assert.equal(r.outcome,'DIRECT_READY');assert.equal(r.rootRemoved,true);assert.equal(f.spawnCount,1);
  assert.ok(!JSON.stringify(r).includes(f.privateRoot));await assert.rejects(fs.stat(f.privateRoot));
});

test('noop missing, wrong and outside symlink acknowledgments retain unknown roots',async t=>{
  for(const mode of ['noop-missing','noop-wrong','noop-symlink']) {
    const f=await fixture(t,mode);f.options.ownedNoopPlugin=true;
    const r=await api.testOnlyRun(f.options);
    t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
    assert.equal(r.selectedStage,'verified');assert.equal(r.directClosed,true);assert.equal(r.pluginObserved,false);
    assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'plugin-unobserved');assert.equal(r.rootRemoved,false);assert.ok(await fs.stat(f.privateRoot));assert.equal(f.spawnCount,1);
    if(mode==='noop-wrong')assert.equal(await fs.readFile(path.join(f.privateRoot,'owned-noop-activation'),'utf8'),'lawoss-owned-noop-invoked-v0\n');
    if(mode==='noop-symlink')assert.equal(await fs.readFile(path.join(f.root,'outside-ack'),'utf8'),'lawoss-owned-noop-invoked-v1\n');
  }
});

test('noop scoped failure remains selected failed and inner initialization unknown',async t=>{
  const f=await fixture(t,'noop-scope');f.options.ownedNoopPlugin=true;
  const r=await api.testOnlyRun(f.options);
  assert.equal(r.outcome,'DIRECT_SELECTED_FAILED');assert.equal(r.reason,'selected');assert.equal(r.pluginObserved,false);assert.equal(r.selectedDirectoryMatches,false);assert.equal(r.directClosed,true);assert.equal(r.rootRemoved,true);assert.equal(r.descendantsUnknown,true);assert.equal(f.spawnCount,1);
});

test('noop projection is exactly 26 frozen primitives and stays separate from bare 25',async t=>{
  const f=await fixture(t,'noop-ready');f.options.ownedNoopPlugin=true;
  const r=await api.testOnlyRun(f.options);
  assert.equal(Object.keys(r).length,26);assert.ok(Object.isFrozen(r));assert.throws(()=>api.projectReceipt(r));
  assert.throws(()=>api.projectNoopPluginReceipt({...r,extra:'PRIVATE'}));assert.throws(()=>api.projectNoopPluginReceipt({...r,selectedElapsedMs:Infinity}));assert.throws(()=>api.projectNoopPluginReceipt({...r,pluginObserved:false}));
  assert.throws(()=>api.projectNoopPluginReceipt({...r,namespace:'engine-direct-bare-control-v1'}));assert.throws(()=>api.projectNoopPluginReceipt({...r,fixedSettingsSha256:'0'.repeat(64)}));
  const input={...r},projected=api.projectNoopPluginReceipt(input);input.pluginObserved=false;assert.equal(projected.pluginObserved,true);assert.ok(Object.isFrozen(projected));
  assert.equal(r.fixedSettingsSha256,'e7a2e06d81501fdbd60366eaef8f4e76a581110b4c9cc83406aed1eba73d4838');
});

test('noop CLI has one fixed flag, preserves binary pin and rejects arbitrary paths',async t=>{
  const f=await fixture(t),runner=path.resolve('lawoss/testing/isir/native/engine-direct-bare-control.mjs');
  async function cli(args) {
    const child=spawn(process.execPath,[runner,...args],{env:{...process.env,NODE_TEST_CONTEXT:'child-v8',ENGINE_SHA256:f.options.fixtureSha256},stdio:['ignore','pipe','pipe']});
    let text='';child.stdout.on('data',v=>{text+=v;});child.stderr.on('data',v=>{text+=v;});
    const exit=await new Promise(resolve=>child.once('close',resolve));return {exit,text};
  }
  const output=path.join(f.root,'noop.json');const admitted=await cli([output,f.root,'--owned-noop-plugin']);assert.equal(admitted.exit,0);
  const r=JSON.parse(await fs.readFile(output));assert.equal(r.namespace,'engine-direct-noop-plugin-control-v1');assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'admission');assert.equal(r.pluginObserved,false);assert.equal(Object.keys(r).length,26);assert.equal(r.expectedBinarySha256,'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d');
  for(const flags of [['--owned-noop-plugin=/arbitrary'],['--owned-noop-plugin','/arbitrary'],['--plugin','/arbitrary']]) {
    const refused=path.join(f.root,`refused-${flags.length}-${flags[0].replaceAll('/','_')}.json`);assert.equal((await cli([refused,f.root,...flags])).exit,1);await assert.rejects(fs.stat(refused));
  }
});

test('mismatched pinned bytes refuse execution and produce a closed receipt', async t => {
  const f=await fixture(t); const r=await api.runDirectBareControl(f.root);
  assert.equal(r.outcome,'UNKNOWN'); assert.equal(r.reason,'admission'); assert.equal(r.manifestBefore,true);
  assert.notEqual(r.observedBinarySha256,r.expectedBinarySha256);
});

test('actual synthetic listener verifies auth, selected scope and clean owned close without leaking environment', async t => {
  const f=await fixture(t); const original=f.options.spawn;
  const previous=process.env.PRIVATE_SECRET;process.env.PRIVATE_SECRET='PRIVATE';t.after(()=>{if(previous===undefined)delete process.env.PRIVATE_SECRET;else process.env.PRIVATE_SECRET=previous;});
  f.options.spawn=(exe,args,options)=>{assert.equal(options.env.BUN_INSPECT_PRELOAD,undefined);assert.equal(options.env.PATH,undefined);assert.equal(options.env.PRIVATE_SECRET,undefined);assert.equal(options.env.OPENCODE_MODELS_PATH,undefined);assert.equal(options.env.OPENCODE_CONFIG_CONTENT,'{}');assert.equal(options.env.OPENCODE_DISABLE_DEFAULT_PLUGINS,'1');return original(exe,args,options);};
  const r=await api.testOnlyRun(f.options);
  assert.equal(r.outcome,'DIRECT_READY');assert.equal(r.selectedStage,'verified');assert.equal(r.directClosed,true);assert.equal(r.treeCleanup,true);assert.equal(r.manifestAfter,true);assert.equal(r.descendantsUnknown,true);
  await assert.rejects(fs.stat(f.privateRoot));
  const wire=JSON.stringify(r);assert.ok(!wire.includes(f.root));assert.ok(!wire.includes(f.privateRoot));assert.ok(!wire.includes('authorization'));assert.ok(!wire.includes('PRIVATE'));
});

for(const mode of ['scope','malformed','duplicate','invalid-utf8','abort','stall','oversized']) test(`bounded actual transport: ${mode}`,async t=>{
  const f=await fixture(t,mode); if(mode==='stall'||mode==='deadline') f.options.startupMs=300;
  const started=Date.now(),r=await api.testOnlyRun(f.options);
  assert.equal(r.outcome,mode==='oversized'?'UNKNOWN':'DIRECT_SELECTED_FAILED');assert.equal(r.directClosed,true);assert.equal(r.selectedDirectoryMatches,false);assert.ok(Date.now()-started<2500);assert.equal(r.selectedStage,mode==='scope'?'body':'headers');if(r.outcome==='UNKNOWN')t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('one absolute deadline includes health retry and selected body',async t=>{const f=await fixture(t,'deadline');f.options.startupMs=300;const r=await api.testOnlyRun(f.options);assert.equal(r.outcome,'DIRECT_SELECTED_FAILED');assert.equal(r.reason,'deadline');assert.ok(r.selectedElapsedMs<250);});

test('identity changes after execution cannot be accepted',async t=>{
  const f=await fixture(t),cleanup=f.options.cleanupTree;
  f.options.cleanupTree=async child=>{await fs.appendFile(f.file,'\n');return cleanup(child);};
  const r=await api.testOnlyRun(f.options);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'identity');assert.equal(r.manifestAfter,false);
  assert.ok(await fs.stat(f.privateRoot));t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('cleanup failure retains private root even when direct child closes',async t=>{
  const f=await fixture(t);f.options.cleanupTree=async child=>{child.kill('SIGTERM');return false;};
  const r=await api.testOnlyRun(f.options);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'tree-cleanup');assert.equal(r.directClosed,true);assert.ok(await fs.stat(f.privateRoot));t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('unclosed owned child is bounded and receipt stays frozen after late close',async t=>{
  const f=await fixture(t);let child,kills=0;
  f.options.startupMs=50;f.options.spawn=()=>{child=new EventEmitter();child.pid=12345;child.exitCode=null;child.signalCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{kills++;return true;};child.unref=()=>{};queueMicrotask(()=>child.emit('spawn'));return child;};f.options.cleanupTree=async()=>false;
  const started=Date.now(),r=await api.testOnlyRun(f.options),before=JSON.stringify(r);
  assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'child-unclosed');assert.equal(r.directClosed,false);assert.equal(kills,1);assert.ok(Date.now()-started<1000);
  child.emit('close',0);assert.equal(JSON.stringify(r),before);assert.ok(Object.isFrozen(r));t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('stdout bound fails closed',async t=>{
  const f=await fixture(t,'flood');const r=await api.testOnlyRun(f.options);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'output-limit');t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('projection rejects extras, nonfinite values, unsafe provenance and detaches immutable receipt',async t=>{
  const f=await fixture(t);const r=await api.testOnlyRun(f.options);
  assert.throws(()=>api.projectReceipt({...r,private:'PRIVATE'}));assert.throws(()=>api.projectReceipt({...r,selectedElapsedMs:Infinity}));assert.throws(()=>api.projectReceipt({...r,head:'PRIVATE'}));assert.throws(()=>api.projectReceipt({...r,head:['a'.repeat(40)]}));assert.throws(()=>api.projectReceipt({...r,runId:['123']}));
  const input={...r},output=api.projectReceipt(input);input.outcome='UNKNOWN';assert.equal(output.outcome,'DIRECT_READY');assert.ok(Object.isFrozen(output));
});

for(const mode of ['error','early-close','identity-loss'])test(`owned lifecycle refuses ${mode}`,async t=>{
  const f=await fixture(t);let calls=0,kills=0;
  f.options.startupMs=50;
  f.options.spawn=()=>{const child=new EventEmitter();child.pid=12345;child.exitCode=null;child.signalCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{kills++;};child.unref=()=>{};queueMicrotask(()=>{if(mode==='error')child.emit('error',new Error('PRIVATE'));else if(mode==='early-close'){child.exitCode=1;child.emit('close',1);}else child.pid=54321;});return child;};
  f.options.cleanupTree=async child=>{calls++;child.emit('close',0);return true;};
  const r=await api.testOnlyRun(f.options);assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,mode==='error'?'child-error':mode==='early-close'?'unexpected-close':'child-unclosed');assert.equal(calls,mode==='error'?1:0);assert.equal(kills,0);t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
});

test('CLI admission refuses fixture bytes even with test context or SHA-like environment',async t=>{
  const f=await fixture(t),output=path.join(f.root,'receipt.json');
  const child=spawn(process.execPath,[path.resolve('lawoss/testing/isir/native/engine-direct-bare-control.mjs'),output,f.root],{env:{...process.env,NODE_TEST_CONTEXT:'child-v8',ENGINE_SHA256:f.options.fixtureSha256},stdio:['ignore','pipe','pipe']});
  let text='';child.stdout.on('data',v=>{text+=v;});child.stderr.on('data',v=>{text+=v;});await new Promise(resolve=>child.once('close',resolve));
  assert.equal(text,'Direct bare control receipt written.\n');const r=JSON.parse(await fs.readFile(output));assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'admission');assert.equal(r.expectedBinarySha256,'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d');
});


test('connected spawn spy refuses mismatched expected fixture SHA before spawning',async t=>{
  const f=await fixture(t),actual=sha(await fs.readFile(f.file));f.options.fixtureSha256='0'.repeat(64);
  const r=await api.testOnlyRun(f.options);
  assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'admission');assert.equal(r.observedBinarySha256,actual);assert.equal(r.manifestBefore,true);assert.equal(f.spawnCount,0);assert.equal(f.privateRoot,undefined);
});

test('actual tree helper adapter forwards isolated cleanup env and owned cwd',async t=>{
  const f=await fixture(t),previous={HOME:process.env.HOME,USERPROFILE:process.env.USERPROFILE,PRIVATE_CLEANUP_SENTINEL:process.env.PRIVATE_CLEANUP_SENTINEL};
  Object.assign(process.env,{HOME:'PRIVATE_PARENT_PROFILE',USERPROFILE:'PRIVATE_PARENT_PROFILE',PRIVATE_CLEANUP_SENTINEL:'PRIVATE_PARENT_SECRET'});
  t.after(()=>{for(const [key,value] of Object.entries(previous)){if(value===undefined)delete process.env[key];else process.env[key]=value;}});
  t.after(()=>f.privateRoot&&fs.rm(f.privateRoot,{recursive:true,force:true}));
  delete f.options.cleanupTree;f.options.cleanupPlatform='win32';let captured;
  f.options.cleanupSpawn=(executable,args,options)=>{captured={executable,args,options};const taskkill=new EventEmitter();taskkill.kill=()=>{};f.child.kill('SIGTERM');queueMicrotask(()=>taskkill.emit('exit',0));return taskkill;};
  const r=await api.testOnlyRun(f.options);
  assert.ok(captured,'actual helper must invoke the runner spawn adapter');assert.equal(r.outcome,'DIRECT_READY');
  assert.ok(captured.options.env,'cleanup child must receive explicit isolated env');
  assert.equal(captured.executable,path.win32.join(captured.options.env.SystemRoot??'C:\\Windows','System32','taskkill.exe'));
  assert.deepEqual(captured.args,['/pid',String(f.child.pid),'/T','/F']);assert.deepEqual(Object.keys(captured.options).sort(),['cwd','env','stdio','windowsHide']);assert.equal(captured.options.stdio,'ignore');assert.equal(captured.options.windowsHide,true);assert.equal(captured.options.cwd,f.privateRoot);
  assert.equal(captured.options.env.HOME,f.privateRoot);assert.equal(captured.options.env.USERPROFILE,f.privateRoot);assert.equal(captured.options.env.PRIVATE_CLEANUP_SENTINEL,undefined);assert.equal(captured.options.env.PATH,undefined);assert.equal(captured.options.env.BUN_INSPECT_PRELOAD,undefined);assert.equal(captured.options.env.OPENCODE_SERVER_PASSWORD,undefined);
  for(const [key,value] of Object.entries(captured.options.env))if(key!=='SystemRoot')assert.ok(value===f.privateRoot||value.startsWith(f.privateRoot+path.sep));
});


// Removing fixed seeding, physical admission, revalidation or strict projection must fail these cases.
test('SDK metadata actual child validates two exact empty roles and invokes unchanged plugin',async t=>{
  const f=await fixture(t,'noop-ready',true),original=f.options.spawn;f.options.ownedNoopSdkMetadata=true;
  f.options.spawn=(exe,args,options)=>{
    const environment=syntheticRuntimeEnvironment(f.privateRoot,undefined,process.platform);delete environment.BUN_INSPECT_PRELOAD;
    assert.deepEqual(options.env,{...environment,OPENCODE_CONFIG_CONTENT:JSON.stringify({plugin:[pathToFileURL(path.join(f.privateRoot,'owned-noop-plugin.mjs')).href]}),OPENCODE_DISABLE_DEFAULT_PLUGINS:'1',OPENCODE_DISABLE_MODELS_FETCH:'1',OPENCODE_DISABLE_SHARE:'1',OPENCODE_DISABLE_AUTOUPDATE:'1',OPENCODE_CONFIG_DIR:path.join(f.privateRoot,'empty-config'),OPENCODE_SERVER_USERNAME:options.env.OPENCODE_SERVER_USERNAME,OPENCODE_SERVER_PASSWORD:options.env.OPENCODE_SERVER_PASSWORD});
    return original(exe,args,options);
  };
  const r=await api.testOnlyRun(f.options);
  assert.equal(r.namespace,'engine-direct-noop-sdk-metadata-control-v1');assert.equal(r.outcome,'DIRECT_READY');assert.equal(r.seedPrepared,true);assert.equal(r.sourcePredicateSatisfied,true);assert.equal(r.pluginObserved,true);assert.equal(r.rootRemoved,true);assert.equal(r.directClosed,true);assert.equal(r.healthStatus,200);assert.equal(r.selectedDirectoryMatches,true);assert.equal(f.spawnCount,1);await assert.rejects(fs.lstat(f.privateRoot));
  assert.ok(!JSON.stringify(r).includes(f.privateRoot));assert.equal(sha(noopSource),'610fe8de2b4416c1622342765dc9c871e6f2c6e07b6002f039d1a3939c9308da');
});

test('SDK metadata refuses occupied seed and linked role or module without foreign writes or spawn',async t=>{
  for(const mode of ['role-link','module-link','occupied-file']) {
    const f=await fixture(t,'noop-ready',true);f.options.ownedNoopSdkMetadata=true;
    const foreign=path.join(f.root,'foreign');await fs.mkdir(foreign);await fs.writeFile(path.join(foreign,'sentinel'),'unchanged');
    f.options.beforeSeed=async root=>{
      if(mode==='role-link')await fs.symlink(foreign,path.join(root,'config','opencode'),process.platform==='win32'?'junction':'dir');
      if(mode==='module-link')await fs.symlink(foreign,path.join(root,'empty-config','node_modules'),process.platform==='win32'?'junction':'dir');
      if(mode==='occupied-file')await fs.writeFile(path.join(root,'empty-config','package.json'),'invalid');
    };
    const r=await api.testOnlyRun(f.options);t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
    assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'seed-invalid');assert.equal(r.seedPrepared,false);assert.equal(r.sourcePredicateSatisfied,false);assert.equal(r.rootRemoved,false);assert.equal(f.spawnCount,0);assert.deepEqual(await fs.readdir(foreign),['sentinel']);assert.equal(await fs.readFile(path.join(foreign,'sentinel'),'utf8'),'unchanged');
  }
});

test('SDK metadata validates after close, retains changed or unobserved roots and preserves selected failure',async t=>{
  for(const mode of ['metadata-change','installed-file','missing-marker','selected-failure','unclosed']) {
    const f=await fixture(t,mode==='missing-marker'?'noop-missing':mode==='selected-failure'?'noop-scope':'noop-ready',true);f.options.ownedNoopSdkMetadata=true;
    if(mode==='metadata-change'||mode==='installed-file') {
      f.options.cleanupTree=async child=>{const closed=new Promise(resolve=>child.once('close',resolve));child.kill('SIGTERM');await closed;
        if(mode==='metadata-change')await fs.writeFile(path.join(f.privateRoot,'config','opencode','package.json'),'{}');
        else await fs.writeFile(path.join(f.privateRoot,'empty-config','node_modules','unexpected'),'x');return true;};
    }
    if(mode==='unclosed') {
      f.options.startupMs=50;f.options.spawn=()=>{const child=new EventEmitter();child.pid=12345;child.exitCode=null;child.signalCode=null;child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;child.unref=()=>{};return child;};f.options.cleanupTree=async()=>false;
    }
    const r=await api.testOnlyRun(f.options);t.after(()=>fs.rm(f.privateRoot,{recursive:true,force:true}));
    const seedValid=mode==='missing-marker'||mode==='selected-failure';
    assert.equal(r.seedPrepared,seedValid);assert.equal(r.sourcePredicateSatisfied,seedValid);assert.equal(r.directClosed,mode!=='unclosed');
    assert.equal(r.outcome,mode==='selected-failure'?'DIRECT_SELECTED_FAILED':'UNKNOWN');assert.equal(r.reason,mode==='unclosed'?'child-unclosed':mode==='missing-marker'?'plugin-unobserved':mode==='selected-failure'?'selected':'seed-changed');assert.equal(r.rootRemoved,mode==='selected-failure');assert.equal(r.pluginObserved,mode==='metadata-change'||mode==='installed-file');
    if(mode!=='selected-failure')assert.ok(await fs.lstat(f.privateRoot));
  }
});

test('SDK metadata projection is exactly 28 primitives and cannot weaken bare or noop contracts',async t=>{
  const f=await fixture(t,'noop-ready',true);f.options.ownedNoopSdkMetadata=true;const r=await api.testOnlyRun(f.options);
  assert.equal(Object.keys(r).length,28);assert.equal(r.fixedSettingsSha256,'397e6919660827ea65867255723a6243371698e0bf81be158c70a9b1ec04c009');assert.ok(Object.isFrozen(r));assert.throws(()=>api.projectReceipt(r));assert.throws(()=>api.projectNoopPluginReceipt(r));
  for(const change of [{extra:'PRIVATE'},{selectedElapsedMs:Infinity},{seedPrepared:false},{sourcePredicateSatisfied:false},{seedPrepared:false,sourcePredicateSatisfied:false},{pluginObserved:false},{namespace:'engine-direct-noop-plugin-control-v1'},{fixedSettingsSha256:'0'.repeat(64)}])assert.throws(()=>api.projectNoopSdkMetadataReceipt({...r,...change}));
  const input={...r},projected=api.projectNoopSdkMetadataReceipt(input);input.seedPrepared=false;assert.equal(projected.seedPrepared,true);assert.ok(Object.isFrozen(projected));
  assert.throws(()=>api.projectReceipt({...r,namespace:'engine-direct-bare-control-v1'}));assert.throws(()=>api.projectNoopPluginReceipt({...r,namespace:'engine-direct-noop-plugin-control-v1'}));
});

test('SDK metadata CLI cannot bypass pin or accept arbitrary role flags',async t=>{
  const f=await fixture(t),runner=path.resolve('lawoss/testing/isir/native/engine-direct-bare-control.mjs');
  async function cli(output,flags){const child=spawn(process.execPath,[runner,output,f.root,...flags],{env:{...process.env,NODE_TEST_CONTEXT:'child-v8',ENGINE_SHA256:f.options.fixtureSha256},stdio:['ignore','pipe','pipe']});let text='';child.stdout.on('data',v=>text+=v);child.stderr.on('data',v=>text+=v);return {exit:await new Promise(resolve=>child.once('close',resolve)),text};}
  const output=path.join(f.root,'metadata.json');assert.equal((await cli(output,['--owned-noop-sdk-metadata'])).exit,0);const r=JSON.parse(await fs.readFile(output));assert.equal(r.namespace,'engine-direct-noop-sdk-metadata-control-v1');assert.equal(r.outcome,'UNKNOWN');assert.equal(r.reason,'admission');assert.equal(r.seedPrepared,false);assert.equal(r.sourcePredicateSatisfied,false);assert.equal(r.expectedBinarySha256,'32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d');assert.equal(Object.keys(r).length,28);
  for(const [index,flags] of [['--owned-noop-sdk-metadata=/arbitrary'],['--owned-noop-sdk-metadata','/arbitrary'],['--seed-role','/arbitrary']].entries()){const refused=path.join(f.root,`refused-sdk-${index}.json`);assert.equal((await cli(refused,flags)).exit,1);await assert.rejects(fs.lstat(refused));}
});
