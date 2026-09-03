/**
 * Hodnoty mimo výpočet.
 *
 * Do 3. 9. 2026 sa nekontrolovali vôbec. Na dátach z ISIR sa ukázalo, že
 * `person_type: natural` (namiesto `natural_person`) prejde bez slova a AML
 * kontrola sa pri ňom potichu nevykoná. Varovanie, nie chyba — OKF žiada
 * neznámu hodnotu neodmietať; ale mlčať sa nesmie.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { newRecord, validateStore, FIELDS, PERSON_KINDS } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const D = { today: "2026-09-03" };
function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return { ...newRecord({ id: "S-001", type: "subject", jurisdiction: "cz", title: "Jan Novák", description: "klient",
    created: "2026-09-03", updated: "2026-09-03", truth: "t", timeline: [{ date: "2026-09-03", text: "z" }],
    role: "client", person_type: "natural_person", birth_number: "700101/1234", birth_place: "Praha", sex: "male",
    citizenship: "CZ", residence: "Krátká 1, Praha", id_document_type: "OP", id_document_number: "123",
    id_document_issuer: "MČ Praha 1", id_document_valid_to: "2030-01-01" }), ...over };
}
const kody = (rs: OkfRecord[]) => validateStore(rs, D).map((f) => f.code);

test("neplatny person_type je varovanie a menuje povolene hodnoty", () => {
  const f = validateStore([subjekt({ person_type: "natural" })], D).find((x) => x.code === "UNKNOWN_VALUE");
  assert.ok(f);
  assert.equal(f.severity, "warning");
  assert.match(f.message, /person_type/);
  for (const k of PERSON_KINDS) assert.match(f.message, new RegExp(k));
});

test("neplatny person_type uz nevypina AML kontrolu potichu", () => {
  // Kontrola úplnosti sa pri neznámom druhu osoby nevykoná — to je stále
  // tak. Rozdiel je, že to už nie je ticho: varovanie to povie.
  const k = kody([subjekt({ person_type: "natural" })]);
  assert.ok(k.includes("UNKNOWN_VALUE"));
  assert.ok(!k.includes("AML_INCOMPLETE"), "pri neznámom druhu sa úplnosť nedá posúdiť");
});

test("platne hodnoty ziadne varovanie nedaju", () => {
  assert.ok(!kody([subjekt()]).includes("UNKNOWN_VALUE"));
});

test("neplatna rola a stav ulohy sa hlasia rovnako", () => {
  assert.ok(kody([subjekt({ role: "insolvency_trustee" })]).includes("UNKNOWN_VALUE"));
  const uloha = newRecord({ id: "T-001", type: "task", jurisdiction: "cz", title: "x", description: "d",
    created: "2026-09-03", updated: "2026-09-03", truth: "t", timeline: [{ date: "2026-09-03", text: "z" }], state: "todo" });
  assert.ok(kody([uloha]).includes("UNKNOWN_VALUE"));
});

test("neznamy druh udalosti v historii sa hlasi", () => {
  const r = subjekt({ timeline: [{ date: "2026-09-03", text: "z", kind: "note" }] });
  const f = validateStore([r], D).find((x) => x.code === "UNKNOWN_VALUE");
  assert.ok(f);
  assert.match(f.message, /udalosti „note"/);
});

test("kazde pole s vypoctom ma neprazdny vypocet", () => {
  for (const f of FIELDS) if (f.values) assert.ok(f.values.length > 0, f.canonical);
  assert.ok(FIELDS.filter((f) => f.values).length >= 13, "výpočty musia byť pripojené v tabuľke");
});
