import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DeadlineWorkflow } from "./service.js";
import { resolveMatterBinding } from "./repository.js";
import { fixtureInput, fixtureRule, fixtureHolidays, fixtureLedger } from "./fixtures.js";
import type { HostDecisionPort, HostDecisionReceipt } from "../host-decision.js";
import { sha256 } from "./hash.js";
import type { WorkspaceInfo } from "../../types.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "deadline-workflow-")); roots.push(root); mkdirSync(join(root, "case")); writeFileSync(join(root, "case", "matter.md"), "---\ntype: matter\nid: matter\njurisdiction: cz\n---\n"); writeFileSync(join(root, "case", "source.txt"), "Service proof 1 day 2026-10-23 synthetic-recipient");
  const workspace: WorkspaceInfo = { id: "workspace", path: root, name: "Synthetic", preset: "starter", workspaceType: "local" };
  const receipts = new Map<string, HostDecisionReceipt>(); let prompts = 0;
  const host: HostDecisionPort = { readReceipt: async id => receipts.get(id) ?? null, validateReceipt: async (receipt, binding) => receipts.get(receipt.id) === receipt && receipt.bindingHash === binding.bindingHash && receipt.action === binding.action, requestDecision: async request => { prompts++; expect(await request.readCurrentBindingHash()).toBe(request.bindingHash); const receipt: HostDecisionReceipt = { id: `receipt-${prompts}`, approvalRequestId: `approval-${prompts}`, action: request.action, bindingHash: request.bindingHash, actorRef: "native-host", decidedAt: new Date().toISOString(), decision: "allow" }; receipts.set(receipt.id, receipt); return receipt; } };
  // Deliberately test-only authority injection, never an env or production toggle.
  const catalogue = [{ ...fixtureRule(), status: "approved" as const, reviewedBy: ["SYNTHETIC TEST HARNESS"], reviewedAt: "2026-10-17T12:00:00Z" }];
  const options = { host, ledger: fixtureLedger(), rules: catalogue, holidays: [fixtureHolidays()] };
  const service = new DeadlineWorkflow(options);
  const input = fixtureInput(); input.evidence[0]!.relativePath = "case/source.txt"; input.delivery!.evidence.relativePath = "case/source.txt";
  return { root, workspace, service, options, input, prompts: () => prompts, receipts };
}

test("one host-confirmed OKF commit survives export failure and recovers one deterministic local ICS", async () => {
  const f = fixture(), binding = await resolveMatterBinding(f.workspace, "case");
  const saved = await f.service.saveCandidate(binding, f.input, null);
  const again = await f.service.saveCandidate(binding, f.input, null); expect(again.candidateId).toBe(saved.candidateId);
  const preview = await f.service.prepareReview(binding, saved.candidateId, saved.revisionHash); expect(preview.canConfirm).toBe(true);
  mkdirSync(join(binding.matterRoot, "exports")); writeFileSync(join(binding.matterRoot, "exports", "deadlines"), "foreign obstruction");
  const result = await f.service.decide(binding, saved.candidateId, saved.revisionHash, "confirm", "confirm1", undefined, preview.reviewHash);
  expect(result.state).toBe("confirmed"); expect(result.exportState).toBe("export_failed");
  expect(readdirSync(join(binding.matterRoot, "memory")).filter(name => name.endsWith(".md"))).toHaveLength(1);
  const replay = await f.service.decide(binding, saved.candidateId, saved.revisionHash, "confirm", "confirm1", undefined, preview.reviewHash); expect(replay.replay).toBe(true); expect(f.prompts()).toBe(1);
  rmSync(join(binding.matterRoot, "exports", "deadlines"));
  const [recovered] = await f.service.recoverDeadlineExports(binding); expect(recovered?.exportState).toBe("exported");
  const path = join(binding.matterRoot, "exports", "deadlines", `${saved.candidateId}.ics`), bytes = readFileSync(path, "utf8");
  expect(bytes).toContain("DTSTART;VALUE=DATE:20261027"); expect(bytes).toContain("DTEND;VALUE=DATE:20261028"); expect(bytes).not.toContain("ATTENDEE");
  expect(await f.service.recoverDeadlineExports(binding)).toEqual([]); expect(readFileSync(path, "utf8")).toBe(bytes);
  expect((await f.service.list(binding))[0]?.trusted).toBe(true);
  writeFileSync(join(binding.matterRoot, "source.txt"), "Changed bytes");
  expect((await f.service.list(binding))[0]?.trusted).toBe(false);
});

test("source mutation after review cannot use a host receipt; synthetic production catalog never confirms", async () => {
  const f = fixture(), binding = await resolveMatterBinding(f.workspace, "case"), saved = await f.service.saveCandidate(binding, f.input, null);
  const preview = await f.service.prepareReview(binding, saved.candidateId, saved.revisionHash);
  writeFileSync(join(binding.matterRoot, "source.txt"), "Changed bytes");
  await expect(f.service.decide(binding, saved.candidateId, saved.revisionHash, "confirm", "stale1", undefined, preview.reviewHash)).rejects.toThrow();
  expect(f.prompts()).toBe(0);
  const production = new DeadlineWorkflow({ ledger: fixtureLedger(), host: { readReceipt: async () => null, validateReceipt: async () => false, requestDecision: async () => { throw new Error("Must not prompt"); } } });
  writeFileSync(join(binding.matterRoot, "source.txt"), "Service proof 1 day 2026-10-23 synthetic-recipient");
  const input = { ...f.input, ruleId: "cz-civil-appeal", ruleVersion: "2026-proposed", ruleEffectiveOn: "2026-10-23" };
  const unreviewed = await production.saveCandidate(binding, input, null);
  expect((await production.prepareReview(binding, unreviewed.candidateId, unreviewed.revisionHash)).canConfirm).toBe(false);
});

test("re-reading identical evidence changes neither legal revision nor candidate identity", async () => {
  const f = fixture(), binding = await resolveMatterBinding(f.workspace, "case"), first = await f.service.saveCandidate(binding, f.input, null);
  const reread = structuredClone(f.input); reread.evidence[0]!.retrievedAt = "2026-10-18T12:00:00Z"; reread.delivery!.evidence.retrievedAt = "2026-10-18T12:00:00Z";
  const repeated = await f.service.saveCandidate(binding, reread, null); expect(repeated.candidateId).toBe(first.candidateId); expect(repeated.revisionHash).toBe(first.revisionHash);
});

test("two concurrent native confirms commit once; a revoked deadline emits cancellation under the same UID", async () => {
  const f = fixture(), binding = await resolveMatterBinding(f.workspace, "case"), saved = await f.service.saveCandidate(binding, f.input, null), preview = await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  const results = await Promise.allSettled([f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","concurrent1",undefined,preview.reviewHash),f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","concurrent2",undefined,preview.reviewHash)]);
  expect(results.filter(result=>result.status === "fulfilled")).toHaveLength(1);
  const path = join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`), before = readFileSync(path,"utf8"), latest = await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  const revoked = await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","revoke1",undefined,latest.reviewHash,"Synthetic withdrawal"); expect(revoked.state).toBe("revoked"); expect(revoked.exportState).toBe("exported");
  const after = readFileSync(path,"utf8"); expect(after).toContain("STATUS:CANCELLED"); expect(after).toContain("SEQUENCE:1"); expect(after.match(/UID:[^\r\n]+/)?.[0]).toBe(before.match(/UID:[^\r\n]+/)?.[0]); expect((await f.service.list(binding))[0]?.trusted).toBe(false);
});

test("stale confirmed source keeps review visible and permits explicit native revocation", async () => {
  const f=fixture(), binding=await resolveMatterBinding(f.workspace,"case"), saved=await f.service.saveCandidate(binding,f.input,null), preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","stale-confirm",undefined,preview.reviewHash);
  writeFileSync(join(binding.matterRoot,"source.txt"),"Changed bytes");
  const stale=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash); expect(stale.canConfirm).toBe(false); expect(stale.warnings.join(" ")).toContain("changed");
  const revoked=await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","stale-revoke",undefined,stale.reviewHash,"Source changed; withdraw active confirmation"); expect(revoked.state).toBe("revoked"); expect(revoked.exportState).toBe("exported");
});

test("restoring pre-revocation OKF bytes cannot reactivate a consumed old host receipt", async () => {
  const f=fixture(), binding=await resolveMatterBinding(f.workspace,"case"), saved=await f.service.saveCandidate(binding,f.input,null), preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","ledger-confirm",undefined,preview.reviewHash);
  const file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`), snapshot=readFileSync(file,"utf8"), confirmed=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","ledger-revoke",undefined,confirmed.reviewHash,"Withdraw");
  writeFileSync(file,snapshot);
  expect((await f.service.list(binding))[0]?.trusted).toBe(false);
});

test("foreign ICS and shared OKF lock are preserved; explicit crash after ICS rename recovers bytes", async () => {
  const f=fixture(), binding=await resolveMatterBinding(f.workspace,"case"), saved=await f.service.saveCandidate(binding,f.input,null), preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  mkdirSync(join(binding.matterRoot,".okf-write.lock"));
  await expect(f.service.saveCandidate(binding,{...f.input,statedDuration:2},saved.recordHash)).rejects.toThrow("zamknutá");
  rmSync(join(binding.matterRoot,".okf-write.lock"),{recursive:true});
  mkdirSync(join(binding.matterRoot,"exports","deadlines"),{recursive:true}); const path=join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`); writeFileSync(path,"FOREIGN");
  const result=await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","foreign-confirm",undefined,preview.reviewHash); expect(result.exportState).toBe("export_failed"); expect(readFileSync(path,"utf8")).toBe("FOREIGN");
  rmSync(path); let injected=false;
  const crashing=new DeadlineWorkflow({...f.options,fault:point=>{if(point==="ics_renamed"&&!injected){injected=true;throw new Error("Explicit synthetic crash");}}});
  const failed=await crashing.exportDeadlineIcs(binding,saved.candidateId,saved.revisionHash); expect(failed.exportState).toBe("export_failed"); const bytes=readFileSync(path,"utf8");
  expect((await f.service.recoverDeadlineExports(binding))[0]?.exportState).toBe("exported"); expect(readFileSync(path,"utf8")).toBe(bytes);
});

test("external edit during OKF staging is never rolled back or overwritten", async () => {
  const f=fixture(), binding=await resolveMatterBinding(f.workspace,"case"), saved=await f.service.saveCandidate(binding,f.input,null), file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`);
  const external=readFileSync(file,"utf8")+"\n## External note\nKEEP MY EDIT\n";
  const editing=new DeadlineWorkflow({...f.options,fault:point=>{if(point==="okf_staged")writeFileSync(file,external);}});
  await expect(editing.saveCandidate(binding,{...f.input,statedDuration:2},saved.recordHash)).rejects.toThrow("External edit"); expect(readFileSync(file,"utf8")).toBe(external);
});

test("restoring old card and record after native withdrawal under a changed card cannot restore authority",async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","card-confirm",undefined,preview.reviewHash);
  const file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`),card=join(binding.matterRoot,"matter.md"),oldCard=readFileSync(card,"utf8"),oldRecord=readFileSync(file,"utf8");
  writeFileSync(card,oldCard+"\nChanged card metadata\n");const changed=await resolveMatterBinding(f.workspace,"case"),review=await f.service.prepareReview(changed,saved.candidateId,saved.revisionHash);
  await f.service.decide(changed,saved.candidateId,saved.revisionHash,"revoke","card-revoke",undefined,review.reviewHash,"Withdraw after metadata change");
  writeFileSync(card,oldCard);writeFileSync(file,oldRecord);expect((await f.service.list(binding))[0]?.trusted).toBe(false);
});

test("native denial never commits active state or ICS",async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  const deniedHost:HostDecisionPort={...f.options.host,requestDecision:async request=>{const receipt:HostDecisionReceipt={id:"denied",approvalRequestId:"denied",action:request.action,bindingHash:request.bindingHash,actorRef:"native-host",decidedAt:new Date().toISOString(),decision:"deny"};f.receipts.set(receipt.id,receipt);return receipt;}};
  await expect(new DeadlineWorkflow({...f.options,host:deniedHost}).decide(binding,saved.candidateId,saved.revisionHash,"confirm","denied-operation",undefined,preview.reviewHash)).rejects.toThrow("native host decision");
  expect((await f.service.list(binding))[0]?.state).toBe("candidate");expect(readdirSync(binding.matterRoot)).not.toContain("exports");
});
