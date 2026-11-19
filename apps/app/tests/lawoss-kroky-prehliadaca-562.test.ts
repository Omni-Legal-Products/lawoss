// LAWOSS #562: vnorené nástroje vstavaného prehliadača v režime kódu ukazovali „Browser tabs open · Browser wait…“.
import { afterEach, expect, test } from "bun:test";
import { setLocale, t } from "../src/i18n";
import { lawossCodeModeLabel } from "../src/lawoss/chat/tool-labels";

afterEach(() => setLocale("en"));
const BROWSER_STEPS = ["browser.tabs_open", "browser.wait", "browser.snapshot", "browser.find", "browser.click"];

for (const locale of ["sk", "cs", "en", "de"] as const) {
  test(`${locale}: kroky prehliadača bez technických mien`, () => {
    setLocale(locale);
    const expected = ["tabs_open", "wait", "snapshot", "find", "click"].map((action) => t(`lawoss.tool.browser_${action}` as never)).join(" · ");
    for (const phase of ["active", "done"] as const) {
      const label = lawossCodeModeLabel(BROWSER_STEPS, phase);
      if (locale === "en") expect(label).toBe("Browser tabs open · Browser wait · Browser snapshot · Browser find · Browser click");
      else { expect(label).toBe(expected); expect(label).not.toMatch(/Browser (tabs|wait|snapshot|find|click)/); }
    }
    // Neznáma akcia prehliadača je všeobecný krok v jazyku rozhrania, nie technické meno.
    expect(lawossCodeModeLabel(["browser.upload_file"], "done")).toBe(t("lawoss.tool.browser_done"));
  });
}

test("cs: konkrétny text a spojenie s iným krokom", () => {
  setLocale("cs");
  expect(lawossCodeModeLabel(["browser.click", "websearch"], "done")).toBe("Prohlížeč: kliknutí · Vyhledáno na webu");
});

test("sk: akcie prehliadača s predponou legalwork_ (napr. legalwork_browser_open_url)", () => {
  setLocale("sk");
  expect(lawossCodeModeLabel(["legalwork_browser_open_url", "browser.wait", "browser.snapshot"], "done"))
    .toBe("Prehliadač: otvorenie adresy · Prehliadač: čakanie na stránku · Prehliadač: čítanie stránky");
  expect(lawossCodeModeLabel(["legalwork_browser_upload"], "done")).toBe(t("lawoss.tool.browser_done"));
});
