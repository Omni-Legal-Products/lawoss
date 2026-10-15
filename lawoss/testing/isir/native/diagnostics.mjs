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
  const codes = ['EPERM','ESRCH','ENOENT','EBUSY','ECONNREFUSED','ECONNRESET','UND_ERR_HEADERS_TIMEOUT','UND_ERR_CONNECT_TIMEOUT','ERR_ASSERTION'];
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
  if(fixed.has(pathname))return fixed.get(pathname);
  if (/\/workspace\/[^/]+\/config$/.test(pathname))return 'workspace.config';
  if (/\/workspace\/[^/]+\/engine\/reload$/.test(pathname))return 'workspace.reload';
  return 'other';
}
export function summarizeNetwork(events) {
  const active=new Map(),origins=new Map(),loaders=new Map();
  const counts=()=>({total:0,pending:0,streams:0});
  const all=counts();let current=counts(),currentRows=[],historyRows=[];
  let latest=0,epoch=0,mainFrame=null,mainLoader=null,trackingDropped=0;
  const retain=(rows,entry)=>{
    rows.push(entry);
    if(rows.length>128){const finished=rows.findIndex(row=>row.state!=='pending');rows.splice(finished<0?0:finished,1);}
  };
  const adjust=(entry,key,amount)=>{all[key]+=amount;if(entry.epoch===epoch)current[key]+=amount;};
  const finish=(entry,state)=>{
    if(entry.state!=='pending')return;
    adjust(entry,'pending',-1);if(entry.stream)adjust(entry,'streams',-1);
    entry.state=state;entry.ended=latest;
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
        finish(previous,'redirected');previous.status=Number.isInteger(p.redirectResponse.status)?p.redirectResponse.status:null;
      }
      const entry={endpoint:endpoint(p.request?.url),origin,workspaceIndex,epoch:loaders.get(p.loaderId)??epoch,status:null,state:'pending',stream:false,started:Number.isFinite(p.timestamp)?p.timestamp:latest};
      adjust(entry,'total',1);adjust(entry,'pending',1);
      retain(entry.epoch===epoch?currentRows:historyRows,entry);active.set(p.requestId,entry);
      // Bounded temporary correlation storage; expose loss rather than claiming
      // terminal observations for entries whose request IDs were evicted.
      if(active.size>4096){active.delete(active.keys().next().value);trackingDropped++;}
    }
    if(!event.method.startsWith('Network.'))continue;
    const entry=active.get(p.requestId);if(!entry)continue;
    if(event.method==='Network.responseReceived') {
      entry.status=Number.isInteger(p.response?.status)?p.response.status:null;
      const stream=p.response?.mimeType==='text/event-stream';
      if(stream!==entry.stream&&entry.state==='pending')adjust(entry,'streams',stream?1:-1);
      entry.stream=stream;
    }
    if(event.method==='Network.loadingFinished'||event.method==='Network.loadingFailed'){
      finish(entry,event.method==='Network.loadingFinished'?'finished':'failed');active.delete(p.requestId);
    }
  }
  const project=rows=>rows.map(({started,ended,...request})=>({...request,ageMs:Math.max(0,Math.round(((ended??latest)-started)*1000))}));
  const history=Object.fromEntries(Object.keys(all).map(key=>[key,all[key]-current[key]]));
  // Historical pending means no terminal CDP event was observed, not a live socket.
  return {epoch,...current,trackingDropped,requests:project(currentRows),history:{...history,requests:project(historyRows)}};
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
export function createNativeDiagnostics({enabled=false,ci=false,mode,outputFile,ownedRoot,engineLogFs=fs}) {
  if(enabled&&(!ci||mode!=='synthetic'||!outputFile))throw new Error('Published native diagnostics require explicit CI synthetic mode and output file');
  let phase='setup',caseIndex=null;
  let engineLog=emptyEngineLog(),engineLogCaptured=false;
  const requests=[],startup=[],ownedProcesses=[];
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
    bindOwnedRoot(value){
      if(!ownedRootShape(value)||ownedRoot!==undefined&&ownedRoot!==value)throw new Error('Invalid or replaced diagnostic owned root');
      ownedRoot=value;
    },
    phase(value,index=null){if(!phases.includes(value))throw new Error('Unknown diagnostic phase');phase=value;caseIndex=Number.isInteger(index)?index:null;},
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
    async write({events=[],error=null,cleanupErrors=[]}={}){
      if(!enabled)return;
      const data={schema:4,engineLog,mode:'synthetic',platform:process.platform,phase,caseIndex,requests,startup,startupDropped,ownedProcesses,ownedProcessesDropped,network:summarizeNetwork(events),...(error?{error:errorMetadata(error)}:{}),cleanupErrors:cleanupErrors.map(e=>errorMetadata(e))};
      await writeFile(outputFile,JSON.stringify(data,null,2),{mode:0o600});
    },
    failure(error){return {phase,caseIndex,error:errorMetadata(error)};},
  };
}
