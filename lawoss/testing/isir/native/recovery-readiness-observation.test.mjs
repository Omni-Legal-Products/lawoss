import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createNativeDiagnostics, observeNativeLifecycle } from './diagnostics.mjs';
import { until as nativeUntil } from './cdp.mjs';

const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
function extract(label){
  const begin=`// BEGIN ${label}`,end=`// END ${label}`;
  assert.equal(source.split(begin).length,2);assert.equal(source.split(end).length,2);
  const a=source.indexOf(begin)+begin.length,b=source.indexOf(end);assert.ok(b>a);
  return source.slice(a,b);
}
function factory(label,bindings,returned){return new Function(...Object.keys(bindings),`${extract(label)}\nreturn ${returned};`)(...Object.values(bindings));}
async function fixture(t,{throwAt=null,throwOccurrence=1,mismatch=null,ready=true,observerThrows=false}={}){
  const root=await mkdtemp(path.join(tmpdir(),'recovery-predicate-unit-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const outputFile=path.join(root,'diagnostics.json'),diagnostics=createNativeDiagnostics({enabled:true,ci:true,mode:'synthetic',outputFile});
  const order=[],sentinel=new Proxy(Object.create(null),{get(){throw new Error('Unexpected original error read');}});
  const occurrences=new Map();
  const step=(key,value)=>{order.push(key);const occurrence=(occurrences.get(key)??0)+1;occurrences.set(key,occurrence);if(key===throwAt&&occurrence===throwOccurrence)throw sentinel;return key===mismatch?'WRONG':value;};
  const tracked=(prefix,fields)=>new Proxy(fields,{get(object,key){return step(`${prefix}.${String(key)}`,object[key]);}});
  const state=tracked('state',{sessionId:'s',directoryMapping:tracked('mapping',{hostDirectory:'/moved',guestDirectory:'/tmp/home/protected-engine/workspace',rootIdentity:'root'}),legalApproval:false,runtimeState:ready?'ready':'restoring'});
  const response=tracked('response',{status:200,json:async()=>{step('json-call');return state;}});
  const evidence=tracked('evidence',{0:tracked('expected',{sessionId:'s'})});
  const recoveredTransport=tracked('recovered',{directoryMapping:tracked('expectedMapping',{rootIdentity:'root'})});
  const engineRequest=async url=>{step('request');assert.equal(url,'/session/s/protected-transport');return response;};
  const assertion={equal:(...args)=>{step('assert');assert.equal(...args);}};
  const actualObserver=diagnostics.recoveryReadiness;
  if(observerThrows)diagnostics.recoveryReadiness=()=>{throw sentinel;};
  const predicate=factory('RECOVERY_READINESS_PREDICATE',{engineRequest,evidence,moved:'/moved',recoveredTransport,diagnostics,observeNativeLifecycle,assert:assertion},'readRecoveredRuntimeForNativeReadiness');
  const wrapper=(helper=nativeUntil)=>factory('RECOVERY_READINESS_UNTIL',{nativeUntil:helper,protectedApprovals:tracked('approvals',{check:()=>step('approval-call')}),observeNativeLifecycle},'until');
  const snapshot=async()=>{await diagnostics.write();return JSON.parse(await readFile(outputFile,'utf8')).recoveryReadinessObservation;};
  return {predicate,wrapper,diagnostics,actualObserver,order,sentinel,snapshot,setReady(value){state.runtimeState=value?'ready':'restoring';}};
}
const reads=['approvals.check','approval-call','evidence.0','expected.sessionId','request','response.then','response.status','assert','response.json','json-call','state.then','state.sessionId','evidence.0','expected.sessionId','assert','state.directoryMapping','mapping.hostDirectory','assert','state.directoryMapping','mapping.guestDirectory','assert','state.directoryMapping','mapping.rootIdentity','recovered.directoryMapping','expectedMapping.rootIdentity','assert','state.legalApproval','assert','state.runtimeState'];
const paths=[['approvals.check','approval-check',0,false],['approval-call','approval-check',0,false],['evidence.0','transport-request',0,true],['expected.sessionId','transport-request',0,true],['request','transport-request',0,true],['response.then','transport-request',0,true],['response.status','status-check',1,true],['response.json','transport-body',2,true],['json-call','transport-body',2,true],['state.then','transport-body',2,true],['state.sessionId','session-check',3,true],['state.directoryMapping','host-directory-check',4,true],['mapping.hostDirectory','host-directory-check',4,true],['mapping.guestDirectory','guest-directory-check',5,true],['mapping.rootIdentity','root-identity-check',6,true],['recovered.directoryMapping','root-identity-check',6,true],['expectedMapping.rootIdentity','root-identity-check',6,true],['state.legalApproval','legal-approval-check',7,true],['state.runtimeState','runtime-state-check',8,true]];

test('actual named arrow preserves ordered original accessor reads, asserts, JSON and boolean result',async t=>{
  for(const ready of [false,true]){
    const f=await fixture(t,{ready});const until=f.wrapper(async read=>read());
    assert.equal(await until(f.predicate,'inert',240000,f.actualObserver),ready);
    assert.deepEqual(f.order,reads);
    const row=await f.snapshot();assert.equal(row.attempts,1);assert.equal(row.last.completedPrefix,9);assert.equal(row.last.outcome,ready?'ready':'not-ready');
  }
});
test('actual named arrow and approval wrapper preserve every thrown sentinel without reading it',async t=>{
  for(const [throwAt,boundary,completedPrefix,enteredPredicate] of paths){
    const f=await fixture(t,{throwAt});let caught;
    await f.wrapper(async read=>read())(f.predicate,'inert',240000,f.actualObserver).catch(e=>{caught=e;});
    assert.equal(caught,f.sentinel);assert.deepEqual(f.order,reads.slice(0,reads.indexOf(throwAt)+1));
    assert.deepEqual((await f.snapshot()).last,{attempt:1,enteredPredicate,boundary,completedPrefix,outcome:'threw'});
  }
});
test('original assertions still reject at each boundary and stop subsequent reads',async t=>{
  for(const [mismatch,boundary,prefix] of [['response.status','status-check',1],['state.sessionId','session-check',3],['mapping.hostDirectory','host-directory-check',4],['mapping.guestDirectory','guest-directory-check',5],['mapping.rootIdentity','root-identity-check',6],['state.legalApproval','legal-approval-check',7]]){
    const f=await fixture(t,{mismatch});await assert.rejects(f.wrapper(async read=>read())(f.predicate,'inert',240000,f.actualObserver),{code:'ERR_ASSERTION'});
    const last=(await f.snapshot()).last;assert.equal(last.boundary,boundary);assert.equal(last.completedPrefix,prefix);assert.equal(last.outcome,'threw');
    const start=reads.indexOf(mismatch),end=reads.indexOf('assert',start)+1;assert.deepEqual(f.order,reads.slice(0,end));
  }
});
test('actual wrapper retains read promise adoption and contains synchronous observer throws',async t=>{
  const f=await fixture(t,{observerThrows:true});
  assert.equal(await f.wrapper(async read=>read())(f.predicate,'inert',240000,f.diagnostics.recoveryReadiness),true);assert.deepEqual(f.order,reads);
  assert.match(extract('RECOVERY_READINESS_UNTIL'),/return read\(\);/);assert.doesNotMatch(extract('RECOVERY_READINESS_UNTIL'),/return await read/);
});
test('actual unchanged wait helper retries approval refusal, original false comparison and then readiness',async t=>{
  const f=await fixture(t);let attempt=0;
  const until=factory('RECOVERY_READINESS_UNTIL',{nativeUntil,protectedApprovals:{check(){if(++attempt===1)throw new Error('inert approval');f.setReady(attempt===3);}},observeNativeLifecycle},'until');
  assert.equal(await until(f.predicate,'inert actual helper',2000,f.actualObserver),true);
  const row=await f.snapshot();assert.equal(row.attempts,3);assert.equal(row.first.enteredPredicate,false);assert.equal(row.first.outcome,'threw');assert.equal(row.last.outcome,'ready');
});
test('original wait call observes original result/error and retains production budgets and independent inference',async t=>{
  const f=await fixture(t),block=extract('RECOVERY_READINESS_WAIT');
  const execute=new Function('until','readRecoveredRuntimeForNativeReadiness','diagnostics','observeNativeLifecycle',`return (async()=>{${block}})()`);
  const original=Object.freeze({result:'original'});let captured;
  await execute(async(read,description,timeout,observer)=>{captured={read,description,timeout,observer};observer('begin');return original;},f.predicate,f.diagnostics,observeNativeLifecycle);
  assert.equal(captured.read,f.predicate);assert.equal(captured.timeout,240000);assert.equal(captured.observer,f.actualObserver);assert.equal((await f.snapshot()).waitOutcome,'returned');
  let caught;await execute(async()=>{throw f.sentinel;},f.predicate,f.diagnostics,observeNativeLifecycle).catch(e=>{caught=e;});assert.equal(caught,f.sentinel);assert.equal((await f.snapshot()).waitOutcome,'threw');
  assert.match(source,/'real engine executes a fresh scoped document read after native reconnect',60000/);
  assert.match(source,/stopNativeChild\(child,3000,\{observe:diagnostics.ownedProcess\}\)/);
  assert.match(source,/diagnostics\.recoveryStage\('fresh-poll'\)/);
});

test('repeated original expected and directory-mapping getters and each assertion retain their individual failure position',async t=>{
  const cases=[['evidence.0',2,'session-check',3],['expected.sessionId',2,'session-check',3],['state.directoryMapping',2,'guest-directory-check',5],['state.directoryMapping',3,'root-identity-check',6],
    ...['status-check','session-check','host-directory-check','guest-directory-check','root-identity-check','legal-approval-check'].map((boundary,i)=>['assert',i+1,boundary,[1,3,4,5,6,7][i]])];
  for(const [throwAt,throwOccurrence,boundary,completedPrefix] of cases){
    const f=await fixture(t,{throwAt,throwOccurrence});let caught;
    await f.wrapper(async read=>read())(f.predicate,'inert',240000,f.actualObserver).catch(e=>{caught=e;});assert.equal(caught,f.sentinel);
    let count=0;const index=reads.findIndex(key=>key===throwAt&&++count===throwOccurrence);assert.deepEqual(f.order,reads.slice(0,index+1));
    assert.deepEqual((await f.snapshot()).last,{attempt:1,enteredPredicate:true,boundary,completedPrefix,outcome:'threw'});
  }
});
