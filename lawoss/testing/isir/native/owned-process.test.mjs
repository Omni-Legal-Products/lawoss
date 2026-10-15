import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { stopNativeChild } from './owned-process.mjs';

// A terminated orphan may await init's reap on Linux; a zombie cannot execute
// or hold the inherited pipes. Inspect only the PID this fixture created.
const isRunning = pid => {
  const result=spawnSync('/bin/ps',['-p',String(pid),'-o','stat='],{encoding:'utf8'});
  if(result.error)throw result.error;
  const state=result.stdout.trim();
  return Boolean(state)&&!state.startsWith('Z');
};
async function stopFixtureDescendant(pid) {
  if(!pid||!isRunning(pid))return;
  try {process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}
  const deadline=Date.now()+1000;
  while(isRunning(pid)&&Date.now()<deadline)await new Promise(resolve=>setTimeout(resolve,20));
  assert.equal(isRunning(pid),false,'Fixture descendant cleanup must terminate its known PID');
}


test('already exited native child is not signalled again',async()=>{
  const child=spawn(process.execPath,['-e','process.exit(0)'],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  await once(child,'exit');await stopNativeChild(child,100);
  assert.equal(child.exitCode,0);
});
test('native child that ignores graceful stop is awaited through force stop',async()=>{
  const child=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log('ready');setInterval(()=>{},1000)"],{detached:process.platform!=='win32',stdio:['ignore','pipe','pipe']});
  try {await once(child.stdout,'data');await stopNativeChild(child,100);assert.ok(child.exitCode!==null||child.signalCode!==null);}
  finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');}
});

test('cleanup waits for the owned descendant after its leader exits on SIGTERM', {skip:process.platform==='win32',timeout:10000}, async()=>{
  const script = `const {spawn}=require('node:child_process');
const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});console.log(process.pid);setInterval(()=>{},1000)"],{stdio:['ignore','inherit','inherit']});
setInterval(()=>{},1000);`;
  const leader=spawn(process.execPath,['-e',script],{detached:true,stdio:['ignore','pipe','pipe']});
  let descendant;
  try {
    descendant=Number(String((await once(leader.stdout,'data'))[0]).trim());
    assert.ok(Number.isInteger(descendant)&&descendant>0);
    await stopNativeChild(leader,100);
    assert.equal(leader.signalCode,'SIGTERM');
    assert.equal(isRunning(descendant),false,'Owned same-group descendant must not survive resolved cleanup');
  }finally{
    await stopFixtureDescendant(descendant);
    if(leader.exitCode===null&&leader.signalCode===null)leader.kill('SIGKILL');
    leader.stdout.destroy();leader.stderr.destroy();
  }
});

test('an already-exited leader with unverified survivors fails cleanup without signalling them', {skip:process.platform==='win32',timeout:10000},async()=>{
  const script=`const {spawn}=require('node:child_process');
const descendant=spawn(process.execPath,['-e',"process.on('SIGTERM',()=>{});process.send('ready');setInterval(()=>{},1000)"],{stdio:['ignore','ignore','ignore','ipc']});
descendant.once('message',()=>{console.log(descendant.pid);process.exit(0)});`;
  const leader=spawn(process.execPath,['-e',script],{detached:true,stdio:['ignore','pipe','pipe']});
  const exit=once(leader,'exit');let descendant;
  try {
    descendant=Number(String((await once(leader.stdout,'data'))[0]).trim());
    assert.ok(Number.isInteger(descendant)&&descendant>0);await exit;
    await assert.rejects(stopNativeChild(leader,100),/unverified surviving group members/);
    assert.doesNotThrow(()=>process.kill(descendant,0),'Unverified process must not be signalled by cleanup');
  }finally{
    await stopFixtureDescendant(descendant);
    if(leader.exitCode===null&&leader.signalCode===null)leader.kill('SIGKILL');
    leader.stdout.destroy();leader.stderr.destroy();
  }
});

test('a non-detached child does not authorize signals to the callers shared group', {skip:process.platform==='win32'},async()=>{
  const child=spawn(process.execPath,['-e',"console.log('ready');setInterval(()=>{},1000)"],{stdio:['ignore','pipe','pipe']});
  try {
    await once(child.stdout,'data');
    await assert.rejects(stopNativeChild(child,100),/ownership could not be established/);
    assert.doesNotThrow(()=>process.kill(child.pid,0));
  }finally{const exit=once(child,'exit');child.kill('SIGKILL');await exit;child.stdout.destroy();child.stderr.destroy();}
});

// Deterministic identity tables establish the existing safety policy; they do
// not establish which unknown real member appeared in the macOS CI run.
const identity=(pid,extra={})=>({pid,parent:process.pid,group:700001,uid:process.getuid?.()??0,start:'synthetic-birth',running:true,...extra});
function sequenceFixture(tables){
  const child={pid:700001,exitCode:null,signalCode:null},signals=[],observations=[];
  let index=0;
  return {child,signals,observations,options:{readTable:()=>tables[Math.min(index++,tables.length-1)],kill:(pid,signal)=>{signals.push([pid,signal]);if(pid===child.pid)child.signalCode=signal},observe:value=>observations.push(value)}};
}

test('sequence captures a late member only with a living anchor and rechecks each PID before signalling',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003);
  const f=sequenceFixture([[a,b],[a,b,c],[a,b,c],[a,b,c],[a,b,c],[]]);
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[c.pid,'SIGTERM'],[a.pid,'SIGTERM']]);
  assert.ok(f.observations.some(o=>o.unknown===1&&o.anchored));
  assert.equal(f.observations.filter(o=>o.stage==='signal-recheck').length,3);
});

test('sequence refuses unanchored late survivor and records census before rejection',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([[a],[a],[a],[b]]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/unverified surviving group members/);
  assert.deepEqual(f.signals,[[a.pid,'SIGTERM']]);
  assert.ok(f.observations.some(o=>o.unknown===1&&o.knownLive===0&&!o.anchored&&o.leaderExited));
});

test('sequence never signals a reused captured PID after identity changed at individual recheck',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),reused=identity(b.pid,{start:'other-birth'});
  const f=sequenceFixture([[a,b],[a,b],[a,reused],[a],[]]);
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[a.pid,'SIGTERM']]);
  assert.ok(f.observations.some(o=>o.stage==='signal-recheck'&&o.mismatched===1));
});

test('sequence refuses moved owned identity before any signal',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([[a,b],[a,{...b,group:800001}]]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/changed group/);
  assert.deepEqual(f.signals,[]);assert.ok(f.observations.some(o=>o.moved===1));
});

test('sequence preserves already-exited leader and non-detached ownership refusal',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([[b]]);f.child.exitCode=0;
  await assert.rejects(stopNativeChild(f.child,1,f.options),/Exited native leader/);assert.deepEqual(f.signals,[]);
  const g=sequenceFixture([[{...a,parent:999999}]]);
  await assert.rejects(stopNativeChild(g.child,1,g.options),/ownership could not be established/);assert.deepEqual(g.signals,[]);
});

test('sequence retains a captured descendant anchor after leader exit and force-signals only verified survivors',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003);
  const f=sequenceFixture([[a,b],[a,b],[a,b],[a,b],[b,c],[b,c],[b,c],[b,c],[c],[]]);
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL'],[c.pid,'SIGKILL']]);
  assert.ok(f.observations.some(o=>o.stage==='term-wait'&&o.leaderExited&&o.unknown===1&&o.anchored));
});

test('sequence rejects group/PID reuse after all captured identities disappear',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),reused=identity(a.pid,{start:'different-birth'}),f=sequenceFixture([[a],[reused]]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/unverified surviving group members/);
  assert.deepEqual(f.signals,[]);assert.ok(f.observations.some(o=>o.mismatched===1&&!o.anchored));
  assert.equal(f.observations[0].anchored,false,'A pre-validation capture never claims verified ownership');
});
