/**
 * Pramene a overenia podľa Open Knowledge Format v0.2.
 *
 * `sources[]` so stabilným `id` a atribúcia jednotlivého tvrdenia poznámkou
 * pod čiarou `[^id]` — presne to, čo robí advokát v každom podaní: vetu opiera
 * o konkrétny judikát. Poznámka bez prameňa je chyba, nie varovanie: veta
 * vyzerá podložene a nie je.
 *
 * Parser nie je YAML. Číta presne tvary, ktoré OKF používa, a na čokoľvek iné
 * spadne s číslom riadku. V právnom dokumente je tichý omyl v citácii horší
 * než odmietnutý súbor.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord, parseFrontmatter } from "../src/record.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-03" };

function pramen(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "A-001", type: "authority", jurisdiction: "cz",
      title: "Neoprávnená stavba", description: "súhlas nie je titulom",
      created: "2026-09-03", updated: "2026-09-03",
      truth: "Súhlas vlastníka pozemku nie je titulom k stavbe.[^ns-22-cdo-2886-2023]",
      timeline: [{ date: "2026-09-03", text: "založené" }],
      sources: [{
        id: "ns-22-cdo-2886-2023", title: "NS 22 Cdo 2886/2023",
        author: "Nejvyšší soud", resource: "https://example.org/ns/22-cdo-2886-2023",
        last_modified: "2023-11-14",
      }],
      verified: [{ by: "JUDr. Vojtěch Říha", at: "2026-09-03T09:00:00Z" }],
    }),
    ...over,
  };
}

const hlavicka = (telo: string) => `---
okf: 1
id: A-001
type: authority
title: T
description: d
layer: L3
jurisdiction: cz
status: active
created: 2026-09-03
updated: 2026-09-03
${telo}
---

## Truth
t

## History
- 2026-09-03 — z
`;

// --- tvar na disku a round-trip -------------------------------------------

test("pramene sa zapisu blokovo tak, ako ich pise OKF", () => {
  const von = serializeRecord(pramen());
  assert.match(von, /^sources:\n  - id: ns-22-cdo-2886-2023\n    title: NS 22 Cdo 2886\/2023\n/m);
  assert.match(von, /^verified:\n  - by: JUDr\. Vojtěch Říha\n    at: /m);
});

test("pramene a overenia preziju round-trip bez straty", () => {
  const r = pramen();
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("stary tvar sources ako zoznam retazcov sa cita ako pramene s title", () => {
  const r = parseRecord(hlavicka('sources: ["§ 129 o. s. ř.", "NS 22 Cdo 1/2020"]'));
  assert.deepEqual(r.sources, [{ title: "§ 129 o. s. ř." }, { title: "NS 22 Cdo 1/2020" }]);
  // a po prepísaní už je v novom tvare
  assert.match(serializeRecord(r), /^sources:\n  - title: /m);
});

// --- ďalšie tvary OKF ------------------------------------------------------

test("blokovy zoznam skalarov, ako ho pise Obsidian, sa cita ako zoznam", () => {
  const fm = parseFrontmatter("tags:\n  - klient\n  - vozidlo\n");
  assert.deepEqual(fm.get("tags"), ["klient", "vozidlo"]);
});

test("inline mapovanie { by: x, at: y } sa cita", () => {
  const fm = parseFrontmatter('generated: { by: agent, at: "2026-09-03T09:00:00Z" }\n');
  assert.deepEqual(fm.get("generated"), { by: "agent", at: "2026-09-03T09:00:00Z" });
});

test("blokove mapovanie sa cita", () => {
  const fm = parseFrontmatter("generated:\n  by: agent\n  at: 2026-09-03\n");
  assert.deepEqual(fm.get("generated"), { by: "agent", at: "2026-09-03" });
});

test("cudzi strukturovany kluc prezije round-trip v extra", () => {
  // OKF `generated` nemáme v schéme — musí prejsť ako cudzí kľúč bez straty.
  const r = parseRecord(hlavicka("generated:\n  by: agent\n  at: 2026-09-03"));
  assert.deepEqual(r.extra, { generated: { by: "agent", at: "2026-09-03" } });
  assert.deepEqual(parseRecord(serializeRecord(r)).extra, r.extra);
});

// --- parser padne nahlas ---------------------------------------------------

test("hlbsie vnorenie je chyba s cislom riadku, nie ticho precitany udaj", () => {
  assert.throws(
    () => parseFrontmatter("sources:\n  - id: x\n    meta:\n      deep: y\n"),
    /Riadok \d+/,
  );
});

test("zoznam miesajuci skalare a mapovania je chyba", () => {
  assert.throws(() => parseFrontmatter("sources:\n  - id: x\n  - holy text\n"), /mieša/);
});

test("riadok na urovni poloziek bez pomlcky je chyba", () => {
  assert.throws(() => parseFrontmatter("sources:\n  - id: x\n  title: bez pomlcky\n"), /Riadok \d+/);
});

test("odsadene mapovanie bez pomlcky je platny tvar a cita sa ako jedna polozka", () => {
  // YAML to číta ako mapovanie; `maplist` ho zabalí do zoznamu.
  const r = parseRecord(hlavicka("sources:\n    title: jeden prameň"));
  assert.deepEqual(r.sources, [{ title: "jeden prameň" }]);
});

test("prazdna hodnota v mapovani je vnoreny blok a je chyba", () => {
  assert.throws(() => parseFrontmatter("generated:\n  by:\n    x: y\n"), /Riadok \d+/);
});

test("nerovnake odsadenie v mapovani je chyba", () => {
  assert.throws(() => parseFrontmatter("generated:\n  by: a\n    at: b\n"), /Riadok \d+/);
});

// --- atribúcia tvrdenia ----------------------------------------------------

test("poznamka pod ciarou s pramenom prejde bez nalezu", () => {
  const f = validateStore([pramen()], DNES).filter((x) => x.code.startsWith("CITATION") || x.code.startsWith("SOURCE"));
  assert.deepEqual(f, []);
});

test("poznamka bez pramena je chyba — veta vyzera podlozene a nie je", () => {
  const f = validateStore([pramen({ sources: [] })], DNES).find((x) => x.code === "CITATION_UNRESOLVED");
  assert.ok(f);
  assert.equal(f.severity, "error");
  assert.match(f.message, /ns-22-cdo-2886-2023/);
});

test("poznamka v historii sa kontroluje rovnako ako v Pravde", () => {
  const r = pramen({
    truth: "bez poznámky",
    timeline: [{ date: "2026-09-03", text: "doplnené podľa[^chyba-id]" }],
  });
  assert.ok(validateStore([r], DNES).some((x) => x.code === "CITATION_UNRESOLVED"));
});

test("duplicitne id pramena je chyba", () => {
  const r = pramen({ sources: [{ id: "x", title: "a" }, { id: "x", title: "b" }], truth: "t" });
  const f = validateStore([r], DNES).find((x) => x.code === "SOURCE_ID_DUPLICATE");
  assert.ok(f);
  assert.equal(f.severity, "error");
});

test("atribucia sa kontroluje na kazdom type, nie len na prameni", () => {
  const rozhodnutie = newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz",
    title: "T", description: "d", created: "2026-09-03", updated: "2026-09-03",
    truth: "Nenapadáme.[^nie-je]", timeline: [{ date: "2026-09-03", text: "z" }],
  });
  assert.ok(validateStore([rozhodnutie], DNES).some((x) => x.code === "CITATION_UNRESOLVED"));
});

// --- overenie ako zoznam ---------------------------------------------------

test("verified ako zoznam splni stopu overenia", () => {
  const r = pramen();
  delete r.verified_at;
  delete r.verified_against;
  assert.ok(!validateStore([r], DNES).some((x) => x.code === "AUTHORITY_UNVERIFIED"));
});

test("stare verified_at stale staci — starsie spisy bezia", () => {
  const r = pramen({ verified_at: "2026-09-03", verified_against: "plné znenie" });
  delete r.verified;
  assert.ok(!validateStore([r], DNES).some((x) => x.code === "AUTHORITY_UNVERIFIED"));
});

test("citacia predpisu bez cisla a roku sa kontroluje v title pramena", () => {
  const f = validateStore([pramen({ sources: [{ title: "insolvenční zákon, Sb." }], truth: "t" })], DNES)
    .find((x) => x.code === "CITATION_INCOMPLETE");
  assert.ok(f);
});
