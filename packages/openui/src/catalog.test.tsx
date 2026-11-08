import { expect, test } from "bun:test";
import { createParser, createStreamingParser } from "@openuidev/react-lang";
import { renderToStaticMarkup } from "react-dom/server";
import { OPENUI_CATALOG } from "./catalog";
import { OpenUIView, openUILibrary } from "./runtime";

test("the agent catalog example parses with the exact runtime component schemas", () => {
  const parsed = createParser(openUILibrary.toJSONSchema()).parse(OPENUI_CATALOG.example);
  expect(parsed.meta.errors).toEqual([]);
  expect(parsed.meta.incomplete).toBe(false);
  expect(parsed.root?.typeName).toBe("Stack");
  expect(parsed.queryStatements).toHaveLength(1);
  expect(parsed.mutationStatements).toEqual([]);
});
// LAWOSS (akceptácia 8. 11. 2026): lang-core 0.4.1 nepozná `meno=hodnota`; katalóg ho preto nesmie radiť.
test("catalog signatures are positional and the documented forms parse without errors", () => {
  for (const [name, signature] of Object.entries(OPENUI_CATALOG.components)) {
    expect(`${name}: ${signature.split(":")[0]}`).not.toMatch(/\w=\w/);
  }
  const parser = createParser(openUILibrary.toJSONSchema());
  const q = 'matters = Query("data", {name:"matters"}, {rows:[],total:0})\n';
  const positional = parser.parse(q + 'root = Stack([Heading("Veci", 1), Table(matters.rows, [{field:"case",label:"Prípad"},{field:"status",label:"Stav"},{field:"due",label:"Termín"}], true), Badge("Aktívna", "info"), Callout("Pozor", "Text", "warning")], 1)');
  expect(positional.meta.errors).toEqual([]);
  // Tvar, ktorý model poslal podľa starého katalógu: Table sa zahodí s chybou excess-args.
  const keyword = parser.parse(q + 'root = Stack([Table(matters.rows, [{field:"case",label:"Prípad"}], searchable=true)])');
  expect(keyword.meta.errors.map((error: { code: string }) => error.code)).toContain("excess-args");
});
test("streaming surfaces an unfinished string, then completes without losing its prefix", () => {
  const parser = createStreamingParser(openUILibrary.toJSONSchema());
  const partial = parser.push('root = Text("Client');
  expect(partial.root?.props.text).toBe("Client");
  expect(partial.meta.incomplete).toBe(true);
  const complete = parser.push(' engagements")');
  expect(complete.root?.props.text).toBe("Client engagements");
  expect(complete.meta.errors).toEqual([]);
  expect(complete.meta.incomplete).toBe(false);
});
test("bundled stock components render a report without a provider or network", () => {
  const html = renderToStaticMarkup(<OpenUIView program={'root = Stack([Heading("Portfolio",1), Metric("Clients",12), Card("Status", [Badge("Active","success"), Table([{title:"Aster",stage:"Diligence"}],[{field:"title",label:"Client"},{field:"stage",label:"Stage"}]), Board([{title:"Aster",stage:"Diligence"}],"stage","title")])])'} />);
  expect(html).toContain("Portfolio");
  expect(html).toContain("Aster");
  expect(html).toContain("Diligence");
  expect(html).not.toContain("<iframe");
  expect(html).not.toContain("cdn.jsdelivr");
});
test("board lifecycle order is explicit and columns have separately scrolling card lists", () => {
  const html = renderToStaticMarkup(<OpenUIView program={'root = Board([{title:"Existing",stage:"Active"},{title:"New",stage:"Prospect"}],"stage","title",[],["Prospect","Active"])'} />);
  expect(html.indexOf("Prospect")).toBeLessThan(html.indexOf("Active"));
  expect(html).toContain("lw-view-board-items");
});
test("empty stages survive and move controls require a host capability, disabled during streaming", () => {
  const program = 'root = Board([{title:"Review",path:"Review.md",stage:"Draft"}],"stage","title",[],["Draft","Active","Archived"])';
  const boardActions = { canMove: () => true, move: async () => {} };
  const editable = renderToStaticMarkup(<OpenUIView program={program} boardActions={boardActions} />);
  expect(editable).toContain('aria-label="Move Review to stage"');
  expect(editable).toContain('draggable="true"');
  expect(editable).toContain('value="Archived"');
  expect(editable).toContain('No records');
  for (const html of [
    renderToStaticMarkup(<OpenUIView program={program} />),
    renderToStaticMarkup(<OpenUIView program={program} boardActions={boardActions} streaming />),
    renderToStaticMarkup(<OpenUIView program={program} boardActions={{ ...boardActions, canMove: () => false }} />),
  ]) {
    expect(html).not.toContain('<select');
    expect(html).not.toContain('draggable="true"');
  }
});

test("query-bound tables, charts and boards wait for rows instead of throwing during initial render", () => {
  const program = 'data = Query("data", {name:"rows"})\nroot = Stack([Table(data.rows,[{field:"name",label:"Name"}]), BarChart(data.rows,"name",["count"]), LineChart(data.rows,"name",["count"]), PieChart(data.rows,"name","count"), Board(data.rows,"stage","name")])';
  const html = renderToStaticMarkup(<OpenUIView program={program} query={async () => ({ rows: [] })} />);
  expect(html).toContain('role="status"');
  expect(html).not.toContain("No matching records");
});
