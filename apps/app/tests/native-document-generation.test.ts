import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";
import { createClient, unwrap, preflightOpencodeDirectory } from "../src/app/lib/opencode";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { documentExecutionDirectory, preflightDocumentGeneration } from "../src/react-app/domains/session/panel/native-document-preflight";
import { generationPrompt, submitDocumentTask } from "../src/react-app/domains/session/panel/document-processing";

const root = { id: "root", path: "case/a.pdf", workspaceId: "remote-runtime", hash: "a".repeat(64), status: "readable" as const, complete: true, pageCount: 1, readablePages: 1, updatedAt: 1, provenance: { sourcePath: "case/a.pdf", depth: 0 } };
const child = { ...root, id: "child", provenance: { ...root.provenance, parentId: "root", depth: 1, attachmentName: "attachment.pdf" } };

async function transportTest(run: (fixture: { base: string; calls: string[]; state: { connected: boolean; tools: boolean; engine: boolean; stale: boolean; failSend: boolean }; bodies: unknown[] }) => Promise<void>) {
  const calls: string[] = [], bodies: unknown[] = [];
  const state = { connected: true, tools: true, engine: true, stale: false, failSend: false };
  const server = Bun.serve({ port: 0, fetch: async request => {
    const url = new URL(request.url), path = url.pathname;
    calls.push(`${request.method} ${path}`);
    expect(request.headers.get("authorization")).toBe("Bearer fixture-token");
    if (path.includes("/opencode/")) expect(decodeURIComponent(url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory") ?? "")).toBe("/registered/root/work");
    if (path.endsWith("/provider")) return Response.json({ all: [{ id: "chosen", name: "Chosen", source: "api", models: { selected: { id: "selected", providerID: "chosen", name: "Selected", capabilities: { toolcall: state.tools }, limit: { context: 10000, output: 1000 } } } }], connected: state.connected ? ["chosen"] : [], default: {} });
    if (path.endsWith("/session") && request.method === "GET") return state.engine ? Response.json([]) : Response.json({ code: "engine_unavailable", message: "engine unavailable" }, { status: 503 });
    if (path.endsWith("/files/list")) { expect(url.searchParams.get("path")).toBe("work"); return Response.json({ path: "work", entries: [], truncated: false }); }
    if (path.endsWith("/lawoss/documents")) return Response.json({ documents: [root, child, { ...root, id: "sibling", path: "other/b.pdf" }], nextOffset: null, untrusted: true });
    if (path.endsWith("/read")) {
      if (state.stale) return Response.json({ code: "document_stale", message: "source changed" }, { status: 409 });
      const selected = path.includes("/child/") ? child : root;
      return Response.json({ ...selected, text: "source text", pages: [{ page: 1, text: "source text", source: "native" }], offset: 0, nextOffset: null, untrusted: true });
    }
    if (path.endsWith("/session") && request.method === "POST") { bodies.push(await request.text()); return Response.json({ id: "created", directory: "/registered/root/work" }); }
    if (request.method === "PATCH" && path.endsWith("/session/created")) return Response.json({ id: "created" });
    if (path.endsWith("/prompt_async")) { bodies.push(await request.json()); return state.failSend ? Response.json({ code: "billing", message: "billing unavailable" }, { status: 402 }) : new Response(null, { status: 204 }); }
    return Response.json({ code: "unexpected", message: path }, { status: 500 });
  } });
  try { await run({ base: `http://127.0.0.1:${server.port}`, calls, state, bodies }); }
  finally { server.stop(true); }
}

function inputs(base: string) {
  const baseUrl = `${base}/workspace/remote-runtime/opencode`;
  const sdk = createClient(baseUrl, "/registered/root/work", { token: "fixture-token", mode: "legalwork" });
  const legalwork = createLegalworkServerClient({ baseUrl: base, token: "fixture-token" });
  const request = { projectId: "rem_app-project", caseDirectory: "work", sources: [root, child], outputLanguage: "cs" as const };
  return { queryClient: new QueryClient({ defaultOptions: { queries: { retry: false } } }), sdk, baseUrl, directory: "/registered/root/work", relative: "work", legalwork, workspaceId: "remote-runtime", model: { providerID: "chosen", modelID: "selected" }, request };
}

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
    create: async () => unwrap(await input.sdk.session.create({ directory: input.directory })).id,
    send: async (sessionID: string) => { const response = await input.sdk.session.promptAsync({ sessionID, parts: [{ type: "text", text: generationPrompt("cs", input.request.sources) }], model: input.model, agent: "selected-agent", variant: "selected-variant" }); if (response.error) throw new Error(JSON.stringify(response.error)); },
  };
  state.failSend = true;
  await expect(submitDocumentTask(task)).rejects.toThrow("billing");
  state.failSend = false;
  expect(await submitDocumentTask(task)).toBe("created");
  expect(calls.filter(call => call === "POST /workspace/remote-runtime/opencode/session")).toHaveLength(1);
  expect(calls.indexOf("GET /workspace/remote-runtime/opencode/session")).toBeLessThan(calls.indexOf("GET /workspace/remote-runtime/files/list"));
  expect(calls.indexOf("GET /workspace/remote-runtime/files/list")).toBeLessThan(calls.indexOf("POST /workspace/remote-runtime/opencode/session"));
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
