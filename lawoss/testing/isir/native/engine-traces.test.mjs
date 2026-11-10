import assert from 'node:assert/strict';
import test from 'node:test';

const payload=spans=>({resourceSpans:[{resource:{secret:'private'},scopeSpans:[{scope:{name:'private'},spans}]}]});
const span=(name='Npm.reify',extra={})=>({name,startTimeUnixNano:'1000000000',endTimeUnixNano:'1004500000',status:{code:1,message:'private error'},attributes:[{key:'token',value:'secret'}],traceId:'private-id',events:[{name:'private'}],...extra});

test('engine trace projection admits only fixed names, bounded durations and status codes', async () => {
  const module=await import('./engine-traces.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  assert.equal(typeof module?.createNativeEngineTraceProjection,'function','The owned trace collector needs an explicit privacy projection');
  const projection=module.createNativeEngineTraceProjection();
  projection.add(payload([
    span(),span('PrivateClientName'),span('Npm.reify',{endTimeUnixNano:'0'}),
    span('Npm.reify',{startTimeUnixNano:'secret'}),span('Npm.reify',{endTimeUnixNano:'999999999999999999999'}),
    span('Npm.reify',{startTimeUnixNano:1000000000}),span('Npm.reify',{endTimeUnixNano:'999999999'}),
    span('Npm.reify',{status:{code:99}}),span('Plugin.activate',{status:undefined}),span('Plugin.init'),
  ]));
  assert.deepEqual(projection.snapshot().spans,[{name:'Npm.reify',durationMs:5,status:1},{name:'Plugin.activate',durationMs:5,status:0}]);
  assert.doesNotMatch(JSON.stringify(projection.snapshot()),/secret|private|token|traceId|resource|attributes|events|message|PrivateClientName|Plugin\.init/);
  for(let i=0;i<1000;i++)projection.add(payload([span('MCP.tools')]));
  projection.add(payload([span('Project.activate')]));
  assert.ok(projection.snapshot().spans.some(r=>r.name==='Project.activate'),'Repeated MCP spans cannot crowd out a later location span');
  assert.ok(projection.snapshot().spans.length<=120);
  assert.ok(projection.snapshot().dropped>0);
});

test('owned loopback trace receiver bounds JSON and discards logs without storing raw data', async () => {
  const module=await import('./engine-traces.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  assert.equal(typeof module?.startNativeEngineTraceReceiver,'function','An owned receiver is required before enabling engine trace export');
  const receiver=await module.startNativeEngineTraceReceiver();
  try {
    assert.match(receiver.endpoint,/^http:\/\/127\.0\.0\.1:\d+$/);
    const send=(route,body)=>fetch(receiver.endpoint+route,{method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal((await send('/v1/traces',JSON.stringify(payload([span()])))).status,200);
    assert.equal((await send('/v1/logs','private log text')).status,200);
    assert.equal((await send('/v1/traces','{private')).status,400);
    assert.equal((await send('/v1/traces','x'.repeat(2*1024*1024+1))).status,413);
    assert.equal((await send('/unknown','private')).status,404);
    const snapshot=receiver.snapshot();
    assert.deepEqual(snapshot.spans,[{name:'Npm.reify',durationMs:5,status:1}]);
    assert.equal(snapshot.batches,1);assert.equal(snapshot.rejected,2);
    assert.doesNotMatch(JSON.stringify(snapshot),/secret|private|token|traceId|resource|attributes|events|message/);
  } finally {await receiver.close();}
  await assert.rejects(fetch(receiver.endpoint+'/v1/traces'),TypeError);
});
