import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import {
  composerModelState,
  modelReadiness,
  onboardingModelReadiness,
} from "../src/lawoss/shell/model-readiness";

// Partial SDK fixture: only the fields the provider-list helpers read. The cast
// is limited to the test; the full SDK type carries engine fields not used here.
const providerList = (connected: string[], models: Record<string, string[]>): ProviderListResponse =>
  ({
    all: Object.entries(models).map(([id, ids]) => ({
      id,
      name: id === "anthropic" ? "Anthropic" : id,
      env: [],
      source: "api",
      models: Object.fromEntries(ids.map((modelId) => [modelId, { id: modelId, name: modelId, capabilities: { toolcall: true } }])),
    })),
    connected,
    default: {},
  }) as unknown as ProviderListResponse;

const CLAUDE = { providerID: "anthropic", modelID: "claude-sonnet" };

describe("model readiness shared by the composer and onboarding", () => {
  test("a connected, available selection is ready", () => {
    const readiness = modelReadiness({ defaultModel: CLAUDE, providerList: providerList(["anthropic"], { anthropic: ["claude-sonnet"] }) });
    expect(readiness).toEqual({ selectedModel: CLAUDE, modelUnavailable: false, hasUsableModel: true, providerConnectedCount: 1 });
    expect(composerModelState(readiness)).toBe("ready");
  });

  test("no selection and nothing connected is the composer's no-model notice", () => {
    const readiness = modelReadiness({ defaultModel: null, providerList: providerList([], { anthropic: ["claude-sonnet"] }) });
    expect(readiness.selectedModel.providerID).toBe("");
    expect(composerModelState(readiness)).toBe("no-model");
  });

  test("no selection with a connected provider asks for a pick", () => {
    const readiness = modelReadiness({ defaultModel: null, providerList: providerList(["anthropic"], { anthropic: ["claude-sonnet"] }) });
    expect(readiness.providerConnectedCount).toBe(1);
    expect(composerModelState(readiness)).toBe("pick-model");
  });

  test("a selection the providers no longer serve is unavailable", () => {
    const readiness = modelReadiness({ defaultModel: CLAUDE, providerList: providerList([], { anthropic: ["claude-sonnet"] }) });
    expect(readiness).toMatchObject({ modelUnavailable: true, hasUsableModel: false, providerConnectedCount: 0 });
    expect(composerModelState(readiness)).toBe("unavailable");
  });

  test("before the list resolves the composer trusts the selection and the tracked ids", () => {
    expect(modelReadiness({ defaultModel: CLAUDE, providerList: undefined })).toMatchObject({ modelUnavailable: false, providerConnectedCount: 1 });
    expect(modelReadiness({ defaultModel: null, providerList: undefined, fallbackConnectedCount: 2 }).providerConnectedCount).toBe(2);
  });

  test("disabled providers do not count as connected", () => {
    const list = providerList(["anthropic"], { anthropic: ["claude-sonnet"] });
    expect(modelReadiness({ defaultModel: null, providerList: list, disabledProviderIds: ["anthropic"] }).providerConnectedCount).toBe(0);
  });
});

describe("onboarding never reports a retired free provider as a connected model", () => {
  test("a stored selection on the retired tier is no model", () => {
    for (const providerID of ["opencode", "eigenwelt-free"]) {
      const readiness = onboardingModelReadiness({ providerID, modelID: "big-pickle" }, providerList([providerID], { [providerID]: ["big-pickle"] }));
      expect(composerModelState(readiness)).toBe("no-model");
    }
  });

  test("a connected retired provider is not counted", () => {
    const readiness = onboardingModelReadiness(null, providerList(["opencode", "eigenwelt-free"], { opencode: [], "eigenwelt-free": ["x"] }));
    expect(readiness.providerConnectedCount).toBe(0);
    expect(composerModelState(readiness)).toBe("no-model");
  });

  test("a real provider next to the retired one still counts", () => {
    const readiness = onboardingModelReadiness(CLAUDE, providerList(["opencode", "anthropic"], { opencode: [], anthropic: ["claude-sonnet"] }));
    expect(composerModelState(readiness)).toBe("ready");
  });
});
