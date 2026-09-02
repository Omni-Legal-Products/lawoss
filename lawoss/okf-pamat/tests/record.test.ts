import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord, HEADINGS } from "../src/record.ts";

const CZ = `---
okf: 1
id: R-001
type: decision
title: Nenapadat prislusnost
summary: Namitku mistni prislusnosti nepodavame, zdrzela by vec o mesice
layer: L2
jurisdiction: cz
status: active
created: 2026-08-29
updated: 2026-08-29
deadlines: ["2026-09-12"]
related: ["S-001"]
---

## Truth

Misto prislusnosti nenapadame.

## History

- 2026-08-20 — puvodne zvazovana namitka podle § 105 o. s. r.
- 2026-08-29 — prehodnoceno: prodleni prevazuje nad vyhodou
`;

const SK = `---
okf: 1
id: R-001
type: decision
title: Nenapadat prislusnost
summary: Namietku miestnej prislusnosti nepodavame
layer: L2
jurisdiction: sk
status: active
created: 2026-08-29
updated: 2026-08-29
deadlines: ["2026-09-12"]
---

## Truth

Miesto prislusnosti nenapadame.

## History

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

test("slovensky zaznam ma rovnake kluce ako cesky", () => {
  const r = parseRecord(SK);
  assert.equal(r.type, "decision");
  assert.deepEqual(r.deadlines, ["2026-09-12"]);
  assert.equal(r.jurisdiction, "sk", "jurisdikcia je hodnota poľa, nie tvar kľúčov");
});

test("sekcia Truth sa cita ako text", () => {
  assert.equal(parseRecord(CZ).truth, "Misto prislusnosti nenapadame.");
});

test("History sa cita ako usporiadany zoznam zaznamov", () => {
  const r = parseRecord(CZ);
  assert.equal(r.timeline.length, 2);
  assert.equal(r.timeline[0]?.date, "2026-08-20");
  assert.match(r.timeline[1]?.text ?? "", /prehodnoceno/);
});

test("serializacia a spatne precitanie zachova model", () => {
  const r = parseRecord(CZ);
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("serializuje sa do kanonickych klucov bez ohladu na jurisdikciu", () => {
  const out = serializeRecord(parseRecord(SK));
  assert.match(out, /^deadlines:/m);
  assert.doesNotMatch(out, /^lehoty:|^lhuty:/m);
  assert.match(out, /^type: decision$/m);
});

test("nadpisy sekcii su anglicke pre obe jurisdikcie", () => {
  assert.equal(HEADINGS.truth, "Truth");
  assert.equal(HEADINGS.timeline, "History");
  assert.match(serializeRecord(parseRecord(SK)), /^## History$/m);
  assert.match(serializeRecord(parseRecord(CZ)), /^## History$/m);
});

test("zaznam bez frontmatteru je chyba", () => {
  assert.throws(() => parseRecord("## Truth\n\nnieco"), /frontmatter/i);
});

test("neznamy typ zaznamu je chyba", () => {
  const bad = CZ.replace("type: decision", "typ: vymysleny");
  assert.throws(() => parseRecord(bad), /typ/i);
});

test("chybajuce povinne pole je chyba", () => {
  const bad = CZ.replace(/^summary:.*$/m, "");
  assert.throws(() => parseRecord(bad), /summary/);
});
