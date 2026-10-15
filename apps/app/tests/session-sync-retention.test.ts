import { afterEach, expect, spyOn, test } from "bun:test";
import { environmentManager, isServer, QueryClientProvider, QueryObserver } from "@tanstack/react-query";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { createServer, type ServerResponse } from "node:http";
import type { UIMessage } from "ai";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { randomUUID } from "node:crypto";
import { applyDocumentGenerationRunStatus, clearDocumentGenerationsForTest, getDocumentGeneration, observeDocumentGeneration, submitBoundDocumentGeneration } from "../src/react-app/domains/session/panel/document-generation-lifecycle";
import { createLegalworkServerClient, LegalworkServerError, type LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { t } from "../src/i18n";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync, seedSessionState, injectSessionErrorMessage, __applySessionSyncEventForTest, __hasWorkspaceSessionSyncForTest, __disposeWorkspaceSessionSyncForTest, snapshotKey, statusKey, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";

const cleanups: Array<() => Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.();getReactQueryClient().clear();clearDocumentGenerationsForTest();useSessionActivityStore.setState({recordsByWorkspaceId:{},statusesByWorkspaceId:{}});});
async function waitFor(read:()=>boolean){for(let i=0;i<100;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}expect(read()).toBe(true);}
async function fixture(options: { allowConnectionChanges?: boolean; gcTime?: number; workspaceId?: string; directory?: string; token?: string; hostToken?: string; snapshot?: LegalworkSessionSnapshot; fullSnapshot?: LegalworkSessionSnapshot; snapshotReply?: (limit:string|null,response:ServerResponse,read:number,sessionId:string)=>void; statusReply?: (response:ServerResponse,read:number)=>void } = {}){
 let opened=0,closed=0,ready=false,updated=0;
 const responses = new Set<ServerResponse>();
 const token = options.token ?? "synthetic-sync-token";
 const workspaceId = options.workspaceId ?? randomUUID();
 const snapshotReads:Array<string|null>=[];let statusReads=0;
 const requestScopes:Array<{path:string;authorization:string|undefined;directory:string|null}>=[];
 const server=createServer((request,response)=>{
  const requestUrl=new URL(request.url ?? "","http://fixture");
  requestScopes.push({path:requestUrl.pathname,authorization:request.headers.authorization,directory:requestUrl.searchParams.get("directory")});
  if (options.snapshot && (requestUrl.pathname === `/workspace/${encodeURIComponent(workspaceId)}/sessions/session-one/snapshot` || (options.allowConnectionChanges && /^\/workspace\/[^/]+\/sessions\/[^/]+\/snapshot$/.test(requestUrl.pathname)))) {
   if(!options.allowConnectionChanges)expect(request.headers.authorization).toBe(`Bearer ${token}`);
   expect(request.headers["x-legalwork-host-token"]).toBe(options.hostToken);
   const limit=requestUrl.searchParams.get("limit");snapshotReads.push(limit);
   if(options.snapshotReply){options.snapshotReply(limit,response,snapshotReads.length,decodeURIComponent(requestUrl.pathname.split("/").at(-2)!));return;}
   response.writeHead(200,{"content-type":"application/json"});
   response.end(JSON.stringify({item:limit===null?(options.fullSnapshot ?? options.snapshot):options.snapshot}));
   return;
  }
  if(requestUrl.pathname==="/session/status" && options.statusReply){options.statusReply(response,++statusReads);return;}
  expect(request.url?.split("?")[0]).toBe("/event");if(!options.allowConnectionChanges)expect(request.headers.authorization).toBe(`Bearer ${token}`);
  if(options.snapshot && options.directory && !options.allowConnectionChanges) expect(new URL(request.url ?? "", "http://fixture").searchParams.get("directory")).toBe(options.directory);
  response.writeHead(200,{"content-type":"text/event-stream"});response.write('data: {"type":"server.connected","properties":{}}\n\n');opened++;responses.add(response);
  response.write('data: {"type":"session.status","properties":{"sessionID":"fixture-ready","status":{"type":"idle"}}}\n\n');
  const heartbeat=setInterval(()=>response.write(': heartbeat\n\n'),50);
  response.once("close",()=>{clearInterval(heartbeat);responses.delete(response);closed++;});
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw new Error("Missing fixture address");
 const input={workspaceId,baseUrl:`http://127.0.0.1:${address.port}`,legalworkToken:token,directory:options.directory,onSessionUpdated:()=>{updated++;},onSessionStatus:(event:{sessionId:string})=>{if(event.sessionId==="fixture-ready")ready=true;}};
 if(options.gcTime !== undefined){
  const client = getReactQueryClient();
  client.setQueryDefaults(statusKey(input.workspaceId,"session-one"), {gcTime:options.gcTime});
  client.setQueryDefaults(transcriptKey(input.workspaceId,"session-one"), {gcTime:options.gcTime});
 }
 cleanups.push(async()=>{__disposeWorkspaceSessionSyncForTest(input);server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));});
 const owner=ensureWorkspaceSessionSync(input),release=trackWorkspaceSessionSync(input,"session-one");
 await waitFor(()=>opened===1 && ready);
 const status=(value: {type:"idle"}|{type:"busy"}|{type:"retry";attempt:number;message:string;next:number})=>__applySessionSyncEventForTest(input,{type:"session.status",properties:{sessionID:"session-one",status:value}});
 const wire = (event: unknown, scope?: { token:string; directory?:string }) => {
  for(const response of responses){
   if(scope && (response.req.headers.authorization!==`Bearer ${scope.token}` || new URL(response.req.url ?? "","http://fixture").searchParams.get("directory")!==(scope.directory ?? null)))continue;
   response.write(`data: ${JSON.stringify(event)}\n\n`);
  }
 };
 const wireStatus = async(value: SessionStatus) => {
  wire({type:"session.status",properties:{sessionID:"session-one",status:value}});
  await waitFor(()=>getReactQueryClient().getQueryData<SessionStatus>(statusKey(input.workspaceId,"session-one"))?.type === value.type);
 };
 const legalwork=createLegalworkServerClient({baseUrl:input.baseUrl,token,hostToken:options.hostToken});
 return {input,owner,release,status,wire,wireStatus,legalwork,requestScopes,snapshotReads:()=>snapshotReads.slice(),updated:()=>updated,opened:()=>opened,closed:()=>closed};
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

async function observeHttpSnapshot(f: Awaited<ReturnType<typeof fixture>>, options:{limit?:number;hydrate?:boolean;onPublication?:(snapshot:LegalworkSessionSnapshot)=>void}={}) {
 const client = getReactQueryClient();
 const server = f.legalwork;
 const key = snapshotKey(f.input.workspaceId,"session-one");
 const observer = new QueryObserver(client,{queryKey:key,queryFn:async({signal})=>(await server.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:options.limit,signal})).item,staleTime:Infinity});
 const release = observer.subscribe(result=>{if(result.data){if(options.hydrate)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);options.onPublication?.(result.data);}});
 cleanups.push(async()=>release());
 await waitFor(()=>observer.getCurrentResult().isSuccess);
 const published = () => {
  const value = observer.getCurrentResult().data;
  if (!value) throw new Error("Missing published synthetic snapshot");
  return value;
 };
 return {key,published,release,result:()=>observer.getCurrentResult()};
}

test("tracked metadata without a snapshot query preserves no-synthesis and the live stream",async()=>{
 const f=await fixture();
 const key=snapshotKey(f.input.workspaceId,"session-one");
 expect(getReactQueryClient().getQueryState(key)).toBeUndefined();
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic metadata before any read",time:{created:1,updated:2},revert:{messageID:"not-loaded"}}}});
 await waitFor(()=>f.updated()===1);
 expect(getReactQueryClient().getQueryState(key)).toBeUndefined();
 expect(getReactQueryClient().getQueryData(transcriptKey(f.input.workspaceId,"session-one"))).toBeUndefined();
 expect(f.snapshotReads()).toEqual([]);
 await f.wireStatus({type:"idle"});f.release();f.owner();await waitFor(()=>f.closed()===1);
});

test("limited SDK snapshot resolves a missing raw cursor with one full read in the same authenticated scope",async()=>{
 const full=busySnapshot();full.session.revert={messageID:"source-turn"};
 const limited={...full,messages:full.messages.slice(1)};
 const f=await fixture({snapshot:limited,fullSnapshot:full,hostToken:"synthetic-host-token"});
 const result=await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140});
 expect(f.snapshotReads()).toEqual(["140",null]);
 expect(result.item.messages.map(message=>message.info.id)).toEqual(["source-turn","reverted-turn"]);
 expect(result.item.session.revert).toEqual({messageID:"source-turn"});
});

test("an unresolved full SDK snapshot fails once with a localized content-free boundary error",async()=>{
 const unresolved=busySnapshot();unresolved.session.revert={messageID:"synthetic-hidden-cursor"};
 const f=await fixture({snapshot:unresolved});
 const error=await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140}).catch(cause=>cause);
 expect(error).toBeInstanceOf(LegalworkServerError);
 expect(error).toMatchObject({status:409,code:"session_revert_boundary_unresolved",message:t("session.load_failed")});
 expect(error.details).toBeUndefined();expect(error.cause).toBeUndefined();
 expect(error.stack).not.toContain("synthetic-hidden-cursor");
 expect(f.snapshotReads()).toEqual(["140",null]);
});

function cursorSnapshot(): LegalworkSessionSnapshot {
 const full=busySnapshot();
 full.messages.splice(1,0,{info:{id:"cursor-user",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:1.5}},parts:[]});
 return full;
}

test("changed metadata cursor refreshes only the active snapshot and completes its missing boundary once",async()=>{
 const full=cursorSnapshot(),limited={...full,messages:full.messages.slice(0,1)};
 const f=await fixture({snapshot:limited,fullSnapshot:full,hostToken:"synthetic-host-token"});
 const snapshot=await observeHttpSnapshot(f,{limit:140,hydrate:true});
 full.session.revert={messageID:"cursor-user"};full.session.time.updated=2;
 limited.messages=[full.messages[0],full.messages[2]];
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic changed cursor",time:{created:1,updated:2},revert:{messageID:"cursor-user"}}}});
 await waitFor(()=>f.snapshotReads().length===3 && snapshot.published().messages.some(message=>message.info.id==="cursor-user"));
 expect(f.snapshotReads()).toEqual(["140","140",null]);
 expect(getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.map(message=>message.id)).toEqual(["source-turn"]);
 for(let index=3;index<6;index++){
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:`Synthetic same cursor ${index}`,time:{created:1,updated:index},revert:{messageID:"cursor-user"}}}});
  await waitFor(()=>snapshot.published().session.time.updated===index);
 }
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic title only",time:{created:1,updated:6}}}});
 await waitFor(()=>snapshot.published().session.time.updated===6);
 snapshot.release();
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic unobserved cursor",time:{created:1,updated:7},revert:{messageID:"not-loaded"}}}});
 await waitFor(()=>getReactQueryClient().getQueryData<LegalworkSessionSnapshot>(snapshot.key)?.session.time.updated===7);
 expect(f.snapshotReads()).toEqual(["140","140",null]);
});

test("metadata cursor arriving during an old HTTP body preserves the latest revert and hides the reverted tail",async()=>{
 const full=cursorSnapshot(),limited={...full,messages:[full.messages[0]]};
 let releaseOld:(()=>void)|undefined;
 const f=await fixture({snapshot:limited,fullSnapshot:full,snapshotReply:(limit,response,read)=>{
  response.writeHead(200,{"content-type":"application/json"});
  const body=JSON.stringify({item:limit===null?full:limited});
  if(read===2){response.flushHeaders();releaseOld=()=>response.end(body);return;}
  response.end(body);
 }});
 let changed=false;
 const publications:Array<{cursor:string|undefined;errorActive:boolean|undefined}>=[];
 const snapshot=await observeHttpSnapshot(f,{limit:140,hydrate:true,onPublication:value=>{if(changed)publications.push({cursor:value.session.revert?.messageID,errorActive:useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive});}});
 f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic failed source before old body"}}}});
 await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive===true);
 limited.messages=[full.messages[0],full.messages[2]];
 const pending=getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
 await waitFor(()=>releaseOld!==undefined);
 full.session.revert={messageID:"cursor-user"};full.session.time.updated=2;changed=true;
 f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic latest revert",time:{created:1,updated:2},revert:{messageID:"cursor-user"}}}});
 await waitFor(()=>snapshot.published().session.revert?.messageID==="cursor-user");
 releaseOld?.();await pending;
 await waitFor(()=>snapshot.result().fetchStatus==="idle");
 expect({reads:f.snapshotReads(),cursor:snapshot.published().session.revert?.messageID,transcriptIds:getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.map(message=>message.id)}).toMatchObject({cursor:"cursor-user",transcriptIds:["source-turn","session-error:session-one"]});
 expect(publications.length).toBeGreaterThan(0);expect(publications.every(value=>value.cursor==="cursor-user" && value.errorActive===true)).toBe(true);
});

for(const mode of ["initial","clear","known-change","same-cursor","same-title"] as const){
 test(`a ${mode} cursor transition cannot be overwritten by an already running HTTP body`,async()=>{
  const full=cursorSnapshot();
  if(mode!=="initial")full.session.revert={messageID:"cursor-user"};
  let releaseOld:(()=>void)|undefined,closed=false;
  const f=await fixture({snapshot:full,snapshotReply:(_limit,response,read)=>{
   response.writeHead(200,{"content-type":"application/json"});
   const body=JSON.stringify({item:full});
   if(read===(mode==="initial"?1:2)){
    response.flushHeaders();releaseOld=()=>response.end(body);response.once("close",()=>{closed=true;});return;
   }
   response.end(body);
  }});
  const failSource=async()=>{
   if(mode==="initial"){
    f.wire({type:"message.updated",properties:{info:full.messages[0].info}});
    await waitFor(()=>getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="source-turn")===true);
   }
   f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic failed source in cursor race"}}}});
   await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive===true);
  };
  if(mode==="initial")await failSource();
  const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one");
  const observer=new QueryObserver(client,{queryKey:key,queryFn:async({signal})=>(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140,signal})).item,staleTime:Infinity});
  const publications:Array<{cursor:string|undefined;errorActive:boolean|undefined}>=[];
  let changed=false;
  const release=observer.subscribe(result=>{if(result.data){for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);if(changed)publications.push({cursor:result.data.session.revert?.messageID,errorActive:useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive});}});
  cleanups.push(async()=>release());
  let pending:Promise<void>|undefined;
  if(mode!=="initial"){
   await waitFor(()=>observer.getCurrentResult().isSuccess);
   await failSource();
   pending=client.refetchQueries({queryKey:key,exact:true});
  }
  await waitFor(()=>releaseOld!==undefined);
  const nextCursor=mode==="clear"?undefined:mode==="known-change"?"source-turn":"cursor-user";
  full.session.revert=nextCursor?{messageID:nextCursor}:undefined;full.session.time.updated=2;
  changed=true;
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic changed during fetch",time:{created:1,updated:2},revert:full.session.revert}}});
  await waitFor(()=>f.updated()===1);
  releaseOld?.();await pending;
  await waitFor(()=>observer.getCurrentResult().fetchStatus==="idle");
  expect({cursor:observer.getCurrentResult().data?.session.revert?.messageID,publications,reads:f.snapshotReads(),closed}).toMatchObject({cursor:nextCursor,closed:true});
  expect(publications.every(value=>value.cursor===nextCursor && value.errorActive===(mode!=="clear"))).toBe(true);
  expect(f.snapshotReads()).toHaveLength(mode==="initial"?2:mode==="same-cursor"||mode==="same-title"?2:3);
 });
}

for(const transition of ["same","change","clear","recreate","cached","deleted","clear-owned","retained"] as const){
 test(`pending initial cursor provenance handles ${transition} without stale or duplicate reads`,async()=>{
  const value=cursorSnapshot();
  const bodies:Array<()=>void>=[];
  const f=await fixture({snapshot:value,snapshotReply:(_limit,response)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();const body=JSON.stringify({item:value});bodies.push(()=>response.end(body));}});
  const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one");
  const makeObserver=()=>new QueryObserver(client,{queryKey:key,queryFn:async({signal})=>(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140,signal})).item});
  let observer=makeObserver(),release=observer.subscribe(()=>{});
  cleanups.push(async()=>release());
  await waitFor(()=>bodies.length===1);
  value.session.revert={messageID:"cursor-user"};
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic initial cursor",time:{created:1,updated:2},revert:value.session.revert}}});
  await waitFor(()=>f.updated()===1 && bodies.length===2);
  if(transition==="recreate"){
   release();client.removeQueries({queryKey:key,exact:true});
   observer=makeObserver();release=observer.subscribe(()=>{});await waitFor(()=>bodies.length===3);
  }
  if(transition==="cached"){
   bodies[1]();await waitFor(()=>observer.getCurrentResult().isSuccess);
   value.session.revert={messageID:"source-turn"};
   const fresh=observer.refetch();await waitFor(()=>bodies.length===3);bodies[2]();await fresh;
   expect(observer.getCurrentResult().data?.session.revert?.messageID).toBe("source-turn");
   void observer.refetch();await waitFor(()=>bodies.length===4);
  }
  if(transition==="deleted")f.wire({type:"session.deleted",properties:{sessionID:"session-one"}});
  if(transition==="clear-owned"){
   await f.wireStatus({type:"idle"});f.release();
   const retracked=trackWorkspaceSessionSync(f.input,"session-one");cleanups.push(async()=>retracked());
  }
  if(transition==="retained")f.release();
  const nextCursor=transition==="clear"?undefined:transition==="change"?"source-turn":"cursor-user";
  value.session.revert=nextCursor?{messageID:nextCursor}:undefined;
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic initial changed/title cursor",time:{created:1,updated:3},revert:value.session.revert}}});
  await waitFor(()=>f.updated()===2);
  const expectedReads=transition==="same"||transition==="retained"?2:transition==="cached"?5:transition==="recreate"?4:3;
  await waitFor(()=>bodies.length>=expectedReads);
  await new Promise(resolve=>setTimeout(resolve,20));
  for(const finish of bodies)finish();
  await waitFor(()=>observer.getCurrentResult().isSuccess && observer.getCurrentResult().fetchStatus==="idle");
  expect(f.snapshotReads()).toEqual(Array(expectedReads).fill("140"));
  expect(observer.getCurrentResult().data?.session.revert?.messageID).toBe(nextCursor);
 });
}

test("pending initial cursor provenance stays isolated from another workspace with the same session ID",async()=>{
 for(let workspace=0;workspace<2;workspace++){
  const value=cursorSnapshot(),bodies:Array<()=>void>=[];
  const f=await fixture({snapshot:value,snapshotReply:(_limit,response)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();const body=JSON.stringify({item:value});bodies.push(()=>response.end(body));}});
  const key=snapshotKey(f.input.workspaceId,"session-one");
  const observer=new QueryObserver(getReactQueryClient(),{queryKey:key,queryFn:async({signal})=>(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140,signal})).item});
  const release=observer.subscribe(()=>{});cleanups.push(async()=>release());
  await waitFor(()=>bodies.length===1);
  value.session.revert={messageID:"cursor-user"};
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic isolated initial cursor",time:{created:1,updated:2},revert:value.session.revert}}});
  await waitFor(()=>f.updated()===1 && bodies.length===2);
  for(const finish of bodies)finish();await waitFor(()=>observer.getCurrentResult().isSuccess);
  expect(f.snapshotReads()).toEqual(["140","140"]);
  expect(observer.getCurrentResult().data?.session.revert?.messageID).toBe("cursor-user");
 }
});

test("complete and initial unlimited SDK snapshots never add an unnecessary full read",async()=>{
 const snapshot=busySnapshot();snapshot.session.revert={messageID:"source-turn"};
 const f=await fixture({snapshot});
 await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140});
 expect(f.snapshotReads()).toEqual(["140"]);
 await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one");
 expect(f.snapshotReads()).toEqual(["140",null]);
 snapshot.session.revert=undefined;
 await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140});
 expect(f.snapshotReads()).toEqual(["140",null,"140"]);
});

for(const heldStage of ["first-body","full-body"]){
 test(`snapshot original deadline covers ${heldStage} and closes its owned HTTP response`,async()=>{
  const snapshot=busySnapshot();snapshot.session.revert={messageID:"source-turn"};snapshot.messages.splice(0,1);
  let bodyClosed=false;
  const f=await fixture({snapshot,snapshotReply:(limit,response)=>{
   response.writeHead(200,{"content-type":"application/json"});
   if(heldStage==="full-body" && limit!==null){
    const timer=setTimeout(()=>response.end(JSON.stringify({item:snapshot})),3000);
    response.once("close",()=>clearTimeout(timer));return;
   }
   response.flushHeaders();response.write('{"item":');
   response.once("close",()=>{bodyClosed=true;});
  }});
  const started=performance.now();
  await expect(f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140})).rejects.toThrow(t("app.request_timed_out"));
  expect(performance.now()-started).toBeLessThan(14000);
  await waitFor(()=>bodyClosed);
  expect(f.snapshotReads()).toEqual(heldStage==="first-body"?["140"]:["140",null]);
 },20000);
}

test("snapshot deadline prevents a late uncancellable transport result from starting a fallback",async()=>{
 const snapshot=busySnapshot();snapshot.session.revert={messageID:"absent-cursor"};
 const f=await fixture({snapshot});
 let finish:((response:Response)=>void)|undefined,calls=0;
 const original=globalThis.fetch;
 const spy=spyOn(globalThis,"fetch").mockImplementation(Object.assign((input:RequestInfo|URL,init?:RequestInit)=>{
  if(String(input).includes("/sessions/session-one/snapshot")){calls++;return new Promise<Response>(resolve=>{finish=resolve;});}
  return original(input,init);
 },{preconnect:original.preconnect}));
 try{
  await expect(f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140})).rejects.toThrow(t("app.request_timed_out"));
  finish?.(Response.json({item:snapshot}));
  await new Promise(resolve=>setTimeout(resolve,20));
  expect(calls).toBe(1);
 }finally{spy.mockRestore();}
},20000);

test("snapshot caller abort retains its reason, closes the owned body, and never starts a full fallback",async()=>{
 const snapshot=busySnapshot();snapshot.session.revert={messageID:"not-loaded"};
 let opened=false,closed=false;
 const f=await fixture({snapshot,snapshotReply:(_limit,response)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();response.write('{"item":');opened=true;response.once("close",()=>{closed=true;});}});
 const controller=new AbortController(),reason=new Error("Synthetic caller cancellation");
 const pending=f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140,signal:controller.signal}).catch(error=>error);
 await waitFor(()=>opened);controller.abort(reason);
 expect(await pending).toBe(reason);await waitFor(()=>closed);expect(f.snapshotReads()).toEqual(["140"]);
 const before=f.snapshotReads().length;
 expect(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{signal:controller.signal}).catch(error=>error)).toBe(reason);
 expect(f.snapshotReads()).toHaveLength(before);
});

test("snapshot preserves non-timeout transport error identity and sanitizes malformed JSON",async()=>{
 const f=await fixture({snapshot:busySnapshot(),snapshotReply:(_limit,response)=>{response.writeHead(200,{"content-type":"application/json"});response.end('{"sensitive":"synthetic-parser-content",');}});
 const malformed=await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one").catch(error=>error);
 expect(malformed.message).toBe(t("session.load_failed"));expect(malformed.cause).toBeUndefined();
 expect(malformed.stack).not.toContain("synthetic-parser-content");
 const failure=new TypeError("Synthetic transport identity"),original=globalThis.fetch;
 const spy=spyOn(globalThis,"fetch").mockImplementation(Object.assign((input:RequestInfo|URL,init?:RequestInit)=>String(input).includes("/sessions/session-one/snapshot")?Promise.reject(failure):original(input,init),{preconnect:original.preconnect}));
 try{expect(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one").catch(error=>error)).toBe(failure);}finally{spy.mockRestore();}
});

async function renderSessionSurface(f:Awaited<ReturnType<typeof fixture>>, sessionId="session-one") {
 const [{SessionSurface},{LocalProvider},{ShellConfigProvider},{LegalworkControlProvider},{WorkspaceProvider}]=await Promise.all([
  import("../src/react-app/domains/session/surface/session-surface"),import("../src/react-app/kernel/local-provider"),import("../src/react-app/shell/shell-config"),import("../src/react-app/shell/control/control-provider"),import("../src/react-app/shell/workspace-provider"),
 ]);
 const surface=createElement(SessionSurface,{client:f.legalwork,workspaceId:f.input.workspaceId,workspaceRoot:f.input.directory ?? "/synthetic/selected",sessionId,opencodeBaseUrl:f.input.baseUrl,legalworkToken:f.input.legalworkToken,developerMode:false,modelLabel:"Synthetic",onModelClick:()=>{},modelPickerOpen:false,selectedModel:{providerID:"synthetic",modelID:"synthetic"},onModelPickerOpenChange:()=>{},onModelChange:()=>{},onSendDraft:()=>{},onDraftChange:()=>{},attachmentsEnabled:false,attachmentsDisabledReason:null,modelVariantLabel:"Synthetic",modelVariant:null,onModelVariantChange:()=>{},agentLabel:"Synthetic",selectedAgent:null,listAgents:async()=>[],onSelectAgent:()=>{},listCommands:async()=>[],recentFiles:[],searchFiles:async()=>[],isRemoteWorkspace:false,isSandboxWorkspace:false});
 const previousWindow=Object.getOwnPropertyDescriptor(globalThis,"window");
 Object.defineProperty(globalThis,"window",{configurable:true,value:{localStorage:{getItem:()=>null},addEventListener:()=>{},removeEventListener:()=>{}}});
 let html:string;
 try{html=renderToStaticMarkup(createElement(MemoryRouter,null,createElement(QueryClientProvider,{client:getReactQueryClient()},createElement(LocalProvider,null,createElement(ShellConfigProvider,null,createElement(LegalworkControlProvider,null,createElement(WorkspaceProvider,{client:null,selectedWorkspaceRoot:"/synthetic/selected"},surface)))))));}finally{if(previousWindow)Object.defineProperty(globalThis,"window",previousWindow);else Reflect.deleteProperty(globalThis,"window");}
 return html;
}

for(const history of ["live","empty"] as const){
 for(const fails of [true,false]){
  test(`initial snapshot ${fails?"boundary failure":"success"} with ${history} history discloses exactly the required load state`,async()=>{
   const value=busySnapshot();value.messages=history==="live"?value.messages.slice(0,1):[];
   if(fails)value.session.revert={messageID:"absent-initial-full-cursor"};
   const f=await fixture({snapshot:value});
   if(history==="live"){
    // This history arrives through actual SSE before any snapshot succeeds.
    const message=busySnapshot().messages[0];
    f.wire({type:"message.updated",properties:{info:message.info}});
    f.wire({type:"message.part.updated",properties:{part:message.parts[0]}});
    await waitFor(()=>getReactQueryClient().getQueryData<Array<{parts:Array<{text?:string}>}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.parts.some(part=>part.text?.includes("Synthetic selected source")))===true);
   }
   const key=snapshotKey(f.input.workspaceId,"session-one"),client=getReactQueryClient();
   expect(client.getQueryData(key)).toBeUndefined();
   // SSR has no mount phase. Render the settled existing empty-error branch
   // without its default optimistic retry-on-mount transition.
   if(fails && history==="empty"){
    const previousDefaults=client.getQueryDefaults(key);
    client.setQueryDefaults(key,{...previousDefaults,retryOnMount:false});
    cleanups.push(async()=>{client.setQueryDefaults(key,previousDefaults);});
   }
   const observer=new QueryObserver(client,{queryKey:key,queryFn:async({signal})=>(await f.legalwork.getSessionSnapshot(f.input.workspaceId,"session-one",{limit:140,signal})).item});
   const release=observer.subscribe(()=>{});cleanups.push(async()=>release());
   await waitFor(()=>fails?observer.getCurrentResult().isError:observer.getCurrentResult().isSuccess);
   const result=observer.getCurrentResult();
   if(fails)expect(result.error).toMatchObject({code:"session_revert_boundary_unresolved"});
   else expect(result.error).toBeNull();
   const html=await renderSessionSurface(f);
   expect({requests:f.snapshotReads(),snapshotPresent:Boolean(result.data),historyVisible:html.includes("Synthetic selected source"),loadFailureVisible:html.includes(t("session.load_failed")),alertVisible:html.includes('role="alert"')}).toEqual({requests:fails?["140",null]:["140"],snapshotPresent:!fails,historyVisible:history==="live",loadFailureVisible:fails,alertVisible:fails && history==="live"});
   expect(html.split(t("session.load_failed")).length-1).toBe(fails?1:0);
   expect(html).not.toContain("absent-initial-full-cursor");
   if(fails && history==="live"){
    const releaseOther=trackWorkspaceSessionSync(f.input,"session-two");cleanups.push(async()=>releaseOther());
    const other=busySnapshot().messages[0];
    f.wire({type:"message.updated",properties:{info:{...other.info,id:"other-session-user",sessionID:"session-two"}}});
    f.wire({type:"message.part.updated",properties:{part:{...other.parts[0],id:"other-session-part",messageID:"other-session-user",sessionID:"session-two",text:"Synthetic other session history"}}});
    await waitFor(()=>client.getQueryData<Array<{parts:Array<{text?:string}>}>>(transcriptKey(f.input.workspaceId,"session-two"))?.some(message=>message.parts.some(part=>part.text==="Synthetic other session history"))===true);
    const otherHtml=await renderSessionSurface(f,"session-two");
    expect(otherHtml).toContain("Synthetic other session history");
    expect(otherHtml).not.toContain(t("session.load_failed"));expect(otherHtml).not.toContain('role="alert"');
    expect(client.getQueryState(snapshotKey(f.input.workspaceId,"session-two"))?.error).toBeNull();
    const returnedHtml=await renderSessionSurface(f);
    expect(returnedHtml).toContain('role="alert"');expect(returnedHtml.split(t("session.load_failed")).length-1).toBe(1);
    expect(f.snapshotReads()).toEqual(["140",null]);
    value.session.revert=undefined;
    expect((await observer.refetch()).isSuccess).toBe(true);
    const recoveredHtml=await renderSessionSurface(f);
    expect(recoveredHtml).toContain("Synthetic selected source");
    expect(recoveredHtml).not.toContain(t("session.load_failed"));
    expect(recoveredHtml).not.toContain('role="alert"');
    expect(f.snapshotReads()).toEqual(["140",null,"140"]);
   }
  });
 }
}

test("an unresolved boundary is visibly localized beside a previously cached SessionSurface transcript",async()=>{
 const value=busySnapshot();value.messages.splice(1);
 let transientFailures=0;
 const f=await fixture({snapshot:value,snapshotReply:(_limit,response)=>{
  response.writeHead(transientFailures>0?503:200,{"content-type":"application/json"});
  if(transientFailures>0){transientFailures--;response.end(JSON.stringify({code:"synthetic_temporary",message:"Synthetic temporary transport failure"}));}
  else response.end(JSON.stringify({item:value}));
 }});
 const observed=await observeHttpSnapshot(f,{hydrate:true});
 value.session.revert={messageID:"absent-full-cursor"};
 await getReactQueryClient().refetchQueries({queryKey:observed.key,exact:true});
 expect(observed.result().error).toBeInstanceOf(LegalworkServerError);
 const html=await renderSessionSurface(f);
 expect(html).toContain('role="alert"');expect(html.split(t("session.load_failed")).length-1).toBe(1);
 expect(html).toContain("Synthetic selected source");expect(html).not.toContain("absent-full-cursor");
 // Exercise the real Surface queryFn/retry options through an actual observer.
 const query=getReactQueryClient().getQueryCache().find({queryKey:observed.key,exact:true});
 if(!query)throw new Error("Missing Surface snapshot query");
 expect(typeof query.options.retry).toBe("function");
 const retryObserver=new QueryObserver(getReactQueryClient(),{...query.options,queryKey:observed.key,retryDelay:0,enabled:false});
 const releaseRetry=retryObserver.subscribe(()=>{});
 try{
  environmentManager.setIsServer(()=>false);
  let before=f.snapshotReads().length;
  await retryObserver.refetch();
  expect(f.snapshotReads().slice(before)).toEqual(["140",null]);
  expect(retryObserver.getCurrentResult().error).toMatchObject({code:"session_revert_boundary_unresolved"});
  expect(retryObserver.getCurrentResult().data).toBe(observed.published());
  value.session.revert=undefined;transientFailures=3;before=f.snapshotReads().length;
  expect((await retryObserver.refetch()).isSuccess).toBe(true);
  expect(f.snapshotReads().slice(before)).toEqual(["140","140","140","140"]);
  environmentManager.setIsServer(()=>true);transientFailures=1;before=f.snapshotReads().length;
  expect((await retryObserver.refetch()).isError).toBe(true);
  expect(f.snapshotReads().slice(before)).toEqual(["140"]);
 }finally{releaseRetry();environmentManager.setIsServer(()=>isServer);}
});

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

for(const boundary of ["empty-error-answer","nonempty-error-answer","missing-raw-cursor","cached-raw-cursor","no-revert"]){
 test(`raw accepted-work boundary ${boundary} is evaluated before error messages become UI rows`,async()=>{
  const httpSnapshot=busySnapshot();httpSnapshot.messages.splice(1);
  const f=await fixture({directory:"/synthetic/selected",snapshot:httpSnapshot});
  const snapshot=await observeHttpSnapshot(f);
  seedSessionState(f.input.workspaceId,snapshot.published());
  await f.wireStatus({type:"busy"});
  f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic failed source turn"}}}});
  await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"].errorActive===true);
  if(boundary==="cached-raw-cursor"){
   f.wire({type:"message.updated",properties:{info:{id:"cached-raw-cursor",sessionID:"session-one",role:"assistant",time:{created:2}}}});
   await waitFor(()=>getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="cached-raw-cursor")===true);
  }
  const newer:LegalworkSessionSnapshot["messages"][number]={info:{id:"candidate-new-user",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:3}},parts:[]};
  f.wire({type:"message.updated",properties:{info:newer.info}});
  await waitFor(()=>getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="candidate-new-user")===true);
  const errorId=boundary==="nonempty-error-answer"?"nonempty-error-answer":"empty-error-answer";
  httpSnapshot.messages.push({info:{id:errorId,sessionID:"session-one",role:"assistant",parentID:"source-turn",agent:"synthetic",mode:"synthetic",modelID:"synthetic",providerID:"synthetic",path:{cwd:"/synthetic/selected",root:"/synthetic/selected"},cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},time:{created:2,completed:2},error:{name:"UnknownError",data:{message:"Synthetic failed answer"}}},parts:boundary==="nonempty-error-answer"?[{id:"visible-error-part",sessionID:"session-one",messageID:errorId,type:"text",text:"Synthetic visible failed response"}]:[]},newer);
  const revert=boundary==="no-revert"?undefined:{messageID:boundary};
  httpSnapshot.session.revert=revert;
  await getReactQueryClient().refetchQueries({queryKey:snapshot.key,exact:true});
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic authoritative revert",time:{created:1,updated:2},...(revert?{revert}:{})}}});
  await waitFor(()=>snapshot.published().session.time.updated===2);
  const unresolved=boundary==="missing-raw-cursor"||boundary==="cached-raw-cursor";
  if(unresolved){
   await waitFor(()=>snapshot.result().fetchStatus==="idle");
   expect(snapshot.result().error).toMatchObject({code:"session_revert_boundary_unresolved"});
   expect(snapshot.published().messages.map(message=>message.info.id)).toEqual(["source-turn"]);
  }else expect(snapshot.published().messages.map(message=>message.info.id)).toEqual(["source-turn",errorId,"candidate-new-user"]);
  expect(snapshot.published().session.revert).toEqual(revert);
  // The SDK now refuses an unresolved full read. Still exercise the lower-level
  // safe partial-page replay guard against actual live SSE transcript identities.
  const replay=unresolved?{...httpSnapshot,session:snapshot.published().session}:snapshot.published();
  seedSessionState(f.input.workspaceId,replay);
  const firstHasNewer=getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="candidate-new-user");
  seedSessionState(f.input.workspaceId,replay);
  const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  const transcript=getReactQueryClient().getQueryData<Array<{id:string}>>(transcriptKey(f.input.workspaceId,"session-one"));
  const observed={runActive:activity?.runActive,errorActive:activity?.errorActive,errorUserMessageId:activity?.errorUserMessageId,revertMessageID:snapshot.published().session.revert?.messageID,transcriptIds:transcript?.map(message=>message.id)};
  expect(observed).toMatchObject(boundary==="no-revert"?{runActive:true,errorActive:false,errorUserMessageId:null}:{runActive:false,errorActive:true,errorUserMessageId:"source-turn"});
  const hasNewer=boundary==="no-revert"||boundary==="missing-raw-cursor";
  expect({firstHasNewer,secondHasNewer:transcript?.some(message=>message.id==="candidate-new-user")}).toEqual({firstHasNewer:hasNewer,secondHasNewer:hasNewer});
  expect(transcript?.some(message=>message.id==="source-turn")).toBe(true);
  f.release();f.owner();expect(f.closed()).toBe(0);expect(__hasWorkspaceSessionSyncForTest(f.input)).toBe(true);
  if(boundary==="no-revert"){
   const owner=ensureWorkspaceSessionSync(f.input),release=trackWorkspaceSessionSync(f.input,"session-one");
   await f.wireStatus({type:"idle"});release();owner();await waitFor(()=>f.closed()===1);
  }
 });
}

test("unresolved initial snapshot revert preserves an empty transcript without guessing a boundary",()=>{
 const workspaceId="synthetic-unresolved-first-read",snapshot=busySnapshot();
 snapshot.session.revert={messageID:"not-in-this-page"};
 seedSessionState(workspaceId,snapshot);
 expect(getReactQueryClient().getQueryData(transcriptKey(workspaceId,"session-one"))).toEqual([]);
 expect(snapshot.session.revert).toEqual({messageID:"not-in-this-page"});
 expect(getReactQueryClient().getQueryData(statusKey(workspaceId,"session-one"))).toEqual({type:"busy"});
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

// The reader comes from the real Surface; this is not a test-owned queryFn.
test("Surface held HTTP response cannot resurrect a run after actual SSE idle", async () => {
 const value=busySnapshot(); let finish:(()=>void)|undefined;
 const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response,read)=>{
  response.writeHead(200,{"content-type":"application/json"});
  const body=JSON.stringify({item:value});
  if(read===2){response.flushHeaders();finish=()=>response.end(body);}else response.end(body);
 }});
 await renderSessionSurface(f);
 const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one");
 const query=client.getQueryCache().find({queryKey:key,exact:true});
 if(!query)throw new Error("Actual Surface reader missing");
 const observer=new QueryObserver<LegalworkSessionSnapshot>(client,{...query.options,queryKey:key,enabled:false});
 const release=observer.subscribe(result=>{if(result.data)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);});
 cleanups.push(async()=>release());
 await observer.refetch();
 const pending=observer.refetch();await waitFor(()=>Boolean(finish));
 f.wire({type:"session.idle",properties:{sessionID:"session-one"}});
 await waitFor(()=>client.getQueryData<SessionStatus>(statusKey(f.input.workspaceId,"session-one"))?.type==="idle");
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.runActive).toBe(false);
 finish?.();await pending;
 expect(observer.getCurrentResult().data?.status.type).toBe("idle");
 expect(client.getQueryData<SessionStatus>(statusKey(f.input.workspaceId,"session-one"))?.type).toBe("idle");
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.runActive).toBe(false);
});

for(const scenario of ["initial-idle","same-idle","native-busy","error","metadata-only","new-accepted","same-busy-accepted","other-session","other-scope"] as const){
 test(`actual Surface reader execution ordering: ${scenario}`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  if(scenario==="native-busy"||scenario==="new-accepted")value.status={type:"idle"};
  const initial=scenario==="initial-idle";
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response,read)=>{
   response.writeHead(200,{"content-type":"application/json"});const body=JSON.stringify({item:value});
   if(read===(initial?1:2)){response.flushHeaders();finish=()=>response.end(body);}else response.end(body);
  }});
  await renderSessionSurface(f);
  const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one");
  const query=client.getQueryCache().find({queryKey:key,exact:true});if(!query)throw new Error("Surface reader absent");
  const observer=new QueryObserver<LegalworkSessionSnapshot>(client,{...query.options,queryKey:key,enabled:false});
  const release=observer.subscribe(result=>{if(result.data)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);});cleanups.push(async()=>release());
  if(!initial)await observer.refetch();
  if(scenario==="same-idle")await f.wireStatus({type:"idle"});
  if(scenario==="same-busy-accepted")value.status={type:"idle"};
  if(scenario==="error")value.messages.push({info:{id:"newer-in-stale-body",sessionID:"session-one",role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[]});
  const pending=observer.refetch();await waitFor(()=>Boolean(finish));
  let expected:SessionStatus["type"]="busy";
  if(initial||scenario==="same-idle"){
   f.wire({type:"session.idle",properties:{sessionID:"session-one"}});
   await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.runActive===false);
   // A metadata marker is ordered after idle on the same native SSE stream.
   f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:0,updated:9}}}});await waitFor(()=>f.updated()===1);
   expected="idle";
  }else if(scenario==="native-busy")await f.wireStatus({type:"busy"});
  else if(scenario==="error"){
   f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic ordering failure"}}}});
   await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive===true);
  }else if(scenario==="metadata-only"){
   value.status={type:"idle"}; // This response is already captured as busy; test next read below too.
   f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic metadata",time:{created:0,updated:3}}}});
   await waitFor(()=>f.updated()===1);
  }else if(scenario==="new-accepted"||scenario==="same-busy-accepted"){
   await submitBoundDocumentGeneration({key:`ordering-${f.input.workspaceId}`,metadata:{projectId:f.input.workspaceId,workspaceId:f.input.workspaceId,baseUrl:f.input.baseUrl,root:"/synthetic/selected",directory:"/synthetic/selected"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
   expect(getDocumentGeneration(`ordering-${f.input.workspaceId}`)?.nativeRevision).toBe(0);
  }else if(scenario==="other-session"){
   f.wire({type:"session.idle",properties:{sessionID:"another-session"}});
   await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["another-session"]?.runActive===false);
  }else{
   const other=await fixture({workspaceId:f.input.workspaceId,directory:"/synthetic/other",token:"synthetic-other-scope"});
   await other.wireStatus({type:"idle"});
  }
  finish?.();await pending;
  expect(observer.getCurrentResult().data?.status.type).toBe(expected);
  const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  if(scenario==="error")expect(activity).toMatchObject({errorActive:true,runActive:false});
  else expect(activity?.runActive).toBe(expected==="busy");
  if(scenario!=="error"){
   // A later read is not permanently pinned by evidence preceding its start.
   value.status={type:"busy"};
   await observer.refetch();expect(observer.getCurrentResult().data?.status.type).toBe("busy");
  }
 });
}

for(const mode of ["native-idle","native-error","fresh-poll","metadata-only"] as const){
 test(`actual Surface snapshot and status readers: ${mode}`,async()=>{
  const value=busySnapshot();let finishSnapshot:(()=>void)|undefined,finishStatus:(()=>void)|undefined;
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response,read)=>{
   response.writeHead(200,{"content-type":"application/json"});const body=JSON.stringify({item:value});
   if(read===2){response.flushHeaders();finishSnapshot=()=>response.end(body);}else response.end(body);
  },statusReply:(response)=>{
   response.writeHead(200,{"content-type":"application/json"});
   if(mode==="fresh-poll"||mode==="metadata-only")response.end(JSON.stringify({"session-one":{type:"idle"}}));
   else{response.flushHeaders();finishStatus=()=>response.end(JSON.stringify({"session-one":{type:"busy"}}));}
  }});
  await renderSessionSurface(f);const client=getReactQueryClient();
  const observe=<T,>(key:readonly string[])=>{
   const query=client.getQueryCache().find({queryKey:key,exact:true});if(!query)throw new Error("Surface query absent");
   const observer=new QueryObserver<T>(client,{...query.options,queryKey:key,enabled:false});
   const release=observer.subscribe(()=>{});cleanups.push(async()=>release());return observer;
  };
  const snapshots=observe<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"));
  const statuses=observe<SessionStatus>(statusKey(f.input.workspaceId,"session-one"));
  const hydrate=snapshots.subscribe(result=>{if(result.data)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);});cleanups.push(async()=>hydrate());
  await snapshots.refetch();
  const snapshotPending=snapshots.refetch();await waitFor(()=>Boolean(finishSnapshot));
  const statusPending=mode==="metadata-only"?undefined:statuses.refetch();
  if(mode==="native-idle"||mode==="native-error"){
   await waitFor(()=>Boolean(finishStatus));
   if(mode==="native-idle")await f.wireStatus({type:"idle"});
   else{f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic poll ordering error"}}}});await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive===true);}
  }else await statusPending;
  f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic latest metadata",time:{created:0,updated:44}}}});await waitFor(()=>f.updated()===1);
  const publications:Array<{error:boolean|undefined;title:string|undefined}>=[];
  const watch=snapshots.subscribe(result=>publications.push({error:useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive,title:result.data?.session.title}));cleanups.push(async()=>watch());
  finishStatus?.();await statusPending;finishSnapshot?.();await snapshotPending;
  if(mode==="native-error"){
   expect(publications.every(value=>value.error===true&&value.title==="Synthetic latest metadata")).toBe(true);
   expect(snapshots.getCurrentResult().data?.session.title).toBe("Synthetic latest metadata");
   expect(snapshots.getCurrentResult().fetchStatus).toBe("idle");
   expect(statuses.getCurrentResult().fetchStatus).toBe("idle");
  }else{
   const expected=mode==="metadata-only"?"busy":"idle";
   expect(snapshots.getCurrentResult().data?.status.type).toBe(expected);
   expect(client.getQueryData<SessionStatus>(statusKey(f.input.workspaceId,"session-one"))?.type).toBe(expected);
  }
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.runActive).toBe(mode==="metadata-only");
 });
}

for(const mode of ["initial-error","initial-absent-sync","replaced-query","fresh-after-error"] as const){
 test(`actual Surface read ownership: ${mode}`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response,read)=>{
   response.writeHead(200,{"content-type":"application/json"});const body=JSON.stringify({item:value});
   if(read===1){response.flushHeaders();finish=()=>response.end(body);}else response.end(body);
  }});
  if(mode==="initial-absent-sync"){__disposeWorkspaceSessionSyncForTest(f.input);await waitFor(()=>f.closed()===1);}
  await renderSessionSurface(f);const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one");
  const query=client.getQueryCache().find({queryKey:key,exact:true});if(!query)throw new Error("Surface query absent");
  const observer=new QueryObserver<LegalworkSessionSnapshot>(client,{...query.options,queryKey:key,enabled:false});
  const release=observer.subscribe(result=>{if(result.data)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);});cleanups.push(async()=>release());
  const pending=observer.refetch();await waitFor(()=>Boolean(finish));
  if(mode==="initial-absent-sync"){const owner=ensureWorkspaceSessionSync(f.input),tracked=trackWorkspaceSessionSync(f.input,"session-one");cleanups.push(async()=>{tracked();owner();});await waitFor(()=>f.opened()===2);}
  f.wire({type:"message.updated",properties:{info:value.messages[0].info}});await waitFor(()=>client.getQueryData<UIMessage[]>(transcriptKey(f.input.workspaceId,"session-one"))?.some(message=>message.id==="source-turn")===true);
  f.wire({type:"session.error",properties:{sessionID:"session-one",error:{name:"UnknownError",data:{message:"Synthetic first read failure"}}}});await waitFor(()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive===true);
  if(mode==="replaced-query"){
   release();client.removeQueries({queryKey:key,exact:true});
   const replacement={...value,session:{...value.session,title:"Synthetic replacement owner"},status:{type:"idle"} as SessionStatus};
   client.setQueryData(key,replacement);
   finish?.();await pending;
   expect(client.getQueryData<LegalworkSessionSnapshot>(key)?.session.title).toBe("Synthetic replacement owner");
  }else{
   finish?.();await pending;
   expect(observer.getCurrentResult().data).toBeUndefined();expect(observer.getCurrentResult().fetchStatus).toBe("idle");
   expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.errorActive).toBe(true);
   if(mode==="fresh-after-error"){
    await observer.refetch();
    expect(observer.getCurrentResult().data?.status.type).toBe("busy");
    expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toMatchObject({errorActive:false,runActive:true});
   }
  }
 });
}

test("native execution scope remains exact and is absent from serialized activity",async()=>{
 const f=await fixture({directory:"/synthetic/selected",token:"synthetic-private-token"});
 await f.wireStatus({type:"busy"});
 const record=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
 expect(record?.executionEvidence?.scope?.(`${f.input.workspaceId}:${f.input.baseUrl}:${f.input.legalworkToken}:${f.input.directory}`)).toBe(true);
 for(const input of [{...f.input,legalworkToken:"other"},{...f.input,baseUrl:"http://synthetic-other"},{...f.input,directory:"/synthetic/other"}])expect(record?.executionEvidence?.scope?.(`${input.workspaceId}:${input.baseUrl}:${input.legalworkToken}:${input.directory}`)).toBe(false);
 expect(JSON.stringify(record)).not.toContain(f.input.legalworkToken);expect(JSON.stringify(record)).not.toContain(f.input.baseUrl);
 useSessionActivityStore.getState().removeSession(f.input.workspaceId,"session-one");
 expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toBeUndefined();
});

for(const mode of ["accepted-before-read","waiting","compacting"] as const){
 test(`fresh actual Surface snapshot preserves ${mode}`,async()=>{
  const value=busySnapshot();value.status={type:"idle"};
  const f=await fixture({directory:"/synthetic/selected",snapshot:value});
  await submitBoundDocumentGeneration({key:`safe-${f.input.workspaceId}`,metadata:{projectId:f.input.workspaceId,workspaceId:f.input.workspaceId,baseUrl:f.input.baseUrl,root:"/synthetic/selected",directory:"/synthetic/selected"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
  const store=useSessionActivityStore.getState();
  if(mode==="waiting")store.setWaitingRequest(f.input.workspaceId,"session-one","permission","synthetic-permission",true);
  if(mode==="compacting")store.setCompacting(f.input.workspaceId,"session-one",true);
  await renderSessionSurface(f);
  const client=getReactQueryClient(),key=snapshotKey(f.input.workspaceId,"session-one"),query=client.getQueryCache().find({queryKey:key,exact:true});if(!query)throw new Error("Surface reader absent");
  const observer=new QueryObserver<LegalworkSessionSnapshot>(client,{...query.options,queryKey:key,enabled:false});
  const release=observer.subscribe(result=>{if(result.data)for(let caller=0;caller<2;caller++)seedSessionState(f.input.workspaceId,result.data);});cleanups.push(async()=>release());
  await observer.refetch();
  const activity=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  expect(activity?.runActive).toBe(true);
  expect(getDocumentGeneration(`safe-${f.input.workspaceId}`)?.nativeRevision).toBe(0);
  if(mode==="waiting")expect(activity?.waitingPermissionIds).toEqual(["synthetic-permission"]);
  if(mode==="compacting")expect(activity?.compacting).toBe(true);
 });
}


// SSR extracts production query functions; QueryObserver executes their actual SDK reads.
function observeSurfaceReader<T>(key:readonly string[], hydrate=false){
 const client=getReactQueryClient(),query=client.getQueryCache().find({queryKey:key,exact:true});
 if(!query)throw new Error("Actual Surface query missing");
 const observer=new QueryObserver<T>(client,{...query.options,queryKey:key,enabled:false});
 const release=observer.subscribe(result=>{if(hydrate&&result.data)for(let caller=0;caller<2;caller++)seedSessionState(key[1],result.data as LegalworkSessionSnapshot);});
 cleanups.push(async()=>release());return observer;
}
for(const direction of ["snapshot","status"] as const)for(const scope of ["same","auth","base","directory"] as const)for(const later of ["idle","busy"] as const){
 test(`producing HTTP scope ${direction} ${scope} later-${later}`,async()=>{
  const raw:SessionStatus={type:later==="idle"?"busy":"idle"},value=busySnapshot();value.status=raw;
  let finish:(()=>void)|undefined;
  const reply=(response:ServerResponse,body:unknown,held:boolean)=>{response.writeHead(200,{"content-type":"application/json"});const text=JSON.stringify(body);if(held){response.flushHeaders();finish=()=>response.end(text);}else response.end(text);};
  const f=await fixture({allowConnectionChanges:true,directory:"/synthetic/selected",snapshot:value,
   snapshotReply:(_limit,response)=>reply(response,{item:{...value,status:direction==="snapshot"?raw:{type:later}}},direction==="snapshot"),
   statusReply:response=>reply(response,{"session-one":direction==="status"?raw:{type:later}},direction==="status"),
  });
  await renderSessionSurface(f);
  const key=direction==="snapshot"?snapshotKey(f.input.workspaceId,"session-one"):statusKey(f.input.workspaceId,"session-one");
  const old=observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(key,direction==="snapshot");
  const pending=old.refetch();await waitFor(()=>Boolean(finish));
  let other=f;
  if(scope==="base")other=await fixture({workspaceId:f.input.workspaceId,directory:f.input.directory,snapshot:{...value,status:{type:later}},statusReply:response=>reply(response,{"session-one":{type:later}},false)});
  else if(scope!=="same"){
   const input={...f.input,...(scope==="auth"?{legalworkToken:"synthetic-other-read-token"}:{directory:"/synthetic/other"})};
   other={...f,input,legalwork:createLegalworkServerClient({baseUrl:input.baseUrl,token:input.legalworkToken})};
  }
  await renderSessionSurface(other);
  const laterKey=direction==="snapshot"?statusKey(f.input.workspaceId,"session-one"):snapshotKey(f.input.workspaceId,"session-one");
  await observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(laterKey,direction==="status").refetch();finish?.();await pending;
  const result=old.getCurrentResult().data;
  expect(result && ("session" in result?result.status.type:result.type)).toBe(scope==="same"?later:raw.type);
  const requests=[...f.requestScopes,...(other===f?[]:other.requestScopes)].filter(request=>request.path!=="/event");
  expect(requests.some(request=>request.authorization===`Bearer ${other.input.legalworkToken}`)).toBe(true);
  if(direction==="snapshot")expect(requests.some(request=>request.path==="/session/status"&&request.directory===other.input.directory)).toBe(true);
 });
}
for(const mode of ["permission","permission-v2","question","compaction"] as const){
 test(`older actual status read preserves native ${mode}`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,statusReply:(response,read)=>{
   response.writeHead(200,{"content-type":"application/json"});const body=JSON.stringify({"session-one":{type:"idle"}});
   if(read===1){response.flushHeaders();finish=()=>response.end(body);}else response.end(body);
  }});
  await renderSessionSurface(f);
  const client=getReactQueryClient(),snapshots=observeSurfaceReader<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"),true);
  const statuses=observeSurfaceReader<SessionStatus>(statusKey(f.input.workspaceId,"session-one"));
  await snapshots.refetch();await f.wireStatus({type:"busy"});
  f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:1,updated:2}}}});await waitFor(()=>f.updated()===1);
  const pending=statuses.refetch();await waitFor(()=>Boolean(finish));
  const type=mode==="compaction"?"session.next.compaction.started":mode==="permission-v2"?"permission.v2.asked":`${mode}.asked`;
  f.wire({type,properties:{id:"synthetic-guard",sessionID:"session-one",permission:"read",patterns:[],always:[],metadata:{},questions:[]}});
  const record=()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  await waitFor(()=>record()?.status===(mode==="compaction"?"compacting":"waiting"));
  finish?.();await pending;
  expect(record()).toMatchObject({runActive:true,status:mode==="compaction"?"compacting":"waiting",compacting:mode==="compaction"});
  expect(record()?.waitingPermissionIds).toEqual(mode.startsWith("permission")?["synthetic-guard"]:[]);
  expect(record()?.waitingQuestionIds).toEqual(mode==="question"?["synthetic-guard"]:[]);
  expect(client.getQueryData<SessionStatus>(statusKey(f.input.workspaceId,"session-one"))?.type).toBe("busy");
  expect(client.getQueryData<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"))?.status.type).toBe("busy");
  expect(statuses.getCurrentResult().fetchStatus).toBe("idle");
  f.wire({type:mode==="compaction"?"session.next.compaction.ended":mode==="permission-v2"?"permission.v2.replied":`${mode}.replied`,properties:{sessionID:"session-one",requestID:"synthetic-guard"}});
  await waitFor(()=>record()?.status==="thinking");
  await statuses.refetch();
  expect(record()).toMatchObject({runActive:false,status:"idle",compacting:false,waitingPermissionIds:[],waitingQuestionIds:[]});
  expect(client.getQueryData<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"))?.status.type).toBe("idle");
 });
}


for(const mode of ["idle","terminal-idle","metadata","accepted","accepted-same-busy","other-auth","other-base","other-directory"] as const){
 test(`actual status guard control ${mode}`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  const f=await fixture({allowConnectionChanges:true,directory:"/synthetic/selected",snapshot:value,statusReply:response=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();finish=()=>response.end(JSON.stringify({"session-one":{type:"idle"}}));}});
  await renderSessionSurface(f);
  const client=getReactQueryClient(),snapshots=observeSurfaceReader<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"),true),statuses=observeSurfaceReader<SessionStatus>(statusKey(f.input.workspaceId,"session-one"));
  await snapshots.refetch();await f.wireStatus({type:"busy"});
  f.wire({type:"session.updated",properties:{info:{id:"session-one",time:{created:1,updated:2}}}});await waitFor(()=>f.updated()===1);
  const pending=statuses.refetch();await waitFor(()=>Boolean(finish));
  const record=()=>useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
  if(mode==="idle"||mode==="terminal-idle"){
   f.wire({type:"permission.asked",properties:{id:"synthetic-guard",sessionID:"session-one",permission:"read",patterns:[],always:[],metadata:{}}});
   await waitFor(()=>record()?.status==="waiting");
   if(mode==="idle")await f.wireStatus({type:"idle"});
   else{f.wire({type:"session.idle",properties:{sessionID:"session-one"}});await waitFor(()=>record()?.status==="idle");}
  }else if(mode==="metadata"){
   const before=record()?.executionEvidence;
   useSessionActivityStore.getState().replaceWaitingRequests(f.input.workspaceId,"session-one","permission",["hydrated-wait"]);
   useSessionActivityStore.getState().markMessageRole(f.input.workspaceId,"session-one","metadata-role","assistant");
   f.wire({type:"session.updated",properties:{info:{id:"session-one",title:"Synthetic metadata during read",time:{created:1,updated:3}}}});await waitFor(()=>f.updated()===2);
   expect(record()?.executionEvidence).toBe(before);
  }else if(mode.startsWith("accepted")){
   if(mode==="accepted")await f.wireStatus({type:"idle"});
   await submitBoundDocumentGeneration({key:`status-${f.input.workspaceId}`,metadata:{projectId:f.input.workspaceId,workspaceId:f.input.workspaceId,baseUrl:f.input.baseUrl,root:"/synthetic/selected",directory:"/synthetic/selected"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
   expect(getDocumentGeneration(`status-${f.input.workspaceId}`)?.nativeRevision).toBe(0);
  }else{
   if(mode==="other-base"){
    const other=await fixture({workspaceId:f.input.workspaceId,directory:f.input.directory,token:f.input.legalworkToken});
    other.wire({type:"session.next.compaction.started",properties:{sessionID:"session-one"}});
   }else{
    const input={...f.input,...(mode==="other-auth"?{legalworkToken:"synthetic-activity-other"}:{directory:"/synthetic/other"})};
    const owner=ensureWorkspaceSessionSync(input),release=trackWorkspaceSessionSync(input,"session-one");
    cleanups.push(async()=>{release();owner();__disposeWorkspaceSessionSyncForTest(input);});
    await waitFor(()=>f.opened()===2);
    f.wire({type:"session.next.compaction.started",properties:{sessionID:"session-one"}},{token:input.legalworkToken,directory:input.directory});
   }
   await waitFor(()=>record()?.compacting===true);
  }
  finish?.();await pending;
  const expected=mode.startsWith("accepted")?"busy":"idle";
  expect(client.getQueryData<SessionStatus>(statusKey(f.input.workspaceId,"session-one"))?.type).toBe(expected);
  expect(client.getQueryData<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"))?.status.type).toBe(expected);
  expect(record()?.runActive).toBe(expected==="busy");
  if(expected==="idle")expect(record()).toMatchObject({waitingPermissionIds:[],waitingQuestionIds:[],compacting:false});
  if(mode==="metadata")expect(client.getQueryData<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"))?.session.title).toBe("Synthetic metadata during read");
 });
}

for(const direction of ["snapshot","status"] as const)for(const mode of ["abort","remove","replacement"] as const){
 test(`producing reader cleanup ${direction} ${mode}`,async()=>{
  const value=busySnapshot();let oldBody:(()=>void)|undefined,newBody:(()=>void)|undefined;
  const reply=(response:ServerResponse,body:unknown,read:number)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();const complete=()=>response.end(JSON.stringify(body));if(read===1)oldBody=complete;else newBody=complete;};
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response,read)=>reply(response,{item:value},read),statusReply:(response,read)=>reply(response,{"session-one":{type:"busy"}},read)});
  await renderSessionSurface(f);
  const client=getReactQueryClient(),key=direction==="snapshot"?snapshotKey(f.input.workspaceId,"session-one"):statusKey(f.input.workspaceId,"session-one");
  const observer=observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(key);
  const subscribe=useSessionActivityStore.subscribe;let active=0;
  const spy=spyOn(useSessionActivityStore,"subscribe").mockImplementation(listener=>{active++;const release=subscribe(listener);return()=>{active--;release();};});
  cleanups.push(async()=>spy.mockRestore());
  const pending=observer.refetch();await waitFor(()=>Boolean(oldBody));expect(active).toBe(1);
  if(mode==="remove")client.removeQueries({queryKey:key,exact:true});
  else await client.cancelQueries({queryKey:key,exact:true},{silent:true,revert:false});
  await waitFor(()=>active===0);
  const before=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence;
  if(mode==="replacement"){
   const replacement=observer.refetch();await waitFor(()=>Boolean(newBody));expect(active).toBe(1);
   oldBody?.();await pending;
   expect(observer.getCurrentResult().fetchStatus).toBe("fetching");expect(active).toBe(1);
   expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence).toBe(before);
   newBody?.();await replacement;
   expect(observer.getCurrentResult().isSuccess).toBe(true);
   expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence?.source).toBe("read");
  }else{oldBody?.();await pending;expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence).toBe(before);}
  expect(active).toBe(0);
 });
}

test("validated read token changes only provenance and never serializes its scope",async()=>{
 const value=busySnapshot(),f=await fixture({directory:"/synthetic/selected",token:"synthetic-read-private-token",snapshot:value});
 await f.wireStatus({type:"busy"});
 await renderSessionSurface(f);
 const before=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
 const observer=observeSurfaceReader<LegalworkSessionSnapshot>(snapshotKey(f.input.workspaceId,"session-one"));await observer.refetch();
 const after=useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"];
 expect(after).toEqual({...before,executionEvidence:after?.executionEvidence});
 expect(after?.executionEvidence?.source).toBe("read");
 expect(after?.executionEvidence?.scope?.(`${f.input.workspaceId}:${f.input.baseUrl}:${f.input.legalworkToken}:${f.input.directory}`)).toBe(true);
 for(const input of [{...f.input,legalworkToken:"other"},{...f.input,baseUrl:"http://synthetic-other"},{...f.input,directory:"/synthetic/other"}])expect(after?.executionEvidence?.scope?.(`${input.workspaceId}:${input.baseUrl}:${input.legalworkToken}:${input.directory}`)).toBe(false);
 expect(JSON.stringify(after)).not.toContain(f.input.legalworkToken);expect(JSON.stringify(after)).not.toContain(f.input.baseUrl);
 useSessionActivityStore.getState().removeSession(f.input.workspaceId,"session-one");expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]).toBeUndefined();
});


test("fresh status poll after revision-zero acceptance keeps the existing HTTP recovery contract",async()=>{
 const f=await fixture({directory:"/synthetic/selected",statusReply:response=>{response.writeHead(200,{"content-type":"application/json"});response.end(JSON.stringify({"session-one":{type:"idle"}}));}});
 await submitBoundDocumentGeneration({key:`fresh-${f.input.workspaceId}`,metadata:{projectId:f.input.workspaceId,workspaceId:f.input.workspaceId,baseUrl:f.input.baseUrl,root:"/synthetic/selected",directory:"/synthetic/selected"},preflight:async()=>{},create:async()=>"session-one",send:async()=>{}});
 await renderSessionSurface(f);
 const status=observeSurfaceReader<SessionStatus>(statusKey(f.input.workspaceId,"session-one"));await status.refetch();
 expect(status.getCurrentResult().data?.type).toBe("idle");
 expect(getDocumentGeneration(`fresh-${f.input.workspaceId}`)).toMatchObject({phase:"accepted",nativeRevision:0,nativeRunObserved:false});
});


for(const direction of ["snapshot","status"] as const){
 test(`manual hydration cannot impersonate a producing ${direction} read`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  const reply=(response:ServerResponse,body:unknown)=>{response.writeHead(200,{"content-type":"application/json"});response.flushHeaders();finish=()=>response.end(JSON.stringify(body));};
  const f=await fixture({directory:"/synthetic/selected",snapshot:value,snapshotReply:(_limit,response)=>reply(response,{item:value}),statusReply:response=>reply(response,{"session-one":{type:"busy"}})});
  await renderSessionSurface(f);
  const client=getReactQueryClient(),key=direction==="snapshot"?snapshotKey(f.input.workspaceId,"session-one"):statusKey(f.input.workspaceId,"session-one");
  const observer=observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(key);
  const pending=observer.refetch();await waitFor(()=>Boolean(finish));
  const store=useSessionActivityStore.getState(),before=store.recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence;
  client.setQueryData(snapshotKey(f.input.workspaceId,"session-one"),{...value,status:{type:"idle"}});
  client.setQueryData(statusKey(f.input.workspaceId,"session-one"),{type:"idle"});
  store.seedWorkspaceSessions(f.input.workspaceId,[{id:"session-one",status:{type:"idle"}}]);
  store.seedSessionRun(f.input.workspaceId,"session-one",{type:"idle"},false);
  store.replaceWaitingRequests(f.input.workspaceId,"session-one","question",[]);
  expect(useSessionActivityStore.getState().recordsByWorkspaceId[f.input.workspaceId]?.["session-one"]?.executionEvidence).toBe(before);
  finish?.();await pending;
  const result=observer.getCurrentResult().data;expect(result&&("session" in result?result.status.type:result.type)).toBe("busy");
 });
}


for(const direction of ["snapshot","status"] as const)for(const different of ["workspace","session"] as const){
 test(`producing read keeps another ${different} isolated from ${direction}`,async()=>{
  const value=busySnapshot();let finish:(()=>void)|undefined;
  const reply=(response:ServerResponse,body:unknown,hold:boolean)=>{response.writeHead(200,{"content-type":"application/json"});const text=JSON.stringify(body);if(hold){response.flushHeaders();finish=()=>response.end(text);}else response.end(text);};
  const f=await fixture({allowConnectionChanges:true,directory:"/synthetic/selected",snapshot:value,
   snapshotReply:(_limit,response,_read,sessionId)=>reply(response,{item:{...value,session:{...value.session,id:sessionId},status:{type:direction==="snapshot"?"busy":"idle"}}},direction==="snapshot"),
   statusReply:response=>reply(response,{"session-one":{type:direction==="status"?"busy":"idle"},"session-two":{type:"idle"}},direction==="status"),
  });
  await renderSessionSurface(f);
  const oldKey=direction==="snapshot"?snapshotKey(f.input.workspaceId,"session-one"):statusKey(f.input.workspaceId,"session-one");
  const old=observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(oldKey);
  const pending=old.refetch();await waitFor(()=>Boolean(finish));
  const other={...f,input:{...f.input,workspaceId:different==="workspace"?randomUUID():f.input.workspaceId}},sessionId=different==="session"?"session-two":"session-one";
  await renderSessionSurface(other,sessionId);
  const otherKey=direction==="snapshot"?statusKey(other.input.workspaceId,sessionId):snapshotKey(other.input.workspaceId,sessionId);
  await observeSurfaceReader<LegalworkSessionSnapshot|SessionStatus>(otherKey).refetch();
  finish?.();await pending;
  const result=old.getCurrentResult().data;expect(result&&("session" in result?result.status.type:result.type)).toBe("busy");
 });
}
