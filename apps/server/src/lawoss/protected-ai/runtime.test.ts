import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ApprovalService } from "../../approvals.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { GLOBAL_PROVIDERS_ID, runtimeStorageDir, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { LawossDocuments } from "../documents/service.js";
import { ProtectedDocumentRuntime } from "./runtime.js";
import type { ProtectedVmOpen } from "./vm-engine.js";
import { compareAndSetGovernanceProfile } from "../ai-governance-store.js";
import { protectedAiTarget } from "./transport.js";

test("corrupt private history remains an explicit cached error and prevents new protected execution", async () => {
  const { config, root } = await syntheticHostConfig();
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }); let starts = 0;
  const runtime = new ProtectedDocumentRuntime({ config, approvals, documents, getGuestBundle: async () => { starts++; throw new Error("must remain blocked"); } });
  try {
    const directory = join(runtimeStorageDir(config), "protected-document-sessions"); await mkdir(directory, { recursive: true });
    await writeFile(join(directory, "a".repeat(64) + ".json"), "corrupt private metadata");
    await expect(runtime.initialize()).rejects.toMatchObject({ code: "protected_history_invalid" });
    await expect(runtime.open({ workspaceId: "project", providerId: "selected", modelId: "selected", sources: [{ id: "2e83fca8-8e9c-45ad-8d8e-9ec48aca67a7", hash: "a".repeat(64) }] }, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_history_invalid" });
    expect(starts).toBe(0);
  } finally { await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true }); }
});

test("a denied native synthetic classification and an unknown legal profile cannot start an engine", async () => {
  const { config, root } = await syntheticHostConfig();
  const workspace = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const };
  config.workspaces = [workspace];
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments(config, preparation);
  const reviews: string[] = [];
  let holdNative = false, nativeStarted!: () => void;
  const reviewing = new Promise<void>(resolve => { nativeStarted = resolve; });
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async (request, signal) => {
    reviews.push(request.description ?? "");
    if (holdNative) { nativeStarted(); await new Promise<void>(resolve => { signal.addEventListener("abort", () => resolve(), { once: true }); if (signal.aborted) resolve(); }); }
    return "deny";
  });
  let engines = 0;
  const measurement = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
  const runtime = new ProtectedDocumentRuntime({ config, approvals, documents,
    getGuestBundle: async () => ({ directory: root, emptyDirectory: root, measurements: measurement, currentBinding: async () => measurement }),
    // Protocol-only seam; this regression proves denial before any VM startup.
    openEngine: async () => { engines++; throw new Error("must not start"); } });
  try {
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:47831/v1" }, models: { fixture: {} } } } }));
    await writeFile(join(root, "selected.txt"), "SYNTHETIC-CLASSIFICATION-CANARY");
    const [source] = await documents.prepare(workspace, ["selected.txt"]);
    for (let i = 0; i < 200; i++) { if ((await documents.list(workspace))[0]?.status === "readable") break; await Bun.sleep(10); }
    const input = { workspaceId: workspace.id, providerId: "fixture", modelId: "fixture", sources: [{ id: source.id, hash: source.hash }] };
    await expect(runtime.open({ ...input, profileId: "unknown" }, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_ai_profile_missing" });
    await expect(runtime.open(input, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_ai_denied" });
    expect(engines).toBe(0);
    expect(reviews).toHaveLength(1);
    expect(reviews[0]).toContain("SYNTHETIC-CLASSIFICATION-CANARY");
    const target = await protectedAiTarget(config, "fixture", "fixture");
    // Internal host-owned unit fixture only; this is not an HTTP/legal approval.
    await compareAndSetGovernanceProfile(config, { id: "explicit-matter-profile", expectedRevision: 0, patch: { state: "approved", scope: { workspaceId: workspace.id, matterId: "explicit-matter-fixture", jurisdictions: ["CZ"] }, targetFingerprint: target.fingerprint, legalProfileId: "unit-fixture", legalProfileVersion: "1", evidenceRefs: ["sha256:" + "a".repeat(64)], expiresAt: null } }, { type: "host" });
    await expect(runtime.open({ ...input, profileId: "explicit-matter-profile" }, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_ai_denied" });
    expect(reviews[1]).toContain("every displayed source belong to matter explicit-matter-fixture");
    expect(reviews[1]).toContain(await realpath(root));
    expect(reviews[1]).toContain("SYNTHETIC-CLASSIFICATION-CANARY");
    expect(runtime.ownsSession(workspace.id, "foreign")).toBe(false);
    await expect(runtime.proxy({ workspaceId: workspace.id, sessionId: "foreign", request: new Request("http://host/session/foreign") })).rejects.toMatchObject({ code: "protected_session_missing" });
    const forged = { ...input, syntheticPilot: true };
    await expect(runtime.open(forged, AbortSignal.timeout(3000))).rejects.toBeDefined();
    holdNative = true;
    const opening = runtime.open(input, AbortSignal.timeout(3000));
    const rejected = expect(opening).rejects.toBeDefined();
    await reviewing; await runtime.close(); await rejected;
    expect(engines).toBe(0);
  } finally {
    await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop();
    await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true });
  }
});

test("protocol-only VM seam preserves session identity, rewrites only owned directory/model and rejects foreign case sources", async () => {
  const { config, root } = await syntheticHostConfig();
  const workspace = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const };
  config.workspaces = [workspace];
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => "allow");
  const measurement = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
  const calls: Array<{ path: string; body: string }> = [];
  let events: ReadableStreamDefaultController<Uint8Array> | undefined;
  let disposed = 0, stopped = 0;
  const database = new Database(join(root, "protocol-only.sqlite")); database.exec("CREATE TABLE protocol_fixture(id TEXT)"); database.close();
  const checkpoint = await readFile(join(root, "protocol-only.sqlite"));
  let vmInput: ProtectedVmOpen | undefined;
  const runtime = new ProtectedDocumentRuntime({ config, approvals, documents,
    getGuestBundle: async () => ({ directory: root, emptyDirectory: root, measurements: measurement, currentBinding: async () => measurement, dispose: async () => { disposed++; } }),
    // This is a protocol-only test. It does not establish VM isolation or a real
    // pinned-engine answer; those require the independent native VM acceptance.
    openEngine: async input => { vmInput = input; return { stop: async () => { stopped++; events?.close(); }, fetch: async request => {
      const url = new URL(request.url); calls.push({ path: url.pathname + url.search, body: await request.text() });
      if (url.pathname === "/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { events = controller; } }));
      if (url.pathname === "/_protected/checkpoint") return new Response(checkpoint, { headers: { "content-type": "application/octet-stream", "x-protected-sha256": createHash("sha256").update(checkpoint).digest("hex") } });
      if (url.pathname === "/session/status") return Response.json({});
      if (request.method === "GET" && /\/(message|children|todo)$/.test(url.pathname)) return Response.json([]);
      if (url.pathname === "/session" || url.pathname === "/session/ses_fixture") return Response.json({ id: "ses_fixture", directory: "/tmp/home/protected-engine/workspace", title: "Owned synthetic operation" });
      return new Response(null, { status: 204 });
    } }; } });
  try {
    await mkdir(join(root, "case"));
    await writeFile(join(root, "case", "selected.txt"), "SELECTED-CASE-CANARY");
    await writeFile(join(root, "foreign.txt"), "FOREIGN-CASE-CANARY");
    await symlink(join(root, "foreign.txt"), join(root, "case", "foreign-alias.txt"));
    const sources = await documents.prepare(workspace, ["case/selected.txt", "foreign.txt", "case/foreign-alias.txt"]);
    for (let i = 0; i < 200; i++) { if ((await documents.list(workspace)).every(source => source.status === "readable")) break; await Bun.sleep(10); }
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:47831/v1" }, models: { fixture: {} } } } }));
    const selected = sources[0], foreign = sources[1], foreignAlias = sources[2];
    const input = { workspaceId: workspace.id, caseDirectory: "case", providerId: "fixture", modelId: "fixture", sources: [{ id: selected.id, hash: selected.hash }] };
    for (const source of [foreign, foreignAlias]) await expect(runtime.open({ ...input, sources: [{ id: source.id, hash: source.hash }] }, AbortSignal.timeout(3000))).rejects.toMatchObject({ status: 403, code: "protected_source_denied" });
    expect(calls).toEqual([]);
    const opened = await runtime.open(input, AbortSignal.timeout(3000));
    expect(opened.session.id).toBe("ses_fixture"); expect(opened.session.directory).toBe(await realpath(join(root, "case"))); expect(opened.legalApproval).toBe(false);
    expect(opened.directoryMapping.guestDirectory).toBe("/tmp/home/protected-engine/workspace");
    const eventAbort = new AbortController(), reader = runtime.events(workspace.id, eventAbort.signal).body?.getReader();
    events?.enqueue(new TextEncoder().encode('data: {"type":"actual-protocol'));
    events?.enqueue(new TextEncoder().encode('-event"}\n\n'));
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe('data: {"type":"actual-protocol-event"}\n\n');
    const guest = "/tmp/home/protected-engine/workspace";
    const event = { directory: guest, payload: { type: "session.updated", properties: { info: { id: opened.session.id, directory: guest } } } };
    const sessionFrame = `data: ${JSON.stringify(event)}\n\n`;
    events?.enqueue(new TextEncoder().encode(sessionFrame.slice(0, 24))); events?.enqueue(new TextEncoder().encode(sessionFrame.slice(24)));
    const mapped = new TextDecoder().decode((await reader?.read())?.value);
    expect(JSON.parse(mapped.slice(6).trim())).toEqual({ ...event, directory: opened.session.directory, payload: { ...event.payload, properties: { info: { id: opened.session.id, directory: opened.session.directory } } } });
    const textFrame = `data: ${JSON.stringify({ type: "message.part.updated", properties: { part: { type: "text", sessionID: opened.session.id, text: `User text must retain ${guest}` } } })}\n\n`;
    events?.enqueue(new TextEncoder().encode(textFrame));
    expect(new TextDecoder().decode((await reader?.read())?.value)).toBe(textFrame);
    eventAbort.abort(); await reader?.cancel(); reader?.releaseLock();
    if (!vmInput) throw new Error("Protocol engine did not start");
    await expect(vmInput.handleTool({ name: "lawoss_documents_list", arguments: {}, sessionId: "foreign" }, new AbortController().signal)).rejects.toMatchObject({ code: "protected_session_missing" });
    const update = (value: unknown) => runtime.proxy({ workspaceId: workspace.id, sessionId: opened.session.id,
      request: new Request("http://host/session/ses_fixture", { method: "PATCH", body: JSON.stringify(value) }) });
    expect((await update({ time: { archived: 0 } })).status).toBe(200);
    await expect(update({ title: "arbitrary metadata" })).rejects.toMatchObject({ code: "protected_route_denied" });
    const prompt = { model: { providerID: "fixture", modelID: "fixture" }, agent: "legalwork", variant: "high", parts: [{ type: "text", text: "SYNTHETIC-PROMPT" }] };
    const proxy = (value = prompt, directory = join(root, "case")) => runtime.proxy({ workspaceId: workspace.id, sessionId: opened.session.id,
      request: new Request(`http://host/session/ses_fixture/prompt_async?directory=${encodeURIComponent(directory)}`, { method: "POST", body: JSON.stringify(value) }) });
    await expect(proxy(prompt, root)).rejects.toMatchObject({ code: "protected_source_scope" });
    await expect(proxy({ ...prompt, model: { providerID: "fixture", modelID: "foreign" } })).rejects.toMatchObject({ code: "protected_prompt_invalid" });
    expect((await proxy()).status).toBe(204);
    const attachmentFolder = join(root, ".legalwork", "attachments", "aa25dc4e-b59b-4386-9062-05cc522a0918");
    await mkdir(attachmentFolder, { recursive: true });
    const attachment = join(attachmentFolder, "selected-copy.txt");
    await writeFile(attachment, "SELECTED-CASE-CANARY");
    const queued = { kind: "prompt", ...prompt, parts: [...prompt.parts, { type: "file", mime: "text/plain", url: pathToFileURL(attachment).href, filename: "selected-copy.txt" }] };
    const beforeReadmission = await documents.evidence(workspace, selected.id);
    const [readmitted] = await documents.prepare(workspace, ["case/selected.txt"]);
    expect(readmitted.id).toBe(selected.id);
    expect(readmitted.admittedAt!).toBeGreaterThan(beforeReadmission.admittedAt!);
    expect(readmitted.updatedAt).toBe(beforeReadmission.updatedAt);
    const normalized = await runtime.preflightQueued({ workspaceId: workspace.id, sessionId: opened.session.id, execution: queued });
    expect(normalized.parts.every(part => part.type === "text")).toBe(true);
    expect(JSON.stringify(normalized)).toContain("SELECTED-CASE-CANARY");
    expect(JSON.stringify(normalized)).not.toContain("file://");
    const continued = await runtime.submitQueued({ workspaceId: workspace.id, sessionId: opened.session.id, id: "5668c42e-65e9-438b-9384-ea9940398ab5", execution: queued });
    expect(continued.status).toBe(204); await continued.arrayBuffer();
    const beforeInvalid = calls.filter(call => call.path.startsWith("/session/ses_fixture/message")).length;
    await writeFile(attachment, "NOT-SELECTED-PRIVATE-CANARY");
    await expect(runtime.submitQueued({ workspaceId: workspace.id, sessionId: opened.session.id, id: "114edff9-437d-45f1-85f0-66edab760a53", execution: queued })).rejects.toMatchObject({ code: "protected_attachment_unselected" });
    expect(calls.filter(call => call.path.startsWith("/session/ses_fixture/message")).length).toBe(beforeInvalid);
    config.readOnly = true;
    await expect(proxy()).rejects.toMatchObject({ code: "read_only" });
    config.readOnly = false;
    const submitted = calls.find(call => call.path.startsWith("/session/ses_fixture/prompt_async"));
    expect(submitted?.path).toContain(encodeURIComponent("/tmp/home/protected-engine/workspace"));
    expect(JSON.parse(submitted?.body ?? "null")).toEqual({ ...prompt, model: { providerID: "protected-documents", modelID: "fixture" } });
    const beforeRevalidation = calls.length;
    await writeFile(join(root, "same-bytes-foreign.txt"), "SELECTED-CASE-CANARY");
    await rename(join(root, "case", "selected.txt"), join(root, "case", "selected-original.txt"));
    await symlink(join(root, "same-bytes-foreign.txt"), join(root, "case", "selected.txt"));
    await expect(proxy()).rejects.toMatchObject({ status: 403, code: "protected_source_denied" });
    expect(calls).toHaveLength(beforeRevalidation);
    await rm(join(root, "case", "selected.txt"));
    await rename(join(root, "case", "selected-original.txt"), join(root, "case", "selected.txt"));
    await rename(join(root, "case"), join(root, "original-case"));
    await mkdir(join(root, "case")); await writeFile(join(root, "case", "selected.txt"), "SELECTED-CASE-CANARY");
    await expect(proxy()).rejects.toMatchObject({ status: 409, code: "protected_source_stale" });
    expect(calls).toHaveLength(beforeRevalidation);
    await rm(join(root, "case"), { recursive: true }); await rename(join(root, "original-case"), join(root, "case"));
    await expect(vmInput.handleTool({ name: "lawoss_documents_export", sessionId: opened.session.id, arguments: { path: "foreign-output.md", kind: "summary", outputLanguage: "cs", documentIds: [selected.id], entries: [{ documentId: selected.id, summary: "Selected-case summary" }] } }, new AbortController().signal)).rejects.toMatchObject({ status: 403, code: "protected_output_denied" });
    await expect(readFile(join(root, "foreign-output.md"))).rejects.toMatchObject({ code: "ENOENT" });
    await writeFile(join(root, "case", "selected.txt"), "CHANGED-AFTER-APPROVAL");
    await expect(proxy()).rejects.toBeDefined();
    await runtime.close(); expect(stopped).toBe(1); expect(disposed).toBe(1);
    await writeFile(join(root, "case", "selected.txt"), "SELECTED-CASE-CANARY");
    const history = new ProtectedDocumentRuntime({ config, approvals, documents, getGuestBundle: async () => { throw new Error("Read-only captured history must not start a VM"); } });
    const callsBeforeHistory = calls.length;
    try {
      await history.initialize(); expect(history.ownsSession(workspace.id, opened.session.id)).toBe(true);
      const restored = await history.proxy({ workspaceId: workspace.id, sessionId: opened.session.id, request: new Request(`http://host/session/${opened.session.id}?directory=${encodeURIComponent(root)}`, { headers: { "x-opencode-directory": encodeURIComponent(join(root, "case")) } }) });
      expect(await restored.json()).toMatchObject({ id: opened.session.id, directory: await realpath(join(root, "case")), title: "Owned synthetic operation" });
      const mapping = await history.proxy({ workspaceId: workspace.id, sessionId: opened.session.id, request: new Request(`http://host/session/${opened.session.id}/protected-transport`) });
      expect(await mapping.json()).toMatchObject({ transport: "protected-documents-v1", directoryMapping: { guestDirectory: guest, hostDirectory: await realpath(join(root, "case")) } });
      expect(calls.length).toBe(callsBeforeHistory);
    } finally { await history.close(); }
  } finally {
    await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop();
    await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true });
  }
});
