import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { ApprovalService } from "../../approvals.js";
import { createHostDecisionPort } from "../host-decision.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { createDeadlineReceiptLedger } from "./ledger.js";
import { DeadlineWorkflow } from "./service.js";
import { fixtureHolidays, fixtureInput, fixtureRule } from "./fixtures.js";
import { resolveMatterBinding } from "./repository.js";

test("actual durable host receipt + consumption survive service restart and reject a copied matter", async () => {
  const {root,config}=await syntheticHostConfig(); let prompts=0;
  const approvals=new ApprovalService({mode:"auto",timeoutMs:1000},async()=>{prompts++;return "allow";});
  try {
    const workspace={id:"synthetic-matter",name:"Synthetic",path:join(root,"workspace"),preset:"starter",workspaceType:"local" as const}; await mkdir(join(workspace.path,"case"),{recursive:true});
    await writeFile(join(workspace.path,"case","matter.md"),"---\ntype: matter\nid: matter\njurisdiction: cz\n---\n"); await writeFile(join(workspace.path,"case","source.txt"),"Service proof 1 day 2026-10-23 synthetic-recipient");
    const input=fixtureInput();input.evidence[0]!.relativePath="case/source.txt";input.delivery!.evidence.relativePath="case/source.txt";
    const rules=[{...fixtureRule(),status:"approved" as const,reviewedBy:["SYNTHETIC TEST HARNESS"],reviewedAt:new Date().toISOString()}], host=createHostDecisionPort(approvals,config),ledger=createDeadlineReceiptLedger(config);
    const service=new DeadlineWorkflow({host,ledger,rules,holidays:[fixtureHolidays()],fault:point=>{if(point==="after_okf_commit")throw new Error("Explicit synthetic crash after canonical commit");}});
    const binding=await resolveMatterBinding(workspace,"case"), saved=await service.saveCandidate(binding,input,null), preview=await service.prepareReview(binding,saved.candidateId,saved.revisionHash);
    expect((await service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","durable-confirm",undefined,preview.reviewHash)).exportState).toBe("export_pending");
    const restarted=new DeadlineWorkflow({host:createHostDecisionPort(approvals,config),ledger:createDeadlineReceiptLedger(config),rules,holidays:[fixtureHolidays()]});
    expect((await restarted.recoverDeadlineExports(binding))[0]?.exportState).toBe("exported");expect(prompts).toBe(1);expect((await restarted.list(binding))[0]?.trusted).toBe(true);
    const bytes=await readFile(join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),"utf8");expect(bytes).toContain("DTSTART;VALUE=DATE:20261027");
    await cp(binding.matterRoot,join(workspace.path,"copied"),{recursive:true}); const copyBinding=await resolveMatterBinding(workspace,"copied"); expect((await restarted.list(copyBinding))[0]?.trusted).toBe(false);
  } finally { approvals.dispose(); await rm(root,{recursive:true,force:true}); }
});

test("receipt consumption uses atomic create-only CAS, not mutable Markdown history", async () => {
  const {root,config}=await syntheticHostConfig();
  try { const ledger=createDeadlineReceiptLedger(config); const row={receiptId:"first",operationId:"first",bindingHash:"binding",action:"deadline.confirm" as const};const results=await Promise.all([ledger.run(store=>store.advance("scope",null,row)),ledger.run(store=>store.advance("scope",null,{...row,receiptId:"second",operationId:"second"}))]);expect(results.filter(Boolean)).toHaveLength(1); expect(await createDeadlineReceiptLedger(config).run(store=>store.current("scope"))).not.toBeNull(); }
  finally { await rm(root,{recursive:true,force:true}); }
});

test("separate stale process cannot roll native projection authority back after another writer advances",async()=>{
  const {spawn}=await import("node:child_process"),{runtimeDbPath}=await import("../../runtime-db-lifecycle.js"),{sha256}=await import("./hash.js");
  const {root,config}=await syntheticHostConfig();
  const first={receiptId:"first-projection",operationId:"first-projection",bindingHash:"first-binding",action:"deadline.confirm" as const,projection:{uid:"owned@legalwork.local",sequence:0,decidedAt:new Date().toISOString(),sha256:sha256("first"),cancelled:false,ownedHashes:[sha256("first")]}};
  const second={receiptId:"second-projection",operationId:"second-projection",bindingHash:"second-binding",action:"deadline.revoke" as const,projection:{...first.projection,sequence:1,sha256:sha256("second"),cancelled:true,ownedHashes:[sha256("first"),sha256("second")]}};
  const ledger=createDeadlineReceiptLedger(config);let child:ReturnType<typeof spawn>|undefined;let closed:Promise<number|null>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;
  try{
    expect(await ledger.run(store=>store.advance("cross-process",null,first))).toBe(true);
    const childFile=join(root,"ledger-child.test.ts"),ledgerUrl=new URL("./ledger.ts",import.meta.url).href;
    await writeFile(childFile,`import {test} from "bun:test";\nimport {createDeadlineReceiptLedger} from ${JSON.stringify(ledgerUrl)};\ntest("isolated stale projection writer",async()=>{process.env.LEGALWORK_RUNTIME_DB=${JSON.stringify(runtimeDbPath(config))};const ledger=createDeadlineReceiptLedger(${JSON.stringify(config)});const stale=await ledger.run(store=>store.current("cross-process"));if(!stale)throw new Error("Missing stale capture");process.stdout.write("DEADLINE_LEDGER_READY\\n");await new Promise(resolve=>process.stdin.once("data",resolve));const changed=await ledger.run(store=>store.advance("cross-process",stale.receiptId,{...stale,receiptId:"stale-child",operationId:"stale-child"}));const current=await ledger.run(store=>store.current("cross-process"));process.stdout.write(JSON.stringify({changed,sequence:current?.projection?.sequence})+"\\n");});\n`);
    const preloads=["test-preload.ts","test-preload-lawoss.ts"].flatMap(name=>["--preload",fileURLToPath(new URL(`../../../${name}`,import.meta.url))]);
    child=spawn(process.execPath,["test",...preloads,childFile],{cwd:process.cwd(),env:process.env,stdio:["pipe","pipe","pipe"]});
    let stdout="",stderr="",ready:()=>void=()=>{};const entered=new Promise<void>(resolve=>{ready=resolve;});child.stdout?.on("data",bytes=>{stdout+=String(bytes);if(stdout.includes("DEADLINE_LEDGER_READY"))ready();});child.stderr?.on("data",bytes=>{stderr+=String(bytes);});
    closed=new Promise((resolve,reject)=>{child!.once("close",code=>resolve(code));child!.once("error",reject);});
    const budget=new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("Owned ledger child rendezvous timed out")),10000);});
    await Promise.race([entered,closed.then(()=>{throw new Error(`Ledger child exited before capture: ${stderr}`);}),budget]);
    expect(await ledger.run(store=>store.advance("cross-process",first.receiptId,second))).toBe(true);
    child.stdin?.end("continue\n");expect(await Promise.race([closed,budget])).toBe(0);expect(stdout).toContain('"changed":false');expect(stdout).toContain('"sequence":1');
    const current=await createDeadlineReceiptLedger(config).run(store=>store.current("cross-process"));expect(current?.receiptId).toBe(second.receiptId);expect(current?.projection?.ownedHashes).toEqual(second.projection.ownedHashes);expect(current?.projection).not.toHaveProperty("bytes");
  }finally{if(timer)clearTimeout(timer);if(child?.exitCode===null)child.kill();await closed?.catch(()=>{});await rm(root,{recursive:true,force:true});}
},20000);

test("old receipt table upgrades without inventing any projection ownership",async()=>{
  const {runtimeDbPath}=await import("../../runtime-db-lifecycle.js"),{openSqlite}=await import("../../runtime-db.js");const {root,config}=await syntheticHostConfig();
  try{
    const db=await openSqlite(runtimeDbPath(config));try{db.exec("CREATE TABLE deadline_receipt_uses (scope_key TEXT PRIMARY KEY,receipt_id TEXT NOT NULL,operation_id TEXT NOT NULL,binding_hash TEXT NOT NULL,action TEXT NOT NULL)");db.run("INSERT INTO deadline_receipt_uses VALUES (?,?,?,?,?)",["legacy","old-receipt","old-op","old-binding","deadline.confirm"]);}finally{db.close();}
    const old=await createDeadlineReceiptLedger(config).run(store=>store.current("legacy"));expect(old?.receiptId).toBe("old-receipt");expect(old?.projection).toBeNull();
  }finally{await rm(root,{recursive:true,force:true});}
});
