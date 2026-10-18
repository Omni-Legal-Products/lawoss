export const ENGINE_FETCH_PREFIX='ISIR_NATIVE_ENGINE_FETCH ';
const endpoints=['engine.dispose','engine.warmup','engine.mcp'];
const names=['Error','TypeError','TimeoutError','AbortError'];
const limit=64;

export function observeNativeEngineFetch(original, observe) {
  let emitted=0,next=0;
  // Reserve both records per admitted request. Startup MCP traffic cannot
  // consume disposal's slots, including when requests are concurrent.
  const remaining=new Map([['engine.dispose',8],['engine.warmup',12],['engine.mcp',12]]);
  const emit=record=>{if(emitted>=limit)return;emitted++;try{observe(record);}catch{/* Observation must never change production fetch. */}};
  return async function(...args) {
    let endpoint;
    try {
      const input=args[0],url=new URL(input instanceof Request?input.url:input);
      const method=String(args[1]?.method??(input instanceof Request?input.method:'GET')).toUpperCase();
      if(url.protocol==='http:'&&url.hostname==='127.0.0.1'&&url.port) {
        if(url.pathname==='/instance/dispose'&&method==='POST')endpoint='engine.dispose';
        if(url.pathname==='/mcp'&&method==='GET')endpoint='engine.warmup';
        if(url.pathname==='/mcp'&&method==='POST')endpoint='engine.mcp';
      }
    } catch {/* Unknown inputs still go to the original fetch unchanged. */}
    if(!endpoint||remaining.get(endpoint)===0)return original.apply(this,args);
    remaining.set(endpoint,remaining.get(endpoint)-1);
    const request=++next,started=performance.now();
    emit({endpoint,state:'pending',elapsedMs:0,request});
    try {
      const response=await original.apply(this,args);
      emit({endpoint,state:'headers',elapsedMs:Math.max(0,Math.round(performance.now()-started)),request,status:response.status});
      return response;
    } catch(error) {
      emit({endpoint,state:'failed',elapsedMs:Math.max(0,Math.round(performance.now()-started)),request,errorName:names.includes(error?.name)?error.name:'Error'});
      throw error;
    }
  };
}

export function nativeEngineFetchRecords(output) {
  const records=[];
  for(const line of output.split(/\r?\n/)) {
    if(!line.startsWith(ENGINE_FETCH_PREFIX))continue;
    let r;try{r=JSON.parse(line.slice(ENGINE_FETCH_PREFIX.length));}catch{continue;}
    if(!r||!endpoints.includes(r.endpoint)||!['pending','headers','failed'].includes(r.state))continue;
    if(Object.keys(r).some(key=>!['endpoint','state','elapsedMs','request','status','errorName'].includes(key)))continue;
    if(!Number.isSafeInteger(r.elapsedMs)||r.elapsedMs<0||!Number.isSafeInteger(r.request)||r.request<1)continue;
    if(r.state==='headers'&&(!Number.isInteger(r.status)||r.status<100||r.status>599))continue;
    if(r.state!=='headers'&&r.status!==undefined)continue;
    if(r.state==='failed'&&!names.includes(r.errorName))continue;
    if(r.state!=='failed'&&r.errorName!==undefined)continue;
    records.push(r);
    if(records.length===limit)break;
  }
  return records;
}
