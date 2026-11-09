import assert from 'node:assert/strict';
import test from 'node:test';
import os from 'node:os';
import path from 'node:path';
import {syncBuiltinESMExports} from 'node:module';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,realpath,rm} from 'node:fs/promises';
import {configureNativeProvider} from './bootstrap.mjs';
import {createNativeEngineClient} from './engine-client.mjs';
import {managedEngineSettingsFilePath} from '../../../../apps/server/dist/legalwork-runtime-config.js';
import {readManagedEngineSettings} from '../../../../apps/server/dist/managed-engine-settings.js';

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
  let host,readyResponse,pendingOutcome,primaryError,published,config;
  const received=[];
  const selected={id:'ws_native_7',name:'Synthetic selected',path:path.join(root,'Workspace Č'),preset:'starter',workspaceType:'local'};
  let ready;
  const readiness=new Promise(resolve=>{ready=resolve;});
  const auth='Basic '+Buffer.from('fixture:synthetic').toString('base64');
  // Model.Info as the engine reports it; the host proxy validates the native shape.
  const model={id:'synthetic',modelID:'synthetic',providerID:'isir-native',name:'Synthetic',capabilities:{tools:true,input:['text'],output:['text']},variants:[],time:{released:0},cost:[],status:'active',enabled:true,limit:{context:128000,output:16000}};
  // LAWOSS v2: the fake engine speaks the 2.1.4 HTTP protocol (`/api/...`, `location[directory]`),
  // like apps/server/src/lawoss-engine-mcp-budget.e2e.test.ts. `/api/info` and `/api/session/active`
  // are location-free; every other route must carry the selected directory.
  const engine=createServer(async(req,res)=>{
    const url=new URL(req.url,'http://fixture');
    const header=req.headers['x-opencode-directory'];
    const directory=url.searchParams.get('location[directory]')??(typeof header==='string'?decodeURIComponent(header):null);
    received.push({method:req.method,pathname:url.pathname,directory,authorized:req.headers.authorization===auth});
    if(req.headers.authorization!==auth){res.writeHead(401).end();return;}
    const json=(status,value)=>res.writeHead(status,{'content-type':'application/json'}).end(JSON.stringify(value));
    if(url.pathname==='/api/info'){json(200,{version:'2.1.4',pid:process.pid});return;}
    if(url.pathname==='/api/session/active'){json(200,{data:{}});return;}
    if(directory!==selected.path){res.writeHead(400).end();return;}
    if(url.pathname==='/api/model'){json(200,{location:{directory},data:[model]});return;}
    if(req.method==='POST'&&url.pathname==='/api/integration/isir-native/connect/key'){
      let body='';for await(const chunk of req)body+=chunk;
      assert.deepEqual(JSON.parse(body),{key:'synthetic-local-only'});
      res.writeHead(204).end();return;
    }
    // The host reload awaits the managed location refresh; holding it holds the reload readiness.
    // Like the engine's managed-settings plugin, read what the host published for this location.
    if(req.method==='POST'&&url.pathname==='/api/rpc/legalwork.managed-settings/refresh'){
      // Only the first (post-definition) reload is held; the later key reload answers at once.
      if(readyResponse){json(200,{refreshed:true});return;}
      published=await readManagedEngineSettings(managedEngineSettingsFilePath(config),directory).catch(error=>({error}));
      readyResponse=res;ready();return;
    }
    if(url.pathname==='/api/provider'){json(200,{location:{directory},data:[{id:'isir-native',name:'Synthetic contract',activation:'auto',package:'@opencode/ai/providers/openai-compatible'}]});return;}
    res.writeHead(404).end();
  });
  try {
    await mkdir(selected.path);
    await new Promise(resolve=>engine.listen(0,'127.0.0.1',resolve));
    const baseUrl=`http://127.0.0.1:${engine.address().port}`;
    const {startServer}=await import('../../../../apps/server/dist/server.js');
    config={host:'127.0.0.1',port:0,token:'client',hostToken:'host',configPath:path.join(root,'server.json'),approval:{mode:'auto',timeoutMs:1000},corsOrigins:['*'],workspaces:[{...selected,baseUrl,opencodeUsername:'fixture',opencodePassword:'synthetic'}],authorizedRoots:[selected.path],readOnly:false,startedAt:Date.now(),tokenSource:'cli',hostTokenSource:'cli',logFormat:'pretty',logRequests:false};
    // Upstream v0.2.18: owner bearer tokens are retired; the desktop renderer uses the client token.
    const owner={token:config.token};
    host=await startServer(config);
    const serverInfo={baseUrl:`http://127.0.0.1:${host.port}`,clientToken:owner.token};
    const headers={authorization:'Bearer '+owner.token,'content-type':'application/json'};
    // LAWOSS v2: native provider definition (Config.Provider), as the app saves it.
    const providerConfig={'isir-native':{package:'@opencode/ai/providers/openai-compatible',name:'Synthetic contract',settings:{baseURL:'http://127.0.0.1:1/v1'},models:{synthetic:{name:'Synthetic'}}}};
    const request=(url,options)=>fetch(url,{...options,signal:AbortSignal.timeout(2000)});
    const args={request,serverInfo,serverAuth:headers,engineRequest:createNativeEngineClient(serverInfo,selected.id,request),workspace:selected,providerConfig};
    await assert.rejects(configureNativeProvider({...args,serverAuth:{...headers,authorization:'Bearer invalid'}}),{name:'AssertionError'});
    assert.equal(received.length,0,'Host rejects unauthorized bootstrap before engine mutation');
    let finished=false;
    const pending=configureNativeProvider(args);
    const outcome=pendingOutcome=pending.then(value=>{finished=true;return {value};},error=>{finished=true;return {error};});
    const first=await Promise.race([readiness.then(()=>({ready:true})),outcome]);
    if(first.error)throw first.error;
    assert.equal(first.ready,true,'Production scoped reload must reach engine readiness');
    assert.equal(finished,false,'Catalogue must await host readiness response');
    // LAWOSS v2: the host's MCP budget activates an admitted location with GET /api/model (engine 2.1.4
    // otherwise serves empty catalogues), so only the provider catalogue and key must follow the reload.
    assert.equal(received.some(r=>r.pathname==='/api/provider'||r.pathname.includes('/connect/key')),false,'The definition reload precedes the location catalogue and key');
    // LAWOSS v2: the host's settings GET projects the engine's resolved documents; what the host
    // persisted reaches the engine as the managed settings file it publishes before the refresh.
    assert.equal(published?.error,undefined);
    // The engine's decoder yields schema class instances; compare their JSON values. The host publishes
    // custom providers globally, so both the location's and the shared configuration carry it.
    for(const layer of [published.configuration,published.sharedConfiguration])assert.deepEqual(JSON.parse(JSON.stringify(layer.providers?.['isir-native'])),providerConfig['isir-native'],'Actual host config persisted provider');
    readyResponse.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({refreshed:true}));
    const result=await outcome;
    assert.equal(result.error,undefined);
    assert.deepEqual(result.value.connected,['isir-native']);
    // LAWOSS v2: the first GET /api/model is the host's activation when the MCP budget admits the location.
    assert.deepEqual(received.map(r=>`${r.method} ${r.pathname}`),['GET /api/model','POST /api/rpc/legalwork.managed-settings/refresh','GET /api/model','POST /api/integration/isir-native/connect/key','POST /api/rpc/legalwork.managed-settings/refresh','GET /api/provider']);
    assert.ok(received.every(r=>r.authorized));
    // LAWOSS v2: every request here is location-bound, including the credential connect.
    assert.ok(received.every(r=>r.directory===selected.path));
  } catch(error) {primaryError=error;throw error;} finally {
    if(readyResponse&&!readyResponse.writableEnded)readyResponse.writeHead(200,{'content-type':'application/json'}).end(JSON.stringify({refreshed:true}));
    await pendingOutcome;
    engine.closeAllConnections();
    await new Promise(resolve=>engine.close(resolve));
    try {await host?.stop();}
    finally {
      os.homedir=originalHome;syncBuiltinESMExports();
      for(const [name,value] of previous){if(value===undefined)delete process.env[name];else process.env[name]=value;}
      try {await rm(root,{recursive:true});} catch(cleanupError) {throw new AggregateError(primaryError?[primaryError,cleanupError]:[cleanupError],"Bootstrap fixture cleanup failed");}
    }
    assert.equal(engine.listening,false);
  }
  });
  assert.equal(process.stdout.write,originalWrite);
});
