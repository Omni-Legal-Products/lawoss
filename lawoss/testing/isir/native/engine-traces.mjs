import { createServer } from 'node:http';

const names=new Set([
  'EffectFlock.tryAcquire','EffectFlock.acquire',
  'Npm.checkNodeModules','Npm.checkDirty','Npm.reify','Npm.install','Npm.add',
  'Config.loadInstanceState','Config.get','Config.waitForDependencies',
  'Plugin.state','Plugin.init','InstanceBootstrap','InstanceBootstrap.init','InstanceStore.boot',
]);
const bodyLimit=2*1024*1024;

// These are completed spans only. An absent receipt does not prove entry
// into a phase, and no resource, attribute, error message or trace ID survives.
export function createNativeEngineTraceProjection() {
  const spans=[],counts=new Map();
  let received=0,dropped=0;
  return {
    add(payload) {
      for(const resource of Array.isArray(payload?.resourceSpans)?payload.resourceSpans:[])
        for(const scope of Array.isArray(resource?.scopeSpans)?resource.scopeSpans:[])
          for(const span of Array.isArray(scope?.spans)?scope.spans:[]) {
            if(!names.has(span?.name))continue;
            if(typeof span.startTimeUnixNano!=='string'||typeof span.endTimeUnixNano!=='string'||!/^\d{1,22}$/.test(span.startTimeUnixNano)||!/^\d{1,22}$/.test(span.endTimeUnixNano))continue;
            const elapsed=BigInt(span.endTimeUnixNano)-BigInt(span.startTimeUnixNano);
            if(elapsed<0n)continue;
            const durationMs=Math.round(Number(elapsed)/1e6);
            const status=span.status?.code??0;
            if(!Number.isSafeInteger(durationMs)||durationMs<0||durationMs>3_600_000||![0,1,2].includes(status))continue;
            received++;
            // Fifteen fixed names, eight receipts each: at most 120 records.
            // Repeated lock attempts cannot crowd out a later npm/boot phase.
            const count=counts.get(span.name)??0;
            if(count>=8){dropped++;continue;}
            counts.set(span.name,count+1);
            spans.push({name:span.name,durationMs,status});
          }
    },
    snapshot(){return {spans:spans.map(span=>({...span})),received,dropped};},
  };
}

export async function startNativeEngineTraceReceiver() {
  const projection=createNativeEngineTraceProjection();
  let batches=0,rejected=0;
  const server=createServer(async(req,res)=>{
    const route=req.url?.split('?')[0];
    const reply=status=>{if(!res.destroyed&&!res.writableEnded){res.writeHead(status,{'content-type':'application/json'});res.end('{}');}};
    if(req.method!=='POST'||!['/v1/traces','/v1/logs'].includes(route)){reply(404);return;}
    let length=0;const chunks=[];
    try {
      for await(const chunk of req){length+=chunk.length;if(route==='/v1/traces'&&length<=bodyLimit)chunks.push(chunk);}
      if(length>bodyLimit){rejected++;reply(413);return;}
      if(route==='/v1/traces') {
        projection.add(JSON.parse(Buffer.concat(chunks).toString('utf8')));
        batches++;
      }
      reply(200);
    } catch {rejected++;reply(400);}
  });
  server.requestTimeout=5000;server.headersTimeout=5000;
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  return {
    endpoint:`http://127.0.0.1:${server.address().port}`,
    snapshot:()=>({...projection.snapshot(),batches,rejected}),
    async close(){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));},
  };
}
