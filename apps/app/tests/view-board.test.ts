import { expect, test } from "bun:test";
import type { ViewRecord, WikiDataResult } from "@legalwork/types/views";
import { viewBoardSource } from "../src/react-app/domains/views/view-board";

const view: ViewRecord = {
  id: "31c119ce-672f-4e8b-a036-127609e3b56a", owner: { kind: "wiki", id: "firm" }, revision: "view-rev", updatedAt: 1,
  version: 1, title: "Processes", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Processes")',
  queries: { processes: { fields: ["title", "properties.status"], pageType: "process" } },
};
const row = { path: "Processes/Review.md", title: "Review", "properties.status": "Draft" };
const data: WikiDataResult = { rows: [row], sources: [{ path: row.path, revision: "page-rev" }], revision: "query-rev", asOf: 1, total: 1, truncated: false };
const rendered = { ...row, __viewBinding: "processes" };
const resolve = (record = view, result = data, item: Record<string, unknown> = rendered, field = "properties.status") => viewBoardSource(record, { processes: result }, item, field);

test("board writes derive the original page and revision from indexed source provenance", () => {
  expect(resolve()).toEqual({ wikiId: "firm", path: row.path, baseRevision: "page-rev", property: "status" });
  expect(resolve(view, data, { ...rendered, revision: "forged" })?.baseRevision).toBe("page-rev");
  expect(resolve(view, { ...data, rows: [{ ...row, "properties.status": null }] }, { ...rendered, "properties.status": null })).not.toBeNull();
});
test("reports, aggregate rows, cross-owner data and fabricated cards cannot supply write targets", () => {
  expect(resolve({ ...view, mode: "report" })).toBeNull();
  expect(resolve({ ...view, owner: { kind: "workspace", id: "firm" } })).toBeNull();
  expect(resolve({ ...view, queries: { processes: { ...view.queries.processes, groupBy: "properties.status" } } })).toBeNull();
  expect(resolve(view, { ...data, sources: [] })).toBeNull();
  expect(resolve(view, { ...data, sourceOwner: { kind: "wiki", id: "other" } })).toBeNull();
  expect(resolve(view, data, { ...rendered, path: "Other.md" })).toBeNull();
  expect(resolve(view, data, { ...rendered, title: "Misleading title" })).toBeNull();
  expect(resolve(view, data, { ...rendered, __viewBinding: "constructor" })).toBeNull();
  expect(resolve(view, data, row)).toBeNull();
});
test("only queried string properties are editable, never builtins, objects or numbers", () => {
  expect(resolve(view, data, rendered, "title")).toBeNull();
  expect(resolve(view, data, rendered, "properties.unqueried")).toBeNull();
  for (const value of [12, false, ["Draft"], { value: "Draft" }]) {
    expect(resolve(view, { ...data, rows: [{ ...row, "properties.status": value }] }, { ...rendered, "properties.status": value })).toBeNull();
  }
});
