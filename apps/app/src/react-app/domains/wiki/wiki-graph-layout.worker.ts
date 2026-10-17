import { createWikiGraphSimulation } from "./wiki-graph-physics";
import type { GraphLayoutRequest, GraphLayoutPin, GraphLayoutUpdate } from "./wiki-graph-data";

let active: ReturnType<typeof createWikiGraphSimulation> | undefined;
let generation = 0, iterations = 0, started = 0, duration = 15_000;
let timer: ReturnType<typeof setTimeout> | undefined;
let pinned = false;
function step() {
  timer = undefined;
  if (!active) return;
  const tickStarted = performance.now();
  active.simulation.tick(); iterations++;
  const positions = new Float32Array(active.nodes.length * 2);
  active.nodes.forEach((node, index) => { positions[index * 2] = node.x; positions[index * 2 + 1] = node.y; });
  const elapsedMs = performance.now() - started;
  const finished = !pinned && (active.simulation.alpha() < active.simulation.alphaMin() || elapsedMs >= duration);
  const update: GraphLayoutUpdate = { positions, generation, finished, elapsedMs, iterations };
  self.postMessage(update, { transfer: [positions.buffer] });
  if (!finished) timer = setTimeout(step, Math.max(0, 1000 / 60 - (performance.now() - tickStarted)));
}
self.onmessage = (event: MessageEvent<GraphLayoutRequest | GraphLayoutPin>) => {
  const message = event.data;
  if ("positions" in message) {
    clearTimeout(timer); active?.simulation.stop();
    active = createWikiGraphSimulation(message.positions, message.edges);
    active.simulation.alpha(message.alpha ?? 1);
    generation = message.generation; iterations = 0; started = performance.now(); duration = message.durationMs; pinned = false;
    timer = setTimeout(step, 0);
    return;
  }
  const node = active?.nodes[message.index]; if (!node || !active) return;
  node.fx = message.x; node.fy = message.y; pinned = message.x !== null;
  if (pinned) { node.x = message.x ?? node.x; node.y = message.y ?? node.y; }
  active.simulation.alpha(Math.max(0.3, active.simulation.alpha())).alphaTarget(pinned ? 0.3 : 0);
  started = performance.now();
  if (timer === undefined) timer = setTimeout(step, 0);
};
