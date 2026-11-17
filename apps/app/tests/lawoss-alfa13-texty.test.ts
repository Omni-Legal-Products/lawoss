// LAWOSS: texty, ktorým advokát pri overení alfy 12 (14. 11. 2026) nerozumel.
import { afterEach, describe, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import type { ModelInfo } from "@opencode/client";
import { setLocale, t, type Language } from "../src/i18n";
import { getToolHistoryLabel } from "../src/components/tools/tool-presentation";
import { getToolActivityLabel } from "../src/lib/tool-activity";
import { lawossCodeModeLabel } from "../src/lawoss/chat/tool-labels";
import { getModelBehaviorSummary } from "../src/app/lib/model-behavior";
import { lawossVariantLabel, localizeBehaviorSummary } from "../src/lawoss/chat/model-behavior-labels";
import { removeClientConfirmStore, requestRemoveClientConfirm, settleRemoveClientConfirm } from "../src/lawoss/shell/remove-client-confirm";
import { OKF_PAMAT_DESCRIPTION_CS, OKF_PAMAT_SKILL_NAME, OKF_MEMORY_CLI_RESOURCE_NAME, okfMemoryCliSource, pamatSkillBody } from "../src/lawoss/okf/skill-bundle";
import { BUNDLED_OKF_SKILL_DESCRIPTIONS } from "../src/lawoss/okf/bundled-skill-hashes";
import { refreshOkfSkills, type OkfSkillClient } from "../src/lawoss/okf/skill-refresh";

afterEach(() => setLocale("en"));

const tool = (toolName: string, input: Record<string, unknown>, done = false): DynamicToolUIPart => done
  ? { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state: "output-available", input, output: "{}" }
  : { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state: "input-available", input };

describe("kroky agenta bez zástupných slov", () => {
  test("čítanie bez cesty nepíše „file“", () => {
    setLocale("sk");
    expect(getToolHistoryLabel(tool("read", {}, true))).toBe("Prečítaný súbor");
    expect(getToolActivityLabel(tool("read", {}))).toBe("Čítanie súboru");
    // S cestou ostáva meno súboru.
    expect(getToolHistoryLabel(tool("read", { filePath: "/a/zmluva.pdf" }, true))).toBe(t("tool_run.read_file", { file: "zmluva.pdf" }));
  });

  test("hľadanie bez vzoru je všeobecný krok; zadaný vzor sa ukáže tak, ako ho agent hľadal", () => {
    setLocale("sk");
    expect(getToolHistoryLabel(tool("grep", {}, true))).toBe(t("tool_run.summary.search"));
    expect(getToolActivityLabel(tool("grep", {}))).toBe(t("tool_activity.searching_files"));
    expect(getToolHistoryLabel(tool("grep", { pattern: "lehota" }, true))).toBe(t("tool_run.searched_for", { pattern: "lehota" }));
  });

  for (const locale of ["sk", "cs", "en", "de"] as Language[]) {
    test(`${locale}: hľadanie na webe a akcie služby v režime kódu nie sú surové mená`, () => {
      setLocale(locale);
      for (const phase of ["active", "done"] as const) {
        for (const names of [["websearch"], ["legalwork_websearch"], ["legalwork.extension_list_actions"], ["extension.list_actions"], ["legalwork_extension_list_actions"]]) {
          expect(lawossCodeModeLabel(names, phase)).not.toMatch(/websearch|extension|list actions/i);
        }
      }
    });
  }

  test("sk: konkrétne texty", () => {
    setLocale("sk");
    expect(lawossCodeModeLabel(["websearch"], "active")).toBe("Hľadanie na webe");
    expect(lawossCodeModeLabel(["websearch"], "done")).toBe("Vyhľadané na webe");
    expect(lawossCodeModeLabel(["legalwork.extension_list_actions"], "done")).toBe("Akcie pripojenej služby");
  });
});

function model(efforts: string[], defaultEffort?: string): ModelInfo {
  return {
    id: "test", modelID: "test", providerID: "openai", name: "Test", enabled: true,
    package: "@opencode/ai/providers/openai-compatible",
    capabilities: { tools: true, input: ["text"], output: ["text"] },
    cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }],
    limit: { context: 128_000, output: 16_000 }, status: "active", headers: {}, time: { released: 0 },
    settings: defaultEffort ? { reasoningEffort: defaultEffort } : {},
    compatibility: { reasoningField: "reasoning_content" },
    variants: efforts.map(id => ({ id, settings: { reasoningEffort: id } })),
  };
}

describe("miera uvažovania", () => {
  test("sk: voľby a vybraná voľba po slovensky, hodnoty ostávajú kľúčmi katalógu", () => {
    setLocale("sk");
    const keys = ["none", "low", "medium", "high", "xhigh", "max"];
    const summary = localizeBehaviorSummary(getModelBehaviorSummary("openai", model(keys, "medium"), null));
    expect(summary.options.map((option) => [option.value, option.label])).toEqual([
      ["none", "Žiadne"], ["low", "Nízke"], ["medium", "Stredné"], ["high", "Vysoké"], ["xhigh", "Veľmi vysoké"], ["max", "Maximálne"],
    ]);
    expect(summary.label).toBe("Stredné");
    expect(summary.value).toBeNull();
    expect(localizeBehaviorSummary(getModelBehaviorSummary("openai", model(keys, "medium"), "high")).label).toBe("Vysoké");
  });

  test("cs a neznámy kľúč vlastného poskytovateľa", () => {
    setLocale("cs");
    expect(lawossVariantLabel("xhigh")).toBe("Velmi vysoké");
    expect(lawossVariantLabel("CustomBudget")).toBe("CustomBudget");
    const summary = localizeBehaviorSummary(getModelBehaviorSummary("custom", model(["CustomBudget", "high"]), null));
    expect(summary.options.map((option) => option.label)).toEqual(["Vysoké", "CustomBudget"]);
    // Bez predvolenej voľby ostáva nadpis súhrnu.
    expect(summary.label).toBe(getModelBehaviorSummary("custom", model(["CustomBudget", "high"]), null).label);
  });

  test("nadpis výberu je preložený", () => {
    setLocale("sk");
    expect(t("model_behavior.title_reasoning_effort")).toBe("Miera uvažovania");
  });
});

describe("potvrdenie Odobrať klienta", () => {
  test("s hostiteľom čaká na voľbu, odpojenie hostiteľa znamená Zrušiť", async () => {
    const detach = removeClientConfirmStore.attachHost();
    const confirmed = requestRemoveClientConfirm();
    expect(removeClientConfirmStore.snapshot()).toBe(true);
    settleRemoveClientConfirm(true);
    expect(await confirmed).toBe(true);
    expect(removeClientConfirmStore.snapshot()).toBe(false);
    const cancelled = requestRemoveClientConfirm();
    detach();
    expect(await cancelled).toBe(false);
  });

  test("texty tlačidiel po slovensky a česky", () => {
    setLocale("sk");
    expect([t("lawoss.client.remove_cancel"), t("lawoss.client.remove_confirm")]).toEqual(["Zrušiť", "Odobrať klienta"]);
    setLocale("cs");
    expect([t("lawoss.client.remove_cancel"), t("lawoss.client.remove_confirm")]).toEqual(["Zrušit", "Odebrat klienta"]);
  });
});

describe("popis /okf-pamat", () => {
  test("sk a cs popis, spúšťače ostávajú", () => {
    expect(pamatSkillBody("sk").description).toMatch(/^Použite pri čítaní alebo zápise pamäte prípadu/);
    expect(pamatSkillBody("cs").description).toBe(OKF_PAMAT_DESCRIPTION_CS);
    for (const locale of ["sk", "cs"] as Language[]) {
      const { description } = pamatSkillBody(locale);
      expect(description.length).toBeLessThanOrEqual(1024);
      for (const trigger of ["zapíš do pamäte", "zapiš do paměti", "case memory"]) expect(description).toContain(trigger);
    }
    expect(pamatSkillBody("cs").content).toBe(pamatSkillBody("sk").content);
  });

  function workspace(description: string) {
    const writes: string[] = [];
    const body = pamatSkillBody("sk");
    const client: OkfSkillClient = {
      listSkills: async () => ({ items: [{ name: OKF_PAMAT_SKILL_NAME, path: "/", description, scope: "project" }], skipped: [] }),
      getSkill: async () => ({ item: { name: OKF_PAMAT_SKILL_NAME, path: "/", description, scope: "project" }, content: `---\nname: okf-pamat\ndescription: ${description}\n---\n${body.content}` }),
      upsertSkill: async (_id, payload) => { writes.push(payload.description ?? ""); return { name: payload.name, path: "/", description: payload.description ?? "", scope: "project" }; },
      listSkillResources: async () => ({ items: [{ name: OKF_MEMORY_CLI_RESOURCE_NAME, path: "/", size: 1, updatedAt: 0 }] }),
      getSkillResource: async () => ({ item: { name: OKF_MEMORY_CLI_RESOURCE_NAME, path: "/", size: 1, updatedAt: 0 }, content: Buffer.from(okfMemoryCliSource()).toString("base64") }),
      upsertSkillResource: async (_id, _skill, payload) => ({ ok: true, name: payload.name, path: "/", action: "updated" }),
    };
    const skill = { name: OKF_PAMAT_SKILL_NAME, body, resource: OKF_MEMORY_CLI_RESOURCE_NAME, source: okfMemoryCliSource() };
    return { client, writes, skill };
  }

  test("nainštalovaný skill so starým anglickým popisom dostane slovenský", async () => {
    const english = [...BUNDLED_OKF_SKILL_DESCRIPTIONS].find((text) => text.startsWith("Use when reading or writing case memory"));
    expect(english).toBeDefined();
    const f = workspace(english ?? "");
    expect(await refreshOkfSkills(f.client, "w", [f.skill])).toEqual({ modified: [], written: [OKF_PAMAT_SKILL_NAME] });
    expect(f.writes).toEqual([pamatSkillBody("sk").description]);
  });

  test("vlastný popis používateľa a aktuálny popis sa neprepíšu", async () => {
    for (const description of ["Môj popis pamäte", pamatSkillBody("sk").description]) {
      const f = workspace(description);
      expect(await refreshOkfSkills(f.client, "w", [f.skill])).toEqual({ modified: [], written: [] });
      expect(f.writes).toEqual([]);
    }
  });
});
