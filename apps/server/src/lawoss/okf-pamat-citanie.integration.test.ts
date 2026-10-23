import { expect, test } from "bun:test";
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { closeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { readMatterMemoryForChat } from "./matter-memory.js";

/**
 * Alfa 2 (N-A3-3, MČ 23. 10. 2026: čítanie pamäte bez karty) with the shipped engine, the production permission
 * map on a clean profile (YOLO off) and the bundled okf-pamat skill installed in a synthetic client folder:
 * a case summary loads the skill, reads the preamble and the memory through lawoss_memory, looks at the case
 * folder with glob and read, and is refused (without a name and without a card) for another client's case.
 * Zero approval cards, no change to the client's files; the ban-list and the case facts reach the model.
 * The model is scripted: this proves the engine, skill, tool and permissions, not that a real LLM follows the skill.
 * Opt-in: pnpm --filter legalwork-server build
 *   LAWOSS_PAMAT_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/okf-pamat-citanie.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const repo = join(import.meta.dir, "../../../..");
const askSchema = z.array(z.object({ id: z.string(), sessionID: z.string(), permission: z.string(), patterns: z.array(z.string()) }));
type ToolCall = { tool: string; args: Record<string, unknown> };
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional(),
});
const D = "2026-10-23";
const record = (id: string, type: string, layer: string, title: string, description: string, truth: string, status = "active") =>
  `---\nokf: 1\nid: ${id}\ntype: ${type}\ntitle: ${title}\ndescription: ${description}\nlayer: ${layer}\njurisdiction: sk\nstatus: ${status}\ncreated: ${D}\nupdated: ${D}\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- ${D} — založené\n`;

async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name), rel = relative(root, path);
      if (rel === ".opencode" || rel === ".legalwork") continue;
      if (entry.isDirectory()) { out[`${rel}/`] = "dir"; await walk(path); } else out[rel] = Buffer.from(await readFile(path)).toString("base64");
    }
  };
  await walk(root);
  return out;
}

test.skipIf(!binary || process.env.LAWOSS_PAMAT_ENGINE !== "1")("a real engine: a case summary reads memory and folders without any approval card", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-pamat-engine-")));
  const memory = async (dir: string, file: string, text: string) => { await mkdir(join(dir, "memory"), { recursive: true }); await writeFile(join(dir, "memory", file), text); };
  await memory(join(root, "Office"), "A-301.md", record("A-301", "authority", "L3", "Prekonaný výklad SYN", "SYN 1 VSPH 1/2024 necitovať", "t", "banned"));
  const client = join(root, "C001-SYN-Tatran"), matter = join(client, "Spisy", "M001");
  await mkdir(join(matter, "01_Podklady", "IN-001"), { recursive: true });
  await writeFile(join(client, "client.md"), "---\ntype: klient\n---\n");
  await memory(matter, "M-001.md", record("M-001", "matter", "L2", "Stav veci SYN", "SYN nájom", "SYN fakt 7311: nájomca je v omeškaní."));
  await writeFile(join(matter, "VSTUPY.md"), "# Vstupy\n\n| SYN-IN-001 | pending |\n");
  await writeFile(join(matter, "01_Podklady", "IN-001", "zmluva-SYN.txt"), "SYN nájomná zmluva");
  const other = join(root, "C002-SYN-Hron"), otherMatter = join(other, "Spisy", "M002");
  await mkdir(otherMatter, { recursive: true });
  await writeFile(join(other, "client.md"), "---\ntype: klient\n---\n");
  await memory(otherMatter, "M-002.md", record("M-002", "matter", "L2", "Cudzí SYN", "iný klient", "SECRET-OTHER-5502"));
  // The bundled skill as the app installs it.
  await mkdir(join(client, ".opencode", "skills", "okf-pamat"), { recursive: true });
  await cp(join(repo, "lawoss/okf-pamat/SKILL.md"), join(client, ".opencode", "skills", "okf-pamat", "SKILL.md"));

  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "client", name: "C001", path: client, preset: "starter", workspaceType: "local" };
  const otherWorkspace: WorkspaceInfo = { id: "other", name: "C002", path: other, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace, otherWorkspace], authorizedRoots: [client, other], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };

  let script: ToolCall[] = [];
  const answer = "Zhrnutie spisu M001.";
  const toolResults: string[] = [];
  const systems = new Set<string>();
  let advertisedTools: string[] = [];
  const memoryRequests: unknown[] = [];
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: client }, { id: otherWorkspace.id, path: other }] });
    if (path === "/workspace/client/lawoss/memory/read") {
      try {
        const body: unknown = await request.json();
        memoryRequests.push(body);
        return Response.json(await readMatterMemoryForChat(config, workspace, body));
      } catch (error) {
        return Response.json({ code: error instanceof ApiError ? error.code : "failed", message: error instanceof Error ? error.message : String(error) }, { status: error instanceof ApiError ? error.status : 500 });
      }
    }
    if (!path.endsWith("/chat/completions")) return Response.json({ code: "not_found" }, { status: 404 });
    const input = requestSchema.parse(await request.json());
    advertisedTools = (input.tools ?? []).map(tool => tool.function.name).sort();
    for (const message of input.messages) if (message.role === "system") systems.add(typeof message.content === "string" ? message.content : JSON.stringify(message.content));
    const lastUser = input.messages.map(message => message.role).lastIndexOf("user");
    const since = input.messages.slice(lastUser + 1).filter(message => message.role === "tool");
    const last = input.messages.at(-1);
    if (last?.role === "tool") toolResults.push(typeof last.content === "string" ? last.content : JSON.stringify(last.content));
    const next = script[since.length];
    const delta = next ? { tool_calls: [{ index: 0, id: `call_${toolResults.length}_${Date.now()}`, type: "function", function: { name: next.tool, arguments: JSON.stringify(next.args) } }] } : { content: answer };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, next ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  const plugins = ["lawoss-memory-tools"].map(name => pathToFileURL(join(import.meta.dir, `../../dist/opencode-plugins/${name}.js`)).href);
  const production = await buildLegalworkRuntimeConfigObject(config, workspace.id);
  const file = join(root, "config.json");
  await writeFile(file, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
    provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
    plugin: plugins, permission: production.permission, agent: production.agent, experimental: production.experimental, skills: production.skills, lsp: false, formatter: false }));
  const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port;
  reservation.stop(true);
  const child = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: client, env: {
    ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
    OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: file, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
    LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "fixture",
  }, stdout: "pipe", stderr: "pipe" });
  const logs = new Response(child.stderr).text();
  const engineBase = `http://127.0.0.1:${port}`;
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready && child.exitCode === null; i++) {
      try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
    }
    if (!ready) throw new Error("Engine did not start: " + (child.exitCode !== null ? await logs : "timed out"));
    const session = z.object({ id: z.string() }).parse(await (await fetch(engineBase + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json());
    const before = await tree(client);
    script = [
      { tool: "skill", args: { name: "okf-pamat" } },
      { tool: "lawoss_memory", args: { action: "preamble", matter: "Spisy/M001" } },
      { tool: "lawoss_memory", args: { action: "read", matter: "Spisy/M001" } },
      { tool: "glob", args: { pattern: "Spisy/M001/**/*" } },
      { tool: "read", args: { filePath: join(matter, "01_Podklady", "IN-001") } },
      { tool: "lawoss_memory", args: { action: "read", matter: otherMatter } },
    ];
    const cards: unknown[] = [];
    const accepted = await fetch(`${engineBase}/session/${session.id}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ agent: "legalwork", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Zhrň spis M001." }] }) });
    expect(accepted.ok).toBe(true);
    for (let i = 0; i < 400; i++) {
      for (const ask of askSchema.parse(await (await fetch(`${engineBase}/permission`)).json())) {
        if (cards.some(card => JSON.stringify(card) === JSON.stringify(ask))) continue;
        cards.push(ask);
        await fetch(`${engineBase}/permission/${ask.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: "reject" }) });
      }
      const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(`${engineBase}/session/status`)).json());
      if (i > 5 && (status[session.id]?.type ?? "idle") === "idle") break;
      await Bun.sleep(100);
    }
    const evidence = { cards, toolResults: toolResults.map(result => result.slice(0, 300)), memoryRequests,
      tools: advertisedTools.filter(name => ["lawoss_memory", "glob", "grep", "list", "read", "bash", "legalwork_shell", "skill"].includes(name)) };
    console.log(JSON.stringify(evidence));
    expect(cards).toEqual([]);
    expect(advertisedTools).toContain("lawoss_memory");
    expect(toolResults).toHaveLength(script.length);
    const [skill, preamble, read, glob, folder, foreign] = toolResults;
    expect(skill).toContain("lawoss_memory");
    expect(preamble).toContain("Necitovať");
    expect(preamble).toContain("Prekonaný výklad SYN");
    expect(read).toContain("SYN fakt 7311");
    expect(read).toContain("SYN-IN-001");
    expect(glob).toContain("zmluva-SYN.txt");
    expect(folder).toContain("zmluva-SYN.txt");
    expect(foreign).toContain("memory_folder_not_own");
    expect(foreign).not.toContain("SECRET-OTHER");
    expect(foreign).not.toContain("Hron\"");
    expect(memoryRequests).toEqual([
      { action: "preamble", matter },
      { action: "read", matter },
      { action: "read", matter: otherMatter },
    ]);
    expect(await tree(client)).toEqual(before);
    // The fixed guidance reached the model: memory and folder listing without the shell.
    const system = [...systems].join("\n");
    expect(system).toContain("read it with lawoss_memory");
    expect(system).toContain("instead of ls");
  } finally {
    child.kill("SIGKILL"); await child.exited;
    fixture.stop(true);
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
