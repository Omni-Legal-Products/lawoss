import { expect, test } from "bun:test";
import { createParser } from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { buildDemoViews, buildDemoWikiReport, indexLawFirmDemo } from "../../../apps/server/scripts/fixtures/law-firm-wiki";
import { queryWikiPages } from "../../../apps/server/src/wiki/data-query";
import { OpenUIView, openUILibrary } from "./runtime";
import { isLocalOpenUIProgram } from "./catalog";

const pages = indexLawFirmDemo(), views = [...buildDemoViews(pages, "demo-wiki"), buildDemoWikiReport(pages, "demo-wiki")];
for (const view of views) {
  test(`${view.key} program parses against the real bundled catalog and renders its indexed data`, () => {
    expect(isLocalOpenUIProgram(view.input.program)).toBe(true);
    const parser = createParser(openUILibrary.toJSONSchema()), parsed = parser.parse(view.input.program);
    expect(parsed.meta.errors).toEqual([]); expect(parsed.meta.incomplete).toBe(false); expect(parsed.root?.typeName).toBe("Stack");
    const datasets = view.input.datasets ?? Object.fromEntries(Object.entries(view.input.queries).map(([name, query]) => [name, queryWikiPages(pages, query)]));
    // Replace only the external Query statements to exercise the same component tree with
    // real query output in deterministic server rendering (React effects do not run in SSR).
    const program = view.input.program.replace(/^(\w+) = Query\([^\n]*\)$/gm, (_, name: string) => `${name} = ${JSON.stringify(datasets[name])}`);
    expect(parser.parse(program).meta.errors).toEqual([]);
    const html = renderToStaticMarkup(<OpenUIView program={program} />);
    expect(html).not.toContain("unsupported program"); expect(html).not.toContain("<iframe");
    if (view.key === "portfolio") { expect(html).toContain("Demo Alder Studio"); expect(html).toContain("3,938,750"); expect(html).toContain("Dormant"); }
    if (view.key === "matters") { expect(html).toContain("110"); expect(html).toContain("Overdue internal targets"); expect(html).toContain("Partner Rowan"); }
    if (view.key === "knowledge") { expect(html).toContain("Client intake"); expect(html).toContain("Engagement-letter.docx"); }
    if (view.key === "briefing") { expect(html).toContain("73,800"); expect(html).toContain("M063"); expect(datasets.matters.sourceOwner).toEqual({ kind: "wiki", id: "demo-wiki" }); }
  });
}
