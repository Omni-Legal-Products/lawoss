import { expect, test } from "bun:test";
import { magneticTabDock, tabThrowVelocity, type TabDock } from "../src/react-app/domains/session/background/magnetic-tab-dock";

const viewport = { width: 1000, height: 800 };

test("a slow group drag docks at the nearest of all four corners", () => {
  const corners: TabDock[] = [
    { horizontal: "left", vertical: "top" }, { horizontal: "right", vertical: "top" },
    { horizontal: "left", vertical: "bottom" }, { horizontal: "right", vertical: "bottom" },
  ];
  for (const corner of corners) {
    expect(magneticTabDock({ x: corner.horizontal === "left" ? 200 : 800, y: corner.vertical === "top" ? 200 : 600 }, viewport, { x: 0, y: 0 }))
      .toEqual(corner);
  }
});

test("a short deliberate flick throws the group to the opposite edge without crossing the midpoint", () => {
  expect(magneticTabDock({ x: 800, y: 100 }, viewport, { x: -900, y: 40 })).toEqual({ horizontal: "left", vertical: "top" });
  expect(magneticTabDock({ x: 200, y: 100 }, viewport, { x: 900, y: 40 })).toEqual({ horizontal: "right", vertical: "top" });
  expect(magneticTabDock({ x: 800, y: 100 }, viewport, { x: 40, y: 900 })).toEqual({ horizontal: "right", vertical: "bottom" });
  expect(magneticTabDock({ x: 800, y: 700 }, viewport, { x: 40, y: -900 })).toEqual({ horizontal: "right", vertical: "top" });
});

test("diagonal flicks choose both edges, while ordinary movement does not become a throw", () => {
  expect(magneticTabDock({ x: 800, y: 100 }, viewport, { x: -900, y: 900 })).toEqual({ horizontal: "left", vertical: "bottom" });
  expect(magneticTabDock({ x: 800, y: 100 }, viewport, { x: -300, y: 300 })).toEqual({ horizontal: "right", vertical: "top" });
});

test("momentum carries the group across a nearby midpoint without an accidental diagonal throw", () => {
  expect(magneticTabDock({ x: 450, y: 100 }, viewport, { x: 400, y: 0 })).toEqual({ horizontal: "right", vertical: "top" });
  expect(magneticTabDock({ x: 800, y: 100 }, viewport, { x: -2000, y: 650 })).toEqual({ horizontal: "left", vertical: "top" });
});

test("release velocity smooths a noisy last sample and stops after a held drag", () => {
  const samples = [{ x: 100, y: 100, time: 0 }, { x: 20, y: 100, time: 70 }, { x: 21, y: 100, time: 80 }];
  expect(tabThrowVelocity(samples, 85)).toEqual({ x: -987.5, y: 0 });
  expect(tabThrowVelocity(samples, 200)).toEqual({ x: 0, y: 0 });
  expect(tabThrowVelocity([], 200)).toEqual({ x: 0, y: 0 });
  expect(tabThrowVelocity([{ x: 100, y: 100, time: 0 }, ...samples.map(sample => ({ ...sample, time: sample.time + 1000 }))], 1085))
    .toEqual({ x: -987.5, y: 0 });
});
