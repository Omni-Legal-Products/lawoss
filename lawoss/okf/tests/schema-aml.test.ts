import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS, RECORD_TYPES, LAYER_OF, typeKey, canonicalType, fieldKey, canonicalField,
  SENSITIVE_FIELDS, needleFields, AML_REQUIRED,
} from "../src/schema.ts";

test("provereni je novy typ zaznamu vo vrstve L2", () => {
  assert.ok(RECORD_TYPES.includes("screening"));
  assert.equal(LAYER_OF.screening, "L2");
});

test("provereni sa v CZ a SK pise inak", () => {
  assert.equal(typeKey("screening", "cz"), "provereni");
  assert.equal(typeKey("screening", "sk"), "preverenie");
  assert.equal(canonicalType("provereni", "cz"), "screening");
  assert.equal(canonicalType("preverenie", "sk"), "screening");
});

test("identifikacne polia podla § 8 su v schéme pre obe jurisdikcie", () => {
  for (const c of [
    "role", "person_type", "birth_number", "birth_place", "sex", "citizenship",
    "residence", "id_document_type", "id_document_number", "id_document_issuer",
    "id_document_valid_to", "legal_form", "registered_office", "registry_entry",
    "business_scope", "representatives", "ubo", "pep",
  ]) {
    const f = FIELDS.find((x) => x.canonical === c);
    assert.ok(f, `chýba pole ${c}`);
    assert.ok(f?.cz && f?.sk, `pole ${c} nemá obe jurisdikcie`);
  }
});

test("polia provereni su v scheme", () => {
  for (const c of [
    "subject_ref", "check_date", "mode", "registries", "pep_result",
    "sanctions_result", "funds_origin", "risk", "conclusion", "valid_until",
  ]) {
    assert.ok(FIELDS.some((x) => x.canonical === c), `chýba pole ${c}`);
  }
});

test("rodne cislo ma v CZ a SK rovnaky kluc, trvaly pobyt tiez", () => {
  assert.equal(fieldKey("birth_number", "cz"), "rodne_cislo");
  assert.equal(fieldKey("birth_number", "sk"), "rodne_cislo");
});

test("miesto narodenia a obcianstvo sa pisu jurisdikcne", () => {
  assert.equal(fieldKey("birth_place", "cz"), "misto_narozeni");
  assert.equal(fieldKey("birth_place", "sk"), "miesto_narodenia");
  assert.equal(canonicalField("statne_obcianstvo", "sk"), "citizenship");
  assert.equal(canonicalField("statni_obcanstvi", "cz"), "citizenship");
});

test("citlive polia su oznacene a patri medzi ne rodne cislo, doklad, pobyt a datum narodenia", () => {
  assert.deepEqual(
    [...SENSITIVE_FIELDS].sort(),
    ["birth_date", "birth_number", "id_document_number", "residence"],
  );
});

test("kazde citlive pole je zaroven jehlou detektora uniku", () => {
  const needles = new Set(needleFields().map((f) => f.canonical));
  for (const s of SENSITIVE_FIELDS) {
    assert.ok(needles.has(s), `citlivé pole ${s} nie je jehlou — pridanie údaja by oslabilo bránu`);
  }
});

test("ICO zostava jehlou aj ked citlive nie je", () => {
  assert.ok(needleFields().some((f) => f.canonical === "registry_id" && f.needle === "hard"));
});

test("ceska povinna sada podla § 8 je definovana pre FO aj PO", () => {
  assert.ok((AML_REQUIRED.cz?.fo ?? []).includes("birth_number"));
  assert.ok((AML_REQUIRED.cz?.fo ?? []).includes("id_document_number"));
  assert.ok((AML_REQUIRED.cz?.po ?? []).includes("registry_id"));
  assert.ok((AML_REQUIRED.cz?.po ?? []).includes("registered_office"));
});

test("slovenska povinna sada nie je overena — nesmie sa tvarit ze je", () => {
  assert.equal(AML_REQUIRED.sk, undefined,
    "SK požiadavky nie sú overené; predstierať ich by bolo tiché prekladanie právnych pojmov");
});
