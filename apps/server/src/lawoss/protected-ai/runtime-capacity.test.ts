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
import { ProtectedDocumentRuntime } from "./runtime.js";
import type { ProtectedVmOpen } from "./vm-engine.js";

test.each(["session", "message"])("a third operation drains the held %s body naturally before idle eviction without disturbing busy workers", async readKind => {
  const { config, root } = await syntheticHostConfig();
  const workspace = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const }; config.workspaces = [workspace];
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => "allow");
  const measurements = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
  const database = new Database(join(root, "protocol-only.sqlite")); database.exec("CREATE TABLE protocol_fixture(id TEXT)"); database.close();
  const checkpoint = await readFile(join(root, "protocol-only.sqlite"));
  let starts = 0, active = 0, maximum = 0;
  const busy = new Set<string>(), stopped: string[] = [], captured: string[] = [], aborted: string[] = [];
  const eventControllers = new Map<string, ReadableStreamDefaultController<Uint8Array>>();
  const guests = new Map<string, ProtectedVmOpen>();
  let heldPath = "", releaseRead: () => void = () => {}, readStarted: () => void = () => {}, readAborted = false;
  const reading = new Promise<void>(resolve => { readStarted = resolve; });
  const runtime = new ProtectedDocumentRuntime({ config, approvals, documents,
    getGuestBundle: async () => ({ directory: root, emptyDirectory: root, measurements, currentBinding: async () => measurements }),
    // A protocol-only worker measures host capacity; native VM memory is a separate acceptance gate.
    openEngine: async input => {
      const id = `ses_capacity_${++starts}`; active++; maximum = Math.max(maximum, active);
      guests.set(id, input);
      let events: ReadableStreamDefaultController<Uint8Array> | undefined;
      return { stop: async () => { stopped.push(id); active--; events?.close(); }, fetch: async request => {
        const path = new URL(request.url).pathname;
        if (request.method === "GET" && path === heldPath) {
          const json = JSON.stringify(readKind === "message" ? [] : { id, directory: "/tmp/home/protected-engine/workspace", title: `Actual ${id}` });
          return new Response(new ReadableStream<Uint8Array>({ start(controller) {
            let done = false;
            const abort = () => { if (!done) { done = true; readAborted = true; controller.error(request.signal.reason); } };
            request.signal.addEventListener("abort", abort, { once: true });
            releaseRead = () => { if (!done) { done = true; request.signal.removeEventListener("abort", abort); controller.enqueue(new TextEncoder().encode(json.slice(1))); controller.close(); } heldPath = ""; };
            controller.enqueue(new TextEncoder().encode(json.slice(0, 1))); readStarted();
            if (request.signal.aborted) abort();
          } }), { headers: { "content-type": "application/json" } });
        }
        if (path === "/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { events = controller; eventControllers.set(id, controller); } }));
        if (path === "/session/status") return Response.json(busy.has(id) ? { [id]: { type: "busy" } } : {});
        if (path === "/_protected/checkpoint") { captured.push(id); return new Response(checkpoint, { headers: { "x-protected-sha256": createHash("sha256").update(checkpoint).digest("hex") } }); }
        if (request.method === "GET" && /\/(message|children|todo)$/.test(path)) return Response.json([]);
        if (path.endsWith("/abort")) { aborted.push(id); return Response.json(true); }
        return Response.json({ id, directory: "/tmp/home/protected-engine/workspace", title: `Actual ${id}` });
      } };
    } });
  try {
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:47831/v1" }, models: { fixture: {} } } } }));
    await writeFile(join(root, "selected.txt"), "SYNTHETIC-CAPACITY-SOURCE"); const [source] = await documents.prepare(workspace, ["selected.txt"]);
    for (let i = 0; i < 200; i++) { if ((await documents.list(workspace))[0]?.status === "readable") break; await Bun.sleep(10); }
    const input = { workspaceId: workspace.id, providerId: "fixture", modelId: "fixture", sources: [{ id: source.id, hash: source.hash }] };
    const first = await runtime.open(input, AbortSignal.timeout(3000)), second = await runtime.open(input, AbortSignal.timeout(3000));
    for (const session of [first.session, second.session]) {
      const response = await runtime.proxy({ workspaceId: workspace.id, sessionId: session.id, request: new Request(`http://host/session/${session.id}/prompt_async`, {
        method: "POST", body: JSON.stringify({ model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Selected synthetic evidence only" }] }),
      }) });
      expect(response.ok).toBe(true); await response.body?.cancel();
    }
    busy.add(first.session.id); busy.add(second.session.id);
    await expect(runtime.open(input, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_runtime_capacity" });
    expect(starts).toBe(2); expect(stopped).toEqual([]); expect(aborted).toEqual([]);
    busy.delete(first.session.id);
    // A transient idle status alone cannot overtake the accepted prompt. Only
    // the owned engine's terminal event releases this host-side busy latch.
    await expect(runtime.open(input, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_runtime_capacity" });
    busy.add(first.session.id);
    const observing = new AbortController(), reader = runtime.events(workspace.id, observing.signal).body!.getReader();
    try {
      eventControllers.get(first.session.id)!.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ directory: "/tmp/home/protected-engine/workspace", payload: { type: "session.idle", properties: { sessionID: first.session.id } } })}\n\n`));
      const observed = await reader.read();
      expect(new TextDecoder().decode(observed.value)).toContain(first.session.id);
    } finally { observing.abort(); await reader.cancel(); reader.releaseLock(); }
    // A delayed terminal event cannot override the fresh engine status.
    await expect(runtime.open(input, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_runtime_capacity" });
    expect(stopped).toEqual([]); expect(aborted).toEqual([]);
    busy.delete(first.session.id);
    heldPath = `/session/${first.session.id}${readKind === "message" ? "/message" : ""}`;
    const read = runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host${heldPath}`) }).then(response => response.json());
    void read.catch(() => {});
    await reading;
    const waitForFrozen = (probe: Promise<unknown>) => {
      let done = false;
      const settled = probe.then(() => { done = true; return false; }, () => { done = true; return false; });
      const frozen = (async () => {
        const deadline = Date.now() + 1000;
        while (!done && Date.now() < deadline) {
          try { const response = await runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host/session/${first.session.id}/protected-transport`) }); await response.body?.cancel(); }
          catch (error) { if (error && typeof error === "object" && "code" in error && error.code === "protected_session_busy") return true; }
          await Bun.sleep(1);
        }
        return false;
      })();
      return Promise.race([frozen, settled]);
    };
    const cancellation = new AbortController(), cancelledProbe = runtime.open(input, cancellation.signal);
    expect(await waitForFrozen(cancelledProbe)).toBe(true);
    const cancelled = new Error("Cancel only the new capacity request"); cancellation.abort(cancelled);
    await expect(cancelledProbe).rejects.toBe(cancelled);
    const resumed = await runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host/session/${first.session.id}/protected-transport`) });
    expect(resumed.ok).toBe(true); await resumed.body?.cancel();
    expect(readAborted).toBe(false);
    const probing = runtime.open(input, AbortSignal.timeout(3000));
    expect(await waitForFrozen(probing)).toBe(true);
    expect(readAborted).toBe(false); expect(starts).toBe(2); expect(captured).toEqual([]); expect(stopped).toEqual([]); expect(aborted).toEqual([]);
    await expect(runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host/session/${first.session.id}/prompt_async`, { method: "POST", body: "{}" }) })).rejects.toMatchObject({ code: "protected_session_busy" });
    // A capacity probe never denies an already owned guest callback. New
    // activity invalidates that attempt instead of manufacturing idle capacity.
    expect(await guests.get(first.session.id)!.handleTool({ name: "lawoss_documents_list", arguments: {}, sessionId: first.session.id }, new AbortController().signal)).toHaveProperty("documents");
    releaseRead();
    expect(await read).toEqual(readKind === "message" ? [] : { id: first.session.id, directory: first.session.directory, title: `Actual ${first.session.id}` });
    await expect(probing).rejects.toMatchObject({ code: "protected_runtime_capacity" });
    expect(readAborted).toBe(false); expect(stopped).toEqual([]); expect(aborted).toEqual([]);
    const third = await runtime.open(input, AbortSignal.timeout(3000));
    expect(third.session.id).toBe("ses_capacity_3"); expect(maximum).toBe(2); expect(active).toBe(2);
    expect(stopped).toEqual([first.session.id]); expect(captured).toEqual([first.session.id]); expect(aborted).toEqual([first.session.id]);
    const historical = await runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host/session/${first.session.id}`) });
    expect(await historical.json()).toMatchObject({ id: first.session.id, title: `Actual ${first.session.id}` });
    expect(starts).toBe(3);
  } finally { releaseRead(); busy.clear(); await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true }); }
});
