import { afterEach, expect, test } from "bun:test";
import { QueryObserver } from "@tanstack/react-query";
import { createServer, type ServerResponse } from "node:http";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { randomUUID } from "node:crypto";
import { applyDocumentGenerationRunStatus, clearDocumentGenerationsForTest, getDocumentGeneration, observeDocumentGeneration, submitBoundDocumentGeneration } from "../src/react-app/domains/session/panel/document-generation-lifecycle";
import { createLegalworkServerClient, type LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync, seedSessionState, injectSessionErrorMessage, __applySessionSyncEventForTest, __hasWorkspaceSessionSyncForTest, __disposeWorkspaceSessionSyncForTest, snapshotKey, statusKey, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";

const cleanups: Array<() => Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.();getReactQueryClient().clear();clearDocumentGenerationsForTest();useSessionActivityStore.setState({recordsByWorkspaceId:{},statusesByWorkspaceId:{}});});
async function waitFor(read:()=>boolean){for(let i=0;i<100;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}expect(read()).toBe(true);}
async function fixture(options: { gcTime?: number; workspaceId?: string; directory?: string; token?: string; snapshot?: LegalworkSessionSnapshot } = {}){
 let opened=0,closed=0,ready=false;
 const responses = new Set<ServerResponse>();
 const token = options.token ?? "synthetic-sync-token";
 const workspaceId = options.workspaceId ?? randomUUID();
 const server=createServer((request,response)=>{
  if (request.url === `/workspace/${encodeURIComponent(workspaceId)}/sessions/session-one/snapshot` && options.snapshot) {
   expect(request.headers.authorization).toBe(`Bearer ${token}`);
   response.writeHead(200,{"content-type":"application/json"});
   response.end(JSON.stringify({item:options.snapshot}));
   return;
  }
  expect(request.url?.split("?")[0]).toBe("/event");expect(request.headers.authorization).toBe(`Bearer ${token}`);
  if(options.snapshot && options.directory) expect(new URL(request.url ?? "", "http://fixture").searchParams.get("directory")).toBe(options.directory);
  response.writeHead(200,{"content-type":"text/event-stream"});response.write('data: {"type":"server.connected","properties":{}}\n\n');opened++;responses.add(response);
  response.write('data: {"type":"session.status","properties":{"sessionID":"fixture-ready","status":{"type":"idle"}}}\n\n');
  const heartbeat=setInterval(()=>response.write(': heartbeat\n\n'),50);
  response.once("close",()=>{clearInterval(heartbeat);responses.delete(response);closed++;});
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw new Error("Missing fixture address");
 const input={workspaceId,baseUrl:`http://127.0.0.1:${address.port}`,legalworkToken:token,directory:options.directory,onSessionStatus:(event:{sessionId:string})=>{if(event.sessionId==="fixture-ready")ready=true;}};
 if(options.gcTime !== undefined){
  const client = getReactQueryClient();
  client.setQueryDefaults(statusKey(input.workspaceId,"session-one"), {gcTime:options.gcTime});
  client.setQueryDefaults(transcriptKey(input.workspaceId,"session-one"), {gcTime:options.gcTime});
 }
 cleanups.push(async()=>{__disposeWorkspaceSessionSyncForTest(input);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const owner=ensureWorkspaceSessionSync(input),release=trackWorkspaceSessionSync(input,"session-one");
 await waitFor(()=>opened===1 && ready);
 const status=(value: {type:"idle"}|{type:"busy"}|{type:"retry";attempt:number;message:string;next:number})=>__applySessionSyncEventForTest(input,{type:"session.status",properties:{sessionID:"session-one",status:value}});
 const wire = (event: unknown) => { for(const response of responses) response.write(`data: ${JSON.stringify(event)}\n\n`); };
 const wireStatus = async(value: SessionStatus) => {
  wire({type:"session.status",properties:{sessionID:"session-one",status:value}});
  await waitFor(()=>getReactQueryClient().getQueryData<SessionStatus>(statusKey(input.workspaceId,"session-one"))?.type === value.type);
 };
 return {input,owner,release,status,wire,wireStatus,opened:()=>opened,closed:()=>closed};
}

function busySnapshot(): LegalworkSessionSnapshot {
 const sessionId = "session-one";
 return {
  session:{id:sessionId,slug:"synthetic",projectID:"synthetic-project",directory:"/synthetic/selected",title:"Synthetic source selection",version:"1",time:{created:1,updated:1}},
  messages:["source-turn","reverted-turn"].map((id,index)=>({
   info:{id,sessionID:sessionId,role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:index+1}},
   parts:[{id:`part-${id}`,sessionID:sessionId,messageID:id,type:"text",text:index===0?"Synthetic selected source: original-one.pdf; sha256="+"a".repeat(64):"Reverted synthetic turn"}],
  })),
  todos:[{content:"Synthetic source inspection",status:"completed",priority:"high"}],
  status:{type:"busy"},
 };
}

async function observeHttpSnapshot(f: Awaited<ReturnType<typeof fixture>>) {
 const client = getReactQueryClient();
 const server = createLegalworkServerClient({baseUrl:f.input.baseUrl,token:f.input.legalworkToken});
 const key = snapshotKey(f.input.workspaceId,"session-one");
 const observer = new QueryObserver(client,{queryKey:key,queryFn:async()=>(await server.getSessionSnapshot(f.input.workspaceId,"session-one")).item,staleTime:Infinity});
 const release = observer.subscribe(()=>{});
 cleanups.push(async()=>release());
 await waitFor(()=>observer.getCurrentResult().isSuccess);
 const published = () => {
  const value = observer.getCurrentResult().data;
  if (!value) throw new Error("Missing published synthetic snapshot");
  return value;
 };
 return {key,published,release};
}

test("caller-order replay of both published metadata snapshots preserves native idle and closes the final unused SSE",async()=>{
 const f=await fixture({directory:"/synthetic/selected",snapshot:busySnapshot()});
 const snapshot=await observeHttpSnapshot(f);
 expect(snapshot.published().status).toEqual({type:"busy"});
 seedSessionState(f.input.workspaceId,snapshot.published());
 await f.wireStatus({type:"idle"});
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic renamed selection",time:{created:1,updated:2},revert:{messageID:"reverted-turn"}}}});
 await waitFor(()=>snapshot.published().session.time.updated===2);
 // SessionSurface has two existing hydration effects. Replay their actual
 // published QueryObserver value; this is caller-order coverage, not mounted React.
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 const client=getReactQueryClient();
 expect(snapshot.published().session).toMatchObject({id:"session-one",directory:"/synthetic/selected",title:"Synthetic renamed selection",revert:{messageID:"reverted-turn"}});
 expect(snapshot.published().messages).toHaveLength(2);
 expect(snapshot.published().todos).toEqual(busySnapshot().todos);
 expect(client.getQueryData(transcriptKey(f.input.workspaceId,"session-one"))).toMatchObject([{id:"source-turn",parts:[{text:"Synthetic selected source: original-one.pdf; sha256="+"a".repeat(64)}]}]);
 const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
 f.release();f.owner();
 for(let attempt=0;attempt<100 && f.closed()!==1;attempt++) await new Promise(resolve=>setTimeout(resolve,10));
 expect({active:activity?.runActive,status:client.getQueryData(statusKey(f.input.workspaceId,"session-one")),snapshot:snapshot.published().status,closed:f.closed(),retained:__hasWorkspaceSessionSyncForTest(f.input)}).toEqual({active:false,status:{type:"idle"},snapshot:{type:"idle"},closed:1,retained:false});
});

test("native idle and terminal publications preserve snapshot content through metadata, revert cleanup and observer remount",async()=>{
 for(const terminal of ["idle","answer","error"]){
  const f=await fixture({directory:"/synthetic/selected",snapshot:busySnapshot()});
  const snapshot=await observeHttpSnapshot(f);
  seedSessionState(f.input.workspaceId,snapshot.published());
  if(terminal==="idle") f.wire({type:"session.idle",properties:{sessionID:"session-one"}});
  else f.wire({type:"message.updated",properties:{info:{id:"terminal-answer",sessionID:"session-one",role:"assistant",time:{created:3,completed:4},...(terminal==="error"?{error:{name:"UnknownError",data:{message:"Synthetic failed answer"}}}:{finish:"stop"})}}});
  await waitFor(()=>snapshot.published().status.type==="idle");
  const client=getReactQueryClient();
  expect(snapshot.published().messages).toEqual(busySnapshot().messages);
  expect(snapshot.published().todos).toEqual(busySnapshot().todos);
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic revert",time:{created:1,updated:2},revert:{messageID:"reverted-turn"}}}});
  await waitFor(()=>snapshot.published().session.time.updated===2);
  seedSessionState(f.input.workspaceId,snapshot.published());
  expect(client.getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="reverted-turn")).toBe(false);
  snapshot.release();
  const remounted=await observeHttpSnapshot(f);
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic restored history",time:{created:1,updated:3}}}});
  await waitFor(()=>remounted.published().session.time.updated===3);
  for(let replay=0;replay<2;replay++) seedSessionState(f.input.workspaceId,remounted.published());
  expect(remounted.published().session.revert).toBeUndefined();
  expect(client.getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="reverted-turn")).toBe(true);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].runActive).toBe(false);
  f.release();f.owner();await waitFor(()=>f.closed()===1);
 }
});

test("native busy and retry after idle update the published snapshot and retain its original SSE",async()=>{
 for(const status of [{type:"busy"},{type:"retry",attempt:1,message:"Synthetic retry",next:1000}] satisfies SessionStatus[]){
  const f=await fixture({snapshot:busySnapshot()});
  const snapshot=await observeHttpSnapshot(f);
  await f.wireStatus({type:"idle"});
  await f.wireStatus(status);
  await waitFor(()=>snapshot.published().status.type===status.type);
  f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:1,updated:2}}}});
  await waitFor(()=>snapshot.published().session.time.updated===2);
  for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
  expect(snapshot.published().status).toEqual(status);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].runActive).toBe(true);
  f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
 }
});

test("native status publications never synthesize absent snapshots or change another workspace or session",async()=>{
 const f=await fixture();
 const client=getReactQueryClient();
 const otherWorkspace=snapshotKey("synthetic-other-workspace","session-one");
 const otherSession=snapshotKey(f.input.workspaceId,"session-two");
 client.setQueryData(otherWorkspace,busySnapshot());client.setQueryData(otherSession,busySnapshot());
 await f.wireStatus({type:"busy"});await f.wireStatus({type:"idle"});
 f.wire({type:"session.idle",properties:{sessionID:"session-one"}});
 f.wire({type:"message.updated",properties:{info:{id:"terminal-answer",sessionID:"session-one",role:"assistant",finish:"stop",time:{created:1,completed:2}}}});
 await waitFor(()=>client.getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="terminal-answer")===true);
 expect(client.getQueryState(snapshotKey(f.input.workspaceId,"session-one"))).toBeUndefined();
 expect(client.getQueryData<LegalworkSessionSnapshot>(otherWorkspace)?.status).toEqual({type:"busy"});
 expect(client.getQueryData<LegalworkSessionSnapshot>(otherSession)?.status).toEqual({type:"busy"});
 f.release();f.owner();await waitFor(()=>f.closed()===1);
});

test("metadata idle replay preserves decoded error, permission, question and compaction retention guards",async()=>{
 for(const guard of ["error","permission","question","compaction"]){
  const f=await fixture({snapshot:busySnapshot()});
  const snapshot=await observeHttpSnapshot(f);
  await f.wireStatus({type:"idle"});
  if(guard==="error") f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic uncertain failure"}}}});
  if(guard==="permission") f.wire({type:"permission.asked",properties:{id:"synthetic-permission",sessionID:"session-one",permission:"read",patterns:["/synthetic/selected/*"],always:[],metadata:{}}});
  if(guard==="question") f.wire({type:"question.asked",properties:{id:"synthetic-question",sessionID:"session-one",questions:[{header:"Synthetic",question:"Continue?",options:[{label:"Yes",description:"Synthetic choice"}]}]}});
  if(guard==="compaction") f.wire({type:"session.next.compaction.started",properties:{sessionID:"session-one"}});
  f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:1,updated:2}}}});
  await waitFor(()=>snapshot.published().session.time.updated===2);
  const statusUpdatedAt=getReactQueryClient().getQueryState(statusKey(f.input.workspaceId,"session-one"))?.dataUpdatedAt;
  for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
  const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  if(guard==="error") {
   expect(activity?.errorActive).toBe(true);
   expect(getReactQueryClient().getQueryState(statusKey(f.input.workspaceId,"session-one"))?.dataUpdatedAt).toBe(statusUpdatedAt);
  }
  if(guard==="permission") expect(activity?.waitingPermissionIds).toEqual(["synthetic-permission"]);
  if(guard==="question") expect(activity?.waitingQuestionIds).toEqual(["synthetic-question"]);
  if(guard==="compaction") expect(activity?.compacting).toBe(true);
  f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
 }
});

test("busy snapshot metadata replay preserves native error until a genuinely newer accepted and native busy run",async()=>{
 for(const recovery of ["accepted","native"]){
 const f=await fixture({snapshot:busySnapshot()});
 const snapshot=await observeHttpSnapshot(f);
 seedSessionState(f.input.workspaceId,snapshot.published());
 await f.wireStatus({type:"busy"});
 f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic error-only stop"}}}});
 await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorActive===true);
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].runActive).toBe(false);
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic error metadata",time:{created:1,updated:2}}}});
 await waitFor(()=>snapshot.published().session.time.updated===2);
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
 expect({active:activity?.runActive,error:activity?.errorActive,snapshot:snapshot.published().status,status:getReactQueryClient().getQueryData(statusKey(f.input.workspaceId,"session-one"))}).toEqual({active:false,error:true,snapshot:{type:"busy"},status:{type:"busy"}});
 const transcript=getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"));
 expect(transcript?.some(message=>message.id.startsWith("session-error:"))).toBe(true);
 const key=f.input.workspaceId;
 if(recovery==="accepted") {
  await submitBoundDocumentGeneration({key,metadata:{projectId:key,baseUrl:f.input.baseUrl,workspaceId:key,root:"/synthetic",directory:"/synthetic"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
  expect(getDocumentGeneration(key)?.nativeRevision).toBe(0);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[key]?.["session-one"]).toMatchObject({runActive:true,errorActive:false});
 }
 await f.wireStatus({type:"busy"});
 await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[key]?.["session-one"].errorActive===false);
 for(let caller=0;caller<2;caller++) seedSessionState(key,snapshot.published());
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[key]?.["session-one"]).toMatchObject({runActive:true,errorActive:false});
 f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
 const owner=ensureWorkspaceSessionSync(f.input),release=trackWorkspaceSessionSync(f.input,"session-one");
 await f.wireStatus({type:"idle"});release();owner();await waitFor(()=>f.closed()===1);
 }
});

test("fresh SDK HTTP snapshot with an ordered newer accepted user recovers error without a native busy event",async()=>{
 const httpSnapshot=busySnapshot();
 const f=await fixture({directory:"/synthetic/selected",snapshot:httpSnapshot});
 const snapshot=await observeHttpSnapshot(f);
 seedSessionState(f.input.workspaceId,snapshot.published());
 await f.wireStatus({type:"busy"});
 f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic failed previous turn"}}}});
 await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorActive===true);
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic same failed turn",time:{created:1,updated:2}}}});
 await waitFor(()=>snapshot.published().session.time.updated===2);
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:false,errorActive:true});
 // The fixture accepts a genuinely new user after the failed known user. Fetch
 // it through the existing SDK/query function, with no local/native busy clearing.
 httpSnapshot.messages.push({info:{id:"new-accepted-turn",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[{id:"part-new-accepted-turn",sessionID:"session-one",messageID:"new-accepted-turn",type:"text",text:"Synthetic newly accepted work"}]});
 await getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
 await waitFor(()=>snapshot.published().messages.some(message=>message.info.id==="new-accepted-turn"));
 expect(snapshot.published().messages.map(message=>message.info.id)).toEqual(["source-turn","reverted-turn","new-accepted-turn"]);
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:true,errorActive:false});
 f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
 const owner=ensureWorkspaceSessionSync(f.input),release=trackWorkspaceSessionSync(f.input,"session-one");
 await f.wireStatus({type:"idle"});release();owner();await waitFor(()=>f.closed()===1);
});

test("HTTP snapshots with unavailable, older, reverted or failed newer-turn evidence preserve the current error",async()=>{
 for(const evidence of ["unavailable","older","reverted","failed","known-current","unknown","no-context"]){
  const httpSnapshot=busySnapshot();
  if(evidence==="no-context") httpSnapshot.messages=[];
  const f=await fixture({snapshot:httpSnapshot});
  const snapshot=await observeHttpSnapshot(f);
  seedSessionState(f.input.workspaceId,snapshot.published());
  f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic existing failed turn"}}}});
  await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorActive===true);
  const candidate:LegalworkSessionSnapshot["messages"][number]={info:{id:"candidate-turn",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[]};
  if(evidence==="unavailable") httpSnapshot.messages=[candidate];
  if(evidence==="older") httpSnapshot.messages.unshift(candidate);
  if(evidence==="reverted") {httpSnapshot.messages.push(candidate);httpSnapshot.session.revert={messageID:"candidate-turn"};}
  if(evidence==="failed") httpSnapshot.messages.push(candidate,{info:{id:"candidate-error",sessionID:"session-one",role:"assistant",parentID:"candidate-turn",agent:"synthetic",mode:"synthetic",modelID:"synthetic",providerID:"synthetic",path:{cwd:"/synthetic",root:"/synthetic"},cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},time:{created:0,completed:0},error:{name:"UnknownError",data:{message:"Synthetic newer turn already failed"}}},parts:[]});
  if(evidence==="known-current") {
   // An error before assistant output can reuse an older synthetic error key.
   // Its position alone cannot identify which current user failed.
   f.wire({type:"message.updated",properties:{info:candidate.info}});
   f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic known candidate failed"}}}});
   await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorMessage==="Synthetic known candidate failed");
   httpSnapshot.messages.push(candidate);
  }
  if(evidence==="unknown") {
   useSessionActivityStore.getState().setError(f.input.workspaceId,"session-one","Synthetic legacy caller without context");
   httpSnapshot.messages.push(candidate);
  }
  if(evidence==="no-context") httpSnapshot.messages.push(candidate);
  await getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
  for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:false,errorActive:true});
  f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
 }
});

for(const errorAfterUser of [false,true]){
 test(`SSE user before fresh HTTP ${errorAfterUser?"preserves an error after the user":"recovers an error before the user"}`,async()=>{
  const httpSnapshot=busySnapshot();
  const f=await fixture({directory:"/synthetic/selected",snapshot:httpSnapshot});
  const snapshot=await observeHttpSnapshot(f);
  seedSessionState(f.input.workspaceId,snapshot.published());
  await f.wireStatus({type:"busy"});
  f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic repeated error"}}}});
  await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorActive===true);
  const accepted:LegalworkSessionSnapshot["messages"][number]={info:{id:"sse-accepted-turn",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[]};
  f.wire({type:"message.updated",properties:{info:accepted.info}});
  await waitFor(()=>getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="sse-accepted-turn")===true);
  if(errorAfterUser){
   f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic repeated error"}}}});
   f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:1,updated:2}}}});
   await waitFor(()=>snapshot.published().session.time.updated===2);
  }
  httpSnapshot.messages.push(accepted);
  await getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
  expect(snapshot.published().messages.map(message=>message.info.id)).toEqual(["source-turn","reverted-turn","sse-accepted-turn"]);
  for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:!errorAfterUser,errorActive:errorAfterUser});
  f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
  if(!errorAfterUser){
   const owner=ensureWorkspaceSessionSync(f.input),release=trackWorkspaceSessionSync(f.input,"session-one");
   await f.wireStatus({type:"idle"});release();owner();await waitFor(()=>f.closed()===1);
  }
 });
}

test("local injected errors capture their user boundary and a same-text later error replaces it",async()=>{
 const httpSnapshot=busySnapshot();
 const f=await fixture({snapshot:httpSnapshot});
 const snapshot=await observeHttpSnapshot(f);
 seedSessionState(f.input.workspaceId,snapshot.published());
 injectSessionErrorMessage(f.input.workspaceId,"session-one","Synthetic repeated local error");
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorUserMessageId).toBe("reverted-turn");
 const accepted:LegalworkSessionSnapshot["messages"][number]={info:{id:"local-new-user",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[]};
 f.wire({type:"message.updated",properties:{info:accepted.info}});
 await waitFor(()=>getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="local-new-user")===true);
 httpSnapshot.messages.push(accepted);
 await getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:true,errorActive:false,errorUserMessageId:null});
 injectSessionErrorMessage(f.input.workspaceId,"session-one","Synthetic repeated local error");
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorUserMessageId).toBe("local-new-user");
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({runActive:false,errorActive:true});
 f.release();f.owner();expect(f.closed()).toBe(0);
});

test("error user provenance is bounded, unknown for legacy callers and reset with all existing recovery paths",()=>{
 const workspace="synthetic-provenance",session="synthetic-session";
 const store=useSessionActivityStore.getState();
 const record=()=>useSessionActivityStore.getState().recordsByWorkspaceId[workspace]?.[session];
 store.setRunStatus(workspace,session,{type:"idle"});
 expect(record()?.errorUserMessageId).toBeNull();
 store.setError(workspace,session,"Synthetic same text","failed-a");
 store.setError(workspace,session,"Synthetic same text","failed-b");
 expect(record()?.errorUserMessageId).toBe("failed-b");
 store.setError(workspace,session,"Synthetic same text");
 expect(record()?.errorUserMessageId).toBeNull();
 store.setError("synthetic-other",session,"Synthetic isolated","other-user");
 for(const recover of [()=>store.seedWorkspaceSessions(workspace,[{id:session,status:{type:"busy"}}]),()=>store.seedSessionRun(workspace,session,{type:"busy"},false),()=>store.setRunStatus(workspace,session,{type:"busy"}),()=>store.clearError(workspace,session),()=>store.setCompacting(workspace,session,true)]){
  store.setError(workspace,session,"Synthetic error","failed-user");recover();
  expect(record()?.errorUserMessageId).toBeNull();
  expect(useSessionActivityStore.getState().recordsByWorkspaceId["synthetic-other"]?.[session].errorUserMessageId).toBe("other-user");
 }
 store.setError(workspace,session,"Synthetic retained","failed-user");store.removeSession(workspace,session);
 expect(record()).toBeUndefined();
});
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

// Short, isolated real GC deadlines keep CI fast; the renderer probe additionally
// exercises the unchanged production 15-second deadline. No clock or cache removal.
const naturalGcMs = 80;
const waitPastGc = () => new Promise(resolve => setTimeout(resolve, naturalGcMs * 2));

test("decoded idle survives natural UI cache GC until the last owner, in both release orders", async () => {
 for (const workspaceFirst of [false, true]) {
  const f = await fixture({gcTime:naturalGcMs});
  const client = getReactQueryClient();
  await f.wireStatus({type:"busy"});
  await f.wireStatus({type:"idle"});
  client.setQueryData(transcriptKey(f.input.workspaceId,"session-one"), []);
  const releaseSecondOwner = ensureWorkspaceSessionSync(f.input);
  const releaseSecondSession = trackWorkspaceSessionSync(f.input,"session-one");
  if (workspaceFirst) { f.owner(); f.release(); } else { f.release(); f.owner(); }
  await waitPastGc();
  expect(client.getQueryState(transcriptKey(f.input.workspaceId,"session-one"))).toBeUndefined();
  expect(f.closed()).toBe(0);
  const statusQuery = client.getQueryCache().find({queryKey:statusKey(f.input.workspaceId,"session-one"),exact:true});
  expect(statusQuery?.getObserversCount()).toBe(1);
  expect(statusQuery?.gcTime).toBe(naturalGcMs);
  if (workspaceFirst) { releaseSecondOwner(); releaseSecondSession(); } else { releaseSecondSession(); releaseSecondOwner(); }
  expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(false);
  await waitFor(()=>f.closed()===1);
  expect(client.getQueryCache().find({queryKey:statusKey(f.input.workspaceId,"session-one"),exact:true})?.getObserversCount() ?? 0).toBe(0);
  await waitFor(()=>client.getQueryState(statusKey(f.input.workspaceId,"session-one"))===undefined);
  expect(f.opened()).toBe(1);
 }
});

test("natural cache lifecycle preserves busy, retry, unknown, local error and all waiting states", async () => {
 for (const state of ["busy", "retry", "unknown", "error", "permission", "question", "compacting"]) {
  const f = await fixture({gcTime:naturalGcMs});
  if (state !== "unknown") await f.wireStatus({type:"idle"});
  const activity = useSessionActivityStore.getState();
  if (state === "busy") await f.wireStatus({type:"busy"});
  if (state === "retry") await f.wireStatus({type:"retry",attempt:1,message:"synthetic retry",next:Date.now()+1000});
  if (state === "error") activity.setError(f.input.workspaceId,"session-one","Synthetic uncertain send");
  if (state === "permission" || state === "question") activity.setWaitingRequest(f.input.workspaceId,"session-one",state,"request",true);
  if (state === "compacting") activity.setCompacting(f.input.workspaceId,"session-one",true);
  await waitPastGc();
  f.release(); f.owner();
  expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
  expect(f.closed()).toBe(0);
  const client = getReactQueryClient();
  expect(client.getQueryCache().find({queryKey:statusKey(f.input.workspaceId,"session-one"),exact:true})?.getObserversCount() ?? 0).toBe(0);
  await waitFor(()=>client.getQueryState(statusKey(f.input.workspaceId,"session-one"))===undefined);
  expect(f.opened()).toBe(1);
 }
});

test("a new accepted revision-zero attempt survives old decoded idle and GC, then re-tracks the original stream", async () => {
 const f = await fixture({gcTime:naturalGcMs,snapshot:busySnapshot()});
 const snapshot = await observeHttpSnapshot(f);
 await f.wireStatus({type:"idle"});
 const key = f.input.workspaceId;
 const releaseGenerationOwner = ensureWorkspaceSessionSync({...f.input,onSessionStatus:update=>{
  if(update.sessionId === "session-one") applyDocumentGenerationRunStatus(key,update.status);
 }});
 await submitBoundDocumentGeneration({key,metadata:{projectId:f.input.workspaceId,baseUrl:f.input.baseUrl,workspaceId:f.input.workspaceId,root:"/synthetic",directory:"/synthetic"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
 const releaseObservation = observeDocumentGeneration(key,f.input.workspaceId);
 cleanups.push(async()=>releaseObservation());
 expect(getDocumentGeneration(key)?.nativeRevision).toBe(0);
 expect(getDocumentGeneration(key)?.nativeRunObserved).toBe(false);
 for(let caller=0;caller<2;caller++) seedSessionState(f.input.workspaceId,snapshot.published());
 expect(snapshot.published().status).toEqual({type:"idle"});
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].runActive).toBe(true);
 await waitPastGc();
 f.release(); f.owner();
 expect(f.closed()).toBe(0);
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].runActive).toBe(true);
 await waitFor(()=>getReactQueryClient().getQueryState(statusKey(f.input.workspaceId,"session-one"))===undefined);
 const releaseSession = trackWorkspaceSessionSync(f.input,"session-one");
 await f.wireStatus({type:"busy"});
 expect(getDocumentGeneration(key)?.nativeRevision).toBe(1);
 await f.wireStatus({type:"idle"});
 expect(getDocumentGeneration(key)?.nativeRevision).toBe(2);
 expect(getDocumentGeneration(key)?.phase).toBe("completed");
 releaseSession(); releaseGenerationOwner(); releaseObservation();
 await waitFor(()=>f.closed()===1);
 expect(f.opened()).toBe(1);
 await waitFor(()=>getReactQueryClient().getQueryState(statusKey(f.input.workspaceId,"session-one"))===undefined);
});

test("scoped directory owners share only the status query lifetime and dispose independently", async () => {
 const f = await fixture({gcTime:naturalGcMs,directory:"/synthetic/first"});
 const second = {...f.input,directory:"/synthetic/second"};
 const owner = ensureWorkspaceSessionSync(second);
 const release = trackWorkspaceSessionSync(second,"session-one");
 cleanups.push(async()=>__disposeWorkspaceSessionSyncForTest(second));
 await waitFor(()=>f.opened()===2);
 await f.wireStatus({type:"busy"});
 await f.wireStatus({type:"idle"});
 await waitPastGc();
 const query = getReactQueryClient().getQueryCache().find({queryKey:statusKey(f.input.workspaceId,"session-one"),exact:true});
 expect(query?.getObserversCount()).toBe(2);
 f.release(); f.owner();
 await waitFor(()=>f.closed()===1);
 expect(__hasWorkspaceSessionSyncForTest(second)).toBe(true);
 expect(query?.getObserversCount()).toBe(1);
 release(); owner();
 await waitFor(()=>f.closed()===2);
 expect(query?.getObserversCount()).toBe(0);
 await waitFor(()=>getReactQueryClient().getQueryState(statusKey(f.input.workspaceId,"session-one"))===undefined);
});

test("bounded status observation preserves enabled UI refresh and never fetches on its own", async () => {
 const f = await fixture({gcTime:naturalGcMs});
 const client = getReactQueryClient();
 const queryKey = statusKey(f.input.workspaceId,"session-one");
 let fetches = 0;
 f.release();
 const ui = new QueryObserver<SessionStatus>(client,{queryKey,queryFn:async()=>{fetches++;return {type:"idle"};}});
 const releaseUi = ui.subscribe(()=>{});
 cleanups.push(async()=>releaseUi());
 await waitFor(()=>fetches===1 && client.getQueryState(queryKey)?.fetchStatus === "idle");
 const releaseSecond = trackWorkspaceSessionSync(f.input,"session-one");
 await client.invalidateQueries({queryKey,exact:true});
 expect(fetches).toBe(2);
 await client.refetchQueries({queryKey,exact:true});
 expect(fetches).toBe(3);
 releaseUi();
 await client.invalidateQueries({queryKey,exact:true});
 await waitPastGc();
 expect(fetches).toBe(3);
 releaseSecond(); f.owner();
 await waitFor(()=>f.closed()===1);
 await waitFor(()=>client.getQueryState(queryKey)===undefined);
});

test("different transport identities release only their own status observers and sockets", async () => {
 const workspaceId = randomUUID();
 const first = await fixture({gcTime:naturalGcMs,workspaceId,token:"synthetic-first",directory:"/synthetic/first"});
 const second = await fixture({gcTime:naturalGcMs,workspaceId,token:"synthetic-second",directory:"/synthetic/second"});
 await first.wireStatus({type:"idle"});
 await second.wireStatus({type:"busy"});
 await second.wireStatus({type:"idle"});
 await waitPastGc();
 first.release(); first.owner();
 await waitFor(()=>first.closed()===1);
 expect(second.closed()).toBe(0);
 expect(__hasWorkspaceSessionSyncForTest(second.input)).toBe(true);
 const query = getReactQueryClient().getQueryCache().find({queryKey:statusKey(workspaceId,"session-one"),exact:true});
 expect(query?.getObserversCount()).toBe(1);
 __disposeWorkspaceSessionSyncForTest(second.input);
 await waitFor(()=>second.closed()===1);
 expect(query?.getObserversCount()).toBe(0);
 await waitFor(()=>getReactQueryClient().getQueryState(statusKey(workspaceId,"session-one"))===undefined);
});
