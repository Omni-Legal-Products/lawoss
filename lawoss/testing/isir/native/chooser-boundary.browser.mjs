// Explicit isolated Chromium check, never the user's browser/profile or Electron.
// Usage: node chooser-boundary.browser.mjs <chromium-executable> <owned-build-root>
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { nativeRendererLaunch } from './renderer.mjs';
import { connectRenderer, until } from './cdp.mjs';
import { installChooserBoundary } from './chooser-boundary.mjs';
import { stopNativeChild } from './owned-process.mjs';

const [browserBin,buildRoot]=process.argv.slice(2);
assert.ok(browserBin&&path.isAbsolute(browserBin)&&buildRoot&&path.isAbsolute(buildRoot),'Explicit isolated browser and build paths required');
const appRoot=fileURLToPath(new URL('../../../../apps/app/',import.meta.url));
const root=await mkdtemp(path.join(tmpdir(),'chooser-browser-'));
let browser,preview,cdp,primary;
const sink=createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin',origin);
  if(req.method!=='POST'||req.url!=='/copy'){res.writeHead(404).end();return;}
  const bytes=[];for await(const part of req)bytes.push(part);
  await writeFile(path.join(root,'copied.txt'),Buffer.concat(bytes));res.end('{}');
});
let origin='';
try {
  await mkdir(buildRoot,{recursive:true});
  const previewRoot=path.join(buildRoot,'renderer-preview');
  try {await readFile(path.join(previewRoot,'__isir-fixtures/chooser-boundary.js'));}
  catch(error){if(error.code!=='ENOENT')throw error;await nativeRendererLaunch(appRoot,0,buildRoot);}
  assert.deepEqual(await readFile(path.join(previewRoot,'index.html')),await readFile(path.join(appRoot,'dist/index.html')));
  await writeFile(path.join(previewRoot,'__isir-fixtures/probe.html'),'<!doctype html><title>Owned chooser fixture</title>');
  // OS-selected file and destination are synthetic and owned by this invocation.
  await writeFile(path.join(root,'selected.txt'),'Synthetic chooser bytes');
  await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
  const require=createRequire(path.join(appRoot,'package.json'));
  preview=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'preview','--host','127.0.0.1','--port','0','--outDir',previewRoot],{cwd:appRoot,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='';preview.stdout.on('data',c=>output+=c);preview.stderr.on('data',c=>output+=c);
  origin=await until(()=>output.match(/http:\/\/127\.0\.0\.1:\d+/)?.[0],'isolated preview URL');
  const page=await fetch(`${origin}/__isir-fixtures/probe.html`);assert.match(await page.text(),/Owned chooser fixture/);
  browser=spawn(browserBin,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--lang=en-US','--remote-debugging-port=0',`--user-data-dir=${path.join(root,'browser')}`,`${origin}/__isir-fixtures/probe.html`],{detached:process.platform!=='win32',stdio:['ignore','ignore','pipe']});
  browser.stderr.resume();
  const port=await until(async()=>{try{return (await readFile(path.join(root,'browser/DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'owned Chromium CDP port');
  cdp=await connectRenderer(`http://127.0.0.1:${port}`);
  await cdp.send('Page.enable');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/__isir-fixtures/probe.html`});
  assert.equal(navigation.errorText,undefined,'Owned fixture navigation must succeed');
  await until(()=>cdp.evaluate(`location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`),'actual owned fixture document');
  const mountedModules=await cdp.evaluate(`(async()=>{const surface=await import('/__isir-fixtures/session-render-boundary.js');const endpoint=await import('/__isir-fixtures/workspace-endpoint-stability.js');return {surface:typeof surface.runNativeSessionRenderBoundary,endpoint:endpoint.runNativeEndpointStabilityBehavior()};})()`);
  assert.equal(mountedModules.surface,'function');assert.equal(mountedModules.endpoint.actualMountedHook,true);assert.equal(mountedModules.endpoint.checks,28);
  await cdp.evaluate(`(async()=>{window.__chooserFixture=(await import('/__isir-fixtures/chooser-boundary.js')).mountChooserBoundaryFixture(${JSON.stringify(`http://127.0.0.1:${sink.address().port}/copy`)});window.__legalwork={slice:()=>({selectedWorkspaceId:'synthetic'})};})()`);
  await cdp.evaluate(`(${installChooserBoundary.toString()})({id:'synthetic',root:'/synthetic',name:'Synthetic',caseIndex:1})`);
  await cdp.send('Page.enable');await cdp.send('Page.setInterceptFileChooserDialog',{enabled:true});
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const actualCaller=source.split('\n').find(line=>line.includes('const upload=')&&line.includes('current project native upload menu action'));
  assert.ok(actualCaller,'Exercise the actual current native picker caller');
  const expression=actualCaller.split('cdp.evaluate(`')[1].split("`),'current project")[0].replace('${JSON.stringify(workspace.name)}',JSON.stringify('Synthetic'));
  await until(()=>cdp.evaluate(expression),'actual production Add files menu action');
  const chooser=await until(()=>cdp.events.find(e=>e.method==='Page.fileChooserOpened'),'production input chooser event');
  const before=await cdp.evaluate("window.__isirChooserBoundary.sample('before-controlled-refresh')");
  assert.equal(before.capturedConnected,true,'Actual native caller must capture the production input before opening it');
  assert.equal(before.physicalScopeEqual,true);
  await cdp.evaluate('window.__chooserFixture.refresh()');
  const after=await cdp.evaluate("window.__isirChooserBoundary.sample('after-controlled-refresh')");
  for(const key of ['capturedConnected','panelGenerationEqual','inputGenerationEqual','documentGenerationEqual'])assert.equal(after[key],true,key);
  const node=await cdp.send('DOM.resolveNode',{backendNodeId:chooser.params.backendNodeId});
  const identity=await cdp.send('Runtime.callFunctionOn',{objectId:node.object.objectId,functionDeclaration:'function(){return window.__isirChooserBoundary.event(this)}',returnByValue:true});
  assert.equal(identity.result.value.eventInputEqual,true);assert.equal(identity.result.value.inputConnected,true);
  await cdp.send('DOM.setFileInputFiles',{backendNodeId:chooser.params.backendNodeId,files:[path.join(root,'selected.txt')]});
  await until(async()=>{try{return(await readFile(path.join(root,'copied.txt'),'utf8'))==='Synthetic chooser bytes'}catch{return false}},'production input/import handler copied actual synthetic bytes');
  console.log('PASS both compiled browser modules and mounted endpoint28; real production menu/input capture, stable connected identity, CDP-selected file and loopback copy bytes; no Electron/engine/provider');
 } catch(error) {primary=error;throw error;} finally {
  cdp?.close();
  const errors=[];
  for(const child of [browser,preview])if(child)try{await stopNativeChild(child,3000);}catch(error){errors.push(error);}
  try{await new Promise(resolve=>sink.close(resolve));}catch(error){errors.push(error);}
  if(!errors.length)await rm(root,{recursive:true,force:true});
  if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Browser fixture primary/cleanup failure; owned root retained');
}
