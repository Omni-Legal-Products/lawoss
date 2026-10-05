import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { Client } from "../src/app/types";
import { t } from "../src/i18n";
import {
  CHATGPT_SUBSCRIPTION_MODELS,
  filterSubscriptionModels,
  isChatgptSubscription,
  subscriptionModelErrorKey,
} from "../src/lawoss/providers/subscription-models";
import { modelReadiness } from "../src/lawoss/shell/model-readiness";
import { describeOpencodeSessionError } from "../src/react-app/domains/session/sync/usechat-adapter";
import {
  fetchProviderList,
  getConnectedProviderItems,
  getDefaultModelForSingleConnectedProvider,
} from "../src/react-app/infra/provider-list-query";

// Catalogue keys that OpenCode 1.18.29 returned for OpenAI signed in with a ChatGPT
// subscription (synthetic auth.json, isolated run on 2026-10-05). `-fast` keys share
// `api.id` with their base model.
const OAUTH_KEYS = [
  "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-fast", "gpt-5.4-mini", "gpt-5.4-mini-fast",
  "gpt-5.5", "gpt-5.5-fast", "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-sol-fast",
  "gpt-5.6-terra", "gpt-5.6-terra-fast", "gpt-6-astra", "gpt-6-astra-fast",
];
const apiId = (key: string) => key.replace(/-fast$/, "");

// Partial SDK fixture: only the fields the helpers read. The cast is limited to the test.
const provider = (id: string, source: string, keys: string[]) => ({
  id,
  name: id,
  env: [],
  source,
  options: {},
  models: Object.fromEntries(keys.map((key) => [key, { id: key, name: key, api: { id: apiId(key) }, capabilities: { toolcall: true } }])),
});
const list = (providers: ReturnType<typeof provider>[], defaults: Record<string, string> = {}): ProviderListResponse =>
  ({ all: providers, connected: providers.map((p) => p.id), default: defaults }) as unknown as ProviderListResponse;

const openaiModels = (value: ProviderListResponse) =>
  Object.keys(value.all.find((p) => p.id === "openai")?.models ?? {}).sort();

describe("ChatGPT subscription models", () => {
  test("only OpenAI with source custom counts as a ChatGPT subscription", () => {
    expect(isChatgptSubscription({ id: "openai", source: "custom" })).toBe(true);
    for (const source of ["api", "env", "config"] as const) expect(isChatgptSubscription({ id: "openai", source })).toBe(false);
    expect(isChatgptSubscription({ id: "anthropic", source: "custom" })).toBe(false);
  });

  test("the picker keeps only models the subscription accepts, fast variants included", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)]));
    expect(openaiModels(filtered)).toEqual([
      "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-sol-fast",
      "gpt-5.6-terra", "gpt-5.6-terra-fast", "gpt-6-astra", "gpt-6-astra-fast",
    ]);
    for (const rejected of ["gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.4-mini", "gpt-5.5"]) {
      expect(CHATGPT_SUBSCRIPTION_MODELS.has(rejected)).toBe(false);
    }
  });

  test("an API key keeps the full catalogue and other providers are untouched", () => {
    const value = list([provider("openai", "api", ["gpt-5.4", "gpt-5.5"]), provider("anthropic", "api", ["claude-sonnet"])]);
    expect(filterSubscriptionModels(value)).toBe(value);
    const mixed = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS), provider("anthropic", "api", ["claude-sonnet"])]));
    expect(Object.keys(mixed.all.find((p) => p.id === "anthropic")?.models ?? {})).toEqual(["claude-sonnet"]);
  });

  test("an empty intersection keeps the OpenCode list instead of hiding the provider", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", ["gpt-5.4", "gpt-5.3-codex-spark"])]));
    expect(openaiModels(filtered)).toEqual(["gpt-5.3-codex-spark", "gpt-5.4"]);
    expect(getConnectedProviderItems(filtered).map((p) => p.id)).toEqual(["openai"]);
  });

  test("a default pointing at a rejected model is dropped, so the automatic pick takes a usable one", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)], { openai: "gpt-5.4" }));
    expect(filtered.default.openai).toBeUndefined();
    const pick = getDefaultModelForSingleConnectedProvider(filtered);
    expect(pick?.providerID).toBe("openai");
    expect(CHATGPT_SUBSCRIPTION_MODELS.has(apiId(pick?.modelID ?? ""))).toBe(true);
    const kept = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)], { openai: "gpt-5.6-terra-fast" }));
    expect(getDefaultModelForSingleConnectedProvider(kept)).toEqual({ providerID: "openai", modelID: "gpt-5.6-terra-fast" });
  });

  test("a stored gpt-5.4 selection shows as unavailable instead of failing with HTTP 400", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)]));
    const readiness = modelReadiness({ defaultModel: { providerID: "openai", modelID: "gpt-5.4" }, providerList: filtered });
    expect(readiness.modelUnavailable).toBe(true);
  });

  test("the provider list query applies the filter to every consumer", async () => {
    const raw = list([provider("openai", "custom", OAUTH_KEYS)]);
    const client = { provider: { list: async () => ({ data: raw }) } } as unknown as Client;
    const value = await fetchProviderList({ client, baseUrl: "http://127.0.0.1:1", directory: "/synthetic" });
    expect(openaiModels(value)).not.toContain("gpt-5.4");
    expect(openaiModels(value)).toContain("gpt-5.6-terra");
  });
});

describe("rejected subscription model error", () => {
  const codexBody = JSON.stringify({ detail: "The 'gpt-5.4' model is not supported when using Codex with a ChatGPT account." });

  test("the Codex rejection becomes a plain message in every language", () => {
    const error = { name: "APIError", data: { message: "Bad Request", statusCode: 400, responseBody: codexBody } };
    expect(subscriptionModelErrorKey(error)).toBe("lawoss.models.subscription_unsupported");
    for (const locale of ["sk", "cs", "en"] as const) {
      const text = t("lawoss.models.subscription_unsupported", locale);
      expect(text).not.toBe("lawoss.models.subscription_unsupported");
      expect(text).toContain("ChatGPT");
    }
    expect(describeOpencodeSessionError(error)).toBe(t("lawoss.models.subscription_unsupported"));
  });

  test("a 400 from OpenAI about the model is recognised even with other wording", () => {
    const error = { name: "APIError", data: { statusCode: 400, providerID: "openai", message: "Unsupported model: gpt-5.3-codex-spark" } };
    expect(subscriptionModelErrorKey(error)).toBe("lawoss.models.subscription_unsupported");
  });

  test("other errors keep the upstream description", () => {
    expect(subscriptionModelErrorKey({ name: "APIError", data: { statusCode: 400, providerID: "openai", message: "Invalid tool schema" } })).toBeNull();
    expect(subscriptionModelErrorKey({ name: "APIError", data: { statusCode: 400, providerID: "anthropic", message: "model not found" } })).toBeNull();
    expect(subscriptionModelErrorKey({ name: "APIError", data: { statusCode: 401, providerID: "openai", message: "model not supported" } })).toBeNull();
    expect(subscriptionModelErrorKey("Session failed")).toBeNull();
  });
});
