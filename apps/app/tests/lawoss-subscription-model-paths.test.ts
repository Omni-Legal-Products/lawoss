import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { Client, ModelRef } from "../src/app/types";
import { matterModelGap } from "../src/lawoss/lite/matter-model";
import { composerModelState, modelReadiness, onboardingModelReadiness } from "../src/lawoss/shell/model-readiness";
import {
  fetchProviderList,
  getConnectedProviderItems,
  getDefaultModelForSingleConnectedProvider,
} from "../src/react-app/infra/provider-list-query";

/**
 * Každá cesta, ktorou appka model načíta alebo vyberie sama, číta zoznam z `fetchProviderList`
 * (jediné volanie `provider.list` v appke). Testy idú cez neho, nie cez filter priamo.
 */
const KEYS = [
  "gpt-5.3-codex-spark", "gpt-5.4", "gpt-5.4-fast", "gpt-5.4-mini", "gpt-5.5", "gpt-5.5-fast",
  "gpt-5.6-luna", "gpt-5.6-luna-fast", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-terra-fast",
  "gpt-6-astra", "gpt-6-luna", "gpt-6-luna-fast", "gpt-6-sol", "gpt-6.1-sol",
];
const baseId = (key: string) => key.replace(/-(fast|flex|ultrafast)$/, "");

// Partial SDK fixture, cast limited to the test: OpenAI signed in with a ChatGPT subscription.
const engineList = (extra: Array<{ id: string; models: string[] }> = []): ProviderListResponse =>
  ({
    all: [
      { id: "openai", name: "OpenAI", env: [], source: "custom", options: {}, models: Object.fromEntries(KEYS.map((key) => [key, { id: key, name: key, api: { id: baseId(key) }, capabilities: { toolcall: true } }])) },
      ...extra.map((p) => ({ id: p.id, name: p.id, env: [], source: "api", options: {}, models: Object.fromEntries(p.models.map((key) => [key, { id: key, name: key, api: { id: key }, capabilities: { toolcall: true } }])) })),
    ],
    connected: ["openai", ...extra.map((p) => p.id)],
    // OpenCode's own default for the subscription (observed on 1.18.29).
    default: { openai: "gpt-5.6-terra-fast" },
  }) as unknown as ProviderListResponse;

const load = (raw: ProviderListResponse) => {
  const client = { provider: { list: async () => ({ data: raw }) } } as unknown as Client;
  return fetchProviderList({ client, baseUrl: "http://127.0.0.1:1", directory: "/synthetic" });
};

/** Rozhodnutie efektu v session-route: platná voľba ostáva, inak automatický výber. */
const sessionRoutePick = (stored: ModelRef | null, list: ProviderListResponse): ModelRef | null => {
  const unavailable = modelReadiness({ defaultModel: stored, providerList: list }).modelUnavailable;
  if (stored && !unavailable) return stored;
  return getDefaultModelForSingleConnectedProvider(list) ?? stored;
};

const REJECTED = ["gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.4-mini", "gpt-5.5"];
const LUNA = { providerID: "openai", modelID: "gpt-6-luna" };

describe("every automatic model path sees only subscription models", () => {
  test("model picker and settings: no rejected model, no speed variant", async () => {
    const list = await load(engineList());
    const ids = getConnectedProviderItems(list).flatMap((p) => Object.keys(p.models));
    for (const id of REJECTED) expect(ids).not.toContain(id);
    expect(ids.some((id) => /-fast$/.test(id))).toBe(false);
  });

  test("onboarding model step: a stored rejected model reads as unavailable", async () => {
    const list = await load(engineList());
    const stored = { providerID: "openai", modelID: "gpt-5.4" };
    expect(composerModelState(onboardingModelReadiness(stored, list))).toBe("unavailable");
  });

  test("automatic pick after connecting ChatGPT takes Luna, not OpenCode's default", async () => {
    const list = await load(engineList());
    expect(list.default.openai).toBe("gpt-6-luna");
    expect(sessionRoutePick(null, list)).toEqual(LUNA);
  });

  test("restoring a stored rejected or fast model replaces it with Luna", async () => {
    const list = await load(engineList());
    for (const modelID of ["gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.6-terra-fast"]) {
      expect(sessionRoutePick({ providerID: "openai", modelID }, list)).toEqual(LUNA);
    }
  });

  test("a model the user chose stays, even when it is not Luna", async () => {
    const list = await load(engineList());
    const own = { providerID: "openai", modelID: "gpt-6.1-sol" };
    expect(sessionRoutePick(own, list)).toEqual(own);
  });

  test("with a second provider a stored rejected model blocks sending instead of reaching the engine", async () => {
    const list = await load(engineList([{ id: "anthropic", models: ["claude-sonnet"] }]));
    const stored = { providerID: "openai", modelID: "gpt-5.4" };
    expect(sessionRoutePick(stored, list)).toEqual(stored);
    expect(composerModelState(modelReadiness({ defaultModel: stored, providerList: list }))).toBe("unavailable");
  });

  test("matter detail, quick actions and a new chat from the matter use the same list", async () => {
    const list = await load(engineList());
    expect(matterModelGap(null, list)).toBeNull();
    expect(matterModelGap({ providerID: "openai", modelID: "gpt-5.4" }, list)).toBeNull();
    const two = await load(engineList([{ id: "anthropic", models: ["claude-sonnet"] }]));
    expect(matterModelGap({ providerID: "openai", modelID: "gpt-5.4" }, two)).toBe("unavailable");
  });
});
