export type TabDock = { horizontal: "left" | "right"; vertical: "top" | "bottom" };

/** Slow drags use the nearest corner; a deliberate flick chooses its direction. Velocity is px/s. */
export function magneticTabDock(
  center: { x: number; y: number },
  viewport: { width: number; height: number },
  velocity: { x: number; y: number },
): TabDock {
  const flick = 600;
  const speed = Math.max(Math.abs(velocity.x), Math.abs(velocity.y));
  const projected = { x: center.x + velocity.x * 0.2, y: center.y + velocity.y * 0.2 };
  return {
    horizontal: Math.abs(velocity.x) >= Math.max(flick, speed * 0.5)
      ? velocity.x < 0 ? "left" : "right"
      : projected.x < viewport.width / 2 ? "left" : "right",
    vertical: Math.abs(velocity.y) >= Math.max(flick, speed * 0.5)
      ? velocity.y < 0 ? "top" : "bottom"
      : projected.y < viewport.height / 2 ? "top" : "bottom",
  };
}

/** Average the recent pointer samples so tiny final movements cannot reverse a throw. */
export function tabThrowVelocity(samples: { x: number; y: number; time: number }[], now: number) {
  const last = samples[samples.length - 1];
  if (!last || now - last.time > 80) return { x: 0, y: 0 };
  const first = samples.find(sample => sample.time >= last.time - 80);
  if (!first) return { x: 0, y: 0 };
  const elapsed = Math.max(8, last.time - first.time);
  return { x: (last.x - first.x) * 1000 / elapsed, y: (last.y - first.y) * 1000 / elapsed };
}
