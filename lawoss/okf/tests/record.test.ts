import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord, HEADINGS } from "../src/record.ts";

const CZ = `---
okf: 1
id: R-001
typ: rozhodnuti
nazev: Nenapadat prislusnost
popis: Namitku mistni prislusnosti nepodavame, zdrzela by vec o mesice
vrstva: L2
jurisdikce: cz
stav: platny
vznik: 2026-08-29
zmena: 2026-08-29
lhuty: ["2026-09-12"]
souvisi: ["S-001"]
---

## Pravda

Misto prislusnosti nenapadame.

## Historie

- 2026-08-20 — puvodne zvazovana namitka podle § 105 o. s. r.
- 2026-08-29 — prehodnoceno: prodleni prevazuje nad vyhodou
`;

const SK = `---
okf: 1
id: R-001
typ: rozhodnutie
nazov: Nenapadat prislusnost
popis: Namietku miestnej prislusnosti nepodavame
vrstva: L2
jurisdikcia: sk
stav: platny
vznik: 2026-08-29
zmena: 2026-08-29
lehoty: ["2026-09-12"]
---

## Pravda

Miesto prislusnosti nenapadame.

## História

- 2026-08-29 — rozhodnute
`;

test("cita ceskym zaznam do kanonickeho modelu", () => {
  const r = parseRecord(CZ);
  assert.equal(r.id, "R-001");
  assert.equal(r.type, "decision");
  assert.equal(r.layer, "L2");
  assert.equal(r.jurisdiction, "cz");
  assert.deepEqual(r.deadlines, ["2026-09-12"]);
  assert.deepEqual(r.related, ["S-001"]);
});

test("slovensky zaznam s lehoty konci v tom istom kanonickom poli", () => {
  const r = parseRecord(SK);
  assert.equal(r.type, "decision");
  assert.deepEqual(r.deadlines, ["2026-09-12"]);
});

test("sekcia Pravda sa cita ako text", () => {
  assert.equal(parseRecord(CZ).truth, "Misto prislusnosti nenapadame.");
});

test("Historia sa cita ako usporiadany zoznam zaznamov", () => {
  const r = parseRecord(CZ);
  assert.equal(r.timeline.length, 2);
  assert.equal(r.timeline[0]?.date, "2026-08-20");
  assert.match(r.timeline[1]?.text ?? "", /prehodnoceno/);
});

test("serializacia a spatne precitanie zachova model", () => {
  const r = parseRecord(CZ);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("serializuje sa do jurisdikcnych klucov, nie kanonickych", () => {
  const out = serializeRecord(parseRecord(SK));
  assert.match(out, /^lehoty:/m);
  assert.doesNotMatch(out, /^lhuty:/m);
  assert.match(out, /^typ: rozhodnutie$/m);
});

test("nadpisy sekcii su jurisdikcne", () => {
  assert.equal(HEADINGS.cz.timeline, "Historie");
  assert.equal(HEADINGS.sk.timeline, "História");
  assert.match(serializeRecord(parseRecord(SK)), /^## História$/m);
});

test("zaznam bez frontmatteru je chyba", () => {
  assert.throws(() => parseRecord("## Pravda\n\nnieco"), /frontmatter/i);
});

test("neznamy typ zaznamu je chyba", () => {
  const bad = CZ.replace("typ: rozhodnuti", "typ: vymysleny");
  assert.throws(() => parseRecord(bad), /typ/i);
});

test("chybajuce povinne pole je chyba", () => {
  const bad = CZ.replace(/^popis:.*$/m, "");
  assert.throws(() => parseRecord(bad), /popis/);
});
