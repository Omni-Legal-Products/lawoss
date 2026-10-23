import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import type { ModelRef } from "../src/app/types";
import {
  onboardingAutoModel,
  onboardingModelChoices,
  onboardingModelView,
  saveDefaultModel,
  withDefaultModel,
} from "../src/lawoss/domains/onboarding/wizard/assistant-model";
import { AssistantStepView } from "../src/lawoss/domains/onboarding/wizard/assistant-step";
import { readyChatClient, readyPlan, readyRows } from "../src/lawoss/domains/onboarding/wizard/ready-model";
import { ReadySummaryView } from "../src/lawoss/domains/onboarding/wizard/ready-step";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import type { WizardConnected } from "../src/lawoss/domains/onboarding/onboarding-state";

// N-A2-5 / N-A2-4 (test alfa2 23. 10. 2026): po pripojení poskytovateľa krok 4 hlásil „Model nie je vybraný“
// bez výberu, krok 6 „Pozor“ a chat s klientom sa neponúkol. MČ: predvolený model poskytovateľa sa vyberie
// sám a uloží ako v Nastaveniach AI, dá sa zmeniť; s vybraným modelom je chat hlavnou akciou kroku 6.

type Model = { name: string; toolcall: boolean };
// Čiastočný SDK zoznam: len polia, ktoré čítajú pomocníci zoznamu poskytovateľov (ako v lawoss-model-readiness).
const providerList = (connected: string[], providers: Record<string, Record<string, Model>>, defaults: Record<string, string> = {}): ProviderListResponse =>
  ({
    all: Object.entries(providers).map(([id, models]) => ({
      id,
      name: id === "openai" ? "OpenAI" : id,
      env: [],
      source: "api",
      models: Object.fromEntries(Object.entries(models).map(([modelID, model]) => [modelID, { id: modelID, name: model.name, capabilities: { toolcall: model.toolcall } }])),
    })),
    connected,
    default: defaults,
  }) as unknown as ProviderListResponse;

const OPENAI = {
  "gpt-image-2": { name: "GPT Image 2", toolcall: false },
  "gpt-6-luna": { name: "GPT-6 Luna", toolcall: true },
  "gpt-6-mini": { name: "GPT-6 mini", toolcall: true },
};
const ONE = providerList(["openai"], { openai: OPENAI }, { openai: "gpt-6-luna" });
const LUNA: ModelRef = { providerID: "openai", modelID: "gpt-6-luna" };
const MINI: ModelRef = { providerID: "openai", modelID: "gpt-6-mini" };

const sk = wizardText("sk");
const noop = () => undefined;

describe("krok 4: predvolený model pripojeného poskytovateľa (N-A2-5)", () => {
  test("pripojený poskytovateľ bez modelu: vyberie sa jeho odporúčaný model s nástrojmi", () => {
    expect(onboardingAutoModel(null, ONE)).toEqual(LUNA);
    // Bez odporúčania prvý model s nástrojmi, nie obrázkový.
    expect(onboardingAutoModel(null, providerList(["openai"], { openai: OPENAI }))).toEqual(LUNA);
  });
  test("vybraný model sa nikdy neprepíše, ani keď v tomto zozname chýba (iný priečinok, vlastný poskytovateľ)", () => {
    expect(onboardingAutoModel(MINI, ONE)).toBeNull();
    // Advokát má vlastného poskytovateľa v priestore A; onboarding číta zoznam priestoru B len s OpenAI.
    const custom: ModelRef = { providerID: "kancelaria-llm", modelID: "qwen-72b" };
    expect(onboardingAutoModel(custom, ONE)).toBeNull();
    const { view, auto } = onboardingModelView(custom, ONE);
    expect(auto).toBeNull();
    expect(view.state).toBe("unavailable");
    expect(view.choices?.length).toBe(2);
    // Krok ukáže výber, ale nič neuloží.
    let state = { defaultModel: custom as ModelRef | null, modelVariant: null as string | null };
    const writes: string[] = [];
    saveDefaultModel((updater: (previous: typeof state) => typeof state) => { writes.push("setPrefs"); state = updater(state); }, auto);
    expect(writes).toEqual([]);
    expect(state.defaultModel).toEqual(custom);
    const html = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={view} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} onSelectModel={noop} />);
    expect(html).toContain("data-lawoss-ai-model-picker");
    expect(html).toMatch(/<option value="" disabled="" selected="">Vyberte model<\/option>/);
  });
  test("platný uložený model mimo ponuky je vo výbere vybraný (nie „Vyberte model“ pri stave pripravený)", () => {
    const list = providerList(["openai"], { openai: { ...OPENAI, "gpt-6-legacy": { name: "GPT-6 Legacy", toolcall: false } } }, { openai: "gpt-6-luna" });
    const legacy: ModelRef = { providerID: "openai", modelID: "gpt-6-legacy" };
    const { view } = onboardingModelView(legacy, list);
    expect(view.state).toBe("ready");
    expect(view.choices?.[0]).toEqual({ ...legacy, label: "OpenAI · GPT-6 Legacy" });
    const html = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={view} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} onSelectModel={noop} />);
    expect(html).toMatch(/<option value="0" selected="">OpenAI · GPT-6 Legacy<\/option>/);
    expect(html).not.toContain("Vyberte model");
  });
  test("bez poskytovateľa, bez zoznamu alebo pri viacerých poskytovateľoch sa nič nevyberá samo", () => {
    expect(onboardingAutoModel(null, providerList([], { openai: OPENAI }))).toBeNull();
    expect(onboardingAutoModel(null, undefined)).toBeNull();
    expect(onboardingAutoModel(null, providerList(["openai", "anthropic"], { openai: OPENAI, anthropic: { "claude-sonnet": { name: "Claude Sonnet", toolcall: true } } }))).toBeNull();
    // Ukončená bezplatná úroveň nie je model.
    expect(onboardingAutoModel(null, providerList(["opencode"], { opencode: { "big-pickle": { name: "Big Pickle", toolcall: true } } }))).toBeNull();
  });
  test("výber ponúka len modely, s ktorými asistent pracuje; pri viacerých poskytovateľoch s menom poskytovateľa", () => {
    expect(onboardingModelChoices(ONE)).toEqual([{ ...LUNA, label: "GPT-6 Luna" }, { ...MINI, label: "GPT-6 mini" }]);
    const two = providerList(["openai", "anthropic"], { openai: OPENAI, anthropic: { "claude-sonnet": { name: "Claude Sonnet", toolcall: true } } });
    expect(onboardingModelChoices(two).map((choice) => choice.label)).toEqual(["OpenAI · GPT-6 Luna", "OpenAI · GPT-6 mini", "anthropic · Claude Sonnet"]);
  });
  test("stav kroku: automaticky vybraný model je hneď pripravený a treba ho uložiť", () => {
    const { view, auto } = onboardingModelView(null, ONE);
    expect(auto).toEqual(LUNA);
    expect(view).toMatchObject({ state: "ready", modelLabel: "OpenAI · GPT-6 Luna", selected: LUNA, providers: [{ id: "openai", name: "OpenAI" }] });
    // Uložený model sa už neukladá znova.
    expect(onboardingModelView(LUNA, ONE).auto).toBeNull();
    // Viac poskytovateľov: advokát vyberá sám, výber je k dispozícii.
    const two = onboardingModelView(null, providerList(["openai", "anthropic"], { openai: OPENAI, anthropic: { "claude-sonnet": { name: "Claude Sonnet", toolcall: true } } }));
    expect(two.auto).toBeNull();
    expect(two.view.state).toBe("pick-model");
    expect(two.view.choices?.length).toBe(3);
  });
});

describe("uloženie modelu rovnako ako Nastavenia AI", () => {
  const prefs = { defaultModel: null as ModelRef | null, modelVariant: "high" as string | null, other: 1 };
  test("nový model nastaví defaultModel a zruší variant; ten istý model nič nemení", () => {
    expect(withDefaultModel(prefs, LUNA)).toEqual({ defaultModel: LUNA, modelVariant: null, other: 1 });
    const same = { ...prefs, defaultModel: LUNA };
    expect(withDefaultModel(same, { ...LUNA })).toBe(same);
  });
  test("zápis ide cez setPrefs; bez modelu sa nič nezapíše", () => {
    let state = prefs;
    const calls: string[] = [];
    const setPrefs = (updater: (previous: typeof prefs) => typeof prefs) => { calls.push("setPrefs"); state = updater(state); };
    saveDefaultModel(setPrefs, null);
    expect(calls).toEqual([]);
    saveDefaultModel(setPrefs, onboardingModelView(state.defaultModel, ONE).auto);
    expect(calls).toEqual(["setPrefs"]);
    expect(state).toEqual({ defaultModel: LUNA, modelVariant: null, other: 1 });
    // Zmena vo výbere.
    saveDefaultModel(setPrefs, MINI);
    expect(state.defaultModel).toEqual(MINI);
  });
});

describe("krok 4: výber modelu na obrazovke", () => {
  test("pripravený model je vybraný v malom výbere a dá sa zmeniť", () => {
    const { view } = onboardingModelView(null, ONE);
    const html = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={view} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} onSelectModel={noop} />);
    expect(html).toContain("data-lawoss-ai-model-picker");
    expect(html).toContain("Model asistenta");
    expect(html).toMatch(/<option value="0" selected="">GPT-6 Luna<\/option><option value="1">GPT-6 mini<\/option>/);
    expect(html).not.toContain("GPT Image 2");
    expect(html).toContain("Model: OpenAI · GPT-6 Luna");
    expect(html).not.toContain("Model nie je vybraný");
    expect(html).toContain('data-lawoss-ai-model="ready"');
    expect(html).toMatch(/<button type="button" class="lw-btn gold">Pokračovať<\/button>/);
  });
  test("bez vybraného modelu ponúkne výber s výzvou; bez poskytovateľa výber nie je", () => {
    const html = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={{ state: "pick-model", providers: [{ id: "openai", name: "OpenAI" }], choices: onboardingModelChoices(ONE) }} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} onSelectModel={noop} />);
    expect(html).toMatch(/<option value="" disabled="" selected="">Vyberte model<\/option>/);
    const none = renderToStaticMarkup(<AssistantStepView text={sk} locale="sk" model={{ state: "no-model", providers: [], choices: [] }} boundariesOn={false} busy={false} onOpenAiSettings={noop} onContinue={noop} onSelectModel={noop} />);
    expect(none).not.toContain("data-lawoss-ai-model-picker");
  });
  test("texty výberu vo všetkých jazykoch", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      expect(wizardText(locale)("aiModelPick")).not.toBe("aiModelPick");
      expect(wizardText(locale)("aiModelChoose")).not.toBe("aiModelChoose");
    }
  });
});

describe("krok 6: s vybraným modelom asistent pripravený a chat s klientom hlavnou akciou (N-A2-4)", () => {
  const result = (id: string, root: string) => ({ result: "applied" as const, clientRoot: root, workspace: { id, path: root } });
  const one: WizardConnected = { kind: "clients", root: "/p/C001", clients: [{ root: "/p/C001", name: "C001 SYN Tatran", result: result("w1", "/p/C001") }] };
  const practice: WizardConnected = { kind: "clients", root: "/p", clients: [
    { root: "/p/C002", name: "C002", result: result("w2", "/p/C002") },
    { root: "/p/C017", name: "C017", result: result("w3", "/p/C017") },
  ] };
  const fromClient = (workspaceId: string) => ({ ...onboardingModelView(null, ONE).view, workspaceId });
  test("riadok AI asistent je Hotové bez opravy, keď sa model vybral sám", () => {
    const { view } = onboardingModelView(null, ONE);
    const ai = readyRows(sk, { connected: one, model: view, agent: "ask" }).find((row) => row.id === "ai");
    expect(ai).toMatchObject({ tone: "ok", value: "OpenAI · GPT-6 Luna" });
    expect(ai?.fix).toBeUndefined();
  });
  test("jeden klient aj prax s viacerými klientmi: chat je hlavná akcia, prehľad vedľa", () => {
    expect(readyChatClient(practice)?.name).toBe("C002");
    expect(readyPlan(one, fromClient("w1"))).toMatchObject({ primary: "chat", overview: "readyOverview", chatWith: { name: "C001 SYN Tatran" } });
    expect(readyPlan(practice, fromClient("w2"))).toMatchObject({ primary: "chat", overview: "readyOverviewClients", chatWith: { name: "C002" } });
    const html = renderToStaticMarkup(<ReadySummaryView text={sk} found={foundText("sk")} connected={practice} model={fromClient("w2")} agent="ask" busy={false} onGo={noop} onChat={noop} onOverview={noop} onTable={noop} />);
    expect(html).toContain('data-lawoss-ready-primary="chat"');
    expect(html).toMatch(/class="lw-btn gold"[^>]*><svg[\s\S]*?<\/svg> Otvoriť chat s klientom C002<\/button><button type="button" class="lw-btn">Otvoriť klientov<\/button>/);
    expect(html).not.toContain("Pozor");
  });
  test("model pripravený v inom priestore alebo neznámo kde: hlavná akcia ostáva prehľad", () => {
    expect(readyPlan(practice, onboardingModelView(null, ONE).view)).toMatchObject({ primary: "overview" });
    expect(readyPlan(practice, fromClient("w3"))).toMatchObject({ primary: "overview" });
    // Klient bez pracovného priečinka: pripravenosť jeho priestoru sa nedá overiť.
    const noWorkspace: WizardConnected = { kind: "clients", root: "/p/C009", clients: [{ root: "/p/C009", name: "C009", result: { result: "applied", clientRoot: "/p/C009" } }] };
    expect(readyPlan(noWorkspace, fromClient("w1"))).toMatchObject({ primary: "overview" });
  });
  test("bez modelu ostáva prehľad a oprava (chat by nefungoval)", () => {
    expect(readyPlan(practice, { state: "pick-model" })).toMatchObject({ primary: "overview", overview: "readyOverviewClients" });
  });
});
