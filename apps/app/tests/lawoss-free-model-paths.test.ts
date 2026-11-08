/**
 * #231: AGENTS.md „Do not use upstream free models with client, privileged, or matter data“ platí na každej
 * ceste, ktorou chat klienta dostane model: predvolený model (Nastavenia AI, composer, automatický výber),
 * model posledne použitý v chate (`legalwork.chat-models.v1`), brána rýchlych akcií a chatu klienta
 * (`matterModelGap` → `clientChatGap`) a odoslanie do enginu. Platené a vlastné modely ostávajú voľné.
 */
import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { ProviderListView as ProviderListResponse } from "../src/app/types";
import { createClient } from "../src/app/lib/opencode";
import { queuedNativePrompt, selectSessionExecution, sendSessionCommand, sendSessionPrompt } from "../src/app/lib/system-reminder";
import { clientChatGap } from "../src/lawoss/domains/onboarding/client-chat";
import { matterModelGap } from "../src/lawoss/lite/matter-model";
import { isFreeModelRequest } from "../src/lawoss/shell/free-models";
import { modelReadiness, offeredProviderItems } from "../src/lawoss/shell/model-readiness";
import { getDefaultModelForSingleConnectedProvider } from "../src/react-app/infra/provider-list-query";

type Fixture = { source?: string; models: Record<string, { cost?: { input: number; output: number } }> };

// Partial SDK fixture: only the fields the provider-list helpers read. The cast is limited to the test.
const providerList = (providers: Record<string, Fixture>, advertised: Record<string, string> = {}): ProviderListResponse =>
  ({
    all: Object.entries(providers).map(([id, provider]) => ({
      id,
      name: id,
      env: [],
      source: provider.source ?? "api",
      models: Object.fromEntries(Object.entries(provider.models).map(([modelID, model]) => [modelID, { id: modelID, name: modelID, capabilities: { tools: true }, ...model }])),
    })),
    connected: Object.keys(providers),
    default: advertised,
  }) as unknown as ProviderListResponse;

const FREE = { providerID: "openrouter", modelID: "deepseek/deepseek-chat:free" };
const PAID = { providerID: "anthropic", modelID: "claude-sonnet" };
const PRICE = { cost: [{ input: 3, output: 15, cache: { read: 0, write: 0 } }] };
const MIXED = providerList({
  openrouter: { models: { "deepseek/deepseek-chat:free": {}, "deepseek/deepseek-r2": { cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] }, "anthropic/claude-sonnet": PRICE } },
  anthropic: { models: { "claude-sonnet": PRICE } },
  ollama: { source: "config", models: { "qwen-72b": { cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] } } },
});

describe("predvolený model chatu klienta", () => {
  test("automatický výber pri jednom poskytovateľovi nevyberie bezplatný model, ani odporúčaný", () => {
    const only = providerList({ openrouter: { models: { "deepseek/deepseek-chat:free": {}, "anthropic/claude-sonnet": PRICE } } }, { openrouter: "deepseek/deepseek-chat:free" });
    expect(getDefaultModelForSingleConnectedProvider(only)).toEqual({ providerID: "openrouter", modelID: "anthropic/claude-sonnet" });
    expect(getDefaultModelForSingleConnectedProvider(providerList({ openrouter: { models: { "deepseek/deepseek-chat:free": {} } } }))).toBeNull();
  });

  test("výber modelu v Nastaveniach AI a v composeri bezplatný model neponúkne", () => {
    const offered = offeredProviderItems(MIXED).map((provider) => [provider.id, Object.keys(provider.models)]);
    expect(offered).toEqual([
      ["openrouter", ["anthropic/claude-sonnet"]],
      ["anthropic", ["claude-sonnet"]],
      // Vlastný alebo lokálny model s nulovou cenou nie je verejný bezplatný koncový bod; ostáva.
      ["ollama", ["qwen-72b"]],
    ]);
    expect(offeredProviderItems(undefined)).toEqual([]);
  });

  test("oba zoznamy modelov (composer, Nastavenia, plánované úlohy aj okno výberu) čítajú ponuku bez bezplatných modelov", () => {
    for (const file of ["../src/components/model-select.tsx", "../src/react-app/domains/session/modals/use-model-picker.ts"]) {
      const source = readFileSync(new URL(file, import.meta.url), "utf8");
      expect(source).toContain("offeredProviderItems(");
      expect(source).not.toMatch(/getConnectedProviderItems\(data\)/);
    }
  });
});

describe("model posledne použitý v chate klienta", () => {
  test("uložený bezplatný model chatu je nedostupný, platený nie", () => {
    expect(modelReadiness({ defaultModel: FREE, providerList: MIXED }).modelUnavailable).toBe(true);
    expect(modelReadiness({ defaultModel: { providerID: "openrouter", modelID: "deepseek/deepseek-r2" }, providerList: MIXED }).modelUnavailable).toBe(true);
    expect(modelReadiness({ defaultModel: PAID, providerList: MIXED }).modelUnavailable).toBe(false);
    expect(modelReadiness({ defaultModel: { providerID: "ollama", modelID: "qwen-72b" }, providerList: MIXED }).modelUnavailable).toBe(false);
  });

  test("karta chatu hodnotí svoj uložený model rovnakým pravidlom ako composer", () => {
    const source = readFileSync(new URL("../src/react-app/domains/session/chat/workspace-chat.tsx", import.meta.url), "utf8");
    expect(source).toMatch(/modelReadiness\(\{ defaultModel: selection\.model, providerList: providers\.data \}\)\.modelUnavailable/);
  });
});

describe("brána rýchlych akcií a chatu klienta", () => {
  test("uložený x/y:free: chat klienta aj rýchle akcie hlásia chýbajúci model", () => {
    const two = providerList({ openrouter: { models: { "deepseek/deepseek-chat:free": {} } }, anthropic: { models: { "claude-sonnet": PRICE } } });
    expect(matterModelGap(FREE, two)).toBe("unavailable");
    expect(clientChatGap({ boundaries: undefined, defaultModel: FREE, providerList: two })).toBe("no-model");
    const freeOnly = providerList({ openrouter: { models: { "deepseek/deepseek-chat:free": {} } } });
    expect(clientChatGap({ boundaries: undefined, defaultModel: null, providerList: freeOnly })).toBe("no-model");
    expect(clientChatGap({ boundaries: undefined, defaultModel: PAID, providerList: two })).toBeNull();
  });
});

describe("odoslanie do enginu", () => {
  let restore = () => {};
  afterEach(() => restore());

  const capture = () => {
    const calls: Request[] = [];
    const fetch = spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      calls.push(new Request(input, init));
      return Response.json({});
    });
    restore = () => fetch.mockRestore();
    return calls;
  };

  test("rozpozná bezplatný model v požiadavke (objekt aj reťazec príkazu)", () => {
    expect(isFreeModelRequest(FREE)).toBe(true);
    expect(isFreeModelRequest("openrouter/deepseek/deepseek-chat:FREE")).toBe(true);
    expect(isFreeModelRequest(PAID)).toBe(false);
    expect(isFreeModelRequest("anthropic/claude-sonnet")).toBe(false);
    expect(isFreeModelRequest(undefined)).toBe(false);
  });

  // Engine v2: prompty, príkazy aj fronta idú cez `system-reminder.ts`, ktorý bezplatný model odmietne skôr, než niečo odošle.
  test("klient enginu odmietne bezplatný model pri každom type odoslania a nič neodošle", async () => {
    const calls = capture();
    const client = createClient("http://localhost/workspace/ws_1/opencode", "/Klienti/Novak", { mode: "legalwork", token: "t" });
    const parts = [{ type: "text" as const, text: "Zhrň spis." }];
    await expect(sendSessionPrompt(client, { sessionID: "s1", model: FREE, parts })).rejects.toThrow();
    await expect(sendSessionPrompt(client, { sessionID: "s1", model: FREE, parts }, { waitForCompletion: true })).rejects.toThrow();
    await expect(sendSessionCommand(client, { sessionID: "s1", command: "zhrn", arguments: "", model: "openrouter/deepseek/deepseek-chat:free" })).rejects.toThrow();
    expect(() => queuedNativePrompt({ sessionID: "s1", model: FREE, parts })).toThrow();
    await expect(selectSessionExecution(client, "s1", { model: FREE })).rejects.toThrow();
    expect(calls).toHaveLength(0);
  });

  test("platený model prejde bez zmeny", async () => {
    const calls = capture();
    const client = createClient("http://localhost/workspace/ws_1/opencode", "/Klienti/Novak", { mode: "legalwork", token: "t" });
    await sendSessionPrompt(client, { sessionID: "s1", model: PAID, parts: [{ type: "text", text: "Zhrň spis." }] }).catch(() => undefined);
    expect(calls.length).toBeGreaterThan(0);
    expect(queuedNativePrompt({ sessionID: "s1", model: PAID, parts: [{ type: "text", text: "Zhrň spis." }] }).model).toMatchObject({ id: "claude-sonnet", providerID: "anthropic" });
  });
});
