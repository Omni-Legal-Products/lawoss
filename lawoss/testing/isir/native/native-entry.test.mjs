import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { createAppUrlMatcher, guardIpcMain } from '../../../../apps/desktop/electron/app-url.mjs';

// Execute the actual entry in a controlled module shell. Only its imports are
// substituted; no Electron, main startup, file clients or subprocesses run.
const entry=await readFile(new URL('../../../../apps/desktop/scripts/isir-native-entry.mjs',import.meta.url),'utf8');
const source=entry.replace(/^import .*;\n/gm,'').replace('await import("../electron/main.mjs");','await registerProduction();');
const origin='http://127.0.0.1:5173';
async function fixture({packaged=false,env={},commandError}={}) {
  const events=[],handlers=new Map(),frame={url:origin};
  const app={isPackaged:packaged,setPath:()=>events.push('setPath'),quit:()=>events.push('app.quit')};
  const ipcMain={handle:(channel,handler)=>handlers.set(channel,handler)};
  const context=vm.createContext({app,ipcMain,dialog:{},path,
    process:{env:{LAWOSS_ISIR_NATIVE_ROOT:'/owned',LEGALWORK_DEV_MODE:'1',LEGALWORK_ELECTRON_USERDATA:'/owned/profile',...env}},
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
  assert.deepEqual(f.events.slice(-2),['appBuildInfo','app.quit']);
  assert.equal(f.events.filter(value=>value==='app.quit').length,1);
});

test('test entry cannot quit from a malicious origin',async()=>{
  const f=await fixture(),frame={url:'https://malicious.invalid/'};
  await assert.rejects(f.invoke({senderFrame:frame,sender:{mainFrame:frame}}),/outside LegalWork/);
  assert.ok(!f.events.includes('app.quit')&&!f.events.includes('appBuildInfo'));
});

test('test entry cannot quit from a same-origin subframe or absent main frame',async()=>{
  const f=await fixture();
  await assert.rejects(f.invoke({...f.event,senderFrame:{url:origin}}),/main frame/);
  await assert.rejects(f.invoke({senderFrame:{url:origin}}),/main frame/);
  await assert.rejects(f.invoke({senderFrame:null,sender:{mainFrame:null}}),/outside LegalWork/);
  assert.ok(!f.events.includes('app.quit'));
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
  assert.ok(!f.events.includes('app.quit'));
});

test('test entry forwards normal desktop commands, events and arguments unchanged',async()=>{
  const f=await fixture(),argument={synthetic:true};
  const result=await f.invokeCommand(f.event,'engineInfo',argument);
  assert.equal(result.event,f.event);assert.equal(result.command,'engineInfo');assert.equal(result.args[0],argument);
  assert.ok(!f.events.includes('app.quit'));
});
