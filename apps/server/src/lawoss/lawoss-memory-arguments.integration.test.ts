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
 * #481: lawoss_memory called by the model through the shipped engine 2.1.4 with an unknown argument (caseFolder instead
 * of matter) is refused with the actionable text; nothing is read, so the client's root is never reported as the case.
 * #526: the model gets the schema without additionalProperties (as every other tool), yet the engine's dropping of the
 * undeclared key does not turn the call into a read of the chat's folder.
 * Synthetic data only; the model is scripted.
 * Opt-in: pnpm --filter legalwork-server build
 *   LEGALWORK_TEST_OPENCODE_BIN=<engine> pnpm --filter legalwork-server exec bun test src/lawoss/lawoss-memory-arguments.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.object({ function: z.object({ name: z.string(), parameters: z.record(z.string(), z.unknown()).optional() }) })).optional(),
});

test.skipIf(!binary)("a real engine: lawoss_memory with caseFolder is refused and reads nothing", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-memory-args-")));
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
  const memoryRequests: unknown[] = [];
  const toolResults: string[] = [];
  const offered: Record<string, unknown>[] = [];
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === WIKI_AGENT_TICKET_PATH) return Response.json({ secret: "fixture" });
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: client }] });
    if (path === "/workspace/client/lawoss/memory/read") { const body: unknown = await request.json(); memoryRequests.push(body); return Response.json(await readMatterMemoryForChat(config, workspace, body)); }
    if (!path.endsWith("/chat/completions")) return Response.json({ code: "not_found" }, { status: 404 });
    const input = requestSchema.parse(await request.json());
    for (const tool of input.tools ?? []) if (tool.function.name === "lawoss_memory" && tool.function.parameters) offered.push(tool.function.parameters);
    const last = input.messages.at(-1);
    if (last?.role !== "tool") return scriptedCompletion({ name: "lawoss_memory", args: { action: "read", caseFolder: "Spisy/M001" }, id: "call_case_folder" });
    toolResults.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    return scriptedCompletion(undefined);
  } });
  const cleanups: (() => Promise<unknown> | unknown)[] = [];
  try {
    const { chat } = await startScriptedEngine({ binary, config, workspaceId: workspace.id, home: join(root, "engine"), cleanups,
      plugins: ["lawoss-memory-tools"], pluginIds: ["lawoss.memory-tools"],
      serverUrl: fixture.url.origin, modelUrl: fixture.url.origin + "/v1" });
    const session = await chat(client);
    await session.turn("Čo je v pamäti spisu M001?");
    console.log(JSON.stringify({ toolResults: toolResults.map(result => result.slice(0, 300)), memoryRequests }));
    expect(toolResults).toHaveLength(1);
    expect(toolResults[0]).toContain("memory_arguments");
    expect(toolResults[0]).toContain("caseFolder");
    expect(toolResults[0]).not.toContain("SYN fakt 4721");
    expect(memoryRequests).toEqual([]);
    expect(offered.length).toBeGreaterThan(0);
    for (const parameters of offered) {
      expect(parameters).not.toHaveProperty("additionalProperties");
      expect(Object.keys(z.record(z.string(), z.unknown()).parse(parameters.properties)).sort()).toEqual(["action", "matter", "offset"]);
    }
  } finally {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    fixture.stop(true);
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
