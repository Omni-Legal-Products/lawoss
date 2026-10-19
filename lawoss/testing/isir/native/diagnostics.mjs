import * as fs from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TextDecoder } from 'node:util';

// This is an allowlist projection, never a dump or regex redaction of raw CDP,
// URLs, error messages, headers, child output, user paths or provider payloads.
export function errorMetadata(error, depth = 0) {
  const names = ['Error','TypeError','AssertionError','AggregateError','TimeoutError','AbortError'];
  const codes = ['EPERM','ESRCH','ENOENT','EBUSY','ECONNREFUSED','ECONNRESET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_CONNECT_TIMEOUT','ERR_ASSERTION','ISIR_NATIVE_WAIT_EXPIRED'];
  return { name: names.includes(error?.name) ? error.name : 'Error',
    ...(codes.includes(error?.code) ? {code:error.code} : {}),
    ...(depth < 3 && error?.cause ? {cause:errorMetadata(error.cause,depth+1)} : {}) };
}
function endpoint(url) {
  let parsed;try { parsed=new URL(url); } catch { return 'other'; }
  const {pathname}=parsed;
  if (/\/lawoss\/documents\/prepare$/.test(pathname)) return 'documents.prepare';
  if (/\/lawoss\/documents(?:\/.*)?$/.test(pathname)) return 'documents';
  if (pathname==='/sync/events') return 'app-sync';
  if (/\/workspace\/[^/]+\/events$/.test(pathname)) return 'reload-poll';
  if (/\/workspace\/[^/]+\/.*\bevent$/.test(pathname)) return 'scoped-workspace-engine';
  if (pathname==='/event') return parsed.searchParams.has('directory')||parsed.searchParams.has('workspace')?'scoped-workspace-engine':'unscoped-engine';
  if (/\/prompt_async$/.test(pathname)) return 'prompt';
  if (/\/sessions?\/[^/]+\/snapshot$/.test(pathname)) return 'snapshot';
  if (/\/files\/(?:list|raw|content)$/.test(pathname)) return 'files';
  const fixed = new Map([['/path','engine.path'],['/global/health','engine.health'],['/provider','provider'],['/instance/dispose','engine.dispose'],['/auth/isir-native','synthetic.auth'],['/json/list','cdp.targets'],['/experimental/session','engine.sessions'],['/','ui']]);
  const enginePath=pathname.replace(/^\/workspace\/[^/]+\/opencode(?=\/|$)/,'');
  if(fixed.has(enginePath))return fixed.get(enginePath);
  if (/\/workspace\/[^/]+\/engine\/reload$/.test(pathname))return 'engine.reload';
  if (/\/workspace\/[^/]+\/config$/.test(pathname))return 'workspace.config';
  if (/\/workspace\/[^/]+\/engine\/reload$/.test(pathname))return 'workspace.reload';
  return 'other';
}
function rendererCategory(url) {
  let pathname;try { pathname=new URL(url).pathname; } catch { return null; }
  if(pathname.includes('/node_modules/')||pathname.startsWith('/@id/'))return 'dependency';
  if(pathname.startsWith('/src/'))return 'source';
  if(pathname.startsWith('/assets/'))return 'asset';
  if(pathname==='/'||pathname==='/index.html'||pathname.startsWith('/@vite/')||pathname.startsWith('/@fs/')||pathname==='/@react-refresh')return 'internal';
  return null;
}
// Self-contained so the owned CDP page compares actual published renderer state
// in place; callers receive only fixed booleans, never paths or capabilities.
export function recoveryRendererIdentity(snapshot, expected = {}) {
  expected ??= {};
  const origin=value=>{
    if(typeof value!=='string')return null;
    try {const url=new URL(value);return url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port&&!url.username&&!url.password&&!url.search&&!url.hash&&url.pathname==='/'?url.origin:null;}catch{return null;}
  };
  const valid=typeof expected.workspaceId==='string'&&expected.workspaceId.length>0&&typeof expected.root==='string'&&expected.root.length>0;
  const expectedOrigin=origin(expected.baseUrl);
  const matches=Array.isArray(snapshot?.workspaces)?snapshot.workspaces.filter(workspace=>workspace?.id===expected.workspaceId):[];
  const identity={present:Boolean(snapshot&&typeof snapshot==='object'&&!Array.isArray(snapshot)),selectedWorkspace:Boolean(valid&&snapshot?.selectedWorkspaceId===expected.workspaceId),workspaceRoot:Boolean(valid&&matches.length===1&&matches[0].path===expected.root),serverOrigin:Boolean(expectedOrigin&&origin(snapshot?.baseUrl)===expectedOrigin),connected:snapshot?.connected===true,idle:snapshot?.loading===false,workspaceSettled:Boolean(valid&&Array.isArray(snapshot?.retryingWorkspaceIds)&&snapshot.retryingWorkspaceIds.every(id=>typeof id==='string')&&!snapshot.retryingWorkspaceIds.includes(expected.workspaceId))};
  return {...identity,ready:Object.values(identity).every(value=>value===true)};
}
export function summarizeRecoveryVerification(snapshot = {}, events = []) {
  const count=value=>Number.isInteger(value)&&value>=0&&value<=10_000?value:0;
  const boolean=value=>typeof value==='boolean'?value:null;
  const badges=Object.fromEntries(['verified','checking','invalid','edited','generated','complete','partial','readError','stale','pending','preparing','readable'].map(key=>[key,count(snapshot?.badges?.[key])]));
  const controls=Object.fromEntries(['prepareFolder','prepareSelected','refresh','generate','validate'].map(key=>[key,{count:count(snapshot?.controls?.[key]?.count),disabled:count(snapshot?.controls?.[key]?.disabled)}]));
  const identity=Object.fromEntries(['present','selectedWorkspace','workspaceRoot','serverOrigin','connected','idle','workspaceSettled','ready'].map(key=>[key,boolean(snapshot?.identity?.[key])]));
  const panel={visibility:['visible','hidden'].includes(snapshot?.visibility)?snapshot.visibility:'unknown',focused:boolean(snapshot?.focused),viewport:{width:count(snapshot?.viewportWidth),height:count(snapshot?.viewportHeight)},panelCount:count(snapshot?.panelCount),visiblePanelCount:count(snapshot?.visiblePanelCount),firstPanelVisible:boolean(snapshot?.firstPanelVisible),firstPanelVerified:boolean(snapshot?.firstPanelVerified),visible:boolean(snapshot?.visible),folderMatches:boolean(snapshot?.folderMatches),selectedFiles:Number.isInteger(snapshot?.selectedFiles)&&snapshot.selectedFiles>=0&&snapshot.selectedFiles<=20?snapshot.selectedFiles:null,alerts:count(snapshot?.alerts),badges,controls};
  const requests=Object.fromEntries(['sources','read','outputs','prepare'].map(key=>[key,{started:0,pending:0,finished:0,failed:0,httpOk:0,httpFailure:0,maxElapsedMs:0,maxHeadersMs:0}]));
  const pending=new Map();let latest=0;
  const elapsed=(end,start)=>Math.min(300_000,Math.max(0,Math.round((end-start)*1000)));
  for(const event of events) {
    const p=event.params??{};
    if(event.method?.startsWith('Network.')&&Number.isFinite(p.timestamp))latest=Math.max(latest,p.timestamp);
    if(event.method==='Network.requestWillBeSent') {
      let category;
      try {
        const url=new URL(p.request?.url);
        if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||!url.port)continue;
        const route=url.pathname.replace(/^\/workspace\/[^/]+/,'');
        if(p.request?.method==='GET')category=route==='/lawoss/documents'?'sources':route==='/lawoss/documents/outputs'?'outputs':/^\/lawoss\/documents\/[^/]+\/read$/.test(route)?'read':null;
        else if(p.request?.method==='POST'&&route==='/lawoss/documents/prepare')category='prepare';
      } catch { continue; }
      if(category)pending.set(p.requestId,{category,started:Number.isFinite(p.timestamp)?p.timestamp:latest,headers:null,ended:null,state:'pending',status:null});
    }
    const request=pending.get(p.requestId);if(!request)continue;
    if(event.method==='Network.responseReceived'){request.status=p.response?.status;request.headers=Number.isFinite(p.timestamp)?p.timestamp:latest;}
    if(event.method==='Network.loadingFinished'||event.method==='Network.loadingFailed'){request.state=event.method==='Network.loadingFinished'?'finished':'failed';request.ended=Number.isFinite(p.timestamp)?p.timestamp:latest;}
  }
  for(const request of pending.values()) {
    const result=requests[request.category];result.started++;result[request.state]++;
    if(Number.isInteger(request.status)){if(request.status>=200&&request.status<300)result.httpOk++;else result.httpFailure++;}
    result.maxElapsedMs=Math.max(result.maxElapsedMs,elapsed(request.ended??latest,request.started));
    if(request.headers!==null)result.maxHeadersMs=Math.max(result.maxHeadersMs,elapsed(request.headers,request.started));
  }
  return {panel,identity,requests};
}
export function summarizeNetwork(events) {
  const active=new Map(),origins=new Map(),loaders=new Map();
  const aggregates=new Map(),exceptions=new Map(),categories=new Map();
  const rendererCount=(entry,amount)=>{
    if(!entry.category)return;
    if(!categories.has(entry.category))categories.set(entry.category,categories.size);
    const statusFamily=entry.status===null?'none':entry.status>=100&&entry.status<600?`${Math.floor(entry.status/100)}xx`:'other';
    const key=JSON.stringify([entry.category,statusFamily,entry.state]);
    const aggregate=aggregates.get(key)??{category:entry.category,statusFamily,state:entry.state,count:0};
    aggregate.count+=amount;
    aggregates.set(key,aggregate);
  };
  const counts=()=>({total:0,pending:0,streams:0});
  const all=counts();let current=counts(),currentRows=[],historyRows=[];
  let latest=0,epoch=0,mainFrame=null,mainLoader=null,trackingDropped=0,http500Count=0;
  const retain=(rows,entry)=>{
    rows.push(entry);
    if(rows.length>128){const finished=rows.findIndex(row=>row.state!=='pending');rows.splice(finished<0?0:finished,1);}
  };
  const adjust=(entry,key,amount)=>{all[key]+=amount;if(entry.epoch===epoch)current[key]+=amount;};
  const finish=(entry,state)=>{
    if(entry.state!=='pending')return;
    adjust(entry,'pending',-1);if(entry.stream)adjust(entry,'streams',-1);
    rendererCount(entry,-1);entry.state=state;entry.ended=latest;rendererCount(entry,1);
  };
  const documentEpoch=(loader,frame)=>{
    if(!loader)return;
    if(mainLoader!==null&&loader!==mainLoader){
      epoch++;for(const row of currentRows)retain(historyRows,row);
      currentRows=[];current=counts();
    }
    mainLoader=loader;mainFrame=frame??mainFrame;loaders.set(loader,epoch);
    if(loaders.size>128)loaders.delete(loaders.keys().next().value);
  };
  for(const event of events) {
    const p=event.params??{};
    // Runtime timestamps are epoch milliseconds; Network uses monotonic seconds.
    if(event.method.startsWith('Network.')&&Number.isFinite(p.timestamp))latest=Math.max(latest,p.timestamp);
    if(event.method==='Runtime.exceptionThrown'){
      const supplied=p.exceptionDetails?.exception?.className;
      const name=['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','URIError','AggregateError','DOMException'].includes(supplied)?supplied:'Error';
      exceptions.set(name,(exceptions.get(name)??0)+1);
    }
    if(event.method==='Page.frameNavigated'&&!p.frame?.parentId)documentEpoch(p.frame?.loaderId,p.frame?.id);
    if(event.method==='Network.requestWillBeSent') {
      if(p.type==='Document'&&(!mainFrame||p.frameId===mainFrame))documentEpoch(p.loaderId,p.frameId);
      else if(mainLoader===null&&p.loaderId)documentEpoch(p.loaderId,p.frameId);
      let origin=null,workspaceIndex=null;
      try {
        const url=new URL(p.request?.url);
        if(!origins.has(url.origin)&&origins.size<64)origins.set(url.origin,origins.size+1);
        origin=origins.get(url.origin)??null;
        const match=url.pathname.match(/\/workspace\/ws_native_(\d+)(?:\/|$)/);
        if(match)workspaceIndex=Number(match[1]);
      }catch{}
      const previous=active.get(p.requestId);
      if(previous&&p.redirectResponse){
        rendererCount(previous,-1);previous.status=Number.isInteger(p.redirectResponse.status)?p.redirectResponse.status:null;rendererCount(previous,1);finish(previous,'redirected');
      }
      const entry={category:rendererCategory(p.request?.url),endpoint:endpoint(p.request?.url),origin,workspaceIndex,epoch:loaders.get(p.loaderId)??epoch,status:null,state:'pending',stream:false,started:Number.isFinite(p.timestamp)?p.timestamp:latest};
      rendererCount(entry,1);
      adjust(entry,'total',1);adjust(entry,'pending',1);
      retain(entry.epoch===epoch?currentRows:historyRows,entry);active.set(p.requestId,entry);
      // Bounded temporary correlation storage; expose loss rather than claiming
      // terminal observations for entries whose request IDs were evicted.
      if(active.size>4096){active.delete(active.keys().next().value);trackingDropped++;}
    }
    if(!event.method.startsWith('Network.'))continue;
    const entry=active.get(p.requestId);if(!entry)continue;
    if(event.method==='Network.responseReceived') {
      if(entry.category&&p.response?.status===500)http500Count++;
      rendererCount(entry,-1);entry.status=Number.isInteger(p.response?.status)?p.response.status:null;rendererCount(entry,1);
      const stream=p.response?.mimeType==='text/event-stream';
      if(stream!==entry.stream&&entry.state==='pending')adjust(entry,'streams',stream?1:-1);
      entry.stream=stream;
    }
    if(event.method==='Network.loadingFinished'||event.method==='Network.loadingFailed'){
      finish(entry,event.method==='Network.loadingFinished'?'finished':'failed');active.delete(p.requestId);
    }
  }
  const project=rows=>rows.map(({started,ended,category,...request})=>({...request,ageMs:Math.max(0,Math.round(((ended??latest)-started)*1000))}));
  const history=Object.fromEntries(Object.keys(all).map(key=>[key,all[key]-current[key]]));
  // Historical pending means no terminal CDP event was observed, not a live socket.
  return {epoch,...current,trackingDropped,requests:project(currentRows),history:{...history,requests:project(historyRows)},renderer:{network:[...aggregates.values()].filter(row=>row.count).sort((a,b)=>categories.get(a.category)-categories.get(b.category)),http500Count,exceptions:[...exceptions].map(([name,count])=>({name,count}))}};
}
// Runs only inside the existing successful click evaluation. The inspector is
// effect-published and can lag React; these are observations, never readiness or
// causal assertions. Missing/mismatched/inconsistent slices leave state unknown.
export function observePromptClick(context, selected) {
  const result={slicePresent:null,sessionMatches:null,workspaceMatches:null,markerInDraft:null,draftEmpty:null,attachmentsPresent:null,sending:null,errorPresent:null,editorCount:null,markerInEditor:null,focusInside:null,selectionInside:null,nativeButton:null,disabled:null,ariaDisabled:null,uniqueMatch:null};
  try {
    const slice=window.__legalwork?.slice?.('composer');
    result.slicePresent=!!slice;
    if(slice){
      result.sessionMatches=typeof slice.sessionId==='string'?slice.sessionId===context.sessionId:null;
      result.workspaceMatches=typeof slice.workspaceId==='string'?slice.workspaceId===context.workspaceId:null;
      if(result.sessionMatches===true&&result.workspaceMatches===true&&typeof slice.draft==='string'&&slice.draftLength===slice.draft.length){
        result.markerInDraft=slice.draft.includes(context.marker);result.draftEmpty=slice.draft.length===0;
        result.attachmentsPresent=Array.isArray(slice.attachments)?slice.attachments.length>0:null;
        result.sending=typeof slice.sending==='boolean'?slice.sending:null;
        result.errorPresent=slice.error===null?false:typeof slice.error==='object'&&slice.error!==null?true:typeof slice.error==='string'?slice.error.length>0:null;
      }
    }
  }catch{}
  try {
    const editors=document.querySelectorAll('[contenteditable="true"]'),editor=editors[0];
    result.editorCount=editors.length===0?'0':editors.length===1?'1':'many';
    if(editor){
      result.markerInEditor=typeof editor.innerText==='string'?editor.innerText.includes(context.marker):null;
      result.focusInside=editor.contains(document.activeElement);
      const selection=window.getSelection();
      result.selectionInside=selection?editor.contains(selection.anchorNode)&&editor.contains(selection.focusNode):null;
    }
    result.nativeButton=selected.tagName==='BUTTON';result.disabled=typeof selected.disabled==='boolean'?selected.disabled:null;
    const aria=selected.getAttribute('aria-disabled');result.ariaDisabled=aria===null?false:aria==='true'?true:aria==='false'?false:null;
    result.uniqueMatch=[...document.querySelectorAll('button,a,[role="button"],[role="menuitem"],[role="option"]')].filter(e=>e.textContent.trim()===selected.textContent.trim()&&e.getBoundingClientRect().width>0&&!e.disabled).length===1;
  }catch{}
  return result;
}
function projectPromptClick(value){
  if(!value)return null;
  const result={};
  for(const key of ['slicePresent','sessionMatches','workspaceMatches','markerInDraft','draftEmpty','attachmentsPresent','sending','errorPresent','editorCount','markerInEditor','focusInside','selectionInside','nativeButton','disabled','ariaDisabled','uniqueMatch']){
    result[key]=key==='editorCount'?['0','1','many'].includes(value[key])?value[key]:null:typeof value[key]==='boolean'?value[key]:null;
  }
  return result;
}
// Same captured event interval and original wait budget; no postData fetches.
// Private IDs correlate at most128 requests; counters cap128 and scanning8192.
export function summarizePromptEvents(events,context,start=0,end=events.length){
  const statuses=()=>({unknown:0,informational:0,success:0,redirect:0,clientError:0,serverError:0});
  const prompt={count:0,originalSuffix:0,queryPresent:0,sessionMatch:0,sessionMismatch:0,workspaceMatch:0,workspaceMismatch:0,workspaceUnknown:0,bodyKnown:0,bodyUnknown:0,bodyOversized:0,inlineMarker:0,jsonValid:0,jsonInvalid:0,jsonTextMarker:0,loadingFailed:0,responses:statuses()};
  const restore={attempted:0,responses:statuses(),loadingFailed:0};
  const count=(row,key)=>{row[key]=Math.min(128,row[key]+1);};
  start=Math.max(0,Math.min(events.length,start));end=Math.max(start,Math.min(events.length,end));
  const limit=Math.min(end,start+8192),active=new Map();
  const result={scannedEvents:limit-start,droppedEvents:Math.min(2147483647,end-limit),correlationDropped:0,anyPost:0,prompt,restore};
  const finish=entry=>{count(entry.row.responses,entry.status);if(entry.failed)count(entry.row,'loadingFailed');};
  for(let i=start;i<limit;i++){
    const event=events[i],p=event.params??{};
    if(event.method==='Network.requestWillBeSent'){
      const previous=active.get(p.requestId);
      if(previous){finish(previous);active.delete(p.requestId);}
      const request=p.request??{};if(request.method==='POST')count(result,'anyPost');
      let url;try{url=new URL(request.url);}catch{continue;}
      const queued=url.pathname.match(/^\/workspace\/([^/]+)\/sessions\/([^/]+)\/queue$/);
      const match=queued??url.pathname.match(/^(?:\/workspace\/([^/]+)\/opencode)?\/session\/([^/]+)(\/prompt_async)?$/);
      if(!match)continue;
      let row;
      if(request.method==='POST'&&(queued||match[3])){
        row=prompt;count(row,'count');
        if(request.url.endsWith('/prompt_async'))count(row,'originalSuffix');
        if(url.search.length)count(row,'queryPresent');
        count(row,match[2]===context.sessionId?'sessionMatch':'sessionMismatch');
        count(row,match[1]===undefined?'workspaceUnknown':match[1]===context.workspaceId?'workspaceMatch':'workspaceMismatch');
        const body=request.postData;
        if(typeof body!=='string'||body.length>65536){count(row,'bodyUnknown');if(typeof body==='string')count(row,'bodyOversized');}
        else{
          count(row,'bodyKnown');if(body.includes(context.marker))count(row,'inlineMarker');
          try{
            const parsed=JSON.parse(body);count(row,'jsonValid');
            const parts=queued?(parsed?.type==='enqueue'&&parsed.execution?.kind==='prompt'?parsed.execution.parts:null):parsed?.parts;
            if(Array.isArray(parts)&&parts.some(part=>part?.type==='text'&&typeof part.text==='string'&&part.text.includes(context.marker)))count(row,'jsonTextMarker');
          }catch{count(row,'jsonInvalid');}
        }
      }else if(request.method==='PATCH'&&!match[3]&&match[2]===context.sessionId&&(match[1]===undefined||match[1]===context.workspaceId)){
        row=restore;count(row,'attempted');
      }else continue;
      if(typeof p.requestId!=='string'){count(row.responses,'unknown');continue;}
      active.set(p.requestId,{row,status:'unknown',failed:false});
      if(active.size>128){const key=active.keys().next().value;finish(active.get(key));active.delete(key);count(result,'correlationDropped');}
    }else{
      const entry=active.get(p.requestId);if(!entry)continue;
      if(event.method==='Network.responseReceived'){
        const status=p.response?.status;
        entry.status=Number.isInteger(status)&&status>=100&&status<600?['informational','success','redirect','clientError','serverError'][Math.floor(status/100)-1]:'unknown';
      }
      if(event.method==='Network.loadingFailed'||event.method==='Network.loadingFinished'){
        entry.failed=event.method==='Network.loadingFailed';finish(entry);active.delete(p.requestId);
      }
    }
  }
  for(const entry of active.values())finish(entry);
  return result;
}
export async function settleCleanup(primary, operations) {
  const failures=[];
  for(const operation of operations)try {await operation();}catch(error){failures.push(error);}
  return {error:primary??(failures.length?new AggregateError(failures,'Owned native cleanup failed'):null),failures};
}
// Pinned engine v1.18.29 default file format, not a raw-log redactor. The
// logger batches writes: missing markers never establish an unreached stage.
const LOG_BYTES=256*1024,LOG_LINE_BYTES=16*1024,LOG_LINES=4096,LOG_EVENTS=64;
const bounded=value=>Math.min(Number.MAX_SAFE_INTEGER,Math.max(0,Math.trunc(value)));
const emptyEngineLog=(status='disabled')=>({status,clockWindowValid:false,correlation:'unavailable',absenceInconclusive:true,bytesRead:0,unscannedBytesAtOpen:0,fileChanged:false,scannedLines:0,oversizedLineCount:0,partialLineCount:0,malformedCount:0,unknownCount:0,timestampOutlierCount:0,otherDirectoryCount:0,runCount:0,directoryCount:0,ambiguous:false,lineLimitReached:false,eventLimitReached:false,droppedEvents:0,events:[]});
function directoryKey(value,platform=process.platform){
  const paths=platform==='win32'?path.win32:path.posix;
  if(typeof value!=='string'||!paths.isAbsolute(value))return null;
  const normalized=paths.normalize(value);
  return platform==='win32'?normalized.replace(/\\/g,'/').replace(/\/+$/,'').toLowerCase():normalized.replace(/\/+$/,'');
}
const directoryMarkers=new Map([
  ['creating instance','instance.create-observed'],['fromDirectory','project.resolve-observed'],
  ['bootstrapping','bootstrap.enter-observed'],['reloading instance','instance.reload-observed'],['disposing instance','instance.dispose-observed'],
]);
const engineMarkers=new Map([
  ['INFO:loading','config.read-observed'],['INFO:all LSPs are disabled','post-plugin.lsp-observed'],
  ['INFO:enabled LSP servers','post-plugin.lsp-observed'],['INFO:all formatters are disabled','post-plugin.format-observed'],
  ['WARN:background dependency install failed','config.dependency-error-observed'],
  ['ERROR:failed to load global config, using defaults','config.global-error-observed'],
  ['ERROR:failed to load internal plugin','plugin.internal-error-observed'],['ERROR:failed to load plugin','plugin.apply-error-observed'],
  ['ERROR:plugin config hook failed','plugin.config-error-observed'],['WARN:init failed','bootstrap.service-error-observed'],
]);
function parseEngineRecord(line){
  const fields=new Map();let offset=0;
  while(offset<line.length){
    const key=/^[^\s="\\]+=/u.exec(line.slice(offset));if(!key)return null;
    const name=key[0].slice(0,-1);offset+=key[0].length;
    let value;
    if(line[offset]==='"'){
      const start=offset++;let closed=false;
      while(offset<line.length){
        if(line[offset]==='\\'){offset+=2;continue;}
        if(line[offset++]==='"'){closed=true;break;}
      }
      if(!closed)return null;
      try{value=JSON.parse(line.slice(start,offset));}catch{return null;}
      if(typeof value!=='string')return null;
    }else{
      const plain=/^[^\s="\\]+/u.exec(line.slice(offset));if(!plain)return null;
      value=plain[0];offset+=value.length;
    }
    // Duplicate fields can disguise reserved data or scope. Reject the whole
    // record, even when the engine's flattening could have produced the clash.
    if(fields.has(name))return null;
    fields.set(name,value);
    if(offset<line.length&&(line[offset++]!==' '||offset===line.length))return null;
  }
  if(!['timestamp','level','run'].every((key,i)=>[...fields.keys()][i]===key)||!fields.has('message')||!fields.get('run'))return null;
  if(!['TRACE','DEBUG','INFO','WARN','ERROR','FATAL'].includes(fields.get('level')))return null;
  const timestamp=fields.get('timestamp');
  if(!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(timestamp)||!Number.isFinite(Date.parse(timestamp))||new Date(timestamp).toISOString()!==timestamp)return null;
  return fields;
}
// Exported pure projection also exercises Windows path normalization on POSIX.
// All dynamic values/keys remain private and are discarded after bounded input.
export function projectEngineLog(bytes,{selectedDirectory,launchWallMs,deadlineWallMs,captureWallMs,platform=process.platform}){
  bytes=bytes.subarray(0,LOG_BYTES);
  const result=emptyEngineLog('available');
  const selected=directoryKey(selectedDirectory,platform);
  result.clockWindowValid=[launchWallMs,deadlineWallMs,captureWallMs].every(Number.isSafeInteger)&&launchWallMs>0&&deadlineWallMs>=launchWallMs&&deadlineWallMs-launchWallMs<=600000&&captureWallMs>=launchWallMs;
  if(!result.clockWindowValid||selected===null){result.status='unavailable';return result;}
  const runs=new Set(),directories=new Set();let offset=0;
  while(offset<bytes.length&&result.scannedLines<LOG_LINES){
    const end=bytes.indexOf(10,offset);
    if(end<0){result.partialLineCount++;break;}
    result.scannedLines++;
    const length=end-offset;
    if(length>LOG_LINE_BYTES){result.oversizedLineCount++;offset=end+1;continue;}
    let fields;
    try{fields=parseEngineRecord(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(offset,end)));}catch{fields=null;}
    offset=end+1;
    if(!fields){result.malformedCount++;continue;}
    const time=Date.parse(fields.get('timestamp'));
    if(time<launchWallMs||time>Math.min(deadlineWallMs,captureWallMs)){result.timestampOutlierCount++;continue;}
    runs.add(fields.get('run'));
    const directory=directoryKey(fields.get('directory'),platform);
    if(directory!==null)directories.add(directory);
    const message=fields.get('message'),level=fields.get('level');
    let event=level==='INFO'?directoryMarkers.get(message):undefined,evidenceScope='selected-directory';
    if(event){
      if(directory===null){result.unknownCount++;continue;}
      if(directory!==selected){result.otherDirectoryCount++;continue;}
    }else{event=engineMarkers.get(`${level}:${message}`);evidenceScope='engine-run';}
    if(!event){result.unknownCount++;continue;}
    if(result.events.length<LOG_EVENTS)result.events.push({event,evidenceScope});
    else result.droppedEvents++;
  }
  result.lineLimitReached=result.scannedLines===LOG_LINES&&offset<bytes.length;
  result.eventLimitReached=result.droppedEvents>0;
  result.runCount=runs.size;result.directoryCount=directories.size;
  result.ambiguous=runs.size>1||directories.size>1;
  return result;
}
function ownedRootShape(root){
  return typeof root==='string'&&path.isAbsolute(root)&&path.normalize(root)===root&&/^lawoss-isir-native-[a-z0-9]+$/i.test(path.basename(root));
}
function within(root,value){const relative=path.relative(root,value);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);}
const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.uid===b.uid;
function failedEngineLog(error,metadata={}){
  const status=error?.code==='ENOENT'?'missing':['UNSAFE','ELOOP'].includes(error?.code)?'unsafe':'unreadable';
  return {...emptyEngineLog(status),...metadata,clockWindowValid:true};
}
async function readOwnedEngineLog(io,root,context){
  const unsafe=()=>Object.assign(new Error(),{code:'UNSAFE'});
  const file=path.join(root,'profile/legalwork-dev-data/xdg/data/opencode/log/opencode.log');
  const parts=['', 'profile','legalwork-dev-data','xdg','data','opencode','log','opencode.log'];
  async function inspect(){
    const snapshots=[];let current=root;
    for(let i=0;i<parts.length;i++){
      if(i)current=path.join(current,parts[i]);
      const stat=await io.lstat(current,{bigint:true});
      if(stat.isSymbolicLink()||(i===parts.length-1?!stat.isFile():!stat.isDirectory())||await io.realpath(current)!==current)throw unsafe();
      if(i===0&&typeof process.getuid==='function'&&stat.uid!==BigInt(process.getuid()))throw unsafe();
      if(typeof stat.ino!=='bigint'||stat.ino<=0n||typeof stat.dev!=='bigint'||i&&(stat.dev!==snapshots[0].dev||stat.uid!==snapshots[0].uid))throw unsafe();
      snapshots.push(stat);
    }
    return snapshots;
  }
  const metadata={bytesRead:0,unscannedBytesAtOpen:0,fileChanged:false};let handle,result;
  try{
    // The root is the harness's canonical mkdtemp allocation, never an arbitrary
    // user-supplied log path. Canonical temp parent and ownership bind it.
    if(path.dirname(root)!==await io.realpath(tmpdir()))throw unsafe();
    const before=await inspect();
    // O_NOFOLLOW/NONBLOCK prevent POSIX link/FIFO replacement at open. Windows
    // junctions are rejected by lstat+realpath; fd and component identities are
    // revalidated before and after the single read, without retry/following.
    // Node cannot identify arbitrary non-link provider reparse tags; this is
    // evidence capture from the fresh owned fixture, not an app security fix.
    const flags=constants.O_RDONLY|(process.platform==='win32'?0:constants.O_NOFOLLOW|constants.O_NONBLOCK);
    handle=await io.open(file,flags);
    const opened=await handle.stat({bigint:true});
    if(!opened.isFile()||!sameFile(before.at(-1),opened))throw unsafe();
    const checked=await inspect();
    if(!before.every((stat,i)=>sameFile(stat,checked[i])))throw unsafe();
    const buffer=Buffer.alloc(Number(opened.size>BigInt(LOG_BYTES)?BigInt(LOG_BYTES):opened.size));
    const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
    metadata.bytesRead=bytesRead;metadata.unscannedBytesAtOpen=bounded(Number(opened.size-BigInt(bytesRead)));
    const after=await handle.stat({bigint:true}),final=await inspect();
    if(!sameFile(opened,after)||!before.every((stat,i)=>sameFile(stat,final[i])))throw unsafe();
    metadata.fileChanged=opened.size!==after.size||opened.mtimeNs!==after.mtimeNs||opened.ctimeNs!==after.ctimeNs;
    result={...projectEngineLog(buffer.subarray(0,bytesRead),context),...metadata};
  }catch(error){
    if(error?.code==='UNSAFE'&&metadata.bytesRead>0)metadata.fileChanged=true;
    result=failedEngineLog(error,metadata);
  }finally{
    try{await handle?.close();}catch(error){result=failedEngineLog(error,metadata);}
  }
  return result;
}
function generationErrorShape(result) {
  const unknown=category=>({category,shape:'unknown',name:null,code:null});
  const record=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
  const fields=(value,required,optional=[])=>record(value)&&Object.keys(value).every(key=>[...required,...optional].includes(key))&&required.every(key=>Object.hasOwn(value,key));
  const strings=(value,required,optional=[])=>fields(value,required,optional)&&[...required,...optional.filter(key=>Object.hasOwn(value,key))].every(key=>typeof value[key]==='string');
  if(!fields(result,['body','base64Encoded'])||typeof result.body!=='string'||typeof result.base64Encoded!=='boolean')return unknown('unknown');
  const maximum=64*1024;
  if(result.body.length>(result.base64Encoded?Math.ceil(maximum/3)*4:maximum))return unknown('oversized');
  let text=result.body;
  if(result.base64Encoded){
    const bytes=Buffer.from(text,'base64');
    if(bytes.length>maximum)return unknown('oversized');
    if(bytes.toString('base64')!==text)return unknown('unknown');
    try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return unknown('unknown');}
  }else if(Buffer.byteLength(text)>maximum)return unknown('oversized');
  let value;try{value=JSON.parse(text);}catch{return unknown('unknown');}
  // Structural labels only: a guest can emit a host-shaped envelope. These
  // discriminators identify no authenticated origin and establish no cause.
  if(strings(value,['code','message'])&&value.code==='internal_error')
    return {category:'recognized',shape:'host-error-envelope',name:null,code:'internal_error'};
  // Pinned HTTP error middleware/SDK shapes, not arbitrary assistant errors.
  if(fields(value,['name','data'])&&value.name==='UnknownError'&&strings(value.data,['message'],['ref']))
    return {category:'recognized',shape:'engine-error-envelope',name:'UnknownError',code:null};
  if(fields(value,['_tag'])&&value._tag==='InternalServerError')
    return {category:'recognized',shape:'engine-error-envelope',name:'InternalServerError',code:null};
  if(strings(value,['_tag','message'],['ref'])&&value._tag==='UnknownError')
    return {category:'recognized',shape:'engine-error-envelope',name:'UnknownError',code:null};
  if(strings(value,['_tag','message'],['service'])&&value._tag==='ServiceUnavailableError')
    return {category:'recognized',shape:'engine-error-envelope',name:'ServiceUnavailableError',code:null};
  return unknown('unknown');
}

function generationHostError(lines,index) {
  const first=lines[index],names=['Error','TypeError','RangeError','SyntaxError','TimeoutError','AbortError','ZodError'];
  const name=/^(\w+)(?::| \[)/.exec(first)?.[1];
  const dom=/^DOMException \[(TimeoutError|AbortError)\]:/.exec(first)?.[1];
  const result={category:'unknown',name:dom??(names.includes(name)?name:'Error'),code:null,phase:null,frames:[]};
  if(first==='Error: Too many protected engine requests.')result.category='engine-capacity';
  else if(first==='Error: Private protected engine request failed')result.category='guest-rpc-failed';
  else if(first==='Error: Protected engine command queue is full.')result.category='command-queue-full';
  else {
    const worker=/^Error: Protected engine worker exited \(-?\d{1,3}, phase (bundle|copy-executable|restore-checkpoint|start-engine|engine-health|engine-initialization|publish-ready|serve|unknown), health (?:unobserved|http-refused|invalid-health|version-mismatch|accepted|unreachable|unknown), initialization (?:unobserved|pending|provider-invalid|agent-invalid|tool-schema-invalid|http-refused|invalid-json|timeout|aborted|ready|unknown)\)\.$/.exec(first);
    const code=/^Error: (ENOENT|EACCES|EPERM|EIO|ENOSPC|EBUSY|EMFILE|ENFILE|EROFS):/.exec(first)?.[1];
    if(worker){result.category='worker-exited';result.phase=worker[1];}
    else if(code){result.category='filesystem';result.code=code;}
    else if(result.name==='ZodError')result.category='schema-invalid';
    else if(result.name==='SyntaxError')result.category='syntax-error';
    else if(result.name==='TimeoutError')result.category='timeout';
    else if(result.name==='AbortError')result.category='aborted';
  }
  if(!names.includes(name)&&!dom)return result;
  for(let i=index+1;i<lines.length&&/^\s+at /.test(lines[i]);i++) {
    const frame=/(?:^|[/\\])(embedded\.js|lawoss[/\\]protected-ai[/\\](?:runtime|vm-engine|bundle|transport|persisted-state|document-tools)\.js|apps[/\\]server[/\\]src[/\\]lawoss[/\\]protected-ai[/\\](?:runtime|vm-engine|bundle|transport|persisted-state|document-tools)\.ts):(\d{1,7}):(\d{1,7})\)?$/.exec(lines[i]);
    if(!frame)continue;
    const line=Number(frame[2]),column=Number(frame[3]);
    if(line<1||line>1_000_000||column<1||column>1_000_000)continue;
    result.frames.push({module:frame[1].replaceAll('\\','/'),line,column});
    if(result.frames.length===6)break;
  }
  return result;
}

export function createNativeDiagnostics({enabled=false,ci=false,mode,outputFile,ownedRoot,engineLogFs=fs,readGenerationResponseBody}) {
  if(enabled&&(!ci||mode!=='synthetic'||!outputFile))throw new Error('Published native diagnostics require explicit CI synthetic mode and output file');
  let phase='setup',caseIndex=null;
  let recoveryStage=null,recoveryFrozen=false;
  const recoveryStages=['snapshot-request','snapshot-body','snapshot-save','snapshot-check',
    'session-open','composer-wait','prompt-insert','prompt-click','prompt-observe','runtime-readiness',
    'fresh-poll','fresh-check','retained-files','verification-open','verification-folder',
    'verification-prepare','verification-wait','engine-info','engine-health','engine-identity','receipt-write'];
  let engineLog=emptyEngineLog(),engineLogCaptured=false;
  const requests=[],startup=[],ownedProcesses=[];
  const promptRuns={attachment:null,recovery:null};
  // Pin only the first exact owning submission for each generation. General
  // network history is a rolling ring; polling must not erase this evidence.
  const generationPrompts=[],generationRuns=[];
  let generationHostErrors=[],hostErrorsCaptured=false;
  let generationRun=null;
  const readGenerationError=run=>{
    if(!enabled||!ci||mode!=='synthetic'||recoveryFrozen||typeof readGenerationResponseBody!=='function'||run.receipt.status<500||run.receipt.status>599)return;
    const row=run.receipt;
    row.responseError={category:'unknown',shape:'unknown',name:null,code:null};
    let reading;
    // Invoke now, while this event's owning CDP connection is current. No
    // deferred target lookup, retry, additional wait or prompt is introduced.
    try{reading=readGenerationResponseBody(run.requestId);}
    catch{if(!recoveryFrozen)row.responseError={category:'read-failed',shape:'unknown',name:null,code:null};return;}
    void Promise.resolve(reading).then(value=>{
      if(recoveryFrozen)return;
      try{row.responseError=generationErrorShape(value);}catch{row.responseError={category:'unknown',shape:'unknown',name:null,code:null};}
    },()=>{if(!recoveryFrozen)row.responseError={category:'read-failed',shape:'unknown',name:null,code:null};});
  };
  const observeNetworkEvent=event=>{
    if(recoveryFrozen||!generationRun)return;
    try {
      const run=generationRun,row=run.receipt,params=event?.params;
      const elapsed=timestamp=>Number.isFinite(run.started)&&Number.isFinite(timestamp)&&timestamp>=run.started&&timestamp-run.started<=300?Math.round((timestamp-run.started)*1000):null;
      if(!row.issued){
        if(event?.method!=='Network.requestWillBeSent'||params?.request?.method!=='POST'||typeof params.requestId!=='string')return;
        const url=new URL(params.request.url);
        if(url.origin!==run.origin||url.username||url.password)return;
        const route=run.paths.get(url.pathname);if(!route)return;
        row.issued=true;row.route=route;row.state='pending';run.requestId=params.requestId;run.path=url.pathname;run.started=Number.isFinite(params.timestamp)?params.timestamp:null;
      } else if(params?.requestId===run.requestId){
        if(event.method==='Network.responseReceived'){
          const status=params.response?.status;
          row.status=Number.isInteger(status)&&status>=100&&status<=599?status:null;
          const duration=elapsed(params.timestamp);if(duration!==null)row.headersElapsedMs=duration;
          row.state='headers';
        } else if(event.method==='Network.loadingFinished'){
          const duration=elapsed(params.timestamp);if(duration!==null)row.completedElapsedMs=duration;
          row.state='finished';generationRun=null;readGenerationError(run);
        } else if(event.method==='Network.loadingFailed'){
          const duration=elapsed(params.timestamp);if(duration!==null)row.completedElapsedMs=duration;
          const codes={'net::ERR_ABORTED':'aborted','net::ERR_CONNECTION_REFUSED':'connection-refused','net::ERR_CONNECTION_RESET':'connection-reset','net::ERR_TIMED_OUT':'timed-out'};
          row.failure=Object.hasOwn(codes,params.errorText)?codes[params.errorText]:params.canceled===true?'aborted':params.blockedReason?'blocked':'unknown';
          row.state='failed';generationRun=null;
        }
      }
    } catch { /* Diagnostic projection never changes the observed protocol. */ }
  };
  const endPrompt=role=>{
    const run=promptRuns[role];
    if(run&&!run.ended){
      run.ended=true;
      try{run.network=summarizePromptEvents(run.events,run.context,run.start,run.events.length);}catch{}
      run.events=null;run.context=null;
    }
  };
  const promptProjection=()=>Object.fromEntries(['attachment','recovery'].map(role=>{
    const run=promptRuns[role];return [role,run?{click:run.click,network:run.network}:null];
  }));
  let startupDropped=0,ownedProcessesDropped=0;
  const observationStarted=performance.now();
  const startupStages=['request','headers','body','verified'];
  const processStages=['capture','term-signal','term-wait','kill-signal','kill-wait','signal-recheck'];
  const phases=['setup','startup','configure-provider','native-case','preparation-admission','generation','extra-cases','relaunch','recovery','complete'];
  const request=async(url,options={},timeout=30_000,probeCaseIndex=null)=>{
    const record={phase,caseIndex,...(probeCaseIndex===null?{}:{probeCaseIndex}),endpoint:endpoint(url),state:'pending',status:null,elapsedMs:0};
    requests.push(record);if(requests.length>128)requests.shift();
    const started=performance.now();
    try {
      const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
      record.state='headers';record.status=response.status;return response;
    }catch(error){record.state='failed';record.error=errorMetadata(error);throw error;}
    finally {record.elapsedMs=Math.round(performance.now()-started);}
  };
  return {
    observeNetworkEvent,
    generationStart(index,events,start,context){
      if(recoveryFrozen||!Number.isInteger(index)||index<1||index>10||generationPrompts.some(row=>row.caseIndex===index))return;
      try {
        const origin=new URL(context.origin);
        if(!['http:','https:'].includes(origin.protocol)||origin.username||origin.password||origin.pathname!=='/'||origin.search||origin.hash||
          ![context.workspaceId,context.sessionId].every(value=>typeof value==='string'&&value.length>0&&value.length<=512)||
          !Array.isArray(events)||!Number.isSafeInteger(start)||start<0||start>events.length)return;
        const prefix=`/workspace/${encodeURIComponent(context.workspaceId)}/opencode/session/${encodeURIComponent(context.sessionId)}`;
        const receipt={caseIndex:index,issued:false,route:null,state:'unissued',status:null,failure:null};
        generationPrompts.push(receipt);
        // Entering the next case ends observation of the previous case. Replay
        // starts before its Generate click, including a prompt already emitted
        // before the provisioning response and persisted binding were inspected.
        generationRun={receipt,origin:origin.origin,paths:new Map(['prompt_async','message'].map(route=>[`${prefix}/${route}`,route])),requestId:null};
        generationRuns.push(generationRun);
        for(let i=start;i<events.length&&generationRun;i++)observeNetworkEvent(events[i]);
      } catch { /* Invalid diagnostic ownership cannot fabricate a receipt. */ }
    },
    promptStart(role,events,start,context){
      if(recoveryFrozen||!['attachment','recovery'].includes(role)||promptRuns[role])return;
      promptRuns[role]={events,start,context,click:null,network:null,ended:false};
    },
    promptClick(role,value){
      if(recoveryFrozen||!['attachment','recovery'].includes(role)||!promptRuns[role]||promptRuns[role].ended)return;
      try{promptRuns[role].click=projectPromptClick(value);}catch{}
    },
    promptEnd(role){if(!recoveryFrozen&&['attachment','recovery'].includes(role))endPrompt(role);},
    bindOwnedRoot(value){
      if(!ownedRootShape(value)||ownedRoot!==undefined&&ownedRoot!==value)throw new Error('Invalid or replaced diagnostic owned root');
      ownedRoot=value;
    },
    phase(value,index=null){if(!phases.includes(value))throw new Error('Unknown diagnostic phase');phase=value;caseIndex=Number.isInteger(index)?index:null;if(!recoveryFrozen)recoveryStage=null;},
    recoveryStage(value){
      if(!recoveryFrozen&&phase==='recovery')recoveryStage=recoveryStages.includes(value)?value:'unknown';
    },
    fetch:request,
    startup(stage){
      if(!startupStages.includes(stage))throw new Error('Unknown startup diagnostic stage');
      startup.push({stage,elapsedMs:Math.round(performance.now()-observationStarted)});
      if(startup.length>32){startup.shift();startupDropped++;}
    },
    ownedProcess(value){
      if(!processStages.includes(value?.stage))throw new Error('Unknown process diagnostic stage');
      const counts=['index','elapsedMs','knownLive','unknown','moved','mismatched'];
      if(!counts.every(key=>Number.isSafeInteger(value[key])&&value[key]>=0)||typeof value.leaderExited!=='boolean'||typeof value.anchored!=='boolean')throw new Error('Invalid process diagnostic census');
      ownedProcesses.push({phase,stage:value.stage,index:value.index,elapsedMs:value.elapsedMs,knownLive:value.knownLive,unknown:value.unknown,moved:value.moved,mismatched:value.mismatched,leaderExited:value.leaderExited,anchored:value.anchored});
      if(ownedProcesses.length>128){ownedProcesses.shift();ownedProcessesDropped++;}
    },
    async probeWorkspace({serverInfo,serverAuth,workspaces,selectedIndex=1}){
      const index=caseIndex??selectedIndex;
      if(!Number.isInteger(index)||index<1)throw new Error('Invalid diagnostic workspace index');
      const workspace=workspaces[index-1];
      if(!workspace)throw new Error("Invalid diagnostic workspace index");
      const response=await request(`${serverInfo.baseUrl}/workspace/${workspace.id}/lawoss/documents`,{headers:serverAuth},5000,index);
      await response.body?.cancel();
    },
    async captureEngineLog(context={}){
      if(engineLogCaptured)return;
      engineLogCaptured=true;
      // No filesystem operation at all before every publication/failure/root
      // guard. The adapter is only a deterministic filesystem fault-test seam.
      if(!enabled||!ci||mode!=='synthetic')return;
      if(ownedRoot===undefined){engineLog=emptyEngineLog('unavailable');return;}
      if(!ownedRootShape(ownedRoot)){engineLog=emptyEngineLog('unsafe');return;}
      if(!context.error||phase!=='startup'){engineLog=emptyEngineLog('unavailable');return;}
      if(typeof context.selectedDirectory!=='string'||!path.isAbsolute(context.selectedDirectory)||!within(ownedRoot,context.selectedDirectory)){engineLog=emptyEngineLog('unsafe');return;}
      const clockContext={...context,captureWallMs:context.captureWallMs??Date.now()};
      const validity=projectEngineLog(Buffer.alloc(0),clockContext);
      if(!validity.clockWindowValid){engineLog=validity;return;}
      try{engineLog=await readOwnedEngineLog(engineLogFs,ownedRoot,clockContext);}
      catch(error){engineLog=failedEngineLog(error);}
    },
    captureGenerationHostErrors(owners){
      if(!enabled||!ci||mode!=='synthetic'||!recoveryFrozen||hostErrorsCaptured)return;
      hostErrorsCaptured=true;
      const runs=generationRuns.filter(run=>run.receipt.issued&&run.receipt.status>=500&&run.receipt.status<=599);
      if(!runs.length)return;
      // Owned console envelopes are structural evidence, not authenticated
      // causes: a guest or arbitrary message can imitate text. Never publish
      // output, paths, functions, messages or arbitrary error properties.
      const buffers=[];let inspected=0;
      try{for(const owner of Array.isArray(owners)?owners:[]){
        if(inspected===2)break;
        if(!['electron','electron-relaunch'].includes(owner?.label)||typeof owner.output!=='function')continue;
        inspected++;
        try{const text=owner.output();if(typeof text==='string'){
          const tail=Buffer.from(text.slice(-256*1024),'utf8');
          buffers.push(tail.subarray(Math.max(0,tail.length-256*1024)).toString('utf8').split(/\r?\n/));
        }}catch{}
      }}catch{}
      generationHostErrors=runs.map(run=>{
        const matches=[],prefix=`[legalwork-server] Unhandled error: POST ${run.path} `;
        for(const lines of buffers)for(let i=0;i<lines.length;i++)if(lines[i].startsWith(prefix)){
          const block=[lines[i].slice(prefix.length),...lines.slice(i+1,i+33)];
          matches.push(generationHostError(block,0));
        }
        return {caseIndex:run.receipt.caseIndex,...(matches.length===1?matches[0]:{category:'unknown',name:'Error',code:null,phase:null,frames:[]})};
      });
    },
    async write({events=[],error=null,cleanupErrors=[]}={}){
      if(!enabled)return;
      const data={schema:6,generationPrompts,...(hostErrorsCaptured?{generationHostErrors}:{}),promptObservations:promptProjection(),recoveryStage:error&&recoveryFrozen?recoveryStage:null,engineLog,mode:'synthetic',platform:process.platform,phase,caseIndex,requests,startup,startupDropped,ownedProcesses,ownedProcessesDropped,network:summarizeNetwork(events),...(error?{error:errorMetadata(error)}:{}),cleanupErrors:cleanupErrors.map(e=>errorMetadata(e))};
      await writeFile(outputFile,JSON.stringify(data,null,2),{mode:0o600});
    },
    failure(error){
      // Called first at the primary catch, before probes or cleanup can run.
      if(!recoveryFrozen){recoveryStage=phase==='recovery'?recoveryStage??'unknown':null;recoveryFrozen=true;generationRun=null;for(const role of ['attachment','recovery'])endPrompt(role);}
      return {phase,caseIndex,recoveryStage,error:errorMetadata(error)};
    },
  };
}
