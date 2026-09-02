import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, MEMORY_DIR } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const RC = "750101/1234";
const DOKLAD = "123456789";

function put(dir: string, r: OkfRecord): void {
  writeFileSync(join(dir, MEMORY_DIR, `${r.id}-x.md`), serializeRecord(r));
}

function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "S-001", type: "subject", jurisdiction: "cz",
      title: "Jan Novák", description: "klient",
      created: "2026-08-31", updated: "2026-08-31", truth: "klient",
      timeline: [{ date: "2026-08-31", text: "identifikace" }],
      role: "client", person_type: "natural_person",
      birth_number: RC, birth_place: "Praha", sex: "muz", citizenship: "CR",
      residence: "Krátká 12, 110 00 Praha 1", id_document_type: "obcansky prukaz",
      id_document_number: DOKLAD, id_document_issuer: "MC Praha 1",
      id_document_valid_to: "2032-05-14",
    }),
    ...over,
  };
}

function provereni(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "P-001", type: "screening", jurisdiction: "cz",
      title: "Prověření klienta", description: "AML, riziko nízké",
      created: "2026-08-31", updated: "2026-08-31", truth: "bez nálezu",
      timeline: [{ date: "2026-08-31", text: "provedeno" }],
      subject_ref: "S-001", check_date: "2026-08-31", mode: "medium",
      risk: "nizke", conclusion: "pokracovat", valid_until: "2027-08-31",
    }),
    ...over,
  };
}

function struktura(opts: { provereni?: OkfRecord | null } = {}): string {
  const root = mkdtempSync(join(tmpdir(), "okf-cliaml-"));
  const klient = join(root, "Novák Jan");
  const spis = join(klient, "3 - Soudni", "2026-08 vec");
  mkdirSync(spis, { recursive: true });
  writeFileSync(join(klient, "klient.md"), "---\ntype: klient\n---\n");
  mkdirSync(join(klient, MEMORY_DIR));
  mkdirSync(join(spis, MEMORY_DIR));
  writeFileSync(join(spis, "_STATUS.md"), "# Status\n");
  put(klient, subjekt());
  const p = opts.provereni === undefined ? provereni() : opts.provereni;
  if (p) put(klient, p);
  return spis;
}

test("aml vypise subjekt a stav proverenia", () => {
  const r = runCli(["aml", struktura()]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /S-001/);
  assert.match(r.out, /Jan Novák/);
  assert.match(r.out, /P-001/);
  assert.match(r.out, /2027-08-31/);
});

test("rodne cislo ani cislo dokladu sa vo vypise NIKDY neobjavi cele", () => {
  const out = runCli(["aml", struktura()]).out;
  assert.ok(!out.includes(RC), "rodné číslo uniklo do výpisu");
  assert.ok(!out.includes(DOKLAD), "číslo dokladu uniklo do výpisu");
  assert.match(out, /750101\/••••/);
});

test("read maskuje citlive udaje rovnako", () => {
  const out = runCli(["read", struktura()]).out;
  assert.ok(!out.includes(RC), "rodné číslo uniklo do výpisu read");
});

test("aml oznami chybajuce provereni", () => {
  const r = runCli(["aml", struktura({ provereni: null })]);
  assert.match(r.out, /AML_MISSING|bez preverenia|chýba/i, r.out);
});

test("aml oznami prosle provereni aj s datumom", () => {
  const r = runCli(["aml", struktura({ provereni: provereni({ valid_until: "2026-01-01" }) })]);
  assert.match(r.out, /2026-01-01/);
  assert.match(r.out, /po lehote|AML_EXPIRED|prošl/i, r.out);
});

test("validate vidi subjekt na klientskej urovni", () => {
  const r = runCli(["validate", struktura()]);
  assert.equal(r.code, 0, r.out);
});

test("aml na spise bez subjektov to povie a neskonci chybou", () => {
  const root = mkdtempSync(join(tmpdir(), "okf-empty-"));
  mkdirSync(join(root, MEMORY_DIR));
  const r = runCli(["aml", root]);
  assert.equal(r.code, 0);
  assert.match(r.out, /žiadne|nie sú|0/i);
});
