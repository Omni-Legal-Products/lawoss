import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {configureNativeProvider} from './bootstrap.mjs';

// The production pretty logger writes to stdout and has no injected test sink.
// Capture only its exact expected fixture line; preserve every other write.
async function withExpectedWatcherLog(run,stream=process.stdout){
  const originalWrite=stream.write;
  const expected='Reload watcher enabled (1)\n';
  const captured=[];
  stream.write=function(chunk,encoding,callback){
    if(chunk!==expected)return Reflect.apply(originalWrite,this,arguments);
    captured.push(chunk);
    const done=typeof encoding==='function'?encoding:callback;
    if(typeof done==='function')process.nextTick(done);
    return true;
  };
  try {
    const result=await run();
    assert.deepEqual(captured,[expected]);
    return result;
  } finally {
    stream.write=originalWrite;
  }
}

test('expected watcher capture forwards other writes and restores after setup or cleanup rejection',async()=>{
  const forwarded=[];
  const stream={write(...args){forwarded.push({receiver:this,args});return false;}};
  const originalWrite=stream.write;
  const callback=()=>{};
  await withExpectedWatcherLog(async()=>{
    await new Promise(resolve=>assert.equal(stream.write('Reload watcher enabled (1)\n',resolve),true));
    assert.equal(stream.write('warning: fixture\n','utf8',callback),false);
    assert.equal(stream.write(Buffer.from('error: fixture\n'),callback),false);
  },stream);
  assert.equal(stream.write,originalWrite);
  assert.deepEqual(forwarded.map(item=>item.args),[['warning: fixture\n','utf8',callback],[Buffer.from('error: fixture\n'),callback]]);
  assert.ok(forwarded.every(item=>item.receiver===stream));
  for(const phase of ['setup','cleanup']){
    const failure=new Error(phase);
    await assert.rejects(withExpectedWatcherLog(async()=>{
      if(phase==='setup')throw failure;
      try {await Promise.resolve();}finally{throw failure;}
    },stream),error=>error===failure);
    assert.equal(stream.write,originalWrite);
  }
});

test('bootstrap uses the authenticated production host reload for the selected workspace and awaits readiness',async()=>{
  const originalWrite=process.stdout.write;
  await withExpectedWatcherLog(async()=>{
  const root=await realpath(await mkdtemp(path.join(os.tmpdir(),'native-bootstrap-contract-')));
  const originalHome=os.homedir;
  const names=['LEGALWORK_SERVER_CONFIG','LEGALWORK_RUNTIME_DB','LEGALWORK_DATA_DIR','LEGALWORK_PROJECTS_DIR','XDG_CONFIG_HOME','XDG_DATA_HOME'];
  const previous=new Map(names.map(name=>[name,process.env[name]]));
  os.homedir=()=>root;syncBuiltinESMExports();
  for(const name of names)delete process.env[name];
  let host,readyResponse,pendingOutcome;
  const received=[];
  const selected={id:'ws_native_7',name:'Synthetic selected',path:path.join(root,'Workspace Č'),preset:'starter',workspaceType:'local'};
  let ready;
  const readiness=new Promise(resolve=>{ready=resolve;});
  const auth='Basic '+Buffer.from('fixture:synthetic').toString('base64');
  const engine=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    received.push({method:req.method,pathname:url.pathname,directory:url.searchParams.get('directory'),authorized:req.headers.authorization===auth});
    if(req.headers.authorization!==auth){res.writeHead(401).end();return;}
    if(url.pathname==='/auth/isir-native'){
      let body='';for await(const chunk of req)body+=chunk;
      assert.deepEqual(JSON.parse(body),{type:'api',key:'synthetic-local-only'});
      res.writeHead(200).end('{}');return;
    }
    if(url.searchParams.get('directory')!==selected.path){res.writeHead(400).end();return;}
    if(url.pathname==='/instance/dispose'){res.writeHead(200).end('true');return;}
    if(url.pathname==='/mcp'){readyResponse=res;ready();return;}
    if(url.pathname==='/provider'){res.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({connected:['isir-native'],all:[]}));return;}
    res.writeHead(404).end();
  });
  try {
    await mkdir(selected.path);
    await new Promise(resolve=>engine.listen(0,'127.0.0.1',resolve));
    const baseUrl=`http://127.0.0.1:${engine.address().port}`;
    const {startServer}=await import('../../../../apps/server/dist/server.js');
    host=await startServer({host:'127.0.0.1',port:0,token:'client',hostToken:'host',configPath:path.join(root,'server.json'),approval:{mode:'auto',timeoutMs:1000},corsOrigins:['*'],workspaces:[{...selected,baseUrl,opencodeUsername:'fixture',opencodePassword:'synthetic'}],authorizedRoots:[selected.path],readOnly:false,startedAt:Date.now(),tokenSource:'cli',hostTokenSource:'cli',logFormat:'pretty',logRequests:false});
    const serverInfo={baseUrl:`http://127.0.0.1:${host.port}`};
    const headers={authorization:'Bearer client','content-type':'application/json'};
    const providerConfig={'isir-native':{npm:'@ai-sdk/openai-compatible',name:'Synthetic contract',options:{baseURL:'http://127.0.0.1:1/v1'},models:{synthetic:{name:'Synthetic'}}}};
    const args={request:(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(2000)}),serverInfo,serverAuth:headers,liveEngine:{baseUrl},apiAuth:{authorization:auth,'content-type':'application/json'},workspace:selected,providerConfig};
    await assert.rejects(configureNativeProvider({...args,serverAuth:{...headers,authorization:'Bearer invalid'}}),{name:'AssertionError'});
    assert.equal(received.length,0,'Host rejects unauthorized bootstrap before engine mutation');
    let finished=false;
    const pending=configureNativeProvider(args);
    const outcome=pendingOutcome=pending.then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
    const first=await Promise.race([readiness.then(()=>({ready:true})),outcome]);
    assert.equal(first.ready,true,'Production scoped reload must reach engine readiness');
    assert.equal(finished,false,'Catalogue must await host readiness response');
    assert.equal(received.some(r=>r.pathname==='/provider'),false);
    const stored=await (await fetch(`${serverInfo.baseUrl}/workspace/${selected.id}/config`,{headers})).json();
    assert.deepEqual(stored.opencode.provider['isir-native'],providerConfig['isir-native'],'Actual host config persisted provider');
    readyResponse.writeHead(200,{'content-type':'application/json'}).end('{}');
    const result=await outcome;
    assert.equal(result.error,undefined);
    assert.deepEqual(result.value.connected,['isir-native']);
    assert.deepEqual(received.map(r=>r.pathname),['/auth/isir-native','/instance/dispose','/mcp','/provider']);
    assert.ok(received.every(r=>r.authorized));
    assert.ok(received.slice(1).every(r=>r.directory===selected.path));
  } finally {
    if(readyResponse&&!readyResponse.writableEnded)readyResponse.end('{}');
    await pendingOutcome;
    engine.closeAllConnections();
    await new Promise(resolve=>engine.close(resolve));
    try {await host?.stop();}
    finally {
      os.homedir=originalHome;syncBuiltinESMExports();
      for(const [name,value] of previous){if(value===undefined)delete process.env[name];else process.env[name]=value;}
      await rm(root,{recursive:true});
    }
    assert.equal(engine.listening,false);
  }
  });
  assert.equal(process.stdout.write,originalWrite);
});
