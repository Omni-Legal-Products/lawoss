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

 test("INDEPENDENT: confirmed revoked replacement must retain trusted confirmation and export lifetime",async()=>{
 const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
 await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","first-confirm",undefined,preview.reviewHash);
 const confirmed=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
 await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","first-revoke",undefined,confirmed.reviewHash,"Withdraw");
 const current=(await f.service.list(binding))[0]!;
 const revised=await f.service.saveCandidate(binding,f.input,current.recordHash,{candidateId:saved.candidateId,supersedesRevisionHash:saved.revisionHash});
 const review=await f.service.prepareReview(binding,saved.candidateId,revised.revisionHash);
 const result=await f.service.decide(binding,saved.candidateId,revised.revisionHash,"confirm","second-confirm",undefined,review.reviewHash);
 const after=(await f.service.list(binding))[0]!;

 expect(after.trusted).toBe(true);expect(result.exportState).toBe("exported");expect(after.export?.sequence).toBe(2);
 });

 test("INDEPENDENT: editing unsigned export history must not authorize foreign-file overwrite",async()=>{
 const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
 await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","foreign-first-confirm",undefined,preview.reviewHash);
 const file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`),ics=join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),foreign="FOREIGN ICS USER CONTENT";
 writeFileSync(ics,foreign);
 const forged=readFileSync(file,"utf8").replace('"state":"exported"','"state":"export_pending"').replace('"previousHashes":[]',`"previousHashes":["${sha256(foreign)}"]`);
 writeFileSync(file,forged);
 const before=(await f.service.list(binding))[0]!;expect(before.trusted).toBe(true);
 const result=await f.service.exportDeadlineIcs(binding,saved.candidateId,saved.revisionHash);
 expect(result.exportState).toBe("export_failed");
 expect(readFileSync(ics,"utf8")).toBe(foreign);
 });

for (const changed of [false,true]) test(`native reapproval preserves lifetime ownership for ${changed ? "changed" : "identical"} legal input`,async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","lifetime-confirm",undefined,preview.reviewHash);
  const first=(await f.service.list(binding))[0]!,firstBytes=readFileSync(join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),"utf8");
  const reviewed=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","lifetime-revoke",undefined,reviewed.reviewHash,"Synthetic withdrawal");
  const revoked=(await f.service.list(binding))[0]!,input=structuredClone(f.input);if(changed)input.delivery!.method="Corrected service-method fact";
  const replacement=await f.service.saveCandidate(binding,input,revoked.recordHash,{candidateId:saved.candidateId,supersedesRevisionHash:saved.revisionHash});
  expect(replacement.exportState).toBe("not_requested");expect((await f.service.list(binding))[0]?.trusted).toBe(false);expect(await f.service.recoverDeadlineExports(binding)).toEqual([]);
  const next=await f.service.prepareReview(binding,saved.candidateId,replacement.revisionHash);
  await f.service.decide(binding,saved.candidateId,replacement.revisionHash,"confirm","lifetime-reconfirm",undefined,next.reviewHash);
  const after=(await f.service.list(binding))[0]!;expect(after.trusted).toBe(true);expect(after.export?.sequence).toBe(2);expect(after.export?.previousHashes).toEqual([first.export!.sha256,revoked.export!.sha256]);
  expect(after.export?.uid).toBe(first.export?.uid);expect(replacement.revisionHash===saved.revisionHash).toBe(!changed);
  const bytes=readFileSync(join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),"utf8");expect(bytes).toContain("SEQUENCE:2");expect(bytes.match(/UID:[^\r\n]+/)?.[0]).toBe(firstBytes.match(/UID:[^\r\n]+/)?.[0]);
  const retry=await f.service.exportDeadlineIcs(binding,saved.candidateId,replacement.revisionHash);expect(retry.replay).toBe(true);expect(f.prompts()).toBe(3);expect(readFileSync(join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),"utf8")).toBe(bytes);
});

for(const state of ["export_pending","exported"] as const)test(`forged ${state} hash/sequence metadata never grants ownership or claims a foreign file`,async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","metadata-confirm",undefined,preview.reviewHash);
  const file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`),ics=join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),foreign="FOREIGN USER BYTES",original=readFileSync(file,"utf8"),marker="## LAWOSS deadline workflow v1\n",at=original.indexOf(marker)+marker.length;
  const payload=JSON.parse(original.slice(at));payload.export={...payload.export,state,sequence:999,sha256:sha256(foreign),previousHashes:[sha256(foreign)],decidedAt:"2000-01-01T00:00:00Z"};
  writeFileSync(file,original.slice(0,at)+JSON.stringify(payload)+"\n");writeFileSync(ics,foreign);
  const listed=(await f.service.list(binding))[0]!;expect(listed.trusted).toBe(true);expect(listed.exportState).toBe("export_failed");expect(listed.export?.sequence).toBe(0);
  expect((await f.service.exportDeadlineIcs(binding,saved.candidateId,saved.revisionHash)).exportState).toBe("export_failed");expect(readFileSync(ics,"utf8")).toBe(foreign);expect(f.prompts()).toBe(1);
  expect((await f.service.recoverDeadlineExports(binding))[0]?.exportState).toBe("export_failed");expect(readFileSync(ics,"utf8")).toBe(foreign);
});

for(const point of ["okf_staged","okf_renamed","after_okf_commit","ics_renamed"])test(`replacement projection survives explicit ${point} fault without sequence reuse`,async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","crash-confirm",undefined,preview.reviewHash);
  const review=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);await f.service.decide(binding,saved.candidateId,saved.revisionHash,"revoke","crash-revoke",undefined,review.reviewHash,"Synthetic withdrawal");
  const current=(await f.service.list(binding))[0]!,input=structuredClone(f.input);input.delivery!.method="Changed method";
  const replacement=await f.service.saveCandidate(binding,input,current.recordHash,{candidateId:saved.candidateId,supersedesRevisionHash:saved.revisionHash}),next=await f.service.prepareReview(binding,saved.candidateId,replacement.revisionHash);
  let injected=false;const faulty=new DeadlineWorkflow({...f.options,fault:stage=>{if(stage===point&&!injected){injected=true;throw new Error("Synthetic stage crash");}}});
  try{await faulty.decide(binding,saved.candidateId,replacement.revisionHash,"confirm","crash-reconfirm",undefined,next.reviewHash);}catch(error){expect(String(error)).toContain("Synthetic stage crash");}
  expect(injected).toBe(true);
  const latest=(await f.service.list(binding))[0]!;
  if(latest.state==="candidate")await f.service.decide(binding,saved.candidateId,replacement.revisionHash,"confirm","crash-reconfirm",undefined,next.reviewHash);else await f.service.recoverDeadlineExports(binding);
  const recovered=(await f.service.list(binding))[0]!;expect(recovered.trusted).toBe(true);expect(recovered.export?.sequence).toBe(2);expect(recovered.exportState).toBe("exported");
  const bytes=readFileSync(join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),"utf8");expect(bytes).toContain("SEQUENCE:2");expect(await f.service.recoverDeadlineExports(binding)).toEqual([]);
});

test("export rechecks current host projection under writer lock after asynchronous admission",async()=>{
  const f=fixture(),binding=await resolveMatterBinding(f.workspace,"case"),saved=await f.service.saveCandidate(binding,f.input,null),preview=await f.service.prepareReview(binding,saved.candidateId,saved.revisionHash);
  await f.service.decide(binding,saved.candidateId,saved.revisionHash,"confirm","admission-confirm",undefined,preview.reviewHash);
  const file=join(binding.matterRoot,"memory",`${saved.candidateId}.md`),ics=join(binding.matterRoot,"exports","deadlines",`${saved.candidateId}.ics`),before=readFileSync(file,"utf8"),bytes=readFileSync(ics,"utf8");
  let calls=0,key="";
  const ledger:import("./ledger.js").DeadlineReceiptLedger={async run(action){calls++;return f.options.ledger.run(store=>{
    if(calls===3){const current=store.current(key)!;store.advance(key,current.receiptId,{...current,receiptId:"newer-native-reservation",operationId:"newer-native-reservation",bindingHash:"newer-binding",projection:{...current.projection!,sequence:current.projection!.sequence+1,sha256:sha256("newer projection"),ownedHashes:[...current.projection!.ownedHashes,sha256("newer projection")]}});}
    return action({...store,current:at=>{key=at;return store.current(at);}});
  });}};
  await expect(new DeadlineWorkflow({...f.options,ledger}).exportDeadlineIcs(binding,saved.candidateId,saved.revisionHash)).rejects.toThrow("authority changed");expect(calls).toBe(3);expect(readFileSync(file,"utf8")).toBe(before);expect(readFileSync(ics,"utf8")).toBe(bytes);
});
