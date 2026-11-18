// LAWOSS #562: vnorené nástroje vstavaného prehliadača v režime kódu ukazovali „Browser tabs open · Browser wait…“.
import { afterEach, expect, test } from "bun:test";
import { setLocale, t } from "../src/i18n";
import { lawossCodeModeLabel } from "../src/lawoss/chat/tool-labels";

afterEach(() => setLocale("en"));
const BROWSER_STEPS = ["browser.tabs_open", "browser.wait", "browser.snapshot", "browser.find", "browser.click"];

for (const locale of ["sk", "cs", "en", "de"] as const) {
  test(`${locale}: kroky prehliadača bez technických mien`, () => {
    setLocale(locale);
    for (const phase of ["active", "done"] as const) {
      const label = lawossCodeModeLabel(BROWSER_STEPS, phase);
      expect(label).toBe(t(phase === "active" ? "lawoss.tool.browser" : "lawoss.tool.browser_done"));
      expect(label).not.toMatch(/tabs open|snapshot|Browser wait/i);
    }
  });
}

test("cs: konkrétny text a spojenie s iným krokom", () => {
  setLocale("cs");
  expect(lawossCodeModeLabel(["browser.tabs_open", "websearch"], "done")).toBe(`${t("lawoss.tool.browser_done")} · ${t("lawoss.tool.web_search_done")}`);
});
