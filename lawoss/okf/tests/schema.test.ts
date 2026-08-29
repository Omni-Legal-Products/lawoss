import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS,
  RECORD_TYPES,
  LAYER_OF,
  fieldKey,
  canonicalField,
  typeKey,
  canonicalType,
} from "../src/schema.ts";

test("lhuty (CZ) aj lehoty (SK) mapujú na rovnaké kanonické pole", () => {
  assert.equal(canonicalField("lhuty", "cz"), "deadlines");
  assert.equal(canonicalField("lehoty", "sk"), "deadlines");
  assert.equal(fieldKey("deadlines", "cz"), "lhuty");
  assert.equal(fieldKey("deadlines", "sk"), "lehoty");
});

test("kazde pole ma kluc pre obe jurisdikcie", () => {
  for (const f of FIELDS) {
    assert.ok(f.cz, `pole ${f.canonical} nema CZ kluc`);
    assert.ok(f.sk, `pole ${f.canonical} nema SK kluc`);
  }
});

test("neznamy lokalny kluc nema kanonicky protiklad", () => {
  assert.equal(canonicalField("vymysleny_kluc", "cz"), undefined);
});

test("typ zaznamu prejde tam a spat v oboch jurisdikciach", () => {
  for (const t of RECORD_TYPES) {
    for (const j of ["cz", "sk"] as const) {
      assert.equal(canonicalType(typeKey(t, j), j), t, `${t} / ${j}`);
    }
  }
});

test("rozhodnutie sa v CZ a SK pise inak", () => {
  assert.equal(typeKey("decision", "cz"), "rozhodnuti");
  assert.equal(typeKey("decision", "sk"), "rozhodnutie");
});

test("kazdy typ zaznamu ma priradenu vrstvu", () => {
  for (const t of RECORD_TYPES) {
    assert.match(LAYER_OF[t], /^L[123]$/, `${t} nema vrstvu`);
  }
});

test("klientske typy su L2, kancelarske L1, pravne L3", () => {
  assert.equal(LAYER_OF.matter, "L2");
  assert.equal(LAYER_OF.decision, "L2");
  assert.equal(LAYER_OF.subject, "L2");
  assert.equal(LAYER_OF.question, "L2");
  assert.equal(LAYER_OF.rule, "L1");
  assert.equal(LAYER_OF.lesson, "L1");
  assert.equal(LAYER_OF.authority, "L3");
});
