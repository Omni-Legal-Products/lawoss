import type { UIMessage } from "ai";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { seedSessionState, snapshotKey, statusKey, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { deriveRenderedSessionMessages } from "../src/react-app/domains/session/surface/session-render-state";
import type { SessionSurfaceProps } from "../src/react-app/domains/session/surface/session-surface";

function boundarySnapshot(sessionId: string): LegalworkSessionSnapshot {
 const user=(id:string,text:string):LegalworkSessionSnapshot["messages"][number]=>({info:{id,sessionID:sessionId,role:"user",agent:"synthetic",model:{providerID:"synthetic",modelID:"synthetic"},time:{created:0}},parts:[{id:`part-${id}`,sessionID:sessionId,messageID:id,type:"text",text}]});
 return {session:{id:sessionId,title:"Synthetic boundary",version:"1",time:{created:0,updated:0},revert:{messageID:"X"}},status:{type:"idle"},todos:[],messages:[
  user("A","Synthetic retained history alpha"),
  {info:{id:"X",sessionID:sessionId,role:"assistant",parentID:"A",agent:"synthetic",mode:"synthetic",modelID:"synthetic",providerID:"synthetic",path:{cwd:"/synthetic",root:"/synthetic"},cost:0,tokens:{input:0,output:0,reasoning:0,cache:{read:0,write:0}},time:{created:0,completed:0},error:{name:"UnknownError",data:{message:"Synthetic reverted error xray"}}},parts:[]},
  user("B","Synthetic reverted tail bravo"),
 ]};
}

const visiblePhrases = [["Synthetic retained history alpha","A"],["Synthetic reverted error xray","session-error:X"],["Synthetic assistant response xray","X"],["Synthetic reverted tail bravo","B"],["Synthetic live charlie","C"],["Synthetic later delta","D"]] as const;
function boundaryScenarios(sessionId:string){
 const ui=(id:string,text:string):UIMessage=>({id,role:"user",parts:[{type:"text",text}]});
 const history=ui("A",visiblePhrases[0][0]),liveCursor=ui("C",visiblePhrases[4][0]),tail=ui("D",visiblePhrases[5][0]);
 return ["empty-error","empty-error-live-raw","nonempty-error","ordinary-assistant","ordinary-user","live-only-boundary","unavailable-boundary","cleared-new-work","history-floor"] .map((name,index)=>{
  const snapshot=boundarySnapshot(sessionId);snapshot.session.time.updated=index;
  let live:UIMessage[]=[],expected:string[]=["A"];
  if(name==="empty-error-live-raw")live=[history,{id:"X",role:"assistant",parts:[{type:"text",text:visiblePhrases[2][0]}]},tail];
  if(name==="nonempty-error"||name==="ordinary-assistant"){
   snapshot.messages[1].parts=[{id:"part-X",sessionID:sessionId,messageID:"X",type:"text",text:visiblePhrases[2][0]}];
   if(name==="ordinary-assistant"&&snapshot.messages[1].info.role==="assistant")delete snapshot.messages[1].info.error;
  }
  if(name==="ordinary-user"){snapshot.session.revert={messageID:"B"};expected=["A","session-error:X"];}
  if(name==="live-only-boundary"){snapshot.session.revert={messageID:"C"};live=[liveCursor,tail];expected=["A","session-error:X","B"];}
  if(name==="unavailable-boundary"){snapshot.session.revert={messageID:"unavailable"};live=[history];}
  if(name==="cleared-new-work"||name==="history-floor"){delete snapshot.session.revert;live=[liveCursor];expected=["A","session-error:X","B","C"];}
  return {name,snapshot,live,expected,cursor:snapshot.session.revert?.messageID};
 });
}

/** Full production Surface mounted in the owned native Chromium renderer. */
export async function runNativeSessionRenderBoundary(input:{baseUrl:string;token:string;workspaceId:string;workspaceRoot:string}) {
 const previousInspector=Object.getOwnPropertyDescriptor(window,"__legalwork");
 const previousControl=Object.getOwnPropertyDescriptor(window,"__legalworkControl");
 try {
 // Mount-only imports must not initialize browser stores in the Bun unit runner
 // before the stores' own tests install their browser storage fixtures.
 const [{createRoot},{flushSync},{QueryClientProvider},{MemoryRouter},{createLegalworkServerClient},{useComposerStateStore},{SessionSurface},{LocalProvider},{ShellConfigProvider},{LegalworkControlProvider},{WorkspaceProvider}]=await Promise.all([
  import("react-dom/client"),
  import("react-dom"),
  import("@tanstack/react-query"),
  import("react-router-dom"),
  import("../src/app/lib/legalwork-server"),
  import("../src/react-app/domains/session/surface/composer-state-store"),
  import("../src/react-app/domains/session/surface/session-surface"),
  import("../src/react-app/kernel/local-provider"),
  import("../src/react-app/shell/shell-config"),
  import("../src/react-app/shell/control/control-provider"),
  import("../src/react-app/shell/workspace-provider"),
 ]);
 const client=getReactQueryClient(),sessionId=`synthetic-render-boundary-${crypto.randomUUID()}`;
 const keys=[snapshotKey(input.workspaceId,sessionId),statusKey(input.workspaceId,sessionId),transcriptKey(input.workspaceId,sessionId)];
 const host=document.createElement("div");host.style.cssText="position:fixed;inset:0;z-index:2147483647;background:white";document.body.appendChild(host);
 const root=createRoot(host);
 const props:SessionSurfaceProps={client:createLegalworkServerClient({baseUrl:input.baseUrl,token:input.token}),workspaceId:input.workspaceId,workspaceRoot:input.workspaceRoot,sessionId,opencodeBaseUrl:`${input.baseUrl}/workspace/${input.workspaceId}/opencode`,legalworkToken:input.token,developerMode:false,modelLabel:"Synthetic",onModelClick:()=>{},modelPickerOpen:false,selectedModel:{providerID:"synthetic",modelID:"synthetic"},onModelPickerOpenChange:()=>{},onModelChange:()=>{},onSendDraft:()=>{},onDraftChange:()=>{},attachmentsEnabled:false,attachmentsDisabledReason:null,modelVariantLabel:"Synthetic",modelVariant:null,onModelVariantChange:()=>{},agentLabel:"Synthetic",selectedAgent:null,listAgents:async()=>[],onSelectAgent:()=>{},listCommands:async()=>[],recentFiles:[],searchFiles:async()=>[],isRemoteWorkspace:false,isSandboxWorkspace:false};
 try {
  // Only these owned cached session queries are disabled; no client/module mock.
  for(const key of keys)client.setQueryDefaults(key,{enabled:false,staleTime:Infinity});
  let checks=0;
  for(const scenario of boundaryScenarios(sessionId)){
   client.setQueryData(keys[2],scenario.live);
   client.setQueryData(keys[0],scenario.snapshot);seedSessionState(input.workspaceId,scenario.snapshot);
   flushSync(()=>root.render(<MemoryRouter><QueryClientProvider client={client}><LocalProvider><ShellConfigProvider><LegalworkControlProvider><WorkspaceProvider client={null} selectedWorkspaceRoot={input.workspaceRoot}><SessionSurface {...props}/></WorkspaceProvider></LegalworkControlProvider></ShellConfigProvider></LocalProvider></QueryClientProvider></MemoryRouter>));
   await new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve())));
   const text=host.innerText;
   for(const [phrase,id] of visiblePhrases){
    if(text.includes(phrase)!==scenario.expected.includes(id))throw new Error(`Mounted Surface boundary ${scenario.name}: wrong visibility for ${id}`);
    checks++;
   }
  }
  return {schema:1,actualMountedSurface:true,checks};
 } finally {
  flushSync(()=>root.unmount());host.remove();
  for(const key of keys)client.setQueryDefaults(key,{});
  useComposerStateStore.getState().clearSession(sessionId);
  for(const query of client.getQueryCache().findAll())if(query.queryKey.includes(sessionId))client.removeQueries({queryKey:query.queryKey,exact:true});
  useSessionActivityStore.getState().removeSession(input.workspaceId,sessionId);
 }
 } finally {
  // Separately compiled fixtures own their registries only while mounted.
  // Restore the application's live getters and property semantics, even on failure.
  if(previousInspector)Object.defineProperty(window,"__legalwork",previousInspector);
  else Reflect.deleteProperty(window,"__legalwork");
  if(previousControl)Object.defineProperty(window,"__legalworkControl",previousControl);
  else Reflect.deleteProperty(window,"__legalworkControl");
 }
}

if(typeof document==="undefined"){
 const testModule="bun:test";
 const {test,expect}=await import(/* @vite-ignore */ testModule);
 for(const scenario of boundaryScenarios("synthetic-session"))test(`actual seed and renderer boundary: ${scenario.name}`,()=>{
  const workspaceId="synthetic-render-boundary-unit",snapshot=scenario.snapshot;
  const client=getReactQueryClient(),key=transcriptKey(workspaceId,snapshot.session.id);
  try{
   client.setQueryData(key,scenario.live);
   seedSessionState(workspaceId,snapshot);
   const transcriptState=client.getQueryData<UIMessage[]>(key);
   expect(deriveRenderedSessionMessages({transcriptState,snapshot}).map(message=>message.id)).toEqual(scenario.expected);
   expect(snapshot.session.revert?.messageID).toBe(scenario.cursor);
  }finally{
   for(const query of client.getQueryCache().findAll())if(query.queryKey.includes(workspaceId))client.removeQueries({queryKey:query.queryKey,exact:true});
   useSessionActivityStore.getState().removeSession(workspaceId,snapshot.session.id);
  }
 });
}
