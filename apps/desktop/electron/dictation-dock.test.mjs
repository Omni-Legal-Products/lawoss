import assert from "node:assert/strict";
import { test } from "node:test";
import { DOCKS, dockBounds, nearestDock } from "./audio/dictation-dock.mjs";

test("dock targets follow each display's work area, including negative coordinates", () => {
  for (const area of [{ x: 0, y: 32, width: 1512, height: 950 }, { x: -1920, y: -600, width: 1920, height: 1080 }, { x: 100, y: 100, width: 320, height: 200 }]) {
    for (const dock of DOCKS) {
      const bounds = dockBounds(area, dock);
      assert.ok(bounds.x >= area.x && bounds.y >= area.y);
      assert.ok(bounds.x + bounds.width <= area.x + area.width);
      assert.ok(bounds.y + bounds.height <= area.y + area.height);
    }
    assert.equal(nearestDock(area, { x: area.x, y: area.y + area.height / 2 }), "left");
    assert.equal(nearestDock(area, { x: area.x + area.width, y: area.y + area.height / 2 }), "right");
    assert.ok(DOCKS.includes(nearestDock(area, { x: area.x + area.width / 2, y: area.y })));
    assert.equal(DOCKS.includes("top"), false);
    assert.deepEqual(dockBounds(area, "top"), dockBounds(area, "bottom"), "old top positions fall back to bottom");
    assert.equal(nearestDock(area, { x: area.x + area.width / 2, y: area.y + area.height }), "bottom");
  }
});
