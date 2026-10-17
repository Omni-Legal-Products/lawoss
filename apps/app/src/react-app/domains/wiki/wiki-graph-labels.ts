export type GraphLabelCandidate = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  priority: number;
};

/** Screen-space rectangles, so long page titles also collide across grid cells. */
export function selectGraphLabels(candidates: GraphLabelCandidate[], width: number, height: number): Set<string> {
  const visible = new Set<string>();
  const cells = new Map<string, GraphLabelCandidate[]>();
  const cellSize = 128;
  candidates.sort((a, b) => b.priority - a.priority || a.id.localeCompare(b.id));
  for (const candidate of candidates) {
    const right = candidate.x + candidate.width, bottom = candidate.y + candidate.height;
    if (right < 0 || candidate.x > width || bottom < 0 || candidate.y > height) continue;
    const leftCell = Math.floor(candidate.x / cellSize), rightCell = Math.floor(right / cellSize);
    const topCell = Math.floor(candidate.y / cellSize), bottomCell = Math.floor(bottom / cellSize);
    const keys: string[] = [];
    let collision = false;
    for (let x = leftCell; x <= rightCell; x++) for (let y = topCell; y <= bottomCell; y++) {
      const key = `${x},${y}`;
      keys.push(key);
      if (cells.get(key)?.some((other) => candidate.x < other.x + other.width && right > other.x && candidate.y < other.y + other.height && bottom > other.y)) collision = true;
    }
    if (collision) continue;
    visible.add(candidate.id);
    for (const key of keys) {
      const cell = cells.get(key);
      if (cell) cell.push(candidate);
      else cells.set(key, [candidate]);
    }
  }
  return visible;
}
