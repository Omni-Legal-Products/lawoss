import { expect, test } from "bun:test";
import { mkdir, readFile, rm, writeFile, cp } from "node:fs/promises";
import { join } from "node:path";
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
