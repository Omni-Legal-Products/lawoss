import { afterEach, expect, test } from "bun:test";
import { QueryObserver } from "@tanstack/react-query";
import { createServer, type ServerResponse } from "node:http";
import type { SessionStatus } from "@opencode-ai/sdk/v2/client";
import { randomUUID } from "node:crypto";
import { applyDocumentGenerationRunStatus, clearDocumentGenerationsForTest, getDocumentGeneration, observeDocumentGeneration, submitBoundDocumentGeneration } from "../src/react-app/domains/session/panel/document-generation-lifecycle";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { ensureWorkspaceSessionSync, trackWorkspaceSessionSync, seedSessionState, __applySessionSyncEventForTest, __hasWorkspaceSessionSyncForTest, __disposeWorkspaceSessionSyncForTest, statusKey, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";

const cleanups: Array<() => Promise<void>>=[];
afterEach(async()=>{while(cleanups.length)await cleanups.pop()?.();getReactQueryClient().clear();clearDocumentGenerationsForTest();useSessionActivityStore.setState({recordsByWorkspaceId:{},statusesByWorkspaceId:{}});});
async function waitFor(read:()=>boolean){for(let i=0;i<100;i++){if(read())return;await new Promise(r=>setTimeout(r,10));}expect(read()).toBe(true);}
async function fixture(options: { gcTime?: number; workspaceId?: string; directory?: string; token?: string } = {}){
 let opened=0,closed=0,ready=false;
 const responses = new Set<ServerResponse>();
 const token = options.token ?? "synthetic-sync-token";
 const server=createServer((request,response)=>{
  expect(request.url?.split("?")[0]).toBe("/event");expect(request.headers.authorization).toBe(`Bearer ${token}`);
  response.writeHead(200,{"content-type":"text/event-stream"});response.write('data: {"type":"server.connected","properties":{}}\n\n');opened++;responses.add(response);
  response.write('data: {"type":"session.status","properties":{"sessionID":"fixture-ready","status":{"type":"idle"}}}\n\n');
  const heartbeat=setInterval(()=>response.write(': heartbeat\n\n'),50);
  response.once("close",()=>{clearInterval(heartbeat);responses.delete(response);closed++;});
 });
 await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();if(!address||typeof address==="string")throw new Error("Missing fixture address");
 const input={workspaceId:options.workspaceId ?? randomUUID(),baseUrl:`http://127.0.0.1:${address.port}`,legalworkToken:token,directory:options.directory,onSessionStatus:(event:{sessionId:string})=>{if(event.sessionId==="fixture-ready")ready=true;}};
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
 const f = await fixture({gcTime:naturalGcMs});
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
