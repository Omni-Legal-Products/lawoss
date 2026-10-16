import { matchesGraphCondition, validGraphCondition, type GraphPropertyCondition } from "./wiki-graph-properties";
import type { WikiGraphData, WikiGraphResponse } from "@legalwork/types/wiki";

export type WikiGraphFilter = { query: string; type: string; folder: string; local: boolean; depth: number; orphans: boolean; conditions: GraphPropertyCondition[]; conditionMode: "all" | "any" };
export const defaultGraphFilter: WikiGraphFilter = { query: "", type: "", folder: "", local: false, depth: 1, orphans: true, conditions: [], conditionMode: "all" };

export function applyWikiGraphResponse(current: WikiGraphData | undefined, response: WikiGraphResponse): WikiGraphData {
  if (response.kind === "snapshot") return { revision: response.revision, nodes: response.nodes, edges: response.edges };
  if (!current) throw new Error("The graph needs a fresh snapshot.");
  if (response.kind === "unchanged") {
    if (current.revision !== response.revision) throw new Error("The graph revision changed. Reload it.");
    return current;
  }
  if (response.baseRevision !== current.revision) throw new Error("The graph update is out of sequence.");
  const nodes = new Map(current.nodes.map((node) => [node.id, node]));
  const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
  for (const id of response.removedNodes) nodes.delete(id);
  for (const id of response.removedEdges) edges.delete(id);
  for (const node of response.nodes) nodes.set(node.id, node);
  for (const edge of response.edges) edges.set(edge.id, edge);
  return { revision: response.revision, nodes: [...nodes.values()], edges: [...edges.values()].filter((edge) => nodes.has(edge.source) && nodes.has(edge.target)) };
}

export function indexWikiGraph(data: WikiGraphData) {
  const nodes = new Map(data.nodes.map((node) => [node.id, node]));
  const adjacent = new Map<string, Set<string>>();
  const add = (source: string, target: string) => {
    let set = adjacent.get(source);
    if (!set) { set = new Set(); adjacent.set(source, set); }
    set.add(target);
  };
  for (const edge of data.edges) {
    if (!nodes.has(edge.source) || !nodes.has(edge.target)) continue;
    add(edge.source, edge.target); add(edge.target, edge.source);
  }
  return { data, nodes, adjacent };
}

export function filterWikiGraph(index: ReturnType<typeof indexWikiGraph>, filter: WikiGraphFilter, focus: string | null): WikiGraphData {
  let neighborhood: Set<string> | undefined;
  if (filter.local && focus) {
    neighborhood = new Set(index.nodes.has(focus) ? [focus] : []);
    let frontier = [focus];
    for (let depth = 0; depth < Math.max(1, Math.min(5, filter.depth)); depth++) {
      const next: string[] = [];
      for (const id of frontier) for (const neighbor of index.adjacent.get(id) ?? []) {
        if (!neighborhood.has(neighbor)) { neighborhood.add(neighbor); next.push(neighbor); }
      }
      frontier = next;
      if (!frontier.length) break;
    }
  }
  const selected = neighborhood;
  const words = filter.query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const conditions = filter.conditions.filter(validGraphCondition);
  const nodes = index.data.nodes.filter((node) => (!selected || selected.has(node.id))
    && (!filter.type || node.type === filter.type)
    && (!filter.folder || node.path.startsWith(`${filter.folder}/`))
    && (filter.orphans || index.adjacent.has(node.id))
    && (!conditions.length || (filter.conditionMode === "all" ? conditions.every(condition => matchesGraphCondition(node.properties, condition)) : conditions.some(condition => matchesGraphCondition(node.properties, condition))))
    && words.every((word) => `${node.title} ${node.path}`.toLocaleLowerCase().includes(word)));
  const ids = new Set(nodes.map((node) => node.id));
  return { revision: index.data.revision, nodes, edges: index.data.edges.filter((edge) => ids.has(edge.source) && ids.has(edge.target)) };
}

/** Stable, separated starting positions avoid coincident-node pathologies. */
export function wikiGraphSeed(index: number, count: number): { x: number; y: number } {
  const radius = Math.sqrt((index + 0.5) / Math.max(count, 1)) * Math.max(80, Math.sqrt(count) * 28);
  const angle = index * Math.PI * (3 - Math.sqrt(5));
  return { x: radius * Math.cos(angle), y: radius * Math.sin(angle) };
}

export type GraphLayoutRequest = { positions: Float32Array; edges: Uint32Array; generation: number; durationMs: number; alpha?: number };
export type GraphLayoutUpdate = { positions: Float32Array; generation: number; finished: boolean; elapsedMs: number; iterations: number };

export type GraphLayoutPin = { index: number; x: number | null; y: number | null };
