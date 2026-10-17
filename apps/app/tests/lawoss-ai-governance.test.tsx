import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiGuidance } from "../src/lawoss/domains/ai/guidance";

// UI assertions verify presentation and selection only. Server receiver tests own admission evidence.
test("all locales show unsupported processing and require an explicit jurisdiction for reading only", () => {
  for (const locale of ["cs", "sk", "en", "de"] as const) {
    const html = renderToStaticMarkup(<AiGuidance locale={locale} />);
    expect(html).toContain('data-lawoss-ai-governance="unsupported"');
    expect(html).toContain('value="" selected=""');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('type="checkbox"');
  }
});
