import { expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { closeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { WIKI_AGENT_TICKET_PATH } from "./engine-agent-contract.js";
import { readMatterMemoryForChat } from "./matter-memory.js";
import { scriptedCompletion, startScriptedEngine } from "./test-support/scripted-engine.js";

/**
 * #472: the fixed system texts of LAWOSS plugins tell the model to call lawoss_memory, lawoss_memory_write,
 * lawoss_memory_deadline, lawoss_new_client, lawoss_integrations and lawoss_files by name. The shipped engine 2.1.4
 * offers a plugin tool to the model by name only when it opts out of Code Mode; otherwise it exists only inside
 * `execute` and a direct call ends with "No tool named … is currently available". Unlike the other engine tests, the
 * plugins keep their own registration here (no test plugin that offers every tool directly).
 * #573: the same holds for legalwork_shell, legalwork_webfetch and legalwork_websearch (sandbox guidance, OKF skill
 * commands), lawoss_documents_* (linked folders, roztried-spis) and the view tools (LAWOSS visual reports).
 * #578: the editor core of legalwork-extensions-preview (inapp_documents_*, Word reading, suggest_change, comments and
 * tracked changes) is direct; the other inapp_* tools stay in Code Mode and the texts call them as tools.inapp_….
 * Synthetic data only; the model is scripted.
 * Opt-in: pnpm --filter legalwork-server build
 *   LEGALWORK_TEST_OPENCODE_BIN=<engine> pnpm --filter legalwork-server exec bun test src/lawoss/plugin-tools-direct.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const NAMED_IN_SYSTEM_TEXT = ["lawoss_files", "lawoss_integrations", "lawoss_memory", "lawoss_memory_deadline", "lawoss_memory_write", "lawoss_new_client",
  "legalwork_shell", "legalwork_webfetch", "legalwork_websearch", "lawoss_documents_export", "lawoss_documents_list", "lawoss_documents_prepare",
  "lawoss_documents_read", "lawoss_documents_validate", "view_catalog", "view_create", "view_list", "view_read", "view_update",
  "inapp_documents_open", "inapp_documents_list", "inapp_documents_select", "inapp_docx_read_document", "inapp_docx_find_text",
  "inapp_docx_suggest_change", "inapp_docx_add_comment", "inapp_docx_read_comments", "inapp_docx_reply_comment",
  "inapp_docx_read_changes", "inapp_docx_accept_changes", "inapp_docx_reject_changes"];
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.looseObject({ function: z.looseObject({ name: z.string() }) })).optional(),
});

test.skipIf(!binary)("a real engine offers the LAWOSS tools its system texts name, and runs a direct call", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-direct-tools-")));
  const client = join(root, "C001-SYN-Tatran"), matter = join(client, "Spisy", "M001");
  await mkdir(join(matter, "memory"), { recursive: true });
  await writeFile(join(client, "client.md"), "---\ntype: klient\n---\n");
  await writeFile(join(matter, "memory", "M-001.md"), "---\nokf: 1\nid: M-001\ntype: matter\ntitle: Stav veci SYN\ndescription: SYN\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: 2026-11-16\nupdated: 2026-11-16\n---\n\n## Truth\n\nSYN fakt 4721.\n\n## History\n\n- 2026-11-16 — založené\n");
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "client", name: "C001", path: client, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [client], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  let advertised: string[] = [];
  let editorDefinitions = 0;
  const toolResults: string[] = [];
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === WIKI_AGENT_TICKET_PATH) return Response.json({ secret: "fixture" });
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: client }] });
    if (path === "/workspace/client/lawoss/memory/read") return Response.json(await readMatterMemoryForChat(config, workspace, await request.json()));
    if (path === "/workspace/client/sandbox/execute") return Response.json({ output: "SYN shell 5813\n", exitCode: 0, truncated: false, sandbox: "host" });
    if (!path.endsWith("/chat/completions")) return Response.json({ code: "not_found" }, { status: 404 });
    const input = requestSchema.parse(await request.json());
    advertised = (input.tools ?? []).map(tool => tool.function.name);
    editorDefinitions = (input.tools ?? []).filter(tool => tool.function.name.startsWith("inapp_")).reduce((total, tool) => total + JSON.stringify(tool).length, 0);
    const last = input.messages.at(-1);
    const prompt = JSON.stringify(input.messages.filter(message => message.role === "user").at(-1)?.content ?? "");
    if (last?.role !== "tool") return scriptedCompletion(prompt.includes("node --version")
      ? { name: "legalwork_shell", args: { command: "node --version", description: "Verzia Node" }, id: "call_direct_shell" }
      : prompt.includes("dokumenty")
        ? { name: "inapp_documents_list", args: {}, id: "call_direct_editor" }
        : { name: "lawoss_memory", args: { action: "read", matter: "Spisy/M001" }, id: "call_direct_memory" });
    toolResults.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    return scriptedCompletion(undefined);
  } });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  try {
    const { chat } = await startScriptedEngine({ binary, config, workspaceId: workspace.id, home: join(root, "engine"), cleanups, directTools: false,
      plugins: ["lawoss-memory-tools", "lawoss-file-operations", "legalwork-sandbox", "legalwork-project-tools", "lawoss-view-tools", "legalwork-extensions-preview"],
      pluginIds: ["lawoss.memory-tools", "lawoss.file-operations", "legalwork.sandbox", "legalwork.project", "lawoss.view-tools", "legalwork.extensions"],
      serverUrl: fixture.url.origin, modelUrl: fixture.url.origin + "/v1" });
    const session = await chat(client);
    await session.turn("Čo je v pamäti spisu M001?");
    console.log(JSON.stringify({ advertised, editorDefinitions, toolResults: toolResults.map(result => result.slice(0, 200)) }));
    expect(advertised).toEqual(expect.arrayContaining(NAMED_IN_SYSTEM_TEXT));
    expect(advertised).not.toContain("inapp_docx_edit");
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).not.toContain("No tool named");
    expect(toolResults[0]).toContain("SYN fakt 4721");
    await session.turn("Spusti node --version.");
    expect(toolResults).toHaveLength(2);
    expect(toolResults[1]).not.toContain("No tool named");
    expect(toolResults[1]).toContain("SYN shell 5813");
    await session.turn("Aké dokumenty má táto úloha otvorené?");
    expect(toolResults).toHaveLength(3);
    expect(toolResults[2]).not.toContain("No tool named");
  } finally {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    fixture.stop(true);
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
