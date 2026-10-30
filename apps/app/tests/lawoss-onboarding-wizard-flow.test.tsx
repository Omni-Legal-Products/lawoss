import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { OnboardingApplyResult, OnboardingProfile, OnboardingStep, OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import { addOkfFiles } from "../src/lawoss/domains/onboarding/found-flow";
import { FOUND_TEXT, foundText } from "../src/lawoss/domains/onboarding/found-text";
import { patchOnboardingProgress, readOnboardingProgress, trustedProgress, wizardOpeningStep, type WizardConnected } from "../src/lawoss/domains/onboarding/onboarding-state";
import { agentActions, effectiveEdits, firmControl, loadAgentState, type AgentState, type FirmPermissions } from "../src/lawoss/domains/onboarding/wizard/agent-mode";
import { WizardFoundView } from "../src/lawoss/domains/onboarding/wizard/found-step";
import { createWizardFlow, wizardResume } from "../src/lawoss/domains/onboarding/wizard/wizard-flow";
import { clearOnboardingReturn, markOnboardingReturn, onboardingReturnPending, OnboardingReturnLinkView } from "../src/lawoss/domains/onboarding/wizard/return-link";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";
import { t } from "../src/i18n";

function memoryStorage() {
  const data = new Map<string, string>();
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), removeItem: (key: string) => void data.delete(key) };
}
const profile = (patch: Partial<OnboardingProfile> = {}): OnboardingProfile => ({ version: 1, lawyerName: "A", jurisdiction: "sk", language: "sk", ...patch });
const applied = (path: string): OnboardingApplyResult => ({ result: "applied", clientRoot: path, workspace: { id: path, path } });
const clients: WizardConnected = { kind: "clients", root: "/p/prax", clients: [{ root: "/p/prax/A", name: "A", result: applied("/p/prax/A") }] };

describe("C1 fix 1: pojmy na obrazovkách sprievodcu", () => {
  test("found-text (okrem promptu pre agenta) nepoužíva spis, vec, matter, Angelegenheit ani Akte", () => {
    const banned: Record<string, RegExp> = {
      sk: /\b(spis|spisy|spisov|vec|veci|projekt)\b/i,
      cs: /\b(spis|spisy|věc|věci|projekt)\b/i,
      en: /\b(matter|matters|project)\b/i,
      de: /\b(Angelegenheit|Angelegenheiten|Akte|Akten|Projekt)\b/,
    };
    for (const [locale, pattern] of Object.entries(banned)) {
      for (const [key, value] of Object.entries(FOUND_TEXT[locale as "sk"])) {
        if (key === "chatPrompt") continue;
        expect([locale, key, pattern.test(value)]).toEqual([locale, key, false]);
      }
    }
    expect([foundText("en")("asMatter"), foundText("de")("asMatter")]).toEqual(["One case", "Ein Fall"]);
    expect(foundText("sk")("foundTitle")).toBe(wizardText("sk")("foundTitle"));
  });
  test("veta o dátach pri AI: poskytovateľ dostane aj to, čo asistent prečíta; schválenie mimo YOLO", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const text = wizardText(locale);
      expect(text("aiBoundariesOff").length).toBeGreaterThan(40);
      expect(text("approvalsDetails")).toContain("YOLO");
    }
    expect(wizardText("sk")("aiBoundariesOff")).toContain("čo asistent v priečinku klienta prečíta");
    expect(wizardText("sk")("approvalsDetails")).not.toMatch(/podpis|podanie|odoslanie/i);
  });
  test("N-5: „Začať nanovo“ odkazuje na skutočnú akciu bočného panela Pridať klienta", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) expect(foundText(locale)("freshHowTo")).toContain(t("lawoss.lite.add_client", locale));
    for (const locale of ["sk", "cs", "en", "de"] as const) expect(t("lawoss.alpha.notice", locale)).not.toMatch(/\b(spisy|Akten|matter)\b/i);
  });
  test("hlavná akcia praxe hovorí o klientoch v správnom tvare", () => {
    expect([1, 3, 24].map((count) => wizardText("sk")("foundAddClients", { count }))).toEqual(["Pridať pomocné súbory pre 1 klienta", "Pridať pomocné súbory pre 3 klientov", "Pridať pomocné súbory pre 24 klientov"]);
    expect(wizardText("cs")("foundAddClients", { count: 3 })).toBe("Přidat pomocné soubory pro 3 klienty");
  });
});

describe("C1 fix 1: firemné pravidlá a režim agenta", () => {
  const enforcedAllow: FirmPermissions = { mode: "enforced", locked: false, value: { edit: "allow" } };
  test("účinný stav zahŕňa firmu; firma spravuje zmeny len pravidlom pre edit/bash/lawoss_file_change", () => {
    expect(effectiveEdits({}, enforcedAllow)).toBe("allow");
    expect(effectiveEdits({ edit: "allow" }, { mode: "default", locked: false, value: { edit: "ask", bash: "ask" } })).toBe("ask");
    expect(firmControl(null)).toBe("own");
    expect(firmControl({ mode: "enforced", locked: true, value: { webfetch: "deny" } })).toBe("own");
    expect(firmControl({ mode: "enforced", locked: true, value: { lawoss_file_change: "ask" } })).toBe("locked");
    expect(firmControl(enforcedAllow)).toBe("firm");
  });
  test("načítanie: YOLO a pravidlá cez existujúce API, firma navrch", async () => {
    const api = {
      lawossYolo: async () => ({ enabled: false, locked: false, source: "default" }),
      listWorkspaces: async () => ({ items: [], activeId: "ws1" }),
      getConfig: async () => ({ opencode: { permission: {} }, legalwork: {} }),
    };
    // @ts-expect-error falošné API nesie len metódy, ktoré krok číta
    expect(await loadAgentState(api, enforcedAllow)).toMatchObject({ edits: "allow", workspaceId: "ws1", yolo: { enabled: false } });
    // @ts-expect-error falošné API nesie len metódy, ktoré krok číta
    expect((await loadAgentState(api, null)).edits).toBe("ask");
  });
  const state: AgentState = { yolo: { enabled: false, locked: false, source: "default" }, edits: "allow", workspaceId: "ws1", permission: { edit: "allow", bash: "allow", webfetch: "deny" }, loading: false };
  test("„Pýtať sa pred zmenou“ zapíše edit a bash na ask a prestaví engine; zámok firmy nezapíše nič", async () => {
    const calls: unknown[] = [];
    const api = { patchConfig: async (id: string, payload: unknown) => { calls.push(["patch", id, payload]); return {}; }, reloadEngine: async (id: string) => { calls.push(["reload", id]); return { ok: true }; } };
    // @ts-expect-error falošné API
    expect(await agentActions(api, null).askBeforeChanges(state)).toMatchObject({ edits: "ask" });
    expect(calls).toEqual([["patch", "ws1", { opencode: { permission: { edit: "ask", bash: "ask", webfetch: "deny" } } }], ["reload", "ws1"]]);
    calls.length = 0;
    // @ts-expect-error falošné API
    await expect(agentActions(api, { ...enforcedAllow, locked: true }).askBeforeChanges(state)).rejects.toThrow("permissions_locked");
    expect(calls).toEqual([]);
  });
  test("firemné pravidlo sa mení len po uvoľnení (natívne changeOrgPolicySetting); odmietnutie nezapíše nič", async () => {
    const calls: string[] = [];
    const api = { patchConfig: async () => { calls.push("patch"); return {}; } };
    let released = 0;
    // @ts-expect-error falošné API
    const declined = await agentActions(api, enforcedAllow, { releaseFirm: async () => false }).askBeforeChanges(state);
    expect([declined, calls]).toEqual([{}, []]);
    // @ts-expect-error falošné API
    const done = await agentActions(api, enforcedAllow, { releaseFirm: async (change) => { released += 1; await change(); return true; } }).askBeforeChanges(state);
    expect([released, calls, done.edits]).toEqual([1, ["patch"], "ask"]);
  });
  test("YOLO sa zapína len výslovnou akciou cez existujúce API", async () => {
    const calls: boolean[] = [];
    const api = { setLawossYolo: async (enabled: boolean) => { calls.push(enabled); return { enabled, locked: false, source: "user" }; } };
    // @ts-expect-error falošné API
    expect((await agentActions(api, null).setYolo(state, true)).yolo).toEqual({ enabled: true, locked: false, source: "user" });
    expect(calls).toEqual([true]);
  });
});

describe("C1 fix 1: riadenie sprievodcu", () => {
  const base = { initialStep: undefined, initialRoot: undefined, hasCompletedOnboarding: false, sidebarFlow: false } as const;
  test("zmiznutý priečinok v krokoch 4–6 vráti Dokumenty a zabudne pripojenie", () => {
    for (const step of ["found", "ai", "approvals", "ready"] as const) {
      const resume = wizardResume({ ...base, profile: profile({ step, foundRoot: "/p/prax" }), saved: { lane: "detailed", step, connected: clients }, foundRootMissing: true });
      expect([step, resume.step, resume.missing, resume.connected, resume.profilePatch]).toEqual([step, "folder", "/p/prax", undefined, { foundRoot: null, step: "folder" }]);
    }
  });
  test("obnova: pripojenie len k uloženému priečinku profilu; staré ai bez priečinka vedie na Dokumenty", () => {
    const ok = wizardResume({ ...base, profile: profile({ step: "ready", foundRoot: "/p/prax" }), saved: { lane: "detailed", step: "ready", connected: clients } });
    expect([ok.step, ok.foundRoot, ok.connected]).toEqual(["ready", "/p/prax", clients]);
    const foreign = wizardResume({ ...base, profile: profile({ step: "ready", foundRoot: "/iny" }), saved: { lane: "detailed", step: "ready", connected: clients } });
    expect(foreign.connected).toBeUndefined();
    expect(wizardResume({ ...base, profile: profile({ step: "ai" }), saved: { lane: "detailed", step: "ai" } }).step).toBe("folder");
    expect(wizardResume({ ...base, profile: null, saved: { lane: "detailed", step: "ready", connected: clients } })).toEqual({ step: "identity" });
    expect(trustedProgress({ lane: "detailed", step: "ready", connected: { kind: "fresh", root: "/p/LAWOSS", result: { result: "applied" } } }, { officeRoot: "/p/LAWOSS" }).connected?.kind).toBe("fresh");
    expect(wizardOpeningStep("ready", undefined, "/p/prax")).toBe("ready");
  });
  test("pripojenie z kroku 3: zaregistruje, uloží krok ai cez klienta z registrácie a nestratí voľby", async () => {
    const storage = memoryStorage();
    patchOnboardingProgress(storage, { lane: "detailed", step: "found", found: { root: "/p/prax", level: "practice", scope: "client", selected: ["A"] } });
    let current: OnboardingStep = "found";
    const steps: string[] = [];
    const original = { updateOnboardingProfile: async () => { steps.push("old"); return profile(); } };
    let live = original;
    const fresh = { updateOnboardingProfile: async (patch: Partial<OnboardingProfile>) => { steps.push(`new:${String(patch.step)}`); return profile({ step: patch.step }); } };
    const registered: unknown[] = [];
    const flow = createWizardFlow({
      live: () => live, storage: () => storage, currentStep: () => current,
      register: async (result, completion) => { registered.push([result, completion]); live = fresh; },
      onStep: (step) => { current = step; },
    });
    expect(await flow.connected(clients, applied("/p/prax/A"), { clients: [applied("/p/prax/A")] })).toBe(true);
    expect([registered.length, steps, current]).toEqual([1, ["new:ai"], "ai"]);
    expect(readOnboardingProgress(storage)).toMatchObject({ step: "ai", connected: clients, found: { selected: ["A"] } });
  });
  test("vybraný priečinok sa po skorej registrácii uloží cez klienta z registrácie, s krokom v jednom zápise", async () => {
    const patches: string[] = [];
    const writer = (name: string) => ({ updateOnboardingProfile: async (patch: object) => { patches.push(`${name}:${JSON.stringify(patch)}`); return profile(); } });
    let live = writer("old");
    const flow = createWizardFlow({
      live: () => live, storage: () => null, currentStep: () => "found",
      register: async () => undefined, onStep: () => undefined,
    });
    live = writer("new");
    await flow.rememberFoundRoot("/p/ina");
    await flow.rememberFoundRoot(null);
    await flow.move("found", { foundRoot: "/p/prax" });
    expect(patches).toEqual([
      'new:{"foundRoot":"/p/ina","step":"found"}',
      'new:{"foundRoot":null}',
      'new:{"foundRoot":"/p/prax","step":"found"}',
    ]);
  });
  test("ak advokát počas zápisu odišiel na iný krok, sprievodca ho neprenesie; nová kancelária sa neregistruje", async () => {
    let current: OnboardingStep = "folder";
    let registered = 0;
    const flow = createWizardFlow({
      live: () => ({ updateOnboardingProfile: async () => profile() }), storage: () => memoryStorage(), currentStep: () => current,
      register: async () => { registered += 1; }, onStep: (step) => { current = step; },
    });
    expect(await flow.connected(clients)).toBe(false);
    expect([current, registered]).toEqual(["folder", 1]);
    current = "found";
    await flow.connected({ kind: "fresh", root: "/p/LAWOSS", result: { result: "applied" } });
    expect([current, registered]).toEqual(["ai", 1]);
  });
  test("zlyhaná skorá registrácia nezastaví sprievodcu", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    let current: OnboardingStep = "found";
    const flow = createWizardFlow({
      live: () => ({ updateOnboardingProfile: async () => profile() }), storage: () => null, currentStep: () => current,
      register: async () => { throw new Error("register"); }, onStep: (step) => { current = step; },
    });
    expect(await flow.connected(clients)).toBe(true);
    expect(current).toBe("ai");
    warn.mockRestore();
  });
  test("dávka praxe spracuje všetkých 24 klientov (bez stropu)", async () => {
    const items = Array.from({ length: 24 }, (_, index) => ({ root: `/p/Klienti/C${String(index + 1).padStart(3, "0")}`, name: `C${index + 1}` }));
    let planned = 0;
    const api = {
      planOnboarding: async () => { planned += 1; return { id: "00000000-0000-0000-0000-000000000000", fingerprint: "f".repeat(64), preview: {} }; },
      applyOnboarding: async () => ({ result: "applied" as const }),
      updateOnboardingProfile: async () => profile(),
    };
    const batch = await addOkfFiles(api, items, { lawyerName: "A", jurisdiction: "sk", language: "sk" }, new Date(), () => undefined, String);
    expect([planned, batch.filter((item) => item.status === "done").length]).toEqual([24, 24]);
  });
  test("veľká prax: strom ukáže 8 klientov, ostatní sú v rozbaľovacom zozname a ostávajú označiteľní", () => {
    const many = Array.from({ length: 24 }, (_, index) => ({ path: `Klienti/C${index + 1}`, name: `Klient ${index + 1}` }));
    const suggestion: OnboardingSuggestion = { root: "/p/kancelaria", level: "practice", marked: false, score: 0.9, signals: [], clients: many, complete: true };
    const html = renderToStaticMarkup(<WizardFoundView text={wizardText("sk")} found={foundText("sk")} busy={false} suggestion={suggestion} headline="h" level="practice" scope="client" selected={many.map((c) => c.path)}
      onLevel={() => undefined} onScope={() => undefined} onToggle={() => undefined} onAll={() => undefined} onAdd={() => undefined} onTable={() => undefined} onPickRoot={() => undefined} childPath={(n) => n} />);
    expect(html).toMatch(/<summary>a ďalší klienti: 16<\/summary>/);
    expect(html.match(/type="checkbox"/g)).toHaveLength(24);
    expect(html).toContain(">Pridať pomocné súbory pre 24 klientov</button>");
  });
});

describe("C1 fix 1: návrat zo Nastavení AI", () => {
  test("značka sa zapíše pred odchodom do Nastavení a sprievodca ju zmaže", () => {
    const storage = memoryStorage();
    expect(onboardingReturnPending(storage)).toBe(false);
    markOnboardingReturn(storage);
    expect(onboardingReturnPending(storage)).toBe(true);
    clearOnboardingReturn(storage);
    expect(onboardingReturnPending(storage)).toBe(false);
  });
  test("odkaz vedie späť do sprievodcu", () => {
    const html = renderToStaticMarkup(<MemoryRouter><OnboardingReturnLinkView locale="sk" /></MemoryRouter>);
    expect(html).toContain('href="/welcome"');
    expect(html).toContain("Späť do nastavenia praxe");
  });
});
