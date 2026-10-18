import { forceCollide, forceLink, forceManyBody, forceSimulation, forceX, forceY } from "d3-force";

export type GraphPhysicsNode = { index: number; x: number; y: number; vx: number; vy: number; fx: number | null; fy: number | null };

/** Licensed D3 primitives, configured for spring-like navigation and stable cooling. */
export function createWikiGraphSimulation(positions: Float32Array, edges: Uint32Array) {
  const nodes: GraphPhysicsNode[] = Array.from({ length: positions.length / 2 }, (_, index) => ({ index, x: positions[index * 2], y: positions[index * 2 + 1], vx: 0, vy: 0, fx: null, fy: null }));
  const links: { source: number | GraphPhysicsNode; target: number | GraphPhysicsNode }[] = [];
  for (let index = 0; index < edges.length; index += 2) if (edges[index] !== edges[index + 1]) links.push({ source: edges[index], target: edges[index + 1] });
  const simulation = forceSimulation(nodes).stop().alphaMin(0.001).alphaDecay(1 - Math.pow(0.001, 1 / 300)).velocityDecay(0.4)
    .force("x", forceX(0).strength(0.08)).force("y", forceY(0).strength(0.08))
    .force("charge", forceManyBody<GraphPhysicsNode>().strength(-1000).distanceMin(30).theta(0.9))
    .force("links", forceLink<GraphPhysicsNode, typeof links[number]>(links).distance(250))
    .force("collision", forceCollide<GraphPhysicsNode>(45).strength(0.5));
  return { nodes, simulation };
}
