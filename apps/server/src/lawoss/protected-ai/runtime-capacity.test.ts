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

test("a third protected operation checkpoints an actual idle worker while busy workers remain untouched and history keeps its real ID", async () => {
  const { config, root } = await syntheticHostConfig();
  const workspace = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const }; config.workspaces = [workspace];
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  const approvals = new ApprovalService({ mode: "auto", timeoutMs: 1000 }, async () => "allow");
  const measurements = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
  const database = new Database(join(root, "protocol-only.sqlite")); database.exec("CREATE TABLE protocol_fixture(id TEXT)"); database.close();
  const checkpoint = await readFile(join(root, "protocol-only.sqlite"));
  let starts = 0, active = 0, maximum = 0;
  const busy = new Set<string>(), stopped: string[] = [], captured: string[] = [], aborted: string[] = [];
  const runtime = new ProtectedDocumentRuntime({ config, approvals, documents,
    getGuestBundle: async () => ({ directory: root, emptyDirectory: root, measurements, currentBinding: async () => measurements }),
    // A protocol-only worker measures host capacity; native VM memory is a separate acceptance gate.
    openEngine: async () => {
      const id = `ses_capacity_${++starts}`; active++; maximum = Math.max(maximum, active);
      let events: ReadableStreamDefaultController<Uint8Array> | undefined;
      return { stop: async () => { stopped.push(id); active--; events?.close(); }, fetch: async request => {
        const path = new URL(request.url).pathname;
        if (path === "/event") return new Response(new ReadableStream<Uint8Array>({ start(controller) { events = controller; } }));
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
    busy.add(first.session.id); busy.add(second.session.id);
    await expect(runtime.open(input, AbortSignal.timeout(3000))).rejects.toMatchObject({ code: "protected_runtime_capacity" });
    expect(starts).toBe(2); expect(stopped).toEqual([]); expect(aborted).toEqual([]);
    busy.delete(first.session.id);
    const third = await runtime.open(input, AbortSignal.timeout(3000));
    expect(third.session.id).toBe("ses_capacity_3"); expect(maximum).toBe(2); expect(active).toBe(2);
    expect(stopped).toEqual([first.session.id]); expect(captured).toEqual([first.session.id]); expect(aborted).toEqual([first.session.id]);
    const historical = await runtime.proxy({ workspaceId: workspace.id, sessionId: first.session.id, request: new Request(`http://host/session/${first.session.id}`) });
    expect(await historical.json()).toMatchObject({ id: first.session.id, title: `Actual ${first.session.id}` });
    expect(starts).toBe(3);
  } finally { busy.clear(); await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); await closeOrgPolicyRuntime(config); await rm(root, { recursive: true, force: true }); }
});
