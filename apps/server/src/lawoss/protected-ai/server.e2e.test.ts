import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { startServer } from "../../server.js";
import { TokenService } from "../../tokens.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { syntheticHostConfig } from "../test-support/host-config.js";

test("the installed generation endpoint requires the native host and rejects browser supplied approval or foreign workspace authority", async () => {
  const {root, config} = await syntheticHostConfig();
  const server = await startServer(config);
  try {
    const owner = await new TokenService(config).create("owner");
    const endpoint = `http://127.0.0.1:${server.port}/workspace/synthetic/lawoss/documents/generation`;
    const request = (headers: Record<string, string>, body: unknown) => fetch(endpoint, {method: "POST", headers: {"content-type": "application/json", ...headers}, body: JSON.stringify(body)});
    const withoutHost = await request({authorization: `Bearer ${owner.token}`}, {approved: true});
    expect(withoutHost.status).toBe(401);
    const forged = await request({"x-legalwork-host-token": config.hostToken!}, {workspaceId: "foreign", approved: true, syntheticPilot: true});
    expect(forged.status).toBe(400);
    expect(await forged.json()).toMatchObject({code: "protected_generation_input"});
  } finally {await server.stop(); await closeOrgPolicyRuntime(config); await rm(root, {recursive: true});}
});

test("HTTP queue admission routes only an owned protected chat through the document runtime", async () => {
  const {mkdir, writeFile} = await import("node:fs/promises");
  const {join} = await import("node:path");
  const {ApprovalService} = await import("../../approvals.js");
  const {OcrManager} = await import("../../ocr/manager.js");
  const {DocumentPreparation} = await import("../../document-preparation/service.js");
  const {LawossDocuments} = await import("../documents/service.js");
  const {ProtectedDocumentRuntime} = await import("./runtime.js");
  const {registerProtectedRuntime} = await import("./dispatch.js");
  const {GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig} = await import("../../runtime-opencode-config-store.js");
  const {root, config} = await syntheticHostConfig();
  const workspace = {id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const}; config.workspaces = [workspace]; config.opencodeBaseUrl = "http://127.0.0.1:1";
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  const approvals = new ApprovalService(config.approval, async () => "allow");
  const measurement = {engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64)};
  const messages: unknown[] = [];
  let receipt: "valid" | "foreign-parent" | "nonterminal" = "valid";
  const {Database} = await import("bun:sqlite");
  const {readFile} = await import("node:fs/promises");
  const dbPath = join(root, "protocol-fixture.sqlite"), db = new Database(dbPath, {create: true});
  db.exec("CREATE TABLE protocol_only(value TEXT)"); db.close();
  const checkpointBytes = await readFile(dbPath);
  const {createHash} = await import("node:crypto");
  const checkpointHash = createHash("sha256").update(checkpointBytes).digest("hex");
  let eventController: ReadableStreamDefaultController<Uint8Array> | undefined;
  // Protocol-only constructor seam: proves real HTTP/queue routing, not VM safety.
  const runtime = new ProtectedDocumentRuntime({config, approvals, documents, getGuestBundle: async () => ({directory: root, emptyDirectory: root, measurements: measurement, currentBinding: async () => measurement}),
    openEngine: async () => ({stop: async () => {eventController?.close();}, fetch: async request => {
      const path = new URL(request.url).pathname;
      if (path === "/_protected/checkpoint") return new Response(checkpointBytes, {headers: {"x-protected-sha256": checkpointHash}});
      if (request.method === "GET" && ["/session/ses_protected_queue/message", "/session/ses_protected_queue/children", "/session/ses_protected_queue/todo"].includes(path)) return Response.json([]);
      if (path === "/event") return new Response(new ReadableStream({start(controller) {eventController = controller;}}));
      if (path === "/session/status") return Response.json({});
      if (path === "/session" || path === "/session/ses_protected_queue") return Response.json({id: "ses_protected_queue", directory: "/tmp/home/protected-engine/workspace", title: "Synthetic", time: {created: 1, updated: 1}});
      if (path === "/session/ses_protected_queue/message" && request.method === "POST") {const sent = await request.json() as {messageID: string}; messages.push(sent); return Response.json({info: {id: "msg_actual", role: "assistant", sessionID: "ses_protected_queue", parentID: receipt === "foreign-parent" ? "msg_foreign" : sent.messageID, ...(receipt !== "nonterminal" ? {finish: "stop", time: {created: 1, completed: 2}} : {})}, parts: [{type: "text", text: "ACTUAL-PROTOCOL-RESPONSE"}]});}
      return new Response(null, {status: 204});
    }})});
  const release = registerProtectedRuntime(config, runtime);
  const server = await startServer(config);
  try {
    await mkdir(join(root, "case")); await writeFile(join(root, "case", "selected.txt"), "SYNTHETIC-QUEUE-SOURCE");
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL: "http://127.0.0.1:47831/v1"}, models: {fixture: {}}}}}));
    const [source] = await documents.prepare(workspace, ["case/selected.txt"]);
    for (let i = 0; i < 200; i++) {if ((await documents.list(workspace))[0]?.status === "readable") break; await Bun.sleep(10);}
    await runtime.open({workspaceId: workspace.id, caseDirectory: "case", providerId: "fixture", modelId: "fixture", sources: [{id: source.id, hash: source.hash}]}, AbortSignal.timeout(3000));
    const endpoint = `http://127.0.0.1:${server.port}/workspace/synthetic/sessions/ses_protected_queue/queue`;
    const execution = {kind: "prompt", model: {providerID: "fixture", modelID: "fixture"}, agent: "legalwork", variant: "high", parts: [{type: "text", text: "SYNTHETIC-QUEUED-PROMPT"}]};
    const payload = {type: "enqueue", id: "114edff9-437d-45f1-85f0-66edab760a53", execution,
      draft: {mode: "prompt", text: "SYNTHETIC-QUEUED-PROMPT", parts: [], attachments: [], editor: {mentions: {}, pasteParts: []}}};
    const response = await fetch(endpoint, {method: "POST", headers: {"x-legalwork-host-token": config.hostToken!, "content-type": "application/json"}, body: JSON.stringify(payload)});
    expect({status: response.status, body: await response.json()}).toMatchObject({status: 200});
    for (let i = 0; i < 200 && !messages.length; i++) await Bun.sleep(10);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({messageID: "msg_114edff9437d45f185f066edab760a53", parts: execution.parts});
    const shell = await fetch(endpoint, {method: "POST", headers: {"x-legalwork-host-token": config.hostToken!, "content-type": "application/json"}, body: JSON.stringify({...payload, id: "94b4490a-a836-4b5a-8888-7a96d2f05fab", execution: {kind: "shell", command: "pwd"}})});
    expect(shell.status).toBe(403);
    expect(await shell.json()).toMatchObject({code: "protected_prompt_invalid"});
    expect(messages).toHaveLength(1);
    const headers = {"x-legalwork-host-token": config.hostToken!, "content-type": "application/json"};
    let queue: {revision?: number; completedIds: string[]; entries: Array<{id: string; status: string}>} = {completedIds: [], entries: []};
    for (let i = 0; i < 200; i++) {queue = await (await fetch(endpoint, {headers})).json(); if (queue.completedIds.includes(payload.id)) break; await Bun.sleep(10);}
    expect(queue.completedIds).toContain(payload.id);
    receipt = "foreign-parent";
    const foreignId = "9aa472c0-1d12-44aa-a778-c0d75946225e";
    expect((await fetch(endpoint, {method: "POST", headers, body: JSON.stringify({...payload, id: foreignId})})).status).toBe(200);
    for (let i = 0; i < 200; i++) {queue = await (await fetch(endpoint, {headers})).json(); if (queue.completedIds.includes(foreignId) || queue.entries.some(item => item.status === "uncertain")) break; await Bun.sleep(10);}
    expect(queue.completedIds).not.toContain(foreignId);
    expect(queue.entries).toContainEqual(expect.objectContaining({id: foreignId, status: "uncertain"}));
    expect((await fetch(endpoint, {method: "POST", headers, body: JSON.stringify({type: "remove", id: foreignId, revision: queue.revision})})).status).toBe(200);
    expect((await fetch(endpoint, {method: "POST", headers, body: JSON.stringify({type: "pause", paused: false})})).status).toBe(200);
    receipt = "nonterminal";
    const pendingId = "7482d498-f745-4107-a91a-a5dbd239f53f";
    expect((await fetch(endpoint, {method: "POST", headers, body: JSON.stringify({...payload, id: pendingId})})).status).toBe(200);
    for (let i = 0; i < 200; i++) {queue = await (await fetch(endpoint, {headers})).json(); if (queue.completedIds.includes(pendingId) || queue.entries.some(item => item.status === "uncertain")) break; await Bun.sleep(10);}
    expect(queue.completedIds).not.toContain(pendingId);
    expect(queue.entries).toContainEqual(expect.objectContaining({id: pendingId, status: "uncertain"}));
  } finally {await server.stop(); release(); await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); await closeOrgPolicyRuntime(config); await rm(root, {recursive: true});}
});

test("a corrupt protected history blocks protected execution while the local application remains available", async () => {
  const {mkdir, writeFile} = await import("node:fs/promises");
  const {join} = await import("node:path");
  const {runtimeStorageDir} = await import("../../runtime-opencode-config-store.js");
  const {root, config} = await syntheticHostConfig();
  const directory = join(runtimeStorageDir(config), "protected-document-sessions");
  await mkdir(directory, {recursive: true}); await writeFile(join(directory, "a".repeat(64) + ".json"), "{}");
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}`;
    expect((await fetch(base + "/health")).status).toBe(200);
    const response = await fetch(base + "/workspace/synthetic/lawoss/documents/generation", {method: "POST", headers: {"x-legalwork-host-token": config.hostToken!, "content-type": "application/json"}, body: JSON.stringify({sources: [{id: "2e83fca8-8e9c-45ad-8d8e-9ec48aca67a7", hash: "a".repeat(64)}], providerId: "fixture", modelId: "fixture"})});
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({code: "protected_history_invalid"});
  } finally {await server?.stop(); await closeOrgPolicyRuntime(config); await rm(root, {recursive: true});}
});
