import { rm } from "node:fs/promises";
import { syntheticHostConfig } from "./test-support/host-config.js";
import { afterEach, expect, test } from "bun:test";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { registerOperationRoutes } from "../routes/operations.js";
import { matchRoute, type Route } from "../routes/registry.js";
import type { Actor, ServerConfig } from "../types.js";
import { createHostDecisionPort } from "./host-decision.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, {recursive: true}); });
async function fixture() { const f = await syntheticHostConfig(); roots.push(f.root); return f.config; }

// Exercise the original production answer handler. Server authentication tests separately
// prove that only the host-token path constructs a host actor (owner bearer is remote).
test("original approval route rejects owner bearer authority and always for native-only decisions", async () => {
  const config = await fixture();
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 });
  const routes: Route[] = [];
  registerOperationRoutes({ routes, config: {} as ServerConfig,
    jsonResponse: (data, status = 200) => Response.json(data, {status}),
    readJsonBody: request => request.json(), requireClientScope: () => {},
    resolveWorkspace: async () => {throw new Error("not used");}, reloadOpencodeEngine: async () => {} });
  const decision = createHostDecisionPort(approvals, config).requestDecision({ workspaceId: "fixture", action: "deadline.confirm",
    operationId: "synthetic", bindingHash: "current", summary: "Review synthetic metadata", readCurrentBindingHash: async () => "current" });
  const id = approvals.list()[0].id;
  const route = matchRoute(routes, "POST", `/approvals/${id}`);
  if (!route) throw new Error("Original approvals route missing");
  const answer = async (actor: Actor, reply: string) => {
    const request = new Request(`http://fixture/approvals/${id}`, { method: "POST", body: JSON.stringify({reply}) });
    // This route reads only request, params, actor and the real ApprovalService.
    return route.handler({request, url: new URL(request.url), params: route.params, approvals, actor} as Parameters<typeof route.handler>[0]);
  };
  try {
    await expect(answer({type: "remote", scope: "owner"}, "allow")).rejects.toMatchObject({status: 403, code: "native_host_required"});
    await expect(answer({type: "host", scope: "owner"}, "always")).rejects.toMatchObject({status: 400, code: "native_decision_not_rememberable"});
    expect(approvals.list()).toHaveLength(1);
    expect((await answer({type: "host", scope: "owner"}, "allow")).status).toBe(200);
    expect(await decision).toMatchObject({approvalRequestId: id, decision: "allow", actorRef: "native-host"});
    await expect(answer({type: "host", scope: "owner"}, "allow")).rejects.toBeInstanceOf(ApiError);
  } finally { approvals.dispose(); }
});

test("timeout and late native answers cannot mint a receipt", async () => {
  const config = await fixture();
  let finish!: (answer: "allow") => void;
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 5}, async () => new Promise(resolve => {finish = resolve;}));
  const decision = createHostDecisionPort(approvals, config).requestDecision({workspaceId: "fixture", action: "deadline.confirm",
    operationId: "late", bindingHash: "current", summary: "Synthetic", readCurrentBindingHash: async () => "current"});
  const id = approvals.list()[0].id;
  await expect(decision).rejects.toMatchObject({code: "host_decision_unavailable"});
  finish("allow");
  await Promise.resolve();
  expect(approvals.respondNative(id, "allow")).toBeNull();
  approvals.dispose();
});
