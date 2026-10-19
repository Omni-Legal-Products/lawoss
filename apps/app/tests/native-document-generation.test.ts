import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import { DocumentProcessingPanel } from "../src/react-app/domains/session/panel/document-processing-panel";
import { documentClientIdentity } from "../src/react-app/domains/session/panel/document-processing";
import { t } from "../src/i18n";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createClient, preflightOpencodeDirectory } from "../src/app/lib/opencode";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { documentExecutionDirectory, preflightDocumentGeneration } from "../src/react-app/domains/session/panel/native-document-preflight";
import { generationPrompt, submitDocumentTask } from "../src/react-app/domains/session/panel/document-processing";

const root = { id: "root", path: "case/a.pdf", workspaceId: "remote-runtime", hash: "a".repeat(64), status: "readable" as const, complete: true, pageCount: 1, readablePages: 1, updatedAt: 1, provenance: { sourcePath: "case/a.pdf", depth: 0 } };
const child = { ...root, id: "child", provenance: { ...root.provenance, parentId: "root", depth: 1, attachmentName: "attachment.pdf" } };

async function transportTest(run: (fixture: { base: string; calls: string[]; state: { connected: boolean; tools: boolean; engine: boolean; stale: boolean; failSend: boolean; snapshot: any }; bodies: unknown[] }) => Promise<void>) {
  const calls: string[] = [], bodies: unknown[] = [];
  const state = { connected: true, tools: true, engine: true, stale: false, failSend: false, snapshot: { messages: [], status: { type: "idle" } } };
  const server = Bun.serve({ port: 0, fetch: async request => {
    const url = new URL(request.url), path = url.pathname;
    calls.push(`${request.method} ${path}`);
    expect(request.headers.get("authorization")).toBe("Bearer fixture-token");
    if (path.includes("/opencode/")) expect(decodeURIComponent(url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory") ?? "")).toBe("/registered/root/work");
    if (path.endsWith("/snapshot")) {
      // Engine page order uses creation time and then ID, returned chronologically.
      const limit = Number(url.searchParams.get("limit") ?? 20);
      const messages = [...state.snapshot.messages].sort((a, b) => a.info.time.created - b.info.time.created || a.info.id.localeCompare(b.info.id)).slice(-limit);
      return Response.json({ item: { session: { id: "created" }, todos: [], ...state.snapshot, messages } });
    }
    if (path.endsWith("/provider")) return Response.json({ all: [{ id: "chosen", name: "Chosen", source: "api", models: { selected: { id: "selected", providerID: "chosen", name: "Selected", capabilities: { toolcall: state.tools }, limit: { context: 10000, output: 1000 } } } }], connected: state.connected ? ["chosen"] : [], default: {} });
    if (path.endsWith("/session") && request.method === "GET") return state.engine ? Response.json([]) : Response.json({ code: "engine_unavailable", message: "engine unavailable" }, { status: 503 });
    if (path.endsWith("/files/list")) { expect(url.searchParams.get("path")).toBe("work"); return Response.json({ path: "work", entries: [], truncated: false }); }
    if (path.endsWith("/lawoss/documents")) return Response.json({ documents: [root, child, { ...root, id: "sibling", path: "other/b.pdf" }], nextOffset: null, untrusted: true });
    if (path.endsWith("/read")) {
      if (state.stale) return Response.json({ code: "document_stale", message: "source changed" }, { status: 409 });
      const selected = path.includes("/child/") ? child : root;
      return Response.json({ ...selected, text: "source text", pages: [{ page: 1, text: "source text", source: "native" }], offset: 0, nextOffset: null, untrusted: true });
    }
    if (path.endsWith("/lawoss/documents/generation") && request.method === "POST") {
      expect(request.headers.get("x-legalwork-host-token")).toBe("fixture-native-host");
      const input = await request.json(); bodies.push(input);
      expect(input).toEqual({sources: [{id: root.id, hash: root.hash}, {id: child.id, hash: child.hash}], providerId: "chosen", modelId: "selected", caseDirectory: "work"});
      const count = calls.filter(call => call.endsWith("/lawoss/documents/generation")).length;
      return Response.json({session: {id: count === 1 ? "created" : `created-${count}`, directory: "/registered/root/work"}, directoryMapping: {guestDirectory: "/tmp/home/protected-engine/workspace", hostDirectory: "/registered/root/work", rootIdentity: "fixture-owner"}, operationId: `operation-${count}`, legalApproval: false});
    }
    if (path.endsWith("/session") && request.method === "POST") { bodies.push(await request.text()); const count = calls.filter(call => call === "POST /workspace/remote-runtime/opencode/session").length; return Response.json({ id: count === 1 ? "created" : `created-${count}`, directory: "/registered/root/work" }); }
    if (request.method === "PATCH" && /\/session\/created(?:-\d+)?$/.test(path)) return Response.json({ id: "created" });
    if (path.endsWith("/prompt_async")) { bodies.push(await request.json()); return state.failSend ? Response.json({ code: "billing", message: "billing unavailable" }, { status: 402 }) : new Response(null, { status: 204 }); }
    return Response.json({ code: "unexpected", message: path }, { status: 500 });
  } });
  try { await run({ base: `http://127.0.0.1:${server.port}`, calls, state, bodies }); }
  finally { server.stop(true); }
}

function inputs(base: string) {
  const baseUrl = `${base}/workspace/remote-runtime/opencode`;
  const sdk = createClient(baseUrl, "/registered/root/work", { token: "fixture-token", mode: "legalwork" });
  const legalwork = createLegalworkServerClient({ baseUrl: base, token: "fixture-token", hostToken: "fixture-native-host" });
  const request = { projectId: "rem_app-project", caseDirectory: "work", sources: [root, child], outputLanguage: "cs" as const };
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }), sdk, baseUrl, directory: "/registered/root/work", relative: "work", legalwork, workspaceId: "remote-runtime", model: { providerID: "chosen", modelID: "selected" }, request };
}

async function provision(input: ReturnType<typeof inputs>) {
  return (await input.legalwork.createLawossDocumentGeneration(input.workspaceId, {sources: input.request.sources.map(source => ({id: source.id, hash: source.hash})), providerId: input.model.providerID, modelId: input.model.modelID, caseDirectory: input.relative})).session.id;
}

test("protected generation provisioning uses the selected owner's two credentials and returns the actual session mapping", async () => {
  const requests: Array<{path: string; auth: string | null; host: string | null; body: unknown}> = [];
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    requests.push({path: new URL(request.url).pathname, auth: request.headers.get("authorization"), host: request.headers.get("x-legalwork-host-token"), body: await request.json()});
    return Response.json({session: {id: "actual-vm-session", directory: "/registered/root/work"}, directoryMapping: {guestDirectory: "/tmp/home/protected-engine/workspace", hostDirectory: "/registered/root/work", rootIdentity: "host-root-identity"}, operationId: "host-operation", legalApproval: false});
  }});
  try {
    const client = createLegalworkServerClient({baseUrl: server.url.origin, token: "owner-bearer", hostToken: "owner-native-capability"});
    const input = {sources: [{id: root.id, hash: root.hash}, {id: child.id, hash: child.hash}], providerId: "chosen", modelId: "selected", caseDirectory: "work"};
    const result = await client.createLawossDocumentGeneration("selected-owner", input);
    expect(requests).toEqual([{path: "/workspace/selected-owner/lawoss/documents/generation", auth: "Bearer owner-bearer", host: "owner-native-capability", body: input}]);
    expect(result.session.id).toBe("actual-vm-session");
    expect(result.directoryMapping).toEqual({guestDirectory: "/tmp/home/protected-engine/workspace", hostDirectory: "/registered/root/work", rootIdentity: "host-root-identity"});
    expect(result.legalApproval).toBe(false);
  } finally {server.stop(true);}
});

test("protected provisioning denial remains a failure and never falls back to ordinary engine creation", async () => {
  const calls: string[] = [];
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch(request) {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({code: "protected_ai_unavailable", message: "Protected runtime unavailable"}, {status: 503});
  }});
  try {
    const client = createLegalworkServerClient({baseUrl: server.url.origin, token: "selected-bearer", hostToken: "selected-host"});
    await expect(client.createLawossDocumentGeneration("selected-owner", {sources: [{id: root.id, hash: root.hash}], providerId: "chosen", modelId: "selected"})).rejects.toThrow("Protected runtime unavailable");
    expect(calls).toEqual(["POST /workspace/selected-owner/lawoss/documents/generation"]);
  } finally {server.stop(true);}
});

test("native SDK/client preflight rejects fresh disconnected/toolless catalog and engine/source errors before create", async () => transportTest(async ({ base, calls, state }) => {
  const input = inputs(base);
  for (const field of ["connected", "tools", "engine"] as const) {
    state[field] = false;
    await expect(preflightDocumentGeneration(input)).rejects.toThrow();
    state[field] = true;
  }
  state.stale = true;
  await expect(preflightDocumentGeneration(input)).rejects.toThrow();
  expect(calls.filter(call => call.startsWith("POST"))).toEqual([]);
  expect(calls.filter(call => call.endsWith("/provider"))).toHaveLength(4);
  expect(calls).not.toContain("GET /workspace/remote-runtime/sessions");
}));

test("native immediate SDK create/send retries the created chat, scoped root refs exclude sibling and preserve chosen model", async () => transportTest(async ({ base, calls, state, bodies }) => {
  const input = inputs(base), pending = { sessionId: null as string | null, running: false };
  const task = {
    pending, preflight: () => preflightDocumentGeneration(input),
    create: () => provision(input),
    send: async (sessionID: string) => { const response = await input.sdk.session.promptAsync({ sessionID, parts: [{ type: "text", text: generationPrompt("cs", input.request.sources) }], model: input.model, agent: "selected-agent", variant: "selected-variant" }); if (response.error) throw new Error(JSON.stringify(response.error)); },
  };
  state.failSend = true;
  await expect(submitDocumentTask(task)).rejects.toThrow("billing");
  state.failSend = false;
  expect(await submitDocumentTask(task)).toBe("created");
  expect(calls.filter(call => call === "POST /workspace/remote-runtime/lawoss/documents/generation")).toHaveLength(1);
  expect(calls).not.toContain("POST /workspace/remote-runtime/opencode/session");
  expect(calls.indexOf("GET /workspace/remote-runtime/opencode/session")).toBeLessThan(calls.indexOf("GET /workspace/remote-runtime/files/list"));
  expect(calls.indexOf("GET /workspace/remote-runtime/files/list")).toBeLessThan(calls.indexOf("POST /workspace/remote-runtime/lawoss/documents/generation"));
  const send = bodies[2] as { parts: Array<{ text: string }>; model: unknown; agent: string; variant: string };
  expect(send.model).toEqual(input.model); expect(send.agent).toBe("selected-agent"); expect(send.variant).toBe("selected-variant");
  expect(send.parts[0].text).toContain("case/a.pdf"); expect(send.parts[0].text).not.toContain("other/b.pdf");
}));

test("explicit working directory is lexical scoped, Windows compatible and remote root preserved", () => {
  expect(documentExecutionDirectory("C:\\cases\\selected", "work", false).directory).toBe("C:\\cases\\selected/work");
  expect(documentExecutionDirectory("/registered", "", true).directory).toBe("/registered");
  for (const path of ["../sibling", "/elsewhere", "C:\\other", "work/../other"]) expect(() => documentExecutionDirectory("/registered", path, false)).toThrow();
  expect(() => documentExecutionDirectory("/registered", "nested", true)).toThrow();
});


test("unregistered SDK client cannot silently probe the overridden/cache path", async () => transportTest(async ({ base, calls }) => {
  const raw = createOpencodeClient({ baseUrl: base });
  expect(() => preflightOpencodeDirectory(raw, "/registered/root/work")).toThrow();
  expect(calls).toEqual([]);
}));

import { submitBoundDocumentGeneration, applyDocumentGenerationRunStatus, documentGenerationKey, getDocumentGeneration, hasProtectedDocumentSession, observeDocumentGeneration, reconcileDocumentGeneration, readDocumentGenerationSnapshot, clearDocumentGenerationsForTest } from "../src/react-app/domains/session/panel/document-generation-lifecycle";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import { ensureWorkspaceSessionSync, __createWorkspaceSessionSyncForTest, __applySessionSyncEventForTest, __disposeWorkspaceSessionSyncForTest } from "../src/react-app/domains/session/sync/session-sync";

test("accepted204 stays bound across new panel/reload, repeat does not create, native background error retries same chat", async () => transportTest(async ({ base, calls }) => {
  const previousStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => saved.set(key, value),
    removeItem: (key: string) => saved.delete(key),
  } });
  clearDocumentGenerationsForTest();
  const input = inputs(base);
  const metadata = { projectId: "rem_app-project", baseUrl: base, workspaceId: "remote-runtime", root: "/registered/root", directory: "/registered/root/work" };
  const key = documentGenerationKey(metadata, "en", input.request.sources);
  const projectKey = JSON.stringify([base, metadata.workspaceId, metadata.root]);
  saved.set(`lawoss-doc-working-directory:${projectKey}`, "work");
  const sync = { workspaceId: metadata.projectId, baseUrl: input.baseUrl, legalworkToken: "fixture-token" };
  __createWorkspaceSessionSyncForTest(sync);
  const releaseStatus = ensureWorkspaceSessionSync({ ...sync, onSessionStatus: update => {
    if (update.sessionId === "created") applyDocumentGenerationRunStatus(key, update.status);
  } });
  const release = observeDocumentGeneration(key, metadata.projectId);
  const options = {
    key, metadata, preflight: () => preflightDocumentGeneration(input),
    create: () => provision(input),
    send: async (sessionID: string, messageID: string) => { const response = await input.sdk.session.promptAsync({ sessionID, messageID, parts: [{ type: "text", text: "selected task" }], model: input.model }); if (response.error) throw new Error(JSON.stringify(response.error)); },
  };
  try {
    expect(await submitBoundDocumentGeneration(options)).toBe("created");
    __applySessionSyncEventForTest(sync, { type: "session.status", properties: { sessionID: "created", status: { type: "busy" } } } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("running");
    // Clear the runtime registry and reload its actual persisted association, not the pending HTTP closure.
    clearDocumentGenerationsForTest(true);
    expect(getDocumentGeneration(key)?.sessionId).toBe("created");
    expect(getDocumentGeneration(key)?.phase).toBe("running");
    const cache = new QueryClient();
    const identity = [base, documentClientIdentity(input.legalwork), metadata.workspaceId, metadata.root];
    cache.setQueryData(["lawoss-documents", ...identity, [root.path], "files"], input.request.sources.map(source => ({ ...source, freshness: "current", pages: [] })));
    const panel = createElement(DocumentProcessingPanel, { client: input.legalwork, workspaceId: metadata.workspaceId, projectId: metadata.projectId, workspaceRoot: metadata.root, folder: "", selectedPaths: [root.path], onSelectPaths: () => {}, fileVersion: "files", active: false, isRemote: false });
    const reloadedPanel = renderToStaticMarkup(createElement(QueryClientProvider, { client: cache }, panel));
    expect(reloadedPanel).toContain(t("documents.run_active"));
    expect(reloadedPanel).toContain('value="work"');
    expect(await submitBoundDocumentGeneration({ ...options })).toBe("created");
    expect(calls.filter(call => call === "POST /workspace/remote-runtime/lawoss/documents/generation")).toHaveLength(1);
    expect(calls.filter(call => call.endsWith("/prompt_async"))).toHaveLength(1);
    __applySessionSyncEventForTest(sync, { type: "session.error", properties: { sessionID: "created", error: { name: "APIError", data: { message: "late provider failure" } } } } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("error");
    expect(await submitBoundDocumentGeneration({ ...options })).toBe("created");
    expect(calls.filter(call => call === "POST /workspace/remote-runtime/lawoss/documents/generation")).toHaveLength(1);
    expect(calls.filter(call => call.endsWith("/prompt_async"))).toHaveLength(2);
    // Reload recovery can also reconcile actual snapshot completion; a stale idle-only snapshot cannot.
    reconcileDocumentGeneration(key, { status: { type: "idle" }, messages: [] } as any);
    applyDocumentGenerationRunStatus(key, { type: "idle" });
    expect(getDocumentGeneration(key)?.phase).not.toBe("completed");
    __applySessionSyncEventForTest(sync, { type: "session.status", properties: { sessionID: "created", status: { type: "busy" } } } as any);
    __applySessionSyncEventForTest(sync, { type: "session.idle", properties: { sessionID: "created" } } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("completed");
    // A later manual turn's error cannot rewrite the already-terminal scoped generation.
    reconcileDocumentGeneration(key, { status: { type: "idle" }, messages: [{ info: { role: "assistant", error: { name: "APIError" }, time: { created: Date.now() + 10, completed: Date.now() + 10 } }, parts: [] }] } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("completed");
    __applySessionSyncEventForTest(sync, { type: "session.error", properties: { sessionID: "created", error: { name: "APIError", data: { message: "unrelated later turn" } } } } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("completed");
    expect(await submitBoundDocumentGeneration(options)).toBe("created");
    expect(calls.filter(call => call.endsWith("/prompt_async"))).toHaveLength(2);
    expect(await submitBoundDocumentGeneration({ ...options, newGeneration: true })).toBe("created-2");
    expect(calls.filter(call => call === "POST /workspace/remote-runtime/lawoss/documents/generation")).toHaveLength(2);
  } finally {
    release(); releaseStatus(); __disposeWorkspaceSessionSyncForTest(sync); clearDocumentGenerationsForTest();
    useSessionActivityStore.getState().removeSession(metadata.projectId, "created");
    useSessionActivityStore.getState().removeSession(metadata.projectId, "created-2");
    if (previousStorage) Object.defineProperty(globalThis, "localStorage", previousStorage);
    else Reflect.deleteProperty(globalThis, "localStorage");
  }
}));

test("regenerated attachment IDs do not detach an accepted request from unchanged ultimate originals", () => {
  const metadata = { projectId: "project", baseUrl: "http://owner", workspaceId: "runtime", root: "/root", directory: "/root" };
  const initial = documentGenerationKey(metadata, "en", [root, child]);
  const refreshed = documentGenerationKey(metadata, "en", [root, { ...child, id: "new-child-id" }]);
  expect(refreshed).toBe(initial);
  expect(documentGenerationKey(metadata, "en", [{ ...root, hash: "b".repeat(64) }, child])).not.toBe(initial);
});

test("a failed legacy binding remains history while the protected transport provisions once and retries only its own VM session", async () => transportTest(async ({base, calls, state}) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {configurable: true, value: {getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key)}});
  clearDocumentGenerationsForTest();
  const input = inputs(base);
  const metadata = {projectId: "migration-project", baseUrl: base, workspaceId: input.workspaceId, root: "/registered/root", directory: input.directory};
  const legacyKey = documentGenerationKey(metadata, "cs", input.request.sources);
  const protectedMetadata = {...metadata, transport: "protected-documents-v1" as const};
  const protectedKey = documentGenerationKey(protectedMetadata, "cs", input.request.sources);
  try {
    await expect(submitBoundDocumentGeneration({key: legacyKey, metadata, preflight: async () => {}, create: async () => "legacy-general-session", send: async () => {throw new Error("Old general engine denied");}})).rejects.toThrow("Old general engine denied");
    clearDocumentGenerationsForTest(true);
    expect(getDocumentGeneration(legacyKey)).toMatchObject({sessionId: "legacy-general-session", phase: "error"});
    expect(protectedKey).not.toBe(legacyKey);
    const options = {key: protectedKey, metadata: protectedMetadata, preflight: () => preflightDocumentGeneration(input), create: () => provision(input),
      send: async (sessionID: string, messageID: string) => {const result = await input.sdk.session.promptAsync({sessionID, messageID, parts: [{type: "text", text: "Selected protected document task"}], model: input.model, agent: "legalwork", variant: "high"}); if (result.error) throw new Error(JSON.stringify(result.error));}};
    state.failSend = true;
    await expect(submitBoundDocumentGeneration(options)).rejects.toThrow("billing");
    clearDocumentGenerationsForTest(true);
    expect(getDocumentGeneration(protectedKey)).toMatchObject({sessionId: "created", phase: "error", transport: "protected-documents-v1"});
    expect(hasProtectedDocumentSession(metadata.projectId,"created")).toBe(true);
    expect(hasProtectedDocumentSession(metadata.projectId,"legacy-general-session")).toBe(false);
    expect(hasProtectedDocumentSession("foreign-project","created")).toBe(false);
    state.failSend = false;
    expect(await submitBoundDocumentGeneration(options)).toBe("created");
    expect(await submitBoundDocumentGeneration(options)).toBe("created");
    expect(getDocumentGeneration(legacyKey)).toMatchObject({sessionId: "legacy-general-session", phase: "error"});
    expect(calls.filter(call => call.endsWith("/lawoss/documents/generation"))).toHaveLength(1);
    expect(calls.filter(call => call.endsWith("/prompt_async"))).toHaveLength(2);
    expect(calls.some(call => call.includes("/session/legacy-general-session/"))).toBe(false);
  } finally {
    clearDocumentGenerationsForTest();
    useSessionActivityStore.getState().removeSession(metadata.projectId, "legacy-general-session"); useSessionActivityStore.getState().removeSession(metadata.projectId, "created");
    if (descriptor) Object.defineProperty(globalThis, "localStorage", descriptor); else Reflect.deleteProperty(globalThis, "localStorage");
  }
}));


test("accepted native message correlation survives skew/reload, ignores tool steps and stale snapshots", async () => transportTest(async ({ base, calls, state, bodies }) => {
  const storage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const saved = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value), removeItem: (key: string) => saved.delete(key) } });
  clearDocumentGenerationsForTest();
  const input = inputs(base);
  const metadata = { projectId: "round2", baseUrl: base, workspaceId: input.workspaceId, root: "/registered/root", directory: input.directory };
  const key = documentGenerationKey(metadata, "en", input.request.sources);
  saved.set(`lawoss-doc-working-directory:${JSON.stringify([base, metadata.workspaceId, metadata.root])}`, "work");
  const renderPanel = () => {
    const cache = new QueryClient();
    cache.setQueryData(["lawoss-documents", base, documentClientIdentity(input.legalwork), metadata.workspaceId, metadata.root, [root.path], "files"], input.request.sources.map(source => ({ ...source, freshness: "current", pages: [] })));
    const panel = createElement(DocumentProcessingPanel, { client: input.legalwork, workspaceId: metadata.workspaceId, projectId: metadata.projectId, workspaceRoot: metadata.root, folder: "", selectedPaths: [root.path], onSelectPaths: () => {}, fileVersion: "files", active: false, isRemote: false });
    return renderToStaticMarkup(createElement(QueryClientProvider, { client: cache }, panel));
  };
  const options = {
    key, metadata, preflight: () => preflightDocumentGeneration(input),
    create: () => provision(input),
    send: async (sessionID: string, messageID: string) => { const result = await input.sdk.session.promptAsync({ sessionID, messageID, parts: [{ type: "text", text: "task" }], model: input.model }); if (result.error) throw new Error(JSON.stringify(result.error)); },
  };
  const read = () => readDocumentGenerationSnapshot(key, async () => (await input.legalwork.getSessionSnapshot(input.workspaceId, "created", { limit: 20 })).item);
  const assistant = (parentID: string, finish: string, skew: number, error?: object, summary = false) => ({ info: { id: `assistant-${parentID}`, sessionID: "created", role: "assistant", parentID, summary, finish, time: { created: Date.now() + skew, completed: Date.now() + skew }, ...(error ? { error } : {}) }, parts: [] });
  try {
    await submitBoundDocumentGeneration(options);
    const firstID = (bodies.at(-1) as any).messageID;
    expect(firstID).toMatch(/^msg_[0-9a-f]{12}[0-9A-Za-z]{14}$/);
    expect(getDocumentGeneration(key)?.messageId).toBe(firstID);
    expect(renderPanel()).toContain(t("documents.run_active"));
    for (const finish of ["tool-calls", "unknown", ""]) {
      state.snapshot = { status: { type: "idle" }, messages: [assistant(firstID, finish, 1000)] };
      reconcileDocumentGeneration(key, await read());
      expect(getDocumentGeneration(key)?.phase).toBe("accepted");
    }
    state.snapshot = { status: { type: "idle" }, messages: [assistant(firstID, "stop", 1000, undefined, true)] };
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("accepted");
    await submitBoundDocumentGeneration(options);
    expect(calls.filter(call => call.endsWith("/prompt_async"))).toHaveLength(1);
    // The server can read idle before handoff and messages after a tool step.
    // A later real native error must remain observable after that snapshot.
    const sync = { workspaceId: metadata.projectId, baseUrl: input.baseUrl, legalworkToken: "fixture-token" };
    __createWorkspaceSessionSyncForTest(sync);
    const release = observeDocumentGeneration(key, metadata.projectId);
    __applySessionSyncEventForTest(sync, { type: "session.error", properties: { sessionID: "created", error: { name: "APIError", data: { message: "background" } } } } as any);
    expect(getDocumentGeneration(key)?.phase).toBe("error");
    release(); __disposeWorkspaceSessionSyncForTest(sync);
    await submitBoundDocumentGeneration(options);
    const secondID = (bodies.at(-1) as any).messageID;
    expect(secondID > firstID).toBe(true);
    expect(calls.filter(call => call === "POST /workspace/remote-runtime/lawoss/documents/generation")).toHaveLength(1);
    state.snapshot = { status: { type: "idle" }, messages: [assistant(firstID, "stop", 1000, { name: "APIError" }), assistant("manual-turn", "stop", 1000, { name: "APIError" })] };
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("accepted");
    // Engine clock behind: reload still associates a terminal failure exactly.
    state.snapshot.messages.push(...Array.from({ length: 30 }, (_, index) => assistant(`older-page-${index}`, "stop", -2000, { name: "APIError" })), assistant(secondID, "stop", -1000, { name: "APIError" }));
    clearDocumentGenerationsForTest(true);
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("error");
    expect(renderPanel()).toContain(t("documents.retry_generation"));
    expect(renderPanel()).not.toContain(t("documents.run_active"));
    await submitBoundDocumentGeneration(options);
    const aheadID = (bodies.at(-1) as any).messageID;
    state.snapshot = { status: { type: "idle" }, messages: [assistant(aheadID, "stop", 1000, { name: "APIError" })] };
    clearDocumentGenerationsForTest(true);
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("error");
    expect(renderPanel()).toContain(t("documents.retry_generation"));
    expect(renderPanel()).not.toContain(t("documents.run_active"));
    await submitBoundDocumentGeneration(options);
    const thirdID = (bodies.at(-1) as any).messageID;
    expect(thirdID > aheadID).toBe(true);
    // Bounded transcript can contain old rows never seen before; parent identity still rejects them.
    state.snapshot = { status: { type: "idle" }, messages: Array.from({ length: 20 }, (_, index) => assistant(`old-outside-watermark-${index}`, "stop", 1000, { name: "APIError" })) };
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("accepted");
    state.snapshot = { status: { type: "idle" }, messages: [assistant(thirdID, "stop", -1000)] };
    const stale = await read();
    __createWorkspaceSessionSyncForTest(sync);
    const releaseStatus = ensureWorkspaceSessionSync({ ...sync, onSessionStatus: update => { if (update.sessionId === "created") applyDocumentGenerationRunStatus(key, update.status); } });
    __applySessionSyncEventForTest(sync, { type: "session.status", properties: { sessionID: "created", status: { type: "busy" } } } as any);
    reconcileDocumentGeneration(key, stale);
    releaseStatus(); __disposeWorkspaceSessionSyncForTest(sync);
    expect(getDocumentGeneration(key)?.phase).toBe("running");
    // Both clock directions recover terminal success, even without a live busy event.
    clearDocumentGenerationsForTest(true);
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("completed");
    expect(renderPanel()).toContain(t("documents.new_generation"));
    expect(renderPanel()).not.toContain(t("documents.run_active"));
    await submitBoundDocumentGeneration({ ...options, newGeneration: true });
    const fourthID = (bodies.at(-1) as any).messageID;
    state.snapshot = { status: { type: "idle" }, messages: [assistant(fourthID, "stop", 1000)] };
    clearDocumentGenerationsForTest(true);
    reconcileDocumentGeneration(key, await read());
    expect(getDocumentGeneration(key)?.phase).toBe("completed");
    expect(renderPanel()).toContain(t("documents.new_generation"));
    expect(renderPanel()).not.toContain(t("documents.run_active"));
  } finally {
    clearDocumentGenerationsForTest();
    useSessionActivityStore.getState().removeSession(metadata.projectId, "created");
    if (storage) Object.defineProperty(globalThis, "localStorage", storage); else Reflect.deleteProperty(globalThis, "localStorage");
  }
}));

test("profile discovery keeps both owner credentials and explicit matter choice reaches protected provisioning", async () => {
  const { selectDocumentGenerationProfile } = await import("../src/react-app/domains/session/panel/document-processing");
  const view = {profiles: [{id: "chosen-matter", revision: 3, scope: {workspaceId: "owner", matterId: "explicit-case", jurisdictions: ["CZ"]}, legalProfileId: "reviewed", legalProfileVersion: "2", evidenceRefs: ["sha256:"+"a".repeat(64)], expiresAt: null}], targetFingerprint: "b".repeat(64), syntheticReviewAvailable: false, requiresNativeCaseReview: true, legalApproval: false} as const;
  const calls: Array<{path: string; body: unknown}> = [];
  const receiver = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    expect(request.headers.get("authorization")).toBe("Bearer owner-bearer");
    expect(request.headers.get("x-legalwork-host-token")).toBe("owner-native");
    const url = new URL(request.url); calls.push({path: url.pathname+url.search, body: request.method === "POST" ? await request.json() : null});
    return Response.json(request.method === "GET" ? view : {session: {id: "vm-owned"}, legalApproval: false});
  }});
  try {
    const client = createLegalworkServerClient({baseUrl: receiver.url.origin, token: "owner-bearer", hostToken: "owner-native"});
    const listed = await client.listLawossDocumentProfiles("owner", {providerId: "provider", modelId: "model", caseDirectory: "case/sub"});
    expect(() => selectDocumentGenerationProfile(listed, "")).toThrow();
    expect(() => selectDocumentGenerationProfile(listed, "foreign")).toThrow();
    const selected = selectDocumentGenerationProfile(listed, "chosen-matter");
    expect(selected?.scope.matterId).toBe("explicit-case");
    await client.createLawossDocumentGeneration("owner", {sources: [{id: root.id, hash: root.hash}], providerId: "provider", modelId: "model", profileId: selected?.id, caseDirectory: "case/sub"});
    expect(calls[0].path).toBe("/workspace/owner/lawoss/documents/profiles?providerId=provider&modelId=model&caseDirectory=case%2Fsub");
    expect(calls[1].body).toMatchObject({profileId: "chosen-matter", providerId: "provider", modelId: "model", caseDirectory: "case/sub"});
    expect(selectDocumentGenerationProfile({...listed, profiles: [], syntheticReviewAvailable: true}, "")).toBeUndefined();
    expect(() => selectDocumentGenerationProfile({...listed, profiles: [], syntheticReviewAvailable: true}, "chosen-matter")).toThrow();
  } finally {receiver.stop(true);}
});

test("changing explicit protected profile, revision, target or model creates a distinct binding while retaining history", async () => {
  const { documentGenerationKey, getDocumentGeneration, submitBoundDocumentGeneration, PROTECTED_DOCUMENT_GENERATION_TRANSPORT } = await import("../src/react-app/domains/session/panel/document-generation-lifecycle");
  const metadata = {projectId: "profile-binding-owner", baseUrl: "http://owned", workspaceId: "fixture", root: "/owned", directory: "/owned/case", transport: PROTECTED_DOCUMENT_GENERATION_TRANSPORT,
    protectedTarget: {providerId: "provider", modelId: "model", targetFingerprint: "a".repeat(64), profileId: "matter-one", profileRevision: 1}};
  const firstKey = documentGenerationKey(metadata, "cs", [root]); let provisions = 0;
  await expect(submitBoundDocumentGeneration({key: firstKey, metadata, preflight: async () => {}, create: async () => "profile-vm-"+(++provisions), send: async () => {throw new Error("failed turn retained");}})).rejects.toThrow("failed turn retained");
  for (const change of [{profileId: "matter-two"}, {profileRevision: 2}, {targetFingerprint: "b".repeat(64)}, {modelId: "another-model"}]) {
    const next = {...metadata, protectedTarget: {...metadata.protectedTarget, ...change}};
    const key = documentGenerationKey(next, "cs", [root]); expect(key).not.toBe(firstKey);
    const sid = await submitBoundDocumentGeneration({key, metadata: next, preflight: async () => {}, create: async () => "profile-vm-"+(++provisions), send: async () => {}});
    expect(sid).not.toBe("profile-vm-1");
  }
  expect(provisions).toBe(5);
  expect(getDocumentGeneration(firstKey)?.sessionId).toBe("profile-vm-1");
});

test("the protected document panel shows stored matter options without preselecting one or enabling remote generation", () => {
  const client = createLegalworkServerClient({baseUrl: "http://profile-panel.invalid", token: "owner", hostToken: "native"});
  const identity = [client.baseUrl, documentClientIdentity(client), "profile-owner", "/profile-root"];
  const cache = new QueryClient();
  cache.setQueryData(["lawoss-documents", ...identity, [root.path], "files"], [{...root, freshness: "current", pages: []}]);
  cache.setQueryData(["lawoss-document-profiles", ...identity, "provider", "model", ""], {profiles: [{id: "stored-profile", revision: 4, scope: {workspaceId: "profile-owner", matterId: "MATTER-EXPLICIT", jurisdictions: ["CZ"]}, legalProfileId: "reviewed-policy", legalProfileVersion: "2", evidenceRefs: [], expiresAt: null}], targetFingerprint: "a".repeat(64), syntheticReviewAvailable: false, requiresNativeCaseReview: true, legalApproval: false});
  const onGenerate = Object.assign(async () => "unused", {transport: "protected-documents-v1" as const, model: {providerID: "provider", modelID: "model"}});
  const panel = createElement(DocumentProcessingPanel, {client, workspaceId: "profile-owner", projectId: "profile-project", workspaceRoot: "/profile-root", folder: "", selectedPaths: [root.path], onSelectPaths: () => {}, fileVersion: "files", active: false, isRemote: false, onGenerate});
  const markup = renderToStaticMarkup(createElement(QueryClientProvider, {client: cache}, panel));
  expect(markup).toContain('value="" selected=""');
  expect(markup).toContain('value="stored-profile"');
  expect(markup).not.toContain('value="stored-profile" selected=""');
  expect(markup).toContain("MATTER-EXPLICIT");
  expect(markup).toContain("Choose a profile explicitly");
  expect(markup).toMatch(new RegExp(`<button[^>]*disabled=""[^>]*>${t("documents.generate")}</button>`));
});
