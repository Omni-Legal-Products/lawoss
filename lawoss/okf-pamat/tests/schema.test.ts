import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS, RECORD_TYPES, LAYER_OF, fieldLabel, canonicalField, typeLabel,
  isRecordType, isJurisdiction,
} from "../src/schema.ts";

test("kluce su kanonicke — lokalizovany kluc kluc nie je", () => {
  assert.equal(canonicalField("deadlines"), "deadlines");
  assert.equal(canonicalField("lehoty"), undefined);
  assert.equal(canonicalField("lhuty"), undefined);
  assert.equal(canonicalField("vymysleny_kluc"), undefined);
});

test("kazde pole ma popisok pre obe jurisdikcie", () => {
  for (const f of FIELDS) {
    assert.ok(f.cz, `pole ${f.canonical} nemá CZ popisok`);
    assert.ok(f.sk, `pole ${f.canonical} nemá SK popisok`);
  }
});

test("kanonicke nazvy poli su ascii — su to kluce, nie text", () => {
  for (const f of FIELDS) {
    assert.match(f.canonical, /^[a-z][a-z0-9_]*$/, `kľúč ${f.canonical} nie je technický identifikátor`);
  }
});

test("kanonicky nazov je zaroven klucom na disku", () => {
  // Invariant, na ktorom stojí serializer: číta hodnotu podľa `canonical`
  // a pod tým istým menom ju zapíše. Duplicita by ticho prepísala pole.
  const mena = FIELDS.map((f) => f.canonical);
  assert.equal(new Set(mena).size, mena.length, "kanonické názvy sa nesmú opakovať");
});

test("popisky sa medzi jurisdikciami lisia tam, kde sa lisi jazyk", () => {
  assert.equal(fieldLabel("deadlines", "cz"), "lhůty");
  assert.equal(fieldLabel("deadlines", "sk"), "lehoty");
  assert.equal(fieldLabel("court", "cz"), "soud");
  assert.equal(fieldLabel("court", "sk"), "súd");
});

test("popisok neznameho pola je chyba, nie ticho prazdny retazec", () => {
  assert.throws(() => fieldLabel("neexistuje", "cz"), /Neznáme pole/);
});

test("kazdy typ zaznamu ma popisok pre obe jurisdikcie", () => {
  for (const t of RECORD_TYPES) {
    assert.ok(typeLabel(t, "cz"), `${t} nemá CZ popisok`);
    assert.ok(typeLabel(t, "sk"), `${t} nemá SK popisok`);
  }
});

test("typ sa rozpozna podla kanonickeho nazvu, nie podla prekladu", () => {
  assert.ok(isRecordType("decision"));
  assert.ok(isRecordType("screening"));
  assert.equal(isRecordType("rozhodnutie"), false, "preklad typom nie je");
  assert.equal(isRecordType("vymysleny"), false);
});

test("jurisdikcia je uzavreta mnozina", () => {
  assert.ok(isJurisdiction("cz"));
  assert.ok(isJurisdiction("sk"));
  assert.equal(isJurisdiction("pl"), false);
});

test("kazdy typ zaznamu ma priradenu vrstvu", () => {
  for (const t of RECORD_TYPES) {
    assert.match(LAYER_OF[t], /^L[123]$/, `${t} nemá vrstvu`);
  }
});

test("klientske typy su L2, kancelarske L1, pravne L3", () => {
  assert.equal(LAYER_OF.matter, "L2");
  assert.equal(LAYER_OF.decision, "L2");
  assert.equal(LAYER_OF.subject, "L2");
  assert.equal(LAYER_OF.question, "L2");
  assert.equal(LAYER_OF.screening, "L2");
  assert.equal(LAYER_OF.rule, "L1");
  assert.equal(LAYER_OF.lesson, "L1");
  assert.equal(LAYER_OF.authority, "L3");
});
