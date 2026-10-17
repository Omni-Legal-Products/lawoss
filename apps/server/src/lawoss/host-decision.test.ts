import { initializeSqlite } from "../runtime-db.js";
import { runtimeDbPath } from "../runtime-db-lifecycle.js";
import { rm } from "node:fs/promises";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { afterEach, describe, expect, test } from "bun:test";
import { ApprovalService } from "../approvals.js";
import { createHostDecisionPort } from "./host-decision.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true}); });
async function fixture() { const f = await syntheticHostConfig(); roots.push(f.root); return f.config; }

const input = { workspaceId: "synthetic-matter", action: "deadline.confirm", operationId: "operation-1",
  bindingHash: "revision-1", summary: "Confirm synthetic candidate", readCurrentBindingHash: async () => "revision-1" };

describe("native host decisions", () => {
  test("auto mode and generic respond never decide a native-only request; host issues the receipt", async () => {
    const config = await fixture();
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 });
    try {
      const decision = createHostDecisionPort(approvals, config).requestDecision(input);
      const pending = approvals.list()[0];
      expect(pending).toMatchObject({ nativeOnly: true, canRemember: false, action: input.action });
      expect(approvals.respond(pending.id, "allow")).toBeNull();
      expect(approvals.respond(pending.id, "always")).toBeNull();
      expect(approvals.respondNative(pending.id, "always")).toBeNull();
      expect(approvals.list()).toHaveLength(1);
      approvals.respondNative(pending.id, "allow");
      const receipt = await decision;
      expect(receipt).toMatchObject({ approvalRequestId: pending.id, action: input.action, bindingHash: input.bindingHash,
        actorRef: "native-host", decision: "allow" });
      expect(new Date(receipt.decidedAt).toISOString()).toBe(receipt.decidedAt);
      expect(approvals.respondNative(pending.id, "allow")).toBeNull();
    } finally { approvals.dispose(); }
  });

  test("native dialog allow rechecks binding after response and refuses stale approval", async () => {
    const config = await fixture();
    let current = "revision-1";
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => {
      current = "revision-2";
      return "allow";
    });
    await expect(createHostDecisionPort(approvals, config).requestDecision({ ...input, readCurrentBindingHash: async () => current }))
      .rejects.toMatchObject({ status: 409, code: "host_decision_stale" });
    approvals.dispose();
  });

  test("explicit native denial has a receipt; cancellation does not mint one", async () => {
    const config = await fixture();
    const denied = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => "deny");
    expect(await createHostDecisionPort(denied, config).requestDecision(input)).toMatchObject({ decision: "deny" });
    denied.dispose();
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 });
    const controller = new AbortController();
    const decision = createHostDecisionPort(approvals, config).requestDecision(input, controller.signal);
    controller.abort();
    await expect(decision).rejects.toMatchObject({ code: "host_decision_unavailable" });
    expect(approvals.list()).toHaveLength(0);
    approvals.dispose();
  });
});

test("issued receipts survive a new port and reject copied, forged, cross-operation and cross-host metadata", async () => {
  const config = await fixture();
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 1000}, async () => "allow");
  const port = createHostDecisionPort(approvals, config);
  const receipt = await port.requestDecision(input);
  const restarted = createHostDecisionPort(new ApprovalService({mode: "auto", timeoutMs: 1000}), config);
  const binding = {workspaceId: input.workspaceId, action: input.action, operationId: input.operationId, bindingHash: input.bindingHash};
  expect(await restarted.readReceipt(receipt.id)).toEqual(receipt);
  expect(await restarted.validateReceipt({...receipt}, binding)).toBe(true);
  expect(await restarted.validateReceipt({...receipt, actorRef: "forged"}, binding)).toBe(false);
  expect(await restarted.validateReceipt(receipt, {...binding, operationId: "different"})).toBe(false);
  const otherHost = createHostDecisionPort(approvals, await fixture());
  expect(await otherHost.validateReceipt(receipt, binding)).toBe(false);
  approvals.dispose();
});

test("cancellation during current-binding validation cannot issue or persist an allow receipt", async () => {
  const config = await fixture();
  let entered!: () => void, release!: (hash: string) => void;
  const started = new Promise<void>(resolve => {entered = resolve;});
  const binding = new Promise<string>(resolve => {release = resolve;});
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 1000}, async () => "allow");
  const controller = new AbortController();
  const decision = createHostDecisionPort(approvals, config).requestDecision({...input, readCurrentBindingHash: async () => {entered(); return binding;}}, controller.signal);
  await started; controller.abort(); release(input.bindingHash);
  await expect(decision).rejects.toMatchObject({code: "host_decision_unavailable"});
  const db = await initializeSqlite(runtimeDbPath(config), db => db);
  try {
    const table = db.get("SELECT name FROM sqlite_master WHERE type='table' AND name='host_decision_receipts'");
    expect(table ? db.get("SELECT COUNT(*) AS count FROM host_decision_receipts")?.count : 0).toBe(0);
  } finally {db.close();}
  approvals.dispose();
});
