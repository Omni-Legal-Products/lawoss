import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { ApprovalService } from "../../approvals.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import { LawossDocuments } from "../documents/service.js";
import { syntheticHostConfig } from "../test-support/host-config.js";
import { ProtectedDocumentRuntime } from "./runtime.js";
import { protectedEngineFetch, registerProtectedRuntime } from "./dispatch.js";

test("a completed native engine event stream ends the multiplexed SDK connection instead of waiting for an empty protected source", async () => {
  const {root, config} = await syntheticHostConfig();
  const approvals = new ApprovalService(config.approval);
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr);
  const documents = new LawossDocuments(config, preparation);
  const runtime = new ProtectedDocumentRuntime({config, approvals, documents, getGuestBundle: async () => {throw new Error("No worker is requested by event subscription");}});
  const release = registerProtectedRuntime(config, runtime);
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response('data: {"type":"ORIGINAL-NATIVE-EVENT"}\n\n', {headers: {"content-type": "text/event-stream"}})});
  try {
    const signal = AbortSignal.timeout(2000);
    const response = await protectedEngineFetch(config, "synthetic", fetch)(new Request(receiver.url.origin + "/event", {signal}));
    const reader = response.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toContain("ORIGINAL-NATIVE-EVENT");
    expect((await reader.read()).done).toBe(true);
    expect(signal.aborted).toBe(false);
  } finally {release(); await runtime.close(); receiver.stop(true); await documents.stop(); preparation.stop(); ocr.stop(); approvals.dispose(); await rm(root, {recursive: true});}
});
