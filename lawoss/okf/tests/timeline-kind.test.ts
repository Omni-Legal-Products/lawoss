import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { EVENT_KINDS, valueLabel } from "../src/schema.ts";
import { renderStatus, newRecord, planWrite, TimelineIntegrityError } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const STARY = `---
okf: 1
id: D-001
type: decision
title: X
summary: y
layer: L2
jurisdiction: cz
status: active
created: 2026-09-02
updated: 2026-09-02
---

## Truth
t

## History
- 2026-09-02 — rozhodnuto po porade
`;

function zaznam(timeline: OkfRecord["timeline"]): OkfRecord {
  return newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz", title: "X", summary: "y",
    created: "2026-09-02", updated: "2026-09-02", truth: "t", timeline,
  });
}

test("stary riadok bez druhu sa cita ako doteraz", () => {
  const r = parseRecord(STARY);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0]?.text, "rozhodnuto po porade");
  assert.equal(r.timeline[0]?.kind, undefined);
});

test("riadok s druhom sa precita", () => {
  const r = parseRecord(STARY.replace("- 2026-09-02 —", "- 2026-09-02 [dorucenie] —"));
  assert.equal(r.timeline[0]?.kind, "dorucenie");
  assert.equal(r.timeline[0]?.text, "rozhodnuto po porade");
});

test("druh prezije round-trip", () => {
  const r = zaznam([{ date: "2026-09-02", text: "výpověď doručena", kind: "dorucenie" }]);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("zaznam bez druhu sa serializuje ako doteraz", () => {
  const r = zaznam([{ date: "2026-09-02", text: "poznámka" }]);
  assert.match(serializeRecord(r), /^- 2026-09-02 — poznámka$/m);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("zmena druhu existujuceho riadku je prepis historie", () => {
  // sameEntry musí porovnávať aj druh — inak by šlo ticho prepísať, čím
  // udalosť bola, a append-only záruka by tam mala dieru.
  const pred = zaznam([{ date: "2026-09-02", text: "x", kind: "dorucenie" }]);
  const po = zaznam([{ date: "2026-09-02", text: "x", kind: "podanie" }]);
  assert.throws(() => planWrite(pred, po, "oprava"), TimelineIntegrityError);
});

test("slovnik druhov je otvoreny a lokalizovany", () => {
  assert.ok(EVENT_KINDS.includes("dorucenie"));
  assert.ok(EVENT_KINDS.includes("pojednavanie"));
  assert.equal(valueLabel("event_kind", "dorucenie", "cz"), "doručení");
  assert.equal(valueLabel("event_kind", "dorucenie", "sk"), "doručenie");
  assert.equal(valueLabel("event_kind", "vlastni", "cz"), "vlastni", "neznámy druh sa nepremenuje");
});

test("chronologia ukazuje druh vo vlastnom stlpci", () => {
  const s = "# Status\n\n## Chronologie\n<!-- okf:render:timeline:start -->\n<!-- okf:render:timeline:end -->\n";
  const out = renderStatus(s, [zaznam([
    { date: "2026-09-02", text: "výpověď doručena", kind: "dorucenie" },
    { date: "2026-09-03", text: "poznámka bez druhu" },
  ])], "cz");
  assert.match(out, /doručení/);
  assert.doesNotMatch(out, /\| — \| poznámka/, "riadok bez druhu nemá dostať pomlčku, ale prázdno");
});
