import { describe, expect, test } from "bun:test";
import { nativeProviderClient } from "./lawoss-native-provider-client";
import type { ProviderListView as ProviderListResponse } from "../src/app/types";
import type { Client } from "../src/app/types";
import { t } from "../src/i18n";
import {
  CHATGPT_RECOMMENDED_MODELS,
  CHATGPT_SUBSCRIPTION_MODELS,
  filterSubscriptionModels,
  isChatgptSubscription,
  subscriptionModelErrorKey,
  subscriptionSpeedBase,
} from "../src/lawoss/providers/subscription-models";
import { chatModelKey, useSessionModelStore } from "../src/react-app/domains/session/chat/session-model-store";
import { modelReadiness } from "../src/lawoss/shell/model-readiness";
import { describeOpencodeSessionError } from "../src/react-app/domains/session/sync/usechat-adapter";
import {
  fetchProviderList,
  getDefaultModelForSingleConnectedProvider,
} from "../src/react-app/infra/provider-list-query";

// Catalogue keys that OpenCode 1.18.29 returned for OpenAI signed in with a ChatGPT
// subscription (synthetic auth.json, isolated runs on 2026-10-05): first with the bundled
// catalogue, then with the catalogue refreshed from models.dev. `-fast`, `-flex` and
// `-ultrafast` keys share `api.id` with their base model (only the service tier differs).
const OAUTH_KEYS = [
  "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-fast", "gpt-5.4-mini", "gpt-5.4-mini-fast",
  "gpt-5.5", "gpt-5.5-fast", "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-sol-fast",
  "gpt-5.6-terra", "gpt-5.6-terra-fast", "gpt-6-astra", "gpt-6-astra-fast",
];
const OAUTH_KEYS_REFRESHED = [
  ...OAUTH_KEYS, "gpt-5.4-mini-flex", "gpt-6-astra-ultrafast", "gpt-6-luna", "gpt-6-luna-fast",
  "gpt-6-sol", "gpt-6-sol-fast", "gpt-6.1-sol", "gpt-6.1-sol-fast",
  "gpt-6.1-terra", "gpt-6.1-terra-fast", "gpt-6.2-sol", "gpt-6.2-sol-fast", "gpt-6.2-astra", "gpt-6.2-astra-fast",
];
const apiId = (key: string) => key.replace(/-(fast|flex|ultrafast)$/, "");

// Partial SDK fixture: only the fields the helpers read. The cast is limited to the test.
const provider = (id: string, source: string, keys: string[]) => ({
  id,
  name: id,
  env: [],
  source,
  options: {},
  models: Object.fromEntries(keys.map((key) => [key, { id: key, name: key, modelID: apiId(key) , api: { id: apiId(key) }, capabilities: { tools: true } }])),
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

  test("the picker offers the subscription catalog and native priority aliases", () => {
    const refreshed = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS_REFRESHED)]));
    const expected = [...CHATGPT_SUBSCRIPTION_MODELS].flatMap(id => [id, `${id}-fast`]).sort();
    expect(openaiModels(refreshed)).toEqual(expected);
    expect(openaiModels(refreshed)).toContain("gpt-6.2-astra-fast");
    expect(openaiModels(refreshed)).toContain("gpt-6.2-sol-fast");
    for (const rejected of ["gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.4-mini", "gpt-5.5"]) {
      expect(CHATGPT_SUBSCRIPTION_MODELS.has(rejected)).toBe(false);
    }
  });

  test("native account inventory admits a new model and its verified Fast route", () => {
    const fixture = list([provider("openai", "custom", ["gpt-6.2-sol", "future-model", "future-model-fast", "api-only"])]);
    const subscription = fixture.all[0];
    for (const key of ["future-model", "future-model-fast"]) {
      subscription.models[key] = Object.assign(subscription.models[key], { legalwork: { defaultVariantID: null, subscriptionModel: true } });
    }
    const fast = subscription.models["future-model-fast"];
    expect(subscriptionSpeedBase(subscription, "future-model")).toBeUndefined();
    fast.body = { service_tier: "priority" };
    expect(subscriptionSpeedBase(subscription, "future-model")).toBe("future-model");
    expect(subscriptionSpeedBase({ ...subscription, source: "api" }, "future-model")).toBeUndefined();
    const filtered = filterSubscriptionModels(fixture);
    expect(openaiModels(filtered)).toEqual(["future-model", "future-model-fast", "gpt-6.2-sol"]);
  });

  test("speed belongs to the current chat and preserves its saved model and reasoning", () => {
    const first = chatModelKey("server", "office", "first"), second = chatModelKey("server", "office", "second");
    const selection = { model: { providerID: "openai", modelID: "gpt-6.2-astra" }, variant: "high" };
    const store = useSessionModelStore.getState();
    store.initialize(first, selection); store.initialize(second, selection);
    store.setSpeed(first, selection.model.modelID, true);
    expect(useSessionModelStore.getState().speedByChat[first]?.fast).toBe(true);
    expect(useSessionModelStore.getState().speedByChat[second]).toBeUndefined();
    expect(useSessionModelStore.getState().selections[first]).toEqual(selection);
    expect(useSessionModelStore.getState().selections[second]).toEqual(selection);
  });

  test("an API key keeps the full catalogue and other providers are untouched", () => {
    const value = list([provider("openai", "api", ["gpt-5.4", "gpt-5.5"]), provider("anthropic", "api", ["claude-sonnet"])]);
    expect(filterSubscriptionModels(value)).toBe(value);
    const mixed = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS), provider("anthropic", "api", ["claude-sonnet"])]));
    expect(Object.keys(mixed.all.find((p) => p.id === "anthropic")?.models ?? {})).toEqual(["claude-sonnet"]);
  });

  test("a connected account with no eligible models cannot select API-only models", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", ["gpt-5.4", "gpt-5.3-codex-spark"])]));
    expect(openaiModels(filtered)).toEqual([]);
    expect(filtered.connected).toEqual(["openai"]);
    expect(getDefaultModelForSingleConnectedProvider(filtered)).toBeNull();
  });

  test("the automatic pick prefers Luna: gpt-6-luna when the catalogue has it, else gpt-5.6-luna", () => {
    // OpenCode's own default for the subscription is gpt-5.6-terra-fast.
    const refreshed = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS_REFRESHED)], { openai: "gpt-5.6-terra-fast" }));
    expect(refreshed.default.openai).toBe("gpt-6-luna");
    expect(getDefaultModelForSingleConnectedProvider(refreshed)).toEqual({ providerID: "openai", modelID: "gpt-6-luna" });
    const bundled = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)], { openai: "gpt-5.4" }));
    expect(getDefaultModelForSingleConnectedProvider(bundled)).toEqual({ providerID: "openai", modelID: "gpt-5.6-luna" });
    expect([...CHATGPT_RECOMMENDED_MODELS]).toEqual(["gpt-6-luna", "gpt-5.6-luna"]);
  });

  test("without any Luna a rejected default is dropped and the pick is still usable", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", ["gpt-5.4", "gpt-5.6-sol", "gpt-5.6-terra"])], { openai: "gpt-5.4" }));
    expect(filtered.default.openai).toBeUndefined();
    const pick = getDefaultModelForSingleConnectedProvider(filtered);
    expect(pick?.providerID).toBe("openai");
    expect(CHATGPT_SUBSCRIPTION_MODELS.has(pick?.modelID ?? "")).toBe(true);
  });

  test("an API key keeps OpenCode's default and the user's own choice is never replaced", () => {
    const api = filterSubscriptionModels(list([provider("openai", "api", ["gpt-5.4", "gpt-6-luna"])], { openai: "gpt-5.4" }));
    expect(api.default.openai).toBe("gpt-5.4");
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS_REFRESHED)]));
    const own = { providerID: "openai", modelID: "gpt-6-sol" };
    expect(modelReadiness({ defaultModel: own, providerList: filtered }).hasUsableModel).toBe(true);
  });

  test("a stored gpt-5.4 selection shows as unavailable instead of failing with HTTP 400", () => {
    const filtered = filterSubscriptionModels(list([provider("openai", "custom", OAUTH_KEYS)]));
    const readiness = modelReadiness({ defaultModel: { providerID: "openai", modelID: "gpt-5.4" }, providerList: filtered });
    expect(readiness.modelUnavailable).toBe(true);
  });

  test("the provider list query applies the filter to every consumer", async () => {
    const raw = list([provider("openai", "custom", OAUTH_KEYS)]);
    const client = nativeProviderClient(raw);
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
