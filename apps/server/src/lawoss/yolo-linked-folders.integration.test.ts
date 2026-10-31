import { expect, test } from "bun:test";
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { explicitFileApprovals, managedPermissionRules } from "../agent-sandbox/engine-policy.js";
import { AgentSandboxService, type AgentPermissionRule } from "../agent-sandbox/service.js";
import { buildLegalworkRuntimeConfigObject } from "../legalwork-runtime-config.js";
import { closeRuntimeOpencodeConfig, GLOBAL_TOOL_PERMISSIONS_ID, runtimeStorageDir, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { linkedFoldersMapPath, writeLinkedFoldersMap } from "./linked-folders.js";
import { parseLinkedFoldersMap } from "./linked-folders-rules.js";
import { writeYoloMode, yoloModeActive, yoloShellAgentRules } from "./yolo-mode.js";

/**
 * YOLO Mode (#198) a pripojené priečinky klienta (#199) spolu v pribalenom engine: produkčná mapa
 * oprávnení (desktop: spravovaný shell, chránené prostredie vypnuté), oba produkčné pluginy
 * (`legalwork-sandbox`, `lawoss-linked-folders`) a mapa pripojených priečinkov zo servera.
 * Klient A má pripojený priečinok L mimo svojho koreňa, klient B nie.
 * - YOLO vypnutý: chat A číta L bez otázky (plugin), `mv` z A do L sa pýta (`sandbox.bash`), odmietnuté, nič sa nepresunie.
 * - YOLO zapnutý: chat A presunie súbor z A do L bez otázky, v L sú tie isté bajty. Nepripojený priečinok mimo klientov
 *   číta bez karty (odpovie plugin), priečinok klienta B len po karte (rozhodnutie MČ 31. 10. 2026).
 * - YOLO zapnutý, plánovaný beh: stále sa pýta, nič sa nepresunie.
 * - YOLO znova vypnutý: chat B sa pri čítaní L pýta (ochrana medzi klientmi platí aj po prepnutí); A číta L ďalej bez otázky.
 * Voliteľný: potrebuje zostavené pluginy servera a binárku enginu.
 *   pnpm --filter legalwork-server build
 *   LAWOSS_YOLO_ENGINE=1 LEGALWORK_TEST_OPENCODE_BIN=/Applications/LAWOSS.app/Contents/Resources/sidecars/opencode \
 *     pnpm --filter legalwork-server exec bun test src/lawoss/yolo-linked-folders.integration.test.ts
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const ruleSchema = z.object({ permission: z.string(), pattern: z.string(), action: z.enum(["allow", "ask", "deny"]) });
const agentRuleSchema = z.array(z.object({ name: z.string(), permission: z.array(ruleSchema) }));
const permissionEventSchema = z.object({ type: z.string(), properties: z.record(z.string(), z.unknown()) });
const toolPartsSchema = z.array(z.object({ parts: z.array(z.object({ tool: z.string().optional(),
  state: z.object({ status: z.string(), output: z.string().optional(), error: z.string().optional() }).optional() })) }));
type ToolCall = { name: string; args: Record<string, unknown> };

test.skipIf(!binary || process.env.LAWOSS_YOLO_ENGINE !== "1")("YOLO Mode a pripojené priečinky: A číta L cez plugin, presun do L len s YOLO v chate, plánovaný beh a klient B sa pýtajú", async () => {
  if (!binary) return;
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-yolo-linked-")));
  const clientA = join(root, "prax", "Klienti", "Tatran");
  const clientB = join(root, "prax", "Klienti", "Hron");
  const linked = join(root, "Zdieľané", "Vzory zmlúv");
  for (const folder of [clientA, clientB, linked]) await mkdir(folder, { recursive: true });
  // Ne-ASCII obsah: presun musí zachovať presne tie isté bajty.
  const contract = Buffer.concat([Buffer.from("Zmluva o dielo – čl. 1, §\n", "utf8"), Buffer.from([0, 255, 1, 254, 10])]);
  const addendum = Buffer.from("Dodatok č. 1\n", "utf8");
  await writeFile(join(clientA, "zmluva.txt"), contract);
  await writeFile(join(clientA, "dodatok.txt"), addendum);
  await writeFile(join(linked, "vzor.md"), "Obsah vzoru zmluvy");
  // Karty klientov: plugin tak vie, že Hron je iný klient ako Tatran (N-A7-14).
  await writeFile(join(clientA, "client.md"), "# SYN Tatran\n");
  await writeFile(join(clientB, "client.md"), "# SYN Hron\n");
  await writeFile(join(clientB, "hron.md"), "Obsah klienta Hron");
  const outside = join(root, "Iné");
  await mkdir(outside, { recursive: true });
  await writeFile(join(outside, "poznamka.md"), "Obsah poznámky mimo klientov");
  const previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "private", "runtime.sqlite");
  const workspaces: WorkspaceInfo[] = [
    { id: "ws_a", name: "Tatran", path: clientA, preset: "starter", workspaceType: "local" },
    { id: "ws_b", name: "Hron", path: clientB, preset: "starter", workspaceType: "local" },
  ];
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "fixture", hostToken: "fixture-host", configPath: join(root, "private", "server.json"),
    approval: { mode: "auto", timeoutMs: 5000 }, corsOrigins: [], workspaces, authorizedRoots: [clientA, clientB], agentSandboxEnabled: true,
    readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false,
  };
  // Advokát sa pýta pred úpravami a príkazmi; klient A má pripojený priečinok L (natívny zápis riadku klienta).
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, () => ({ permission: { edit: "ask", bash: "ask" } }));
  await writeRuntimeOpencodeConfig(config, "ws_a", (current) => ({ ...current, permission: { external_directory: { [`${linked}/*`]: "allow" } } }));
  const hostApprovals: string[] = [];
  const approvals: ApprovalService = new ApprovalService(config.approval, undefined, () => queueMicrotask(() => {
    for (const request of approvals.list()) { hostApprovals.push(request.action); approvals.respond(request.id, "deny"); }
  }));
  const service = new AgentSandboxService(config, approvals, { status: async () => ({ available: true }), prepare: async () => "fixture",
    run: async () => { throw new Error("The protected environment stays off in this test."); } });
  let engineBase = "";
  let plan: ToolCall[] = [];
  const shellCalls: string[] = [];
  const at = (directory: string, path: string) => `${engineBase}${path}${path.includes("?") ? "&" : "?"}directory=${encodeURIComponent(directory)}`;
  const fixture = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: workspaces.map(({ id, path }) => ({ id, path })) });
    const session = /^\/workspace\/([^/]+)\/sandbox\/session\//.exec(path);
    if (session) return Response.json({ enabled: false, networkMode: "allow", shell: "zsh", platform: process.platform, cwd: workspaces.find(entry => entry.id === session[1])?.path ?? "" });
    const execute = /^\/workspace\/([^/]+)\/sandbox\/execute$/.exec(path);
    if (execute) {
      const workspace = workspaces.find(entry => entry.id === execute[1]);
      if (!workspace) return Response.json({ code: "unknown_workspace" }, { status: 404 });
      const command = z.object({ command: z.string(), write: z.boolean(), agent: z.string(), sessionID: z.string() }).parse(await request.json());
      shellCalls.push(command.command);
      // Ako ich odvodí server: pravidlá agenta v engine pod jeho aktuálnou konfiguráciou.
      const agents = agentRuleSchema.parse(await (await fetch(at(workspace.path, "/agent"))).json());
      const engineConfig = z.object({ permission: z.unknown(), agent: z.record(z.string(), z.object({ permission: z.unknown() }).partial()).optional() })
        .parse(await (await fetch(at(workspace.path, "/config"))).json());
      // Ako server (`server.ts` agentRules): v YOLO je „ask“ chat agenta na priečinky len pre plugin, nie pre shell.
      const rules: AgentPermissionRule[] = yoloShellAgentRules(managedPermissionRules(explicitFileApprovals(agents.find(agent => agent.name === command.agent)?.permission ?? [],
        [engineConfig.permission, engineConfig.agent?.[command.agent]?.permission]), []), command.agent, await yoloModeActive(config));
      try { return Response.json(await service.run(workspace, { ...command, timeoutMs: 10000 }, { type: "host" }, request.signal, rules, [command.sessionID])); }
      catch (error) { return Response.json({ code: error instanceof ApiError ? error.code : "failed" }, { status: error instanceof ApiError ? error.status : 500 }); }
    }
    const input = z.object({ messages: z.array(z.object({ role: z.string() })), tools: z.array(z.object({ function: z.object({ name: z.string() }) })).optional() }).parse(await request.json());
    const tools = input.tools?.map(tool => tool.function.name) ?? [];
    const next = plan[input.messages.filter(message => message.role === "tool").length];
    const call = next && tools.includes(next.name) ? next : undefined;
    const delta = call ? { tool_calls: [{ index: 0, id: `call_${call.name}`, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: "Hotovo." };
    const chunk = (value: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta: value, finish_reason: finish }] })}\n\n`;
    return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
  } });

  const read: ToolCall = { name: "read", args: { filePath: join(linked, "vzor.md") } };
  const readOutside: ToolCall = { name: "read", args: { filePath: join(outside, "poznamka.md") } };
  const readOtherClient: ToolCall = { name: "read", args: { filePath: join(clientB, "hron.md") } };
  const move = (file: string): ToolCall => ({ name: "legalwork_shell", args: { command: `mv ${file} '${linked}/${file}'`, description: "Presuň do pripojeného priečinka", write: true } });
  const exists = (path: string) => access(path).then(() => true, () => false);

  /** Jeden chat v `directory`: otázka enginu, ktorá visí ≥ 3 s, je otázka pre používateľa (zamietne sa); plugin odpovedá hneď. */
  const attempt = async (directory: string, agent: string, steps: ToolCall[]) => {
    plan = steps;
    const events: { type: string; permission?: unknown; reply?: unknown }[] = [];
    const stream = new AbortController();
    const listening = fetch(at(directory, "/event"), { signal: stream.signal }).then(async (response) => {
      const reader = response.body?.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const chunk = await reader?.read();
        if (!chunk || chunk.done) return;
        buffer += decoder.decode(chunk.value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          const event = permissionEventSchema.safeParse(JSON.parse(line.slice(6)));
          if (event.success && event.data.type.startsWith("permission.")) events.push({ type: event.data.type, permission: event.data.properties.permission, reply: event.data.properties.reply ?? event.data.properties.response });
        }
      }
    }).catch(() => undefined);
    await Bun.sleep(200);
    const json = { "content-type": "application/json" };
    const created = z.object({ id: z.string() }).parse(await (await fetch(at(directory, "/session"), { method: "POST", headers: json, body: "{}" })).json());
    const accepted = await fetch(at(directory, `/session/${created.id}/prompt_async`), { method: "POST", headers: json,
      body: JSON.stringify({ agent, model: { providerID: "fixture", modelID: "fixture" }, parts: [{ type: "text", text: "Pracuj so súbormi." }] }) });
    expect(accepted.ok).toBe(true);
    const firstSeen = new Map<string, number>();
    const prompts: string[] = [];
    for (let i = 0; i < 600; i++) {
      const pending = z.array(z.object({ id: z.string(), permission: z.string() })).parse(await (await fetch(at(directory, "/permission"))).json());
      for (const ask of pending) {
        const seen = firstSeen.get(ask.id);
        if (seen === undefined) { firstSeen.set(ask.id, Date.now()); continue; }
        if (Date.now() - seen < 3000) continue;
        prompts.push(ask.permission);
        await fetch(at(directory, `/permission/${ask.id}/reply`), { method: "POST", headers: json, body: JSON.stringify({ reply: "reject" }) });
      }
      const status = z.record(z.string(), z.object({ type: z.string() })).parse(await (await fetch(at(directory, "/session/status"))).json());
      if (i > 5 && pending.length === 0 && (status[created.id]?.type ?? "idle") === "idle") break;
      await Bun.sleep(100);
    }
    stream.abort(); await listening;
    const parts = toolPartsSchema.parse(await (await fetch(at(directory, `/session/${created.id}/message`))).json()).flatMap(message => message.parts).filter(part => part.tool);
    return { prompts, events, tools: parts.map(part => ({ tool: part.tool, status: part.state?.status, output: part.state?.output ?? part.state?.error ?? "" })) };
  };

  /** Pravidlo agenta v engine pre `external_directory` a vzor `*` (posledné platí). */
  const engineFolderRule = async (directory: string, agent: string) =>
    agentRuleSchema.parse(await (await fetch(at(directory, "/agent"))).json()).find(entry => entry.name === agent)?.permission
      .filter(rule => rule.permission === "external_directory" && rule.pattern === "*").at(-1)?.action;

  // Jeden čerstvý engine na fázu, ako po reštarte enginu v aplikácii. Spoločný súbor a mapa idú cez produkčný kód.
  const runPhase = async <T>(phase: string, cwd: string, body: () => Promise<T>) => {
    const production = await buildLegalworkRuntimeConfigObject(config, "ws_a");
    await writeLinkedFoldersMap(config);
    // Mapa leží vedľa súboru enginu, ako v aplikácii (`runtime-opencode-config.json` v `runtimeStorageDir`).
    const file = join(runtimeStorageDir(config), `config-${phase}.json`);
    await writeFile(file, JSON.stringify({ enabled_providers: ["fixture"], model: "fixture/fixture", small_model: "fixture/fixture", share: "disabled", autoupdate: false,
      provider: { fixture: { npm: "@ai-sdk/openai-compatible", name: "Fixture", options: { baseURL: fixture.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { name: "Fixture", limit: { context: 100000, output: 4000 } } } } },
      plugin: ["legalwork-sandbox", "lawoss-linked-folders"].map(name => pathToFileURL(join(import.meta.dir, `../../dist/opencode-plugins/${name}.js`)).href),
      permission: production.permission, agent: production.agent, lsp: false, formatter: false }));
    const reservation = Bun.serve({ port: 0, fetch: () => new Response() }), port = reservation.port;
    reservation.stop(true);
    const engine = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd, env: {
      ...process.env, HOME: root, XDG_CONFIG_HOME: join(root, "config"), XDG_DATA_HOME: join(root, "data"), XDG_CACHE_HOME: join(root, "cache"), XDG_STATE_HOME: join(root, "state"),
      OPENCODE_TEST_HOME: root, OPENCODE_CONFIG: file, OPENCODE_DISABLE_PROJECT_CONFIG: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true", OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_DISABLE_MODELS_FETCH: "true",
      LEGALWORK_SERVER_URL: fixture.url.origin, LEGALWORK_WIKI_AGENT_TOKEN: "fixture",
    }, stdout: "pipe", stderr: "pipe" });
    const logs = new Response(engine.stderr).text();
    engineBase = `http://127.0.0.1:${port}`;
    try {
      let ready = false;
      for (let i = 0; i < 300 && !ready && engine.exitCode === null; i++) {
        try { ready = (await fetch(engineBase + "/global/health", { signal: AbortSignal.timeout(1000) })).ok; } catch { await Bun.sleep(100); }
      }
      if (!ready) throw new Error("Engine did not start: " + (engine.exitCode !== null ? await logs : "timed out"));
      return { production, result: await body() };
    } finally {
      engine.kill("SIGKILL"); await engine.exited;
    }
  };
  type Production = Awaited<ReturnType<typeof buildLegalworkRuntimeConfigObject>>;
  const sharedFolders = (production: Production) => z.object({ external_directory: z.record(z.string(), z.unknown()).optional() }).passthrough().parse(production.permission).external_directory ?? {};
  const agentFolders = (production: Production, agent: string) => z.record(z.string(), z.object({ permission: z.record(z.string(), z.unknown()).optional() }).passthrough())
    .parse(production.agent)[agent]?.permission?.external_directory;

  try {
    // Mapa od servera: L patrí len klientovi A.
    await writeLinkedFoldersMap(config);
    expect(parseLinkedFoldersMap(JSON.parse(await readFile(linkedFoldersMapPath(config), "utf8")))?.clients).toEqual([{ root: clientA, folders: [linked], client: clientA }, { root: clientB, folders: [], client: clientB }]);

    // 1. YOLO vypnutý, chat A.
    const off = await runPhase("off", clientA, async () => ({
      rule: await engineFolderRule(clientA, "legalwork"), read: await attempt(clientA, "legalwork", [read]), approvalsAfterRead: [...hostApprovals],
      move: await attempt(clientA, "legalwork", [move("zmluva.txt")]), approvals: [...hostApprovals], shellCalls: [...shellCalls],
    }));
    // Spoločný súbor povolenie L nemá a chat agent sa na cudzie priečinky pýta: čítanie bez otázky zariadil plugin.
    expect(Object.keys(sharedFolders(off.production))).not.toContain(`${linked}/*`);
    expect(agentFolders(off.production, "legalwork")).toBeUndefined();
    expect(off.result.rule).toBe("ask");
    expect(off.result.read.prompts).toEqual([]);
    // Engine sa spýtal na cudzí priečinok a odpovedal mu plugin („once“), nie test ani používateľ.
    expect(off.result.read.events).toEqual([{ type: "permission.asked", permission: "external_directory", reply: undefined }, { type: "permission.replied", permission: undefined, reply: "once" }]);
    expect(off.result.read.tools).toEqual([{ tool: "read", status: "completed", output: expect.stringContaining("Obsah vzoru zmluvy") }]);
    expect(off.result.approvalsAfterRead).toEqual([]);
    // Presun z A do L sa pýta v chate (príkaz spravovaného shellu), advokát odmietne: nič sa nepresunie.
    expect([...off.result.move.prompts, ...off.result.approvals]).toContain("sandbox.bash");
    expect(off.result.shellCalls).toEqual([`mv zmluva.txt '${linked}/zmluva.txt'`]);
    expect(off.result.move.tools).toEqual([{ tool: "legalwork_shell", status: "error", output: expect.stringContaining("sandbox_permission_declined") }]);
    expect((await readFile(join(clientA, "zmluva.txt"))).equals(contract)).toBe(true);
    expect(await exists(join(linked, "zmluva.txt"))).toBe(false);

    // 2. YOLO zapnutý, chat A: presun do L bez otázky.
    await writeYoloMode(config, true);
    hostApprovals.length = 0; shellCalls.length = 0;
    const on = await runPhase("on", clientA, async () => ({
      rule: await engineFolderRule(clientA, "legalwork"), scheduledRule: await engineFolderRule(clientA, "legalwork-scheduled-all"),
      move: await attempt(clientA, "legalwork", [move("zmluva.txt")]), approvals: [...hostApprovals], shellCalls: [...shellCalls],
      outside: await attempt(clientA, "legalwork", [readOutside]), otherClient: await attempt(clientA, "legalwork", [readOtherClient]),
      scheduled: await (async () => { hostApprovals.length = 0; shellCalls.length = 0;
        const result = await attempt(clientA, "legalwork-scheduled-all", [move("dodatok.txt")]);
        return { ...result, approvals: [...hostApprovals], shellCalls: [...shellCalls] }; })(),
    }));
    // YOLO ide len na chat agenta; spoločný súbor ostáva bez L a plánované behy bez povolenia všetkého.
    expect(Object.keys(sharedFolders(on.production))).not.toContain(`${linked}/*`);
    // Engine sa chat agenta na priečinky mimo chatu pýta, aby plugin videl iného klienta; ostatné povolí sám.
    expect(agentFolders(on.production, "legalwork")).toEqual({ "*": "ask" });
    expect(agentFolders(on.production, "legalwork-scheduled-all")).not.toEqual({ "*": "allow" });
    expect(parseLinkedFoldersMap(JSON.parse(await readFile(linkedFoldersMapPath(config), "utf8")))?.yolo).toBe(true);
    expect(on.result.rule).toBe("ask");
    expect(on.result.scheduledRule).not.toBe("allow");
    expect(on.result.move.prompts).toEqual([]);
    expect(on.result.move.events).toEqual([]);
    expect(on.result.approvals).toEqual([]);
    expect(on.result.shellCalls).toEqual([`mv zmluva.txt '${linked}/zmluva.txt'`]);
    expect(on.result.move.tools.map(part => [part.tool, part.status])).toEqual([["legalwork_shell", "completed"]]);
    expect((await readFile(join(linked, "zmluva.txt"))).equals(contract)).toBe(true);
    expect(await exists(join(clientA, "zmluva.txt"))).toBe(false);
    // Nepripojený priečinok mimo klientov: bez karty (engine sa spýtal, plugin povolil „once“).
    expect(on.result.outside.prompts).toEqual([]);
    expect(on.result.outside.events).toEqual([{ type: "permission.asked", permission: "external_directory", reply: undefined }, { type: "permission.replied", permission: undefined, reply: "once" }]);
    expect(on.result.outside.tools).toEqual([{ tool: "read", status: "completed", output: expect.stringContaining("Obsah poznámky mimo klientov") }]);
    // Priečinok klienta B: karta aj v YOLO (advokát tu zamietne, nič sa neprečíta).
    expect(on.result.otherClient.prompts).toEqual(["external_directory"]);
    expect(on.result.otherClient.events).toEqual([{ type: "permission.asked", permission: "external_directory", reply: undefined }, { type: "permission.replied", permission: undefined, reply: "reject" }]);
    expect(on.result.otherClient.tools.map(part => part.status)).toEqual(["error"]);
    expect(JSON.stringify(on.result.otherClient.tools)).not.toContain("Obsah klienta Hron");

    // 3. YOLO zapnutý, plánovaný beh: pýta sa pred príkazom, nič sa nepresunie.
    expect([...on.result.scheduled.prompts, ...on.result.scheduled.approvals]).toContain("sandbox.bash");
    expect(on.result.scheduled.tools).toEqual([{ tool: "legalwork_shell", status: "error", output: expect.stringContaining("sandbox_permission_declined") }]);
    expect((await readFile(join(clientA, "dodatok.txt"))).equals(addendum)).toBe(true);
    expect(await exists(join(linked, "dodatok.txt"))).toBe(false);

    // 4. YOLO znova vypnutý: chat B sa pri čítaní L pýta; A číta L ďalej bez otázky.
    await writeYoloMode(config, false);
    hostApprovals.length = 0; shellCalls.length = 0;
    const back = await runPhase("off-again", clientB, async () => ({
      ruleB: await engineFolderRule(clientB, "legalwork"), readB: await attempt(clientB, "legalwork", [read]), readA: await attempt(clientA, "legalwork", [read]),
    }));
    expect(parseLinkedFoldersMap(JSON.parse(await readFile(linkedFoldersMapPath(config), "utf8")))?.clients).toEqual([{ root: clientA, folders: [linked], client: clientA }, { root: clientB, folders: [], client: clientB }]);
    expect(agentFolders(back.production, "legalwork")).toBeUndefined();
    expect(back.result.ruleB).toBe("ask");
    expect(back.result.readB.prompts).toEqual(["external_directory"]);
    expect(back.result.readB.events).toEqual([{ type: "permission.asked", permission: "external_directory", reply: undefined }, { type: "permission.replied", permission: undefined, reply: "reject" }]);
    expect(back.result.readB.tools.map(part => part.status)).toEqual(["error"]);
    expect(back.result.readA.prompts).toEqual([]);
    expect(back.result.readA.events).toEqual([{ type: "permission.asked", permission: "external_directory", reply: undefined }, { type: "permission.replied", permission: undefined, reply: "once" }]);
    expect(back.result.readA.tools).toEqual([{ tool: "read", status: "completed", output: expect.stringContaining("Obsah vzoru zmluvy") }]);
    expect(hostApprovals).toEqual([]);
    expect(shellCalls).toEqual([]);
    console.log(JSON.stringify({
      off: { readEngineRule: off.result.rule, read: off.result.read, move: { ...off.result.move, chatApprovals: off.result.approvals, shellCalls: off.result.shellCalls } },
      on: { engineRule: on.result.rule, scheduledEngineRule: on.result.scheduledRule, move: { ...on.result.move, chatApprovals: on.result.approvals, shellCalls: on.result.shellCalls }, scheduled: on.result.scheduled },
      offAgain: { engineRuleB: back.result.ruleB, readB: back.result.readB, readA: back.result.readA },
    }, null, 1));
  } finally {
    fixture.stop(true); service.stop();
    await closeRuntimeOpencodeConfig(config); Bun.gc(true);
    if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
    await rm(root, { recursive: true, force: true });
  }
}, 240000);
