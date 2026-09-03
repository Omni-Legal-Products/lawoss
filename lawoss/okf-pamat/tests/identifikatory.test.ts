/**
 * Identifikátory na reálnych dátach z ISIR.
 *
 * Obe vady sa našli až zápisom desiatich skutočných konaní: štyri z dvanástich
 * IČO začínali nulou a jeden správca sa volal „Kolář a Klaudy". V testoch
 * s vymyslenými dátami nič z toho nebolo.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord, parseFrontmatter } from "../src/record.ts";
import { newRecord, validateStore } from "../src/index.ts";

const D = { today: "2026-09-03" };
const zaklad = (id: string, type: "subject" | "authority", title: string, truth: string) =>
  newRecord({ id, type, jurisdiction: "cz", title, description: "d", created: "2026-09-03",
    updated: "2026-09-03", truth, timeline: [{ date: "2026-09-03", text: "z" }] });

test("ICO s veducou nulou prezije citanie aj round-trip", () => {
  const s = { ...zaklad("S-001", "subject", "Firma", "t"), registry_id: "04920040" };
  const von = serializeRecord(s);
  assert.match(von, /^registry_id: 04920040$/m, "serializer nulu nesmie zjesť");
  assert.equal(parseRecord(von).registry_id, "04920040", "parser ju nesmie prečítať ako číslo");
});

test("ICO s veducou nulou je jehlou uniku aj po precitani zo suboru", () => {
  // Presne cesta agenta: návrh → súbor → parseRecord → brána.
  const s = parseRecord(serializeRecord({ ...zaklad("S-001", "subject", "Firma", "t"), registry_id: "04920040" }));
  const a = zaklad("A-001", "authority", "Veta", "Ve věci IČO 04920040 soud postupoval.");
  assert.ok(validateStore([s, a], D).some((f) => f.code === "L3_LEAK"), "IČO 04920040 musí byť chytené");
});

test("cislo 0 a desatinne cislo zostavaju cislami, 007 je retazec", () => {
  const fm = parseFrontmatter("a: 0\nb: 0.5\nc: 007\nd: 42\n");
  assert.equal(fm.get("a"), 0);
  assert.equal(fm.get("b"), 0.5);
  assert.equal(fm.get("c"), "007");
  assert.equal(fm.get("d"), 42);
});

test("obchodna firma so spojkou a je jehlou a sadne na text", () => {
  const s = zaklad("S-001", "subject", "Kolář a Klaudy v.o.s.", "t");
  const a = zaklad("A-001", "authority", "Veta", "Správcem byla ustanovena Kolář a Klaudy v.o.s.");
  const f = validateStore([s, a], D).find((x) => x.code === "L3_LEAK");
  assert.ok(f, "názov so spojkou musí sadnúť");
});

test("spojka sama o sebe silu jehly nezvysuje", () => {
  // „a" nie je meno; sila sa posudzuje bez jednopísmenových slov.
  const s = zaklad("S-001", "subject", "a", "t");
  const a = zaklad("A-001", "authority", "Veta", "Bol tam a potom nebol.");
  assert.ok(!validateStore([s, a], D).some((x) => x.code.startsWith("L3_LEAK")));
});
