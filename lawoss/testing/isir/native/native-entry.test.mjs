import test from 'node:test';
import fs from 'node:fs';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm, realpath, rename, mkdir, access } from 'node:fs/promises';
import { publishNativeQuitAcceptance, readNativeQuitAcceptance } from './quit-acceptance.mjs';
import { connectRenderer } from './cdp.mjs';
import { observeNativeEngineFetch, ENGINE_FETCH_PREFIX } from './engine-fetch.mjs';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { stopForRelaunch } from './relaunch-stop.mjs';
import { stopNativeChild } from './owned-process.mjs';
import path from 'node:path';
import vm from 'node:vm';
import { createAppUrlMatcher, guardIpcMain } from '../../../../apps/desktop/electron/app-url.mjs';

// Execute the actual entry in a controlled module shell. Only its imports are
// substituted; no Electron, main startup, file clients or subprocesses run.
const entry=await readFile(new URL('../../../../apps/desktop/scripts/isir-native-entry.mjs',import.meta.url),'utf8');
const source=entry.replace(/^import .*;\n/gm,'').replace('await import("../electron/main.mjs");','await registerProduction();');
const origin='http://127.0.0.1:5173';
async function fixture({packaged=false,env={},commandError,quit,publisher,pid=700021}={}) {
  const events=[],handlers=new Map(),frame={url:origin};
  const app={isPackaged:packaged,setPath:()=>events.push('setPath'),quit:()=>{events.push('app.quit');quit?.();}};
  const ipcMain={handle:(channel,handler)=>handlers.set(channel,handler)};
  const context=vm.createContext({app,ipcMain,dialog:{},path,
    observeNativeEngineFetch,ENGINE_FETCH_PREFIX,fetch:globalThis.fetch,console,
    publishNativeQuitAcceptance:launch=>{events.push('quit-publication');publisher?.(launch);},
    process:{pid,env:{LAWOSS_ISIR_NATIVE_ROOT:'/owned',LEGALWORK_DEV_MODE:'1',LEGALWORK_ELECTRON_USERDATA:'/owned/profile',...env}},
    readFile:()=>{throw new Error('Unexpected chooser read');},appendFile:()=>{throw new Error('Unexpected audit write');},
    registerProduction:async()=>{
      // Real production origin wrapper, preserving the same registration order
      // as main.mjs. appBuildInfo stands in for its supported read-only query.
      guardIpcMain(ipcMain,{isTrustedUrl:createAppUrlMatcher({devServerUrl:origin,appRoot:'/built'})}).handle('legalwork:desktop',async(event,command,...args)=>{
        events.push(command);
        if(commandError)throw commandError;
        if(command!=='appBuildInfo')return {event,command,args};
        return {legalworkDevMode:true};
      });
    },
  });
  await new vm.Script(`(async()=>{${source}})()`).runInContext(context);
  return {events,invoke:event=>handlers.get('legalwork:desktop')(event,'isirNativeQuit'),invokeCommand:(...args)=>handlers.get('legalwork:desktop')(...args),event:{senderFrame:frame,sender:{mainFrame:frame}}};
}

test('test entry quit passes the original production guard before actual app.quit',async()=>{
  const f=await fixture();
  const result=await f.invoke(f.event);
  assert.equal(result.accepted,true);
  assert.deepEqual(f.events.slice(-3),['appBuildInfo','quit-publication','app.quit']);
  assert.equal(f.events.filter(value=>value==='app.quit').length,1);
});

test('test entry cannot quit from a malicious origin',async()=>{
  const f=await fixture(),frame={url:'https://malicious.invalid/'};
  await assert.rejects(f.invoke({senderFrame:frame,sender:{mainFrame:frame}}),/outside LegalWork/);
  assert.ok(!f.events.includes('app.quit')&&!f.events.includes('appBuildInfo')&&!f.events.includes('quit-publication'));
});

test('test entry cannot quit from a same-origin subframe or absent main frame',async()=>{
  const f=await fixture();
  await assert.rejects(f.invoke({...f.event,senderFrame:{url:origin}}),/main frame/);
  await assert.rejects(f.invoke({senderFrame:{url:origin}}),/main frame/);
  await assert.rejects(f.invoke({senderFrame:null,sender:{mainFrame:null}}),/outside LegalWork/);
  assert.ok(!f.events.includes('app.quit')&&!f.events.includes('quit-publication'));
});

for(const [name,options] of [
  ['packaged',{packaged:true}],
  ['missing owned root',{env:{LAWOSS_ISIR_NATIVE_ROOT:undefined}}],
  ['relative owned root',{env:{LAWOSS_ISIR_NATIVE_ROOT:'relative'}}],
  ['non-development',{env:{LEGALWORK_DEV_MODE:'0'}}],
  ['missing profile',{env:{LEGALWORK_ELECTRON_USERDATA:undefined}}],
  ['outside profile',{env:{LEGALWORK_ELECTRON_USERDATA:'/elsewhere/profile'}}],
])test(`test entry rejects ${name} before installing quit control`,async()=>{
  await assert.rejects(fixture(options),/isolated development profile|inside the owned test root/);
});


test('test entry preserves original handler errors and does not quit after rejection',async()=>{
  const commandError=new Error('read-only guard query rejected'),f=await fixture({commandError});
  await assert.rejects(f.invoke(f.event),error=>error===commandError);
  assert.ok(!f.events.includes('app.quit')&&!f.events.includes('quit-publication'));
});

test('test entry forwards normal desktop commands, events and arguments unchanged',async()=>{
  const f=await fixture(),argument={synthetic:true};
  const result=await f.invokeCommand(f.event,'engineInfo',argument);
  assert.equal(result.event,f.event);assert.equal(result.command,'engineInfo');assert.equal(result.args[0],argument);
  assert.ok(!f.events.includes('app.quit')&&!f.events.includes('quit-publication'));
});

// Production before-quit callback AND showShutdownScreen run unchanged in this
// model; loadURL invalidates the pending renderer evaluation before IPC return.
// It is source-only: no Electron/browser/engine/server execution.
async function shutdownNavigationFixture(t,{publish=publishNativeQuitAcceptance,strictError}={}) {
  const root=await realpath(await mkdtemp(path.join(tmpdir(),'native-quit-')));t.after(()=>rm(root,{recursive:true,force:true}));
  const child=Object.assign(new EventEmitter(),{pid:700021,exitCode:null,signalCode:null});
  const events=[],nonce='a'.repeat(64);
  const oldPath=path.join(root,'old'),moved=path.join(root,'moved');await mkdir(oldPath);
  let teardown;
  const main=await readFile(new URL('../../../../apps/desktop/electron/main.mjs',import.meta.url),'utf8');
  const screen=main.match(/function showShutdownScreen\(\) \{[\s\S]*?\n\}/)[0];
  const before=main.match(/  app.on\("before-quit", \(event\) => \{[\s\S]*?\n  \}\);/)[0];
  let onBeforeQuit,socket,evaluationId,disposed=false;
  const productionApp={on:(_event,fn)=>onBeforeQuit=fn,quit:()=>{if(disposed)return;onBeforeQuit({preventDefault(){}});}};
  const noop={dispose(){},stop(){},destroy(){},releaseAll(){}};
  const context=vm.createContext({app:productionApp,mainWindow:{isDestroyed:()=>false,show(){},webContents:{loadURL:()=>{events.push('shutdown-navigation');socket.message({id:evaluationId,error:{code:-32000,message:'Inspected target navigated or closed'}});}}},
    SHUTDOWN_SCREEN_URL:'data:synthetic-shutdown',runtimeDisposedForQuit:false,runtimeDisposeInProgress:false,appIsQuitting:false,
    recorderServiceInstance:noop,appAudioTap:noop,callOverlay:noop,systemDictation:noop,dictationHud:noop,appTray:noop,powerSessions:noop,
    disposeRuntimeBeforeQuit:async()=>{disposed=true;events.push('leader-exit');child.exitCode=0;child.emit('exit',0);},uiControlServer:{stop:async()=>{}},
  });
  vm.runInContext(`${screen}\n${before}`,context);
  const f=await fixture({env:{LAWOSS_ISIR_NATIVE_ROOT:root,LEGALWORK_ELECTRON_USERDATA:path.join(root,'profile'),LAWOSS_ISIR_NATIVE_QUIT_NONCE:nonce},quit:()=>productionApp.quit(),publisher:publish});
  class FixtureSocket extends EventTarget {
    constructor(){super();socket=this;queueMicrotask(()=>this.dispatchEvent(new Event('open')));}
    message(value){this.dispatchEvent(new MessageEvent('message',{data:JSON.stringify(value)}));}
    send(raw){const request=JSON.parse(raw);
      if(request.method!=='Runtime.evaluate'){this.message({id:request.id,result:{}});return;}
      assert.equal(request.params.expression,"window.__LEGALWORK_ELECTRON__.invokeDesktop('isirNativeQuit')");
      assert.equal(request.params.awaitPromise,true);evaluationId=request.id;
      f.invoke(f.event).then(value=>this.message({id:request.id,result:{result:{value}}}),error=>{throw error;});
    }
    close(){events.push('cdp-close');}
  }
  const originalSocket=globalThis.WebSocket;let connected;
  try {globalThis.WebSocket=FixtureSocket;connected=await connectRenderer('http://127.0.0.1:9876',async()=>({json:async()=>[{type:'page',url:origin,webSocketDebuggerUrl:'ws://127.0.0.1:9876/fixture'}]}));}
  finally {globalThis.WebSocket=originalSocket;}
  const cdp={...connected,evaluate:expression=>connected.evaluate(expression).catch(error=>{teardown=error;throw error;})};
  child.isirNativeQuitAcceptance={root,nonce,pid:child.pid};
  const driver=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const caller=driver.match(/  await stopForRelaunch\(\{[\s\S]*?\n  \}\);\n  await rename\(oldPath,moved\);/)[0];
  const run=()=>vm.runInNewContext(`(async()=>{${caller}events.push('relaunch');})()`,{stopForRelaunch:options=>stopForRelaunch({...options,platform:'darwin'}),cdp,appChild:child,readNativeQuitAcceptance,relaunchCleanupErrors:[],events,oldPath,moved,rename:async(...args)=>{await rename(...args);events.push('rename');},
    stop:async value=>{events.push('strict-stop');if(strictError)throw strictError;await stopNativeChild(value,3000,{readTable:()=>[],now:()=>0,kill:()=>{throw new Error('No signal required after verified empty table');}});},
  });
  return {run,events,root,oldPath,moved,nonce,get teardown(){return teardown;},f};
}
test('actual guarded entry and driver survive production shutdown navigation before IPC response, only after strict closure',async t=>{
  const f=await shutdownNavigationFixture(t);await f.run();
  assert.deepEqual(f.events,['shutdown-navigation','leader-exit','cdp-close','strict-stop','rename','relaunch']);
  assert.equal(f.f.events.filter(event=>event==='appBuildInfo').length,1);
  assert.equal(f.teardown.code,'ISIR_NATIVE_CDP_SHUTDOWN_NAVIGATION');
});

for(const [name,publish] of [
  ['missing',()=>{}],
  ['malformed',launch=>{publishNativeQuitAcceptance(launch);fs.writeFileSync(path.join(launch.root,`quit-acceptance-${launch.nonce}.json`),'{');}],
  ['foreign child',launch=>publishNativeQuitAcceptance({...launch,pid:launch.pid+1})],
  ['stale launch',launch=>publishNativeQuitAcceptance({...launch,nonce:'b'.repeat(64)})],
])test(`actual entry/controller ${name} receipt retains navigation identity and refuses actual folder move`,async t=>{
  // A synthetic owned file only; the real reader validates it after actual CDP
  // rejection, never a canned true/false acceptance in this seam.
  const f=await shutdownNavigationFixture(t,{publish});
  await assert.rejects(f.run(),error=>error===f.teardown);
  assert.equal(await access(f.oldPath).then(()=>true,()=>false),true);
  assert.equal(await access(f.moved).then(()=>true,()=>false),false);
  assert.deepEqual(f.events,['shutdown-navigation','leader-exit','cdp-close','strict-stop']);
});
test('actual accepted entry navigation still preserves exact strict-stop refusal and cannot move folder',async t=>{
  const strictError=new Error('strict survivor refusal'),f=await shutdownNavigationFixture(t,{strictError});
  await assert.rejects(f.run(),error=>error===strictError);
  assert.equal(await access(f.oldPath).then(()=>true,()=>false),true);assert.ok(!f.events.includes('rename'));
});
test('actual entry publication failure preserves original error and never starts normal quit',async()=>{
  const primary=new Error('synthetic receipt publication failed'),f=await fixture({publisher:()=>{throw primary;}});
  await assert.rejects(f.invoke(f.event),error=>error===primary);assert.ok(!f.events.includes('app.quit'));
});

test('actual driver launch binds a fresh nonce and expected child without mutating shared env or other launchers',async()=>{
  const { randomBytes }=await import('node:crypto');
  const driver=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const launchSource=driver.match(/const launch = \(command, args, cwd, label\) => \{[\s\S]*?\n\};/)[0];
  const calls=[],env={ONLY_SYNTHETIC:'1'},children=[];
  const run=vm.runInNewContext(`(()=>{${launchSource};return launch;})()`,{randomBytes,env,root:'/synthetic-owned',children,process:{platform:'darwin'},spawn:(command,args,options)=>{
    calls.push({command,args,options});return {pid:700000+calls.length,stdout:new EventEmitter(),stderr:new EventEmitter(),on(){}};
  }});
  const first=run('synthetic',[],'/owned','electron'),second=run('synthetic',[],'/owned','electron-relaunch'),other=run('synthetic',[],'/owned','vite');
  assert.match(first.isirNativeQuitAcceptance.nonce,/^[a-f0-9]{64}$/);assert.notEqual(first.isirNativeQuitAcceptance.nonce,second.isirNativeQuitAcceptance.nonce);
  for(const [index,child] of [first,second].entries()){
    assert.equal(child.isirNativeQuitAcceptance.pid,child.pid);assert.equal(child.isirNativeQuitAcceptance.root,'/synthetic-owned');
    assert.equal(calls[index].options.env.LAWOSS_ISIR_NATIVE_QUIT_NONCE,child.isirNativeQuitAcceptance.nonce);
  }
  assert.deepEqual(env,{ONLY_SYNTHETIC:'1'});assert.equal(calls[2].options.env,env);assert.equal(other.isirNativeQuitAcceptance,undefined);
});
