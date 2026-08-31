import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findClientDir, readScope, memoryDirName } from "../src/store.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

/** Postaví MČ profil A: klient → oblasť → spis. */
function struktura(): { klient: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-scope-"));
  const klient = join(root, "Novák Jan");
  const spis = join(klient, "3 - Soudni", "2026-08 Svoboda - vypoved najmu - zaloba");
  mkdirSync(spis, { recursive: true });
  writeFileSync(join(klient, "klient.md"), "---\ntype: klient\n---\n# Novák Jan\n");
  mkdirSync(join(klient, memoryDirName("cz")));
  mkdirSync(join(spis, memoryDirName("cz")));
  writeFileSync(join(spis, "_STATUS.md"), "# Status\n\n> **Fáze:** příprava\n");
  return { klient, spis };
}

function put(dir: string, r: OkfRecord): void {
  writeFileSync(join(dir, memoryDirName("cz"), `${r.id}-x.md`), serializeRecord(r));
}

const SUBJEKT = newRecord({
  id: "S-001", type: "subject", jurisdiction: "cz",
  title: "Jan Novák", summary: "klient",
  created: "2026-08-31", updated: "2026-08-31", truth: "klient",
  timeline: [{ date: "2026-08-31", text: "identifikace" }],
  role: "klient", person_type: "fo",
  birth_number: "750101/1234", birth_place: "Praha", sex: "muz", citizenship: "CR",
  residence: "Krátká 12, 110 00 Praha 1", id_document_type: "obcansky prukaz",
  id_document_number: "123456789", id_document_issuer: "MC Praha 1",
  id_document_valid_to: "2032-05-14",
});

const PROVERENI = newRecord({
  id: "P-001", type: "screening", jurisdiction: "cz",
  title: "Prověření klienta", summary: "AML, riziko nízké",
  created: "2026-08-31", updated: "2026-08-31", truth: "bez nálezu",
  timeline: [{ date: "2026-08-31", text: "provedeno" }],
  subject_ref: "S-001", check_date: "2026-08-31", mode: "medium",
  risk: "nizke", conclusion: "pokracovat", valid_until: "2027-08-31",
});

const ROZHODNUTI = newRecord({
  id: "R-001", type: "decision", jurisdiction: "cz",
  title: "Nepodávat námitku", summary: "zdržení převažuje",
  created: "2026-08-31", updated: "2026-08-31", truth: "nenapadáme",
  timeline: [{ date: "2026-08-31", text: "rozhodnuto" }],
  related: ["S-001"],
});

test("zlozka klienta sa najde aj o dve urovne vyssie", () => {
  const { klient, spis } = struktura();
  assert.equal(findClientDir(spis), klient);
});

test("spis bez klientskej zlozky nad sebou vrati undefined", () => {
  const root = mkdtempSync(join(tmpdir(), "okf-solo-"));
  mkdirSync(join(root, memoryDirName("cz")));
  assert.equal(findClientDir(root), undefined);
});

test("readScope zluci zaznamy spisu a klienta", () => {
  const { klient, spis } = struktura();
  put(klient, SUBJEKT);
  put(klient, PROVERENI);
  put(spis, ROZHODNUTI);
  const s = readScope(spis);
  assert.equal(s.records.length, 3);
  assert.equal(s.matter.records.length, 1);
  assert.equal(s.clientRecords.length, 2);
  assert.equal(s.clientDir, klient);
});

test("odkaz zo spisu na subjekt u klienta sa nehlasi ako rozbity", () => {
  const { klient, spis } = struktura();
  put(klient, SUBJEKT);
  put(klient, PROVERENI);
  put(spis, ROZHODNUTI);
  assert.deepEqual(validateStore(readScope(spis).records, { today: "2026-08-31" }), []);
});

test("bez klientskej urovne je odkaz na subjekt rozbity — to je spravne", () => {
  const { spis } = struktura();
  put(spis, ROZHODNUTI);
  const f = validateStore(readScope(spis).records, { today: "2026-08-31" });
  assert.ok(f.some((x) => x.code === "BROKEN_LINK"), JSON.stringify(f));
});

test("readScope funguje aj ked klient ziadnu pamat nema", () => {
  const { spis } = struktura();
  put(spis, ROZHODNUTI);
  const s = readScope(spis);
  assert.equal(s.clientRecords.length, 0);
  assert.equal(s.records.length, 1);
});
