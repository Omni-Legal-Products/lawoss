import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { ApprovalService } from "../../approvals.js";
import { brokerRequest, prepareOutboundRequest } from "../../agent-sandbox/network.js";
import { closeOrgPolicyRuntime, scheduleOrgPolicySync } from "../../org-policy.js";
import { writeEigenweltConnection } from "../../eigenwelt-connection-store.js";
import { GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { compareAndSetGovernanceProfile } from "../ai-governance-store.js";
import { evaluateTransfer } from "../ai-governance.js";
import { ProtectedAiTransport, protectedAiTarget } from "./transport.js";

const scope = {workspaceId: "fixture", matterId: "matter", jurisdictions: ["CZ" as const]};
const body = JSON.stringify({model: "fixture", messages: [{role: "user", content: "PROTECTED-SYNTHETIC-CANARY"}],
  tools: [{type: "function", function: {name: "lawoss_documents_read", parameters: {type: "object", properties: {}}}}]});
const outbound = (text = body) => prepareOutboundRequest({url: "http://protected-lawoss.invalid/model/chat/completions", method: "POST", headers: {"content-type": "application/json", authorization: "Bearer GUEST-FAKE"}, bodyBase64: Buffer.from(text).toString("base64")});

async function fixture(run: (input: Awaited<ReturnType<typeof makeFixture>>) => Promise<void>) {
  const input = await makeFixture();
  try {await run(input);} finally {input.approvals.dispose(); input.receiver.stop(true); await closeOrgPolicyRuntime(input.config); await rm(input.root, {recursive: true});}
}
async function makeFixture() {
  const {root, config} = await syntheticHostConfig();
  const received: Array<{body: string; authorization: string | null}> = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {received.push({body: await request.text(), authorization: request.headers.get("authorization")}); return response ? response() : Response.json({choices: [{message: {role: "assistant", content: "PROTECTED_OK"}}]});}});
  const endpoint = receiver.url.origin + "/v1/chat/completions";
  await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: receiver.url.origin + "/v1", apiKey: "HOST-SECRET"}, models: {fixture: {}}}}}));
  let binding = "a".repeat(64), allow = true;
  let response: (() => Promise<Response> | Response) | undefined;
  const reviewed: string[] = [];
  let onReview = async () => {};
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 1000}, async request => {reviewed.push(request.description ?? ""); await onReview(); return allow ? "allow" : "deny";});
  const options = {config, approvals, scope, providerId: "fixture", modelId: "fixture", readCurrentBinding: async () => ({engineSha256: binding, runtimeManifestSha256: binding, pluginSha256: binding, configSha256: binding, launcherSha256: binding, sourceSetSha256: binding, rootIdentity: "owned-root", operationId: "owned-operation"})};
  return {root, config, received, receiver, approvals, reviewed, endpoint, options,
    mutate: () => {binding = "b".repeat(64);}, deny: () => {allow = false;}, review: (value: () => Promise<void>) => {onReview = value;}, respond: (value: () => Promise<Response> | Response) => {response = value;}};
}

test("native synthetic final-wire approval sends exact bytes with host credentials and never creates a legal grant", async () => fixture(async f => {
  const transport = new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}});
  const response = await transport.dispatch(outbound(), AbortSignal.timeout(3000));
  expect(response.status).toBe(200); expect(Buffer.from(response.bodyBase64, "base64").toString()).toContain("PROTECTED_OK");
  expect(f.received).toEqual([{body, authorization: "Bearer HOST-SECRET"}]);
  expect(f.reviewed).toHaveLength(1); expect(f.reviewed[0]).toContain(body); expect(f.reviewed[0]).not.toContain("HOST-SECRET");
  const target = await protectedAiTarget(f.config, "fixture", "fixture");
  expect(await evaluateTransfer(f.config, {scope, operationId: "another", kind: "chat", targetFingerprint: target.fingerprint, dataClasses: ["protected"], purpose: "fixture"})).toEqual({allowed: false, reason: "profile-missing"});
}));

test("native denial, stale measured bytes and foreign tool/endpoint produce zero receiver calls", async () => fixture(async f => {
  const transport = () => new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}});
  f.review(async () => f.mutate());
  await expect(transport().dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "host_decision_stale"});
  f.review(async () => {}); f.deny();
  await expect(transport().dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_denied"});
  await expect(transport().dispatch(outbound(body.replace("lawoss_documents_read", "bash")), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_envelope_invalid"});
  const foreign = prepareOutboundRequest({url: f.endpoint, method: "POST", headers: {}, bodyBase64: Buffer.from(body).toString("base64")}, {allowPrivate: true});
  await expect(transport().dispatch(foreign, AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_destination_invalid"});
  expect(f.received).toHaveLength(0);
}));

test("client transport requires current approved profiles and refuses a suspension during native review", async () => fixture(async f => {
  const target = await protectedAiTarget(f.config, "fixture", "fixture");
  const transport = () => new ProtectedAiTransport(f.options);
  await expect(transport().dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({details: {reason: "profile-missing"}});
  const patch = {state: "approved" as const, scope, targetFingerprint: target.fingerprint, legalProfileId: "synthetic-policy-test", legalProfileVersion: "1", evidenceRefs: ["sha256:" + "b".repeat(64)], expiresAt: null};
  await compareAndSetGovernanceProfile(f.config, {id: "profile", expectedRevision: 0, patch}, {type: "host"});
  f.review(async () => {await compareAndSetGovernanceProfile(f.config, {id: "profile", expectedRevision: 1, patch: {...patch, state: "suspended"}}, {type: "host"});});
  await expect(transport().dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({details: {reason: "suspended"}});
  expect(f.received).toHaveLength(0);
}));

test("account rotation during native review emits no request to either account", async () => fixture(async f => {
  f.review(async () => {await writeRuntimeOpencodeConfig(f.config, GLOBAL_PROVIDERS_ID, () => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: f.receiver.url.origin + "/v1", apiKey: "ROTATED-ACCOUNT"}, models: {fixture: {}}}}}));});
  await expect(new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "host_decision_stale"});
  expect(f.received).toHaveLength(0);
}));

test("changing the host to read-only during native review revokes final-wire admission", async () => fixture(async f => {
  f.review(async () => {f.config.readOnly = true;});
  await expect(new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "read_only"});
  expect(f.received).toHaveLength(0);
}));

test("auto mode and the ordinary renderer responder cannot acknowledge the native-only final context", async () => fixture(async f => {
  let queued!: () => void;
  const ready = new Promise<void>(resolve => {queued = resolve;});
  const approvals = new ApprovalService({mode: "auto", timeoutMs: 1000}, undefined, () => {queued();});
  try {
    const pending = new ProtectedAiTransport({...f.options, approvals, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000));
    await ready;
    const request = approvals.list()[0];
    expect(request?.nativeOnly).toBe(true); expect(request?.canRemember).toBe(false);
    if (!request) throw new Error("Native context approval was not queued");
    expect(approvals.respond(request.id, "allow")).toBeNull();
    expect(approvals.respondNative(request.id, "always")).toBeNull();
    approvals.respondNative(request.id, "deny");
    await expect(pending).rejects.toMatchObject({code: "protected_ai_denied"});
    expect(f.received).toHaveLength(0);
  } finally {approvals.dispose();}
}));

test("unknown scope, oversized bodies, invalid UTF-8 and auxiliary envelope fields are denied before review", async () => fixture(async f => {
  const options = {...f.options, syntheticPilot: {endpoint: f.endpoint}};
  await expect(new ProtectedAiTransport({...options, scope: {...scope, matterId: null}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({details: {reason: "unknown-context"}});
  const raw = outbound();
  await expect(new ProtectedAiTransport(options).dispatch({...raw, bodyBase64: Buffer.alloc(4 * 1024 * 1024 + 1).toString("base64")}, AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_context_too_large"});
  await expect(new ProtectedAiTransport(options).dispatch({...raw, bodyBase64: Buffer.from([0xff]).toString("base64")}, AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_envelope_invalid"});
  await expect(new ProtectedAiTransport(options).dispatch(outbound(JSON.stringify({...JSON.parse(body), model: "other"})), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_envelope_invalid"});
  await expect(new ProtectedAiTransport(options).dispatch(outbound(JSON.stringify({...JSON.parse(body), web_search_options: {}})), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_envelope_invalid"});
  expect(f.reviewed).toHaveLength(0); expect(f.received).toHaveLength(0);
}));

test("expired or incomplete CZ/SK client profiles deny before native review or networking", async () => fixture(async f => {
  const target = await protectedAiTarget(f.config, "fixture", "fixture");
  const patch = {state: "approved" as const, scope, targetFingerprint: target.fingerprint, legalProfileId: "synthetic-policy-test", legalProfileVersion: "1", evidenceRefs: ["sha256:" + "b".repeat(64)], expiresAt: "2000-01-01T00:00:00.000Z"};
  await compareAndSetGovernanceProfile(f.config, {id: "profile", expectedRevision: 0, patch}, {type: "host"});
  await expect(new ProtectedAiTransport(f.options).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({details: {reason: "reassessment-required"}});
  await compareAndSetGovernanceProfile(f.config, {id: "profile", expectedRevision: 1, patch: {...patch, expiresAt: null}}, {type: "host"});
  await expect(new ProtectedAiTransport({...f.options, scope: {...scope, jurisdictions: ["CZ", "SK"]}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({details: {reason: "profile-missing"}});
  expect(f.received).toHaveLength(0); expect(f.reviewed).toHaveLength(0);
}));

test("a real organization policy refresh revokes final-wire admission during native review", async () => fixture(async f => {
  const previousPlatform = process.env.EIGENWELT_PLATFORM_URL;
  let revision = 1;
  const platform = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: request => {
    const path = new URL(request.url).pathname;
    if (path === "/api/desktop/policy/secrets") return Response.json({schemaVersion: 1, revision, secrets: {}});
    if (path === "/api/desktop/policy") return Response.json({schemaVersion: 1, orgId: "synthetic-org", orgName: "Synthetic test", revision, role: "member", updatedAt: null,
      entries: revision === 1 ? {} : {"ai.chat.allowCustom": {mode: "enforced", value: false}}});
    return new Response(null, {status: 404});
  }});
  try {
    process.env.EIGENWELT_PLATFORM_URL = platform.url.origin;
    await writeEigenweltConnection(f.config, {platformToken: "synthetic-policy-token", platformURL: platform.url.origin, account: {userId: "synthetic-user", userName: "Synthetic user", userEmail: "synthetic@example.test", orgId: "synthetic-org", orgName: "Synthetic test"}});
    await scheduleOrgPolicySync(f.config, {force: true});
    f.review(async () => {revision = 2; await scheduleOrgPolicySync(f.config, {force: true});});
    await expect(new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "org_policy_denied"});
    expect(f.reviewed).toHaveLength(1); expect(f.received).toHaveLength(0);
  } finally {
    if (previousPlatform === undefined) delete process.env.EIGENWELT_PLATFORM_URL; else process.env.EIGENWELT_PLATFORM_URL = previousPlatform;
    platform.stop(true);
  }
}));

test("provider redirects are refused without following to an unapproved receiver", async () => fixture(async f => {
  let foreignCalls = 0;
  const foreign = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => {foreignCalls++; return new Response("unexpected");}});
  try {
    f.respond(() => new Response(null, {status: 307, headers: {location: foreign.url.href}}));
    await expect(new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_redirect_denied"});
    expect(f.received).toHaveLength(1); expect(foreignCalls).toBe(0);
  } finally {foreign.stop(true);}
}));

test("changing protected measurements aborts an in-flight response and releases its socket", async () => fixture(async f => {
  let entered!: () => void;
  const ready = new Promise<void>(resolve => {entered = resolve;});
  let release!: () => void;
  const held = new Promise<void>(resolve => {release = resolve;});
  f.respond(async () => {entered(); await held; return new Response("late protected response");});
  const pending = new ProtectedAiTransport({...f.options, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000));
  await ready; f.mutate();
  try {await expect(pending).rejects.toBeDefined(); expect(f.received).toHaveLength(1);} finally {release();}
}));

test("the DNS-pinned broker rechecks current authorization after asynchronous resolution before opening a socket", async () => {
  let current = true, sent = 0;
  const request = prepareOutboundRequest({url: "https://approved.example/v1/chat/completions", method: "POST", headers: {}, bodyBase64: Buffer.from(body).toString("base64")});
  await expect(brokerRequest(request, async () => true, AbortSignal.timeout(1000), {
    resolve: async () => {current = false; return [{address: "8.8.8.8", family: 4}];},
    send: async () => {sent++; return {status: 200, headers: {}, bodyBase64: ""};},
  }, {beforeConnect: async () => {if (!current) throw new Error("stale after DNS");}})).rejects.toThrow("stale after DNS");
  expect(sent).toBe(0);
});

test("waiting for native review does not repeatedly inspect sources, but acceptance still rejects changed evidence", async () => fixture(async f => {
  let entered!: () => void, release!: () => void, inspections = 0;
  const reviewing = new Promise<void>(resolve => {entered = resolve;});
  const held = new Promise<void>(resolve => {release = resolve;});
  f.review(async () => {entered(); await held;});
  const readCurrentBinding = async () => {inspections++; return f.options.readCurrentBinding();};
  const pending = new ProtectedAiTransport({...f.options, readCurrentBinding, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000));
  try {
    await reviewing;
    await Bun.sleep(120);
    expect(inspections).toBe(1);
    f.mutate(); release();
    await expect(pending).rejects.toMatchObject({code: "host_decision_stale"});
    expect(f.received).toHaveLength(0);
  } finally {release(); await pending.catch(() => {});}
}));

test("a buffered provider response waits for its outstanding inspection and cannot publish after that inspection revokes it", async () => fixture(async f => {
  let entered!: () => void, finishResponse!: () => void, inspecting!: () => void, finishInspection!: () => void, observedFinalRead!: () => void;
  const receiverReady = new Promise<void>(resolve => {entered = resolve;});
  const responseHeld = new Promise<void>(resolve => {finishResponse = resolve;});
  const inspectionReady = new Promise<void>(resolve => {inspecting = resolve;});
  const inspectionHeld = new Promise<void>(resolve => {finishInspection = resolve;});
  const finalRead = new Promise<void>(resolve => {observedFinalRead = resolve;});
  let holdInspection = false, capturedInspection = false, inspectionReleased = false;
  f.respond(async () => {entered(); await responseHeld; return new Response("BUFFERED_PROTECTED_RESPONSE");});
  const readCurrentBinding = async () => {
    if (holdInspection && !capturedInspection) {
      capturedInspection = true; inspecting(); await inspectionHeld; f.mutate();
    }
    const value = await f.options.readCurrentBinding();
    if (holdInspection && capturedInspection && !inspectionReleased) observedFinalRead();
    return value;
  };
  const pending = new ProtectedAiTransport({...f.options, readCurrentBinding, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000));
  try {
    await receiverReady; holdInspection = true;
    await inspectionReady; finishResponse();
    // Let the real HTTP body finish while its earlier source inspection stays
    // deliberately unresolved; the returned bytes must still remain private.
    await Promise.race([finalRead, Bun.sleep(500)]);
    await Bun.sleep(0);
    inspectionReleased = true; finishInspection();
    await expect(pending).rejects.toMatchObject({code: "host_decision_stale"});
    expect(f.received).toHaveLength(1);
  } finally {finishResponse(); inspectionReleased = true; finishInspection(); await pending.catch(() => {});}
}));

 test("an unmeasured guest launcher is refused before native approval and network access", async () => fixture(async f => {
  const readCurrentBinding = async () => {const binding = await f.options.readCurrentBinding(); return {...binding, launcherSha256: ""};};
  await expect(new ProtectedAiTransport({...f.options, readCurrentBinding, syntheticPilot: {endpoint: f.endpoint}}).dispatch(outbound(), AbortSignal.timeout(3000))).rejects.toMatchObject({code: "protected_ai_measurement_missing"});
  expect(f.reviewed).toHaveLength(0); expect(f.received).toHaveLength(0);
}));
