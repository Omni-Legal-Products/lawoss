import assert from 'node:assert/strict';
import test from 'node:test';

test('owned engine fetch observation preserves results/errors and excludes external or unknown routes', async () => {
  const module=await import('./engine-fetch.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  assert.equal(typeof module?.observeNativeEngineFetch,'function','Passive owned engine fetch observation is required');
  const response=new Response('{}'),failure=new TypeError('private credential'),calls=[],records=[];
  const original=async(...args)=>{calls.push(args);if(args[1]?.fail)throw failure;return response;};
  const observed=module.observeNativeEngineFetch(original,record=>records.push(record));
  const options={method:'POST',headers:{authorization:'secret'},body:'private'};
  assert.equal(await observed('http://127.0.0.1:4321/instance/dispose?directory=private',options),response);
  assert.equal(calls[0][1],options);
  await assert.rejects(observed('http://127.0.0.1:4321/mcp',{fail:true}),error=>error===failure);
  const before=records.length;
  await observed('https://external.invalid/mcp');
  await observed('http://127.0.0.1:4321/unknown');
  assert.equal(records.length,before);
  assert.deepEqual(records.map(r=>[r.endpoint,r.state]),[['engine.dispose','pending'],['engine.dispose','headers'],['engine.warmup','pending'],['engine.warmup','failed']]);
  assert.doesNotMatch(JSON.stringify(records),/secret|private|credential|127\.0|directory|external|authorization/);
  const brokenObserver=module.observeNativeEngineFetch(original,()=>{throw new Error('observer failed');});
  assert.equal(await brokenObserver('http://127.0.0.1:4321/mcp'),response);
});

test('owned engine fetch stdout parsing validates its allowlist and caps records', async () => {
  const module=await import('./engine-fetch.mjs').catch(error=>{if(error.code==='ERR_MODULE_NOT_FOUND')return null;throw error;});
  assert.equal(typeof module?.nativeEngineFetchRecords,'function','Only validated bounded fetch receipts can reach CI logs');
  const lines=[];
  const observed=module.observeNativeEngineFetch(async()=>new Response('{}'),record=>lines.push(module.ENGINE_FETCH_PREFIX+JSON.stringify(record)));
  for(const [route,method] of [['/mcp','GET'],['/mcp','POST'],['/instance/dispose','POST']])
    for(let i=0;i<100;i++)await observed('http://127.0.0.1:4321'+route,{method});
  assert.equal(lines.length,64);
  const invalid=[
    {endpoint:'private',state:'pending',elapsedMs:0,request:1},
    {endpoint:'engine.dispose',state:'headers',elapsedMs:0,request:1,status:200,url:'secret'},
    {endpoint:'engine.dispose',state:'headers',elapsedMs:NaN,request:1,status:200},
    {endpoint:'engine.dispose',state:'headers',elapsedMs:0,request:1,status:999},
  ].map(record=>module.ENGINE_FETCH_PREFIX+JSON.stringify(record));
  const result=module.nativeEngineFetchRecords(['raw private stdout',...invalid,...lines,...lines].join('\n'));
  assert.equal(result.length,64);
  assert.doesNotMatch(JSON.stringify(result),/secret|private|url|NaN|999/);
});

test('early MCP pressure cannot displace later disposal receipts or concurrent completion pairs', async () => {
  const {observeNativeEngineFetch}=await import('./engine-fetch.mjs');
  const records=[],releases=[],response=new Response('{}');
  const observed=observeNativeEngineFetch(()=>new Promise(resolve=>releases.push(()=>resolve(response))),record=>records.push(record));
  const calls=[
    ...Array.from({length:100},()=>observed('http://127.0.0.1:4321/mcp')),
    ...Array.from({length:100},()=>observed('http://127.0.0.1:4321/mcp',{method:'POST'})),
    ...Array.from({length:8},()=>observed('http://127.0.0.1:4321/instance/dispose',{method:'POST'})),
  ];
  assert.equal(releases.length,208,'Every original fetch executes, regardless of admission to observation');
  for(const release of releases)release();
  assert.ok((await Promise.all(calls)).every(result=>result===response));
  assert.equal(records.length,64);
  assert.deepEqual(records.filter(r=>r.endpoint==='engine.dispose').map(r=>r.state),[...Array(8).fill('pending'),...Array(8).fill('headers')]);
  for(const pending of records.filter(r=>r.state==='pending'))
    assert.ok(records.some(r=>r.request===pending.request&&r.state==='headers'),'Every admitted request keeps its completion pair');
});
