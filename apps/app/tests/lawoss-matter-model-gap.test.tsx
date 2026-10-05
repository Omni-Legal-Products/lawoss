import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import { t } from "../src/i18n";
import { AI_SETTINGS_PATH, matterModelGap } from "../src/lawoss/lite/matter-model";
import { LiteMatterView } from "../src/lawoss/lite/pages/matter-page";

// Partial SDK fixture: only the fields the provider-list helpers read. The cast is limited to the test.
const providerList = (connected: string[], models: Record<string, string[]>): ProviderListResponse =>
  ({
    all: Object.entries(models).map(([id, ids]) => ({
      id,
      name: id,
      env: [],
      source: "api",
      models: Object.fromEntries(ids.map((modelId) => [modelId, { id: modelId, name: modelId, capabilities: { toolcall: true } }])),
    })),
    connected,
    default: {},
  }) as unknown as ProviderListResponse;

const CLAUDE = { providerID: "anthropic", modelID: "claude-sonnet" };
const TWO = { anthropic: ["claude-sonnet"], openai: ["gpt-5.6-terra"] };

describe("quick actions know in advance whether a model is connected", () => {
  test("nothing is blocked while the provider list is still loading", () => {
    expect(matterModelGap(null, undefined)).toBeNull();
  });

  test("no connected provider and no model asks to connect one", () => {
    expect(matterModelGap(null, providerList([], TWO))).toBe("no-model");
  });

  test("the retired free tier does not count as a model", () => {
    expect(matterModelGap({ providerID: "opencode", modelID: "big-pickle" }, providerList(["opencode"], { opencode: ["big-pickle"] }))).toBe("no-model");
  });

  test("one connected provider is enough: the conversation picks its model itself", () => {
    expect(matterModelGap(null, providerList(["openai"], TWO))).toBeNull();
  });

  test("several providers without a selection ask for a pick", () => {
    expect(matterModelGap(null, providerList(["anthropic", "openai"], TWO))).toBe("pick-model");
  });

  test("a selection that is gone is reported as unavailable", () => {
    expect(matterModelGap({ providerID: "openai", modelID: "gpt-5.4" }, providerList(["anthropic", "openai"], TWO))).toBe("unavailable");
  });

  test("a connected, available selection lets the actions run", () => {
    expect(matterModelGap(CLAUDE, providerList(["anthropic", "openai"], TWO))).toBeNull();
  });
});

describe("matter detail without a model", () => {
  const matter = { path: "Klienti/Novák/Spisy/A", title: "Novák - vymáhanie", matterRef: "12Cb/45/2026", deadlines: [], openTasks: [], counts: { records: 0, evidence: 0, subjects: 0 } };
  const render = (modelGap: "no-model" | "pick-model" | "unavailable" | null) =>
    renderToStaticMarkup(
      <MemoryRouter>
        <LiteMatterView matter={matter} cockpit={null} busy={null} error={null} onAction={() => {}} onFiles={() => {}} modelGap={modelGap} />
      </MemoryRouter>,
    );
  const buttons = (html: string) => [...html.matchAll(/<button[^>]*class="lw-matter-action[^"]*"[^>]*>([^<]*)<\/button>/g)]
    .map((match) => ({ label: match[1], disabled: /\sdisabled=""/.test(match[0]) }));

  test("says so up front, links to AI settings and leaves only adding a document", () => {
    const html = render("no-model");
    expect(html).toContain('data-lawoss-lite="model-gap"');
    expect(html).toContain(t("lawoss.lite.model_gap_no_model"));
    expect(html).toContain(`href="${AI_SETTINGS_PATH}"`);
    expect(html).not.toContain(t("lawoss.lite.action_error_generic"));
    const actions = buttons(html);
    expect(actions.length).toBeGreaterThan(5);
    for (const action of actions) {
      expect(action.disabled).toBe(action.label === t("lawoss.lite.action_add_document") ? false : true);
    }
  });

  test("pick and unavailable states have their own text", () => {
    expect(render("pick-model")).toContain(t("lawoss.lite.model_gap_pick_model"));
    expect(render("unavailable")).toContain(t("lawoss.lite.model_gap_unavailable"));
  });

  test("with a model the notice is absent and the actions are enabled", () => {
    const html = render(null);
    expect(html).not.toContain('data-lawoss-lite="model-gap"');
    expect(buttons(html).every((action) => !action.disabled)).toBe(true);
  });

  test("the notice exists in Slovak, Czech and English without technical words", () => {
    for (const locale of ["sk", "cs", "en"] as const) {
      for (const key of ["model_gap_no_model", "model_gap_pick_model", "model_gap_unavailable", "model_gap_open"]) {
        const text = t(`lawoss.lite.${key}`, locale);
        expect(text).not.toBe(`lawoss.lite.${key}`);
        expect(text).not.toMatch(/OAuth|API|provider list|HTTP|session/i);
      }
    }
  });
});
