import { expect, test } from "bun:test";
import { selectGraphLabels } from "../src/react-app/domains/wiki/wiki-graph-labels";

test("long graph titles collide across grid cells and the hovered page wins", () => {
  const labels = [
    { id: "hub", x: 10, y: 20, width: 300, height: 22, priority: 10 },
    { id: "hovered", x: 250, y: 25, width: 150, height: 22, priority: 1000 },
    { id: "separate", x: 10, y: 70, width: 100, height: 22, priority: 1 },
    { id: "offscreen", x: 900, y: 10, width: 100, height: 22, priority: 20 },
  ];
  expect([...selectGraphLabels(labels, 800, 600)]).toEqual(["hovered", "separate"]);
});

test("zoomed-apart graph labels reappear without changing their priorities", () => {
  const labels = [
    { id: "one", x: 10, y: 20, width: 180, height: 22, priority: 2 },
    { id: "two", x: 100, y: 20, width: 180, height: 22, priority: 1 },
  ];
  expect(selectGraphLabels(labels, 800, 600).size).toBe(1);
  labels[1].x = 220;
  expect(selectGraphLabels(labels, 800, 600).size).toBe(2);
});
