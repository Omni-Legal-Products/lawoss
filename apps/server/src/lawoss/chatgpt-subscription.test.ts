import { afterAll, beforeEach, expect, test } from "bun:test";
import { ReviewExecutor } from "../reviews/executor.js";
import type { SystemOneSettings } from "../systemone-schema.js";
import type { ServerConfig, WorkspaceInfo } from "../types.js";
import { offeredModels, providerSource } from "./chatgpt-subscription.js";

// Synthetic engine 2.1.4: OpenAI signed in with a ChatGPT subscription (active OAuth connection of the openai
// integration; v2 providers have no `source`), the subscription's catalogue as the engine's chatgpt.ts plugin leaves it
// (it still keeps gpt-5.5 and the -fast variants, which LAWOSS does not offer) and an engine default the subscription rejects.
const keys = ["gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-fast", "gpt-5.5", "gpt-5.6-sol", "gpt-5.6-terra-fast", "gpt-6-luna", "gpt-6-luna-fast"];
const chat = (id: string) => ({ id, modelID: id.replace(/-fast$/, ""), providerID: "openai", name: id, enabled: true, limit: { context: 272000, output: 128000 }, capabilities: { input: ["text"], output: ["text"] } });
type Connection = { type: "credential"; id: string; label: string; method: "oauth" | "key" } | { type: "env"; name: string };
const oauth: Connection = { type: "credential", id: "cred_oauth", label: "ChatGPT", method: "oauth" };
const key: Connection = { type: "credential", id: "cred_key", label: "API key", method: "key" };
let connections: Connection[] = [oauth];
let defaultModel = "gpt-5.4";
const location = { directory: "/qa" };
const engine = Bun.serve({ port: 0, fetch(request) {
  const path = new URL(request.url).pathname;
  if (path === "/api/location") return Response.json({ data: location });
  if (path === "/api/provider") return Response.json({ location, data: [{ id: "openai", name: "OpenAI", integrationID: "openai", activation: "enabled", package: "fixture" }] });
  if (path === "/api/model") return Response.json({ location, data: keys.map(chat) });
  if (path === "/api/model/default") return Response.json({ location, data: chat(defaultModel) });
  if (path === "/api/integration") return Response.json({ location, data: [{ id: "openai", name: "OpenAI", methods: [], connections }] });
  return new Response("Unknown", { status: 404 });
} });
afterAll(() => engine.stop(true));
beforeEach(() => { connections = [oauth]; defaultModel = "gpt-5.4"; });

const workspace: WorkspaceInfo = { id: "qa", name: "QA", path: "/qa", preset: "starter", workspaceType: "local" };
const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "test-host", configPath: "/unused-fixture", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace], authorizedRoots: [workspace.path], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false, opencodeBaseUrl: engine.url.origin };
const noJev: SystemOneSettings = { selection: { providerId: "", model: "" }, providers: [] };
const executor = new ReviewExecutor(config, { settings: async () => structuredClone(noJev), infer: async () => { throw new Error("No inference"); }, engineFetch: fetch });

test("tabular review offers only subscription models, Luna first, and never the rejected engine default", async () => {
  const found = await executor.models(workspace);
  const ids = found.models.filter(model => model.backend === "llm").map(model => model.model);
  expect(ids).toEqual(["gpt-6-luna", "gpt-5.6-sol"]);
  expect(found.settings.llm).toEqual({ providerId: "openai", model: "gpt-6-luna" });
});

test("an engine default the subscription accepts stays the review default", async () => {
  defaultModel = "gpt-5.6-sol";
  expect((await executor.models(workspace)).settings.llm).toEqual({ providerId: "openai", model: "gpt-5.6-sol" });
});

test("an OpenAI API key keeps the full catalogue and its default", async () => {
  connections = [key, oauth];
  const found = await executor.models(workspace);
  expect(found.models.map(model => model.model)).toEqual(keys);
  expect(found.settings.llm).toEqual({ providerId: "openai", model: "gpt-5.4" });
});

test("the active connection decides: a newer OAuth sign-in before an older key is the subscription", () => {
  const integrations = [{ id: "openai", connections: [oauth, key] }];
  expect(providerSource({ id: "openai", integrationID: "openai" }, integrations)).toBe("custom");
  expect(providerSource({ id: "openai" }, [{ id: "openai", connections: [key, oauth] }])).toBe("api");
  expect(providerSource({ id: "openai" }, [{ id: "openai", connections: [{ type: "env", name: "OPENAI_API_KEY" }] }])).toBe("env");
  expect(providerSource({ id: "openai" }, [])).toBe("config");
});

test("other providers keep their order", () => {
  const models = { b: chat("b"), a: chat("a") };
  expect(offeredModels({ id: "anthropic", source: "custom", models }).map(model => model.id)).toEqual(["b", "a"]);
});
