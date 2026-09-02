import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { FIELDS } from "../src/schema.ts";

const SUBJEKT_CZ = `---
okf: 1
id: S-001
type: subject
title: Jan Novák
description: klient, FO, identifikace provedena 29. 8. 2026
layer: L2
jurisdiction: cz
status: active
created: 2026-08-29
updated: 2026-08-29
role: client
person_type: natural_person
birth_number: "750101/1234"
birth_date: 1975-01-01
birth_place: Praha
sex: muz
citizenship: CR
residence: "Krátká 12, 110 00 Praha 1"
id_document_type: obcansky prukaz
id_document_number: "123456789"
id_document_issuer: MC Praha 1
id_document_valid_to: 2032-05-14
pep: no
---

## Truth

Klient, identifikace provedena z obcanskeho prukazu.

## History

- 2026-08-29 — identifikace dle § 8 AML zakona
`;

const PROVERENI_SK = `---
okf: 1
id: P-001
type: screening
title: Preverenie klienta
description: AML preverenie, riziko nizke
layer: L2
jurisdiction: sk
status: active
created: 2026-08-29
updated: 2026-08-29
subject_ref: S-001
check_date: 2026-08-29
mode: medium
registries: ["ORSR", "RPO", "ISIR", "EU sankcie"]
pep_result: nie je PEP
sanctions_result: bez zaznamu
funds_origin: prijmy z podnikania
risk: low
conclusion: proceed
valid_until: 2027-08-29
---

## Truth

Bez nalezu.

## History

- 2026-08-29 — preverenie vykonane
`;

test("identifikacne polia subjektu sa nestracaju pri citani", () => {
  const r = parseRecord(SUBJEKT_CZ);
  assert.equal(r.role, "client");
  assert.equal(r.person_type, "natural_person");
  assert.equal(r.birth_number, "750101/1234");
  assert.equal(r.residence, "Krátká 12, 110 00 Praha 1");
  assert.equal(r.id_document_number, "123456789");
  assert.equal(r.id_document_valid_to, "2032-05-14");
  assert.equal(r.pep, "no");
});

test("subjekt prejde serializaciou tam a spat bez straty", () => {
  const r = parseRecord(SUBJEKT_CZ);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("provereni sa cita vratane zoznamu registrov", () => {
  const r = parseRecord(PROVERENI_SK);
  assert.equal(r.type, "screening");
  assert.equal(r.subject_ref, "S-001");
  assert.equal(r.mode, "medium");
  assert.deepEqual(r.registries, ["ORSR", "RPO", "ISIR", "EU sankcie"]);
  assert.equal(r.risk, "low");
  assert.equal(r.valid_until, "2027-08-29");
});

test("provereni prejde serializaciou tam a spat bez straty", () => {
  const r = parseRecord(PROVERENI_SK);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("provereni sa serializuje do kanonickych klucov", () => {
  const out = serializeRecord(parseRecord(PROVERENI_SK));
  assert.match(out, /^check_date:/m);
  assert.match(out, /^registries:/m);
  assert.doesNotMatch(out, /^datum_preverenia:|^registre:/m);
});

test("kazde pole schemy prezije round-trip — ziadne sa nestraca", () => {
  const r = parseRecord(SUBJEKT_CZ);
  const znova = parseRecord(serializeRecord(r));
  for (const f of FIELDS) {
    const a = (r as unknown as Record<string, unknown>)[f.canonical];
    const b = (znova as unknown as Record<string, unknown>)[f.canonical];
    assert.deepEqual(b, a, `pole ${f.canonical} sa pri round-tripe stratilo alebo zmenilo`);
  }
});
