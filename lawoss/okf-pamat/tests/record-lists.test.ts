import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { newRecord } from "../src/index.ts";

function tamASpat(hodnoty: string[]): string[] {
  const r = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz",
    title: "X", description: "y", created: "2026-09-01", updated: "2026-09-01",
    truth: "t", timeline: [{ date: "2026-09-01", text: "z" }],
    parties: hodnoty,
  });
  return parseRecord(serializeRecord(r)).parties ?? [];
}

test("ciarka v obchodnom mene prezije round-trip", () => {
  assert.deepEqual(
    tamASpat(["Doprava, s.r.o.", "Novák, a.s."]),
    ["Doprava, s.r.o.", "Novák, a.s."],
  );
});

test("hodnota bez uvodzoviek sa stale deli na ciarke", () => {
  const r = parseRecord(`---
okf: 1
id: R-001
type: decision
title: X
description: y
layer: L2
jurisdiction: cz
status: active
created: 2026-09-01
updated: 2026-09-01
sources: [a, b, c]
---

## Truth
t

## History
- 2026-09-01 — z
`);
  assert.deepEqual(r.sources, ["a", "b", "c"]);
});

test("prazdny zoznam zostava prazdny", () => {
  assert.deepEqual(tamASpat([]), []);
});

test("jedna polozka s ciarkou sa nerozpadne", () => {
  assert.deepEqual(tamASpat(["Novák, a.s."]), ["Novák, a.s."]);
});

test("uvodzovka vo vnutri hodnoty prezije", () => {
  assert.deepEqual(tamASpat(['Firma "Alfa", s.r.o.']), ['Firma "Alfa", s.r.o.']);
});

test("apostrof sa neberie ako uvodzovka uprostred slova", () => {
  assert.deepEqual(tamASpat(["O'Brien, s.r.o."]), ["O'Brien, s.r.o."]);
});

test("ciarka prezije aj v poli zdroje a oblast_prava", () => {
  const r = newRecord({
    id: "R-002", type: "decision", jurisdiction: "cz",
    title: "X", description: "y", created: "2026-09-01", updated: "2026-09-01",
    truth: "t", timeline: [{ date: "2026-09-01", text: "z" }],
    area: ["Obchodní právo, korporace"], sources: ["NS 29 Cdo 1/2020, bod 12"],
  });
  const zpet = parseRecord(serializeRecord(r));
  assert.deepEqual(zpet.area, ["Obchodní právo, korporace"]);
  assert.deepEqual(zpet.sources, ["NS 29 Cdo 1/2020, bod 12"]);
});
