// Explicit isolated Chromium check, never the user's browser/profile or Electron.
// Usage: node import-boundary.browser.mjs <chromium> <owned-build-root> [completion|siblings|immediate|wait-error] [frozen-driver] [frozen-observer]
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { nativeRendererLaunch } from './renderer.mjs';
import { connectRenderer, until } from './cdp.mjs';
import { installChooserBoundary } from './chooser-boundary.mjs';
import { stopNativeChild } from './owned-process.mjs';

const [browserBin,buildRoot,processMode='completion',driverSource,observerSource]=process.argv.slice(2);
assert.ok(['completion','siblings','immediate','wait-error'].includes(processMode),'Known isolated test mode required');
const observer=observerSource ? (await import(pathToFileURL(observerSource).href)).installChooserBoundary : installChooserBoundary;
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
  const css=(await readFile(path.join(previewRoot,'index.html'),'utf8')).match(/<link[^>]+rel="stylesheet"[^>]*>/g)??[];
  await writeFile(path.join(previewRoot,'__isir-fixtures/probe.html'),'<!doctype html><title>Owned chooser fixture</title>'+css.join(''));
  const require=createRequire(path.join(appRoot,'package.json'));
  // OS-selected file and destination are synthetic and owned by this invocation.
  await writeFile(path.join(root,'selected.txt'),'Synthetic chooser bytes');
  await new Promise(resolve=>sink.listen(0,'127.0.0.1',resolve));
  preview=spawn(process.execPath,[path.join(path.dirname(require.resolve('vite/package.json')),'bin/vite.js'),'preview','--host','127.0.0.1','--port','0','--outDir',previewRoot],{cwd:appRoot,detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  let output='';preview.stdout.on('data',c=>output+=c);preview.stderr.on('data',c=>output+=c);
  origin=await until(()=>output.replace(/\x1b\[[0-9;]*m/g,'').match(/http:\/\/127\.0\.0\.1:\d+/)?.[0],'isolated preview URL').catch(async error=>{await writeFile(path.join(buildRoot,'preview.log'),output);throw error;});
  const page=await fetch(`${origin}/__isir-fixtures/probe.html`);assert.match(await page.text(),/Owned chooser fixture/);
  browser=spawn(browserBin,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--metrics-recording-only','--lang=en-US','--remote-debugging-port=0',`--user-data-dir=${path.join(root,'browser')}`,`${origin}/__isir-fixtures/probe.html`],{detached:process.platform!=='win32',stdio:['ignore','ignore','pipe']});
  browser.stderr.resume();
  const port=await until(async()=>{try{return (await readFile(path.join(root,'browser/DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'owned Chromium CDP port');
  cdp=await connectRenderer(`http://127.0.0.1:${port}`);
  await cdp.send('Page.enable');
  const navigation=await cdp.send('Page.navigate',{url:`${origin}/__isir-fixtures/probe.html`});
  assert.equal(navigation.errorText,undefined,'Owned fixture navigation must succeed');
  await until(()=>cdp.evaluate(`location.origin===${JSON.stringify(origin)}&&document.readyState==='complete'`),'actual owned fixture document');
  await cdp.send('Page.navigate',{url:`${origin}/__isir-fixtures/probe.html?chooser`});
  await until(()=>cdp.evaluate("location.search==='?chooser'&&document.readyState==='complete'"),'fresh chooser document');
  await cdp.evaluate(`(async()=>{window.__chooserFixture=await (await import('/__isir-fixtures/chooser-boundary.js')).mountProductionImportFixture(${JSON.stringify(`http://127.0.0.1:${sink.address().port}/copy`)},{holdCompletion:${processMode!=='immediate'},sibling:${processMode==='siblings'}});})()`);
  await until(()=>cdp.evaluate("window.__legalworkControl?.snapshot().route.endsWith('/files')"),'actual control-off provider route publication');
  assert.equal(await cdp.evaluate('window.__legalworkControl.snapshot().enabled'),false);
  assert.deepEqual(await cdp.evaluate("({parked:!document.querySelector('[data-panel-tab-id=stale]'),published:window.__legalworkControl.snapshot().openFiles.some(file=>file.id==='stale'&&file.path==='Dokumenty/selected.txt'&&!file.active)})"),{parked:true,published:true},'Actual inactive DocumentPane is absent from DOM but retained in public control state');
  await cdp.evaluate(`(${observer.toString()})({id:'synthetic',root:'/synthetic',name:'Synthetic',caseIndex:1})`);
  await cdp.send('Page.enable');await cdp.send('Page.setInterceptFileChooserDialog',{enabled:true});
  const source=await readFile(driverSource??new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const workspace={id:'synthetic',name:'Synthetic',path:'/synthetic'};
  if(processMode==='siblings') {
    const receipt=await cdp.evaluate("window.__isirChooserBoundary.capture()");
    assert.equal(receipt.inputCount,1,'Multiple actual menu entries must still identify exactly the intended chooser input');
    assert.equal(receipt.physicalScopeEqual,true);
    console.log('PASS mounted sibling entries retain exact chooser ownership');
  }
  {
    // Execute the actual native picker with real CDP/menu/input/import/store.
    // The sink receipt is durable before the renderer is allowed to finish.
    const start=source.indexOf('  const picker = async '),end=source.indexOf('  const hashes = ',start);
    assert.ok(start>=0&&end>start);
    const pickerSource=source.slice(start,end).trim().replace(/^const picker = /,'').replace(/;$/,'');
    const actualReadFile=readFile;
    const copied={workspaceId:'synthetic',folder:'Dokumenty',paths:[path.join(root,'selected.txt')],result:{files:[{name:'selected.txt',status:'copied',path:'Dokumenty/selected.txt'}]}};
    let receiptRead=false,completionObserved=false;
    const primaryWait=new Error('Synthetic completion wait failure');
    const fixtureRead=async(file,...args)=>{
      if(file===path.join(root,'copy-receipts.jsonl')) {
        await actualReadFile(path.join(root,'copied.txt'));
        receiptRead=true;
        return JSON.stringify(copied)+'\n';
      }
      return actualReadFile(file,...args);
    };
    const observedUntil=async(read,description,...budgets)=>{
      if(!receiptRead&&description==='current native folder query settled') {
        for(const mutation of ['missing-control','foreign-control','missing-files','missing-bridge','owner']) {
          await cdp.evaluate(`(()=>{const api=window.__legalworkControl;window.__readyUndo={api,snapshot:api.snapshot,bridge:Object.getOwnPropertyDescriptor(window,'__LEGALWORK_ELECTRON__')};if(${JSON.stringify(mutation)}==='missing-control')delete window.__legalworkControl;if(${JSON.stringify(mutation)}==='foreign-control')api.snapshot=()=>({...window.__readyUndo.snapshot(),route:'/workspace/foreign/files'});if(${JSON.stringify(mutation)}==='missing-files')api.snapshot=()=>({...window.__readyUndo.snapshot(),openFiles:undefined});if(${JSON.stringify(mutation)}==='missing-bridge')delete window.__LEGALWORK_ELECTRON__;if(${JSON.stringify(mutation)}==='owner')window.__chooserFixture.setOwner('foreign')})()`);
          try { assert.equal(Boolean(await read()),false,`Pre-provision state refuses ${mutation}`); }
          finally { await cdp.evaluate("(()=>{const saved=window.__readyUndo;saved.api.snapshot=saved.snapshot;window.__legalworkControl=saved.api;Object.defineProperty(window,'__LEGALWORK_ELECTRON__',saved.bridge);window.__chooserFixture.setOwner('synthetic');delete window.__readyUndo})()"); }
        }
      }
      if(receiptRead) {
        if(processMode==='wait-error')throw primaryWait;
        const before=await read();
        if(processMode!=='immediate')assert.equal(Boolean(before),false,'IPC receipt alone must not establish completed renderer tabs');
        assert.equal(await cdp.evaluate("document.querySelector('[data-copy-route]').textContent"),'/workspace/synthetic/session','Actual import request commits its workspace route');
        await cdp.evaluate('window.__chooserFixture.release()');
        await until(()=>cdp.evaluate("[...document.querySelectorAll('[data-panel-tab-id]:not([data-panel-tab-id=stale]) [title]')].some(e=>e.title.endsWith('/ Dokumenty/selected.txt')&&e.getBoundingClientRect().width>0)"),'actual SidePanel completed visible title');
        const proof=await cdp.evaluate("({desktop:window.__LEGALWORK_ELECTRON__!=null,pathnameIsDocument:location.pathname==='/__isir-fixtures/probe.html',hashIsWorkspace:location.hash==='#/workspace/synthetic/session?view=workspace',publishedRoute:window.__legalworkControl.snapshot().route,owner:window.__legalwork.slice('route').selectedWorkspaceId,completionPredicate: null})");
        proof.completionPredicate=Boolean(await read());console.log('Actual production route/tab proof',JSON.stringify(proof));
        assert.equal(proof.completionPredicate,true,'Actual completed SessionPage desktop import must satisfy picker completion');
        const value=await until(read,description,...budgets);
        // Exercise the exact caller predicate against real DOM after completion.
        for(const mutation of ['owner','route','hidden','duplicate','missing-control','foreign-control','missing-bridge','malformed-hash']) {
          await cdp.evaluate(`(()=>{const node=[...document.querySelectorAll('[data-panel-tab-id]')].find(e=>e.getAttribute('data-panel-tab-id')!=='stale');window.__copyUndo={url:location.href,node,api:window.__legalworkControl,snapshot:window.__legalworkControl.snapshot,bridge:Object.getOwnPropertyDescriptor(window,'__LEGALWORK_ELECTRON__')};if(${JSON.stringify(mutation)}==='owner')window.__chooserFixture.setOwner('foreign');if(${JSON.stringify(mutation)}==='route')history.replaceState(null,'',window.__LEGALWORK_ELECTRON__?'#/workspace/foreign/session?view=workspace':'/workspace/foreign/session?view=workspace');if(${JSON.stringify(mutation)}==='missing-control')delete window.__legalworkControl;if(${JSON.stringify(mutation)}==='foreign-control')window.__legalworkControl.snapshot=()=>({...window.__copyUndo.snapshot(),route:'/workspace/foreign/session?view=workspace'});if(${JSON.stringify(mutation)}==='missing-bridge')delete window.__LEGALWORK_ELECTRON__;if(${JSON.stringify(mutation)}==='malformed-hash')history.replaceState(null,'','#not-a-route');if(${JSON.stringify(mutation)}==='hidden')node.hidden=true;if(${JSON.stringify(mutation)}==='duplicate'){const clone=node.cloneNode(true);clone.dataset.copyDecoy='';node.after(clone)}})()`);
          try{assert.equal(Boolean(await read()),false,`Completion refuses ${mutation}`);}
          finally{await cdp.evaluate(`(()=>{const saved=window.__copyUndo;saved.api.snapshot=saved.snapshot;window.__legalworkControl=saved.api;Object.defineProperty(window,'__LEGALWORK_ELECTRON__',saved.bridge);window.__chooserFixture.setOwner('synthetic');history.replaceState(null,'',saved.url);saved.node.hidden=false;document.querySelector('[data-copy-decoy]')?.remove();delete window.__copyUndo})()`);}
        }
        assert.equal(Boolean(await read()),true,'Restored exact owner and new completed tab pass');
        completionObserved=true;return value;
      }
      return until(read,description,...budgets);
    };
    const picker=Function('cdp','until','assert','path','root','readFile','writeFile','endpointRefresh','selectedIndex',`return (${pickerSource})`)(cdp,observedUntil,assert,path,root,fixtureRead,writeFile,false,2);
    try {
      if(processMode==='wait-error'){await assert.rejects(picker(copied.paths,workspace),error=>error===primaryWait);console.log('PASS actual picker preserves primary completion wait failure');}
      else {
      const result=await picker(copied.paths,workspace);
      assert.equal(result.inputIdentity.boundary.eventInputEqual,true);
      assert.equal(result.inputIdentity.boundary.physicalScopeEqual,true);
      assert.equal(completionObserved,true,'Picker acknowledged IPC while renderer copy remains incomplete');
      assert.equal(await actualReadFile(path.join(root,'copied.txt'),'utf8'),'Synthetic chooser bytes');
      console.log('PASS actual native picker waits for mounted production import completion after IPC receipt; route/owner/hidden/duplicate refusals and strict copied bytes retained');
      }
    } finally {await cdp.evaluate('window.__chooserFixture.release()');}
  }
  await cdp.evaluate('window.__chooserFixture.dispose()');
 } catch(error) {primary=error;console.error('Owned fixture renderer exceptions',JSON.stringify(cdp?.events.filter(e=>e.method==='Runtime.exceptionThrown').slice(-5).map(e=>e.params.exceptionDetails.exception?.description)));throw error;} finally {
  const errors=[];
  // Browser shutdown is graceful and awaited before strict owned cleanup.
  if(cdp)try{
    // The browser can close its transport before replying to Browser.close.
    // Actual owned-child exit is required; a response alone is insufficient.
    let outcome;
    const response=cdp.send('Browser.close').then(()=>{outcome={ack:true};},error=>{outcome={error};});
    await until(()=>browser.exitCode!==null||browser.signalCode!==null,'owned browser graceful exit',3000);
    if(outcome?.error)throw outcome.error;
    cdp.close();await response;
  }catch(error){errors.push(error);}
  cdp?.close();
  for(const child of [browser,preview])if(child)try{await stopNativeChild(child,3000);}catch(error){errors.push(error);}
  try{await new Promise(resolve=>sink.close(resolve));}catch(error){errors.push(error);}
  if(!errors.length){await rm(root,{recursive:true,force:true});console.log('Owned browser/preview strict cleanup PASS',JSON.stringify({browser:browser?{exitCode:browser.exitCode,signalCode:browser.signalCode}:null,preview:preview?{exitCode:preview.exitCode,signalCode:preview.signalCode}:null}));}
  if(errors.length)throw new AggregateError([...(primary?[primary]:[]),...errors],'Browser fixture primary/cleanup failure; owned root retained');
}
