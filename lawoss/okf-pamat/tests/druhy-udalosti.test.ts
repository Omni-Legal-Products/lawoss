/**
 * Druhy udalostí sú anglické (O6, rozhodnutie 1 z callu 11. 9. 2026); staré slovenské
 * hodnoty sa čítajú ďalej a späť sa zapisujú už anglicky. Chýbajúce povinné polia sa
 * hlásia naraz (issue #49).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { newRecord, validateStore, EVENT_KINDS, canonicalEventKind } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const T = "2026-09-11";
const rec = (over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id: "D-001", type: "decision", jurisdiction: "cz", title: "Podať odvolanie", description: "d", created: T, updated: T, truth: "t",
    timeline: [{ date: T, text: "založené", kind: "decision" }] }), ...over });

test("druhy udalosti su anglicke a stare slovenske maju alias", () => {
  assert.deepEqual([...EVENT_KINDS], ["delivery", "filing", "hearing", "decision", "request", "call", "email"]);
  assert.equal(canonicalEventKind("rozhodnutie"), "decision");
  assert.equal(canonicalEventKind("pojednavanie"), "hearing");
  assert.equal(canonicalEventKind("email"), "email");
  assert.equal(canonicalEventKind("nezmysel"), "nezmysel", "neznámu hodnotu nechá validácii");
});

test("stary zaznam so slovenskym druhom sa cita a zapise uz anglicky", () => {
  const stary = serializeRecord(rec()).replace("[decision]", "[rozhodnutie]");
  assert.match(stary, /\[rozhodnutie\]/);
  const r = parseRecord(stary);
  assert.equal(r.timeline[0]?.kind, "decision");
  assert.match(serializeRecord(r), /\[decision\]/);
  assert.doesNotMatch(serializeRecord(r), /rozhodnutie/);
});

test("novy zaznam so starou hodnotou prejde validaciou a zapise sa anglicky", () => {
  const r = rec({ timeline: [{ date: T, text: "podané", kind: "podanie" }] });
  assert.equal(validateStore([r]).filter((f) => f.code === "UNKNOWN_VALUE").length, 0);
  assert.match(serializeRecord(r), /\[filing\]/);
  assert.equal(validateStore([rec({ timeline: [{ date: T, text: "x", kind: "nezmysel" }] })]).filter((f) => f.code === "UNKNOWN_VALUE").length, 1);
});

test("chybajuce povinne polia sa hlasia naraz, nie po jednom", () => {
  // `okf:` je značka súboru a `jurisdiction` má vlastnú skoršiu kontrolu — testujú sa iné povinné polia.
  const text = serializeRecord(rec()).replace(/^title: .*\n/m, "").replace(/^status: .*\n/m, "");
  assert.throws(() => parseRecord(text), /Chýbajú povinné polia: title, status/);
  assert.throws(() => parseRecord(serializeRecord(rec()).replace(/^status: .*\n/m, "")), /Chýba povinné pole: status$/);
});
