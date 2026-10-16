import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { stopNativeChild } from './owned-process.mjs';
import { stopForRelaunch } from './relaunch-stop.mjs';

const refusal = 'Native cleanup found unverified surviving group members';
// Controlled producer model only: no OS table, kill, subprocess or native app.
// TERM leaves the producer active; force loses its last anchors before a late
// birth becomes visible, while the leader exit event is still pending.
function producerModel() {
  const child=Object.assign(new EventEmitter(),{pid:700001,exitCode:null,signalCode:null});
  const row=pid=>({pid,parent:process.pid,group:child.pid,uid:process.getuid?.()??0,start:'synthetic-birth',running:true});
  const original=Array.from({length:5},(_,i)=>row(child.pid+i));
  const events=[],signals=[],observations=[];
  let drained=false,force=false,clock=0;
  const inspection={
    now:()=>clock,
    readTable:()=>drained?[]:force?[row(700010)]:original,
    kill:(pid,kind)=>signals.push([pid,kind]),
    observe:value=>{observations.push(value);if(value.stage==='term-wait')clock=3001;if(value.stage==='kill-signal')force=true;},
  };
  return {platform:'darwin',child,events,signals,observations,
    requestQuit:async()=>{events.push('quit-request');drained=true;events.push('producer-drained');child.exitCode=0;child.emit('exit',0);},
    closeCdp:()=>events.push('cdp-close'),
    stop:async value=>{events.push('strict-stop');await stopNativeChild(value,3000,inspection);events.push('closure-proved');},
  };
}
const posix={skip:process.platform==='win32'};

test('control: force refusal retains unknown survivor and pending leader exit',posix,async()=>{
  const f=producerModel();
  await assert.rejects(f.stop(f.child),{message:refusal});
  assert.ok(f.observations.some(o=>o.knownLive===5&&o.unknown===0));
  assert.ok(f.observations.some(o=>o.knownLive===0&&o.unknown===1&&!o.anchored&&!o.leaderExited));
  assert.ok(f.signals.every(([pid,kind])=>pid>0&&pid!==700010&&kind==='SIGTERM'));
});

test('actual relaunch caller requests ordinary quit and drain before strict closure and rename',posix,async()=>{
  const f=producerModel();
  try {
    await stopForRelaunch(f);
    f.events.push('rename','relaunch');
  } catch(error) {
    assert.equal(error.message,refusal,'The baseline must fail at the actual owned-process refusal');
    assert.ok(!f.events.includes('rename')&&!f.events.includes('relaunch'));
    throw error;
  }
  assert.deepEqual(f.events,['quit-request','producer-drained','cdp-close','strict-stop','closure-proved','rename','relaunch']);
});

function windowClock() {
  let expire;
  const durations=[],cleared=[];
  return {durations,cleared,setTimer:(callback,ms)=>{durations.push(ms);expire=callback;return 1;},clearTimer:id=>cleared.push(id),expire:()=>expire()};
}

test('acknowledgement without drain uses one fixed window then still refuses unknown survivors',posix,async()=>{
  const f=producerModel(),clock=windowClock();
  f.requestQuit=async()=>f.events.push('quit-acknowledged');
  const pending=stopForRelaunch({...f,...clock});
  const refused=assert.rejects(pending,{message:refusal});
  await Promise.resolve();await Promise.resolve();
  assert.deepEqual(f.events,['quit-acknowledged'],'Acknowledgement must not authorize early strict stop or movement');
  clock.expire();await refused;
  assert.deepEqual(clock.durations,[3000]);assert.deepEqual(clock.cleared,[1]);
  assert.equal(f.child.listenerCount('exit'),0);
  assert.ok(!f.events.includes('closure-proved'));
  assert.ok(f.signals.every(([pid])=>pid>0&&pid!==700010));
});

test('request rejection retains primary identity and ordered close/strict failures',async()=>{
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});
  const primary=new Error('request failed'),close=new Error('close failed'),strict=new Error('strict failed');
  const events=[],cleanupFailures=[],clock=windowClock();
  await assert.rejects(stopForRelaunch({platform:'darwin',child,...clock,cleanupFailures,
    requestQuit:async()=>{events.push('request');throw primary;},
    closeCdp:()=>{events.push('close');throw close;},
    stop:async()=>{events.push('stop');throw strict;},
  }),error=>error===primary);
  assert.deepEqual(events,['request','close','stop']);assert.deepEqual(cleanupFailures,[close,strict]);
  assert.deepEqual(clock.durations,[3000]);assert.deepEqual(clock.cleared,[1]);assert.equal(child.listenerCount('exit'),0);
});

test('drain rejection still attempts strict owned cleanup without hiding the rejection',posix,async()=>{
  const f=producerModel(),primary=new Error('modeled drain rejection'),cleanupFailures=[];
  f.requestQuit=async()=>{f.events.push('quit-request');throw primary;};
  await assert.rejects(stopForRelaunch({...f,cleanupFailures}),error=>error===primary);
  assert.deepEqual(f.events,['quit-request','cdp-close','strict-stop']);
  assert.equal(cleanupFailures.length,1);assert.equal(cleanupFailures[0].message,refusal);
  assert.ok(!f.events.includes('closure-proved'));
});

test('already-exited leader plus survivor remains refusal after quit acknowledgement',posix,async()=>{
  const f=producerModel();f.child.exitCode=0;
  f.requestQuit=async()=>f.events.push('quit-acknowledged');
  await assert.rejects(stopForRelaunch(f),/Exited native leader has unverified surviving group members/);
  assert.deepEqual(f.signals,[]);assert.ok(!f.events.includes('closure-proved'));
});

test('an unanswered request cannot restart its single window or skip strict closure',async()=>{
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null}),clock=windowClock(),events=[];
  const pending=stopForRelaunch({platform:'darwin',child,...clock,
    requestQuit:()=>{events.push('request');return new Promise(()=>{});},
    closeCdp:()=>events.push('close'),stop:async()=>events.push('strict-closure'),
  });
  await Promise.resolve();assert.deepEqual(events,['request']);
  clock.expire();await pending;
  assert.deepEqual(events,['request','close','strict-closure']);
  assert.deepEqual(clock.durations,[3000]);assert.equal(child.listenerCount('exit'),0);
});

test('leader exit without request acknowledgement waits only the same window',async()=>{
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null}),clock=windowClock(),events=[];
  const pending=stopForRelaunch({platform:'darwin',child,...clock,
    requestQuit:()=>{child.exitCode=0;child.emit('exit',0);return new Promise(()=>{});},
    closeCdp:()=>events.push('close'),stop:async()=>events.push('strict-closure'),
  });
  await Promise.resolve();await Promise.resolve();assert.deepEqual(events,[]);
  clock.expire();await pending;
  assert.deepEqual(events,['close','strict-closure']);assert.deepEqual(clock.durations,[3000]);
});

// Model the unchanged Windows stop contract without replacing process.platform
// or running taskkill: an exited leader returns before descendant action.
function windowsModel({stopError}={}) {
  const child=Object.assign(new EventEmitter(),{exitCode:null,signalCode:null});
  const events=[];
  let descendantAlive=true;
  return {...windowClock(),platform:'win32',child,events,descendantAlive:()=>descendantAlive,
    requestQuit:async()=>{events.push('quit');child.exitCode=0;child.emit('exit',0);},
    closeCdp:()=>events.push('cdp-close'),
    stop:async()=>{
      if(child.exitCode!==null||child.signalCode!==null){events.push('stop-early-return');return;}
      events.push('strict-stop-live');
      if(stopError)throw stopError;
      descendantAlive=false;child.exitCode=0;child.emit('exit',0);
    },
  };
}

test('Windows preserves close then stop with a live leader instead of inducing the exited-leader bypass',async()=>{
  const f=windowsModel();
  await stopForRelaunch(f);f.events.push('rename');
  assert.deepEqual(f.events,['cdp-close','strict-stop-live','rename']);
  assert.equal(f.descendantAlive(),false);
  assert.deepEqual(f.durations,[]);assert.equal(f.child.listenerCount('exit'),0);
});

test('Windows strict-stop refusal retains its identity and blocks rename',async()=>{
  const primary=new Error('modeled strict Windows stop refused'),f=windowsModel({stopError:primary});
  await assert.rejects((async()=>{await stopForRelaunch(f);f.events.push('rename');})(),error=>error===primary);
  assert.deepEqual(f.events,['cdp-close','strict-stop-live']);
  assert.equal(f.descendantAlive(),true);
  assert.deepEqual(f.durations,[]);assert.equal(f.child.listenerCount('exit'),0);
});

test('Windows close rejection still attempts stop and retains both ordered failures',async()=>{
  const closeError=new Error('modeled CDP close failed'),stopError=new Error('modeled Windows stop failed');
  const f=windowsModel({stopError}),cleanupFailures=[];
  f.closeCdp=()=>{f.events.push('cdp-close');throw closeError;};
  await assert.rejects(stopForRelaunch({...f,cleanupFailures}),error=>error===closeError);
  assert.deepEqual(f.events,['cdp-close','strict-stop-live']);
  assert.deepEqual(cleanupFailures,[closeError,stopError]);
  assert.deepEqual(f.durations,[]);assert.equal(f.child.listenerCount('exit'),0);
  assert.equal(f.descendantAlive(),true);
});
