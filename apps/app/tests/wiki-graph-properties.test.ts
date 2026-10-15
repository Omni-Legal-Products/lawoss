import { describe, expect, test } from "bun:test";
import type { WikiGraphData } from "@legalwork/types/wiki";
import { applyWikiGraphResponse, defaultGraphFilter, filterWikiGraph, indexWikiGraph } from "../src/react-app/domains/wiki/wiki-graph-data";
import { graphPropertyFields, graphPropertyOperators, matchesGraphCondition, validGraphCondition, type GraphPropertyCondition } from "../src/react-app/domains/wiki/wiki-graph-properties";
import { readGraphPreferences, saveGraphPreferences } from "../src/react-app/domains/wiki/wiki-graph-state";

function condition(property: string, kind: GraphPropertyCondition["kind"], operator: GraphPropertyCondition["operator"], value = ""): GraphPropertyCondition {
  return { property, kind, operator, value };
}
const graph: WikiGraphData = { revision: "1", nodes: [
  { id: "a", path: "Matters/A.md", title: "Alpha", type: "matter", properties: { stage: "Open", amount: 1250.5, due: "2026-10-14", active: false, tags: ["Tax", "Vienna"], owner: "[[People/Ada.md]]", details: { status: "review" } } },
  { id: "b", path: "Matters/B.md", title: "Beta", type: "matter", properties: { stage: "Closed", amount: 200, due: "2026-10-20", active: true, tags: ["Litigation"] } },
  { id: "c", path: "People/C.md", title: "Chris", type: "person", properties: { stage: null, tags: [] } },
], edges: [{ id: "ab", source: "a", target: "b", relation: null }, { id: "bc", source: "b", target: "c", relation: "owner" }] };

const a = graph.nodes[0].properties;

describe("Wiki graph property conditions", () => {
  test("discovers arbitrary indexed fields and infers supported types from scalar and list values", () => {
    const fields = graphPropertyFields(graph.nodes);
    expect(fields.find(field => field.key === "amount")?.kind).toBe("number");
    expect(fields.find(field => field.key === "due")?.kind).toBe("date");
    expect(fields.find(field => field.key === "active")?.kind).toBe("boolean");
    expect(fields.find(field => field.key === "details")?.kind).toBe("object");
    expect(fields.find(field => field.key === "tags")?.options).toEqual(["Litigation", "Tax", "Vienna"]);
    expect(graphPropertyOperators("object")).toEqual(["exists", "missing"]);
    expect(graphPropertyOperators("number")).toContain("gte");
    expect(graphPropertyOperators("date")).toContain("before");
    expect(graphPropertyFields([{ ...graph.nodes[0], properties: { mixed: 5 } }, { ...graph.nodes[1], properties: { mixed: "five" } }])[0].kind).toBe("text");
  });
  test("supports case-insensitive text, list membership, relations and explicit absence", () => {
    expect(matchesGraphCondition(a, condition("stage", "text", "eq", "open"))).toBe(true);
    expect(matchesGraphCondition(a, condition("tags", "text", "contains", "VIEN"))).toBe(true);
    expect(matchesGraphCondition(a, condition("tags", "text", "eq", "Tax"))).toBe(true);
    expect(matchesGraphCondition(a, condition("tags", "text", "ne", "Tax"))).toBe(false);
    expect(matchesGraphCondition(a, condition("owner", "text", "eq", "[[People/Ada.md]]"))).toBe(true);
    expect(matchesGraphCondition(a, condition("missing", "text", "ne", "Open"))).toBe(false);
    expect(matchesGraphCondition(a, condition("missing", "text", "missing"))).toBe(true);
    expect(matchesGraphCondition(graph.nodes[2].properties, condition("stage", "text", "exists"))).toBe(false);
    expect(matchesGraphCondition(a, condition("details", "object", "exists"))).toBe(true);
    expect(matchesGraphCondition({ stage: "" }, condition("stage", "text", "exists"))).toBe(true);
  });
  test("compares numbers, valid calendar dates and false booleans without coercing missing or mistyped values", () => {
    expect(matchesGraphCondition(a, condition("amount", "number", "gt", "1000"))).toBe(true);
    expect(matchesGraphCondition(a, condition("amount", "number", "lte", "1250.5"))).toBe(true);
    expect(matchesGraphCondition(a, condition("due", "date", "before", "2026-10-15"))).toBe(true);
    expect(matchesGraphCondition(a, condition("due", "date", "after", "2026-10-14"))).toBe(false);
    expect(matchesGraphCondition(a, condition("active", "boolean", "eq", "false"))).toBe(true);
    expect(matchesGraphCondition(a, condition("active", "boolean", "exists"))).toBe(true);
    expect(matchesGraphCondition({ amount: "200" }, condition("amount", "number", "ne", "100"))).toBe(false);
    for (const invalid of [condition("amount", "number", "gt", ""), condition("amount", "number", "gt", "no"), condition("due", "date", "before", "2026-02-30"), condition("active", "boolean", "eq", "yes"), condition("active", "boolean", "contains", "true")]) {
      expect(validGraphCondition(invalid)).toBe(false);
      expect(matchesGraphCondition(a, invalid)).toBe(false);
    }
  });
  test("combines multiple conditions with existing search, folder, type and local graph filters", () => {
    const index = indexWikiGraph(graph);
    const conditions = [condition("stage", "text", "eq", "open"), condition("amount", "number", "gte", "500")];
    const result = filterWikiGraph(index, { ...defaultGraphFilter, conditions, query: "alpha", folder: "Matters", type: "matter", local: true }, "b");
    expect(result.nodes.map(node => node.id)).toEqual(["a"]);
    expect(result.edges).toEqual([]);
    const either = filterWikiGraph(index, { ...defaultGraphFilter, conditions: [...conditions, condition("active", "boolean", "eq", "true")], conditionMode: "any" }, null);
    expect(either.nodes.map(node => node.id)).toEqual(["a", "b"]);
    expect(either.edges.map(edge => edge.id)).toEqual(["ab"]);
    const changed = applyWikiGraphResponse(graph, { kind: "delta", baseRevision: "1", revision: "2", nodes: [{ ...graph.nodes[0], properties: { ...a, amount: 50 } }], edges: [], removedEdges: [], removedNodes: [] });
    expect(filterWikiGraph(indexWikiGraph(changed), { ...defaultGraphFilter, conditions }, null).nodes).toEqual([]);
  });
  test("unfinished conditions are ignored without cancelling valid all/any filters", () => {
    const index = indexWikiGraph(graph);
    const unfinished = condition("stage", "text", "eq");
    for (const conditionMode of ["all", "any"] satisfies Array<"all" | "any">) {
      expect(filterWikiGraph(index, { ...defaultGraphFilter, conditionMode, conditions: [unfinished] }, null).nodes).toEqual(graph.nodes);
      expect(filterWikiGraph(index, { ...defaultGraphFilter, conditionMode, conditions: [unfinished, condition("stage", "text", "eq", "open")] }, null).nodes.map(node => node.id)).toEqual(["a"]);
    }
  });
  test("persists conditions and safely upgrades older graph preferences", () => {
    const original = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
    let stored = JSON.stringify({ filter: { query: "old", type: "matter" } });
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => stored, setItem: (_: string, value: string) => { stored = value; } } });
    try {
      expect(readGraphPreferences("test").filter).toMatchObject({ query: "old", conditions: [], conditionMode: "all" });
      const filter = { ...defaultGraphFilter, conditions: [condition("stage", "text", "eq", "Open")], conditionMode: "any" satisfies "any" };
      saveGraphPreferences("test", { filter });
      expect(readGraphPreferences("test").filter).toEqual(filter);
      stored = JSON.stringify({ filter: { conditions: [{ property: "stage", operator: "script", kind: "text", value: "x" }, filter.conditions[0]], conditionMode: "invalid" } });
      expect(readGraphPreferences("test").filter).toMatchObject({ conditions: filter.conditions, conditionMode: "all" });
    } finally {
      if (original) Object.defineProperty(globalThis, "localStorage", original);
      else Reflect.deleteProperty(globalThis, "localStorage");
    }
  });
});
