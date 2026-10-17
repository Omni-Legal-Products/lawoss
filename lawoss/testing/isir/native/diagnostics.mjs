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
  let pathname;try { pathname=new URL(url).pathname.replace(/^\/workspace\/[^/]+\/opencode(?=\/|$)/,''); } catch { return 'other'; }
  if (/\/lawoss\/documents\/prepare$/.test(pathname)) return 'documents.prepare';
  if (/\/lawoss\/documents(?:\/.*)?$/.test(pathname)) return 'documents';
  if (/\/(?:events?|event-stream|stream)$/.test(pathname)) return 'events';
  if (/\/prompt_async$/.test(pathname)) return 'prompt';
  if (/\/sessions?\/[^/]+\/snapshot$/.test(pathname)) return 'snapshot';
  if (/\/files\/(?:list|raw|content)$/.test(pathname)) return 'files';
  const fixed = new Map([['/global/health','engine.health'],['/provider','provider'],['/instance/dispose','engine.dispose'],['/auth/isir-native','synthetic.auth'],['/json/list','cdp.targets'],['/experimental/session','engine.sessions'],['/','ui']]);
  if(fixed.has(pathname))return fixed.get(pathname);
  if (/\/workspace\/[^/]+\/engine\/reload$/.test(pathname))return 'engine.reload';
  if (/\/workspace\/[^/]+\/config$/.test(pathname))return 'workspace.config';
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
export function summarizeNetwork(events) {
  const requests=new Map(),origins=new Map(),exceptions=new Map();
  const exceptionNames=['Error','TypeError','ReferenceError','SyntaxError','RangeError','EvalError','URIError','AggregateError','DOMException'];
  let latest=0;
  for(const event of events) {
    const p=event.params??{};
    if(event.method.startsWith('Network.')&&Number.isFinite(p.timestamp))latest=Math.max(latest,p.timestamp);
    if(event.method==='Runtime.exceptionThrown') {
      const supplied=p.exceptionDetails?.exception?.className;
      const name=exceptionNames.includes(supplied)?supplied:'Error';
      exceptions.set(name,(exceptions.get(name)??0)+1);
    }
    if(event.method==='Network.requestWillBeSent') {
      let origin=null,workspaceIndex=null;
      try {const url=new URL(p.request?.url);if(!origins.has(url.origin))origins.set(url.origin,origins.size+1);origin=origins.get(url.origin);const match=url.pathname.match(/\/workspace\/ws_native_(\d+)(?:\/|$)/);if(match)workspaceIndex=Number(match[1]);}catch{}
      requests.set(p.requestId,{endpoint:endpoint(p.request?.url),category:rendererCategory(p.request?.url),origin,workspaceIndex,status:null,state:'pending',stream:false,started:Number.isFinite(p.timestamp)?p.timestamp:latest});
    }
    const entry=requests.get(p.requestId);if(!entry)continue;
    if(event.method==='Network.responseReceived') {entry.status=Number.isInteger(p.response?.status)?p.response.status:null;entry.stream=p.response?.mimeType==='text/event-stream';}
    if(event.method==='Network.loadingFinished')entry.state='finished';
    if(event.method==='Network.loadingFailed')entry.state='failed';
  }
  const aggregates=new Map();
  let http500Count=0;
  const all=[...requests.values()].map(({started,category,...request})=>{
    if(category) {
      if(request.status===500)http500Count++;
      const statusFamily=request.status===null?'none':request.status>=100&&request.status<600?`${Math.floor(request.status/100)}xx`:'other';
      const key=JSON.stringify([category,statusFamily,request.state]);
      const aggregate=aggregates.get(key)??{category,statusFamily,state:request.state,count:0};
      aggregate.count++;aggregates.set(key,aggregate);
    }
    return {...request,ageMs:Math.max(0,Math.round((latest-started)*1000))};
  });
  return {total:all.length,pending:all.filter(r=>r.state==='pending').length,streams:all.filter(r=>r.state==='pending'&&r.stream).length,requests:[...all.filter(r=>r.state==='pending'),...all.filter(r=>r.state!=='pending').slice(-40)].slice(0,128),renderer:{network:[...aggregates.values()],http500Count,exceptions:[...exceptions].map(([name,count])=>({name,count}))}};
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
  return {
    phase(value,index=null){if(!phases.includes(value))throw new Error('Unknown diagnostic phase');phase=value;caseIndex=Number.isInteger(index)?index:null;},
    async fetch(url,options={},timeout=30_000){
      const record={phase,caseIndex,endpoint:endpoint(url),state:'pending',status:null,elapsedMs:0};
      requests.push(record);if(requests.length>128)requests.shift();
      const started=Date.now();
      try {
        const response=await fetch(url,{...options,signal:options.signal?AbortSignal.any([options.signal,AbortSignal.timeout(timeout)]):AbortSignal.timeout(timeout)});
        record.state='headers';record.status=response.status;return response;
      }catch(error){record.state='failed';record.error=errorMetadata(error);throw error;}
      finally {record.elapsedMs=Date.now()-started;}
    },
    async write({events=[],error=null,cleanupErrors=[]}={}){
      if(!enabled)return;
      const data={schema:1,mode:'synthetic',platform:process.platform,phase,caseIndex,requests,network:summarizeNetwork(events),...(error?{error:errorMetadata(error)}:{}),cleanupErrors:cleanupErrors.map(e=>errorMetadata(e))};
      await writeFile(outputFile,JSON.stringify(data,null,2),{mode:0o600});
    },
    failure(error){return {phase,caseIndex,error:errorMetadata(error)};},
  };
}
