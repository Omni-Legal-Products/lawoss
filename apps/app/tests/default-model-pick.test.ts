import { describe, expect, test } from "bun:test";

import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { ProviderListItem } from "../src/app/types";
import { isAgentCapableModel, pickDefaultModel } from "../src/lawoss/shell/default-model-pick";
import { getDefaultModelForSingleConnectedProvider } from "../src/react-app/infra/provider-list-query";

/**
 * Connecting OpenRouter without saving a default model let the app pick the
 * catalogue's first entry — `google/gemini-3-pro-image-preview`, an image
 * model without tool support — and every prompt then failed with HTTP 404
 * "No endpoints found that support tool use". Only a tool-capable chat model
 * may be picked; when there is none, nothing is picked and the composer keeps
 * its connect-AI state.
 */

const provider = (id: string, models: Record<string, { toolcall: boolean }>): ProviderListItem =>
  ({
    id,
    name: id,
    env: [],
    source: "api" as const,
    options: {},
    models: Object.fromEntries(
      Object.entries(models).map(([modelID, { toolcall }]) => [
        modelID,
        { id: modelID, name: modelID, capabilities: { toolcall } },
      ]),
    ),
  }) as unknown as ProviderListItem;

const openrouter = provider("openrouter", {
  "google/gemini-3-pro-image-preview": { toolcall: false },
  "anthropic/claude-sonnet-4.5": { toolcall: true },
  "openai/gpt-5": { toolcall: true },
});

describe("pickDefaultModel", () => {
  test("skips the image model at the top of the catalogue and takes the first tool-capable one", () => {
    expect(pickDefaultModel([openrouter])).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4.5",
    });
  });

  test("keeps the provider's advertised default when it can call tools", () => {
    expect(pickDefaultModel([openrouter], { openrouter: "openai/gpt-5" })).toEqual({
      providerID: "openrouter",
      modelID: "openai/gpt-5",
    });
  });

  test("ignores an advertised default that cannot call tools", () => {
    expect(
      pickDefaultModel([openrouter], { openrouter: "google/gemini-3-pro-image-preview" }),
    ).toEqual({ providerID: "openrouter", modelID: "anthropic/claude-sonnet-4.5" });
  });

  test("picks nothing when no model is usable — the connect-AI state stays", () => {
    const imagesOnly = provider("openrouter", {
      "google/gemini-3-pro-image-preview": { toolcall: false },
      // flagged tool-capable, but the id says it is not a chat endpoint
      "openai/gpt-image-2": { toolcall: true },
      "openai/gpt-realtime": { toolcall: true },
    });
    expect(pickDefaultModel([imagesOnly])).toBeNull();
    expect(pickDefaultModel([provider("empty", {})])).toBeNull();
  });

  test("does not choose arbitrarily between zero or several providers", () => {
    expect(pickDefaultModel([])).toBeNull();
    expect(pickDefaultModel([openrouter, provider("openai", { "gpt-5": { toolcall: true } })])).toBeNull();
  });
});

describe("getDefaultModelForSingleConnectedProvider", () => {
  // The auto-pick in session-route goes through this upstream function; the
  // upstream body took the catalogue's first entry, so this fails without the
  // delegation to pickDefaultModel.
  test("delegates to pickDefaultModel and skips the image model", () => {
    const list = {
      all: [openrouter],
      connected: ["openrouter"],
      default: { openrouter: "google/gemini-3-pro-image-preview" },
    } as unknown as ProviderListResponse;
    expect(getDefaultModelForSingleConnectedProvider(list)).toEqual({
      providerID: "openrouter",
      modelID: "anthropic/claude-sonnet-4.5",
    });
  });
});

describe("isAgentCapableModel", () => {
  const capable = { capabilities: { toolcall: true } };
  const model = (id: string) => ({ id, name: id, ...capable }) as unknown as ProviderListItem["models"][string];

  test("rejects non-chat endpoints by id even when flagged tool-capable", () => {
    for (const id of ["gpt-image-1", "whisper-audio", "tts-1", "gpt-4o-transcribe", "gpt-realtime", "text-embed-3"]) {
      expect(isAgentCapableModel(id, model(id))).toBe(false);
    }
  });

  test("accepts a tool-capable chat model", () => {
    expect(isAgentCapableModel("anthropic/claude-sonnet-4.5", model("anthropic/claude-sonnet-4.5"))).toBe(true);
  });

  test("rejects a model without the capability", () => {
    expect(
      isAgentCapableModel("m", { id: "m", name: "m", capabilities: { toolcall: false } } as unknown as ProviderListItem["models"][string]),
    ).toBe(false);
    expect(isAgentCapableModel("m", { id: "m", name: "m" } as unknown as ProviderListItem["models"][string])).toBe(false);
  });
});
