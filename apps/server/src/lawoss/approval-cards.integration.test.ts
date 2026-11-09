import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { explicitFileApprovals, managedPermissionRules } from "../agent-sandbox/engine-policy.js";
import { AgentSandboxService, type AgentPermissionRule } from "../agent-sandbox/service.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, readRuntimeOpencodeConfigText } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { applyFileOperations, LAWOSS_TRASH_FOLDER, planFileOperations } from "./file-operations.js";
import { writeYoloMode } from "./yolo-mode.js";
import { WIKI_AGENT_TICKET_PATH } from "./engine-agent-contract.js";
import { startScriptedEngine, type EngineCard } from "./test-support/scripted-engine.js";
import type { OpenCodeClient } from "@opencode/client";

/**
 * Alfa 2 acceptance with the shipped engine and the production permission map on a CLEAN profile
 * (no tool rule saved, YOLO off, protected execution off), synthetic files only:
 * - managed shell `mv`: exactly one card; declined → file unchanged; a new request in the SAME chat
 *   shows a new card; approved → renamed;
 * - `lawoss_files` rename: exactly one engine card (`lawoss_file_change`, readable plan, no "always");
 *   rejected → unchanged; a new request in the same chat → new card; approved → renamed, truthful result;
 * - "always" on a native edit card in chat A (engine keeps it for every chat of the client) does not
 *   approve `lawoss_files` in chat B: exactly one own card; approved delete goes to the Trash folder;
 * - YOLO on → `lawoss_files` renames without any card.
 * Engine v2 (2.1.4): production rules and built plugins through `test-support/scripted-engine.ts` (plugin tools offered
 * directly, not through Code Mode); a card is an engine permission request (`action`, `resources`, `save`). The fixture
 * derives the managed shell's rules from the engine's agent and configuration documents like the server
 * (`agentRules` in server.ts).
 * Opt-in: needs the built server plugins and an engine binary.
 *   pnpm --filter legalwork-server build
 *   LAWOSS_APPROVAL_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/approval-cards.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
test.skipIf(!binary || process.env.LAWOSS_APPROVAL_ENGINE !== "1")("a real engine: one card per change, a decline changes nothing, a new request asks again, YOLO asks nothing", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-approval-engine-")));
  const matter = join(root, "C001-Synteticka"); await mkdir(matter);
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "matter", name: "C001", path: matter, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [matter], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  // Host (managed shell) cards are answered from this queue, in order.
  const hostReplies: Array<"allow" | "deny"> = [];
  const hostCards: Array<{ action: string; summary: string }> = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { hostCards.push({ action: request.action, summary: request.summary }); approvals.respond(request.id, hostReplies.shift() ?? "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment stays off in this test."); } });
  let engineClient: OpenCodeClient | undefined;
  let call: { tool: string; args: Record<string, unknown> } = { tool: "", args: {} };
  const toolResults: string[] = [];
  let advertised: unknown;
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    if (new URL(request.url).pathname === WIKI_AGENT_TICKET_PATH) return Response.json({ secret: "fixture" });
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: matter }] });
    if (path.includes("/sandbox/session/")) return Response.json({ enabled: false, networkMode: "allow", shell: "zsh", platform: process.platform, cwd: matter });
    try {
      if (path === "/workspace/matter/sandbox/execute") {
        const command = z.object({ command: z.string(), write: z.boolean(), agent: z.string(), sessionID: z.string() }).parse(await request.json());
        // As the server derives them (server.ts `agentRules`): the engine's agent rules and its configuration documents.
        if (!engineClient) throw new Error("Engine not started");
        const location = { directory: matter };
        const agent = (await engineClient.agent.list({ location })).data.find(item => item.id === command.agent);
        const configured = (await engineClient.config.get({ location })).flatMap(entry => entry.type === "document"
          ? [...(entry.info.permissions ?? []), ...(entry.info.agents?.[command.agent]?.permissions ?? [])] : []);
        const rules: AgentPermissionRule[] = managedPermissionRules(explicitFileApprovals((agent?.permissions ?? [])
          .map(rule => ({ permission: rule.action === "shell" ? "bash" : rule.action, pattern: rule.resource, action: rule.effect })), configured), []);
        return Response.json(await service.run(workspace, { ...command, timeoutMs: 10000 }, { type: "host" }, request.signal, rules, [command.sessionID]));
      }
      if (path === "/workspace/matter/lawoss/files/plan") {
        const body = z.object({ operations: z.unknown() }).parse(await request.json());
        return Response.json(await planFileOperations(config, workspace, body.operations));
      }
      if (path === "/workspace/matter/lawoss/files/apply") {
        const body = z.object({ operations: z.unknown(), approved: z.unknown(), revision: z.string(), sessionID: z.string() }).parse(await request.json());
        return Response.json(await applyFileOperations(config, workspace, body.operations, body.approved, body.revision, body.sessionID));
      }
    } catch (error) {
      return Response.json({ code: error instanceof ApiError ? error.code : "failed", error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ApiError ? error.status : 500 });
    }
    // The model: on each new user message call the tool once; after the tool result, answer in text.
    const input = z.object({ messages: z.array(z.object({ role: z.string(), content: z.unknown() })), tools: z.array(z.object({ function: z.object({ name: z.string(), parameters: z.unknown().optional() }) })).optional() }).parse(await request.json());
    advertised ??= input.tools?.find(tool => tool.function.name === "lawoss_files")?.function.parameters;
    const last = input.messages.at(-1);
    if (last?.role === "tool") toolResults.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    const invoke = last?.role === "user" && (input.tools ?? []).some(tool => tool.function.name === call.tool);
    const delta = invoke ? { tool_calls: [{ index: 0, id: `call_${toolResults.length}_${Date.now()}`, type: "function", function: { name: call.tool, arguments: JSON.stringify(call.args) } }] } : { content: "Hotovo." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, invoke ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  const engine = async (phase: string) => {
    const cleanups: (() => Promise<unknown> | unknown)[] = [];
    try {
      // A new engine per phase reads the current production rules (YOLO is part of them).
      const started = await startScriptedEngine({ binary, config, workspaceId: workspace.id, home: join(root, `engine-${phase}`), cleanups,
        plugins: ["legalwork-sandbox", "lawoss-file-operations"], pluginIds: ["legalwork.sandbox", "lawoss.file-operations"],
        serverUrl: fixture.url.origin, modelUrl: fixture.url.origin + "/v1" });
      engineClient = started.client;
      let session = await started.chat(matter);
      /** One user turn in the current chat; every engine card is recorded and answered by `reply`. */
      const turn = (text: string, reply: (card: EngineCard) => "once" | "reject" | "always") => session.turn(text, reply);
      return { turn, switchChat: async () => { session = await started.chat(matter); }, stop: async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); } };
    } catch (error) { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); throw error; }
  };

  const evidence: Record<string, unknown> = {};
  try {
    // A clean profile: nothing saved for tools.
    expect(await readRuntimeOpencodeConfigText(config, GLOBAL_TOOL_PERMISSIONS_ID)).toBeNull();

    // 1. Managed shell `mv`, same chat: decline, then a new explicit request, approve.
    await writeFile(join(matter, "poznamky.txt"), "SYN poznamky");
    call = { tool: "legalwork_shell", args: { command: "mv poznamky.txt SYN-overenie.txt", description: "Premenuj poznámky", write: true } };
    const shell = await engine("shell");
    try {
      hostReplies.push("deny");
      const declinedCards = await shell.turn("Premenuj poznamky.txt na SYN-overenie.txt.", () => "reject");
      expect(declinedCards).toEqual([]);
      expect(hostCards.map(card => card.action)).toEqual(["sandbox.bash"]);
      expect(await readdir(matter)).toEqual(["poznamky.txt"]);
      const declinedResult = toolResults.at(-1) ?? "";
      expect(declinedResult).toContain("sandbox_permission_declined");
      expect(declinedResult).toContain("call the tool again so they see a new approval card");

      hostReplies.push("allow");
      expect(await shell.turn("Skús to prosím znova, teraz to schválim.", () => "reject")).toEqual([]);
      expect(hostCards.map(card => card.action)).toEqual(["sandbox.bash", "sandbox.bash"]);
      expect(await readFile(join(matter, "SYN-overenie.txt"), "utf8")).toBe("SYN poznamky");
      expect(await readdir(matter)).toEqual(["SYN-overenie.txt"]);
      evidence.shell = { hostCards: hostCards.map(card => card.action), declinedResult: declinedResult.slice(0, 400), files: await readdir(matter) };
    } finally { await shell.stop(); }

    // 2. lawoss_files rename, same chat: reject, then a new explicit request, approve.
    await writeFile(join(matter, "zmluva.txt"), "SYN zmluva");
    hostCards.length = 0;
    call = { tool: "lawoss_files", args: { operations: [{ operation: "move", from: "zmluva.txt", to: "01_Zmluva.txt" }], description: "Premenovanie zmluvy" } };
    const files = await engine("files");
    try {
      const rejected = await files.turn("Premenuj zmluva.txt na 01_Zmluva.txt.", () => "reject");
      expect(rejected).toHaveLength(1);
      // Its own permission: an "always" on a native edit card (kept for every chat of the client) never covers it.
      expect(rejected[0]).toMatchObject({ action: "lawoss_file_change", resources: ["zmluva.txt", "01_Zmluva.txt"], save: [] });
      expect(rejected[0].metadata?.lawossFiles).toEqual([{ operation: "move", kind: "file", from: "zmluva.txt", to: "01_Zmluva.txt" }]);
      expect(hostCards).toEqual([]);
      expect((await readdir(matter)).sort()).toEqual(["SYN-overenie.txt", "zmluva.txt"]);
      const rejectedResult = toolResults.at(-1) ?? "";

      const approved = await files.turn("Skús to znova, schválim to.", () => "once");
      expect(approved).toHaveLength(1);
      expect(approved[0]?.action).toBe("lawoss_file_change");
      expect((await readdir(matter)).sort()).toEqual(["01_Zmluva.txt", "SYN-overenie.txt"]);
      expect(await readFile(join(matter, "01_Zmluva.txt"), "utf8")).toBe("SYN zmluva");
      const approvedResult = toolResults.at(-1) ?? "";
      expect(approvedResult).toContain('"status":"done"');
      expect(approvedResult).toContain('"complete":true');
      evidence.files = { rejectedCards: rejected.map(card => ({ action: card.action, resources: card.resources, save: card.save, metadata: card.metadata })),
        rejectedResult: rejectedResult.slice(0, 300), approvedCards: approved.length, approvedResult: approvedResult.slice(0, 300), files: (await readdir(matter)).sort() };
    } finally { await files.stop(); }

    // 3. Review C2: "always" on a native edit card in chat A must not approve lawoss_files in chat B.
    await writeFile(join(matter, "dodatok.txt"), "SYN dodatok");
    const crossChat = await engine("cross-chat");
    try {
      call = { tool: "write", args: { path: join(matter, "poznamka.md"), content: "SYN poznamka" } };
      const chatA = await crossChat.turn("Zapíš poznámku.", () => "always");
      expect(chatA.map(card => ({ action: card.action, save: card.save }))).toEqual([{ action: "edit", save: ["*"] }]);
      expect(await readFile(join(matter, "poznamka.md"), "utf8")).toBe("SYN poznamka");
      await crossChat.switchChat();
      call = { tool: "lawoss_files", args: { operations: [{ operation: "delete", path: "dodatok.txt" }] } };
      const chatB = await crossChat.turn("Zmaž dodatok.txt.", () => "reject");
      // Exactly one card, its own, and nothing moved.
      expect(chatB.map(card => ({ action: card.action, save: card.save }))).toEqual([{ action: "lawoss_file_change", save: [] }]);
      expect(chatB[0]?.metadata?.lawossFiles).toEqual([{ operation: "delete", kind: "file", from: "dodatok.txt" }]);
      expect(await readFile(join(matter, "dodatok.txt"), "utf8")).toBe("SYN dodatok");
      // Approved in the same chat: recoverable, kept in the client's own Trash folder (no desktop host here).
      const approvedB = await crossChat.turn("Áno, zmaž ho.", () => "once");
      expect(approvedB.map(card => card.action)).toEqual(["lawoss_file_change"]);
      const trashResult = toolResults.at(-1) ?? "";
      expect(trashResult).toContain(`"trash":"${LAWOSS_TRASH_FOLDER}/`);
      const [batch] = await readdir(join(matter, LAWOSS_TRASH_FOLDER));
      expect(await readFile(join(matter, LAWOSS_TRASH_FOLDER, batch!, "dodatok.txt"), "utf8")).toBe("SYN dodatok");
      evidence.crossChat = { chatA: chatA.map(card => ({ action: card.action, save: card.save })),
        chatB: chatB.map(card => ({ action: card.action, save: card.save, metadata: card.metadata })), approvedB: approvedB.length, trashResult: trashResult.slice(0, 300) };
    } finally { await crossChat.stop(); }

    // 4. YOLO on: the same tool renames without any card.
    await writeYoloMode(config, true);
    call = { tool: "lawoss_files", args: { operations: [{ operation: "move", from: "01_Zmluva.txt", to: "02_Zmluva.txt" }] } };
    const yolo = await engine("yolo");
    try {
      const cards = await yolo.turn("Premenuj 01_Zmluva.txt na 02_Zmluva.txt.", () => "reject");
      expect(cards).toEqual([]);
      expect(hostCards).toEqual([]);
      const visible = (await readdir(matter)).filter(name => !name.startsWith(".")).sort();
      expect(visible).toEqual(["02_Zmluva.txt", "SYN-overenie.txt", "poznamka.md"]);
      evidence.yolo = { cards: cards.length, hostCards: hostCards.length, files: visible };
    } finally { await yolo.stop(); }
    // The wire schema the model sees: a flat object every provider accepts (no anyOf/oneOf).
    expect(JSON.stringify(advertised)).toContain('"operations"');
    expect(JSON.stringify(advertised)).not.toMatch(/anyOf|oneOf/);
    evidence.schema = advertised;
    console.log(JSON.stringify(evidence));
  } finally {
    fixture.stop(true); service.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
