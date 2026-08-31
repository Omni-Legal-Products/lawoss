import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { FIELDS } from "../src/schema.ts";

const SUBJEKT_CZ = `---
okf: 1
id: S-001
typ: subjekt
nazev: Jan Novák
popis: klient, FO, identifikace provedena 29. 8. 2026
vrstva: L2
jurisdikce: cz
stav: platny
vznik: 2026-08-29
zmena: 2026-08-29
role: klient
typ_osoby: fo
rodne_cislo: "750101/1234"
datum_narozeni: 1975-01-01
misto_narozeni: Praha
pohlavi: muz
statni_obcanstvi: CR
trvaly_pobyt: "Krátká 12, 110 00 Praha 1"
doklad_typ: obcansky prukaz
doklad_cislo: "123456789"
doklad_vydal: MC Praha 1
doklad_plati_do: 2032-05-14
pep: ne
---

## Pravda

Klient, identifikace provedena z obcanskeho prukazu.

## Historie

- 2026-08-29 — identifikace dle § 8 AML zakona
`;

const PROVERENI_SK = `---
okf: 1
id: P-001
typ: preverenie
nazov: Preverenie klienta
popis: AML preverenie, riziko nizke
vrstva: L2
jurisdikcia: sk
stav: platny
vznik: 2026-08-29
zmena: 2026-08-29
subjekt: S-001
datum_preverenia: 2026-08-29
rezim: medium
registre: ["ORSR", "RPO", "ISIR", "EU sankcie"]
pep_vysledok: nie je PEP
sankcie_vysledok: bez zaznamu
povod_prostriedkov: prijmy z podnikania
riziko: nizke
zaver: pokracovat
platnost_do: 2027-08-29
---

## Pravda

Bez nalezu.

## História

- 2026-08-29 — preverenie vykonane
`;

test("identifikacne polia subjektu sa nestracaju pri citani", () => {
  const r = parseRecord(SUBJEKT_CZ);
  assert.equal(r.role, "klient");
  assert.equal(r.person_type, "fo");
  assert.equal(r.birth_number, "750101/1234");
  assert.equal(r.residence, "Krátká 12, 110 00 Praha 1");
  assert.equal(r.id_document_number, "123456789");
  assert.equal(r.id_document_valid_to, "2032-05-14");
  assert.equal(r.pep, "ne");
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
  assert.equal(r.risk, "nizke");
  assert.equal(r.valid_until, "2027-08-29");
});

test("provereni prejde serializaciou tam a spat bez straty", () => {
  const r = parseRecord(PROVERENI_SK);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("slovenske provereni sa serializuje do slovenskych klucov", () => {
  const out = serializeRecord(parseRecord(PROVERENI_SK));
  assert.match(out, /^datum_preverenia:/m);
  assert.match(out, /^registre:/m);
  assert.doesNotMatch(out, /^datum_provereni:/m);
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
