import { describe, expect, test } from "bun:test";

import { mergeRuntimeProviderPatch } from "./runtime-opencode-config-store.js";

const ollama = { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: "http://localhost:11434/v1" } };
const vllm = { npm: "@ai-sdk/openai-compatible", name: "vLLM", options: { baseURL: "http://localhost:8000/v1" } };

describe("mergeRuntimeProviderPatch", () => {
  test("adds a new provider onto an empty map", () => {
    expect(mergeRuntimeProviderPatch(undefined, { ollama })).toEqual({ ollama });
  });

  test("keeps existing providers when adding another", () => {
    expect(mergeRuntimeProviderPatch({ ollama }, { vllm })).toEqual({ ollama, vllm });
  });

  test("overrides an existing provider with the same id", () => {
    const updated = { ...ollama, name: "Ollama Remote" };
    expect(mergeRuntimeProviderPatch({ ollama }, { ollama: updated })).toEqual({ ollama: updated });
  });

  test("a null value removes that provider (disconnect)", () => {
    expect(mergeRuntimeProviderPatch({ ollama, vllm }, { ollama: null })).toEqual({ vllm });
  });

  test("removing the only provider yields an empty map", () => {
    expect(mergeRuntimeProviderPatch({ ollama }, { ollama: null })).toEqual({});
  });

  test("deleting a provider that isn't present is a no-op", () => {
    expect(mergeRuntimeProviderPatch({ ollama }, { vllm: null })).toEqual({ ollama });
  });

  test("does not mutate the current map", () => {
    const current = { ollama, vllm };
    mergeRuntimeProviderPatch(current, { ollama: null });
    expect(current).toEqual({ ollama, vllm });
  });

  test("add and delete can be mixed in one patch", () => {
    expect(mergeRuntimeProviderPatch({ ollama }, { ollama: null, vllm })).toEqual({ vllm });
  });
});
