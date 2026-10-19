import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { constants as fsConstants } from "node:fs";
import { createSocket } from "node:dgram";
import { once } from "node:events";
import { request as directRequest } from "node:http";
import { copyFile, lstat, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { networkInterfaces } from "node:os";
import { ApprovalService } from "../../approvals.js";
import { VmSandbox } from "../../agent-sandbox/vm.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { closeRuntimeOpencodeConfig, GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import type { WorkspaceInfo } from "../../types.js";
import { LawossDocuments } from "../documents/service.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { ProtectedDocumentTools } from "./document-tools.js";
import { ProtectedAiTransport } from "./transport.js";
import { ProtectedVmEngine, type ProtectedVmBroker } from "./vm-engine.js";

const enabled = process.env.LAWOSS_PROTECTED_VM_TEST === "1";
async function sha256(file: string): Promise<string> {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
async function fileIdentity(file: string): Promise<string> {
  const value = await lstat(file, { bigint: true });
  if (!value.isFile() || value.isSymbolicLink()) throw new Error("Measured protected fixture is not a regular file");
  return [value.dev, value.ino, value.size, value.mtimeNs, value.ctimeNs].join(":");
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value)) : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];

// This observes only constructor-owned public RPC traffic and real response bodies.
// Holding an ACK proves retirement ordering without a scheduler-delay oracle.
function retirementProbe() {
  let mode: "off" | "health" | "cancel" = "off";
  const health = new Set<string>(), events = new Set<string>(), retired = new Set<string>();
  const ends = new Set<string>();
  let cancelHeld = false, pulls = 0, replacements = 0;
  let releaseEnd!: () => void, releaseCancel!: () => void;
  const endGate = new Promise<void>(resolve => { releaseEnd = resolve; });
  const cancelGate = new Promise<void>(resolve => { releaseCancel = resolve; });
  const changes = new Set<() => void>();
  const notify = () => { for (const callback of [...changes]) callback(); };
  const wait = (predicate: () => boolean, signal: AbortSignal, description: string) => new Promise<void>((resolve, reject) => {
    const cleanup = () => { changes.delete(check); signal.removeEventListener("abort", aborted); };
    const check = () => { if (predicate()) { cleanup(); resolve(); } };
    const aborted = () => { cleanup(); reject(new Error(`Guest retirement probe timed out: ${description}`)); };
    changes.add(check); signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted(); else check();
  });
  const hold = (gate: Promise<void>, signal: AbortSignal) => new Promise<void>((resolve, reject) => {
    const aborted = () => { signal.removeEventListener("abort", aborted); reject(signal.reason); };
    signal.addEventListener("abort", aborted, { once: true });
    if (signal.aborted) aborted();
    void gate.then(() => { signal.removeEventListener("abort", aborted); resolve(); });
  });
  const wrap = (broker: ProtectedVmBroker): ProtectedVmBroker => async (request, signal) => {
    const path = new URL(request.url).pathname;
    const frame = path === "/rpc/result" ? object(JSON.parse(Buffer.from(request.bodyBase64, "base64").toString("utf8"))) : {};
    // The replacement body must stay unread until the host has actually accepted
    // the first retirement frame, even after END/cancel acknowledgements resume.
    if (frame.kind === "retired" && health.has(String(frame.id)) && ![...health].some(id => retired.has(id))) expect(pulls).toBe(0);
    if (frame.kind === "retired" && events.has(String(frame.id)) && ![...events].some(id => retired.has(id))) expect(pulls).toBe(1);
    const response = await broker(request, signal);
    if (path === "/rpc/next") {
      const command = object(JSON.parse(Buffer.from(response.bodyBase64, "base64").toString("utf8")));
      if (command.kind === "request" && typeof command.id === "string") {
        if (String(command.path).includes("retirement-health")) health.add(command.id);
        if (String(command.path).includes("retirement-event")) events.add(command.id);
        if (String(command.path).includes("retirement-replacement")) replacements++;
      }
      if (mode === "cancel" && command.kind === "cancel" && events.has(String(command.id)) && !cancelHeld) {
        cancelHeld = true; notify(); await hold(cancelGate, signal);
      }
    }
    if (frame.kind === "retired") retired.add(String(frame.id));
    if (mode === "health" && frame.kind === "end" && health.has(String(frame.id))) {
      ends.add(String(frame.id)); notify(); await hold(endGate, signal);
    }
    notify(); return response;
  };
  return { wrap, async run(engine: ProtectedVmEngine, sessionId: string) {
    const signal = AbortSignal.timeout(30_000);
    const replacement = () => engine.fetch(new Request(`http://private-engine/session/${sessionId}/abort?retirement-replacement=1`, {
      method: "POST", signal, body: new ReadableStream<Uint8Array>({ pull(controller) { pulls++; controller.close(); } }, { highWaterMark: 0 }), duplex: "half",
    } as RequestInit));
    try {
      mode = "health";
      const bodies = Array.from({ length: 12 }, (_, index) => engine.fetch(new Request(`http://private-engine/global/health?retirement-health=${index}`, { signal })).then(async response => {
        expect(response.ok).toBe(true); expect(object(await response.json()).healthy).toBe(true);
      }));
      // Old guests can finish public bodies but never retire their issued leases.
      await Promise.all(bodies);
      await wait(() => ends.size === 12, signal, "12 END acknowledgements held");
      const next = replacement();
      expect(pulls).toBe(0); expect(replacements).toBe(0);
      releaseEnd();
      const response = await next; expect(response.ok).toBe(true); await response.arrayBuffer();
      await wait(() => [...health].every(id => retired.has(id)), signal, "all health tasks retired");
      expect(health.size).toBe(12); expect(pulls).toBe(1); expect(replacements).toBe(1);
      mode = "cancel";
      const callers = Array.from({ length: 12 }, () => new AbortController());
      const streams = await Promise.all(callers.map((controller, index) => engine.fetch(new Request(`http://private-engine/event?retirement-event=${index}`, { signal: AbortSignal.any([signal, controller.signal]) }))));
      expect(events.size).toBe(12);
      for (let index = 0; index < 6; index++) callers[index].abort();
      await Promise.all(streams.slice(6).map(response => response.body!.cancel()));
      await wait(() => cancelHeld, signal, "first actual cancel delivery held");
      const afterCancel = replacement();
      expect(pulls).toBe(1); expect(replacements).toBe(1);
      releaseCancel();
      const after = await afterCancel; expect(after.ok).toBe(true); await after.arrayBuffer();
      await wait(() => [...events].every(id => retired.has(id)), signal, "all caller/body-cancelled guest tasks retired");
      expect(pulls).toBe(2); expect(replacements).toBe(2);
      console.info("ACTUAL_VM_RETIREMENT_PROOF", JSON.stringify({ healthRequests: health.size, heldEnds: ends.size,
        cancelledStreams: events.size, actualRetirements: [...health, ...events].filter(id => retired.has(id)).length, replacements, bodyPulls: pulls }));
    } finally {
      console.info("ACTUAL_VM_RETIREMENT_COUNTS", JSON.stringify({ healthRequests: health.size, heldEnds: ends.size,
        cancelledStreams: events.size, actualRetirements: [...health, ...events].filter(id => retired.has(id)).length, replacements, bodyPulls: pulls }));
      mode = "off"; releaseEnd(); releaseCancel();
    }
  } };
}

// Explicit opt-in is required because this test boots an actual measured VM.
// The completion protocol is synthetic; the engine, tool execution, saved bytes,
// native final-wire decisions and confinement implementation are production code.
(enabled ? test : test.skip)("actual NIC-free VM engine completes selected-document tools through host final-wire approval", async () => {
  const runtimeDirectory = process.env.LAWOSS_PROTECTED_VM_TEST_RUNTIME;
  const sourceBundleDirectory = process.env.LAWOSS_PROTECTED_VM_TEST_BUNDLE;
  if (!runtimeDirectory || !sourceBundleDirectory) throw new Error("Explicit measured runtime and guest bundle paths are required");
  const { root, config } = await syntheticHostConfig();
  const sourceRoot = join(root, "case"), emptyDirectory = join(root, "empty"), bundleDirectory = join(root, "bundle");
  await Promise.all([mkdir(sourceRoot), mkdir(emptyDirectory), mkdir(bundleDirectory)]);
  for (const name of ["opencode", "plugin.mjs", "config.json", "protected-engine.mjs"]) await copyFile(join(sourceBundleDirectory, name), join(bundleDirectory, name), fsConstants.COPYFILE_FICLONE);
  const workspace: WorkspaceInfo = { id: "protected-vm-synthetic", name: "Synthetic VM transport", path: sourceRoot, preset: "", workspaceType: "local" };
  config.workspaces = [workspace];
  const ocr = new OcrManager(join(root, "ocr"));
  const preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments(config, preparation);
  let engine: ProtectedVmEngine | undefined;
  let requests = 0;
  const wireShapes: Array<{ tools: string[]; keys: string[]; authorization: boolean }> = [];
  const nativeReviews: string[] = [];
  const toolCalls: string[] = [];
  let originalId = "";
  const proofStarted = Date.now();
  const operations = ["lawoss_documents_list", "lawoss_documents_read", "lawoss_documents_export", "lawoss_documents_export", "lawoss_documents_validate"];
  const provider = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests++;
    const body = object(await request.json());
    const messages = array(body.messages).map(object);
    const tools = array(body.tools).map(tool => object(object(tool).function).name).filter((name): name is string => typeof name === "string");
    wireShapes.push({ tools, keys: Object.keys(body).sort(), authorization: request.headers.get("authorization") === "Bearer SYNTHETIC-HOST-ONLY-KEY" });
    const priorCalls = messages.flatMap(message => array(message.tool_calls)).map(call => object(object(call).function));
    const count = priorCalls.filter(call => operations.includes(String(call.name))).length;
    let lastUser = -1;
    for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === "user") { lastUser = index; break; }
    const content = messages[lastUser]?.content;
    const continuation = (typeof content === "string" ? content : array(content).map(part => String(object(part).text ?? "")).join("\n")).includes("CONTINUATION_FRESH_READ");
    const freshCalls = messages.slice(lastUser + 1).flatMap(message => array(message.tool_calls));
    const name = !tools.length ? undefined : continuation ? freshCalls.length ? undefined : "lawoss_documents_read" : operations[count];
    let args: unknown;
    if (name === "lawoss_documents_list") args = {};
    if (name === "lawoss_documents_read") args = { id: originalId, limit: 16000 };
    if (name === "lawoss_documents_export") args = { path: count === 2 ? "vm-registry.csv" : "vm-summary.md", kind: count === 2 ? "registry" : "summary", outputLanguage: "cs", documentIds: [originalId], entries: [{ documentId: originalId, summary: "Synthetic transport source reviewed." }] };
    if (name === "lawoss_documents_validate") args = { paths: ["vm-registry.csv", "vm-summary.md"], documentIds: [originalId], outputLanguage: "cs" };
    if (name && !tools.includes(name)) throw new Error("Actual engine did not advertise the required document tool");
    const delta = name ? { tool_calls: [{ index: 0, id: `call_vm_${requests}`, type: "function", function: { name, arguments: JSON.stringify(args) } }] } : { content: "ACTUAL_VM_DOCUMENT_TRANSPORT_COMPLETE" };
    const base = { id: `chatcmpl-vm-${requests}`, object: "chat.completion.chunk", created: 1, model: body.model };
    const event = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
    return new Response(event({ ...base, choices: [{ index: 0, delta: { role: "assistant", ...delta }, finish_reason: null }] }) +
      event({ ...base, choices: [{ index: 0, delta: {}, finish_reason: name ? "tool_calls" : "stop" }], usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 } }) + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 10_000 }, async request => { nativeReviews.push(request.action); console.info("ACTUAL_VM_NATIVE_REVIEW", JSON.stringify({ index: nativeReviews.length, elapsedMs: Date.now() - proofStarted })); return "allow"; });
  try {
    await writeFile(join(sourceRoot, "selected.txt"), "SYNTHETIC_SELECTED_VM_EVIDENCE\nNo real client information.");
    const [prepared] = await documents.prepare(workspace, ["selected.txt"]);
    originalId = prepared.id;
    const preparedBy = Date.now() + 3000;
    while (!(await documents.list(workspace)).every(document => document.status === "readable")) {
      if (Date.now() >= preparedBy) throw new Error("Synthetic text preparation did not complete");
      await Bun.sleep(10);
    }
    const tools = await ProtectedDocumentTools.open({ documents, workspace, sources: [{ id: prepared.id, hash: prepared.hash }] });
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: provider.url.origin + "/v1", apiKey: "SYNTHETIC-HOST-ONLY-KEY" }, models: { synthetic: {} } } } }));
    const operationId = randomUUID();
    // These private test-owned bundle bytes remain immutable for the operation.
    // Measure them once; source ownership/content is still rechecked on every dispatch.
    const measuredFiles = { engineSha256: join(bundleDirectory, "opencode"), runtimeManifestSha256: join(runtimeDirectory, "manifest.json"),
      pluginSha256: join(bundleDirectory, "plugin.mjs"), configSha256: join(bundleDirectory, "config.json"), launcherSha256: join(bundleDirectory, "protected-engine.mjs") };
    const measured: Record<string, string> = {}, identities: Record<string, string> = {};
    for (const [name, file] of Object.entries(measuredFiles)) {
      identities[name] = await fileIdentity(file); measured[name] = await sha256(file);
      if (await fileIdentity(file) !== identities[name]) throw new Error("Protected fixture changed during measurement");
    }
    console.info("ACTUAL_VM_MEASUREMENTS", JSON.stringify({ operationId, ...(await tools.currentBinding()),
      ...measured, legalApproval: false }));
    const transport = new ProtectedAiTransport({ config, approvals, scope: { workspaceId: workspace.id, matterId: "synthetic-op", jurisdictions: ["CZ", "SK"] }, providerId: "fixture", modelId: "synthetic",
      syntheticPilot: { endpoint: provider.url.origin + "/v1/chat/completions" },
      readCurrentBinding: async () => {
        for (const [name, file] of Object.entries(measuredFiles)) if (await fileIdentity(file) !== identities[name]) throw new Error("Measured protected fixture changed");
        return { ...(await tools.currentBinding()), operationId, ...measured };
      },
    });
    const started = Date.now();
    engine = await ProtectedVmEngine.open({ bundleDirectory, emptyDirectory, signal: AbortSignal.timeout(550_000),
      handleOutbound: async (request, signal) => {
        console.info("ACTUAL_VM_OUTBOUND_ENTER", JSON.stringify({ bodyBytes: request.bodyBytes, elapsedMs: Date.now() - proofStarted }));
        try { return await transport.dispatch(request, signal); }
        catch (error) {
          const details = object(error);
          let keys: string[] = [];
          try { keys = Object.keys(object(JSON.parse(Buffer.from(request.bodyBase64, "base64").toString("utf8")))).sort(); } catch {}
          console.error("ACTUAL_VM_OUTBOUND_REFUSAL", JSON.stringify({ code: details.code ?? "unknown", bodyBytes: request.bodyBytes, keys }));
          throw error;
        }
      },
      handleTool: async (call, signal) => { toolCalls.push(call.name); return tools.invoke(call.name, call.arguments, signal); },
    }, { createSandbox: broker => new VmSandbox(runtimeDirectory, "auto", { request: broker, maxRequests: 4096 }) });
    console.info("ACTUAL_VM_READY", JSON.stringify({ warmupMs: Date.now() - started }));
    // The inference budget begins only after VM/runtime provisioning and readiness.
    const inference = AbortSignal.timeout(90_000);
    const creation = await engine.fetch(new Request("http://private-engine/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title: "Synthetic protected VM evidence" }), signal: inference }));
    console.info("ACTUAL_VM_SESSION_CREATED", JSON.stringify({ status: creation.status, elapsedMs: Date.now() - proofStarted }));
    expect(creation.ok).toBe(true);
    const session = object(await creation.json());
    expect(typeof session.id).toBe("string");
    const sent = await engine.fetch(new Request(`http://private-engine/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, signal: inference,
      body: JSON.stringify({ agent: "legalwork", model: { providerID: "protected-documents", modelID: "synthetic" }, parts: [{ type: "text", text: "Read the selected synthetic document, create a registry CSV and summary Markdown using the four available tools, validate both actual saved files, then report completion." }] }) }));
    const actual = object(await sent.json());
    expect(sent.ok).toBe(true);
    const snapshot = await engine.fetch(new Request(`http://private-engine/session/${session.id}/message`, { signal: inference }));
    const messages = array(await snapshot.json()).map(object);
    const parts = messages.flatMap(message => array(message.parts)).map(object);
    const completedTools = parts.filter(part => part.type === "tool" && object(part.state).status === "completed");
    const texts = parts.filter(part => part.type === "text").map(part => String(part.text));
    expect(texts.some(text => text.includes("ACTUAL_VM_DOCUMENT_TRANSPORT_COMPLETE"))).toBe(true);
    expect(completedTools.map(part => part.tool)).toEqual(operations);
    expect(toolCalls).toEqual(operations);
    expect(wireShapes.every(shape => shape.authorization && shape.tools.every(tool => operations.includes(tool)))).toBe(true);
    expect(nativeReviews.filter(action => action === "ai.protected.synthetic").length).toBe(requests);
    const validation = object(await tools.invoke("lawoss_documents_validate", { paths: ["vm-registry.csv", "vm-summary.md"], documentIds: [prepared.id], outputLanguage: "cs" }, inference));
    expect(validation.valid).toBe(true);
    const saved = ["vm-registry.csv", "vm-summary.md"];
    for (const path of saved) expect((await readFile(join(sourceRoot, path))).byteLength).toBeGreaterThan(0);
    const savedOutputHashes = await Promise.all(saved.map(path => sha256(join(sourceRoot, path))));
    console.info("ACTUAL_VM_PROOF", JSON.stringify({ actualAssistant: Object.keys(actual).length > 0, requests, nativeReviews: nativeReviews.length,
      completedTools: completedTools.map(part => part.tool), validationValid: validation.valid, legalApproval: false,
      runtimeProvenance: "explicitly supplied measured runtime and engine bundle", runtimeManifestSha256: measured.runtimeManifestSha256, outputHashes: savedOutputHashes, wireShapes }));
    const checkpoint = await engine.fetch(new Request("http://private-engine/_protected/checkpoint", { signal: inference }));
    expect(checkpoint.ok).toBe(true);
    expect(checkpoint.headers.get("content-type")).toBe("application/octet-stream");
    const checkpointBytes = Buffer.from(await checkpoint.arrayBuffer());
    const checkpointSha256 = createHash("sha256").update(checkpointBytes).digest("hex");
    expect(checkpoint.headers.get("x-protected-sha256")).toBe(checkpointSha256);
    expect(checkpointBytes.subarray(0, 16).toString("utf8")).toBe("SQLite format 3\0");
    await engine.stop(); engine = undefined;
    await VmSandbox.shutdown();
    await writeFile(join(bundleDirectory, "snapshot.sqlite"), checkpointBytes, { mode: 0o600, flag: "wx" });
    const restoredConfig = object(JSON.parse(await readFile(join(bundleDirectory, "config.json"), "utf8")));
    await writeFile(join(bundleDirectory, "config.json"), JSON.stringify({ ...restoredConfig, checkpointSha256 }), { mode: 0o600 });
    identities.configSha256 = await fileIdentity(measuredFiles.configSha256);
    measured.configSha256 = await sha256(measuredFiles.configSha256);
    if (await fileIdentity(measuredFiles.configSha256) !== identities.configSha256) throw new Error("Restored configuration changed during measurement");
    // Bind the exact restored database as well as launcher/config/runtime bytes.
    const snapshotIdentity = await fileIdentity(join(bundleDirectory, "snapshot.sqlite"));
    const restoredTransport = new ProtectedAiTransport({ config, approvals, scope: { workspaceId: workspace.id, matterId: "synthetic-op", jurisdictions: ["CZ", "SK"] }, providerId: "fixture", modelId: "synthetic",
      syntheticPilot: { endpoint: provider.url.origin + "/v1/chat/completions" },
      readCurrentBinding: async () => {
        for (const [name, file] of Object.entries(measuredFiles)) if (await fileIdentity(file) !== identities[name]) throw new Error("Measured protected fixture changed");
        if (await fileIdentity(join(bundleDirectory, "snapshot.sqlite")) !== snapshotIdentity) throw new Error("Restored database binding changed");
        return { ...(await tools.currentBinding()), operationId: operationId + "-continuation", ...measured, checkpointSha256 };
      },
    });
    const retirement = retirementProbe();
    engine = await ProtectedVmEngine.open({ bundleDirectory, emptyDirectory, signal: AbortSignal.timeout(300_000),
      handleOutbound: (request, signal) => restoredTransport.dispatch(request, signal),
      handleTool: async (call, signal) => { toolCalls.push(call.name); return tools.invoke(call.name, call.arguments, signal); },
    }, { createSandbox: broker => new VmSandbox(runtimeDirectory, "auto", { request: retirement.wrap(broker), maxRequests: 4096 }) });
    const continuationBudget = AbortSignal.timeout(90_000);
    const restoredSessionResponse = await engine.fetch(new Request(`http://private-engine/session/${session.id}`, { signal: continuationBudget }));
    const restoredSession = object(await restoredSessionResponse.json());
    expect(restoredSession.id).toBe(session.id);
    const restoredMessagesResponse = await engine.fetch(new Request(`http://private-engine/session/${session.id}/message`, { signal: continuationBudget }));
    const restoredMessages = array(await restoredMessagesResponse.json()).map(object);
    expect(restoredMessages).toEqual(messages);
    const beforeContinuationReviews = nativeReviews.length;
    const continued = await engine.fetch(new Request(`http://private-engine/session/${session.id}/message`, { method: "POST", headers: { "content-type": "application/json" }, signal: continuationBudget,
      body: JSON.stringify({ agent: "legalwork", model: { providerID: "protected-documents", modelID: "synthetic" }, parts: [{ type: "text", text: "CONTINUATION_FRESH_READ: Reread the selected synthetic source with the actual document tool, then report completion." }] }) }));
    expect(continued.ok).toBe(true); await continued.arrayBuffer();
    expect(nativeReviews.length).toBeGreaterThan(beforeContinuationReviews);
    expect(toolCalls.at(-1)).toBe("lawoss_documents_read");
    expect(toolCalls.length).toBe(operations.length + 1);
    const continuedResponse = await engine.fetch(new Request(`http://private-engine/session/${session.id}/message`, { signal: continuationBudget }));
    const continuedMessages = array(await continuedResponse.json()).map(object);
    const continuedParts = continuedMessages.flatMap(message => array(message.parts)).map(object);
    const continuedTools = continuedParts.filter(part => part.type === "tool" && object(part.state).status === "completed");
    expect(continuedTools.slice(0, operations.length)).toEqual(completedTools);
    expect(continuedTools.length).toBe(operations.length + 1);
    expect(await Promise.all(saved.map(path => sha256(join(sourceRoot, path))))).toEqual(savedOutputHashes);
    console.info("ACTUAL_VM_CHECKPOINT_PROOF", JSON.stringify({ checkpointSha256, checkpointBytes: checkpointBytes.byteLength,
      coldVmRestore: true, sameSessionId: restoredSession.id === session.id, preservedMessageCount: restoredMessages.length,
      preservedCompletedToolCount: completedTools.length, freshCompletedToolCount: continuedTools.length - completedTools.length,
      freshNativeReviews: nativeReviews.length - beforeContinuationReviews, actualSourceHash: prepared.hash, outputHashes: await Promise.all(saved.map(path => sha256(join(sourceRoot, path)))), legalApproval: false }));
    const beforeProbe = { requests, reviews: nativeReviews.length, tools: toolCalls.length };
    await retirement.run(engine, String(session.id));
    expect({ requests, reviews: nativeReviews.length, tools: toolCalls.length }).toEqual(beforeProbe);
  } finally {
    console.info("ACTUAL_VM_FINAL_COUNTS", JSON.stringify({ requests, nativeReviews: nativeReviews.length, toolCalls, elapsedMs: Date.now() - proofStarted }));
    await engine?.stop();
    await VmSandbox.shutdown();
    approvals.dispose(); provider.stop(true);
    await documents.stop(); preparation.stop(); ocr.stop();
    await closeOrgPolicyRuntime(config);
    await closeRuntimeOpencodeConfig(config);
    await rm(root, { recursive: true });
  }
}, 600_000);

(enabled ? test : test.skip)("actual NIC-free worker cannot reach an independently observed host LAN receiver over raw TCP, UDP or curl", async () => {
  const runtimeDirectory = process.env.LAWOSS_PROTECTED_VM_TEST_RUNTIME;
  if (!runtimeDirectory) throw new Error("Explicit measured runtime path is required");
  const address = Object.values(networkInterfaces()).flat().find(entry => entry?.family === "IPv4" && !entry.internal)?.address;
  if (!address || !/^\d+\.\d+\.\d+\.\d+$/.test(address)) throw new Error("An independently reachable host LAN interface is required");
  const canary = randomUUID();
  let httpHits = 0, udpHits = 0, brokerAttempts = 0;
  const receiver = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: request => { if (new URL(request.url).pathname === "/" + canary) httpHits++; return new Response("controlled"); } });
  const udp = createSocket("udp4"), sender = createSocket("udp4");
  udp.on("message", message => { if (message.toString() === canary) udpHits++; });
  const { root } = await syntheticHostConfig();
  try {
    udp.bind(0, "0.0.0.0"); await once(udp, "listening");
    console.info("ACTUAL_VM_ESCAPE_STAGE", "receiver-ready");
    const udpAddress = udp.address();
    // Positive controls prove both independent receivers actually observe this host interface.
    await new Promise<void>((resolve, reject) => {
      const req = directRequest({ hostname: address, port: receiver.port, path: "/" + canary }, response => { response.resume(); response.on("end", resolve); response.on("error", reject); });
      req.setTimeout(3000, () => req.destroy(new Error("Host positive control timed out"))); req.on("error", reject); req.end();
    });
    console.info("ACTUAL_VM_ESCAPE_STAGE", "host-http-positive");
    const observed = once(udp, "message", { signal: AbortSignal.timeout(3000) });
    await new Promise<void>((resolve, reject) => sender.send(Buffer.from(canary), udpAddress.port, address, error => error ? reject(error) : resolve()));
    await observed;
    console.info("ACTUAL_VM_ESCAPE_STAGE", "host-udp-positive");
    expect(httpHits).toBe(1); expect(udpHits).toBe(1);
    const script = `import socket,subprocess,os,json\nhost=${JSON.stringify(address)}\nport=${receiver.port}\nudp_port=${udpAddress.port}\ncanary=${JSON.stringify(canary)}\ns=socket.socket();s.settimeout(1)\ntcp_failed=s.connect_ex((host,port))!=0\ns.close()\nu=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);u.settimeout(1)\ntry:\n u.sendto(canary.encode(),(host,udp_port));udp_failed=False\nexcept OSError:\n udp_failed=True\nu.close()\nenv={k:v for k,v in os.environ.items() if 'proxy' not in k.lower()}\nr=subprocess.run(['curl','--noproxy','*','--connect-timeout','1','--max-time','2','-sS','http://'+host+':'+str(port)+'/'+canary],env=env,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=3)\nprint(json.dumps(dict(tcp_failed=tcp_failed,udp_failed=udp_failed,curl_failed=r.returncode!=0)))`;
    const quoted = "'" + script.replaceAll("'", "'\"'\"'") + "'";
    const result = await new VmSandbox(runtimeDirectory).run({ command: "exec python3 -c " + quoted, cwd: "/workspace", mounts: [{ source: root, target: "/workspace", writable: false }], timeoutMs: 10_000,
      signal: AbortSignal.timeout(200_000), networkMode: "approve", authorizeNetwork: async () => { brokerAttempts++; return false; } });
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.output.trim())).toEqual({ tcp_failed: true, udp_failed: true, curl_failed: true });
    expect(brokerAttempts).toBe(0); expect(httpHits).toBe(1); expect(udpHits).toBe(1);
    console.info("ACTUAL_VM_ESCAPE_PROOF", JSON.stringify({ hostPositiveControls: { http: 1, udp: 1 }, vmReceiverHits: { http: httpHits - 1, udp: udpHits - 1 }, rawTcpFailed: true, rawUdpFailed: true, subprocessCurlFailed: true, brokerAttempts }));
  } finally {
    try { sender.close(); } catch {}
    try { udp.close(); } catch {}
    receiver.stop(true);
    await VmSandbox.shutdown(); await rm(root, { recursive: true });
  }
}, 240_000);
