export const DOCKS = ["right", "bottom", "left"];
export const HUD_SIZE = { width: 440, height: 220 };

/** All coordinates are Electron screen points, including displays with negative origins. */
export function dockBounds(area, dock, size = HUD_SIZE) {
  if (!DOCKS.includes(dock)) dock = "bottom";
  // The renderer supplies the visible edge spacing.
  const gap = 0;
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const x = dock === "left" ? area.x + gap : dock === "right" ? area.x + area.width - width - gap : area.x + (area.width - width) / 2;
  const y = dock === "bottom" ? area.y + area.height - height - gap : area.y + (area.height - height) / 2;
  return { x: Math.round(Math.max(area.x, Math.min(x, area.x + area.width - width))), y: Math.round(Math.max(area.y, Math.min(y, area.y + area.height - height))), width, height };
}

export function nearestDock(area, point) {
  const anchors = {
    right: { x: area.x + area.width, y: area.y + area.height / 2 },
    bottom: { x: area.x + area.width / 2, y: area.y + area.height },
    left: { x: area.x, y: area.y + area.height / 2 },
  };
  return DOCKS.reduce((best, dock) =>
    Math.hypot(point.x - anchors[dock].x, point.y - anchors[dock].y) <
    Math.hypot(point.x - anchors[best].x, point.y - anchors[best].y) ? dock : best, "bottom");
}
