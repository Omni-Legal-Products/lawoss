import { afterEach, expect, test } from "bun:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync, seedSessionState, __applySessionSyncEventForTest, __hasWorkspaceSessionSyncForTest, __disposeWorkspaceSessionSyncForTest, statusKey } from "../src/react-app/domains/session/sync/session-sync";

const cleanups: Array<() => Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.();getReactQueryClient().clear();useSessionActivityStore.setState({recordsByWorkspaceId:{},statusesByWorkspaceId:{}});});
async function waitFor(read:()=>boolean){for(let i=0;i<100;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}expect(read()).toBe(true);}
async function fixture(){
 let opened=0,closed=0;
 const server=createServer((request,response)=>{
  expect(request.url?.split("?")[0]).toBe("/event");expect(request.headers.authorization).toBe("Bearer synthetic-sync-token");
  response.writeHead(200,{"content-type":"text/event-stream"});response.write('data: {"type":"server.connected","properties":{}}\n\n');opened++;
  const heartbeat=setInterval(()=>response.write(': heartbeat\n\n'),50);
  response.once("close",()=>{clearInterval(heartbeat);closed++;});
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw new Error("Missing fixture address");
 const input={workspaceId:randomUUID(),baseUrl:`http://127.0.0.1:${address.port}`,legalworkToken:"synthetic-sync-token"};
 cleanups.push(async()=>{__disposeWorkspaceSessionSyncForTest(input);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const owner=ensureWorkspaceSessionSync(input),release=trackWorkspaceSessionSync(input,"session-one");
 await waitFor(()=>opened===1);
 const status=(value: {type:"idle"}|{type:"busy"}|{type:"retry";attempt:number;message:string;next:number})=>__applySessionSyncEventForTest(input,{type:"session.status",properties:{sessionID:"session-one",status:value}});
 return {input,owner,release,status,opened:()=>opened,closed:()=>closed};
}
test("known idle before untracking closes the actual unused SSE instead of retaining it for ten minutes",async()=>{
 const f=await fixture();f.status({type:"idle"});f.release();f.owner();
 expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(false);await waitFor(()=>f.closed()===1);
});
test("another workspace/session owner keeps the stream; final idle owner closes it",async()=>{
 const f=await fixture(),ownerTwo=ensureWorkspaceSessionSync(f.input),sessionTwo=trackWorkspaceSessionSync(f.input,"session-two");
 f.status({type:"idle"});__applySessionSyncEventForTest(f.input,{type:"session.status",properties:{sessionID:"session-two",status:{type:"busy"}}});
 f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
 __applySessionSyncEventForTest(f.input,{type:"session.status",properties:{sessionID:"session-two",status:{type:"idle"}}});sessionTwo();ownerTwo();
 expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(false);await waitFor(()=>f.closed()===1);
});
test("busy/retry and optimistic accepted prompts preserve the original stream, including re-track",async()=>{
 for(const state of ["busy","retry","accepted"]){
  const f=await fixture();f.status({type:"idle"});
  if(state==="accepted")useSessionActivityStore.getState().setRunStatus(f.input.workspaceId,"session-one",{type:"busy"});
  else f.status(state==="retry"?{type:"retry",attempt:1,message:"retry",next:Date.now()+1000}:{type:"busy"});
  f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
  const owner=ensureWorkspaceSessionSync(f.input),release=trackWorkspaceSessionSync(f.input,"session-one");expect(f.opened()).toBe(1);
  f.status({type:"idle"});release();owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(false);await waitFor(()=>f.closed()===1);
 }
});
test("permission/question/compaction waiting cannot be treated as an unused idle stream",async()=>{
 for(const waiting of ["permission","question","compacting"]){
  const f=await fixture();f.status({type:"idle"});
  const activity=useSessionActivityStore.getState();
  if(waiting==="compacting")activity.setCompacting(f.input.workspaceId,"session-one",true);
  else activity.setWaitingRequest(f.input.workspaceId,"session-one",waiting,"request-one",true);
  f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
 }
});
test("an old idle snapshot does not release a newer busy session",async()=>{
 const f=await fixture();f.status({type:"busy"});
 const snapshot:LegalworkSessionSnapshot={session:{id:"session-one",title:"Synthetic",version:"1",time:{created:1,updated:1}},messages:[],todos:[],status:{type:"idle"}};
 seedSessionState(f.input.workspaceId,snapshot);
 expect(getReactQueryClient().getQueryData(statusKey(f.input.workspaceId,"session-one"))).toEqual({type:"busy"});
 f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
});

test("tracked sessions keep the stream even when workspace owners release first",async()=>{
 const f=await fixture(),other=trackWorkspaceSessionSync(f.input,"session-two");f.status({type:"idle"});
 f.owner();f.release();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
 __applySessionSyncEventForTest(f.input,{type:"session.status",properties:{sessionID:"session-two",status:{type:"idle"}}});other();
 expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(false);await waitFor(()=>f.closed()===1);
});
test("unknown state and a local send error with stale idle remain conservatively retained",async()=>{
 for(const staleIdle of [false,true]){
  const f=await fixture();if(staleIdle){f.status({type:"idle"});getReactQueryClient().setQueryData(statusKey(f.input.workspaceId,"session-one"),{type:"idle"},{updatedAt:1});useSessionActivityStore.getState().setError(f.input.workspaceId,"session-one","Synthetic uncertain transport error");}
  f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
 }
});
test("same-clock local error cannot make an older idle observation conclusive",async()=>{
 const f=await fixture();f.status({type:"idle"});
 useSessionActivityStore.getState().setError(f.input.workspaceId,"session-one","Synthetic same-clock uncertainty");
 const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]["session-one"];
 getReactQueryClient().setQueryData(statusKey(f.input.workspaceId,"session-one"),{type:"idle"},{updatedAt:activity.updatedAt});
 f.release();f.owner();expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);expect(f.closed()).toBe(0);
});
