import { describe, expect, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";

function providerStore(workerType: "local" | "remote" = "local", fail = false, advertiseAnthropic = true) {
  const authorizedMethods: number[] = [];
  const authorizedProviders: string[] = [];
  const requests: string[] = [];
  const savedKeys: unknown[] = [];
  const client = createOpencodeClient({ baseUrl: "https://provider-preview.invalid", fetch: async request => {
    const url = new URL(request.url);
    requests.push(url.pathname);
    if (url.pathname === "/provider/auth") return Response.json(fail ? { message: "Unavailable" } : {
      openai: [
        { type: "api", label: "API key" },
        { type: "oauth", label: "ChatGPT Plus/Pro (headless)" },
        { type: "oauth", label: "ChatGPT Plus/Pro (browser)" },
      ],
      google: [{ type: "oauth", label: "Google sign-in" }],
      ...(advertiseAnthropic ? { anthropic: [
        { type: "oauth", label: "Claude Pro/Max" },
        { type: "oauth", label: "Create an API Key" },
      ] } : {}),
    }, { status: fail ? 503 : 200 });
    if (/^\/provider\/[^/]+\/oauth\/authorize$/.test(url.pathname)) {
      const body: unknown = await request.json();
      if (typeof body !== "object" || body === null || !("method" in body) || typeof body.method !== "number") throw new Error("Invalid OAuth method");
      authorizedMethods.push(body.method);
      authorizedProviders.push(url.pathname.split("/")[2]!);
      return Response.json({ url: "https://auth.openai.com/preview", method: "auto", instructions: "Preview only" });
    }
    if (url.pathname === "/auth/anthropic" && request.method === "PUT") {
      savedKeys.push(await request.json());
      return Response.json(true);
    }
    if (url.pathname === "/instance/dispose") return Response.json(true);
    if (url.pathname === "/global/health") return Response.json({ healthy: true });
    if (url.pathname === "/config") return Response.json({});
    if (url.pathname === "/provider") return Response.json({ all: [], connected: ["anthropic"], default: {} });
    throw new Error(`Unexpected provider request: ${url.pathname}`);
  } });
  const store = createProviderAuthStore({
    client: () => client,
    baseUrl: () => "https://provider-preview.invalid",
    providers: () => [{ id: "anthropic", name: "Anthropic", env: [], source: "api", options: {}, models: {} }],
    providerDefaults: () => ({}), providerConnectedIds: () => [], disabledProviders: () => [],
    selectedWorkspaceDisplay: () => ({ id: "preview", name: "Preview", path: "/preview", preset: "local", workspaceType: workerType }),
    selectedWorkspaceRoot: () => "/preview", runtimeWorkspaceId: () => null,
    legalworkServer: { getSnapshot: () => ({ legalworkServerStatus: "disconnected", legalworkServerClient: null, legalworkServerCapabilities: null }) },
    setProviders: () => {}, setProviderDefaults: () => {}, setProviderConnectedIds: () => {}, setDisabledProviders: () => {},
    markOpencodeConfigReloadRequired: () => {},
  });
  return { store, authorizedMethods, authorizedProviders, requests, savedKeys };
}

describe("direct subscription OAuth", () => {
  test("carries the selected subscription and resets the intent before another provider is chosen", async () => {
    const { store } = providerStore();
    await store.openProviderAuthModal({ preferredProviderId: "openai", startOAuth: true });
    expect(store.getSnapshot().providerAuthStartOAuth).toBe(true);
    expect(store.getSnapshot().providerAuthPreferredProviderId).toBe("openai");
    store.closeProviderAuthModal();
    expect(store.getSnapshot().providerAuthStartOAuth).toBe(false);
    await store.openProviderAuthModal();
    expect(store.getSnapshot().providerAuthStartOAuth).toBe(false);
    expect(store.getSnapshot().providerAuthPreferredProviderId).toBeNull();
  });

  const workers: Array<"local" | "remote"> = ["local", "remote"];
  for (const worker of workers) test(`uses the worker's available OAuth method for ${worker} without assuming index zero`, async () => {
    const { store, authorizedMethods } = providerStore(worker);
    await store.openProviderAuthModal({ preferredProviderId: "openai", startOAuth: true });
    const selected = store.getSnapshot().providerAuthMethods.openai.find(method => method.type === "oauth");
    expect(selected).toBeDefined();
    const result = await store.startProviderAuth("openai", selected?.methodIndex);
    expect(result.methodIndex).toBe(worker === "local" ? 2 : 1);
    expect(authorizedMethods).toEqual([result.methodIndex]);
  });

  test("clears direct OAuth intent when loading provider methods fails", async () => {
    const { store } = providerStore("local", true);
    await expect(store.openProviderAuthModal({ preferredProviderId: "openai", startOAuth: true })).rejects.toThrow();
    expect(store.getSnapshot().providerAuthStartOAuth).toBe(false);
    expect(store.getSnapshot().providerAuthPreferredProviderId).toBeNull();
    expect(store.getSnapshot().providerAuthModalOpen).toBe(false);
  });
});

// LAWOSS: prihlásenie Anthropic cez plugin `opencode-anthropic-auth` (Claude Pro/Max aj
// „Create an API Key“) ostáva; je vstupnou podmienkou alfy (rozhodnutie MČ). Upstream v0.2.11
// ho zrušil a Anthropic obmedzil na ručný API kľúč.
describe("LAWOSS: Anthropic keeps its OAuth methods next to the manual API key", () => {
  for (const worker of ["local", "remote"] satisfies Array<"local" | "remote">) {
    test(`offers the engine's Anthropic OAuth methods for ${worker}`, async () => {
      const { store, authorizedMethods, authorizedProviders } = providerStore(worker);
      await store.openProviderAuthModal({ preferredProviderId: "anthropic" });
      const methods = store.getSnapshot().providerAuthMethods.anthropic ?? [];
      expect(methods.filter(method => method.type === "oauth").map(method => method.label)).toEqual(["Claude Pro/Max", "Create an API Key"]);
      await store.startProviderAuth("anthropic", 1);
      expect(authorizedProviders).toEqual(["anthropic"]);
      expect(authorizedMethods).toEqual([1]);
    });
  }

  test("stores the manually entered Anthropic key without starting OAuth", async () => {
    const { store, savedKeys, requests } = providerStore();
    await store.submitProviderApiKey("anthropic", "  synthetic-anthropic-key  ");
    expect(savedKeys).toEqual([{ type: "api", key: "synthetic-anthropic-key" }]);
    expect(requests.filter(path => path.includes("/oauth/"))).toEqual([]);
  });

  test("other providers retain their OAuth method and original index", async () => {
    const { store, authorizedMethods, authorizedProviders } = providerStore();
    await store.openProviderAuthModal();
    await store.startProviderAuth("google", 0);
    expect(authorizedProviders).toEqual(["google"]);
    expect(authorizedMethods).toEqual([0]);
  });
});
