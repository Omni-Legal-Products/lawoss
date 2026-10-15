import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import * as api from './engine-direct-bare-control.mjs';

const sha = b => createHash('sha256').update(b).digest('hex');
async function fixture(t, mode = 'ready') {
  const root = await fs.mkdtemp(path.join(tmpdir(), 'direct-control-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'opencode-x86_64-pc-windows-msvc.exe');
  const source = `const http=require('node:http');const args=process.argv;const port=Number(args[args.indexOf('--port')+1]);const mode=${JSON.stringify(mode)};const server=http.createServer((req,res)=>{if(req.headers.authorization!=='Basic '+Buffer.from(process.env.OPENCODE_SERVER_USERNAME+':'+process.env.OPENCODE_SERVER_PASSWORD).toString('base64')){res.writeHead(401).end();return;}if(req.url==='/global/health'){const send=()=>res.end(JSON.stringify({healthy:true,version:'1.18.29'}));if(mode==='deadline')setTimeout(send,150);else send();return;}const dir=new URL(req.url,'http://localhost').searchParams.get('directory');if(mode==='stall'||mode==='deadline'){res.writeHead(200);res.write('{');return;}if(mode==='abort'){res.writeHead(200);res.write('{');setTimeout(()=>res.destroy(),10);return;}if(mode==='oversized'){res.end('x'.repeat(65537));return;}if(mode==='invalid-utf8'){res.end(Buffer.from([255]));return;}if(mode==='duplicate'){res.end('{"directory":"x","directory":"y"}');return;}if(mode==='malformed'){res.end('{PRIVATE');return;}if(mode==='flood'){process.stdout.write('x'.repeat(65537));}res.end(JSON.stringify({directory:mode==='scope'?'/wrong':dir,worktree:dir}));});server.listen(port,'127.0.0.1');`;
  await fs.writeFile(file, source);
  await fs.writeFile(path.join(root, 'versions.json'), JSON.stringify({ opencode: { version: '1.18.29', sha256: sha(source) } }));
  let privateRoot, spawnCount = 0, child;
  const options = { bundleDir: root, fixtureSha256: sha(source), startupMs: 1500, closeMs: 100, drainMs: 100,
    onRoot: value => { privateRoot = value; },
    spawn: (executable,args,options) => { spawnCount++; child=spawn(process.execPath,[executable,...args],options); return child; },
    cleanupTree: async owned => { owned.kill('SIGTERM'); return true; } };
  return { root, file, options, get privateRoot(){return privateRoot;}, get spawnCount(){return spawnCount;}, get child(){return child;} };
}

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
