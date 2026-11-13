import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GLOBAL_PROVIDERS_ID, readRuntimeOpencodeConfig, writeRuntimeOpencodeConfig, closeRuntimeOpencodeConfig, type RuntimeOpencodeConfig } from "./runtime-opencode-config-store.js";
import { providerRepairNotices, repairAllWorkspaceRuntimeProviders, repairRuntimeProviders, repairWorkspaceRuntimeProviders, resetProviderRepairNoticesForTests } from "./runtime-provider-repair.js";
import type { ServerConfig } from "./types.js";
import { nativeProviderDefinition } from "./opencode-model-config.js";

const nativeProvider = { package: "@opencode/ai/providers/openai-compatible", name: "Local gateway", settings: { baseURL: "http://localhost:11434/v1" }, models: { model: { name: "Model", limit: { context: 8192, output: 4096 } } } };
const retiredProvider = { ...nativeProvider, name: "Eigenwelt Free" };
const brokenOllama = { ...nativeProvider, package: "@opencode/ai/providers/openai/responses", settings: { ...nativeProvider.settings, headerTimeout: 1800000, chunkTimeout: 1800000 } };
let root = "", previousDb: string | undefined;
function serverConfig(): ServerConfig {
  return { host: "127.0.0.1", port: 0, token: "synthetic", hostToken: "synthetic-host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 0 }, corsOrigins: [],
    workspaces: [{ id: "matter", name: "Test", path: root, preset: "starter", workspaceType: "local" }], engineConfigurationMode: "managed", authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "generated", hostTokenSource: "generated", logFormat: "pretty", logRequests: false };
}
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "legalwork-native-provider-validation-")); previousDb = process.env.LEGALWORK_RUNTIME_DB; process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite"); resetProviderRepairNoticesForTests(); });
afterEach(async () => { await closeRuntimeOpencodeConfig(serverConfig()); if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb; await rm(root, { recursive: true, force: true }); });

describe("native provider validation", () => {
  test("removes only the retired app provider and retains independent native connections", () => {
    const result = repairRuntimeProviders({ "eigenwelt-free": retiredProvider, local: nativeProvider });
    expect(result.providers).toEqual({ local: nativeProvider });
    expect(result.removed).toEqual([{ providerId: "eigenwelt-free", name: "Eigenwelt Free", reason: "retired" }]);
  });
  test("preserves native model-only overrides, optional limits, capability flags and variant arrays", () => {
    const provider = nativeProviderDefinition({ models: { model: { limit: { context: 128_000 }, capabilities: { temperature: false, reasoning: { supported: true, effort: ["low", "high"] } }, variants: [{ id: "high", settings: { reasoningEffort: "high" } }] }, output: { limit: { output: 96_000 } } } });
    expect(repairRuntimeProviders({ openai: provider }).providers).toEqual({ openai: provider });
  });
  test("malformed native connections fail closed without removing or mutating their source", () => {
    for (const provider of ["not a block", { models: { model: "invalid" } }, { models: { model: { cost: { input: 1 } } } }, { models: { model: { capabilities: { input: [123] } } } }]) {
      const original = JSON.stringify(provider);
      expect(() => repairRuntimeProviders({ private: provider })).toThrow("has not removed the connection");
      expect(JSON.stringify(provider)).toBe(original);
    }
  });
  test("legacy provider syntax is rejected at runtime instead of guessed or silently converted", () => {
    expect(() => repairRuntimeProviders({ legacy: { npm: "@ai-sdk/openai-compatible", options: { baseURL: "http://localhost:7" } } })).toThrow("invalid native settings");
  });
  test("retired cleanup preserves native permission rules, MCP settings and unrelated providers", async () => {
    const config = serverConfig();
    const permissions = [{ action: "read", resource: "*", effect: "deny" }] satisfies NonNullable<RuntimeOpencodeConfig["permissions"]>;
    const mcp = { servers: { connector: { type: "remote", url: "https://example.invalid/mcp", disabled: true } } } satisfies NonNullable<RuntimeOpencodeConfig["mcp"]>;
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providers: { "eigenwelt-free": retiredProvider, local: nativeProvider }, permissions, mcp }));
    const notices = await repairWorkspaceRuntimeProviders(config, "matter");
    const stored = await readRuntimeOpencodeConfig(config, "matter");
    expect(stored.providers).toEqual({ local: nativeProvider }); expect(stored.permissions).toEqual(permissions); expect(stored.mcp).toEqual(mcp);
    expect(providerRepairNotices("matter")).toEqual(notices);
    expect(await repairWorkspaceRuntimeProviders(config, "matter")).toEqual([]); expect(providerRepairNotices("matter")).toHaveLength(1);
  });
  test("read-only startup leaves stored providers unchanged", async () => {
    const config = serverConfig();
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providers: { "eigenwelt-free": retiredProvider, ollama: brokenOllama }, providerActivation: { ollama: "deny" } }));
    await repairAllWorkspaceRuntimeProviders({ ...config, readOnly: true });
    expect((await readRuntimeOpencodeConfig(config, "matter")).providers).toEqual({ "eigenwelt-free": retiredProvider, ollama: brokenOllama });
    expect((await readRuntimeOpencodeConfig(config, "matter")).providerActivation).toEqual({ ollama: "deny" });
  });
});

describe("one-time local Ollama repair", () => {
  test.each(["localhost", "127.0.0.1", "[::1]"])("repairs %s without mutating endpoints, models or timeouts", (host) => {
    const provider = { ...brokenOllama, settings: { ...brokenOllama.settings, baseURL: `http://${host}:11434/v1/` } };
    const before = JSON.stringify(provider);
    const result = repairRuntimeProviders({ ollama: provider });
    expect(result.providers.ollama).toEqual({ ...provider, package: nativeProvider.package });
    expect(result.repaired).toEqual(["ollama"]);
    expect(result.removed).toEqual([]);
    expect(JSON.stringify(provider)).toBe(before);
  });

  test.each([
    "https://api.openai.com/v1", "http://localhost:11435/v1", "http://localhost:11434/other",
    "http://localhost.evil.invalid:11434/v1", "http://example.invalid:11434/v1", "not a URL",
    "http://localhost:11434/v1?other=true", "http://localhost:11434/v1#other", "ftp://localhost:11434/v1",
  ])("does not rewrite unrelated or invalid endpoints: %s", (baseURL) => {
    const provider = { ...brokenOllama, settings: { baseURL } };
    const result = repairRuntimeProviders({ custom: provider });
    expect(result.providers.custom).toEqual(provider);
    expect(result.repaired).toEqual([]);
  });

  test("correctly configured providers are not migration candidates", () => {
    expect(repairRuntimeProviders({ ollama: nativeProvider }).repaired).toEqual([]);
  });

  test("repairs shared provider and only its exact workspace denials, once", async () => {
    const config = serverConfig();
    const policies = ["ollama", "openai", "opencode", "eigenwelt", "*"].map(resource => ({ action: "provider.use", resource, effect: "deny" } satisfies NonNullable<RuntimeOpencodeConfig["policies"]>[number]));
    const permissions = [{ action: "read", resource: "*", effect: "deny" }] satisfies NonNullable<RuntimeOpencodeConfig["permissions"]>;
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ providers: { ollama: brokenOllama } }));
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ policies, permissions, providerActivation: { ollama: "deny", openai: "deny" }, providerModelSelection: { ollama: ["model"] } }));
    await repairAllWorkspaceRuntimeProviders(config);
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).providers?.ollama).toEqual({ ...brokenOllama, package: nativeProvider.package });
    const stored = await readRuntimeOpencodeConfig(config, "matter");
    expect(stored.providerActivation).toEqual({ openai: "deny" });
    expect(stored.policies).toEqual(policies.filter(rule => rule.resource !== "ollama"));
    expect(stored.permissions).toEqual(permissions);
    expect(stored.providerModelSelection).toEqual({ ollama: ["model"] });
    expect(providerRepairNotices("matter")).toEqual([]);
    await writeRuntimeOpencodeConfig(config, "matter", current => ({ ...current, policies, providerActivation: { ollama: "deny", openai: "deny" } }));
    await repairAllWorkspaceRuntimeProviders(config);
    const later = await readRuntimeOpencodeConfig(config, "matter");
    expect(later.providerActivation).toEqual({ ollama: "deny", openai: "deny" });
    expect(later.policies).toEqual(policies);
  });

  test("repairs a workspace-local provider, but never reactivates an overriding remote provider", async () => {
    const config = serverConfig();
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providers: { local: brokenOllama }, providerActivation: { local: "deny", openai: "deny" } }));
    await repairAllWorkspaceRuntimeProviders(config);
    expect((await readRuntimeOpencodeConfig(config, "matter")).providerActivation).toEqual({ openai: "deny" });
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ providers: { ollama: brokenOllama } }));
    const remote = { ...brokenOllama, settings: { baseURL: "https://example.invalid/v1" } };
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providers: { ollama: remote }, providerActivation: { ollama: "deny" }, policies: [{ action: "provider.use", resource: "ollama", effect: "deny" }] }));
    await repairAllWorkspaceRuntimeProviders(config);
    const stored = await readRuntimeOpencodeConfig(config, "matter");
    expect(stored.providers?.ollama).toEqual(remote);
    expect(stored.providerActivation).toEqual({ ollama: "deny" });
    expect(stored.policies).toEqual([{ action: "provider.use", resource: "ollama", effect: "deny" }]);
  });

  test("partial startup never replays cleanup over a later manual disconnect", async () => {
    const config = serverConfig();
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ providers: { ollama: brokenOllama } }));
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providerActivation: { ollama: "deny" } }));
    // Simulate interruption before the global definition is committed.
    await repairWorkspaceRuntimeProviders(config, "matter", ["ollama"]);
    expect((await readRuntimeOpencodeConfig(config, "matter")).ollamaChatRepairIDs).toEqual(["ollama"]);
    // A settings replacement must retain the private completion receipt too.
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providerActivation: { ollama: "deny" } }));
    await repairAllWorkspaceRuntimeProviders(config);
    expect((await readRuntimeOpencodeConfig(config, "matter")).providerActivation).toEqual({ ollama: "deny" });
  });

  test("authored native overrides retain activation denials while the saved package is repaired", async () => {
    const config = serverConfig();
    await mkdir(join(root, ".opencode"));
    await writeFile(join(root, ".opencode", "opencode.jsonc"), JSON.stringify({ providers: { ollama: { settings: { baseURL: "https://example.invalid/v1" } } } }));
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, () => ({ providers: { ollama: brokenOllama } }));
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providerActivation: { ollama: "deny" } }));
    await repairAllWorkspaceRuntimeProviders(config);
    expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).providers?.ollama?.package).toBe(nativeProvider.package);
    expect((await readRuntimeOpencodeConfig(config, "matter")).providerActivation).toEqual({ ollama: "deny" });
  });

  test("empty JSONC placeholders do not block the known local repair", async () => {
    const config = serverConfig();
    await mkdir(join(root, ".opencode"));
    await writeFile(join(root, ".opencode", "opencode.jsonc"), "// empty native placeholder\n{}");
    await writeRuntimeOpencodeConfig(config, "matter", () => ({ providers: { ollama: brokenOllama }, providerActivation: { ollama: "deny" } }));
    await repairAllWorkspaceRuntimeProviders(config);
    expect((await readRuntimeOpencodeConfig(config, "matter")).providerActivation ?? {}).toEqual({});
  });
});
