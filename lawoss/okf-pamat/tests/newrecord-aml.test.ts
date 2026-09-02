import { test } from "node:test";
import assert from "node:assert/strict";
import { newRecord } from "../src/index.ts";
import { serializeRecord, parseRecord } from "../src/record.ts";

test("newRecord prenesie identifikacne polia subjektu", () => {
  const r = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz",
    title: "Jan Novák", description: "klient",
    created: "2026-08-31", updated: "2026-08-31", truth: "t", timeline: [],
    role: "client", person_type: "natural_person",
    birth_number: "750101/1234", residence: "Krátká 12, Praha 1",
    id_document_type: "obcansky prukaz", id_document_number: "123456789",
    pep: "ne",
  });
  assert.equal(r.birth_number, "750101/1234");
  assert.equal(r.residence, "Krátká 12, Praha 1");
  assert.equal(r.id_document_number, "123456789");
  assert.equal(r.role, "client");
});

test("newRecord prenesie polia proverenia vratane zoznamov", () => {
  const r = newRecord({
    id: "P-001", type: "screening", jurisdiction: "cz",
    title: "Prověření klienta", description: "AML, riziko nízké",
    created: "2026-08-31", updated: "2026-08-31", truth: "t", timeline: [],
    subject_ref: "S-001", check_date: "2026-08-31", mode: "medium",
    registries: ["ARES", "ISIR", "ESM"], risk: "nizke",
    conclusion: "pokracovat", valid_until: "2027-08-31",
  });
  assert.equal(r.layer, "L2");
  assert.deepEqual(r.registries, ["ARES", "ISIR", "ESM"]);
  assert.equal(r.valid_until, "2027-08-31");
});

test("zaznam z newRecord prezije zapis na disk a spatne precitanie", () => {
  const r = newRecord({
    id: "S-002", type: "subject", jurisdiction: "sk",
    title: "Firma s.r.o.", description: "protistrana",
    created: "2026-08-31", updated: "2026-08-31", truth: "t", timeline: [],
    person_type: "legal_person", registry_id: "12345678",
    registered_office: "Hlavná 1, Bratislava", legal_form: "s.r.o.",
    representatives: ["Ján Malý"], ubo: ["Ján Malý"],
  });
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});
