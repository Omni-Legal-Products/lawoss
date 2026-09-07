import { test } from "node:test";
import assert from "node:assert/strict";
import { maskValue, maskRecord } from "../src/mask.ts";
import { newRecord } from "../src/index.ts";

test("rodne cislo si necha len prvu cast", () => {
  assert.equal(maskValue("birth_number", "750101/1234"), "750101/••••");
  assert.equal(maskValue("birth_number", "7501011234"), "750101••••");
});

test("cislo dokladu si necha len zaciatok", () => {
  assert.equal(maskValue("id_document_number", "123456789"), "12•••••••");
});

test("datum narodenia si necha len rok", () => {
  assert.equal(maskValue("birth_date", "1975-04-11"), "1975-••-••");
});

test("adresa prijde o cisla, ulica zostane citatelna", () => {
  assert.equal(maskValue("residence", "Krátká 12, 110 00 Praha 1"), "Krátká ••, ••• •• Praha •");
});

test("necitlive pole sa nemaskuje", () => {
  assert.equal(maskValue("registry_id", "12345678"), "12345678");
  assert.equal(maskValue("title", "Jan Novák"), "Jan Novák");
});

test("maskRecord maskuje citlive polia a ostatne necha", () => {
  const r = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz",
    title: "Jan Novák", description: "klient",
    created: "2026-08-31", updated: "2026-08-31", truth: "t", timeline: [],
    birth_number: "750101/1234", registry_id: "12345678",
    residence: "Krátká 12, Praha 1", citizenship: "CR",
  });
  const m = maskRecord(r);
  assert.equal(m.birth_number, "750101/••••");
  assert.equal(m.residence, "Krátká ••, Praha •");
  assert.equal(m.registry_id, "12345678");
  assert.equal(m.citizenship, "CR");
  assert.equal(m.title, "Jan Novák");
});

test("maskRecord povodny zaznam nemeni", () => {
  const r = newRecord({
    id: "S-002", type: "subject", jurisdiction: "cz",
    title: "X", description: "y",
    created: "2026-08-31", updated: "2026-08-31", truth: "t", timeline: [],
    birth_number: "750101/1234",
  });
  maskRecord(r);
  assert.equal(r.birth_number, "750101/1234", "maskovanie nesmie prepísať zdroj");
});

test("prazdna hodnota maskovanie neprezije ako chyba", () => {
  assert.equal(maskValue("birth_number", ""), "");
});
