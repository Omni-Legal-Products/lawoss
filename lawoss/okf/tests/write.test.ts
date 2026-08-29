import { test } from "node:test";
import assert from "node:assert/strict";
import { planWrite, authorize, ApprovalRequiredError, TimelineIntegrityError } from "../src/write.ts";
import type { OkfRecord } from "../src/record.ts";

function rec(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    schema: 1,
    id: "R-001",
    type: "decision",
    title: "Rozhodnutie",
    summary: "popis",
    layer: "L2",
    jurisdiction: "sk",
    status: "platny",
    created: "2026-08-29",
    updated: "2026-08-29",
    truth: "povodna pravda",
    timeline: [{ date: "2026-08-29", text: "zalozene" }],
    ...over,
  } as OkfRecord;
}

const SCHVALENIE = { by: "JUDr. Vojtěch Říha", at: "2026-08-29T10:00:00Z" };

test("zmena pravdy bez noveho riadku historie je odmietnuta", () => {
  const before = rec();
  const after = rec({ truth: "nova pravda" });
  assert.throws(() => planWrite(before, after, "oprava"), TimelineIntegrityError);
});

test("zmena pravdy so stopou v historii prejde", () => {
  const before = rec();
  const after = rec({
    truth: "nova pravda",
    timeline: [...before.timeline, { date: "2026-08-30", text: "prehodnotene" }],
  });
  const d = planWrite(before, after, "nove zistenie");
  assert.equal(d.kind, "update");
  assert.equal(d.reason, "nove zistenie");
});

test("historia sa neda prepisat — musi byt predponou novej", () => {
  const before = rec({ timeline: [{ date: "2026-08-29", text: "zalozene" }] });
  const after = rec({ timeline: [{ date: "2026-08-29", text: "prepisane" }] });
  assert.throws(() => planWrite(before, after, "x"), TimelineIntegrityError);
});

test("historia sa neda skratit", () => {
  const before = rec({
    timeline: [
      { date: "2026-08-29", text: "a" },
      { date: "2026-08-30", text: "b" },
    ],
  });
  const after = rec({ timeline: [{ date: "2026-08-29", text: "a" }] });
  assert.throws(() => planWrite(before, after, "x"), TimelineIntegrityError);
});

test("zapis bez dovodu je odmietnuty", () => {
  assert.throws(() => planWrite(rec(), rec(), "  "), /dôvod/i);
});

test("agent smie zapisat do L2 bez schvalenia", () => {
  const d = planWrite(rec(), rec({ summary: "iny popis" }), "spresnenie");
  assert.equal(d.requiresApproval, false);
  assert.doesNotThrow(() => authorize(d, undefined));
});

test("zapis do L1 bez schvalenia cloveka je odmietnuty", () => {
  const before = rec({ id: "P-001", type: "lesson", layer: "L1" });
  const d = planWrite(before, rec({ id: "P-001", type: "lesson", layer: "L1", summary: "iny" }), "povysenie");
  assert.equal(d.requiresApproval, true);
  assert.throws(() => authorize(d, undefined), ApprovalRequiredError);
});

test("zapis do L3 bez schvalenia cloveka je odmietnuty", () => {
  const before = rec({ id: "J-001", type: "authority", layer: "L3" });
  const d = planWrite(before, rec({ id: "J-001", type: "authority", layer: "L3", summary: "iny" }), "x");
  assert.throws(() => authorize(d, undefined), ApprovalRequiredError);
});

test("zapis do L1 so schvalenim prejde", () => {
  const before = rec({ id: "P-001", type: "lesson", layer: "L1" });
  const d = planWrite(before, rec({ id: "P-001", type: "lesson", layer: "L1", summary: "iny" }), "x");
  assert.doesNotThrow(() => authorize(d, SCHVALENIE));
});

test("mazanie vyzaduje cloveka aj v L2", () => {
  const d = planWrite(rec(), undefined, "duplicita");
  assert.equal(d.kind, "delete");
  assert.equal(d.requiresApproval, true);
  assert.throws(() => authorize(d, undefined), ApprovalRequiredError);
});

test("zalozenie noveho L2 zaznamu agent smie sam", () => {
  const d = planWrite(undefined, rec(), "novy fakt");
  assert.equal(d.kind, "create");
  assert.equal(d.requiresApproval, false);
});

test("diff nesie citatelny zoznam zmien", () => {
  const before = rec();
  const after = rec({
    truth: "nova pravda",
    timeline: [...before.timeline, { date: "2026-08-30", text: "prehodnotene" }],
  });
  const d = planWrite(before, after, "x");
  assert.ok(d.lines.some((l) => l.includes("Pravda")), d.lines.join("|"));
  assert.ok(d.lines.some((l) => l.includes("prehodnotene")), d.lines.join("|"));
});
