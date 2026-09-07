import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FIELDS, RECORD_TYPES, LAYER_OF, typeLabel, fieldLabel, canonicalField,
  SENSITIVE_FIELDS, needleFields, AML_REQUIRED,
} from "../src/schema.ts";

test("provereni je novy typ zaznamu vo vrstve L2", () => {
  assert.ok(RECORD_TYPES.includes("screening"));
  assert.equal(LAYER_OF.screening, "L2");
});

test("popisok typu preverenie sa v CZ a SK pise inak", () => {
  assert.equal(typeLabel("screening", "cz"), "prověření");
  assert.equal(typeLabel("screening", "sk"), "preverenie");
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
  assert.equal(fieldLabel("birth_number", "cz"), "rodné číslo");
  assert.equal(fieldLabel("birth_number", "sk"), "rodné číslo");
});

test("miesto narodenia a obcianstvo sa pisu jurisdikcne", () => {
  assert.equal(fieldLabel("birth_place", "cz"), "místo narození");
  assert.equal(fieldLabel("birth_place", "sk"), "miesto narodenia");
  assert.equal(canonicalField("citizenship"), "citizenship");
  assert.equal(canonicalField("statne_obcianstvo"), undefined);
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

test("ceska sada vychadza z § 5 — nie z § 8, ktory upravuje vykonanie identifikacie", () => {
  const fo = AML_REQUIRED.cz?.natural_person ?? [];
  const names = fo.map((r) => (typeof r === "string" ? r : r.primary));
  assert.ok(names.includes("birth_number"));
  assert.ok(names.includes("birth_place"), "§ 5 žiada miesto narodenia vždy");
  assert.ok(names.includes("id_document_issuer"), "§ 5 žiada orgán, ktorý doklad vydal");
  assert.ok((AML_REQUIRED.cz?.legal_person ?? []).includes("registry_id"));
  assert.ok((AML_REQUIRED.cz?.legal_person ?? []).includes("registered_office"));
});

test("ceska PO sada neziada pravnu formu ani zapis v rejstriku", () => {
  const po = AML_REQUIRED.cz?.legal_person ?? [];
  assert.ok(!po.includes("legal_form"), "§ 5 ods. 1 písm. b) právnu formu nežiada");
  assert.ok(!po.includes("registry_entry"), "zápis v registri žiada slovenský, nie český predpis");
});

test("slovenska sada vychadza z § 7 a lisi sa od ceskej", () => {
  const fo = (AML_REQUIRED.sk?.natural_person ?? []).map((r) => (typeof r === "string" ? r : r.primary));
  assert.ok(fo.includes("residence"));
  assert.ok(fo.includes("id_document_number"));
  assert.ok(!fo.includes("birth_place"), "§ 7 miesto narodenia nežiada — CZ áno");
  assert.ok(!fo.includes("id_document_issuer"), "§ 7 vydavateľa dokladu nežiada — CZ áno");
  assert.ok((AML_REQUIRED.sk?.legal_person ?? []).includes("registry_entry"), "§ 7 zápis v registri žiada");
});

test("rodne cislo ma v oboch jurisdikciach nahradu, ale roznu", () => {
  const cz = (AML_REQUIRED.cz?.natural_person ?? []).find((r) => typeof r !== "string" && r.primary === "birth_number");
  const sk = (AML_REQUIRED.sk?.natural_person ?? []).find((r) => typeof r !== "string" && r.primary === "birth_number");
  assert.deepEqual(typeof cz === "string" ? [] : cz?.fallback, ["birth_date", "sex"]);
  assert.deepEqual(typeof sk === "string" ? [] : sk?.fallback, ["birth_date"]);
});

test("obe jurisdikcie maju sadu pre FO, PO aj podnikatela", () => {
  for (const j of ["cz", "sk"] as const) {
    for (const kind of ["natural_person", "legal_person", "sole_trader"] as const) {
      assert.ok((AML_REQUIRED[j]?.[kind] ?? []).length > 0, `${j}/${kind} chýba`);
    }
  }
});
