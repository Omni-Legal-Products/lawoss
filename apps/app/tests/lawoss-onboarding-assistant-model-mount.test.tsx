import { expect, test } from "bun:test";
import { act, useState } from "react";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef } from "../src/app/types";
import { useOnboardingModelView, type AiModelView } from "../src/lawoss/domains/onboarding/ai-step";

// N-A2-5: skutočne pripojený hook (React DOM client, nie SSR) s falošnými nastaveniami namiesto `useLocal`.
// `useOnboardingModel` mu odovzdá `local.prefs.defaultModel`, zoznam poskytovateľov a `local.setPrefs`;
// bez efektu, ktorý automatický model uloží, by chat nemal model a tento test zlyhá.

const ONE = {
  all: [{ id: "openai", name: "OpenAI", env: [], source: "api", models: { "gpt-6-luna": { id: "gpt-6-luna", name: "GPT-6 Luna", capabilities: { toolcall: true } } } }],
  connected: ["openai"],
  default: { openai: "gpt-6-luna" },
} as unknown as ProviderListResponse;
const LUNA: ModelRef = { providerID: "openai", modelID: "gpt-6-luna" };

type Prefs = { defaultModel: ModelRef | null; modelVariant: string | null };

/** Minimálny hostiteľ React DOM bez prehliadača; globály sa po teste vrátia presne tak, ako boli. */
async function mount(initial: Prefs) {
  const host = globalThis as { window?: unknown; IS_REACT_ACT_ENVIRONMENT?: boolean };
  const windowBefore = Object.getOwnPropertyDescriptor(globalThis, "window");
  const actBefore = Object.getOwnPropertyDescriptor(globalThis, "IS_REACT_ACT_ENVIRONMENT");
  Object.defineProperty(globalThis, "window", { value: { event: undefined, HTMLIFrameElement: class {} }, configurable: true, writable: true });
  host.IS_REACT_ACT_ENVIRONMENT = true;
  const observed: { prefs: Prefs; view: AiModelView; writes: number }[] = [];
  let writes = 0;
  try {
    const { createRoot } = await import("react-dom/client");
    const noop = () => undefined;
    const container = { nodeType: 1, nodeName: "DIV", tagName: "DIV", addEventListener: noop, removeEventListener: noop, ownerDocument: { addEventListener: noop, removeEventListener: noop } };
    function Probe() {
      const [prefs, setPrefsRaw] = useState(initial);
      const setPrefs = (updater: (previous: Prefs) => Prefs) => { writes++; setPrefsRaw(updater); };
      const view = useOnboardingModelView(prefs.defaultModel, ONE, setPrefs);
      observed.push({ prefs, view, writes });
      return null;
    }
    // Kontajner napodobňuje len to, čo React DOM pri koreni číta; nič sa doň nevykresľuje (Probe vracia null).
    const root = createRoot(container as unknown as Element);
    await act(async () => { root.render(<Probe />); });
    await act(async () => { root.unmount(); });
  } finally {
    if (windowBefore) Object.defineProperty(globalThis, "window", windowBefore); else delete host.window;
    if (actBefore) Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", actBefore); else delete host.IS_REACT_ACT_ENVIRONMENT;
  }
  const windowAfter = Object.getOwnPropertyDescriptor(globalThis, "window");
  const restored = windowAfter?.value === windowBefore?.value && windowAfter?.get === windowBefore?.get && Boolean(windowAfter) === Boolean(windowBefore);
  return { observed, last: observed[observed.length - 1], restored };
}

test("pripojený poskytovateľ bez modelu: efekt uloží odporúčaný model do nastavení (ako Nastavenia AI)", async () => {
  const { last, restored } = await mount({ defaultModel: null, modelVariant: "high" });
  expect(last?.prefs).toEqual({ defaultModel: LUNA, modelVariant: null });
  expect(last?.view).toMatchObject({ state: "ready", selected: LUNA });
  // Jeden zápis, potom pokoj (žiadna slučka).
  expect(last?.writes).toBe(1);
  // Globál `window` je po teste presne ten pôvodný (aj keď ho iný test v tom istom behu nastavil).
  expect(restored).toBe(true);
});

test("vybraný model mimo zoznamu sa neprepíše a nič sa nezapíše", async () => {
  const custom: ModelRef = { providerID: "kancelaria-llm", modelID: "qwen-72b" };
  const { last } = await mount({ defaultModel: custom, modelVariant: "high" });
  expect(last?.prefs).toEqual({ defaultModel: custom, modelVariant: "high" });
  expect(last?.view.state).toBe("unavailable");
  expect(last?.writes).toBe(0);
});
