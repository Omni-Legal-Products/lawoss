// LAWOSS #479: výber modelu, čas správy, názov modelu a výber modelu v kroku 4 podľa jazyka rozhrania.
import { afterAll, afterEach, expect, mock, test } from "bun:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale } from "../src/i18n";

// Base UI dialóg sa bez DOM nevykreslí; obsah dialógu sa tu vykreslí priamo.
const dialogPath = "../src/components/ui/dialog";
const dialog = { ...(await import(dialogPath)) };
const inline = ({ children }: { children?: ReactNode }) => createElement("div", null, children);
mock.module(dialogPath, () => ({ ...dialog, Dialog: inline, DialogContent: inline, DialogHeader: inline, DialogTitle: inline, DialogDescription: inline, DialogFooter: inline, DialogClose: inline }));
afterAll(() => { mock.module(dialogPath, () => dialog); });
const { ModelPickerModal } = await import("../src/react-app/domains/session/modals/model-picker-modal");

afterEach(() => setLocale("en"));

const option = (modelID: string) => ({
  providerID: "openrouter", modelID, title: modelID, description: "OpenRouter", footer: "", behaviorTitle: "", behaviorLabel: "", behaviorDescription: "", behaviorValue: null, behaviorOptions: [], isFree: false, isConnected: true,
});
const picker = () => renderToStaticMarkup(
  <ModelPickerModal open options={["claude-haiku-4.5", "claude-sonnet-4.5", "gpt-5"].map(option)} query="" setQuery={() => {}} target="default" current={{ providerID: "openrouter", modelID: "gpt-5" }}
    onSelect={() => {}} onBehaviorChange={() => {}} onToggleProvider={() => {}} onOpenSettings={() => {}} onClose={() => {}} />,
);

test("výber modelu: nadpis, počet modelov, štítky a Hotovo podľa jazyka rozhrania", () => {
  const expected = { sk: ["Modely", "3 modely", "Hotovo"], cs: ["Modely", "3 modely", "Hotovo"], de: ["Modelle", "3 Modelle", "Fertig"] } as const;
  for (const [locale, texts] of Object.entries(expected)) {
    setLocale(locale as keyof typeof expected);
    const html = picker();
    for (const text of texts) expect(html).toContain(`>${text}<`);
    for (const english of [">Models<", " models<", ">New<", ">Done<", ">Current<", ">Enabled<"]) expect(html).not.toContain(english);
  }
  setLocale("en");
  expect(picker()).toContain(">3 models<");
});

test("čas správy v chate podľa jazyka rozhrania: 24 h v sk/cs/de", async () => {
  const { formatMessageTimestamp } = await import("../src/components/chat/utils");
  const today = new Date(); today.setHours(10, 14, 0, 0);
  const evening = new Date(); evening.setHours(22, 5, 0, 0);
  for (const locale of ["sk", "cs", "de"] as const) {
    setLocale(locale);
    expect([formatMessageTimestamp(today.getTime()), formatMessageTimestamp(evening.getTime())]).toEqual(["10:14", "22:05"]);
  }
  setLocale("en");
  expect(formatMessageTimestamp(today.getTime())).toMatch(/^10:14\sAM$/);
});

test("predvolený model Fusion má rovnaký názov ako inde, aj bez katalógu poskytovateľa", async () => {
  const { resolveModelDisplayName, resolveModelLabel } = await import("../src/app/utils");
  const model = { providerID: "openrouter", modelID: "anthropic/claude-haiku-4.5" };
  const providers = [{ id: "openrouter", name: "OpenRouter", env: [], models: { "anthropic/claude-haiku-4.5": { id: "anthropic/claude-haiku-4.5", name: "Claude Haiku 4.5 (latest)" } } }];
  expect(resolveModelLabel(model, providers as never)).toBe("Claude Haiku 4.5 (latest)");
  expect(resolveModelLabel(model, [])).toBe("Claude Haiku 4.5");
  expect(resolveModelDisplayName("anthropic/claude-haiku-4.5")).toBe("Claude Haiku 4.5");
});

test("výber modelu v kroku 4 sprievodcu má prístupný názov", async () => {
  const { AssistantStepView } = await import("../src/lawoss/domains/onboarding/wizard/assistant-step");
  const { wizardText } = await import("../src/lawoss/domains/onboarding/wizard/wizard-text");
  const choices = [{ providerID: "openrouter", modelID: "anthropic/claude-haiku-4.5", label: "Claude Haiku 4.5" }];
  const html = renderToStaticMarkup(
    <AssistantStepView text={wizardText("sk")} locale="sk" boundariesOn={null} busy={false} onOpenAiSettings={() => {}} onContinue={() => {}} onSelectModel={() => {}}
      model={{ state: "ready", providers: [{ id: "openrouter", name: "OpenRouter" }], selected: choices[0], choices } as never} />,
  );
  expect(html).toMatch(/<select[^>]*aria-label="Model asistenta"/);
});
