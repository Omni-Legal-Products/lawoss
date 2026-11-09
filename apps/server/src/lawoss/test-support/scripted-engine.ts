import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { OpenCode, type OpenCodeClient } from "@opencode/client";
import { listEngineMessages } from "../../engine-client.js";
import { buildLegalworkRuntimeSettings } from "../../legalwork-runtime-config.js";
import { runtimeStorageDir } from "../../runtime-opencode-config-store.js";
import type { ServerConfig } from "../../types.js";
import { issueWikiAgentTicket } from "../../wiki/agent-access.js";
import { WIKI_AGENT_TICKET_ENV } from "../engine-agent-contract.js";
import { startRealEngineV2 } from "./fake-engine-v2.js";

/**
 * LAWOSS test support (engine v2): the shipped engine 2.1.4 with a scripted model and the production rules of one
 * workspace, for tests whose LAWOSS server is a small fixture (`serverUrl`) that calls the real services.
 * - Rules, agents, skills and experimental flags come from `buildLegalworkRuntimeSettings` (what the app gives the
 *   engine for the workspace) in an `OPENCODE_CONFIG` file in the runtime storage folder, where the server keeps it
 *   and where `lawoss-linked-folders` finds its map.
 * - Plugins are the bundles built by `pnpm --filter legalwork-server build` (`dist/opencode-plugins/<name>`), loaded
 *   from `OPENCODE_CONFIG_CONTENT` like the app's mandatory plugins. A missing bundle fails the test.
 * - Plugin tools are offered to the model directly (`codemode: false`, as upstream `native-domain-engine.test-support.ts`):
 *   the scripted model calls them by name instead of writing Code Mode programs. Their permissions do not change.
 * - The model is an OpenAI-compatible fixture (`modelUrl`, chat completions). The engine holds a single-use ticket,
 *   never the server token (engine-agent-contract.ts); the fixture redeems it.
 * Synthetic data only; HOME/XDG and the engine database are temporary.
 */
export const BUILT_PLUGINS = join(import.meta.dir, "..", "..", "..", "dist", "opencode-plugins");

export type EngineCard = { id: string; sessionID: string; action: string; resources: readonly string[]; save?: readonly string[]; metadata?: Record<string, unknown>; message?: string };
export type EngineToolRun = { name: string; status: string; output: string };
type PluginSpec = string | { name: string; options: Record<string, unknown> };

const DIRECT_TOOLS_PLUGIN = `import { Plugin } from "@opencode/plugin";
export default Plugin.define({ id: "lawoss.test-direct-tools", async setup(ctx) {
  const tools = await ctx.tool.transform((editor) => { for (const item of editor.list()) editor.update(item.id, (tool) => { tool.options = { ...tool.options, codemode: false }; }); });
  return async () => { await tools.dispose(); };
} });
`;

/** Offers every tool directly to the scripted model (see the header). */
export async function directToolsPlugin(home: string): Promise<string> {
  const direct = join(home, "direct-tools");
  await mkdir(direct, { recursive: true });
  await writeFile(join(direct, "index.js"), DIRECT_TOOLS_PLUGIN);
  return direct;
}

/** The scripted OpenAI-compatible model as the engine's only model. */
export function fixtureModel(modelUrl: string) {
  return { model: "fixture/fixture", providers: { fixture: { package: "@opencode/ai/providers/openai-compatible", settings: { baseURL: modelUrl, apiKey: "fixture" },
    models: { fixture: { limit: { context: 100000, output: 4000 }, capabilities: { tools: true } } } } } };
}

/**
 * The shipped engine for a real LAWOSS server (`startServer`), as the app runs it: the server URL and a single-use
 * ticket in the environment, never the server token. Every workspace and the server config then point at it.
 */
export async function startEngineForServer(input: {
  binary: string;
  config: ServerConfig;
  serverPort: number;
  home: string;
  cleanups: (() => Promise<unknown> | unknown)[];
  plugins: PluginSpec[];
  modelUrl: string;
  /** Native rules of the engine (default: everything allowed; the test says what asks). */
  permissions?: { action: string; resource: string; effect: "allow" | "ask" | "deny" }[];
}) {
  const plugins = [...input.plugins.map((plugin) => typeof plugin === "string" ? builtPlugin(plugin) : { package: builtPlugin(plugin.name), options: plugin.options }), await directToolsPlugin(input.home)];
  const content = { update: "disable", warming: false, plugins, ...fixtureModel(input.modelUrl), permissions: input.permissions ?? [{ action: "*", resource: "*", effect: "allow" }] };
  const engine = await startRealEngineV2(input.binary, input.home, input.cleanups, {
    OPENCODE_CONFIG_CONTENT: JSON.stringify(content), OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    LEGALWORK_SERVER_URL: `http://127.0.0.1:${input.serverPort}`, [WIKI_AGENT_TICKET_ENV]: issueWikiAgentTicket(input.config),
  });
  const credentials = { opencodeUsername: engine.username, opencodePassword: engine.password };
  for (const workspace of input.config.workspaces) Object.assign(workspace, { baseUrl: engine.url, ...credentials });
  Object.assign(input.config, { opencodeBaseUrl: engine.url, ...credentials });
  const client = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
  return { engine, client };
}

export function builtPlugin(name: string): string {
  const directory = join(BUILT_PLUGINS, name);
  if (!existsSync(join(directory, "index.js"))) throw new Error(`Missing built plugin ${name}: run pnpm --filter legalwork-server build`);
  return directory;
}

/** One SSE answer of an OpenAI-compatible model: a tool call or a final text. */
export function scriptedCompletion(call: { name: string; args: unknown; id: string } | undefined, text = "Hotovo.") {
  const chunk = (delta: unknown, finish: string | null) => `data: ${JSON.stringify({ id: "fixture", object: "chat.completion.chunk", created: 1, model: "fixture", choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
  const delta = call ? { tool_calls: [{ index: 0, id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.args) } }] } : { content: text };
  return new Response(chunk({ role: "assistant", ...delta }, null) + chunk({}, call ? "tool_calls" : "stop") + "data: [DONE]\n\n", { headers: { "content-type": "text/event-stream" } });
}

export async function startScriptedEngine(input: {
  binary: string;
  config: ServerConfig;
  /** Workspace whose production rules the engine gets. */
  workspaceId: string;
  home: string;
  cleanups: (() => Promise<unknown> | unknown)[];
  plugins: PluginSpec[];
  serverUrl: string;
  /** OpenAI-compatible base URL (`…/v1`). */
  modelUrl: string;
  /** Plugin ids that must be active in a location before a chat starts there. */
  pluginIds?: string[];
  /** Loads `legalwork-managed-config` first, with every workspace's production settings, as the app's mandatory plugins do. */
  managedConfig?: boolean;
  /** Replaces the production rules (each test states what its profile is). */
  configuration?: (production: Record<string, unknown>) => Record<string, unknown>;
}) {
  const production = (await buildLegalworkRuntimeSettings(input.config, input.workspaceId)).configuration as Record<string, unknown>;
  const picked = Object.fromEntries(["default_agent", "permissions", "agents", "skills", "experimental"].flatMap((key) => production[key] === undefined ? [] : [[key, production[key]]]));
  const rules = input.configuration ? input.configuration(picked) : picked;
  await mkdir(runtimeStorageDir(input.config), { recursive: true });
  const file = join(runtimeStorageDir(input.config), `engine-config-${input.workspaceId}.json`);
  await writeFile(file, JSON.stringify({ update: "disable", ...rules }));
  const direct = await directToolsPlugin(input.home);
  const managed: PluginSpec[] = [];
  if (input.managedConfig) {
    const settingsPath = join(runtimeStorageDir(input.config), "engine-settings.json");
    const workspaces = Object.fromEntries(await Promise.all(input.config.workspaces.map(async (workspace) =>
      [workspace.id, { ...await buildLegalworkRuntimeSettings(input.config, workspace.id), directory: workspace.path }] as const)));
    await writeFile(settingsPath, JSON.stringify({ version: 2, workspaces, sharedConfiguration: {} }));
    managed.push({ name: "legalwork-managed-config", options: { settingsPath } });
  }
  const plugins = [...[...managed, ...input.plugins].map((plugin) => typeof plugin === "string" ? builtPlugin(plugin) : { package: builtPlugin(plugin.name), options: plugin.options }), direct];
  const content = { update: "disable", warming: false, plugins, ...fixtureModel(input.modelUrl) };
  const engine = await startRealEngineV2(input.binary, input.home, input.cleanups, {
    OPENCODE_CONFIG: file, OPENCODE_CONFIG_CONTENT: JSON.stringify(content), OPENCODE_CONFIG_PROJECT_DISABLE: "1",
    LEGALWORK_SERVER_URL: input.serverUrl, [WIKI_AGENT_TICKET_ENV]: "synthetic-ticket",
  });
  const client = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
  const pluginIds = [...input.managedConfig ? ["legalwork.managed-config"] : [], ...input.pluginIds ?? [], "lawoss.test-direct-tools"];
  return { engine, client, file, chat: (directory: string, agent = "legalwork") => openChat(client, directory, agent, pluginIds) };
}

/** Waits until the location's plugins are active (a location loads them on its first request). */
export async function waitForPlugins(client: OpenCodeClient, directory: string, ids: string[]) {
  const location = { directory };
  await client.model.list({ location });
  let states: { id: string; status: string }[] = [];
  for (let attempt = 0; attempt < 200; attempt++) {
    states = (await client.plugin.list({ location })).data.map((entry) => ({ id: entry.id, status: entry.state.status }));
    if (ids.every((id) => states.some((entry) => entry.id === id && entry.status === "active"))) return;
    if (states.some((entry) => ids.includes(entry.id) && entry.status === "failed")) break;
    await Bun.sleep(100);
  }
  throw new Error(`Plugins not active in ${directory}: ${JSON.stringify(states)}`);
}

/** Text the model received from a tool (completed content or the error). */
export function toolOutput(state: unknown): string {
  if (!state || typeof state !== "object") return "";
  const content = "content" in state && Array.isArray(state.content) ? state.content.map((item: unknown) => item && typeof item === "object" && "text" in item && typeof item.text === "string" ? item.text : "").join("\n") : "";
  const error = "error" in state && state.error && typeof state.error === "object" && "message" in state.error && typeof state.error.message === "string" ? state.error.message : "";
  return [content, error].filter(Boolean).join("\n");
}

export async function openChat(client: OpenCodeClient, directory: string, agent: string, pluginIds: string[]) {
  const location = { directory };
  if (pluginIds.length) await waitForPlugins(client, directory, pluginIds);
  const session = await client.session.create({ location, agent, model: { providerID: "fixture", id: "fixture" } });
  const seen = new Set<string>();
  /** One user turn; every engine card of this chat is recorded and answered by `reply` (a card left open would block the turn). */
  const turn = async (text: string, reply: (card: EngineCard) => "once" | "always" | "reject" = () => "reject") => {
    const cards: EngineCard[] = [];
    await client.session.prompt({ sessionID: session.id, text });
    let finished = false;
    const waiting = client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(150_000) }).finally(() => { finished = true; });
    while (!finished) {
      for (const card of (await client.permission.request.list({ location })).data) {
        if (card.sessionID !== session.id || seen.has(card.id)) continue;
        seen.add(card.id);
        const copy: EngineCard = JSON.parse(JSON.stringify(card));
        cards.push(copy);
        await client.permission.reply({ sessionID: session.id, requestID: card.id, decision: reply(copy) });
      }
      await Bun.sleep(50);
    }
    await waiting;
    return cards;
  };
  /** Every tool call of the chat in order, with what the model received. */
  const tools = async (): Promise<EngineToolRun[]> => (await listEngineMessages(client, session.id)).flatMap((message) =>
    message.type === "assistant" ? message.content.flatMap((item) => item.type === "tool" ? [{ name: item.name, status: item.state.status, output: toolOutput(item.state) }] : []) : []);
  return { id: session.id, location, turn, tools };
}
