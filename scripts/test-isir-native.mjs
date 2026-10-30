import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile, rm, access, symlink, realpath, rename, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import net from "node:net";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadNativeCorpus } from "../lawoss/testing/isir/native/corpus.mjs";
import { startProvider, decodeNativeToolOutput } from "../lawoss/testing/isir/native/provider.mjs";
import { partialPdf } from "../lawoss/testing/isir/native/partial-pdf.mjs";
import { connectRenderer, until as nativeUntil } from "../lawoss/testing/isir/native/cdp.mjs";
import { createNativeProtectedApprover } from "../lawoss/testing/isir/native/protected-approvals.mjs";
import { stopForRelaunch } from "../lawoss/testing/isir/native/relaunch-stop.mjs";
import { readNativeQuitAcceptance } from "../lawoss/testing/isir/native/quit-acceptance.mjs";
import { stopNativeChild } from "../lawoss/testing/isir/native/owned-process.mjs";
import { createNativeDiagnostics, settleCleanup, errorMetadata, observePromptClick, summarizeRecoveryVerification, recoveryRendererIdentity } from "../lawoss/testing/isir/native/diagnostics.mjs";
import { configureNativeProvider } from "../lawoss/testing/isir/native/bootstrap.mjs";
import { openNativeProjectFiles } from "../lawoss/testing/isir/native/project-files-navigation.mjs";
import { awaitNativeStartup } from "../lawoss/testing/isir/native/startup-readiness.mjs";
import { parseCsv } from "../apps/server/dist/lawoss/documents/validation.js";
import { sha256 } from "../lawoss/testing/isir/corpus.mjs";
import { validateProbeOption, applyProducer } from "../lawoss/testing/isir/native/engine-empty-auth-probe.mjs";
import { prepareNativeEngineFiles, probeNativeEngineVersion, verifyNativeEngineRuntime } from "../lawoss/testing/isir/native/engine-identity.mjs";
import { createNativeEngineClient } from "../lawoss/testing/isir/native/engine-client.mjs";
import { nativeRendererLaunch } from "../lawoss/testing/isir/native/renderer.mjs";
import { nativeEngineFetchRecords } from "../lawoss/testing/isir/native/engine-fetch.mjs";
import { startNativeEngineTraceReceiver } from "../lawoss/testing/isir/native/engine-traces.mjs";

const emptyAuthProbe = await validateProbeOption(process.argv.slice(2));
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
let cdp;
const diagnostics = createNativeDiagnostics({ enabled: process.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS === '1', ci: Boolean(process.env.CI), mode: corpus.mode, outputFile: process.env.LAWOSS_ISIR_NATIVE_DIAGNOSTICS_FILE, readGenerationResponseBody: requestId => cdp.send('Network.getResponseBody',{requestId}) });
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
let protectedApprovals;
const approvalScopes = new Map();
const approvalReceipts = [];
const until = (read, description, timeout) => nativeUntil(async () => {protectedApprovals?.check(); return read();}, description, timeout);
let boundaryProbe;
let recoveryVerificationStart;
let recoveryRendererExpected;
const caseRuns=[...corpus.cases.entries()].filter(([index])=>!debugPair||index===0||index===corpus.cases.length-1);
const provider = await startProvider();
let engineTraces;
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
await applyProducer(env, emptyAuthProbe, preparedEngine.expectedHash);
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
  const quitNonce = label.startsWith("electron") ? randomBytes(32).toString("hex") : null;
  const child = spawn(command, args, { cwd, env:quitNonce ? {...env,LAWOSS_ISIR_NATIVE_QUIT_NONCE:quitNonce} : env, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  if (quitNonce) child.isirNativeQuitAcceptance={root,nonce:quitNonce,pid:child.pid};
  let output = ""; child.stdout.on("data", c => output += c); child.stderr.on("data", c => output += c);
  child.on("error", e => output += String(e));
  children.push({ child, label, output: () => output });
  return child;
};

const relaunchCleanupErrors=[];
let cleanupPromise;
const cleanup = () => cleanupPromise ??= (async () => {
  const result = await settleCleanup(primaryError, [
    async () => {if (protectedApprovals) {await protectedApprovals.close(); approvalReceipts.push(...protectedApprovals.receipts); protectedApprovals = undefined;}},
    () => cdp?.evaluate('window.__isirChooserBoundary?.disconnect()'),
    () => cdp?.close(),
    ...[...children].reverse().map(({child}) => () => stop(child)),
    () => engineTraces?.close(),
    () => provider.close(),
    () => preparedEngine.cleanup(),
  ]);
  if(corpus.mode==='synthetic'&&result.failures.length){
    try {
      const seen=new Set();
      const describe=(error,depth=0)=>{if(depth>8)return {truncated:true};if(error&&typeof error==='object'){if(seen.has(error))return {circular:true};seen.add(error);return {name:error.name,message:error.message,stack:error.stack,...('cause' in error?{cause:describe(error.cause,depth+1)}:{}),...(error instanceof AggregateError?{errors:[...error.errors].map(item=>describe(item,depth+1))}:{})}}return {value:String(error)}};
      await writeFile(path.join(root,'native-cleanup-errors.private.json'),JSON.stringify({failures:result.failures.map(error=>describe(error))},null,2),{mode:0o600});
    } catch { /* Supplemental private evidence never changes cleanup decisions. */ }
  }
  for (const error of result.failures) console.error('Owned native cleanup failure', JSON.stringify(errorMetadata(error)));
  if(primaryError&&engineTraces)console.error('Owned completed engine bootstrap spans',JSON.stringify(engineTraces.snapshot()));
  const processes=children.map(({child,label})=>({label,pid:child.pid,exitCode:child.exitCode,signal:child.signalCode}));
  await writeFile(path.join(root,'process-receipts.json'),JSON.stringify({cleaned:result.failures.length===0,processes},null,2),{mode:0o600});
  await diagnostics.write({events:cdp?.events,error:primaryError,cleanupErrors:[...relaunchCleanupErrors,...result.failures]});
  if (corpus.mode === "synthetic") await writeFile(path.join(root,"native-context-approvals.json"),JSON.stringify({receipts:approvalReceipts},null,2),{mode:0o600});
  console.log(`Owned native cleanup ${result.failures.length ? 'failed' : 'completed'}; private evidence: ${root}`);
  if (result.error) throw result.error;
})();
process.once('SIGINT',()=>void cleanup().then(()=>process.exit(130)));
process.once('SIGTERM',()=>void cleanup().then(()=>process.exit(143)));
try {
  engineTraces = await startNativeEngineTraceReceiver();
  env.OTEL_EXPORTER_OTLP_ENDPOINT = engineTraces.endpoint;
  diagnostics.phase("startup");
  const renderer = await nativeRendererLaunch(path.join(repo,"apps/app"),uiPort,root);
  launch(process.execPath, [path.join(path.dirname(requireApp.resolve("vite/package.json")), "bin/vite.js"), ...renderer.args], renderer.cwd, "vite");
  await until(async () => (await nativeFetch(env.LEGALWORK_ELECTRON_START_URL)).ok, "owned Vite");
  engineLogLaunchWallMs=Date.now();
  let appChild = launch(electron, [...(process.platform === "linux" ? ["--no-sandbox", "--disable-gpu"] : []), path.join(repo, "apps/desktop/scripts/isir-native-entry.mjs")], path.join(repo, "apps/desktop"), "electron");
  cdp = await connectRenderer(`http://127.0.0.1:${cdpPort}`, nativeFetch, diagnostics.observeNetworkEvent);
  if (corpus.mode === "synthetic") protectedApprovals = createNativeProtectedApprover({mode: corpus.mode, root, profile, cdpOrigin: `http://127.0.0.1:${cdpPort}`, providerEndpoint: provider.url, request: nativeFetch});
  await cdp.send('Page.enable');
  assert.deepEqual(await cdp.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})'),{visibility:'visible',focused:true},'Owned native page is active for production UI polling');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1800,height:1400,deviceScaleFactor:1,mobile:false});
  await until(() => cdp.evaluate("!!window.__legalworkControl"), "native renderer controls", 90000);
  await until(() => cdp.evaluate("!document.body.innerText.includes('Loading your workspaces') && document.body.innerText.length > 150"), "workspace ready", 90000);
  await cdp.evaluate("window.__legalworkControl.execute('lawoss.lite.mode.set', {mode:'pro'})");
  await cdp.evaluate("window.__legalworkControl.execute('route.session')");
  await until(() => cdp.evaluate("window.__legalworkControl.listActions().some(a=>a.id==='session.create_task'&&!a.disabled)"), "native engine workspace ready", 90000);
  const click = async (text, promptObservation=null) => {
    await cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button')].find(e=>e.textContent.trim()==='Got it');e?.click()})()`);
    const clicked=await until(() => cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]')].find(e=>e.textContent.trim()===${JSON.stringify(text)}&&e.getBoundingClientRect().width>0&&!e.disabled);if(!e)return false;${promptObservation?`let observation=null;try{observation=(${observePromptClick.toString()})(${JSON.stringify(promptObservation.context)},e)}catch{}e.click();return {clicked:true,observation}`:'e.click();return true'}})()`), `visible native control ${text}`);
    try{if(promptObservation&&clicked?.clicked===true)diagnostics.promptClick(promptObservation.role,clicked.observation);}catch{}
  };
  const liveEngine = await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('engineInfo')");
  let serverInfo = await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('legalworkServerInfo')");
  let engineRequest = createNativeEngineClient(serverInfo, workspaces[0].id, nativeFetch);
  const healthResponse = await engineRequest('/global/health');
  assert.equal(healthResponse.status, 200, 'Owned workspace engine health must authenticate');
  const health = await healthResponse.json();
  const initialEngineIdentity = await verifyNativeEngineRuntime(preparedEngine, liveEngine.opencodeBinPath, health);
  const engineIdentities = [{ phase: 'initial', ...initialEngineIdentity }];
  await writeFile(path.join(root,'engine-identity-receipts.json'),JSON.stringify(engineIdentities,null,2),{mode:0o600});
  let serverAuth = {authorization:'Bearer '+(serverInfo.ownerToken||serverInfo.clientToken),'content-type':'application/json'};
  // Initial registered root only. A restart after moving the folder must never
  // probe or recreate its missing historical root.
  const startupReceipt=await awaitNativeStartup({engineRequest,request:nativeFetch,serverInfo,workspace:workspaces[0],observe:diagnostics.startup,onDeadline:deadline=>{engineLogDeadlineWallMs=deadline;}});
  console.log('Native selected-instance startup',JSON.stringify(startupReceipt));
  diagnostics.phase("configure-provider");
  const providerConfig = JSON.parse(env.OPENCODE_CONFIG_CONTENT).provider;
  await configureNativeProvider({request:nativeFetch,serverInfo,serverAuth,engineRequest,workspace:workspaces[0],providerConfig});
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

  const renderBoundary=await cdp.evaluate(`(async()=>{const tests=await import('/__isir-fixtures/session-render-boundary.js');return tests.runNativeSessionRenderBoundary(${JSON.stringify({baseUrl:serverInfo.baseUrl,token:serverInfo.ownerToken||serverInfo.clientToken,workspaceId:workspaces[0].id,workspaceRoot:workspaces[0].path})})})()`);
  assert.equal(renderBoundary.actualMountedSurface,true);
  await writeFile(path.join(root,'session-render-boundary.json'),JSON.stringify(renderBoundary,null,2),{mode:0o600});
  console.log(`Mounted native Surface boundary: ${JSON.stringify(renderBoundary)}`);

  let selectedIndex=1;
  boundaryProbe = () => diagnostics.probeWorkspace({serverInfo,serverAuth,workspaces,selectedIndex});
  const api = async (workspace, route, input, afterHeaders) => {
    const response = await nativeFetch(`${serverInfo.baseUrl}/workspace/${workspace.id}/${route}`,{headers:serverAuth,...(input===undefined?{}:{method:'POST',body:JSON.stringify(input)})});
    try { afterHeaders?.(); } catch {}
    return {response,body:await response.json()};
  };
  const panelText = () => cdp.evaluate(`document.querySelector('[aria-label="Document processing"]')?.innerText??''`);
  const openFiles = async (workspace,readiness='listing') => {
    selectedIndex=workspaces.indexOf(workspace)+1;
    await openNativeProjectFiles({cdp,until,workspace,caseIndex:selectedIndex,readiness});
  };
  const inputFiles = async (selector, paths) => {
    const doc = await cdp.send('DOM.getDocument');
    const input = await cdp.send('DOM.querySelector',{nodeId:doc.root.nodeId,selector});
    assert.ok(input.nodeId,'OS-backed input node is present');
    await cdp.send('DOM.setFileInputFiles',{nodeId:input.nodeId,files:paths});
  };
  const copyReceipts = async () => (await readFile(path.join(root,'copy-receipts.jsonl'),'utf8').catch(error=>{if(error.code==='ENOENT')return '';throw error})).trim().split('\n').filter(Boolean).map(JSON.parse);
  const drop = async (paths,workspace) => {
    await until(()=>cdp.evaluate(`document.querySelector('[aria-label="Document processing"]')?.closest('[aria-busy]')?.getAttribute('aria-busy')==='false'`),'native file import is ready');
    const folder=await cdp.evaluate(`[...document.querySelector('[aria-label="Current folder"]').querySelectorAll('button')].slice(1).map(e=>e.textContent.trim()).join('/')`);
    const receiptStart=(await copyReceipts()).length;
    await cdp.evaluate(`(()=>{document.querySelector('#isir-os-backed-drop')?.remove();const i=document.createElement('input');i.type='file';i.id='isir-os-backed-drop';i.multiple=true;document.body.append(i)})()`);
    await inputFiles('#isir-os-backed-drop',paths);
    await cdp.evaluate(`(()=>{const dt=new DataTransfer();for(const f of document.querySelector('#isir-os-backed-drop').files)dt.items.add(f);const target=document.querySelector('[aria-label="Document processing"]').parentElement;target.dispatchEvent(new DragEvent('dragover',{bubbles:true,dataTransfer:dt}));target.dispatchEvent(new DragEvent('drop',{bubbles:true,dataTransfer:dt}));document.querySelector('#isir-os-backed-drop').remove()})()`);
    // Current native UI opens one artifact tab per copy instead of a toast.
    // Observe the unchanged production dispatcher and completed tab paths.
    const ipcCopies=await until(async()=>{
      const receipts=(await copyReceipts()).slice(receiptStart).filter(r=>r.workspaceId===workspace.id&&r.folder===folder);
      return paths.every(source=>receipts.some(r=>r.paths.includes(source)))?receipts:false;
    },'actual production file-copy IPC receipts');
    assert.ok(ipcCopies.every(r=>!r.error&&r.result.files.every(f=>f.status==='copied'&&f.path)));
    const copied=ipcCopies.flatMap(r=>r.result.files);
    const tabs=await until(()=>cdp.evaluate(`(()=>{const tabs=[...document.querySelectorAll('[data-panel-tab-id] [aria-label^="Select tab:"]')].map(e=>({label:e.getAttribute('aria-label'),title:e.getAttribute('title')}));return ${JSON.stringify(copied.map(f=>f.path))}.every(path=>tabs.some(tab=>tab.title?.endsWith('/ '+path)))?tabs:false})()`),'completed native file-copy tabs show actual project paths');
    await openFiles(workspace);
    for(const segment of folder.split('/').filter(Boolean))await click(segment);
    return {ipcCopies,tabs};
  };
  const picker = async (paths,workspace) => {
    await cdp.send('Page.enable'); await cdp.send('Page.setInterceptFileChooserDialog',{enabled:true});
    const eventStart=cdp.events.length;
    const priorTabIds=await until(()=>cdp.evaluate(`(()=>{
      const button=document.querySelector('button[aria-label="Refresh folder"]'),snapshot=window.__legalworkControl?.snapshot?.();
      if(!button||button.disabled||window.__LEGALWORK_ELECTRON__==null||snapshot?.route!=='/workspace/'+encodeURIComponent(${JSON.stringify(workspace.id)}.trim())+'/files'||snapshot.route!==location.hash.slice(1)||!Array.isArray(snapshot.openFiles)||window.__legalwork?.slice('route')?.selectedWorkspaceId!==${JSON.stringify(workspace.id)})return false;
      // DocumentPane parks hidden workspace tabs outside document. The public
      // control list retains their completed IDs while their DOM is detached.
      return [...new Set([...snapshot.openFiles.map(file=>file.id),...[...document.querySelectorAll('[data-panel-tab-id]')].map(node=>node.getAttribute('data-panel-tab-id'))])];
    })()`),'current native folder query settled');
    await until(()=>cdp.evaluate(`(()=>{const upload=[...document.querySelectorAll('[role="menuitem"]')].find(e=>e.textContent.trim()==='Add files'&&e.getBoundingClientRect().width>0&&!e.disabled);if(upload){window.__isirChooserBoundary.capture();const state=window.__isirChooserBoundary.sample('before-upload-ack');if(!['selectedOwnerEqual','runtimeOwnerEqual','workspaceRootEqual','folderPathEqual','rootBreadcrumbEqual','physicalScopeEqual','inputConnected','capturedConnected','inputGenerationEqual'].every(key=>state[key]===true))return false;upload.click();return true}const nav=document.querySelector('[aria-label="Current folder"]');const folder=document.querySelector('[data-project-folder="Dokumenty"]');if(!folder||nav?.querySelector('button')?.textContent.trim()!==${JSON.stringify(workspace.name)})return false;folder.dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,clientX:100,clientY:200,button:2}));return false})()`),'current project native upload menu action');
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
    for(const key of ['selectedOwnerEqual','runtimeOwnerEqual','workspaceRootEqual','physicalScopeEqual','inputConnected','capturedConnected','panelGenerationEqual','inputGenerationEqual','documentGenerationEqual','eventInputEqual'])assert.equal(inputIdentity.boundary[key],true,`Chooser retains exact owned input: ${key}`);
    await cdp.send('DOM.setFileInputFiles',{backendNodeId:chooser.params.backendNodeId,files:paths});
    const changed=await until(()=>cdp.evaluate('window.__isirPickerChange'),'actual native file input change event');
    assert.equal(changed.connected,true,'Native file input change bubbles from the mounted production input');
    assert.equal(changed.files.length,paths.length);
    await writeFile(path.join(root,`chooser-boundary-${selectedIndex}.json`),JSON.stringify(await cdp.evaluate('window.__isirChooserBoundary.receipt()'),null,2),{mode:0o600});
    await cdp.evaluate('window.__isirChooserBoundary.disconnect()');
    const copied=await until(async()=>{const lines=(await readFile(path.join(root,'copy-receipts.jsonl'),'utf8').catch(()=>'' )).trim().split('\n').filter(Boolean).map(JSON.parse);return lines.findLast(r=>r.workspaceId===workspace.id&&JSON.stringify(r.paths)===JSON.stringify(paths)&&r.folder==='Dokumenty')},'actual picker preload/IPC receipt');
    assert.equal(copied.error,undefined);assert.ok(copied.result.files.every(f=>f.status==='copied'));
    // Native IPC completion precedes the renderer's import/tab update. Wait for
    // the same completed artifact boundary as drop before navigating to Files.
    await until(()=>cdp.evaluate(`(()=>{
      const expected=${JSON.stringify({id:workspace.id,paths:copied.result.files.map(f=>f.path),priorTabIds})};
      const route='/workspace/'+encodeURIComponent(expected.id.trim())+'/session?view=workspace';
      // index.react selects HashRouter for the native Electron bridge. The
      // control provider publishes useLocation after React commits navigation.
      if(window.__LEGALWORK_ELECTRON__==null||location.hash!=='#'+route||window.__legalworkControl?.snapshot?.()?.route!==route||window.__legalwork?.slice('route')?.selectedWorkspaceId!==expected.id)return false;
      const visible=e=>e.isConnected&&!e.closest('[hidden]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
      const tabs=[...document.querySelectorAll('[data-panel-tab-id]')].filter(e=>!expected.priorTabIds.includes(e.getAttribute('data-panel-tab-id'))&&visible(e)).flatMap(e=>[...e.querySelectorAll('[aria-label^="Select tab:"]')].filter(visible));
      return expected.paths.every(path=>tabs.filter(tab=>tab.getAttribute('title')?.endsWith('/ '+path)).length===1);
    })()`),'completed native picker tabs and committed workspace route');
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
      const behavior=await cdp.evaluate(`(async()=>{const tests=await import('/__isir-fixtures/workspace-endpoint-stability.js');return tests.runNativeEndpointStabilityBehavior()})()`);
      assert.equal(behavior.actualMountedHook,true);assert.equal(behavior.checks,28,'Every mounted routing/auth/root transition completed');
      await writeFile(path.join(root,'endpoint-hook-behavior.json'),JSON.stringify(behavior,null,2),{mode:0o600});
      console.log(`Mounted native endpoint behavior: ${JSON.stringify(behavior)}`);
    }
    await openFiles(workspace);
    await click('Dokumenty');
    await drop(entry.documents.slice(1).map(d=>path.join(root,'originals',entry.id,d.name)),workspace);
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
      const high = await until(()=>cdp.evaluate(`(()=>{const e=[...document.querySelectorAll('[role="option"]')].find(e=>e.textContent.trim()==='high');if(!e)return false;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`),'actual synthetic provider high reasoning choice');
      await cdp.send('Input.dispatchMouseEvent',{type:'mousePressed',button:'left',clickCount:1,...high});
      await cdp.send('Input.dispatchMouseEvent',{type:'mouseReleased',button:'left',clickCount:1,...high});
      await until(()=>cdp.evaluate(`JSON.parse(localStorage.getItem('legalwork.preferences')??'{}').modelVariant==='high'`),'persisted native high variant selection');
      await openFiles(workspace);await click('Dokumenty');await click('Prepare this folder');
      await until(async()=>(await panelText()).includes('Selected sources fully extracted'),'selected model/variant retains original source scope');

    }
    diagnostics.phase("generation",index+1);
    const receiptStart=provider.receipts.length,eventStart=cdp.events.length;
    if (protectedApprovals) {
      const knownHashes = new Set(entry.documents.map(document => sha256(document.bytes)));
      const selected = [];
      for (const source of prepared) {
        assert.ok(knownHashes.has(source.hash),"Automatic native classification is restricted to the independently hashed synthetic corpus");
        let offset = 0, text = "";
        while (offset !== null) {
          const {body} = await api(workspace,`lawoss/documents/${source.id}/read?offset=${offset}&limit=16000`);
          assert.equal(body.hash, source.hash); text += body.text;
          assert.ok(Buffer.byteLength(text) <= 4 * 1024 * 1024,"Synthetic native context must remain fully reviewable");
          offset = body.nextOffset;
        }
        assert.ok(text.includes(`SYNTHETIC case ${index+1} `),"Expected synthetic source canary precedes native approval");
        selected.push({id: source.id, hash: source.hash, path: source.path, text});
      }
      const expectation = {workspaceId: workspace.id, hostDirectory: workspace.path, sources: selected};
      approvalScopes.set(workspace.id, expectation); protectedApprovals.expectOperation(expectation);
    }
    const provisionStartedAtMs=Date.now(), nativeReviewStart=protectedApprovals?.receipts.length??0;
    diagnostics.provisioningStart(index+1,cdp.events,cdp.events.length,{origin:serverInfo.baseUrl,workspaceId:workspace.id});
    await click('Generate through chat');
    // Cold VM provisioning and the initial complete-source native review precede
    // inference. Preserve the separate existing 90-second generation oracle.
    const provisionResponse = await until(()=>{
      const events=cdp.events.slice(eventStart);
      const request=events.find(event=>event.method==='Network.requestWillBeSent'&&event.params.request.method==='POST'&&new URL(event.params.request.url).pathname===`/workspace/${workspace.id}/lawoss/documents/generation`);
      return request&&events.find(event=>event.method==='Network.responseReceived'&&event.params.requestId===request.params.requestId);
    },'actual confined VM ready response before inference',240000);
    console.log('Native provisioning response',JSON.stringify({status:provisionResponse.params.response.status,elapsedMs:Date.now()-provisionStartedAtMs}));
    if(provisionResponse.params.response.status!==200){
      let code='unclassified';
      try {
        const raw=(await cdp.send('Network.getResponseBody',{requestId:provisionResponse.params.requestId})).body,value=JSON.parse(raw);
        const known=['protected_runtime_capacity','protected_checkpoint_busy','protected_checkpoint_failed','protected_checkpoint_invalid','protected_runtime_unavailable','protected_session_busy','host_decision_stale','protected_directory_denied','protected_source_scope','protected_source_denied','protected_prompt_invalid','protected_ai_denied','protected_ai_profile_missing','protected_runtime_closed'];
        if(known.includes(value?.code))code=value.code;
        if(corpus.mode==='synthetic')await writeFile(path.join(root,'protected-provision-refusal.private.json'),raw,{mode:0o600});
      } catch { /* Preserve the real status failure even if supplemental evidence is unavailable. */ }
      console.log('Native provisioning refusal',JSON.stringify({status:provisionResponse.params.response.status,code}));
    }
    assert.equal(provisionResponse.params.response.status,200,'Protected document provisioning must return HTTP200');
    const provision = await until(async()=>{try {return JSON.parse((await cdp.send('Network.getResponseBody',{requestId:provisionResponse.params.requestId})).body);} catch {return false;}},'actual host-to-guest directory mapping');
    assert.equal(provision.directoryMapping.hostDirectory,workspace.path);
    assert.equal(provision.directoryMapping.guestDirectory,'/tmp/home/protected-engine/workspace');
    assert.match(provision.directoryMapping.rootIdentity,/^[a-f0-9]{64}$/);
    assert.equal(provision.legalApproval,false);
    diagnostics.generationStart(index+1,cdp.events,eventStart,{origin:serverInfo.baseUrl,workspaceId:workspace.id,sessionId:provision.session.id});
    const binding=await until(()=>cdp.evaluate(`JSON.parse(localStorage.getItem('lawoss.document-generations.v1')??'[]').map(x=>x[1]).find(b=>b.workspaceId===${JSON.stringify(workspace.id)}&&b.transport==='protected-documents-v1')`),'persisted native protected generation binding');
    assert.equal(provision.session.id,binding.sessionId,"Actual provisioned VM session owns the native prompt");
    assert.match(binding.messageId,/^msg_[a-f0-9]{12}[A-Za-z0-9]{14}$/);
    assert.ok(['accepted','running'].includes(binding.phase),'Immediate acknowledgment stays active');
    const inferenceStartedAtMs=Date.now();
    console.log('Native generation ready',JSON.stringify({elapsedMs:Date.now()-provisionStartedAtMs,providerReceiptCount:provider.receipts.length-receiptStart,sourceRequestCount:provider.receipts.slice(receiptStart).filter(receipt=>receipt.sources.length).length,latestOrdinal:Math.max(0,...provider.receipts.slice(receiptStart).map(receipt=>receipt.ordinal??0)),nativeReviewCount:(protectedApprovals?.receipts.length??0)-nativeReviewStart,initialReviewCount:protectedApprovals?.receipts.slice(nativeReviewStart).filter(receipt=>receipt.action==='ai.documents.synthetic').length??0,wireReviewCount:protectedApprovals?.receipts.slice(nativeReviewStart).filter(receipt=>receipt.action==='ai.protected.synthetic').length??0}));
    const generation=await until(()=>{
      const receipts=provider.receipts.slice(receiptStart).filter(r=>r.sources.length);
      const last=receipts.at(-1);
      const error=last?.toolResults.find(r=>{try{return Boolean(decodeNativeToolOutput(r.content).error)}catch{return false}});
      if(error)return {error:decodeNativeToolOutput(error.content).error};
      const result=last?.toolResults.map(r=>{try{return decodeNativeToolOutput(r.content)}catch{return null}}).find(r=>r&&typeof r.valid==='boolean');
      return result?{result,receipts}:false;
    },'actual engine tool validation result',90000).catch(async error => {
      console.log('Native generation incomplete',JSON.stringify({elapsedMs:Date.now()-inferenceStartedAtMs,providerReceiptCount:provider.receipts.length-receiptStart,sourceRequestCount:provider.receipts.slice(receiptStart).filter(receipt=>receipt.sources.length).length,latestOrdinal:Math.max(0,...provider.receipts.slice(receiptStart).map(receipt=>receipt.ordinal??0)),nativeReviewCount:(protectedApprovals?.receipts.length??0)-nativeReviewStart,initialReviewCount:protectedApprovals?.receipts.slice(nativeReviewStart).filter(receipt=>receipt.action==='ai.documents.synthetic').length??0,wireReviewCount:protectedApprovals?.receipts.slice(nativeReviewStart).filter(receipt=>receipt.action==='ai.protected.synthetic').length??0}));
      // Private, wholly synthetic failure evidence only. Preserve the original
      // oracle and error; a diagnostic read never counts as tool completion.
      if (corpus.mode === 'synthetic') {
        try {
          const response = await nativeFetch(`${serverInfo.baseUrl}/workspace/${workspace.id}/opencode/session/${binding.sessionId}/message`, {headers:serverAuth,signal:AbortSignal.timeout(3000)});
          await writeFile(path.join(root,'protected-generation-engine.json'),JSON.stringify({status:response.status,body:await response.json()},null,2),{mode:0o600});
        } catch { /* Supplemental diagnostics must not mask the failed oracle. */ }
      }
      throw error;
    });
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
    const terminalBinding=await cdp.evaluate(`JSON.parse(localStorage.getItem('lawoss.document-generations.v1')??'[]').map(x=>x[1]).find(b=>b.workspaceId===${JSON.stringify(workspace.id)}&&b.transport==='protected-documents-v1')`);
    assert.equal(terminalBinding.nativeRunObserved,true,'Production native SSE busy status was consumed');
    assert.ok(terminalBinding.nativeRevision>=2,'Native live lifecycle revision includes busy/idle');
    assert.equal(terminalBinding.phase,'completed');
    await hashes(entry,workspace);
    const sibling=workspaces[(index+1)%workspaces.length];
    const siblingFiles=await readdir(sibling.path);
    if(index<workspaces.length-1)assert.ok(!siblingFiles.includes('native-registry.csv'),'Generate must not write to the next project');
    const foreign=await api(sibling,`lawoss/documents/${prepared[0].id}/read`);
    assert.notEqual(foreign.response.status,200,'A different selected project cannot read this evidence ID');
    evidence.push({workspaceId:workspace.id,pickerReceipt,nativeRevision:terminalBinding.nativeRevision,directoryMapping:provision.directoryMapping,operationId:provision.operationId,documentIds:prepared.map(d=>d.id),sessionId:binding.sessionId,messageId:binding.messageId,sourceHashes:entry.documents.map(d=>sha256(d.bytes)),outputHashes:actualHashes,nativeSubmission:{messageID:payload.messageID,model:payload.model,agent:payload.agent,variant:payload.variant,status:204},assistantParentIds:[...new Set(snapshot.messages.filter(m=>m.info.role==='assistant').map(m=>m.info.parentID))],toolNames:parts.filter(p=>p.type==='tool').map(p=>p.tool)});
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
        // Upload píše `<názov>.tmp-<id>` a potom ho premenuje (routes/files.ts); dočasný súbor nie je príloha.
        if(/\.tmp-[^/\\]+$/.test(name))continue;
        const target=path.join(base,folder,name);
        try{if(sha256(await readFile(target))===sha256(chatSource.bytes))return target}catch{}
      }
    }
    return false;
  },'actual native composer-uploaded file bytes');
  await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');if(!e)return false;e.focus();const r=document.createRange();r.selectNodeContents(e);r.collapse(false);const s=window.getSelection();s.removeAllRanges();s.addRange(r);return true})()`),'ordinary native prompt editor');
  await cdp.send('Input.insertText',{text:'\nNative attachment submission fixture.'});
  const chatStart=cdp.events.length;
  const chatObservation={role:'attachment',context:{sessionId:chatEvidence.sessionId,workspaceId:chatWorkspace.id,marker:'Native attachment submission fixture.'}};
  diagnostics.promptStart('attachment',cdp.events,chatStart,chatObservation.context);
  await click('Run task',chatObservation);
  const chatQueuePath=`/workspace/${chatWorkspace.id}/sessions/${chatEvidence.sessionId}/queue`;
  const chatRequest=await until(()=>cdp.events.slice(chatStart).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&new URL(e.params.request.url).pathname===chatQueuePath&&JSON.parse(e.params.request.postData??'{}').type==='enqueue'),'ordinary native chat queue submission');
  const queuedChat=JSON.parse(chatRequest.params.request.postData);
  assert.equal(queuedChat.execution.kind,'prompt');assert.deepEqual(queuedChat.execution.model,{providerID:'isir-native',modelID:'synthetic'});assert.equal(queuedChat.execution.agent,'legalwork');assert.equal(queuedChat.execution.variant,'high');
  const queuedAttachmentFiles=queuedChat.execution.parts.filter(part=>part.type==='file');
  assert.equal(queuedAttachmentFiles.length,1,'The structured upload mention becomes one actual typed file capability');
  assert.equal(queuedAttachmentFiles[0].url,pathToFileURL(attachment).href,'Protected upload uses the registered physical workspace root, not a subcase or Markdown inference');

  await until(()=>cdp.events.slice(chatStart).some(e=>e.method==='Network.responseReceived'&&e.params.requestId===chatRequest.params.requestId&&e.params.response.status===200),'ordinary native queue admission returned200');
  diagnostics.promptEnd('attachment');
  const attachmentPath=path.relative(chatWorkspace.path,attachment).replaceAll('\\','/');
  assert.match(attachmentPath,/^\.legalwork\/attachments\/[a-f0-9-]{36}\//);
  assert.ok(chatRequest.params.request.postData.includes(attachmentPath),'Native prompt carries this newly saved attachment reference');
  const uploaded=cdp.events.slice(attachStart).find(e=>e.method==='Network.responseReceived'&&e.params.response.url.endsWith(`/workspace/${chatWorkspace.id}/files/raw`)&&e.params.response.status===200);
  assert.ok(uploaded,'Actual authenticated binary upload returned200');
  extraEvidence.chat={path:attachmentPath,hash:sha256(await readFile(attachment)),uploadStatus:200,promptRequestId:chatRequest.params.requestId};
  const attachmentSnapshot=await until(async()=>{const {body}=await api(chatWorkspace,`sessions/${chatEvidence.sessionId}/snapshot?limit=20`);const user=body.item?.messages.find(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.includes('Native attachment submission fixture.')));return body.item?.status.type==='idle'&&user&&body.item.messages.some(m=>m.info.parentID===user.info.id&&m.info.finish==='stop')?body.item:false},'real engine stores and completes native attachment turn');
  const attachmentUser=attachmentSnapshot.messages.find(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.includes('Native attachment submission fixture.')));
  assert.ok(attachmentUser.parts.every(part=>part.type!=='file'),'The guest never receives a host file URL');
  const normalizedAttachments=attachmentUser.parts.flatMap(part=>{if(part.type!=='text')return [];try{const value=JSON.parse(part.text);return value?.untrustedSelectedDocument===true?[value]:[]}catch{return []}});
  assert.equal(normalizedAttachments.length,1,'Actual engine history contains one host-normalized selected source, not only an uploaded path');
  const normalizedAttachment=normalizedAttachments[0];
  assert.ok(chatEvidence.documentIds.includes(normalizedAttachment.documentId),'Normalized evidence belongs to this exact protected selection');
  assert.equal(normalizedAttachment.sha256,sha256(chatSource.bytes));
  assert.equal(normalizedAttachment.uploadedCopyPath,attachmentPath);
  let normalizedSourceText='',normalizedSourcePath,normalizedOffset=0;
  while(normalizedOffset!==null){const {body}=await api(chatWorkspace,`lawoss/documents/${normalizedAttachment.documentId}/read?offset=${normalizedOffset}&limit=16000`);assert.equal(body.hash,normalizedAttachment.sha256);normalizedSourceText+=body.text;normalizedSourcePath=body.provenance.sourcePath;normalizedOffset=body.nextOffset;}
  assert.ok(normalizedSourceText.length>0,'The normalized attachment contains actual prepared evidence text');
  assert.equal(normalizedAttachment.text,normalizedSourceText);
  assert.equal(normalizedAttachment.originalPath,normalizedSourcePath);
  extraEvidence.chat.normalizedSource={documentId:normalizedAttachment.documentId,sha256:normalizedAttachment.sha256,uploadedCopyPath:normalizedAttachment.uploadedCopyPath,textHash:sha256(Buffer.from(normalizedSourceText))};
  assert.equal(sha256(await readFile(attachment)),sha256(chatSource.bytes));
  console.log('PASS native composer attachment upload, actual saved bytes and real engine submission');
  // Actual saved bytes are the input for invalidation tests, never generated
  // by the runner. Restore only those captured bytes after testing an edit.
  const last=workspaces.at(-1);
  const csvPath=path.join(last.path,'native-registry.csv'),savedCsv=await readFile(csvPath);
  await writeFile(csvPath,Buffer.concat([savedCsv,Buffer.from('\ninvalid edit')]));
  await openFiles(last);
  // Re-enter the actual mounted Files journey without an extra model turn.
  await cdp.evaluate(`(()=>{const panel=[...document.querySelectorAll('[data-files-workspace-id]')].find(e=>e.getBoundingClientRect().width>0);let clicks=0;const listener=e=>{if(e.target.closest('button,a')?.textContent.trim()==='Files')clicks++};document.addEventListener('click',listener,true);window.__isirFilesReentry={panel,listener,clicks:()=>clicks}})()`);
  let filesReentryError=null;
  try {
    await openFiles(last);
    assert.equal(await cdp.evaluate(`(()=>{const before=window.__isirFilesReentry;const panels=[...document.querySelectorAll('[data-files-workspace-id]')].filter(e=>e.isConnected&&!e.closest('[hidden]')&&e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0);const state=window.__isirChooserBoundary.sample('mounted-files-reentry');return before.clicks()===0&&panels.length===1&&panels[0]===before.panel&&state.selectedOwnerEqual&&state.runtimeOwnerEqual&&state.workspaceRootEqual&&state.folderPathEqual&&state.rootBreadcrumbEqual})()`),true,'Mounted Files reentry preserves the visible project/root without toggling');
  } catch(error) { filesReentryError=error; }
  const filesReentryCleanup=await settleCleanup(filesReentryError,[()=>cdp.evaluate(`(()=>{const before=window.__isirFilesReentry;document.removeEventListener('click',before.listener,true);delete window.__isirFilesReentry})()`)]);
  if(filesReentryCleanup.error)throw filesReentryCleanup.error;
  await click('Dokumenty');await click('Prepare this folder');
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
    const firstCopyReceipt=await drop([originalSource],last);
    await until(async()=>{try{return sha256(await readFile(path.join(last.path,'Checks',chatSource.name)))===sha256(chatSource.bytes)}catch{return false}},'native collision first copy');
    const beforeSecond=await readdir(checks);assert.deepEqual(beforeSecond,[chatSource.name]);
    const copyReceipt=await drop([originalSource,scanPath],last);
    const collided=await until(async()=>{for(const name of await readdir(path.join(last.path,'Checks'))){if(beforeSecond.includes(name))continue;try{if(sha256(await readFile(path.join(last.path,'Checks',name)))===sha256(chatSource.bytes))return name}catch{}}return false},'actual native filename collision preserves first copy');
    assert.equal(sha256(await readFile(path.join(last.path,'Checks',chatSource.name))),sha256(chatSource.bytes));
    const afterSecond=await readdir(checks),added=afterSecond.filter(name=>!beforeSecond.includes(name));
    assert.equal(added.length,2);assert.ok(added.includes(collided)&&added.includes('synthetic-incomplete-scan.pdf'));
    assert.equal(copyReceipt.ipcCopies.length,2);
    assert.deepEqual(new Set(copyReceipt.ipcCopies.flatMap(r=>r.paths)),new Set([originalSource,scanPath]));
    assert.deepEqual(new Set(copyReceipt.ipcCopies.flatMap(r=>r.result.files.map(f=>path.basename(f.path)))),new Set(added));
    extraEvidence.collision={before:beforeSecond,after:afterSecond,newPaths:added,hash:sha256(chatSource.bytes),uiReceipts:[firstCopyReceipt,copyReceipt],ipcCopies:copyReceipt.ipcCopies};
    await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('input[aria-label="Select source synthetic-incomplete-scan.pdf"]');if(!e)return false;e.click();return true})()`),'select actual incomplete PDF');
    await click('Prepare selected');
    const partial=await until(async()=>{const {body}=await api(last,'lawoss/documents');return body.documents.find(d=>d.path==='Checks/synthetic-incomplete-scan.pdf'&&d.status==='partial')},'production partial extraction without configured OCR',60000);
    assert.equal(partial.complete,false);assert.equal(partial.readablePages,1);assert.equal(partial.pageCount,2);
    await until(async()=>{const text=await panelText();return text.includes('Partially readable / incomplete OCR')&&text.includes('Incomplete extraction / OCR')&&!text.includes('Selected sources fully extracted')},'renderer keeps partial coverage truthful');
    assert.equal(sha256(await readFile(scanPath)),sha256(scan));assert.equal(sha256(await readFile(path.join(last.path,'Checks','synthetic-incomplete-scan.pdf'))),sha256(scan));
    // Source selection returns to the supported Dokumenty scope; extra
    // negative inputs remain on disk and are never manually deselected there.
    await openFiles(last);await click('Dokumenty');await click('Prepare this folder');
    const currentGeneration=await until(()=>cdp.evaluate(`(()=>{const panel=document.querySelector('[aria-label="Document processing"]');const controls=[...panel.querySelectorAll('button')].filter(e=>['Generate through chat','Start a new generation','Retry in created chat'].includes(e.textContent.trim())&&e.getBoundingClientRect().width>0);return controls.length===1&&!controls[0].disabled?{enabled:true}:false})()`),'current enabled native generation control');
    assert.equal(currentGeneration.enabled,true);
    const before=cdp.events.length;
    await cdp.evaluate(`(()=>{const e=document.querySelector('[aria-label="Document processing"] label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'../case-01');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await until(()=>cdp.evaluate(`document.querySelector('[aria-label="Document processing"] label input').value==='../case-01'`),'actual cross-project working-directory input');
    await until(()=>cdp.evaluate(`(()=>{const panel=document.querySelector('[aria-label="Document processing"]');const alert=[...panel.querySelectorAll('[role="alert"]')].some(e=>e.textContent.includes('Enter an existing subdirectory of the selected client.'));const controls=[...panel.querySelectorAll('button')].filter(e=>['Generate through chat','Start a new generation','Retry in created chat'].includes(e.textContent.trim())&&e.getBoundingClientRect().width>0);return alert&&controls.length===1&&controls[0].disabled})()`),'cross-project working directory has an immediate visible refusal and disabled generation control');
    const crossRequests=cdp.events.slice(before).filter(e=>{if(e.method!=='Network.requestWillBeSent'||e.params.request.method!=='POST')return false;const pathname=new URL(e.params.request.url).pathname;return pathname.endsWith('/lawoss/documents/generation')||pathname.endsWith('/prompt_async')||/\/opencode\/session(?:\/|$)/.test(pathname)||/\/sessions\/[^/]+\/queue$/.test(pathname)});
    assert.equal(crossRequests.length,0,'Invalid working scope cannot create or submit an engine session');
    await cdp.evaluate(`(()=>{const e=document.querySelector('[aria-label="Document processing"] label input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    console.log('PASS native pending/partial states, collision bytes, edited and wrong-identity invalidation, cross-project no writes');
  }
  // Close the owned application before moving its cwd (also portable on Windows).
  const first=workspaces[0],oldPath=first.path,moved=path.join(root,'cases','case-01 přesunutý spis');
  await openFiles(first);
  diagnostics.phase("relaunch");
  if (protectedApprovals) {await protectedApprovals.close(); approvalReceipts.push(...protectedApprovals.receipts); protectedApprovals = undefined;}
  await stopForRelaunch({
    requestQuit:()=>cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('isirNativeQuit')"),
    readQuitAcceptance:()=>readNativeQuitAcceptance(appChild.isirNativeQuitAcceptance),
    closeCdp:()=>{cdp.close();cdp=null;},child:appChild,stop,cleanupFailures:relaunchCleanupErrors,
  });
  await rename(oldPath,moved);
  await writeFile(path.join(root,'chooser.json'),JSON.stringify({paths:[moved]}));
  appChild=launch(electron,[...(process.platform==='linux'?['--no-sandbox','--disable-gpu']:[]),path.join(repo,'apps/desktop/scripts/isir-native-entry.mjs')],path.join(repo,'apps/desktop'),'electron-relaunch');
  cdp=await connectRenderer(`http://127.0.0.1:${cdpPort}`, nativeFetch, diagnostics.observeNetworkEvent);
  await cdp.send('Page.enable');
  assert.deepEqual(await cdp.evaluate('({visibility:document.visibilityState,focused:document.hasFocus()})'),{visibility:'visible',focused:true},'Relaunched owned page is active for production UI polling');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:1800,height:1400,deviceScaleFactor:1,mobile:false});
  await until(()=>cdp.evaluate('!!window.__legalworkControl'),'relaunched native renderer',90000);
  await openFiles(first,'reconnect');
  const recoveryStart=cdp.events.length;
  await click('Reconnect client folder');
  await until(async()=>{const saved=JSON.parse(await readFile(path.join(profile,'legalwork-workspaces.json'),'utf8'));const found=saved.workspaces.find(w=>w.id===first.id);return found?.path===moved},'production native chooser canonical reconnect transaction',90000);
  await until(()=>['/workspace/'+first.id+'/reconnect','/workspaces/'+first.id+'/activate'].every(path=>cdp.events.slice(recoveryStart).some(e=>e.method==='Network.responseReceived'&&new URL(e.params.response.url).pathname.endsWith(path)&&e.params.response.status===200)),'actual native reconnect and activation200');
  if (corpus.mode === "synthetic") {
    protectedApprovals = createNativeProtectedApprover({mode: corpus.mode, root, profile, cdpOrigin: `http://127.0.0.1:${cdpPort}`, providerEndpoint: provider.url, request: nativeFetch});
    for (const [workspaceId, expectation] of approvalScopes) protectedApprovals.expectOperation({...expectation, hostDirectory: workspaceId === first.id ? moved : expectation.hostDirectory});
  }
  first.path=moved;
  await openFiles(first);
  serverInfo=await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('legalworkServerInfo')");
  serverAuth={authorization:'Bearer '+(serverInfo.ownerToken||serverInfo.clientToken),'content-type':'application/json'};
  engineRequest=createNativeEngineClient(serverInfo,first.id,nativeFetch);
  const chooserReceipts=(await readFile(path.join(root,'chooser-receipts.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
  assert.ok(chooserReceipts.some(r=>r.properties.includes('openDirectory')&&r.paths[0]===moved),'Actual native recovery chooser bridge was invoked');
  assert.equal(await access(oldPath).then(()=>true,()=>false),false,'Recovery cannot recreate the old path');
  const persisted=JSON.parse(await readFile(path.join(profile,'legalwork-workspaces.json'),'utf8'));
  assert.equal(persisted.workspaces.length,10);assert.ok(persisted.workspaces.find(w=>w.id===first.id).previousPaths.includes(oldPath));
  diagnostics.phase("recovery");
  diagnostics.recoveryStage('snapshot-request');
  const recovered=await api(first,`sessions/${evidence[0].sessionId}/snapshot?limit=20`,undefined,()=>diagnostics.recoveryStage('snapshot-body'));
  diagnostics.recoveryStage('snapshot-save');
  await writeFile(path.join(root,'recovered-snapshot.json'),JSON.stringify(recovered.body,null,2),{mode:0o600});
  diagnostics.recoveryStage('snapshot-check');
  assert.equal(recovered.response.status,200);assert.equal(recovered.body.item.session.id,evidence[0].sessionId);
  assert.equal(recovered.body.item.session.directory,moved);
  assert.ok(recovered.body.item.messages.some(m=>m.info.id===evidence[0].messageId),'Original engine message ID/history survives native reconnect');
  const mappingResponse = await engineRequest(`/session/${encodeURIComponent(evidence[0].sessionId)}/protected-transport`);
  assert.equal(mappingResponse.status,200,'The actual owning protected runtime publishes its current measured mapping');
  const recoveredTransport = await mappingResponse.json();
  assert.equal(recoveredTransport.directoryMapping.hostDirectory,moved);
  assert.equal(recoveredTransport.directoryMapping.guestDirectory,'/tmp/home/protected-engine/workspace');
  assert.match(recoveredTransport.directoryMapping.rootIdentity,/^[a-f0-9]{64}$/);
  assert.notEqual(recoveredTransport.directoryMapping.rootIdentity,evidence[0].directoryMapping.rootIdentity,'Moved host ownership requires a fresh measured binding');
  assert.equal(recoveredTransport.legalApproval,false);
  diagnostics.recoveryStage('session-open');
  await cdp.evaluate(`window.__legalworkControl.execute('session.open',{sessionId:${JSON.stringify(evidence[0].sessionId)}})`);
  diagnostics.recoveryStage('composer-wait');
  await until(()=>cdp.evaluate(`(()=>{const e=document.querySelector('[contenteditable="true"]');if(!e||e.innerText.trim())return false;e.focus();return true})()`),'recovered original session composer');
  const recoveryPromptStart=cdp.events.length;
  const recoveryObservation={role:'recovery',context:{sessionId:evidence[0].sessionId,workspaceId:first.id,marker:'NATIVE_RECOVERED_CWD_PROOF'}};
  diagnostics.promptStart('recovery',cdp.events,recoveryPromptStart,recoveryObservation.context);
  diagnostics.recoveryStage('prompt-insert');
  await cdp.send('Input.insertText',{text:'NATIVE_RECOVERED_CWD_PROOF'});
  diagnostics.recoveryStage('prompt-click');
  await click('Run task',recoveryObservation);
  const recoveryQueuePath=`/workspace/${first.id}/sessions/${evidence[0].sessionId}/queue`;
  const recoveryRequest=await until(()=>cdp.events.slice(recoveryPromptStart).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&new URL(e.params.request.url).pathname===recoveryQueuePath&&JSON.parse(e.params.request.postData??'{}').type==='enqueue'&&e.params.request.postData.includes('NATIVE_RECOVERED_CWD_PROOF')),'actual recovered-session native queue submission');
  await until(()=>cdp.events.slice(recoveryPromptStart).some(e=>e.method==='Network.responseReceived'&&e.params.requestId===recoveryRequest.params.requestId&&e.params.response.status===200),'recovered-session queue admission returned200');
  diagnostics.promptEnd('recovery');
  diagnostics.recoveryStage('runtime-readiness');
  // Queue admission stores intent; a restored operation must independently
  // finish its fresh native admission and cold provision before inference.
  await until(async()=>{
    const response=await engineRequest(`/session/${encodeURIComponent(evidence[0].sessionId)}/protected-transport`);
    assert.equal(response.status,200);
    const state=await response.json();
    assert.equal(state.sessionId,evidence[0].sessionId);
    assert.equal(state.directoryMapping.hostDirectory,moved);
    assert.equal(state.directoryMapping.guestDirectory,'/tmp/home/protected-engine/workspace');
    assert.equal(state.directoryMapping.rootIdentity,recoveredTransport.directoryMapping.rootIdentity);
    assert.equal(state.legalApproval,false);
    return state.runtimeState==='ready';
  },'recovered protected runtime is ready after fresh native admission and cold provision',240000);
  diagnostics.recoveryStage('fresh-poll');
  const freshRead=await until(async()=>{
    const {body}=await api(first,`sessions/${evidence[0].sessionId}/snapshot?limit=20`),item=body.item;
    const user=item?.messages.find(m=>m.info.role==='user'&&m.parts.some(p=>p.type==='text'&&p.text.includes('NATIVE_RECOVERED_CWD_PROOF')));
    const assistant=user&&item.messages.find(m=>m.info.parentID===user.info.id&&m.info.finish==='stop');
    const read=user&&item.messages.filter(m=>m.info.parentID===user.info.id).flatMap(m=>m.parts).find(p=>p.type==='tool'&&p.tool==='lawoss_documents_read'&&p.state.status==='completed');
    const tools=user&&item.messages.filter(m=>m.info.parentID===user.info.id).flatMap(m=>m.parts).filter(p=>p.type==='tool');
    return item?.status.type==='idle'&&assistant&&read?{session:item.session,user:user.info.id,read,tools}:false;
  },'real engine executes a fresh scoped document read after native reconnect',60000);
  diagnostics.recoveryStage('fresh-check');
  assert.equal(freshRead.session.directory,moved);assert.equal(freshRead.session.id,evidence[0].sessionId);
  assert.ok(evidence[0].documentIds.includes(freshRead.read.state.input.id));
  const readEvidence = decodeNativeToolOutput(freshRead.read.state.output);
  assert.equal(readEvidence.workspaceId,first.id);
  assert.equal(readEvidence.id,freshRead.read.state.input.id);
  assert.ok(evidence[0].sourceHashes.includes(readEvidence.hash),'Recovered real tool evidence still belongs to the independently hashed selected originals');
  if (corpus.mode === 'synthetic') assert.ok(readEvidence.text.includes('SYNTHETIC case 1 '),'The fresh VM tool read returns the selected synthetic source bytes');
  assert.ok(freshRead.tools.every(part=>['lawoss_documents_list','lawoss_documents_read','lawoss_documents_export','lawoss_documents_validate'].includes(part.tool)),'Recovered protected execution never invokes a general host shell or unrelated capability');
  assert.equal(await access(oldPath).then(()=>true,()=>false),false);
  extraEvidence.recoveryRead={sessionId:freshRead.session.id,messageId:freshRead.user,directory:freshRead.session.directory,directoryMapping:recoveredTransport.directoryMapping,sourceHash:readEvidence.hash,documentId:freshRead.read.state.input.id,promptRequestId:recoveryRequest.params.requestId};
  // Every output, source and project is independently reread after an actual
  // Electron shutdown and launch with the same profile, not store reconstruction.
  diagnostics.recoveryStage('retained-files');
  for(const [index,entry] of caseRuns){
    const workspace=workspaces[index];
    await hashes(entry,workspace);
    const caseEvidence=evidence.find(item=>item.workspaceId===workspace.id);
    for(const [name,hash] of Object.entries(caseEvidence.outputHashes))assert.equal(sha256(await readFile(path.join(workspace.path,name))),hash);
    const outputs=await api(workspace,'lawoss/documents/outputs');
    assert.equal(outputs.response.status,200);assert.equal(outputs.body.outputs.length,2);assert.ok(outputs.body.outputs.every(o=>o.verified&&o.hash===o.currentHash));
  }
  diagnostics.recoveryStage('verification-open');
  recoveryVerificationStart=cdp.events.length;
  recoveryRendererExpected={workspaceId:first.id,root:moved,baseUrl:serverInfo.baseUrl};
  await until(()=>cdp.evaluate(`(${recoveryRendererIdentity.toString()})(window.__legalwork?.slice('route'),${JSON.stringify(recoveryRendererExpected)}).ready`),'recovered renderer acknowledges the moved project root and current owned client');
  await openFiles(first);await click('Dokumenty');
  await until(()=>cdp.evaluate(`(()=>{const nav=[...document.querySelectorAll('[aria-label="Current folder"]')].find(e=>e.getBoundingClientRect().width>0);return nav&&[...nav.querySelectorAll('button')].slice(1).map(e=>e.textContent.trim()).join('/')==='Dokumenty'})()`),'recovered native source folder breadcrumb');
  const recoveredPrepareStart=cdp.events.length;
  await click('Prepare this folder');
  const recoveredPrepareRequest=await until(()=>cdp.events.slice(recoveredPrepareStart).find(e=>e.method==='Network.requestWillBeSent'&&e.params.request.method==='POST'&&new URL(e.params.request.url).pathname===`/workspace/${first.id}/lawoss/documents/prepare`),'recovered native preparation request for the same project');
  await until(()=>cdp.events.slice(recoveredPrepareStart).some(e=>e.method==='Network.responseReceived'&&e.params.requestId===recoveredPrepareRequest.params.requestId&&e.params.response.status===200),'recovered native preparation admission200');
  const recoveredAdmission=await until(async()=>{try{return JSON.parse((await cdp.send('Network.getResponseBody',{requestId:recoveredPrepareRequest.params.requestId})).body)}catch{return false}},'recovered native preparation response bytes');
  assert.deepEqual(recoveredAdmission.documents.map(d=>d.id).sort(),[...evidence[0].documentIds].sort(),'Repreparing unchanged recovered sources retains their original document identities');
  assert.ok(recoveredAdmission.documents.every(d=>d.status==='readable'&&d.complete),'Previously prepared unchanged recovered sources remain readable');
  await until(async()=> (await panelText()).includes('Format and sources verified'),'recovered native renderer shows actual current verification');
  diagnostics.recoveryStage('engine-info');
  const finalEngine=await cdp.evaluate("window.__LEGALWORK_ELECTRON__.invokeDesktop('engineInfo')");
  diagnostics.recoveryStage('engine-health');
  const relaunchedHealthResponse=await engineRequest('/global/health');
  assert.equal(relaunchedHealthResponse.status,200,'Relaunched workspace engine health must authenticate');
  const relaunchedHealth=await relaunchedHealthResponse.json();
  diagnostics.recoveryStage('engine-identity');
  const relaunchedEngineIdentity=await verifyNativeEngineRuntime(preparedEngine,finalEngine.opencodeBinPath,relaunchedHealth);
  engineIdentities.push({ phase: 'relaunch', ...relaunchedEngineIdentity });
  await writeFile(path.join(root,'engine-identity-receipts.json'),JSON.stringify(engineIdentities,null,2),{mode:0o600});
  diagnostics.recoveryStage('receipt-write');
  const artifacts={};
  for(const file of ['apps/server/dist/embedded.js','apps/server/dist/lawoss/documents/export.js','apps/server/dist/lawoss/workspace-history-sessions.js','apps/server/dist/opencode-plugins/legalwork-project-tools.js','apps/desktop/electron/runtime.mjs','apps/app/src/react-app/domains/session/sync/session-sync.ts'])artifacts[file]=sha256(await readFile(path.join(repo,file)));
  extraEvidence.artifactHashes=artifacts;extraEvidence.relaunchedEngineVersion=relaunchedHealth.version;
  evidence[0].recoveredPath=moved;
  await writeFile(path.join(root,'native-receipts.json'),JSON.stringify({mode:corpus.mode,fullMatrix:!debugPair,engineVersion:health.version,engineIdentities,applicationRelaunch:true,nativeReconnect:true,cases:evidence,extras:extraEvidence},null,2),{mode:0o600});
  console.log(`${debugPair?'DEBUG':'PASS'} actual application relaunch, native folder reconnect, same project/session/message IDs, all exercised original/output SHA-256`);
  diagnostics.phase("complete");
} catch (error) {
  primaryError = error;
  for(const failure of relaunchCleanupErrors)console.error('Relaunch owned cleanup failure',JSON.stringify(errorMetadata(failure)));
  const failure = diagnostics.failure(error);
  try { diagnostics.captureGenerationHostErrors(children); } catch { /* Diagnostics cannot replace the primary failure. */ }
  console.error('Primary native failure before cleanup', JSON.stringify(failure));
  await diagnostics.captureEngineLog({error,selectedDirectory:workspaces[0].path,launchWallMs:engineLogLaunchWallMs,deadlineWallMs:engineLogDeadlineWallMs}).catch(()=>undefined);
  const fetchPhases=children.filter(owner=>['electron','electron-relaunch'].includes(owner.label)).flatMap(owner=>nativeEngineFetchRecords(owner.output()).map(record=>({process:owner.label,...record}))).slice(-64);
  console.error('Owned engine fetch boundaries',JSON.stringify(fetchPhases));
  if(corpus.mode==='synthetic'&&cdp&&recoveryVerificationStart!==undefined) {
    let timer;
    try {
      const snapshot=await Promise.race([
        cdp.send('Runtime.evaluate',{returnByValue:true,timeout:5000,expression:`(()=>{
          const panels=[...document.querySelectorAll('[aria-label="Document processing"]')];
          const visible=e=>e.getBoundingClientRect().width>0&&e.getBoundingClientRect().height>0;
          const panel=panels.find(visible)??panels[0];
          const lines=[...(panel?.querySelectorAll('p')??[])].map(e=>e.textContent.trim());
          const selected=lines.find(text=>/^Selected files: \\d{1,2}$/.test(text));
          const badges=Object.fromEntries(Object.entries({verified:'Format and sources verified',checking:'Checking current sources…',invalid:'Sources changed / invalid output',edited:'Output edited / removed',generated:'Generated, unverified',complete:'Selected sources fully extracted',partial:'Partially readable / incomplete OCR',readError:'Read could not be verified',stale:'Source changed — prepare again',pending:'Preparation pending',preparing:'Preparing',readable:'Readable'}).map(([key,label])=>[key,lines.filter(text=>text===label||text.startsWith(label+' ·')||(key==='complete'&&text.endsWith(' · '+label))).length]));
          const controls=Object.fromEntries(Object.entries({prepareFolder:'Prepare this folder',prepareSelected:'Prepare selected',refresh:'Refresh status',generate:'Generate through chat',validate:'Validate saved output'}).map(([key,label])=>{const buttons=[...(panel?.querySelectorAll('button')??[])].filter(e=>e.textContent.trim()===label);return [key,{count:buttons.length,disabled:buttons.filter(e=>e.disabled||e.getAttribute('aria-disabled')==='true').length}]}));
          const folder=[...(document.querySelector('[aria-label="Current folder"]')?.querySelectorAll('button')??[])].slice(1).map(e=>e.textContent.trim()).join('/');
          const identity=(${recoveryRendererIdentity.toString()})(window.__legalwork?.slice('route'),${JSON.stringify(recoveryRendererExpected)});
          return {identity,visibility:document.visibilityState,focused:document.hasFocus(),viewportWidth:innerWidth,viewportHeight:innerHeight,panelCount:panels.length,visiblePanelCount:panels.filter(visible).length,firstPanelVisible:Boolean(panels[0]&&visible(panels[0])),firstPanelVerified:Boolean(panels[0]?.innerText.includes('Format and sources verified')),visible:Boolean(panel&&visible(panel)),folderMatches:folder==='Dokumenty',selectedFiles:selected?Number(selected.split(': ')[1]):null,alerts:panel?.querySelectorAll('[role="alert"]').length??0,badges,controls};
        })()`}).then(result=>result.result?.value??null).catch(()=>null),
        new Promise(resolve=>{timer=setTimeout(()=>resolve(null),5000)}),
      ]);
      console.error('Owned recovery verification state',JSON.stringify({capture:snapshot?'captured':'unavailable',...summarizeRecoveryVerification(snapshot,cdp.events.slice(recoveryVerificationStart))}));
    } catch { /* Failure diagnostics must preserve the primary native error. */ }
    finally {clearTimeout(timer);}
  }
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
