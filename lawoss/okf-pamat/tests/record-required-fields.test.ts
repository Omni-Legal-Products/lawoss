import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord } from "../src/record.ts";

const record = `---
okf: 1
id: D-001
type: decision
title: Test
summary: Legacy description
layer: L2
jurisdiction: sk
status: active
created: 2026-09-20
updated: 2026-09-20
---

## Truth

Test

## History
`;

test("reports every missing required field together, including jurisdiction and okf", () => {
  assert.throws(() => parseRecord("---\n---\n"), {
    message: "Chýbajú povinné polia: okf, id, type, title, description, layer, jurisdiction, status, created, updated",
  });
});

test("missing jurisdiction does not hide other missing fields or reject the summary alias", () => {
  const incomplete = record.replace("okf: 1\n", "").replace("jurisdiction: sk\n", "").replace("updated: 2026-09-20\n", "");
  assert.throws(() => parseRecord(incomplete), {
    message: "Chýbajú povinné polia: okf, jurisdiction, updated",
  });
});

test("jurisdiction alone uses the ordinary single missing field diagnostic", () => {
  assert.throws(() => parseRecord(record.replace("jurisdiction: sk\n", "")), {
    message: "Chýba povinné pole: jurisdiction",
  });
});

test("existing invalid jurisdiction retains its diagnostic", () => {
  assert.throws(() => parseRecord(record.replace("jurisdiction: sk", "jurisdiction: xx")), {
    message: "Neznáma jurisdikcia: xx",
  });
});

test("legacy summary still satisfies the required description field", () => {
  assert.equal(parseRecord(record).description, "Legacy description");
});
