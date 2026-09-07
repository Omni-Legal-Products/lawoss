import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS, AML_REQUIRED } from "../src/schema.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-02" };

function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "S-001", type: "subject", jurisdiction: "cz",
      title: "Gh Real Estate s.r.o.", description: "dlužník",
      created: "2026-09-02", updated: "2026-09-02", truth: "t",
      timeline: [{ date: "2026-09-02", text: "x" }],
      role: "counterparty",
      procedural_role: "žalovaný",
      representation: "JUDr. X, plná moc ze dne 1. 9. 2026",
      legal_capacity: "ano",
    }),
    ...over,
  };
}

const kody = (r: OkfRecord[]) => validateStore(r, DNES).map((f) => f.code);

test("procesne polia su v scheme", () => {
  for (const c of ["procedural_role", "representation", "legal_capacity", "capacity_notes"]) {
    assert.ok(FIELDS.some((f) => f.canonical === c), `chýba pole ${c}`);
  }
});

test("procesne polia nevstupuju do povinnej AML sady", () => {
  for (const j of ["cz", "sk"] as const) {
    for (const kind of ["natural_person", "legal_person", "sole_trader"] as const) {
      const sada = (AML_REQUIRED[j]?.[kind] ?? []).map((x) => (typeof x === "string" ? x : x.primary));
      for (const c of ["procedural_role", "representation", "legal_capacity", "capacity_notes"]) {
        assert.ok(!sada.includes(c),
          `${c} nepatrí do AML sady — tá vychádza zo zákona, nie z procesnej roly`);
      }
    }
  }
});

test("procedural_role a role su dve rozne veci", () => {
  // Ten istý subjekt môže byť klient kancelárie a zároveň žalovaný v konaní.
  const klient = subjekt({ role: "client", procedural_role: "žalovaný" });
  assert.equal(klient.role, "client");
  assert.equal(klient.procedural_role, "žalovaný");
});

test("prezije round-trip", async () => {
  const { parseRecord, serializeRecord } = await import("../src/record.ts");
  const r = subjekt({ capacity_notes: "v insolvenci od 14. 6. 2026" });
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("insolvence u klienta upozorni na kontrolu konfliktu", () => {
  const f = validateStore([subjekt({ role: "client", capacity_notes: "v insolvenci od 14. 6. 2026" })], DNES)
    .find((x) => x.code === "CAPACITY_CONFLICT_CHECK");
  assert.ok(f, "insolvencia klienta je dôvod na kontrolu konfliktu záujmov");
  assert.equal(f.severity, "warning");
});

test("insolvence u protistrany upozornenie nesposobi", () => {
  assert.ok(!kody([subjekt({ capacity_notes: "v insolvenci" })]).includes("CAPACITY_CONFLICT_CHECK"));
});

test("subjekt bez procesnych poli je bez nalezov", () => {
  const holy = subjekt();
  for (const c of ["procedural_role", "representation", "legal_capacity"]) {
    delete (holy as unknown as Record<string, unknown>)[c];
  }
  assert.deepEqual(validateStore([holy], DNES), []);
});
