import { describe, expect, test } from "bun:test";
import type { WikiGraphData } from "@legalwork/types/wiki";
import { applyWikiGraphResponse, defaultGraphFilter, filterWikiGraph, indexWikiGraph, wikiGraphSeed } from "../src/react-app/domains/wiki/wiki-graph-data";

function fixture(): WikiGraphData {
  return { revision: "1", nodes: [
    { id: "a", path: "People/A.md", title: "Ada", type: "person" },
    { id: "b", path: "Deals/B.md", title: "Acme financing", type: "deal" },
    { id: "c", path: "Deals/C.md", title: "Beta financing", type: "deal" },
    { id: "d", path: "Isolated.md", title: "Isolated", type: "page" },
  ], edges: [{ id: "ab", source: "a", target: "b", relation: "client" }, { id: "bc", source: "b", target: "c", relation: null }] };
}

describe("Wiki graph projection", () => {
  test("applies updates, deletions and revisions without retaining dangling edges", () => {
    const current = fixture();
    expect(applyWikiGraphResponse(current, { kind: "unchanged", revision: "1" })).toBe(current);
    const next = applyWikiGraphResponse(current, { kind: "delta", baseRevision: "1", revision: "2", nodes: [{ ...current.nodes[0], title: "Ada Lovelace" }], edges: [], removedNodes: ["b"], removedEdges: [] });
    expect(next.nodes.map((node) => node.title)).toEqual(["Ada Lovelace", "Beta financing", "Isolated"]);
    expect(next.edges).toEqual([]);
    expect(() => applyWikiGraphResponse(next, { kind: "unchanged", revision: "1" })).toThrow();
    expect(() => applyWikiGraphResponse(undefined, { kind: "unchanged", revision: "1" })).toThrow();
    expect(() => applyWikiGraphResponse(next, { kind: "delta", baseRevision: "1", revision: "2", nodes: [], edges: [], removedNodes: [], removedEdges: [] })).toThrow();
  });
  test("traverses incoming and outgoing adjacency to the requested local depth", () => {
    const index = indexWikiGraph(fixture());
    const local = { ...defaultGraphFilter, local: true };
    expect(filterWikiGraph(index, local, "c").nodes.map((node) => node.id)).toEqual(["b", "c"]);
    expect(filterWikiGraph(index, { ...local, depth: 2 }, "c").nodes.map((node) => node.id)).toEqual(["a", "b", "c"]);
    expect(filterWikiGraph(index, local, "missing").nodes).toEqual([]);
    expect(filterWikiGraph(index, { ...defaultGraphFilter, orphans: false }, null).nodes).toHaveLength(3);
  });
  test("combines folder, type, multi-word search and local filters", () => {
    const index = indexWikiGraph(fixture());
    const graph = filterWikiGraph(index, { ...defaultGraphFilter, folder: "Deals", type: "deal", query: "ACME financing" }, null);
    expect(graph.nodes.map((node) => node.id)).toEqual(["b"]); expect(graph.edges).toEqual([]);
    expect(filterWikiGraph(index, { ...defaultGraphFilter, folder: "Deal" }, null).nodes).toEqual([]);
  });
  test("keeps a hub with ten thousand neighbors, without silently truncating", () => {
    const nodes = Array.from({ length: 10_001 }, (_, index) => ({ id: String(index), path: `${index}.md`, title: `Note ${index}`, type: "page" }));
    const edges = nodes.slice(1).map((node) => ({ id: node.id, source: "0", target: node.id, relation: null }));
    const result = filterWikiGraph(indexWikiGraph({ revision: "1", nodes, edges }), { ...defaultGraphFilter, local: true }, "0");
    expect(result.nodes).toHaveLength(nodes.length); expect(result.edges).toHaveLength(edges.length);
    const positions = nodes.map((_, index) => wikiGraphSeed(index, nodes.length));
    expect(new Set(positions.map((position) => `${position.x},${position.y}`)).size).toBe(nodes.length);
    expect(positions.every((position) => Number.isFinite(position.x) && Number.isFinite(position.y))).toBe(true);
  });
});
