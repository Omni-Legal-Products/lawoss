import { randomUUID } from "node:crypto";
import type { WikiGraphData, WikiGraphEdge, WikiGraphNode, WikiGraphResponse, WikiPage } from "@legalwork/types/wiki";
import { resolveWikiLinks } from "./markdown.js";

type Delta = WikiGraphData & { kind: "delta"; baseRevision: string; removedNodes: string[]; removedEdges: string[] };

/** Derived compact index. Only changed graph attributes advance its revision. */
export class WikiGraphIndex {
  private readonly epoch = randomUUID();
  private sequence = 0;
  private readonly nodes = new Map<string, WikiGraphNode>();
  private readonly edges = new Map<string, WikiGraphEdge>();
  private changes: Delta[] = [];

  get revision() { return `${this.epoch}:${this.sequence}`; }

  update(pages: WikiPage[]): void {
    const nextNodes = new Map<string, WikiGraphNode>();
    const nextEdges = new Map<string, WikiGraphEdge>();
    const nodes: WikiGraphNode[] = [], edges: WikiGraphEdge[] = [];
    const resolved = resolveWikiLinks(pages);
    for (const page of resolved) {
      const node = { id: page.path, path: page.path, title: page.title, type: page.type };
      const previous = this.nodes.get(node.id);
      nextNodes.set(node.id, node);
      if (!previous || previous.title !== node.title || previous.type !== node.type) nodes.push(node);
      for (const link of page.links) {
        if (!link.resolved || link.target === page.path) continue;
        const id = JSON.stringify([page.path, link.target, link.property]);
        if (nextEdges.has(id)) continue;
        const edge = { id, source: page.path, target: link.target, relation: link.property };
        nextEdges.set(id, edge);
        if (!this.edges.has(id)) edges.push(edge);
      }
    }
    const removedNodes = [...this.nodes.keys()].filter((id) => !nextNodes.has(id));
    const removedEdges = [...this.edges.keys()].filter((id) => !nextEdges.has(id));
    if (!nodes.length && !edges.length && !removedNodes.length && !removedEdges.length) return;
    const baseRevision = this.revision;
    for (const id of removedNodes) this.nodes.delete(id);
    for (const id of removedEdges) this.edges.delete(id);
    for (const node of nodes) this.nodes.set(node.id, node);
    for (const edge of edges) this.edges.set(edge.id, edge);
    this.sequence++;
    this.changes.push({ kind: "delta", baseRevision, revision: this.revision, nodes, edges, removedNodes, removedEdges });
    // Retain bounded deltas, never sixteen full copies of a large graph.
    while (this.changes.length > 16 || (this.changes.length > 1 && this.changes.reduce((sum, delta) => sum + delta.nodes.length + delta.edges.length + delta.removedNodes.length + delta.removedEdges.length, 0) > 100_000)) this.changes.shift();
  }

  response(since?: string): WikiGraphResponse {
    if (since === this.revision) return { kind: "unchanged", revision: this.revision };
    const start = since ? this.changes.findIndex((delta) => delta.baseRevision === since) : -1;
    if (start < 0 || !since) return { kind: "snapshot", revision: this.revision, nodes: [...this.nodes.values()], edges: [...this.edges.values()] };
    const nodes = new Map<string, WikiGraphNode>(), edges = new Map<string, WikiGraphEdge>();
    const removedNodes = new Set<string>(), removedEdges = new Set<string>();
    for (const delta of this.changes.slice(start)) {
      for (const id of delta.removedNodes) { nodes.delete(id); removedNodes.add(id); }
      for (const id of delta.removedEdges) { edges.delete(id); removedEdges.add(id); }
      for (const node of delta.nodes) { removedNodes.delete(node.id); nodes.set(node.id, node); }
      for (const edge of delta.edges) { removedEdges.delete(edge.id); edges.set(edge.id, edge); }
    }
    return { kind: "delta", baseRevision: since, revision: this.revision, nodes: [...nodes.values()], edges: [...edges.values()], removedNodes: [...removedNodes], removedEdges: [...removedEdges] };
  }
}
