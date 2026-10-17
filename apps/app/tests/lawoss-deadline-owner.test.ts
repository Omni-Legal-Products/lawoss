import { expect,test } from "bun:test";
import { QueryClient,QueryObserver } from "@tanstack/react-query";
import { deadlineQueryOptions,deadlineOwnerKey,createDeadlineOwnerLease,type DeadlineOwner,type DeadlineQueryClient } from "../src/lawoss/domains/lehoty/deadline-queries";

test("real deadline QueryObserver switches server/auth/scope with identical IDs and cancels late old owner",async()=>{
  const cache=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
  const a:DeadlineOwner={baseUrl:"http://server-a",token:"token-a",authGeneration:1,scopeKey:"practice-a",workspaceId:"same-id",matterPath:"same-path"},b={...a,baseUrl:"http://server-b",token:"token-b",authGeneration:2,scopeKey:"practice-b"};
  let finishA:(value:{owner:string})=>void=()=>{};let oldSignal:AbortSignal|undefined;let entered:()=>void=()=>{};const started=new Promise<void>(resolve=>{entered=resolve;});
  const clientA:DeadlineQueryClient={lawossDeadlineRequest:<T>(_workspaceId:string,_suffix:string,_body?:unknown,options?:{signal?:AbortSignal})=>{oldSignal=options?.signal;entered();return new Promise<{owner:string}>(resolve=>{finishA=resolve;}).then(value=>value as T);}};
  const clientB:DeadlineQueryClient={lawossDeadlineRequest:async<T>()=>({owner:"B"} as T)};
  const observer=new QueryObserver(cache,deadlineQueryOptions<{owner:string}>(a,clientA,"",true)),seen:Array<string|undefined>=[];const unsubscribe=observer.subscribe(result=>seen.push(result.data?.owner));
  try{await started;observer.setOptions(deadlineQueryOptions<{owner:string}>(b,clientB,"",true));expect(oldSignal?.aborted).toBe(true);await cache.fetchQuery(deadlineQueryOptions<{owner:string}>(b,clientB,"",true));finishA({owner:"A"});await Promise.resolve();await Promise.resolve();expect(observer.getCurrentResult().data?.owner).toBe("B");expect(seen).not.toContain("A");expect(deadlineOwnerKey(a)).not.toBe(deadlineOwnerKey(b));expect(deadlineOwnerKey(a)).not.toBe(deadlineOwnerKey({...a,scopeKey:"other-practice"}));}
  finally{unsubscribe();observer.destroy();cache.clear();}
});
test("late mutation or excerpt result cannot publish after its captured owner is disposed",async()=>{
  const first=createDeadlineOwnerLease(),second=createDeadlineOwnerLease();let finish:(value:string)=>void=()=>{};const pending=new Promise<string>(resolve=>{finish=resolve;});const seen:string[]=[];
  const old=first.run(()=>pending,value=>seen.push(value));first.dispose();finish("old-preview");await expect(old).rejects.toThrow();await second.run(async()=>"new-preview",value=>seen.push(value));expect(seen).toEqual(["new-preview"]);expect(first.signal.aborted).toBe(true);second.dispose();
});
