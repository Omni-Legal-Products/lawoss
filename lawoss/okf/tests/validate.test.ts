import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStore } from "../src/validate.ts";
import type { OkfRecord } from "../src/record.ts";

function base(over: Partial<OkfRecord>): OkfRecord {
  return {
    schema: 1,
    id: "X-001",
    type: "decision",
    title: "t",
    summary: "s",
    layer: "L2",
    jurisdiction: "cz",
    status: "platny",
    created: "2026-08-29",
    updated: "2026-08-29",
    truth: "",
    timeline: [],
    ...over,
  } as OkfRecord;
}

const SUBJEKT = base({
  id: "S-001",
  type: "subject",
  layer: "L2",
  title: "Gh Real Estate s.r.o.",
  registry_id: "29139643",
  birth_date: "1975-04-11",
  truth: "Dlznik v insolvencnom konani.",
});

function codes(fs: ReturnType<typeof validateStore>): string[] {
  return fs.map((f) => f.code);
}

test("pravny pramen s ICO klienta je zablokovany", () => {
  const pramen = base({
    id: "J-001",
    type: "authority",
    layer: "L3",
    truth: "Rozhodnutie sa tykalo spolocnosti s ICO 29139643.",
  });
  const f = validateStore([SUBJEKT, pramen]);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
  assert.equal(f.find((x) => x.code === "L3_LEAK")?.severity, "error");
});

test("pravny pramen s menom klienta je zablokovany", () => {
  const pramen = base({
    id: "J-002",
    type: "authority",
    layer: "L3",
    truth: "Argumentacia pouzita vo veci Gh Real Estate s.r.o.",
  });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("pravny pramen s datumom narodenia klienta je zablokovany", () => {
  const pramen = base({ id: "J-003", type: "authority", layer: "L3", truth: "narodeny 1975-04-11" });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("uniku sa nevyhne ani cez historiu zaznamu", () => {
  const pramen = base({
    id: "J-004",
    type: "authority",
    layer: "L3",
    truth: "cista pravna veta",
    timeline: [{ date: "2026-08-29", text: "prevzate zo spisu ICO 29139643" }],
  });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("cisty pravny pramen prejde", () => {
  const pramen = base({
    id: "J-005",
    type: "authority",
    layer: "L3",
    truth: "29 NSCR 73/2024, odst. 29 — kumulativnost podmienok § 348 ods. 1 IZ.",
  });
  assert.deepEqual(validateStore([SUBJEKT, pramen]), []);
});

test("ten isty udaj v L2 zazname problem nie je", () => {
  const iny = base({ id: "R-001", truth: "ICO 29139643 overene v OR." });
  assert.deepEqual(validateStore([SUBJEKT, iny]), []);
});

test("odkaz na neexistujuci zaznam je nalez", () => {
  const r = base({ id: "R-002", related: ["S-999"] });
  assert.ok(codes(validateStore([SUBJEKT, r])).includes("BROKEN_LINK"));
});

test("duplicitne id je nalez", () => {
  const f = validateStore([base({ id: "R-003" }), base({ id: "R-003" })]);
  assert.ok(codes(f).includes("DUPLICATE_ID"));
});

test("zaznam starsi nez jeho vlastna historia je nalez", () => {
  const r = base({
    id: "R-004",
    updated: "2026-08-01",
    timeline: [{ date: "2026-08-29", text: "novsie nez updated" }],
  });
  assert.ok(codes(validateStore([r])).includes("STALE_UPDATED"));
});

test("wiki-link v texte na neexistujuci zaznam je nalez", () => {
  const r = base({ id: "R-005", truth: "viz [[R-999]]" });
  assert.ok(codes(validateStore([r])).includes("BROKEN_LINK"));
});
