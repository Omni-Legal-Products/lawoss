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

test.each([false, true])("HTTP admits a verified historical queue intent before native review and cold restore finish (upload changes before delivery: %s)", async uploadChanges => {
  const {mkdir, readFile, readdir, rename, writeFile} = await import("node:fs/promises");
  const {join} = await import("node:path");
  const {pathToFileURL} = await import("node:url");
  const {createHash} = await import("node:crypto");
  const {Database} = await import("bun:sqlite");
  const {ApprovalService} = await import("../../approvals.js");
  const {OcrManager} = await import("../../ocr/manager.js");
  const {DocumentPreparation} = await import("../../document-preparation/service.js");
  const {LawossDocuments} = await import("../documents/service.js");
  const {ProtectedDocumentRuntime} = await import("./runtime.js");
  const {registerProtectedRuntime} = await import("./dispatch.js");
  const {GLOBAL_PROVIDERS_ID, runtimeStorageDir, writeRuntimeOpencodeConfig} = await import("../../runtime-opencode-config-store.js");
  const {compareAndSetGovernanceProfile} = await import("../ai-governance-store.js");
  const {protectedAiTarget} = await import("./transport.js");
  const {root, config} = await syntheticHostConfig();
  const workspace = {id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" as const};
  config.workspaces = [workspace]; config.opencodeBaseUrl = "http://127.0.0.1:1";
  const ocr = new OcrManager(join(root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
  let holdReview = false, allowedReviews = 0, opens = 0, sent = 0;
  let allowReview = () => {}, releaseEngine = () => {}, releaseMessage = () => {}, reviewEntered = () => {}, engineEntered = () => {}, messageEntered = () => {};
  const reviewGate = new Promise<void>(resolve => {allowReview = resolve;});
  const engineGate = new Promise<void>(resolve => {releaseEngine = resolve;});
  const reviewing = new Promise<void>(resolve => {reviewEntered = resolve;});
  const restoring = new Promise<void>(resolve => {engineEntered = resolve;});
  const messageGate = new Promise<void>(resolve => {releaseMessage = resolve;});
  const messaging = new Promise<void>(resolve => {messageEntered = resolve;});
  const approvals = new ApprovalService(config.approval, async () => {if (holdReview) {reviewEntered(); await reviewGate;} allowedReviews++; return "allow";});
  const measurement = {engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64)};
  const dbPath = join(root, "owned-checkpoint.sqlite"), db = new Database(dbPath, {create: true});
  db.exec("CREATE TABLE protocol_fixture(value TEXT)"); db.close();
  const checkpoint = await readFile(dbPath), checkpointHash = createHash("sha256").update(checkpoint).digest("hex");
  const sessionId = "ses_historical_queue";
  // Real HTTP/store/lifecycle, constructor-controlled engine protocol only.
  const makeRuntime = () => new ProtectedDocumentRuntime({config, approvals, documents,
    getGuestBundle: async () => ({directory: root, emptyDirectory: root, measurements: measurement, currentBinding: async () => measurement}),
    openEngine: async () => {
      opens++;
      if (opens > 1) {engineEntered(); await engineGate;}
      let events: ReadableStreamDefaultController<Uint8Array> | undefined;
      return {stop: async () => {events?.close();}, fetch: async request => {
        const path = new URL(request.url).pathname;
        if (path === "/event") return new Response(new ReadableStream<Uint8Array>({start(controller) {events = controller;}}));
        if (path === "/_protected/checkpoint") return new Response(checkpoint, {headers: {"x-protected-sha256": checkpointHash}});
        if (path === "/session/status") return Response.json({});
        if (request.method === "GET" && /\/(message|children|todo)$/.test(path)) return Response.json([]);
        if (request.method === "POST" && path.endsWith("/message")) {
          const payload = await request.json() as {messageID: string}; sent++; messageEntered(); await messageGate;
          return Response.json({info: {id: "msg_terminal", role: "assistant", sessionID: sessionId, parentID: payload.messageID, finish: "stop", time: {created: 1, completed: 2}}, parts: []});
        }
        return Response.json({id: sessionId, directory: "/tmp/home/protected-engine/workspace", title: "Retained actual identity"});
      }};
    }});
  let runtime = makeRuntime(), release = registerProtectedRuntime(config, runtime);
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let pending: Promise<Response> | undefined;
  try {
    await mkdir(join(root, "case")); await writeFile(join(root, "case", "selected.txt"), "SYNTHETIC-HISTORICAL-QUEUE");
    const provider = (baseURL: string) => ({provider: {fixture: {npm: "@ai-sdk/openai-compatible", options: {baseURL}, models: {fixture: {}}}}});
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => provider("http://127.0.0.1:47831/v1"));
    const target = await protectedAiTarget(config, "fixture", "fixture");
    const profilePatch = {state: "approved" as const, scope: {workspaceId: workspace.id, matterId: "synthetic-queue-matter", jurisdictions: ["CZ" as const]}, targetFingerprint: target.fingerprint,
      legalProfileId: "protocol-only-fixture", legalProfileVersion: "1", evidenceRefs: ["sha256:" + "a".repeat(64)], expiresAt: null};
    let profile = await compareAndSetGovernanceProfile(config, {id: "historical-queue-profile", expectedRevision: 0, patch: profilePatch}, {type: "host"});
    const [source] = await documents.prepare(workspace, ["case/selected.txt"]);
    for (let i = 0; i < 200 && (await documents.list(workspace))[0]?.status !== "readable"; i++) await Bun.sleep(10);
    server = await startServer(config);
    const original = await runtime.open({workspaceId: workspace.id, caseDirectory: "case", providerId: "fixture", modelId: "fixture", profileId: profile.id, sources: [{id: source.id, hash: source.hash}]}, AbortSignal.timeout(3000));
    await server.stop(); server = undefined; release(); await runtime.close();
    const previousReviews = allowedReviews;
    holdReview = true; runtime = makeRuntime(); release = registerProtectedRuntime(config, runtime);
    server = await startServer(config);
    const base = `http://127.0.0.1:${server.port}/workspace/synthetic`, endpoint = `${base}/sessions/${sessionId}/queue`;
    const headers = {"x-legalwork-host-token": config.hostToken!, "content-type": "application/json"};
    const id = "de24fbec-ac3a-4d05-b9d2-1c93ca1794d4";
    const payload = {type: "enqueue", id, execution: {kind: "prompt", model: {providerID: "fixture", modelID: "fixture"}, parts: [{type: "text", text: "Reread the selected evidence"}]},
      draft: {mode: "prompt", text: "Reread the selected evidence", parts: [], attachments: [], editor: {mentions: {}, pasteParts: []}}};
    const metadata = async () => {
      const response = await fetch(`${base}/opencode/session/${sessionId}/protected-transport`, {headers});
      expect(response.status).toBe(200);
      return await response.json() as {sessionId: string; operationId: string; runtimeState: string; directoryMapping: {guestDirectory: string; hostDirectory: string}; legalApproval: boolean};
    };
    const captured = await metadata();
    expect(captured).toMatchObject({sessionId, runtimeState: "captured", directoryMapping: original.directoryMapping, legalApproval: false});
    expect(JSON.stringify(captured)).not.toContain("SYNTHETIC-HISTORICAL-QUEUE");
    expect(opens).toBe(1); expect(allowedReviews).toBe(previousReviews);
    const expectDenied = async (status: number, code: string, execution: unknown = payload.execution) => {
      const response = await fetch(endpoint, {method: "POST", headers, body: JSON.stringify({...payload, execution})});
      expect({status: response.status, body: await response.json()}).toMatchObject({status, body: {code}});
      expect(opens).toBe(1); expect(sent).toBe(0); expect(allowedReviews).toBe(previousReviews);
    };
    const queueEmpty = async () => {
      const queue = await (await fetch(endpoint, {headers})).json() as {entries: unknown[]; completedIds: string[]};
      expect(queue.entries).toEqual([]); expect(queue.completedIds).toEqual([]);
    };
    await queueEmpty();
    const foreignWorkspace = {...workspace, id: "foreign", path: join(root, "foreign-project")};
    await mkdir(foreignWorkspace.path); config.workspaces.push(foreignWorkspace);
    let fallbackReads = 0, fallbackWrites = 0;
    const ordinaryFixture = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
      if (request.method === "GET") fallbackReads++; else fallbackWrites++;
      return Response.json({id: sessionId, directory: original.directoryMapping.hostDirectory});
    }});
    const ordinaryBase = config.opencodeBaseUrl; config.opencodeBaseUrl = ordinaryFixture.url.origin;
    try {
      const response = await fetch(`${base.replace("/synthetic", "/foreign")}/sessions/${sessionId}/queue`, {method: "POST", headers, body: JSON.stringify(payload)});
      expect({status: response.status, body: await response.json()}).toMatchObject({status: 404, body: {code: "session_not_found"}});
      expect(fallbackReads).toBe(1); expect(fallbackWrites).toBe(0);
      expect(opens).toBe(1); expect(allowedReviews).toBe(previousReviews);
    } finally {config.opencodeBaseUrl = ordinaryBase; config.workspaces.pop(); await ordinaryFixture.stop(true);}
    await expectDenied(403, "protected_prompt_invalid", {kind: "shell", command: "pwd"});
    await expectDenied(403, "protected_prompt_invalid", {...payload.execution, model: {providerID: "foreign", modelID: "foreign"}});
    await expectDenied(403, "protected_attachment_unselected", {...payload.execution, parts: [{type: "file", url: pathToFileURL(join(root, "case", "selected.txt")).href, mime: "text/plain"}]});
    const uploadPath = join(root, ".legalwork", "attachments", "c1e58c8d-83b6-4354-8fb1-6ec9b39a91f8", "copy.txt");
    await mkdir(join(uploadPath, ".."), {recursive: true}); await writeFile(uploadPath, "FOREIGN-UPLOADED-CONTENT");
    await expectDenied(403, "protected_attachment_unselected", {...payload.execution, parts: [{type: "file", url: pathToFileURL(uploadPath).href, mime: "text/plain"}]});
    config.readOnly = true;
    try {await expectDenied(403, "read_only");} finally {config.readOnly = false;}
    profile = await compareAndSetGovernanceProfile(config, {id: profile.id, expectedRevision: profile.revision, patch: {...profilePatch, state: "suspended"}}, {type: "host"});
    await expectDenied(403, "ai_transfer_denied");
    profile = await compareAndSetGovernanceProfile(config, {id: profile.id, expectedRevision: profile.revision, patch: profilePatch}, {type: "host"});
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => provider("http://127.0.0.1:47832/v1"));
    try {await expectDenied(403, "protected_ai_profile_missing");} finally {await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => provider("http://127.0.0.1:47831/v1"));}
    await writeFile(join(root, "case", "selected.txt"), "CHANGED-SELECTED-SOURCE");
    // queueClient performs the owning SDK read first; that existing SDK seam
    // maps typed historical read failures to its unavailable response.
    try {await expectDenied(503, "opencode_unavailable");} finally {await writeFile(join(root, "case", "selected.txt"), "SYNTHETIC-HISTORICAL-QUEUE");}
    await rename(join(root, "case"), join(root, "former-case")); await mkdir(join(root, "case")); await writeFile(join(root, "case", "selected.txt"), "SYNTHETIC-HISTORICAL-QUEUE");
    try {await expectDenied(503, "opencode_unavailable");} finally {await rm(join(root, "case"), {recursive: true}); await rename(join(root, "former-case"), join(root, "case"));}
    const historyDirectory = join(runtimeStorageDir(config), "protected-document-sessions"), checkpointName = (await readdir(historyDirectory)).find(name => name.endsWith(".sqlite"))!;
    const checkpointPath = join(historyDirectory, checkpointName), originalCheckpoint = await readFile(checkpointPath);
    await writeFile(checkpointPath, "corrupt-private-checkpoint");
    try {await expectDenied(503, "opencode_unavailable");} finally {await writeFile(checkpointPath, originalCheckpoint);}
    await queueEmpty();
    await writeFile(uploadPath, "SYNTHETIC-HISTORICAL-QUEUE");
    const executionWithUpload = {...payload.execution, parts: [...payload.execution.parts, {type: "file", url: pathToFileURL(uploadPath).href, mime: "text/plain"}]};
    pending = fetch(endpoint, {method: "POST", headers, body: JSON.stringify({...payload, execution: executionWithUpload})});
    const admission = await Promise.race([pending, Bun.sleep(3000).then(() => undefined)]);
    expect(admission?.status).toBe(200);
    const accepted = await admission!.json() as {entries: Array<{id: string; execution: unknown}>; completedIds: string[]};
    expect(accepted.entries).toContainEqual(expect.objectContaining({id})); expect(accepted.completedIds).not.toContain(id);
    expect(accepted.entries[0]?.execution).toEqual(executionWithUpload);
    expect(JSON.stringify(accepted)).not.toContain("SYNTHETIC-HISTORICAL-QUEUE");
    await reviewing;
    expect(allowedReviews).toBe(previousReviews); expect(opens).toBe(1); expect(sent).toBe(0);
    expect(await metadata()).toMatchObject({sessionId, runtimeState: "restoring", directoryMapping: original.directoryMapping});
    allowReview(); await restoring;
    expect(sent).toBe(0);
    expect(await metadata()).toMatchObject({sessionId, runtimeState: "restoring", directoryMapping: original.directoryMapping});
    if (uploadChanges) await writeFile(uploadPath, "CHANGED-AFTER-HOST-ADMISSION");
    releaseEngine();
    if (uploadChanges) {
      let queue: {completedIds: string[]; entries: Array<{id: string; status: string}>} = {completedIds: [], entries: []};
      for (let i = 0; i < 200; i++) {queue = await (await fetch(endpoint, {headers})).json(); if (queue.entries.some(entry => entry.id === id && entry.status === "failed")) break; await Bun.sleep(10);}
      expect(queue.completedIds).not.toContain(id);
      expect(queue.entries).toContainEqual(expect.objectContaining({id, status: "failed"}));
      expect(sent).toBe(0); expect(opens).toBe(2); expect(allowedReviews).toBeGreaterThan(previousReviews);
      expect(await metadata()).toMatchObject({sessionId, runtimeState: "ready", directoryMapping: original.directoryMapping, legalApproval: false});
      return;
    }
    await messaging;
    const ready = await metadata();
    expect(ready).toMatchObject({sessionId, runtimeState: "ready", directoryMapping: original.directoryMapping, legalApproval: false});
    expect(ready.operationId).not.toBe(captured.operationId);
    const delivering = await (await fetch(endpoint, {headers})).json() as {completedIds: string[]};
    expect(delivering.completedIds).not.toContain(id);
    // Provisioning is complete independently of the still-held model response.
    releaseMessage();
    let completed: string[] = [];
    for (let i = 0; i < 200; i++) {completed = (await (await fetch(endpoint, {headers})).json() as {completedIds: string[]}).completedIds; if (completed.includes(id)) break; await Bun.sleep(10);}
    expect(completed).toContain(id); expect(sent).toBe(1); expect(opens).toBe(2); expect(allowedReviews).toBeGreaterThan(previousReviews);
  } finally {
    allowReview(); releaseEngine(); releaseMessage(); await pending?.then(response => response.body?.cancel()).catch(() => {});
    await server?.stop(); release(); await runtime.close(); approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); await closeOrgPolicyRuntime(config); await rm(root, {recursive: true, force: true});
  }
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
