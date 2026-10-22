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
import { applyFileOperations, planFileOperations } from "./file-operations.js";

/**
 * Alfa 2 B1 (N-8, N-15) with the shipped engine, the production permission map on a clean profile
 * (YOLO off) and the bundled OKF skills installed in a synthetic client folder:
 * - the engine lists roztried-spis with the narrowed description and loads its new text;
 * - the prepared first message (onboarding chatPrompt SK) → the documented overview path (load the skill,
 *   list and read files, answer with a table): no approval card and no change on disk;
 * - "súhlasím" → the documented move path: lawoss_files with the whole approved batch, exactly one card;
 *   declined → nothing changed; a new explicit approval → one new card, approved → disk matches the table;
 * - every request to the model carries the fixed citation rule from the okf-handoff plugin, unchanged.
 * The model is scripted: this proves the engine, skills, tools and cards, not that a real LLM follows the
 * skill (that is the D1 UI acceptance with a real model).
 * Opt-in: pnpm --filter legalwork-server build
 *   LAWOSS_TRIEDENIE_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/okf-triedenie-flow.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const repo = join(import.meta.dir, "../../../..");
const askSchema = z.array(z.object({ id: z.string(), sessionID: z.string(), permission: z.string(), patterns: z.array(z.string()), always: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional() }));
type EngineAsk = z.infer<typeof askSchema>[number];
type ToolCall = { tool: string; args: Record<string, unknown> };
const requestSchema = z.object({
  messages: z.array(z.object({ role: z.string(), content: z.unknown() })),
  tools: z.array(z.object({ function: z.object({ name: z.string(), description: z.string().optional(), parameters: z.unknown().optional() }) })).optional(),
});

async function tree(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (entry.name.startsWith(".")) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path); else out.push(relative(root, path));
    }
  };
  await walk(root);
  return out.sort();
}

test.skipIf(!binary || process.env.LAWOSS_TRIEDENIE_ENGINE !== "1")("a real engine: overview and proposal without a clone and without changes, moves only after approval via lawoss_files", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-triedenie-engine-")));
  const client = join(root, "C001-SYN-Tatran"); await mkdir(join(client, "Spor-najom"), { recursive: true });
  await writeFile(join(client, "zmluva-najom-SYN.txt"), "SYN nájomná zmluva medzi SYN Tatran a SYN Prenajímateľ, 1. 2. 2024.");
  await writeFile(join(client, "faktura-SYN-2024-01.txt"), "SYN faktúra za nájom 01/2024.");
  await writeFile(join(client, "Spor-najom", "vyzva-SYN.txt"), "SYN predžalobná výzva na zaplatenie nájomného.");
  // Bundled OKF skills as the app installs them (SKILL.md with name/description frontmatter).
  for (const [name, file] of [["roztried-spis", "SKILL.md"], ["usporiadaj-spis", "SKILL.md"], ["novy-spis", "SKILL.md"]] as const) {
    await mkdir(join(client, ".opencode", "skills", name), { recursive: true });
    await cp(join(repo, "lawoss/skills", name, file), join(client, ".opencode", "skills", name, "SKILL.md"));
  }
  const foundTextPath = join(repo, "apps/app/src/lawoss/domains/onboarding/found-text.ts");
  const foundText = z.object({ FOUND_TEXT: z.object({ sk: z.object({ chatPrompt: z.string() }) }) }).parse(await import(foundTextPath));
  const prompt = foundText.FOUND_TEXT.sk.chatPrompt.replace("{client}", JSON.stringify("C001 SYN Tatran"));

  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspace: WorkspaceInfo = { id: "client", name: "C001", path: client, preset: "starter", workspaceType: "local" };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [client], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };

  // Scripted model: per user turn, the n-th model request after the user message makes the n-th call of `script`.
  let script: ToolCall[] = [];
  let answer = "Hotovo.";
  const toolResults: string[] = [];
  const systems = new Set<string>();
  let skillDescription = "";
  let advertisedTools: string[] = [];
  const fixture = Bun.serve({ port: 0, idleTimeout: 120, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: workspace.id, path: client }] });
    try {
      if (path === "/workspace/client/lawoss/files/plan") {
        const body = z.object({ operations: z.unknown() }).parse(await request.json());
        return Response.json(await planFileOperations(config, workspace, body.operations));
      }
      if (path === "/workspace/client/lawoss/files/apply") {
        const body = z.object({ operations: z.unknown(), approved: z.unknown(), revision: z.string(), sessionID: z.string() }).parse(await request.json());
        return Response.json(await applyFileOperations(config, workspace, body.operations, body.approved, body.revision, body.sessionID));
      }
    } catch (error) {
      return Response.json({ code: error instanceof ApiError ? error.code : "failed", error: error instanceof Error ? error.message : String(error) }, { status: error instanceof ApiError ? error.status : 500 });
    }
    if (!path.endsWith("/chat/completions")) return Response.json({ code: "not_found" }, { status: 404 });
    const input = requestSchema.parse(await request.json());
    advertisedTools = (input.tools ?? []).map(tool => tool.function.name).sort();
    skillDescription = input.tools?.find(tool => tool.function.name === "skill")?.function.description ?? skillDescription;
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

  const plugins = ["lawoss-file-operations", "lawoss-okf-handoff"].map(name => pathToFileURL(join(import.meta.dir, `../../dist/opencode-plugins/${name}.js`)).href);
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
  const evidence: Record<string, unknown> = {};
  try {
    let ready = false;
    for (let i = 0; i < 300 && !ready && child.exitCode === null; i++) {
      try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
    }
    if (!ready) throw new Error("Engine did not start: " + (child.exitCode !== null ? await logs : "timed out"));
    const session = z.object({ id: z.string() }).parse(await (await fetch(engineBase + "/session", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json());
    const turn = async (text: string, reply: (ask: EngineAsk) => "once" | "reject") => {
      const cards: EngineAsk[] = [];
      const accepted = await fetch(`${engineBase}/session/${session.id}/prompt_async`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent: "legalwork", model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text }] }) });
      expect(accepted.ok).toBe(true);
      for (let i = 0; i < 400; i++) {
        for (const ask of askSchema.parse(await (await fetch(`${engineBase}/permission`)).json())) {
          if (cards.some(card => card.id === ask.id)) continue;
          cards.push(ask);
          await fetch(`${engineBase}/permission/${ask.id}/reply`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reply: reply(ask) }) });
        }
        const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(`${engineBase}/session/status`)).json());
        if (i > 5 && (status[session.id]?.type ?? "idle") === "idle") break;
        await Bun.sleep(100);
      }
      return cards;
    };
    const before = await tree(client);

    // 1. The prepared first message: load the skill, look at the folder, read a document, answer with a table.
    script = [
      { tool: "skill", args: { name: "roztried-spis" } },
      { tool: "glob", args: { pattern: "**/*" } },
      { tool: "read", args: { filePath: join(client, "zmluva-najom-SYN.txt") } },
    ];
    answer = "| Prípad | Dôvod | Súbory (odkiaľ → kam) |\n|---|---|---|\n| Nájom | ... | zmluva-najom-SYN.txt → Spor-najom/zmluva-najom-SYN.txt |\nSúhlasíte?";
    const overviewCards = await turn(prompt, () => "reject");
    const skillResult = toolResults.find(result => result.includes("Prehľad a návrh bez zápisu")) ?? "";
    expect(overviewCards).toEqual([]);
    expect(await tree(client)).toEqual(before);
    expect(skillResult).toContain("Skúšobný klon ani CLI na to netreba");
    expect(skillResult).toContain("`lawoss_files`");
    // Engine 1.18.29 lists available skills with their descriptions in the system prompt.
    const listing = [...systems, skillDescription].join("\n");
    expect(listing).toContain("roztried-spis");
    expect(listing).toContain("Na prehľad priečinka klienta ani na návrh prípadov v chate tento skill netreba");
    expect(listing).not.toContain("usporiadaj klienta do OKF");
    expect(advertisedTools).toContain("lawoss_files");
    evidence.overview = { cards: overviewCards.length, toolResults: toolResults.length, unchanged: true, tools: advertisedTools.filter(name => ["skill", "glob", "read", "lawoss_files", "bash"].includes(name)) };

    // 2. "Súhlasím": the whole approved batch in one lawoss_files call. Decline first: nothing changes.
    const batch: ToolCall = { tool: "lawoss_files", args: { description: "Presun podľa schválenej tabuľky", operations: [
      { operation: "move", from: "zmluva-najom-SYN.txt", to: "Spor-najom/zmluva-najom-SYN.txt" },
      { operation: "move", from: "faktura-SYN-2024-01.txt", to: "Spor-najom/faktura-SYN-2024-01.txt" },
    ] } };
    script = [batch];
    answer = "Karta bola zamietnutá, nič sa nezmenilo.";
    const declined = await turn("Súhlasím s tabuľkou.", () => "reject");
    expect(declined).toHaveLength(1);
    expect(declined[0]).toMatchObject({ permission: "lawoss_file_change", always: [] });
    expect(await tree(client)).toEqual(before);

    answer = "Presunuté: zmluva-najom-SYN.txt → Spor-najom/zmluva-najom-SYN.txt; faktura-SYN-2024-01.txt → Spor-najom/faktura-SYN-2024-01.txt.";
    const approved = await turn("Skús to znova, teraz to schválim.", () => "once");
    expect(approved.map(card => card.permission)).toEqual(["lawoss_file_change"]);
    expect(approved[0]?.metadata?.lawossFiles).toEqual([
      { operation: "move", kind: "file", from: "zmluva-najom-SYN.txt", to: "Spor-najom/zmluva-najom-SYN.txt" },
      { operation: "move", kind: "file", from: "faktura-SYN-2024-01.txt", to: "Spor-najom/faktura-SYN-2024-01.txt" },
    ]);
    const after = await tree(client);
    expect(after).toEqual(["Spor-najom/faktura-SYN-2024-01.txt", "Spor-najom/vyzva-SYN.txt", "Spor-najom/zmluva-najom-SYN.txt"]);
    expect(after).toHaveLength(before.length);
    expect(await readFile(join(client, "Spor-najom/zmluva-najom-SYN.txt"), "utf8")).toContain("SYN nájomná zmluva");
    const applied = toolResults.at(-1) ?? "";
    expect(applied).toContain('"complete":true');
    evidence.moves = { declinedCards: declined.length, approvedCards: approved.length, card: approved[0]?.metadata?.lawossFiles, before, after, result: applied.slice(0, 400) };

    // 3. The fixed citation rule reached the model, identical in every request (prompt cache).
    const citation = [...systems].filter(text => text.includes("Markdown link to the exact file"));
    expect(citation.length).toBe(1);
    evidence.citation = { systemVariants: systems.size, citationInSystem: citation.length === 1 };
    console.log(JSON.stringify(evidence));
  } finally {
    child.kill("SIGKILL"); await child.exited;
    fixture.stop(true);
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
