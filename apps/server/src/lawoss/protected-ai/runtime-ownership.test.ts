import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalService } from "../../approvals.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import { LawossDocuments } from "../documents/service.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { protectedRuntimeForSession, protectedSessionResponse, registerProtectedRuntime } from "./dispatch.js";
import { ProtectedDocumentRuntime } from "./runtime.js";

test("two listener runtimes route to the live owner, recover the newest checkpoint and never restore the same session twice", async () => {
  const { config, root } = await syntheticHostConfig();
  const workspace = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const }; config.workspaces = [workspace];
  const database = new Database(join(root, "protocol-only.sqlite")); database.exec("CREATE TABLE protocol_fixture(id TEXT)"); database.close();
  const checkpoint = await readFile(join(root, "protocol-only.sqlite"));
  const measurements = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
  let title = "First actual captured title", starts = 0, approvalsHeld = false, checkpointHeld = true, failStopping = false;
  let captured!: () => void, finishCheckpoint!: () => void;
  const capturing = new Promise<void>(resolve => { captured = resolve; });
  const checkpointGate = new Promise<void>(resolve => { finishCheckpoint = resolve; });
  let approve!: () => void, reviewing!: () => void;
  const review = new Promise<void>(resolve => { reviewing = resolve; });
  const releaseApproval = new Promise<void>(resolve => { approve = resolve; });
  const listeners: Array<{ runtime: ProtectedDocumentRuntime; dispose: () => Promise<void> }> = [];
  const makeListener = () => {
    const ocr = new OcrManager(join(root, `ocr-${listeners.length}`)), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
    const approvals = new ApprovalService({ mode: "auto", timeoutMs: 3000 }, async () => { if (approvalsHeld) { reviewing(); await releaseApproval; } return "allow"; });
    let events: ReadableStreamDefaultController<Uint8Array> | undefined;
    const runtime = new ProtectedDocumentRuntime({ config, approvals, documents,
      getGuestBundle: async input => { if (input.checkpoint) expect(await readFile(input.checkpoint.path)).toEqual(checkpoint); return { directory: root, emptyDirectory: root, measurements, currentBinding: async () => measurements }; },
      // Protocol-only seam: this checks host ownership, not native VM isolation.
      openEngine: async () => { starts++; return { stop: async () => { events?.close(); if (failStopping) throw new Error("Protocol worker shutdown failed"); }, fetch: async request => {
        const path = new URL(request.url).pathname;
        if (path === "/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { events = controller; } }));
        if (path === "/_protected/checkpoint") { if (checkpointHeld) { captured(); await checkpointGate; } return new Response(checkpoint, { headers: { "x-protected-sha256": createHash("sha256").update(checkpoint).digest("hex") } }); }
        if (path === "/session/status") return Response.json({});
        if (request.method === "GET" && /\/(message|children|todo)$/.test(path)) return Response.json([]);
        if (path === "/session" || path === "/session/ses_shared") return Response.json({ id: "ses_shared", directory: "/tmp/home/protected-engine/workspace", title });
        return new Response(null, { status: 204 });
      } }; } });
    const unregister = registerProtectedRuntime(config, runtime);
    const listener = { runtime, dispose: async () => { try { await runtime.close(); } finally { unregister(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); } } };
    listeners.push(listener); return { ...listener, documents };
  };
  try {
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:47831/v1" }, models: { fixture: {} } } } }));
    const first = makeListener(), standby = makeListener();
    await standby.runtime.initialize(); // Listener B predates A's new actual session.
    await writeFile(join(root, "selected.txt"), "SYNTHETIC-SELECTED-ORIGINAL");
    const [source] = await first.documents.prepare(workspace, ["selected.txt"]);
    for (let i = 0; i < 200; i++) { if ((await first.documents.list(workspace))[0]?.status === "readable") break; await Bun.sleep(10); }
    await first.runtime.open({ workspaceId: workspace.id, providerId: "fixture", modelId: "fixture", sources: [{ id: source.id, hash: source.hash }] }, AbortSignal.timeout(3000));
    expect(protectedRuntimeForSession(config, workspace.id, "ses_shared")).toBe(first.runtime);
    title = "Newest actual engine title before first listener stops";
    const execution = { kind: "prompt", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Continue the selected source only" }] };
    const stopping = first.dispose(); await capturing;
    expect(protectedRuntimeForSession(config, workspace.id, "ses_shared")).toBe(first.runtime);
    await expect(standby.runtime.preflightQueued({ workspaceId: workspace.id, sessionId: "ses_shared", execution })).rejects.toMatchObject({ code: "protected_session_busy" });
    checkpointHeld = false; finishCheckpoint(); await stopping;
    const historical = await protectedSessionResponse(config, workspace.id, new Request("http://host/session/ses_shared"));
    expect(historical).not.toBeNull();
    expect(await historical!.json()).toMatchObject({ id: "ses_shared", title });
    expect(starts).toBe(1);
    const third = makeListener(); await third.runtime.initialize();
    approvalsHeld = true;
    const restoring = third.runtime.preflightQueued({ workspaceId: workspace.id, sessionId: "ses_shared", execution });
    await review;
    expect(protectedRuntimeForSession(config, workspace.id, "ses_shared")).toBe(third.runtime);
    await expect(standby.runtime.preflightQueued({ workspaceId: workspace.id, sessionId: "ses_shared", execution })).rejects.toMatchObject({ code: "protected_session_busy" });
    expect(starts).toBe(1);
    approve(); await restoring;
    expect(starts).toBe(2);
    // An older historical listener must never override an actual active owner.
    expect(protectedRuntimeForSession(config, workspace.id, "ses_shared")).toBe(third.runtime);
    title = "Newest actual title after the restored worker stops";
    await third.dispose();
    expect(await (await standby.runtime.proxy({ workspaceId: workspace.id, sessionId: "ses_shared", request: new Request("http://host/session/ses_shared") })).json()).toMatchObject({ title });
    await standby.runtime.preflightQueued({ workspaceId: workspace.id, sessionId: "ses_shared", execution });
    expect(starts).toBe(3);
    failStopping = true;
    await expect(standby.runtime.close()).rejects.toThrow("Protocol worker shutdown failed");
    // Even after unregistering a failed listener, its failed teardown remains
    // the owner; an older checkpoint must not authorize another live worker.
    await expect(standby.dispose()).rejects.toThrow("Protocol worker shutdown failed");
    const fourth = makeListener(); await fourth.runtime.initialize();
    expect(protectedRuntimeForSession(config, workspace.id, "ses_shared")).toBe(standby.runtime);
    await expect(fourth.runtime.preflightQueued({ workspaceId: workspace.id, sessionId: "ses_shared", execution })).rejects.toMatchObject({ code: "protected_session_busy" });
    expect(starts).toBe(3);
  } finally {
    finishCheckpoint(); approve(); await Promise.allSettled(listeners.map(listener => listener.dispose()));
    await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true });
  }
});
