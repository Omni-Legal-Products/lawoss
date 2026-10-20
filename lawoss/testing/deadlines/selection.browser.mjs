// Explicit owned Chromium/React/WebCrypto mechanism check; no user profile or Electron.
// Usage: node lawoss/testing/deadlines/selection.browser.mjs <absolute-chromium-executable>
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { connectRenderer, until } from '../isir/native/cdp.mjs';
import { stopNativeChild } from '../isir/native/owned-process.mjs';
const [browserBin] = process.argv.slice(2);
assert.ok(browserBin && path.isAbsolute(browserBin),'Explicit isolated Chromium executable required');
const appRoot=fileURLToPath(new URL('../../../apps/app/',import.meta.url));
const require=createRequire(path.join(appRoot,'package.json'));
const {createServer}=await import(pathToFileURL(path.join(path.dirname(require.resolve('vite/package.json')),'dist/node/index.js')).href);
const root=await mkdtemp(path.join(tmpdir(),'deadline-selection-'));
const text='Synthetic appeal advice. Odvolání lze podat do 15 dnů.';
const hash=createHash('sha256').update(text).digest('hex');
const document={id:'prepared-source',workspaceId:'synthetic',path:'case/decision.txt',hash,status:'readable',complete:true,updatedAt:0,provenance:{sourcePath:'case/decision.txt',depth:0},pageCount:1,readablePages:1};
const candidate={candidateId:'deadline_synthetic',revisionHash:hash,state:'needs_review',input:{jurisdiction:'cz',ruleId:'synthetic-profile',ruleVersion:'test-only',evidence:[],delivery:null},calculation:{kind:'indeterminate',uncertainties:[{code:'legal_review_required',detail:'No legal approval is implied.'}]}};
const requests=[];
let server,browser,cdp,primary;
try {
 server=await createServer({root:appRoot,configFile:path.join(appRoot,'vite.config.ts'),cacheDir:path.join(root,'vite-cache'),server:{host:'127.0.0.1',port:0,strictPort:false,hmr:false},plugins:[{name:'owned-deadline-selection-http',configureServer(vite){vite.middlewares.use(async(req,res,next)=>{
  if(req.url?.startsWith('/__deadline-selection.html')){res.setHeader('content-type','text/html');res.end(await vite.transformIndexHtml('/__deadline-selection.html','<!doctype html><title>Owned deadline selection fixture</title><div id="fixture"></div><script type="module" src="/tests/lawoss-deadline-selection.fixture.tsx"></script>'));return;}
  if(!req.url?.startsWith('/workspace/synthetic/lawoss/'))return next();
  assert.equal(req.headers.authorization,'Bearer synthetic-selection-owner');
  const chunks=[];for await(const chunk of req)chunks.push(chunk);
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):undefined;
  requests.push({url:req.url,method:req.method,body});
  const suffix=req.url.split('/lawoss/')[1];
  let result;
  if(suffix==='deadlines/availability')result={enabled:true,legalReviewRequired:true,proposedProfiles:[{id:'synthetic-profile',version:'test-only',jurisdiction:'cz',status:'synthetic_only',sources:[],exclusions:[]}]};
  else if(suffix.startsWith('deadlines?'))result={items:[]};
  else if(suffix==='deadlines/recover')result={results:[]};
  else if(suffix.startsWith('documents?'))result={documents:[document],nextOffset:null,untrusted:true};
  else if(suffix.startsWith('documents/prepared-source/read?'))result={...document,text,pages:[{page:null,text}],offset:0,nextOffset:null,untrusted:true};
  else if(suffix==='deadlines/candidates')result={candidateId:candidate.candidateId,revisionHash:hash,state:'needs_review',exportState:'not_requested',recordHash:hash,trusted:false};
  else if(suffix===`deadlines/${candidate.candidateId}/review`)result={candidate,reviewHash:hash,sourceSetHash:hash,okfDiff:'Synthetic selected-source request accepted by fixture.',icsPreview:'',warnings:['Test fixture; no legal approval.'],canConfirm:false,recordHash:hash};
  else {res.writeHead(404).end();return;}
  res.setHeader('content-type','application/json');res.end(JSON.stringify(result));
 });}}]});
 await server.listen();
 const address=server.httpServer.address();assert.ok(address && typeof address!=='string');
 const origin=`http://127.0.0.1:${address.port}`;
 browser=spawn(browserBin,['--headless=new','--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update','--disable-sync','--remote-debugging-port=0',`--user-data-dir=${path.join(root,'browser')}`,`${origin}/__deadline-selection.html`],{detached:process.platform!=='win32',stdio:['ignore','ignore','pipe']});browser.stderr.resume();
 const port=await until(async()=>{try{return(await readFile(path.join(root,'browser/DevToolsActivePort'),'utf8')).split('\n')[0]}catch{return null}},'owned Chromium port');
 cdp=await connectRenderer(`http://127.0.0.1:${port}`);
 await until(()=>cdp.evaluate("Boolean(document.querySelector('select[aria-label=appeal-advice]'))"),'actual mounted production workflow');
 assert.equal(await cdp.evaluate("Boolean(window.isSecureContext && crypto.subtle)"),true,'Real Chromium WebCrypto available');
 const save="[...document.querySelectorAll('button')].find(node=>node.textContent.includes('Uložit kandidáta'))";
 assert.equal(await cdp.evaluate(`${save}.disabled`),true,'No selected excerpt cannot create a candidate');
 await cdp.evaluate("document.querySelectorAll('details').forEach(node=>node.open=true); const select=document.querySelector('select[aria-label=appeal-advice]'); select.value='prepared-source';select.dispatchEvent(new Event('change',{bubbles:true}));");
 await until(()=>cdp.evaluate("Boolean(document.querySelector('textarea[aria-label=\"appeal-advice text\"]'))"),'actual HTTP prepared source displayed');
 const point=await cdp.evaluate("(()=>{const box=document.querySelector('textarea').getBoundingClientRect();return{x:box.x+20,y:box.y+20}})()");
 await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...point});
 await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...point});
 assert.equal(await cdp.evaluate("document.activeElement === document.querySelector('textarea')"),true,'Real mouse focus belongs to source textarea');
 // Chromium editor keyboard command changes the real selection and dispatches
 // selectionchange/select through React's production onSelect path.
 await cdp.send('Input.dispatchKeyEvent',{type:'keyDown',key:'a',code:'KeyA',modifiers:4,commands:['selectAll']});
 await cdp.send('Input.dispatchKeyEvent',{type:'keyUp',key:'a',code:'KeyA',modifiers:4});
 await until(()=>cdp.evaluate(`!${save}.disabled`),'selection callback enables actual candidate action');
 assert.deepEqual(await cdp.evaluate("(()=>{const node=document.querySelector('textarea');return[node.selectionStart,node.selectionEnd]})()"),[0,text.length]);
 assert.equal(await cdp.evaluate(`[...document.querySelectorAll('p')].some(node=>node.textContent===${JSON.stringify(text)})`),true,'Actual callback publishes quoted excerpt');
 await cdp.evaluate(`${save}.click()`);
 await until(()=>requests.find(request=>request.url.endsWith('/deadlines/candidates')),'actual candidate HTTP request');
 const body=requests.find(request=>request.url.endsWith('/deadlines/candidates')).body;
 assert.equal(body.matterPath,'case');assert.equal(body.decisionDocumentId,'prepared-source');assert.deepEqual(body.selection.documentIds,['prepared-source']);
 assert.deepEqual(body.selection.locators,[{documentId:'prepared-source',locator:{locatorId:'appeal-advice',page:null,start:0,end:text.length,quote:text,quoteHash:hash,preparationHash:hash}}]);
 assert.equal(body.delivery,null,'Selecting advice never invents actual service');
 console.log(JSON.stringify({schema:1,actualMountedWorkflow:true,actualSourceSelector:true,realKeyboardSelection:true,realWebCrypto:true,ownedHttpSource:true,quote:text,start:0,end:text.length,quoteHash:hash,preparationHash:hash,candidateRequest:true,nativeAcceptance:false}));
} catch(error){primary=error;} finally {
 const failures=[];
 try{cdp?.close();}catch(error){failures.push(error);}
 try{await stopNativeChild(browser,5000);}catch(error){failures.push(error);}
 try{await server?.close();}catch(error){failures.push(error);}
 if(!failures.length)try{await rm(root,{recursive:true,force:true});}catch(error){failures.push(error);}
 if(primary||failures.length)throw new AggregateError([primary,...failures].filter(Boolean),'Deadline mounted selection or owned cleanup failed');
 console.log('PASS owned Chromium/Vite resources closed; temporary profile removed');
}
