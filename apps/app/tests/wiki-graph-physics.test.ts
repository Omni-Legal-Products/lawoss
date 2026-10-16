import { expect, test } from "bun:test";
import { createWikiGraphSimulation } from "../src/react-app/domains/wiki/wiki-graph-physics";

test("graph physics separates nodes, honors dragging and cools without invalid positions", () => {
  const positions = new Float32Array([0, 0, 0, 0, 150, 0, 400, 400]);
  const { nodes, simulation } = createWikiGraphSimulation(positions, new Uint32Array([0, 1, 1, 2]));
  simulation.tick(30);
  expect(nodes.every((node) => Number.isFinite(node.x) && Number.isFinite(node.y))).toBe(true);
  expect(Math.hypot(nodes[0].x - nodes[1].x, nodes[0].y - nodes[1].y)).toBeGreaterThan(30);
  nodes[1].fx = 300; nodes[1].fy = 200;
  simulation.alpha(0.3).alphaTarget(0.3).tick(10);
  expect(nodes[1].x).toBe(300); expect(nodes[1].y).toBe(200);
  nodes[1].fx = null; nodes[1].fy = null;
  simulation.alphaTarget(0).tick(310);
  expect(simulation.alpha()).toBeLessThan(simulation.alphaMin());
  expect(nodes[1].x).not.toBe(300);
  simulation.stop();
});
