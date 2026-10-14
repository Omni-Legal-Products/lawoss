import { writeFile } from 'node:fs/promises';

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
  const fixed = new Map([['/global/health','engine.health'],['/provider','provider'],['/instance/dispose','engine.dispose'],['/auth/isir-native','synthetic.auth'],['/json/list','cdp.targets'],['/experimental/session','engine.sessions'],['/','ui']]);
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
export function createNativeDiagnostics({enabled=false,ci=false,mode,outputFile}) {
  if(enabled&&(!ci||mode!=='synthetic'||!outputFile))throw new Error('Published native diagnostics require explicit CI synthetic mode and output file');
  let phase='setup',caseIndex=null;
  const requests=[];
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
    phase(value,index=null){if(!phases.includes(value))throw new Error('Unknown diagnostic phase');phase=value;caseIndex=Number.isInteger(index)?index:null;},
    fetch:request,
    async probeWorkspace({serverInfo,serverAuth,workspaces,selectedIndex=1}){
      const index=caseIndex??selectedIndex;
      if(!Number.isInteger(index)||index<1)throw new Error('Invalid diagnostic workspace index');
      const workspace=workspaces[index-1];
      if(!workspace)throw new Error("Invalid diagnostic workspace index");
      const response=await request(`${serverInfo.baseUrl}/workspace/${workspace.id}/lawoss/documents`,{headers:serverAuth},5000,index);
      await response.body?.cancel();
    },
    async write({events=[],error=null,cleanupErrors=[]}={}){
      if(!enabled)return;
      const data={schema:2,mode:'synthetic',platform:process.platform,phase,caseIndex,requests,network:summarizeNetwork(events),...(error?{error:errorMetadata(error)}:{}),cleanupErrors:cleanupErrors.map(e=>errorMetadata(e))};
      await writeFile(outputFile,JSON.stringify(data,null,2),{mode:0o600});
    },
    failure(error){return {phase,caseIndex,error:errorMetadata(error)};},
  };
}
