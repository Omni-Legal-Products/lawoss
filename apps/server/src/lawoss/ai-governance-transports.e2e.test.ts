import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { OcrManager } from "../ocr/manager.js";
import { closeOrgPolicyRuntime } from "../org-policy.js";
import { saveSystemOneProvider, selectSystemOneProvider, systemOne } from "../systemone.js";
import { requireUnsupportedProtectedTransport } from "./ai-governance-engine.js";
import { syntheticHostConfig } from "./test-support/host-config.js";

test("configured SystemOne and loopback OCR cannot treat URL, credentials or a ready model as protected approval", async () => {
  const {root, config} = await syntheticHostConfig();
  const received: string[] = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push(await request.text());
    return Response.json({choices: [{message: {content: "synthetic"}, finish_reason: "stop"}]});
  }});
  const ocr = new OcrManager(join(root, "ocr"), undefined, {state: "unsupported", request: async () => requireUnsupportedProtectedTransport(config, "ocr")});
  try {
    await fetch(receiver.url, {method: "POST", body: "PUBLIC-SYNTHETIC-PROBE"});
    expect(received).toEqual(["PUBLIC-SYNTHETIC-PROBE"]); received.length = 0;
    await saveSystemOneProvider(config, {id: "fixture", name: "Synthetic", endpoint: receiver.url.origin + "/infer", apiKey: "synthetic-only", enabled: true,
      models: [{id: "fixture", name: "Synthetic", questionTypes: ["noul"]}]});
    await selectSystemOneProvider(config, {providerId: "fixture", model: "fixture"});
    received.length = 0; // Explicit catalog preflight contains no protected state.
    await expect(systemOne(config, {model: "fixture", state: "PROTECTED-SYSTEMONE-CANARY", questions: {synthetic: {type: "noul", instructions: "Synthetic"}}}))
      .rejects.toMatchObject({status: 403, code: "ai_transfer_denied"});
    const id = await ocr.saveServer({label: "Synthetic loopback", endpoint: receiver.url.origin + "/ocr", model: "fixture", languages: ["en"], authentication: "none"});
    const service = await ocr.service();
    await expect(service.extract({sourceId: "synthetic-source", engineId: id, languages: ["en"], pages: [{pageNumber: 1, width: 1, height: 1, mimeType: "image/png", data: new TextEncoder().encode("PROTECTED-OCR-CANARY")}]}))
      .rejects.toMatchObject({code: "server-failed"});
    expect((await ocr.view()).engines.find(engine => engine.id === id)?.status).toBe("unsupported");
    expect(received).toEqual([]);
  } finally {
    try {ocr.stop(); await closeOrgPolicyRuntime(config); receiver.stop(true);} finally {await rm(root, {recursive: true});}
  }
});
