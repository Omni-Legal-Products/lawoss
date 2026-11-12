import { describe, expect, test } from "bun:test";

import {
  localRuntimeTemplates,
  localRuntimeRequiresChat,
  resolveTemplateName,
  slugifyProviderId,
} from "../src/react-app/domains/connections/provider-auth/local-templates";

describe("local runtime templates", () => {
  test("has the expected runtimes with unique ids", () => {
    const ids = localRuntimeTemplates().map((template) => template.id);
    expect(ids).toEqual(["llamacpp", "vllm", "localai", "ollama", "lmstudio"]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("every template autofills a base URL (regression: Ollama/LM Studio must not be blank)", () => {
    for (const template of localRuntimeTemplates()) {
      expect(template.baseURL).toMatch(/^https?:\/\/.+\/v1$/);
      expect(template.placeholder).toMatch(/^https?:\/\/.+\/v1$/);
    }
    const byId = Object.fromEntries(localRuntimeTemplates().map((t) => [t.id, t]));
    expect(byId.ollama.baseURL).toBe("http://localhost:11434/v1");
    expect(byId.lmstudio.baseURL).toBe("http://localhost:1234/v1");
  });

  test("all templates route through the chat-completions SDK", () => {
    for (const template of localRuntimeTemplates()) {
      expect(template.apiType).toBe("chat");
    }
  });

  test("only the engine auto-detected runtimes are flagged", () => {
    const autoDetected = localRuntimeTemplates().filter((t) => t.autoDetected).map((t) => t.id);
    expect(autoDetected.sort()).toEqual(["ollama"]);
  });
});

describe("slugifyProviderId", () => {
  test.each([
    ["Ollama", "ollama"],
    ["llama.cpp", "llama-cpp"],
    ["LM Studio", "lm-studio"],
    ["vLLM", "vllm"],
    ["  My  Provider  ", "my-provider"],
    ["", "custom-provider"],
    ["   ", "custom-provider"],
    ["***", "custom-provider"],
  ])("slugifies %p -> %p", (input, expected) => {
    expect(slugifyProviderId(input)).toBe(expected);
  });
});

describe("local runtime API lock", () => {
  test("locks all templates and redacted saved template endpoints to chat", () => {
    for (const template of localRuntimeTemplates()) {
      expect(localRuntimeRequiresChat("", template.id)).toBe(true);
      expect(localRuntimeRequiresChat("", slugifyProviderId(template.name))).toBe(true);
      for (const host of ["localhost", "127.0.0.1", "[::1]"]) {
        const url = new URL(template.baseURL);
        url.hostname = host;
        expect(localRuntimeRequiresChat(`${url.href}/`)).toBe(true);
      }
    }
    expect(localRuntimeRequiresChat("http://127.0.0.1:9999/v1", "ollama")).toBe(true);
  });

  test.each([
    "", "not a URL", "https://api.openai.com/v1", "https://example.invalid:11434/v1",
    "http://localhost.evil.invalid:11434/v1", "http://localhost:11435/v1", "http://localhost:11434/other",
    "http://localhost:11434/v1?other=true", "http://localhost:11434/v1#other", "ftp://localhost:11434/v1",
    "http://user:password@localhost:11434/v1",
  ])("keeps generic or invalid endpoints outside the template lock: %s", (url) => {
    expect(localRuntimeRequiresChat(url)).toBe(false);
  });
});

describe("resolveTemplateName", () => {
  const ollama = localRuntimeTemplates().find((t) => t.id === "ollama")!;
  const vllm = localRuntimeTemplates().find((t) => t.id === "vllm")!;

  test("fills a blank name with the template name", () => {
    expect(resolveTemplateName("", ollama)).toBe("Ollama");
    expect(resolveTemplateName("   ", ollama)).toBe("Ollama");
  });

  test("replaces a name that is still another template's default", () => {
    // User picked vLLM (name -> "vLLM"), then switches to Ollama.
    expect(resolveTemplateName("vLLM", ollama)).toBe("Ollama");
    expect(resolveTemplateName(vllm.name, ollama)).toBe("Ollama");
  });

  test("preserves a name the user typed themselves", () => {
    expect(resolveTemplateName("My Remote Box", ollama)).toBe("My Remote Box");
  });
});
