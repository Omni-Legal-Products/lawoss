import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink, realpath, rename, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { loadNativeCorpus } from "../lawoss/testing/isir/native/corpus.mjs";
import { startProvider } from "../lawoss/testing/isir/native/provider.mjs";
import { partialPdf } from "../lawoss/testing/isir/native/partial-pdf.mjs";
import { connectRenderer, until } from "../lawoss/testing/isir/native/cdp.mjs";
import { stopNativeChild } from "../lawoss/testing/isir/native/owned-process.mjs";
import { createNativeDiagnostics, settleCleanup, errorMetadata } from "../lawoss/testing/isir/native/diagnostics.mjs";
import { configureNativeProvider } from "../lawoss/testing/isir/native/bootstrap.mjs";
import { installChooserBoundary } from "../lawoss/testing/isir/native/chooser-boundary.mjs";
import { awaitDirectoryInstance } from "../lawoss/testing/isir/native/startup-readiness.mjs";
import { parseCsv } from "../apps/server/dist/lawoss/documents/validation.js";
import { sha256 } from "../lawoss/testing/isir/corpus.mjs";
import { prepareNativeEngineFiles, probeNativeEngineVersion, verifyNativeEngineRuntime } from "../lawoss/testing/isir/native/engine-identity.mjs";

const debugPair=process.argv.includes('--debug-case-pair');
const requestedEndpointRefresh=process.env.LAWOSS_ISIR_NATIVE_ENDPOINT_REFRESH==='1';
assert.ok(!debugPair || !process.env.CI,'CI must run the complete ten-case native gate');
if(debugPair)console.log('DEBUG: real cases1+10 only; this is not the full native gate');
const repo = fileURLToPath(new URL("../", import.meta.url));
const requireDesktop = createRequire(path.join(repo, "apps/desktop/package.json"));
const requireApp = createRequire(path.join(repo, "apps/app/package.json"));
const electron = process.env.LAWOSS_ISIR_NATIVE_ELECTRON ?? requireDesktop("electron");
await access(path.join(repo, "apps/server/dist/embedded.js"));
const corpus = await loadNativeCorpus(process.env.LAWOSS_ISIR_CORPUS);
assert.ok(!requestedEndpointRefresh || (process.env.CI && corpus.mode==='synthetic' && !debugPair),'Explicit controlled route refresh requires the complete isolated synthetic CI gate');
// Ordinary complete synthetic native runs always cover metadata refresh. An
// external corpus and the explicitly partial debug mode keep their own scope.
const endpointRefresh=corpus.mode==='synthetic' && !debugPair;
const diagnostics = createNativeDiagnostics({ enabled: process.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS === '1', ci: Boolean(process.env.CI), mode: corpus.mode, outputFile: process.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE });
const nativeFetch = diagnostics.fetch;
const stop = child => stopNativeChild(child,3000,{observe:diagnostics.ownedProcess});
// An explicit fixture is preflighted, but never substitutes for a prepared
// platform target or bypasses its manifest. PATH discovery is not permitted.
const externalEngine = process.env.LAWOSS_ISIR_NATIVE_ENGINE;
if (externalEngine !== undefined) probeNativeEngineVersion(externalEngine);
const preparedEngine = await prepareNativeEngineFiles({ bundleDir: path.join(repo, "apps/desktop/resources/sidecars"), externalEngine });
let primaryError = null;
try {
const engine = preparedEngine.path;
probeNativeEngineVersion(engine);
const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-isir-native-")));
const profile = path.join(root, "profile");
diagnostics.bindOwnedRoot(root);
let engineLogLaunchWallMs=null,engineLogDeadlineWallMs=null;
const children = [];
let cdp;
let boundaryProbe;
const caseRuns=[...corpus.cases.entries()].filter(([index])=>!debugPair||index===0||index===corpus.cases.length-1);
const provider = await startProvider();
const port = async () => { const server = net.createServer(); await new Promise(r => server.listen(0, "127.0.0.1", r)); const p = server.address().port; await new Promise(r => server.close(r)); return p; };
const cdpPort = await port(), uiPort = await port();
const osKeys=['PATH','Path','SystemRoot','WINDIR','COMSPEC','PATHEXT','TEMP','TMP','TMPDIR','DISPLAY','WAYLAND_DISPLAY','XAUTHORITY','LANG','LC_ALL','LC_CTYPE','TERM','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','DBUS_SESSION_BUS_ADDRESS'];
const env = Object.fromEntries(osKeys.flatMap(key=>process.env[key]===undefined?[]:[[key,process.env[key]]]));
Object.assign(env, {
  HOME: path.join(root, "home"), USERPROFILE: path.join(root, "home"), APPDATA:path.join(root,"appdata"), LOCALAPPDATA:path.join(root,"localappdata"),
  XDG_CONFIG_HOME: path.join(root, "xdg/config"), XDG_DATA_HOME: path.join(root, "xdg/data"), XDG_CACHE_HOME: path.join(root, "xdg/cache"), XDG_STATE_HOME: path.join(root, "xdg/state"),
  PATH: `${path.dirname(engine)}${path.delimiter}${process.env.PATH}`,
  LEGALWORK_DEV_MODE: "1", LEGALWORK_ELECTRON_USERDATA: profile,
  LEGALWORK_ELECTRON_APP_NAME: "LAWOSS ISIR Native Test", LEGALWORK_ELECTRON_APP_IDENTIFIER: "org.lawoss.isir-native-test",
  LEGALWORK_DATA_DIR: path.join(root, "runtime"), LEGALWORK_SERVER_CONFIG: path.join(root, "runtime/server.json"),
  LEGALWORK_RUNTIME_DB: path.join(root, "runtime/runtime.db"), OPENCODE_DB: path.join(root, "runtime/opencode.db"),
  LEGALWORK_ENV_STORE: path.join(root, "empty.env"), LEGALWORK_WORD_ADDIN: "0", LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY: "1",
  LEGALWORK_ELECTRON_START_URL: `http://127.0.0.1:${uiPort}`, LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: String(cdpPort),
  LAWOSS_ISIR_NATIVE_ROOT: root, OPENCODE_DISABLE_AUTOUPDATE: "1", OPENCODE_DISABLE_DEFAULT_PLUGINS: "1",
  OPENCODE_CONFIG_CONTENT: JSON.stringify({ model: "isir-native/synthetic", small_model: "isir-native/synthetic", provider: { "isir-native": { npm: "@ai-sdk/openai-compatible", name: "ISIR synthetic protocol", options: { baseURL: provider.url, apiKey: "synthetic-local-only" }, models: { synthetic: { name: "ISIR synthetic", limit: { context: 128000, output: 16000 }, tool_call: true, reasoning:true, variants:{low:{reasoningEffort:"low"},high:{reasoningEffort:"high"}} } } } } }),
});
for (const dir of [profile,env.APPDATA,env.LOCALAPPDATA,env.HOME, path.join(root, "documents"), path.join(root, "runtime"), env.XDG_CONFIG_HOME, env.XDG_DATA_HOME, env.XDG_CACHE_HOME, env.XDG_STATE_HOME]) await mkdir(dir, { recursive: true });
const configDir = path.join(profile, "legalwork-dev-data/xdg/config/opencode");
await mkdir(configDir, {recursive:true});
await writeFile(path.join(configDir,"opencode.json"), env.OPENCODE_CONFIG_CONTENT);
const workspaces = [];
for (const [index, entry] of corpus.cases.entries()) {
  const folder = path.join(root, "cases", index===4?`${entry.id} český spis`:entry.id);
  if(corpus.mode==='synthetic'&&index===2){
    const actual=path.join(folder,'Dátové originály');await mkdir(actual,{recursive:true});
    await symlink(actual,path.join(folder,'Dokumenty'),process.platform==='win32'?'junction':'dir');
    entry.reference.documents=entry.reference.documents.map(d=>({...d,file:d.file.replace('Dokumenty/','Dátové originály/')}));
  }else await mkdir(path.join(folder, "Dokumenty"), { recursive: true });
  if(index===9)await mkdir(path.join(folder,'Checks'));
  const sources = path.join(root, "originals", entry.id); await mkdir(sources, { recursive: true });
  if (entry.reference) await writeFile(path.join(folder,"TEST_ZDROJE_ISIR.json"),JSON.stringify(entry.reference));
  for (const doc of entry.documents) await writeFile(path.join(sources, doc.name), doc.bytes);
  workspaces.push({ id: `ws_native_${index + 1}`, name: `ISIR ${entry.id}`, path: folder, preset: "starter", workspaceType: "local", appFiles: "inside" });
}
await writeFile(path.join(profile, "legalwork-workspaces.json"), JSON.stringify({ selectedId: workspaces[0].id, watchedId: workspaces[0].id, activeId: workspaces[0].id, workspaces }));
await writeFile(path.join(root, "chooser.json"), JSON.stringify({ paths: [path.join(root, "originals", corpus.cases[0].id, corpus.cases[0].documents[0].name)] }));
const launch = (command, args, cwd, label) => {
  const child = spawn(command, args, { cwd, env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  let output = ""; child.stdout.on("data", c => output += c); child.stderr.on("data", c => output += c);
  child.on("error", e => output += String(e));
  children.push({ child, label, output: () => output });
  return child;
};

let cleanupPromise;
const cleanup = () => cleanupPromise ??= (async () => {
  const result = await settleCleanup(primaryError, [
    () => cdp?.evaluate('window.__isirChooserBoundary?.disconnect()'),
    () => cdp?.close(),
    ...[...children].reverse().map(({child}) => () => stop(child)),
    () => provider.close(),
    () => preparedEngine.cleanup(),
  ]);
  for (const error of result.failures) console.error('Owned native cleanup failure', JSON.stringify(errorMetadata(error)));
  const processes=children.map(({child,label})=>({label,pid:child.pid,exitCode:child.exitCode,signal:child.signalCode}));
  await writeFile(path.join(root,'process-receipts.json'),JSON.stringify({cleaned:result.failures.length===0,processes},null,2),{mode:0o600});
  await diagnostics.write({events:cdp?.events,error:primaryError,cleanupErrors:result.failures});
  console.log(`Owned native cleanup ${result.failures.length ? 'failed' : 'completed'}; private evidence: ${root}`);
  if (result.error) throw result.error;
})();
process.once('SIGINT',()=>void cleanup().then(()=>process.exit(130)));
process.once('SIGTERM',()=>void cleanup().then(()=>process.exit(143)));
try {
  diagnostics.phase("startup");
  launch(process.execPath, [path.join(path.dirname(requireApp.resolve("vite/package.json")), "bin/vite.js"), "--host", "127.0.0.1", "--port", String(uiPort), "--strictPort"], path.join(repo, "apps/app"), "vite");
  await until(async () => (await nativeFetch(env.LEGALWORK_ELECTRON_START_URL)).ok, "owned Vite");
  engineLogLaunchWallMs=Date.now();
  let appChild = launch(electron, [...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : []), path.join(repo, "apps/desktop/scripts/isir-native-entry.mjs")], path.join(repo, "apps/desktop"), "electron");
  cdp = await connectRenderer(`http://127.0.0.1:${cdpPort}`, nativeFetch);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1800,height:1400,deviceScaleFactor:1,mobile:false});
  await until(() => cdp.evaluate("!!window.__legalworkControl"), "native renderer controls", 90000);
  await until(() => cdp.evaluate("!document.body.innerText.includes('Loading your workspaces') && document.body.innerText.length > 150"), "workspace ready", 90000);
  await cdp.evaluate("window.__legalworkControl.execute('lawoss.lite.mode.set', {mode:'pro'})");
  await cdp.evaluate("window.__legalworkControl.execute('route.session')");
  const startupStarted=performance.now(),startupDeadline=Date.now()+90000;
  engineLogDeadlineWallMs=startupDeadline;
  const startupRemaining=()=>Math.max(0,startupDeadline-Date.now());
  await until(() => cdp.evaluate("window.__legalworkControl.listActions().some(a=>a.id==='session.create_task'&&!a.disabled)"), "native engine workspace ready", startupRemaining());
  const click = async text => {
    await cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Got it');e?.click()})()`);
    await until(() => cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0&&!e.disabled);if(!e)return false;e.click();return true})()`), `visible native control ${text}`);
  };
  const liveEngine = await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('engineInfo')");
  const apiAuth = {authorization:'Basic '+Buffer.from(`${liveEngine.opencodeUsername}:${liveEngine.opencodePassword}`).toString('base64'),'content-type':'application/json'};
  const health = await (await nativeFetch(`${liveEngine.baseUrl}/global/health`,{headers:apiAuth,signal:AbortSignal.timeout(startupRemaining())},Math.max(1,startupRemaining()))).json();
  const initialEngineIdentity = await verifyNativeEngineRuntime(preparedEngine, liveEngine.opencodeBinPath, health);
  const engineIdentities = [{ phase: 'initial', ...initialEngineIdentity }];
  await writeFile(path.join(root,'engine-identity-receipts.json'),JSON.stringify(engineIdentities,null,2),{mode:0o600});
  let serverInfo = await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('legalworkServerInfo')");
  let serverAuth = {authorization:'Bearer '+(serverInfo.ownerToken||serverInfo.clientToken),'content-type':'application/json'};
  // Initial registered root only. A restart after moving the folder must never
  // probe or recreate its missing historical root.
  const startupReceipt=await awaitDirectoryInstance({request:(url,options)=>nativeFetch(url,options,Math.max(1,startupRemaining())),baseUrl:liveEngine.baseUrl,headers:apiAuth,directory:workspaces[0].path,deadline:startupDeadline,observe:diagnostics.startup});
  console.log('Native selected-instance startup',JSON.stringify({...startupReceipt,elapsedMs:Math.round(performance.now()-startupStarted),remainingMs:startupRemaining()}));
  diagnostics.phase("configure-provider");
  const providerConfig = JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider;
  await configureNativeProvider({request:nativeFetch,serverInfo,serverAuth,liveEngine,apiAuth,workspace:workspaces[0],providerConfig});
  console.log('PASS running engine1.18.29; configured synthetic provider connected after supported workspace reload');
  // Persisted selected-agent is fixture input, consumed by the ordinary
  // native preference loader. It does not replace any send/tool callback.
  await cdp.send('Page.enable');
  const preferenceFixture=await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:`const prefs=JSON.parse(localStorage.getItem('legalwork.preferences')??'{}');prefs.selectedAgent='legalwork';localStorage.setItem('legalwork.preferences',JSON.stringify(prefs));`});
  const reloadStart=cdp.events.length;
  await cdp.send('Page.reload');
  await until(()=>cdp.events.slice(reloadStart).some(e=>e.method==='Page.loadEventFired'),'configured renderer document actually reloaded',60000);
  await cdp.send('Page.removeScriptToEvaluateOnNewDocument',{identifier:preferenceFixture.identifier});
  await until(()=>cdp.evaluate("window.__legalworkControl?.listActions().some(a=>a.id==='session.create_task'&&!a.disabled)"),'configured native renderer',60000);
  assert.equal(await cdp.evaluate(`JSON.parse(localStorage.getItem('legalwork.preferences')??'{}').selectedAgent`),'legalwork','Ordinary persisted selected-agent fixture loaded by the actual new document');

  const renderBoundary=await cdp.evaluate(`(async()=>{const tests=await import('/tests/session-render-boundary.test.tsx');return tests.runNativeSessionRenderBoundary(${JSON.stringify({baseUrl:serverInfo.baseUrl,token:serverInfo.ownerToken||serverInfo.clientToken,workspaceId:workspaces[0].id,workspaceRoot:workspaces[0].path})})})()`);
  assert.equal(renderBoundary.actualMountedSurface,true);
  await writeFile(path.join(root,'session-render-boundary.json'),JSON.stringify(renderBoundary,null,2),{mode:0o600});
  console.log(`Mounted native Surface boundary: ${JSON.stringify(renderBoundary)}`);

  let selectedIndex=1;
  boundaryProbe = () => diagnostics.probeWorkspace({serverInfo,serverAuth,workspaces,selectedIndex});
  const api = async (workspace, route, input) => {
    const response = await nativeFetch(`${serverInfo.baseUrl}/workspace/${workspace.id}/${route}`,{headers:serverAuth,...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
    return {response,body:await response.json()};
  };
  const panelText = () => cdp.evaluate(`document.querySelector('[aria-label="Document processing"]')?.innerText??''`);
  const openFiles = async workspace => {
    selectedIndex=workspaces.indexOf(workspace)+1;
    await cdp.evaluate(`(${installChooserBoundary.toString()})(${JSON.stringify({id:workspace.id,root:workspace.path,name:workspace.name,caseIndex:selectedIndex})})`);
    await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(workspace.name)}&&e.closest('[data-slot="collapsible"]'));if(!e)return false;e.click();return true})()`),`select native project ${workspace.id}`);
    await until(()=>cdp.evaluate(`(()=>{const title=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()===${JSON.stringify(workspace.name)}&&e.closest('[data-slot="collapsible"]'));const group=title.closest('[data-slot="collapsible"]');const e=[...group.querySelectorAll('button,a')].find(e=>e.textContent.trim()==='Files'&&e.getBoundingClientRect().width>0);if(!e){group.querySelector('[aria-label="Expand"]')?.click();return false}e.click();return true})()`),'native project files action');
    await until(()=>cdp.evaluate(`!!document.querySelector('[aria-label="Document processing"]')`),'native processing panel');
    await until(()=>cdp.evaluate(`(()=>{const nav=document.querySelector('[aria-label="Current folder"]');if(!nav)return false;nav.querySelector('button')?.click();return true})()`),'native root breadcrumb');
  };
  const inputFiles = async (selector, paths) => {
    const doc = await cdp.send('DOM.getDocument');
    const input = await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
    assert.ok(input.nodeId,'OS-backed input node is present');
    await cdp.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:paths});
  };
  const drop = async paths => {
    await until(()=>cdp.evaluate(`document.querySelector('[aria-label="Document processing"]')?.closest('[aria-busy]')?.getAttribute('aria-busy')==='false'`),'native file import is ready');
    // Observe the production toast produced from the real IPC copy result.
    // This observer cannot modify IPC results or application state.
    await cdp.evaluate(`(()=>{window.__isirCopyObserver?.disconnect();window.__isirCopyReceipt=null;const seen=new WeakSet(document.querySelectorAll('[data-sonner-toast]'));window.__isirCopyObserver=new MutationObserver(()=>{for(const e of document.querySelectorAll('[data-sonner-toast]'))if(!seen.has(e)&&e.innerText.includes('copied into the project')){seen.add(e);window.__isirCopyReceipt=e.innerText}});window.__isirCopyObserver.observe(document.body,{childList:true,subtree:true,characterData:true})})()`);
    await cdp.evaluate(`(()=>{document.querySelector('#isir-os-backed-drop')?.remove();const i=document.createElement('input');i.type='file';i.id='isir-os-backed-drop';i.multiple=true;document.body.append(i)})()`);
    await inputFiles('#isir-os-backed-drop',paths);
    await cdp.evaluate(`(()=>{const dt=new DataTransfer();for(const f of document.querySelector('#isir-os-backed-drop').files)dt.items.add(f);const target=document.querySelector('[aria-label="Document processing"]').parentElement;target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));document.querySelector('#isir-os-backed-drop').remove()})()`);
    const receipt=await until(()=>cdp.evaluate('window.__isirCopyReceipt'),'actual production file-copy UI receipt');
    await until(()=>cdp.evaluate(`document.querySelector('[aria-label="Document processing"]')?.closest('[aria-busy]')?.getAttribute('aria-busy')==='false'`),'native IPC copy completed');
    await cdp.evaluate('window.__isirCopyObserver.disconnect()');
    assert.ok(receipt.includes(paths.length===1?'Item copied into the project':`${paths.length} items copied into the project`));
    return receipt;
  };
  const picker = async (paths,workspace) => {
    await cdp.send('Page.enable'); await cdp.send('Page.setInterceptFileChooserDialog',{enabled:true});
    const eventStart=cdp.events.length;
    await until(()=>cdp.evaluate(`(()=>{const button=document.querySelector('button[aria-label="Refresh folder"]');return button&&!button.disabled})()`),'current native folder query settled');
    await until(()=>cdp.evaluate(`(()=>{const upload=[...document.querySelectorAll('[role="menuitem"],button')].find(e=>e.textContent.trim()==='Upload files'&&e.getBoundingClientRect().width>0&&!e.disabled);if(upload){window.__isirChooserBoundary.capture();upload.click();window.__isirChooserBoundary.sample('after-upload');return true}const nav=document.querySelector('[aria-label="Current folder"]');const folder=document.querySelector('[data-project-folder="Dokumenty"]');if(!folder||nav?.querySelector('button')?.textContent.trim()!==${JSON.stringify(workspace.name)})return false;window.__isirChooserBoundary.sample('before-menu');folder.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:200,button:2}));return false})()`),'current project native upload menu action');
    const chooser=await until(()=>cdp.events.slice(eventStart).find(e=>e.method==='Page.fileChooserOpened'),'actual native HTML chooser request');
    // The display-name ACK is independent of client identity: GREEN must keep
    // the same client. All raw connection operands remain inside the renderer.
    const refreshName = async name => {
      const receipt=await cdp.evaluate(`(async()=>{
        const headers=${JSON.stringify(serverAuth)},base=${JSON.stringify(serverInfo.baseUrl)},id=${JSON.stringify(workspace.id)};
        const read=async(response)=>{if(response.status!==200)throw new Error('Controlled metadata HTTP status');return response.json()};
        const before=(await read(await fetch(base+'/workspaces',{headers}))).workspaces.find(w=>w.id===id);
        const after=(await read(await fetch(base+'/workspaces/'+encodeURIComponent(id)+'/display-name',{method:'PATCH',headers,body:JSON.stringify({displayName:${JSON.stringify(name)}})}))).workspaces.find(w=>w.id===id);
        const fields=['id','workspaceType','path','baseUrl','legalworkHostUrl','legalworkToken','legalworkClientToken','legalworkHostToken','legalworkWorkspaceId'];
        const unchanged=!!before&&!!after&&fields.every(key=>Object.is(before[key],after[key]));
        if(!unchanged)throw new Error('Controlled metadata changed connection or root');
        const prior=new Set(window.__legalwork.events(200));
        window.__isirEndpointRefresh={prior,id,name:${JSON.stringify(name)}};
        window.dispatchEvent(new CustomEvent('legalwork-server-settings-changed'));
        return {routingAndRootUnchanged:unchanged,fieldCount:fields.length};
      })()`);
      const ack=await until(()=>cdp.evaluate(`(()=>{const control=window.__isirEndpointRefresh,route=window.__legalwork.slice('route');const complete=window.__legalwork.events(200).some(e=>!control.prior.has(e)&&e.name==='route.refresh.complete'&&e.data?.selectedWorkspaceId===control.id);const metadata=route?.workspaces.find(w=>w.id===control.id)?.displayNameResolved===control.name;return complete&&metadata&&route.loading===false?{complete:true,metadataCommitted:true,loading:false}:false})()`),'actual route refresh completion and committed metadata acknowledgment');
      return {...receipt,...ack};
    };
    const controlled=endpointRefresh && selectedIndex===1;
    let pickerError=null;
    try {
    if(controlled){
      const before=await cdp.evaluate("window.__isirChooserBoundary.sample('before-controlled-refresh')");
      assert.equal(before.capturedConnected,true,'Controlled refresh starts with the original mounted chooser input');
      const ack=await refreshName(`${workspace.name} refresh acknowledgement`);
      const after=await cdp.evaluate("window.__isirChooserBoundary.sample('after-controlled-refresh')");
      await writeFile(path.join(root,'endpoint-refresh.json'),JSON.stringify({schema:1,ack,before,after},null,2),{mode:0o600});
      assert.equal(after.clientIdentity,before.clientIdentity,'Controlled metadata refresh preserves the actual selected workspace client identity');
      console.log(`Controlled native route refresh: ${JSON.stringify({ack,clientIdentityEqual:before.clientIdentity===after.clientIdentity,capturedConnected:after.capturedConnected})}`);
    }
    const resolved=await cdp.send('DOM.resolveNode',{backendNodeId:chooser.params.backendNodeId});
    const observed=await cdp.send('Runtime.callFunctionOn',{objectId:resolved.object.objectId,functionDeclaration:`function(){window.__isirPickerChange=null;this.addEventListener('change',()=>{window.__isirChooserBoundary.event(this);window.__isirPickerChange={connected:this.isConnected,files:[...this.files].map(f=>({name:f.name,size:f.size}))}},{once:true});return {connected:this.isConnected,type:this.type,boundary:window.__isirChooserBoundary.event(this)}}`,returnByValue:true});
    const inputIdentity={backendNodeId:chooser.params.backendNodeId,...observed.result.value};
    console.log(`Native chooser input ${workspace.id}: ${JSON.stringify(inputIdentity)}`);
    await writeFile(path.join(root,`chooser-boundary-${selectedIndex}.json`),JSON.stringify(await cdp.evaluate('window.__isirChooserBoundary.receipt()'),null,2),{mode:0o600});
    assert.equal(inputIdentity.connected,true,'Chooser input remains mounted before OS-backed provisioning');
    await cdp.send('DOM.setFileInputFiles',{backendNodeId:chooser.params.backendNodeId,files:paths});
    const changed=await until(()=>cdp.evaluate('window.__isirPickerChange'),'actual native file input change event');
    assert.equal(changed.connected,true,'Native file input change bubbles from the mounted production input');
    assert.equal(changed.files.length,paths.length);
    await writeFile(path.join(root,`chooser-boundary-${selectedIndex}.json`),JSON.stringify(await cdp.evaluate('window.__isirChooserBoundary.receipt()'),null,2),{mode:0o600});
    await cdp.evaluate('window.__isirChooserBoundary.disconnect()');
    const copied=await until(async()=>{const lines=(await readFile(path.join(root,'copy-receipts.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);return lines.findLast(r=>r.workspaceId===workspace.id&&JSON.stringify(r.paths)===JSON.stringify(paths)&&r.folder==='Dokumenty')},'actual picker preload/IPC receipt');
    assert.equal(copied.error,undefined);assert.ok(copied.result.files.every(f=>f.status==='copied'));
    return {inputIdentity,changed,copied};
    } catch(error){pickerError=error;throw error;}
    finally {
      if(controlled){
        let cleanupError=null;
        try {const ack=await refreshName(workspace.name);console.log(`Controlled native metadata rollback: ${JSON.stringify(ack)}`);}
        catch(error){console.error('Controlled native metadata rollback failed',JSON.stringify(errorMetadata(error)));cleanupError=error;}
        try {await cdp.evaluate('delete window.__isirEndpointRefresh');}
        catch(error){console.error('Controlled native refresh control cleanup failed',JSON.stringify(errorMetadata(error)));cleanupError??=error;}
        if(!pickerError&&cleanupError)throw cleanupError;
      }
    }
  };
  const hashes = async (entry,workspace) => {
    for (const document of entry.documents) {
      assert.equal(sha256(await readFile(path.join(root,'originals',entry.id,document.name))),sha256(document.bytes),'Original fixture bytes remain unchanged');
      assert.equal(sha256(await readFile(path.join(workspace.path,'Dokumenty',document.name))),sha256(document.bytes),'Native imported file bytes remain unchanged');
      if(document.sourcePath) assert.equal(sha256(await readFile(document.sourcePath)),sha256(document.bytes),'External local snapshot remains unchanged');
    }
  };
  const evidence=[],extraEvidence={};
  for(const [index,entry] of caseRuns) {
    const workspace=workspaces[index];
    diagnostics.phase("native-case",index+1);
    await openFiles(workspace);
    await until(()=>cdp.evaluate(`!!document.querySelector('[data-project-folder="Dokumenty"]')`),'native source folder');
    const pickerReceipt=await picker([path.join(root,'originals',entry.id,entry.documents[0].name)],workspace);
    await until(async()=>{try{return sha256(await readFile(path.join(workspace.path,'Dokumenty',entry.documents[0].name)))===sha256(entry.documents[0].bytes)}catch{return false}},'actual picker copied bytes');
    if(endpointRefresh && index===0){
      const behavior=await cdp.evaluate(`(async()=>{const tests=await import('/tests/workspace-endpoint-stability.test.tsx');return tests.runNativeEndpointStabilityBehavior()})()`);
      assert.equal(behavior.actualMountedHook,true);assert.equal(behavior.checks,26,'Every mounted routing/auth/root transition completed');
      await writeFile(path.join(root,'endpoint-hook-behavior.json'),JSON.stringify(behavior,null,2),{mode:0o600});
      console.log(`Mounted native endpoint behavior: ${JSON.stringify(behavior)}`);
    }
    await click('Dokumenty');
    await drop(entry.documents.slice(1).map(d=>path.join(root,'originals',entry.id,d.name)));
    await until(async()=>{try{await hashes(entry,workspace);return true}catch{return false}},'actual OS-backed drop hashes');
    if(index===0){
      await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('input')].find(e=>e.getAttribute('aria-label')===${JSON.stringify('Select source '+entry.documents[0].name)});if(!e)return false;if(!e.checked)e.click();return true})()`),'select unprepared native source');
      await until(async()=>(await panelText()).includes('Source not prepared yet; page coverage is unknown.'),'truthful native unprepared state');
    }
    diagnostics.phase("preparation-admission",index+1);
    const prepareStart=cdp.events.length;
    await click('Prepare this folder');
    const prepareResponse=await until(()=>cdp.events.slice(prepareStart).find(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith('/lawoss/documents/prepare')&&e.params.response.status===200),'actual preparation admission response');
    const admission=await until(async()=>{try{return JSON.parse((await cdp.send('Network.getResponseBody',{requestId:prepareResponse.params.requestId})).body)}catch{return false}},'production preparation response bytes');
    assert.ok(admission.documents.every(d=>['uploaded','preparing'].includes(d.status)&&!d.complete),'Admission never claims extraction completed');
    const prepared=await until(async()=>{const {body}=await api(workspace,'lawoss/documents');return body.documents?.length===entry.documents.length&&body.documents.every(d=>d.status==='readable'&&d.complete)?body.documents:false},'all selected PDFs prepared by production',60000);
    await until(async()=>{const text=await panelText();return text.includes(`Selected files: ${entry.documents.length}`)&&text.includes('Selected sources fully extracted')},'rendered current complete source coverage');
    await click('Read source');
    await until(()=>cdp.evaluate(`!!document.querySelector('[aria-label="Document processing"] pre')`),'rendered production source read');
    if(index===0) {
      await cdp.evaluate("window.__legalworkControl.execute('session.model_picker.open')");
      const hasModel=await cdp.evaluate(`!![...document.querySelectorAll('button')].find(e=>e.textContent.includes('ISIR synthetic')&&!e.textContent.includes('protocol'))`);
      if(!hasModel) await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('ISIR synthetic protocol'));if(!e)return false;e.click();return true})()`),'expand actual native provider');
      await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.includes('ISIR synthetic')&&!e.textContent.includes('protocol'));if(!e)return false;e.click();return true})()`),'choose actual connected model');
      await cdp.evaluate("window.__legalworkControl.execute('route.session')");
      await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('button[aria-label="Behavior"]');if(!e||e.disabled)return false;e.click();return true})()`),'native selected model behavior control');
      const deep = await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()==='Deep');if(!e)return false;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`),'actual Deep choice');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...deep});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...deep});
      await until(()=>cdp.evaluate(`JSON.parse(localStorage.getItem('legalwork.preferences')??'{}').modelVariant==='high'`),'persisted native Deep variant selection');
      await openFiles(workspace);await click('Dokumenty');await click('Prepare this folder');
      await until(async()=>(await panelText()).includes('Selected sources fully extracted'),'selected model/variant retains original source scope');

    }
    diagnostics.phase("generation",index+1);
    const receiptStart=provider.receipts.length,eventStart=cdp.events.length;
    await click('Generate through chat');
    const binding=await until(()=>cdp.evaluate(`JSON.parse(localStorage.getItem('lawoss.document-generations.v1')??'[]').map(x=>x[1]).find(b=>b.workspaceId===${JSON.stringify(workspace.id)})`),'persisted native generation binding');
    assert.match(binding.messageId,/^msg_[a-f0-9]{12}[A-Za-z0-9]{14}$/);
    assert.ok(['accepted','running'].includes(binding.phase),'Immediate acknowledgment stays active');
    const generation=await until(()=>{
      const receipts=provider.receipts.slice(receiptStart).filter(r=>r.sources.length);
      const last=receipts.at(-1);
      const error=last?.toolResults.find(r=>{try{return Boolean(JSON.parse(r.content).error)}catch{return false}});
      if(error)return {error:JSON.parse(error.content).error};
      const result=last?.toolResults.map(r=>{try{return JSON.parse(r.content)}catch{return null}}).find(r=>r&&typeof r.valid==='boolean');
      return result?{result,receipts}:false;
    },'actual engine tool validation result',90000);
    assert.equal(generation.error,undefined,`Production native tool failed: ${generation.error}`);
    assert.equal(generation.result.valid,true,JSON.stringify(generation.result.issues));
    const actualHashes={};
    for(const output of generation.result.outputs) {
      actualHashes[output.path]=sha256(await readFile(path.join(workspace.path,output.path)));
      assert.equal(actualHashes[output.path],output.hash,'Validation hash belongs to actual saved bytes');
      assert.equal(output.verified,true);
    }
    const rows=parseCsv(await readFile(path.join(workspace.path,'native-registry.csv'),'utf8'));
    assert.equal(rows.length,new Set(entry.documents.map(d=>sha256(d.bytes))).size+1,'One row per distinct selected original');
    assert.ok(rows.every(row=>row.length===7),'Quoted multiline CSV retains seven columns');
    if(entry.reference) assert.deepEqual(new Set(rows.slice(1).map(r=>r[1])),new Set(entry.reference.documents.map(r=>r.documentId)));
    const snapshot=await until(async()=>{const {body}=await api(workspace,`sessions/${binding.sessionId}/snapshot?limit=20`);return body.item?.status.type==='idle'&&body.item.messages.some(m=>m.info.parentID===binding.messageId&&m.info.finish==='stop')?body.item:false},'real terminal engine message and idle snapshot');
    assert.equal(snapshot.session.directory,workspace.path);assert.ok(snapshot.messages.some(m=>m.info.role==='assistant'&&m.info.agent==='legalwork'&&m.info.parentID===binding.messageId),'Real engine uses selected native agent');
    const parts=snapshot.messages.flatMap(m=>m.parts);
    for(const name of ['lawoss_documents_list','lawoss_documents_read','lawoss_documents_export','lawoss_documents_validate']) assert.ok(parts.some(p=>p.type==='tool'&&p.tool===name&&p.state.status==='completed'),`Actual engine tool receipt ${name}`);
    const requests=cdp.events.slice(eventStart).filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.url.endsWith('/prompt_async')&&e.params.request.method==='POST');
    assert.equal(requests.length,1,'One actual native SDK submission');
    const payload=JSON.parse(requests[0].params.request.postData);
    assert.equal(payload.messageID,binding.messageId);assert.deepEqual(payload.model,{providerID:'isir-native',modelID:'synthetic'});assert.equal(payload.agent,'legalwork');assert.equal(payload.variant,'high');
    assert.ok(cdp.events.slice(eventStart).some(e=>e.method==='Network.responseReceived'&&e.params.requestId===requests[0].params.requestId&&e.params.response.status===204),'Immediate production204 response');
    await openFiles(workspace);await click('Dokumenty');await click('Prepare this folder');
    await until(async()=>{const text=await panelText();return text.includes('Chat run ended; separate checks')&&text.includes('Format and sources verified')},'renderer completed binding and current output verification');
    const terminalBinding=await cdp.evaluate(`JSON.parse(localStorage.getItem('lawoss.document-generations.v1')??'[]').map(x=>x[1]).find(b=>b.workspaceId===${JSON.stringify(workspace.id)})`);
    assert.equal(terminalBinding.nativeRunObserved,true,'Production native SSE busy status was consumed');
    assert.ok(terminalBinding.nativeRevision>=2,'Native live lifecycle revision includes busy/idle');
    assert.equal(terminalBinding.phase,'completed');
    await hashes(entry,workspace);
    const sibling=workspaces[(index+1)%workspaces.length];
    const siblingFiles=await readdir(sibling.path);
    if(index<workspaces.length-1)assert.ok(!siblingFiles.includes('native-registry.csv'),'Generate must not write to the next project');
    const foreign=await api(sibling,`lawoss/documents/${prepared[0].id}/read`);
    assert.notEqual(foreign.response.status,200,'A different selected project cannot read this evidence ID');
    evidence.push({workspaceId:workspace.id,pickerReceipt,nativeRevision:terminalBinding.nativeRevision,documentIds:prepared.map(d=>d.id),sessionId:binding.sessionId,messageId:binding.messageId,sourceHashes:entry.documents.map(d=>sha256(d.bytes)),outputHashes:actualHashes,nativeSubmission:{messageID:payload.messageID,model:payload.model,agent:payload.agent,variant:payload.variant,status:204},assistantParentIds:[...new Set(snapshot.messages.filter(m=>m.info.role==='assistant').map(m=>m.info.parentID))],toolNames:parts.filter(p=>p.type==='tool').map(p=>p.tool)});
    console.log(`${debugPair?"DEBUG":"PASS"} native case ${index+1}/10: picker/drop, all sources, real engine tools, saved/validated hashes, native204+terminal`);
  }
  await writeFile(path.join(root,'native-receipts.json'),JSON.stringify({mode:corpus.mode,fullMatrix:!debugPair,engineVersion:health.version,engineIdentities,cases:evidence},null,2),{mode:0o600});

  diagnostics.phase('extra-cases');
  // The ordinary composer submits an OS-backed attachment through its real
  // binary upload route before the native engine receives the saved reference.
  const chatWorkspace=workspaces.at(-1),chatEvidence=evidence.at(-1),chatSource=corpus.cases.at(-1).documents[0];
  await cdp.evaluate(`window.__legalworkControl.execute('session.open',{sessionId:${JSON.stringify(chatEvidence.sessionId)}})`);
  const attachmentBase=path.join(chatWorkspace.path,'.legalwork/attachments');
  const attachmentDirsBefore=new Set(await readdir(attachmentBase).catch(()=>[]));
  const attachStart=cdp.events.length;
  await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('button[aria-label="Attach files"]');if(!e||e.disabled)return false;e.click();return true})()`),'ordinary native composer attachment chooser');
  const attachChooser=await until(()=>cdp.events.slice(attachStart).find(e=>e.method==='Page.fileChooserOpened'),'native chat attachment input');
  await cdp.send('DOM.setFileInputFiles',{backendNodeId:attachChooser.params.backendNodeId,files:[path.join(root,'originals',corpus.cases.at(-1).id,chatSource.name)]});
  const attachment=await until(async()=>{
    const base=path.join(chatWorkspace.path,'.legalwork/attachments');
    for(const folder of await readdir(base).catch(()=>[])){
      if(attachmentDirsBefore.has(folder))continue;
      for(const name of await readdir(path.join(base,folder)).catch(()=>[])){
        const target=path.join(base,folder,name);
        try{if(sha256(await readFile(target))===sha256(chatSource.bytes))return target}catch{}
      }
    }
    return false;
  },'actual native composer-uploaded file bytes');
  await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');if(!e)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()`),'ordinary native prompt editor');
  await cdp.send('Input.insertText',{text:'\nNative attachment submission fixture.'});
  const chatStart=cdp.events.length;
  await click('Run task');
  const chatRequest=await until(()=>cdp.events.slice(chatStart).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&e.params.request.url.endsWith('/prompt_async')),'ordinary native chat submission');
  const attachmentPath=path.relative(chatWorkspace.path,attachment).replaceAll('\\','/');
  assert.match(attachmentPath,/^\.legalwork\/attachments\/[a-f0-9-]{36}\//);
  assert.ok(chatRequest.params.request.postData.includes(attachmentPath),'Native prompt carries this newly saved attachment reference');
  const uploaded=cdp.events.slice(attachStart).find(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith(`/workspace/${chatWorkspace.id}/files/raw`)&&e.params.response.status===200);
  assert.ok(uploaded,'Actual authenticated binary upload returned200');
  extraEvidence.chat={path:attachmentPath,hash:sha256(await readFile(attachment)),uploadStatus:200,promptRequestId:chatRequest.params.requestId};
  await until(async()=>{const {body}=await api(chatWorkspace,`sessions/${chatEvidence.sessionId}/snapshot?limit=20`);return body.item?.status.type==='idle'&&body.item.messages.some(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.includes('Native attachment submission fixture.')))},'real engine stores native attachment turn');
  assert.equal(sha256(await readFile(attachment)),sha256(chatSource.bytes));
  console.log('PASS native composer attachment upload, actual saved bytes and real engine submission');
  // Actual saved bytes are the input for invalidation tests, never generated
  // by the runner. Restore only those captured bytes after testing an edit.
  const last=workspaces.at(-1);
  const csvPath=path.join(last.path,'native-registry.csv'),savedCsv=await readFile(csvPath);
  await writeFile(csvPath,Buffer.concat([savedCsv,Buffer.from('\ninvalid edit')]));
  await openFiles(last);await click('Dokumenty');await click('Prepare this folder');
  await until(async()=> (await panelText()).includes('Output edited / removed'),'rendered output hash invalidation');
  await click('Validate saved output');
  const edited=await api(last,'lawoss/documents/outputs');
  assert.ok(edited.body.outputs.some(o=>o.path==='native-registry.csv'&&!o.verified&&o.currentHash!==o.hash));
  await writeFile(csvPath,savedCsv);
  const preparedLast=(await api(last,'lawoss/documents')).body.documents;
  const restored=await api(last,'lawoss/documents/validate',{paths:['native-registry.csv','native-summary.md'],documentIds:preparedLast.map(d=>d.id),outputLanguage:'en'});
  assert.equal(restored.body.valid,true);
  // A deliberately wrong case/reference must retract persisted verification.
  if(corpus.mode==='synthetic'){
    const manifestPath=path.join(last.path,'TEST_ZDROJE_ISIR.json'),saved=await readFile(manifestPath),bad=JSON.parse(saved);
    bad.caseNumber='WRONG CASE 999/2026';bad.documents[0].documentId='WRONG-OFFICIAL-ID';
    await writeFile(manifestPath,JSON.stringify(bad));
    const invalid=await api(last,'lawoss/documents/validate',{paths:['native-registry.csv','native-summary.md'],documentIds:preparedLast.map(d=>d.id),outputLanguage:'en'});
    assert.equal(invalid.body.valid,false);assert.ok(invalid.body.issues.some(i=>['case_identity','extra_source','missing_source'].includes(i.code)));
    assert.ok((await api(last,'lawoss/documents/outputs')).body.outputs.every(o=>!o.verified));
    await writeFile(manifestPath,saved);
    assert.equal((await api(last,'lawoss/documents/validate',{paths:['native-registry.csv','native-summary.md'],documentIds:preparedLast.map(d=>d.id),outputLanguage:'en'})).body.valid,true);
  }
  // A real missing-text PDF stays partial with local OCR unconfigured. The
  // extra negative inputs are separate from the 31 original reference fixtures.
  if(corpus.mode==='synthetic'){
    await openFiles(last);await click('Checks');
    const scanPath=path.join(root,'synthetic-incomplete-scan.pdf'),scan=partialPdf();await writeFile(scanPath,scan);
    const originalSource=path.join(root,'originals',corpus.cases.at(-1).id,chatSource.name);
    const checks=path.join(last.path,'Checks'),beforeFirst=await readdir(checks);
    assert.equal(beforeFirst.length,0);
    const firstCopyReceipt=await drop([originalSource]);
    await until(async()=>{try{return sha256(await readFile(path.join(last.path,'Checks',chatSource.name)))===sha256(chatSource.bytes)}catch{return false}},'native collision first copy');
    const beforeSecond=await readdir(checks);assert.deepEqual(beforeSecond,[chatSource.name]);
    const copyReceipt=await drop([originalSource,scanPath]);
    const collided=await until(async()=>{for(const name of await readdir(path.join(last.path,'Checks'))){if(beforeSecond.includes(name))continue;try{if(sha256(await readFile(path.join(last.path,'Checks',name)))===sha256(chatSource.bytes))return name}catch{}}return false},'actual native filename collision preserves first copy');
    assert.equal(sha256(await readFile(path.join(last.path,'Checks',chatSource.name))),sha256(chatSource.bytes));
    const afterSecond=await readdir(checks),added=afterSecond.filter(name=>!beforeSecond.includes(name));
    assert.equal(added.length,2);assert.ok(added.includes(collided)&&added.includes('synthetic-incomplete-scan.pdf'));
    const copyLines=(await readFile(path.join(root,'copy-receipts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    const ipcCopy=copyLines.findLast(r=>r.workspaceId===last.id&&r.folder==='Checks'&&JSON.stringify(r.paths)===JSON.stringify([originalSource,scanPath]));
    assert.ok(ipcCopy);assert.equal(ipcCopy.error,undefined);assert.ok(ipcCopy.result.files.every(f=>f.status==='copied'));
    assert.deepEqual(new Set(ipcCopy.result.files.map(f=>path.basename(f.path))),new Set(added));
    extraEvidence.collision={before:beforeSecond,after:afterSecond,newPaths:added,hash:sha256(chatSource.bytes),uiReceipts:[firstCopyReceipt,copyReceipt],ipcCopy};
    await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('input[aria-label="Select source synthetic-incomplete-scan.pdf"]');if(!e)return false;e.click();return true})()`),'select actual incomplete PDF');
    await click('Prepare selected');
    const partial=await until(async()=>{const {body}=await api(last,'lawoss/documents');return body.documents.find(d=>d.path==='Checks/synthetic-incomplete-scan.pdf'&&d.status==='partial')},'production partial extraction without configured OCR',60000);
    assert.equal(partial.complete,false);assert.equal(partial.readablePages,1);assert.equal(partial.pageCount,2);
    await until(async()=>{const text=await panelText();return text.includes('Partially readable / incomplete OCR')&&text.includes('Incomplete extraction / OCR')&&!text.includes('Selected sources fully extracted')},'renderer keeps partial coverage truthful');
    assert.equal(sha256(await readFile(scanPath)),sha256(scan));assert.equal(sha256(await readFile(path.join(last.path,'Checks','synthetic-incomplete-scan.pdf'))),sha256(scan));
    // Source selection returns to the supported Dokumenty scope; extra
    // negative inputs remain on disk and are never manually deselected there.
    await openFiles(last);await click('Dokumenty');await click('Prepare this folder');
    const before=cdp.events.length;
    await cdp.evaluate(`(()=>{const e=document.querySelector('[aria-label="Document processing"] label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'../case-01');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await until(()=>cdp.evaluate(`document.querySelector('[aria-label="Document processing"] label input').value==='../case-01'`),'actual cross-project working-directory input');
    await click('Generate through chat');
    await until(()=>cdp.evaluate(`!!document.querySelector('[aria-label="Document processing"] [role="alert"]')`),'cross-project working directory is refused');
    const crossRequests=cdp.events.slice(before).filter(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&(e.params.request.url.endsWith('/prompt_async')||/\/opencode\/session(?:\?|$)/.test(e.params.request.url)));
    assert.equal(crossRequests.length,0,'Invalid working scope cannot create or submit an engine session');
    await cdp.evaluate(`(()=>{const e=document.querySelector('[aria-label="Document processing"] label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    console.log('PASS native pending/partial states, collision bytes, edited and wrong-identity invalidation, cross-project no writes');
  }
  // Close the owned application before moving its cwd (also portable on Windows).
  const first=workspaces[0],oldPath=first.path,moved=path.join(root,'cases','case-01 přesunutý spis');
  await openFiles(first);
  diagnostics.phase("relaunch");
  cdp.close();cdp=null;await stop(appChild);
  await rename(oldPath,moved);
  await writeFile(path.join(root,'chooser.json'),JSON.stringify({paths:[moved]}));
  appChild=launch(electron,[...(process.platform==='linux'?['--no-sandbox','--disable-gpu']:[]),path.join(repo,'apps/desktop/scripts/isir-native-entry.mjs')],path.join(repo,'apps/desktop'),'electron-relaunch');
  cdp=await connectRenderer(`http://127.0.0.1:${cdpPort}`, nativeFetch);
  await cdp.send('Page.enable');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1800,height:1400,deviceScaleFactor:1,mobile:false});
  await until(()=>cdp.evaluate('!!window.__legalworkControl'),'relaunched native renderer',90000);
  await openFiles(first);
  const recoveryStart=cdp.events.length;
  await click('Reconnect project folder');
  await until(async()=>{const saved=JSON.parse(await readFile(path.join(profile,'legalwork-workspaces.json'),'utf8'));const found=saved.workspaces.find(w=>w.id===first.id);return found?.path===moved},'production native chooser canonical reconnect transaction',90000);
  await until(()=>['/workspace/'+first.id+'/reconnect','/workspaces/'+first.id+'/activate'].every(path=>cdp.events.slice(recoveryStart).some(e=>e.method==='Network.responseReceived'&&new URL(e.params.response.url).pathname.endsWith(path)&&e.params.response.status===200)),'actual native reconnect and activation200');
  first.path=moved;
  serverInfo=await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('legalworkServerInfo')");
  serverAuth={authorization:'Bearer '+(serverInfo.ownerToken||serverInfo.clientToken),'content-type':'application/json'};
  const chooserReceipts=(await readFile(path.join(root,'chooser-receipts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(chooserReceipts.some(r=>r.properties.includes('openDirectory')&&r.paths[0]===moved),'Actual native recovery chooser bridge was invoked');
  assert.equal(await access(oldPath).then(()=>true,()=>false),false,'Recovery cannot recreate the old path');
  const persisted=JSON.parse(await readFile(path.join(profile,'legalwork-workspaces.json'),'utf8'));
  assert.equal(persisted.workspaces.length,10);assert.ok(persisted.workspaces.find(w=>w.id===first.id).previousPaths.includes(oldPath));
  if(debugPair){
    const engineInfo=await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('engineInfo')");
    const auth={authorization:'Basic '+Buffer.from(`${engineInfo.opencodeUsername}:${engineInfo.opencodePassword}`).toString('base64')};
    const probe=[];
    for(const [label,directory,includeArchived] of [['unicode-encoded',encodeURIComponent(moved),false],['ascii-existing',workspaces.at(-1).path,false],['engine-default',null,false],['unicode-with-archived',encodeURIComponent(moved),true],['ascii-with-archived',workspaces.at(-1).path,true],['default-with-archived',null,true]]){
      const response=await nativeFetch(`${engineInfo.baseUrl}/experimental/session?limit=1000${includeArchived?'&archived=true':''}`,{headers:{...auth,...(directory===null?{}:{'x-opencode-directory':directory})}});
      const body=await response.json();probe.push({label,status:response.status,sessions:Array.isArray(body)?body.map(s=>({id:s.id,directory:s.directory})):body});
    }
    await writeFile(path.join(root,'history-transport-probe.json'),JSON.stringify(probe,null,2),{mode:0o600});
    console.log('DEBUG actual history transport',JSON.stringify(probe.map(p=>({label:p.label,status:p.status,count:Array.isArray(p.sessions)?p.sessions.length:null}))));
  }
  diagnostics.phase("recovery");
  const recovered=await api(first,`sessions/${evidence[0].sessionId}/snapshot?limit=20`);
  await writeFile(path.join(root,'recovered-snapshot.json'),JSON.stringify(recovered.body,null,2),{mode:0o600});
  assert.equal(recovered.response.status,200);assert.equal(recovered.body.item.session.id,evidence[0].sessionId);
  assert.equal(recovered.body.item.session.directory,moved);
  assert.ok(recovered.body.item.messages.some(m=>m.info.id===evidence[0].messageId),'Original engine message ID/history survives native reconnect');
  await cdp.evaluate(`window.__legalworkControl.execute('session.open',{sessionId:${JSON.stringify(evidence[0].sessionId)}})`);
  await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');if(!e||e.innerText.trim())return false;e.focus();return true})()`),'recovered original session composer');
  const recoveryPromptStart=cdp.events.length;
  await cdp.send('Input.insertText',{text:'NATIVE_RECOVERED_CWD_PROOF'});
  await click('Run task');
  const recoveryRequest=await until(()=>cdp.events.slice(recoveryPromptStart).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&e.params.request.url.endsWith('/prompt_async')&&e.params.request.postData?.includes('NATIVE_RECOVERED_CWD_PROOF')),'actual recovered-session native prompt');
  const freshRead=await until(async()=>{
    const {body}=await api(first,`sessions/${evidence[0].sessionId}/snapshot?limit=20`),item=body.item;
    const user=item?.messages.find(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.includes('NATIVE_RECOVERED_CWD_PROOF')));
    const assistant=user&&item.messages.find(m=>m.info.parentID===user.info.id&&m.info.finish==='stop');
    const read=user&&item.messages.filter(m=>m.info.parentID===user.info.id).flatMap(m=>m.parts).find(p=>p.type==='tool'&&p.tool==='lawoss_documents_read'&&p.state.status==='completed');
    const cwd=user&&item.messages.filter(m=>m.info.parentID===user.info.id).flatMap(m=>m.parts).find(p=>p.type==='tool'&&p.tool==='bash'&&p.state.status==='completed'&&p.state.input.command===(process.platform==='win32'?'node -p "process.cwd()"':'pwd'));
    return item?.status.type==='idle'&&assistant&&read&&cwd?{session:item.session,user:user.info.id,read,cwd}:false;
  },'real engine executes a fresh scoped document read after native reconnect',60000);
  assert.equal(freshRead.session.directory,moved);assert.equal(freshRead.session.id,evidence[0].sessionId);
  assert.ok(evidence[0].documentIds.includes(freshRead.read.state.input.id));
  assert.equal(freshRead.cwd.state.output.trim(),moved,"Actual engine process cwd uses the moved folder, without an absolute read operand");
  assert.equal(await access(oldPath).then(()=>true,()=>false),false);
  extraEvidence.recoveryRead={sessionId:freshRead.session.id,messageId:freshRead.user,directory:freshRead.session.directory,actualPwd:freshRead.cwd.state.output.trim(),documentId:freshRead.read.state.input.id,promptRequestId:recoveryRequest.params.requestId};
  // Every output, source and project is independently reread after an actual
  // Electron shutdown and launch with the same profile, not store reconstruction.
  for(const [index,entry] of caseRuns){
    const workspace=workspaces[index];
    await hashes(entry,workspace);
    const caseEvidence=evidence.find(item=>item.workspaceId===workspace.id);
    for(const [name,hash] of Object.entries(caseEvidence.outputHashes))assert.equal(sha256(await readFile(path.join(workspace.path,name))),hash);
    const outputs=await api(workspace,'lawoss/documents/outputs');
    assert.equal(outputs.response.status,200);assert.equal(outputs.body.outputs.length,2);assert.ok(outputs.body.outputs.every(o=>o.verified&&o.hash===o.currentHash));
  }
  await openFiles(first);await click('Dokumenty');await click('Prepare this folder');
  await until(async()=> (await panelText()).includes('Format and sources verified'),'recovered native renderer shows actual current verification');
  const finalEngine=await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('engineInfo')");
  const relaunchedHealth=await (await nativeFetch(`${finalEngine.baseUrl}/global/health`,{headers:{authorization:'Basic '+Buffer.from(`${finalEngine.opencodeUsername}:${finalEngine.opencodePassword}`).toString('base64')}})).json();
  const relaunchedEngineIdentity=await verifyNativeEngineRuntime(preparedEngine,finalEngine.opencodeBinPath,relaunchedHealth);
  engineIdentities.push({ phase: 'relaunch', ...relaunchedEngineIdentity });
  await writeFile(path.join(root,'engine-identity-receipts.json'),JSON.stringify(engineIdentities,null,2),{mode:0o600});
  const artifacts={};
  for(const file of ['apps/server/dist/embedded.js','apps/server/dist/lawoss/documents/export.js','apps/server/dist/lawoss/workspace-history-sessions.js','apps/server/dist/opencode-plugins/legalwork-project-tools.js','apps/desktop/electron/runtime.mjs','apps/app/src/react-app/domains/session/sync/session-sync.ts'])artifacts[file]=sha256(await readFile(path.join(repo,file)));
  extraEvidence.artifactHashes=artifacts;extraEvidence.relaunchedEngineVersion=relaunchedHealth.version;
  evidence[0].recoveredPath=moved;
  await writeFile(path.join(root,'native-receipts.json'),JSON.stringify({mode:corpus.mode,fullMatrix:!debugPair,engineVersion:health.version,engineIdentities,applicationRelaunch:true,nativeReconnect:true,cases:evidence,extras:extraEvidence},null,2),{mode:0o600});
  console.log(`${debugPair?'DEBUG':'PASS'} actual application relaunch, native folder reconnect, same project/session/message IDs, all exercised original/output SHA-256`);
  diagnostics.phase("complete");
} catch (error) {
  primaryError = error;
  console.error('Primary native failure before cleanup', JSON.stringify(diagnostics.failure(error)));
  await diagnostics.captureEngineLog({error,selectedDirectory:workspaces[0].path,launchWallMs:engineLogLaunchWallMs,deadlineWallMs:engineLogDeadlineWallMs}).catch(()=>undefined);
  await boundaryProbe?.().catch(()=>undefined);
  await diagnostics.write({events:cdp?.events,error}).catch(e=>console.error('Diagnostic publication failed',JSON.stringify(errorMetadata(e))));
  for (const owner of children) await writeFile(path.join(root, `${owner.label}.log`), owner.output(), { mode: 0o600 });
  if (corpus.mode === "synthetic") await writeFile(path.join(root, "provider.json"),JSON.stringify({receipts:provider.receipts,errors:provider.errors},null,2),{mode:0o600});
  if (cdp) await writeFile(path.join(root, "renderer.json"), JSON.stringify({ text: await cdp.evaluate("document.body.innerText").catch(String), events: cdp.events }, null, 2), { mode: 0o600 });
  console.error(`Native evidence retained at ${root}`);
  throw error;
} finally {
  const result = await settleCleanup(primaryError, [cleanup]);
  if (result.error) throw result.error;
}
} catch (error) {
  primaryError ??= error;
  throw primaryError;
} finally {
  // Also cover pre-launch/version/setup failures without masking the primary.
  const result = await settleCleanup(primaryError, [() => preparedEngine.cleanup()]);
  if (result.error) throw result.error;
}
