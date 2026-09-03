import { test } from "node:test";
import assert from "node:assert/strict";
import { FIELDS } from "../src/schema.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-02" };

function pramen(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "A-001", type: "authority", jurisdiction: "cz",
      title: "29 NSČR 73/2024", description: "kumulativnost § 348 odst. 1 IZ",
      created: "2026-09-02", updated: "2026-09-02",
      truth: "Podmínky § 348 odst. 1 IZ jsou kumulativní.",
      timeline: [{ date: "2026-09-02", text: "ověřeno" }],
      sources: ["NS ČR, 29 NSČR 73/2024, 12. 6. 2026"],
      verified_at: "2026-09-02", verified_against: "Salvia, plný text",
      effective_from: "2026-06-12",
    }),
    ...over,
  };
}

const kody = (r: OkfRecord[]) => validateStore(r, DNES).map((f) => f.code);

test("polia casovej platnosti su v scheme", () => {
  for (const c of ["effective_from", "effective_to", "verified_at", "verified_against"]) {
    assert.ok(FIELDS.some((f) => f.canonical === c), `chýba pole ${c}`);
  }
});

test("uplny pramen je bez nalezov", () => {
  assert.deepEqual(validateStore([pramen()], DNES), []);
});

// --- časová platnosť ---

test("pramen s uplynulou platnostou je varovanie", () => {
  const f = validateStore([pramen({ effective_to: "2026-01-01" })], DNES)
    .find((x) => x.code === "AUTHORITY_STALE");
  assert.ok(f, "citácia zrušeného znenia má byť nález");
  assert.equal(f.severity, "warning");
  assert.match(f.message, /2026-01-01/);
});

test("platnost do buducnosti nalez nesposobi", () => {
  assert.ok(!kody([pramen({ effective_to: "2027-01-01" })]).includes("AUTHORITY_STALE"));
});

test("platnost sa kontroluje len pri prameni, nie pri spisovom zazname", () => {
  const rozhodnutie = newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz", title: "X", description: "y",
    created: "2026-09-02", updated: "2026-09-02", truth: "t",
    timeline: [{ date: "2026-09-02", text: "x" }],
    effective_to: "2020-01-01",
  });
  assert.ok(!kody([rozhodnutie]).includes("AUTHORITY_STALE"));
});

// --- stopa overenia ---

test("pramen bez stopy overenia je varovanie", () => {
  const bez = pramen();
  delete (bez as unknown as Record<string, unknown>).verified_at;
  delete (bez as unknown as Record<string, unknown>).verified_against;
  const f = validateStore([bez], DNES).find((x) => x.code === "AUTHORITY_UNVERIFIED");
  assert.ok(f, "prameň bez stopy overenia je dohad, nie prameň");
  assert.equal(f.severity, "warning");
});

test("staci jedna zo stop, aby nalez nevznikol", () => {
  const len_kedy = pramen();
  delete (len_kedy as unknown as Record<string, unknown>).verified_against;
  assert.ok(!kody([len_kedy]).includes("AUTHORITY_UNVERIFIED"));
});

// --- citačný formát ---

test("neuplna citacia predpisu je varovanie", () => {
  const f = validateStore([pramen({ sources: [{ title: "insolvenční zákon, Sb." }] })], DNES)
    .find((x) => x.code === "CITATION_INCOMPLETE");
  assert.ok(f, "odkaz na Sb. bez čísla a roku je neúplný");
  assert.equal(f.severity, "warning");
});

test("uplna ceska citacia prejde", () => {
  assert.ok(!kody([pramen({ sources: [{ title: "§ 348 odst. 1 zák. č. 182/2006 Sb." }] })])
    .includes("CITATION_INCOMPLETE"));
});

test("uplna slovenska citacia prejde", () => {
  const sk = pramen({ jurisdiction: "sk", sources: [{ title: "§ 7 ods. 1 zák. č. 297/2008 Z. z." }] });
  assert.ok(!kody([sk]).includes("CITATION_INCOMPLETE"));
});

test("citacia judikatu sa ako predpis nekontroluje", () => {
  assert.ok(!kody([pramen({ sources: [{ title: "NS ČR, 29 NSČR 73/2024, 12. 6. 2026" }] })])
    .includes("CITATION_INCOMPLETE"));
});

test("kontrola citacie nesaha na siet — bezi nad textom, nie nad registrom", () => {
  // Prameň s číslom predpisu, ktorý neexistuje, prejde. Overiť existenciu
  // by znamenalo sieťové volanie z validácie a jadro sieťovú plochu nemá.
  assert.ok(!kody([pramen({ sources: [{ title: "§ 1 zák. č. 999999/2099 Sb." }] })])
    .includes("CITATION_INCOMPLETE"));
});
