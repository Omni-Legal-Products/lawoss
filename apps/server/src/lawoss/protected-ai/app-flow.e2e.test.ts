import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { OpenCode } from "@opencode/client";
import { Database } from "bun:sqlite";
import { ApprovalService } from "../../approvals.js";
import { DocumentPreparation } from "../../document-preparation/service.js";
import { OcrManager } from "../../ocr/manager.js";
import { closeOrgPolicyRuntime } from "../../org-policy.js";
import { GLOBAL_PROVIDERS_ID, writeRuntimeOpencodeConfig } from "../../runtime-opencode-config-store.js";
import { startServer } from "../../server.js";
import type { ServerConfig } from "../../types.js";
import { LawossDocuments } from "../documents/service.js";
import { enforceAiBoundaries } from "../test-support/ai-boundaries.js";
import { fakeEngineV2, startRealEngineV2 } from "../test-support/fake-engine-v2.js";
import { nativeRow } from "../test-support/native-config.js";
import { fakeProtectedGuest, GUEST_DIRECTORY } from "../test-support/protected-guest.js";
import { removeTestDir } from "../test-support/remove-test-dir.js";
import { registerProtectedRuntime } from "./dispatch.js";
import { ProtectedDocumentRuntime } from "./runtime.js";

/**
 * Chránený dokumentový chat so zapnutými AI hranicami po celej ceste appky: fronta servera prijme
 * chránenú úlohu (ako ju posiela `sendProtectedDocumentTask` v appke), runtime chránenej AI ju doručí
 * hosťovi a udalosti, stav a zoznam chatov sa objavia v proxy v2 a v zozname klienta. Chat iného
 * klienta ostane neviditeľný a bežný chat ostane odmietnutý AI hranicami.
 *
 * Bez premennej: falošný engine v2 (`test-support/fake-engine-v2.ts`) a protokolový hosť
 * (`test-support/protected-guest.ts`). S `LEGALWORK_TEST_OPENCODE_BIN=<engine 2.1.4>`: skutočný engine v2
 * ako bežný engine aj ako hosť spustený priamo na hostiteľovi s pevnou konfiguráciou hosťa
 * (`resources/agent-sandbox/protected-engine.mjs`) a syntetickým modelom na loopbacku. Bez VM tento
 * test overuje smerovanie hostiteľa a skutočné tvary v2, nie izoláciu VM ani egress hosťa; zálohu
 * SQLite hosťa nahrádza syntetická databáza. Otvorenie relácie volá `runtime.open` ako trasa
 * `/workspace/:id/lawoss/documents/generation` (jej vstup overuje `server.e2e.test.ts`). Údaje sú syntetické.
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const TASK = "SYNTETICKÁ-ÚLOHA: zhrň vybraný podklad.";
const ANSWER = "SYNTETICKÁ-ODPOVEĎ-CHRÁNENÉHO-HOSŤA";

type Guest = { open: () => Promise<{ fetch: (request: Request) => Promise<Response>; stop: () => Promise<void> }>; release: () => void; held: Promise<void>; prompts: () => number };

/** A tiny real SQLite database stands in for the guest's consistent online backup. */
async function checkpoint(root: string) {
  const path = join(root, "guest-checkpoint.sqlite"), db = new Database(path, { create: true });
  db.exec("CREATE TABLE synthetic_checkpoint(value TEXT)"); db.close();
  const bytes = await readFile(path);
  return { bytes, sha256: createHash("sha256").update(bytes).digest("hex") };
}

/** Protocol-only guest: emits engine v2 status frames around a held turn. */
async function protocolGuest(root: string, sessionId: string): Promise<Guest> {
  let release = () => {}, entered = () => {}, prompts = 0, busy = false;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  const saved = await checkpoint(root);
  const guest = fakeProtectedGuest({ sessionId, title: "Protected document operation", checkpoint: saved,
    active: () => busy ? { [sessionId]: { type: "busy" } } : {},
    intercept: (request, path) => {
      if (request.method === "POST" && path.endsWith("/prompt")) {
        prompts++; busy = true;
        guest.emit({ type: "session.status", data: { sessionID: sessionId, status: { type: "busy" } }, location: { directory: GUEST_DIRECTORY } });
      }
      return undefined;
    },
    beforeTerminal: async () => {
      entered(); await gate; busy = false;
      guest.emit({ type: "session.status", data: { sessionID: sessionId, status: { type: "idle" } }, location: { directory: GUEST_DIRECTORY } });
    } });
  return { open: async () => guest.engine, release, held, prompts: () => prompts };
}

/** The actual engine v2 with the guest's fixed configuration, started on this host for the test.
 * Its private scratch directory is mapped to the guest's fixed path in both directions. */
async function hostGuest(bin: string, root: string): Promise<Guest> {
  let release = () => {}, entered = () => {}, prompts = 0;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const held = new Promise<void>(resolve => { entered = resolve; });
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "protected-synthetic", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const model = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const body = await request.text();
    if (body.includes("SYNTETICKÁ-ÚLOHA")) { prompts++; entered(); await gate; }
    return new Response(chunk({ role: "assistant", content: ANSWER }, null) + chunk({}, "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });
  cleanups.push(() => model.stop(true));
  const home = join(root, "guest-engine"), workspace = join(home, "workspace");
  await mkdir(workspace, { recursive: true });
  const scratch = await realpath(workspace);
  const permissions = [{ action: "*", resource: "*", effect: "deny" }];
  const engineConfig = { model: "protected-documents/fixture", default_agent: "legalwork", share: "disabled", update: "disable", warming: false, snapshots: false,
    lsp: false, formatter: false, mcp: { servers: {} }, skills: [], instructions: [], permissions, compaction: { auto: false },
    agents: { legalwork: { mode: "primary", description: "Protected LAWOSS document processing", permissions } },
    providers: { "protected-documents": { name: "Protected documents", package: "@opencode/ai/providers/openai-compatible",
      settings: { baseURL: `${model.url.origin}/v1`, apiKey: "synthetic-no-credential" }, models: { fixture: { name: "fixture", limit: { context: 100000, output: 4000 } } } } } };
  const saved = await checkpoint(root);
  // The runtime owns this worker: its own stop ends the engine after its final checkpoint. The
  // fallback is registered before the runtime's cleanup, so it runs only after the runtime closed.
  const owned: (() => Promise<unknown> | unknown)[] = [];
  const stop = async () => { for (const cleanup of owned.splice(0).reverse()) await cleanup(); };
  cleanups.push(stop);
  const toGuest = (text: string) => text.replaceAll(scratch, GUEST_DIRECTORY);
  const toHost = (text: string) => text.replaceAll(GUEST_DIRECTORY, scratch).replaceAll(encodeURIComponent(GUEST_DIRECTORY), encodeURIComponent(scratch));
  return { release, held, prompts: () => prompts, open: async () => {
    const engine = await startRealEngineV2(bin, home, owned, { OPENCODE_CONFIG_CONTENT: JSON.stringify(engineConfig), OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_FREE_MODELS: "true" });
    const authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
    return {
      stop,
      fetch: async (request: Request) => {
        const url = new URL(request.url);
        if (url.pathname === "/_protected/checkpoint") return new Response(new Uint8Array(saved.bytes), { headers: { "content-type": "application/octet-stream", "x-protected-sha256": saved.sha256 } });
        const body = request.method === "GET" || request.method === "HEAD" ? undefined : toHost(await request.text());
        const response = await fetch(`${engine.url}${toHost(url.pathname + url.search)}`, { method: request.method, signal: request.signal,
          headers: { authorization, ...(body ? { "content-type": "application/json" } : {}), accept: request.headers.get("accept") ?? "*/*" }, ...(body ? { body } : {}) });
        if (!response.body || [204, 205, 304].includes(response.status)) return response;
        if (!(response.headers.get("content-type") ?? "").includes("text/event-stream")) return new Response(toGuest(await response.text()), { status: response.status, headers: response.headers });
        // Whole SSE frames, so a path is never split across two chunks.
        let buffered = "";
        const decoder = new TextDecoder(), encoder = new TextEncoder();
        return new Response(response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
          transform(value, controller) {
            buffered += decoder.decode(value, { stream: true });
            const end = buffered.lastIndexOf("\n\n");
            if (end < 0) return;
            controller.enqueue(encoder.encode(toGuest(buffered.slice(0, end + 2)))); buffered = buffered.slice(end + 2);
          },
        })), { status: response.status, headers: response.headers });
      },
    };
  } };
}

async function office() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-protected-app-flow-")));
  cleanups.push(() => removeTestDir(root));
  const client = join(root, "prax", "Klient"), matter = join(client, "spis"), foreign = join(root, "prax", "Cudzí");
  await mkdir(matter, { recursive: true }); await mkdir(foreign, { recursive: true });
  await writeFile(join(matter, "podklad.txt"), "SYNTETICKÝ PODKLAD CHRÁNENÉHO SPISU");
  return { root, client, matter: await realpath(matter), foreign };
}

for (const [name, bin] of [["falošný engine v2 a protokolový hosť", undefined], ...(binary ? [["skutočný engine v2 (bežný aj hosť na hostiteľovi)", binary] as const] : [])] as const) {
  test(`${name}: so zapnutými AI hranicami fronta prijme chránenú úlohu, proxy ukáže jej udalosti, stav a chat a iný klient ho nevidí`, async () => {
    const folders = await office();
    // Ordinary engine shared by both clients, as the managed engine is.
    let engineUrl: string, auth: { opencodeUsername: string; opencodePassword: string } | undefined, createOrdinary: (directory: string) => Promise<string>;
    if (bin) {
      const engine = await startRealEngineV2(bin, join(folders.root, "engine"), cleanups);
      const sdk = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
      engineUrl = engine.url; auth = { opencodeUsername: engine.username, opencodePassword: engine.password };
      createOrdinary = async directory => (await sdk.session.create({ location: { directory }, title: "Bežný chat" })).id;
    } else {
      const engine = fakeEngineV2(); cleanups.push(() => engine.stop());
      engineUrl = engine.url; createOrdinary = async directory => engine.create({ id: "ses_ordinary", title: "Bežný chat", directory }).id;
    }
    const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engineUrl, ...auth });
    const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(folders.root, "server.json"), token: "client", hostToken: "host",
      approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient", folders.client), workspace("cudzi", folders.foreign)],
      authorizedRoots: [folders.client, folders.foreign], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
    const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
    process.env.LEGALWORK_DATA_DIR = join(folders.root, "data"); process.env.LEGALWORK_TOKEN_STORE = join(folders.root, "tokens.json");
    cleanups.push(() => { for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens })) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
    cleanups.push(() => closeOrgPolicyRuntime(config));
    // The host-side provider of the protected target: a literal loopback receiver (synthetic classification).
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => nativeRow({ provider: { fixture: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://127.0.0.1:47831/v1" }, models: { fixture: {} } } } }));
    cleanups.push(await enforceAiBoundaries(config));

    const ocr = new OcrManager(join(folders.root, "ocr")), preparation = new DocumentPreparation(ocr), documents = new LawossDocuments(config, preparation);
    const approvals = new ApprovalService(config.approval, async () => "allow");
    cleanups.push(async () => { approvals.dispose(); await documents.stop(); preparation.stop(); ocr.stop(); });
    const measurement = { engineSha256: "a".repeat(64), runtimeManifestSha256: "b".repeat(64), pluginSha256: "c".repeat(64), configSha256: "d".repeat(64), launcherSha256: "e".repeat(64) };
    const sessionHint = "ses_protectedAppFlow";
    const guest = bin ? await hostGuest(bin, folders.root) : await protocolGuest(folders.root, sessionHint);
    const runtime = new ProtectedDocumentRuntime({ config, approvals, documents, openEngine: guest.open,
      getGuestBundle: async () => ({ directory: folders.root, emptyDirectory: folders.root, measurements: measurement, currentBinding: async () => measurement }) });
    const unregister = registerProtectedRuntime(config, runtime);
    cleanups.push(async () => { guest.release(); unregister(); await runtime.close(); });
    const server = await startServer(config);
    cleanups.push(() => server.stop());
    const base = `http://127.0.0.1:${server.port}`;
    const headers = { authorization: "Bearer client", "x-legalwork-host-token": "host", "content-type": "application/json" };
    const call = async (path: string, init: RequestInit = {}) => {
      const response = await fetch(base + path, { ...init, headers });
      return { status: response.status, body: await response.json().catch(() => null) as any };
    };

    const [source] = await documents.prepare(config.workspaces[0]!, ["spis/podklad.txt"]);
    for (let i = 0; i < 300 && (await documents.list(config.workspaces[0]!))[0]?.status !== "readable"; i++) await Bun.sleep(10);
    const opened = await runtime.open({ workspaceId: "klient", caseDirectory: "spis", providerId: "fixture", modelId: "fixture", sources: [{ id: source!.id, hash: source!.hash }] }, AbortSignal.timeout(60_000));
    const protectedId = opened.session.id;
    if (!bin) expect(protectedId).toBe(sessionHint);
    expect(opened.session.location.directory).toBe(folders.matter);

    // AI hranice are on: an ordinary chat of the same client is refused before the engine.
    const ordinary = await createOrdinary(folders.client);
    const refused = await call(`/workspace/klient/opencode/api/session/${ordinary}/prompt`, { method: "POST", body: JSON.stringify({ text: "Bežná správa" }) });
    expect({ status: refused.status, code: refused.body?.code }).toEqual({ status: 403, code: "ai_transfer_denied" });

    // The live streams the app keeps open, through the proxy of each client.
    const frames = { klient: "", cudzi: "" };
    const readers: ReadableStreamDefaultReader<Uint8Array>[] = [];
    const controller = new AbortController();
    cleanups.push(async () => { controller.abort(); for (const reader of readers) await reader.cancel().catch(() => {}); });
    for (const id of ["klient", "cudzi"] as const) {
      const events = await fetch(`${base}/workspace/${id}/opencode/api/event`, { headers, signal: controller.signal });
      expect(events.status).toBe(200);
      const reader = events.body!.getReader(); readers.push(reader);
      const decoder = new TextDecoder();
      void (async () => { for (;;) { const next = await reader.read().catch(() => ({ done: true as const, value: undefined })); if (next.done) return; frames[id] += decoder.decode(next.value, { stream: true }); } })();
    }

    // The app's protected send (`sendProtectedDocumentTask`): queue entry UUID = engine message `msg_<hex>`.
    const queueId = "3f0c6a52-9d1e-4b7a-8c2f-5e4d3c2b1a09", messageId = `msg_${queueId.replaceAll("-", "")}`;
    const enqueue = { type: "enqueue", id: queueId,
      draft: { mode: "prompt", text: TASK, parts: [{ type: "text", text: TASK }], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", text: TASK, files: [], agents: [], skills: [], metadata: { legalworkPrompt: { visibleText: TASK, reminders: [] } }, model: { providerID: "fixture", id: "fixture" }, agent: "legalwork" } };
    // The direct dispatch stays refused (MČ 8. 11.); a foreign client cannot reach the chat at all.
    expect((await call(`/workspace/klient/sessions/${protectedId}/dispatch`, { method: "POST", body: JSON.stringify({ kind: "prompt", text: TASK }) })).body?.code).toBe("protected_session_dispatch");
    expect((await call(`/workspace/cudzi/sessions/${protectedId}/queue`, { method: "POST", body: JSON.stringify(enqueue) })).status).toBe(404);
    expect(guest.prompts()).toBe(0);
    const accepted = await call(`/workspace/klient/sessions/${protectedId}/queue`, { method: "POST", body: JSON.stringify(enqueue) });
    expect(accepted.status).toBe(200);
    expect(accepted.body.entries.map((entry: { id: string }) => entry.id)).toContain(queueId);

    // While the turn runs: the proxy status and both lists contain the protected chat of this client only.
    await guest.held;
    const active = async (id: string) => (await call(`/workspace/${id}/opencode/api/session/active`)).body?.data ?? {};
    let busy: Record<string, unknown> = {};
    for (let i = 0; i < 300 && !Object.hasOwn(busy, protectedId); i++) { busy = await active("klient"); if (!Object.hasOwn(busy, protectedId)) await Bun.sleep(20); }
    expect(Object.keys(busy)).toContain(protectedId);
    expect(Object.keys(await active("cudzi"))).not.toContain(protectedId);
    const listed = await call("/workspace/klient/sessions");
    expect(listed.body.items).toContainEqual(expect.objectContaining({ id: protectedId, location: expect.objectContaining({ directory: folders.matter }) }));
    expect(listed.body.items.map((item: { id: string }) => item.id)).toContain(ordinary);
    expect((await call("/workspace/cudzi/sessions")).body.items.map((item: { id: string }) => item.id)).not.toContain(protectedId);
    const proxied = await call(`/workspace/klient/opencode/api/session?${new URLSearchParams({ directory: folders.matter })}`);
    expect(proxied.body.data.map((item: { id: string }) => item.id)).toContain(protectedId);
    expect((await call(`/workspace/cudzi/opencode/api/session?${new URLSearchParams({ directory: folders.foreign })}`)).body.data.map((item: { id: string }) => item.id)).not.toContain(protectedId);
    expect((await call(`/workspace/cudzi/opencode/api/session/${protectedId}`)).status).toBe(404);

    guest.release();
    let queue: { completedIds: string[]; entries: Array<{ id: string; status: string; error?: string }> } = { completedIds: [], entries: [] };
    for (let i = 0; i < 600 && !queue.completedIds.includes(queueId); i++) {
      queue = (await call(`/workspace/klient/sessions/${protectedId}/queue`)).body;
      if (!queue.completedIds.includes(queueId)) await Bun.sleep(25);
    }
    expect(queue).toMatchObject({ completedIds: expect.arrayContaining([queueId]) });
    expect(guest.prompts()).toBe(1);
    for (let i = 0; i < 300 && Object.hasOwn(await active("klient"), protectedId); i++) await Bun.sleep(20);
    expect(Object.keys(await active("klient"))).not.toContain(protectedId);

    // The live stream of this client carried the protected chat's status with the host case directory;
    // the other client's stream never named it, and no frame exposed the guest scratch path.
    // Engine v2 reports a turn as `session.execution.*`; the protocol guest uses `session.status`.
    const terminal = bin ? '"session.execution.succeeded"' : '"type":"idle"';
    for (let i = 0; i < 300 && !frames.klient.includes(terminal); i++) await Bun.sleep(20);
    expect(frames.klient).toContain(protectedId);
    expect(frames.klient).toContain(terminal);
    if (bin) { expect(frames.klient).toContain('"session.execution.started"'); expect(frames.klient).toContain(ANSWER); expect(frames.klient).toContain(JSON.stringify(folders.matter)); }
    expect(frames.klient).not.toContain(GUEST_DIRECTORY);
    expect(frames.cudzi).not.toContain(protectedId);

    // The snapshot the app reconciles its document binding with: the queued message identity and the reply.
    const snapshot = await call(`/workspace/klient/sessions/${protectedId}/snapshot?limit=20`);
    expect({ status: snapshot.status, body: snapshot.status === 200 ? null : snapshot.body }).toEqual({ status: 200, body: null });
    const messages = JSON.stringify(snapshot.body.item.messages);
    expect(messages).toContain(messageId);
    if (bin) expect(messages).toContain(ANSWER);
    expect((await call(`/workspace/cudzi/sessions/${protectedId}/snapshot?limit=20`)).status).toBe(404);
  }, 180_000);
}
