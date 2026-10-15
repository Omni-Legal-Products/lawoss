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
  // These one-unit sequence budgets must not depend on JIT or scheduler time.
  let index=0,clock=0;
  return {child,signals,observations,options:{now:()=>clock,readTable:()=>tables[Math.min(index++,tables.length-1)],kill:(pid,signal)=>{signals.push([pid,signal]);if(pid===child.pid)child.signalCode=signal},observe:value=>{observations.push(value);if(value.stage.endsWith('-wait'))clock+=1;}}};
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

test('TERM recheck retains and freshly signals a late member before the final original anchor exits',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003),f=sequenceFixture([]);
  let reads=0;
  f.options.readTable=()=>{
    if(++reads<=2)return [a,b];
    if(reads===3)return [a,b,c];
    if(f.signals.some(([pid])=>pid===a.pid))return f.signals.some(([pid])=>pid===c.pid)?[]:[c];
    return [a,c];
  };
  await stopNativeChild(f.child,100,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[c.pid,'SIGTERM'],[a.pid,'SIGTERM']]);
  assert.equal(f.observations.filter(o=>o.stage==='signal-recheck').length,3);
});

// Expire graceful waiting deterministically, leaving the force phase its own
// unchanged one-unit budget. The identity table and signal boundary stay real
// helper calls; only external ps/kill and the monotonic clock are controlled.
function forceFixture(snapshot){
  const a=identity(700001),b=identity(700002),f=sequenceFixture([]);
  let force=false,clock=0,reads=0;
  f.options.now=()=>clock;
  f.options.readTable=()=>force?snapshot(f,++reads):[a,b];
  f.options.observe=value=>{
    f.observations.push(value);
    if(value.stage==='term-wait')clock=2;
    if(value.stage==='kill-signal')force=true;
  };
  return f;
}

test('force rechecks admit late identities and give each a separate fresh positive-PID signal',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003),d=identity(700004);
  const f=forceFixture((f,read)=>{
    if(read===1)return [a,b,c];
    if(f.signals.some(([pid,kind])=>pid===a.pid&&kind==='SIGKILL'))return [c,d].filter(row=>!f.signals.some(([pid,kind])=>pid===row.pid&&kind==='SIGKILL'));
    return [a,c,d];
  });
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL'],[c.pid,'SIGKILL'],[d.pid,'SIGKILL'],[a.pid,'SIGKILL']]);
  assert.equal(f.observations.filter(o=>o.stage==='signal-recheck').length,6);
});

test('force wait newly admitted member gets its own fresh force signal',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003);
  const f=forceFixture((f,read)=>{
    if(read<=2)return [a,b];
    if(read===3)return [b,c];
    return f.signals.some(([pid,kind])=>pid===c.pid&&kind==='SIGKILL')?[]:[c];
  });
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL'],[a.pid,'SIGKILL'],[c.pid,'SIGKILL']]);
});

test('force recheck refuses a member first seen after every known anchor disappears',{skip:process.platform==='win32'},async()=>{
  const c=identity(700003),f=forceFixture(()=>[c]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/unverified surviving group members/);
  assert.deepEqual(f.signals,[[700002,'SIGTERM'],[700001,'SIGTERM']]);
});

test('late queued PID replacement requires another fresh recheck before any force signal',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003),replacement=identity(c.pid,{start:'replacement-birth'});
  const f=forceFixture((f,read)=>{
    if(read===1)return [a,b,c];
    if(read===2)return [a,replacement];
    if(f.signals.some(([pid,kind])=>pid===a.pid&&kind==='SIGKILL'))return [];
    return [a];
  });
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL'],[a.pid,'SIGKILL']]);
});

test('anchored late PID replacement can signal only as a distinct freshly checked identity',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003),replacement=identity(c.pid,{start:'replacement-birth'});
  const f=forceFixture((f,read)=>{
    if(read===1)return [a,b,c];
    if(read<=3)return [a,replacement];
    return f.signals.some(([pid,kind])=>pid===c.pid&&kind==='SIGKILL')?[]:[replacement];
  });
  await stopNativeChild(f.child,1,f.options);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL'],[a.pid,'SIGKILL'],[c.pid,'SIGKILL']]);
  assert.equal(f.observations.filter(o=>o.stage==='signal-recheck').length,6,'The replaced identity cannot use its predecessor recheck');
});

test('late PID replacement first seen after anchor loss cannot borrow its predecessor identity',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003),replacement=identity(c.pid,{start:'replacement-birth'});
  const f=forceFixture((_f,read)=>read===1?[a,b,c]:[replacement]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/unverified surviving group members/);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL']]);
});

test('force recheck refuses an admitted late member moving groups',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),c=identity(700003);
  const f=forceFixture((_f,read)=>read===1?[a,b,c]:[a,{...c,group:800001}]);
  await assert.rejects(stopNativeChild(f.child,1,f.options),/changed group/);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM'],[b.pid,'SIGKILL']]);
});

test('force discovery and signals share one finite phase deadline',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([]),signalTimes=[];
  let clock=0,force=false,reads=0;
  f.options.now=()=>clock;
  f.options.observe=value=>{f.observations.push(value);if(value.stage==='term-wait')clock=10;if(value.stage==='kill-signal')force=true;};
  f.options.readTable=()=>{
    if(!force)return [a,b];
    clock+=1;
    return [a,b,...Array.from({length:++reads},(_,i)=>identity(700003+i))];
  };
  f.options.kill=(pid,kind)=>{f.signals.push([pid,kind]);if(kind==='SIGKILL'){signalTimes.push(clock);clock+=3;}if(pid===a.pid)f.child.signalCode=kind;};
  await assert.rejects(stopNativeChild(f.child,5,f.options),/did not exit/);
  assert.ok(signalTimes.length>0,'Verified force attempts occur before the budget expires');
  assert.ok(signalTimes.every(time=>time<15),'Discovery time consumes the same force budget as signals and waiting');
  assert.ok(reads<=6,'Continuous anchored discovery cannot extend the phase');
  assert.ok(f.signals.every(([pid])=>pid>0));
});

test('continuous anchored discovery cannot reset the force deadline',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([]);
  let clock=0,force=false,reads=0;
  f.options.now=()=>clock;
  f.options.observe=value=>{if(value.stage==='term-wait')clock=10;if(value.stage==='kill-signal')force=true;};
  f.options.readTable=()=>{
    if(!force)return [a,b];
    clock+=1;
    assert.ok(++reads<=5,'A new anchored identity on every read must not create an unlimited drain');
    return [a,b,...Array.from({length:reads},(_,i)=>identity(700003+i))];
  };
  await assert.rejects(stopNativeChild(f.child,5,f.options),/did not exit/);
  assert.deepEqual(f.signals.filter(([,kind])=>kind==='SIGKILL'),[[b.pid,'SIGKILL'],[700003,'SIGKILL'],[700004,'SIGKILL'],[700005,'SIGKILL']]);
});

test('force initial inspection consumes its original signal and wait budget',{skip:process.platform==='win32'},async()=>{
  const a=identity(700001),b=identity(700002),f=sequenceFixture([]);
  let clock=0;
  f.options.now=()=>clock;
  f.options.readTable=()=>[a,b];
  f.options.observe=value=>{if(value.stage==='term-wait')clock=10;if(value.stage==='kill-signal')clock=15;};
  await assert.rejects(stopNativeChild(f.child,5,f.options),/did not exit/);
  assert.deepEqual(f.signals,[[b.pid,'SIGTERM'],[a.pid,'SIGTERM']]);
});
