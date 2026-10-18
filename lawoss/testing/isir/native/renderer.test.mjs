import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, rm, readFile, readdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:net';
import { spawn, execFile as execFileCallback } from 'node:child_process';
import { promisify } from 'node:util';
import { until } from './cdp.mjs';
import { createHash } from 'node:crypto';
const execFile=promisify(execFileCallback);
async function builtFiles(root) {
  const hashes={};
  for(const name of (await readdir(root,{recursive:true})).sort())if((await stat(path.join(root,name))).isFile())hashes[name]=createHash('sha256').update(await readFile(path.join(root,name))).digest('hex');
  return hashes;
}

test('native renderer serves the built app and rejects a missing build without a dev fallback', async () => {
  const renderer = await import('./renderer.mjs').catch(error => { if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error; });
  assert.equal(typeof renderer?.nativeRendererLaunch,'function','Native bootstrap needs a built-renderer launch adapter');
  const root=await mkdtemp(path.join(tmpdir(),'native-renderer-test-'));
  try {
    await assert.rejects(renderer.nativeRendererLaunch(root,4321),{code:'ENOENT'});
    await mkdir(path.join(root,'dist'));
    await assert.rejects(renderer.nativeRendererLaunch(root,4321),{code:'ENOENT'});
    await writeFile(path.join(root,'dist/index.html'),'<!doctype html><title>Synthetic built renderer</title>');
    assert.deepEqual(await renderer.nativeRendererLaunch(root,4321),{
      cwd:root,args:['preview','--host','127.0.0.1','--port','4321','--strictPort'],
    });
  } finally { await rm(root,{recursive:true,force:true}); }
});


test('built preview serves compiled mounted regressions without source TSX or changing the built app', async t => {
  const { nativeRendererLaunch } = await import('./renderer.mjs');
  const appRoot=fileURLToPath(new URL('../../../../apps/app/',import.meta.url));
  // Source CI builds the server, not the app. Use an explicit built HTML marker;
  // compile the actual mounted TSX entries, never source-transform the app.
  const builtIndex=Buffer.from('<!doctype html><title>Isolated prebuilt fixture</title>');
  const builtBefore=await builtFiles(path.join(appRoot,'dist')).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
  assert.ok(!builtBefore||!Object.keys(builtBefore).some(name=>name.startsWith('__isir-fixtures/')),'Native fixtures must not enter the normal packaged app build');
  const root=await mkdtemp(path.join(tmpdir(),'native-compiled-renderer-'));
  await mkdir(path.join(root,'dist'));await writeFile(path.join(root,'dist/index.html'),builtIndex);
  const socket=createServer();await new Promise(resolve=>socket.listen(0,'127.0.0.1',resolve));
  const port=socket.address().port;await new Promise(resolve=>socket.close(resolve));
  let child,exit;
  try {
    // Observe real V8 budgets at the compiler boundary, including inherited options.
    // The constrained driver owns these options; the test runner's env is untouched.
    const probe=path.join(root,'heap-probe.mjs');
    await writeFile(probe,`import { getHeapStatistics } from 'node:v8';
import { writeFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const compiler=process.argv.includes('--compile-fixtures');
const heap=getHeapStatistics().heap_size_limit/1024/1024;
writeFileSync(new URL(compiler?'compiler-heap.json':'parent-heap.json',import.meta.url),JSON.stringify({heap,nodeOptions:process.env.NODE_OPTIONS}));
if(compiler)assert.ok(heap>=6144&&heap<6400,'Fixture compiler needs a bounded 6144 MiB old-space budget under a constrained parent; actual heap '+heap+' MiB');
`);
    await execFile(process.execPath,['--input-type=module','-e',
      `import { compileNativeRendererFixtures } from ${JSON.stringify(new URL('./renderer.mjs',import.meta.url).href)};await compileNativeRendererFixtures(...process.argv.slice(1));`,
      appRoot,path.join(root,'dist')],{env:{...process.env,NODE_OPTIONS:`${process.env.NODE_OPTIONS??''} --max-old-space-size=2048 --import=${pathToFileURL(probe).href}`},maxBuffer:1024*1024});
    const parentHeap=JSON.parse(await readFile(path.join(root,'parent-heap.json'),'utf8'));
    const compilerHeap=JSON.parse(await readFile(path.join(root,'compiler-heap.json'),'utf8'));
    assert.ok(parentHeap.heap>=2048&&parentHeap.heap<2304,'Driver retains its constrained parent budget');
    assert.ok(compilerHeap.heap>=6144&&compilerHeap.heap<6400,'Compiler gets the explicit bounded build budget');
    assert.equal(compilerHeap.nodeOptions,parentHeap.nodeOptions,'Compiler preserves inherited NODE_OPTIONS');
    t.diagnostic(`Effective V8 heap: constrained parent ${parentHeap.heap} MiB; compiler ${compilerHeap.heap} MiB`);
    const launch=await nativeRendererLaunch(root,port);
    const require=createRequire(path.join(appRoot,'package.json'));
    child=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),...launch.args],{cwd:launch.cwd,stdio:['ignore','pipe','pipe']});
    let output='';child.stdout.on('data',chunk=>{output+=chunk});child.stderr.on('data',chunk=>{output+=chunk});
    exit=new Promise(resolve=>child.once('exit',resolve));
    const base=`http://127.0.0.1:${port}`;
    await until(async()=>{if(child.exitCode!==null)throw new Error(output);try{return (await fetch(base)).ok}catch{return false}},'isolated built preview');
    assert.deepEqual(Buffer.from(await(await fetch(base)).arrayBuffer()),builtIndex);
    for(const [name,exported] of [['session-render-boundary','runNativeSessionRenderBoundary'],['workspace-endpoint-stability','runNativeEndpointStabilityBehavior']]) {
      const response=await fetch(`${base}/__isir-fixtures/${name}.js`);
      assert.match(response.headers.get('content-type')??'',/javascript/,'Mounted regression must resolve to compiled JavaScript, not preview HTML');
      const code=await response.text();assert.match(code,new RegExp(exported));
      assert.doesNotMatch(code,/from\s*['"](?:\/src\/|\/tests\/|react['"])/);
    }
    assert.deepEqual(await builtFiles(path.join(appRoot,'dist')).catch(error=>{if(error.code==='ENOENT')return null;throw error;}),builtBefore,'Every normal app build artifact remains byte-identical (or absent)');
  } finally {if(child){child.kill('SIGTERM');await exit;}await rm(root,{recursive:true,force:true});}
});
