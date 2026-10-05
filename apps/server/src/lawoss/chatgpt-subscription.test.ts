import { afterAll, beforeEach, expect, test } from "bun:test";
import { ReviewExecutor } from "../reviews/executor.js";
import type { SystemOneSettings } from "../systemone-schema.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { offeredModels } from "./chatgpt-subscription.js";

// Synthetic engine: OpenAI signed in with a ChatGPT subscription (source "custom"), catalogue keys
// as OpenCode 1.18.29 returned them, and an opencode config model the subscription rejects.
const keys = ["gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-fast", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra-fast", "gpt-6-luna", "gpt-6-luna-fast"];
const chat = (id: string) => ({ id, name: id, api: { id: id.replace(/-fast$/, "") }, limit: { context: 272000, output: 128000 }, capabilities: { input: { text: true }, output: { text: true } } });
let source = "custom";
let configModel: string | undefined = "openai/gpt-5.4";
const engine = Bun.serve({ port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/provider") return Response.json({ connected: ["openai"], default: { openai: "gpt-5.6-terra-fast" }, all: [{ id: "openai", name: "OpenAI", source, env: [], options: {}, models: Object.fromEntries(keys.map(key => [key, chat(key)])) }] });
  if (path === "/config") return Response.json({ model: configModel });
  return new Response("Unknown", { status: 404 });
} });
afterAll(() => engine.stop(true));
beforeEach(() => { source = "custom"; configModel = "openai/gpt-5.4"; });

const workspace: WorkspaceInfo = { id: "qa", name: "QA", path: "/qa", preset: "starter", workspaceType: "local" };
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "test-host", configPath: "/unused-fixture", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [workspace.path], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, opencodeBaseUrl: engine.url.origin };
const noJev: SystemOneSettings = { selection: { providerId: "", model: "" }, providers: [] };
const executor = new ReviewExecutor(config, { settings: async () => structuredClone(noJev), infer: async () => { throw new Error("No inference"); } });

test("tabular review offers only subscription models and never the rejected config model", async () => {
  const found = await executor.models(workspace);
  const ids = found.models.filter(model => model.backend === "llm").map(model => model.model);
  expect(ids).toEqual(["gpt-6-luna", "gpt-5.6-sol"]);
  expect(found.settings.llm).toEqual({ providerId: "openai", model: "gpt-6-luna" });
});

test("a config model the subscription accepts stays the review default", async () => {
  configModel = "openai/gpt-5.6-sol";
  expect((await executor.models(workspace)).settings.llm).toEqual({ providerId: "openai", model: "gpt-5.6-sol" });
});

test("an OpenAI API key keeps the full catalogue and its config model", async () => {
  source = "api";
  const found = await executor.models(workspace);
  expect(found.models.map(model => model.model)).toEqual(keys);
  expect(found.settings.llm).toEqual({ providerId: "openai", model: "gpt-5.4" });
});

test("other providers keep their order", () => {
  const models = { b: chat("b"), a: chat("a") };
  expect(offeredModels({ id: "anthropic", source: "custom", models }).map(model => model.id)).toEqual(["b", "a"]);
});
