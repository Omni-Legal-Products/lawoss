import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, serializeRecord, HEADINGS } from "../src/record.ts";
import {
  FIELDS, fieldLabel, canonicalField, STATUS, PERSON_KINDS, ROLES, RISK, CONCLUSION,
} from "../src/schema.ts";
import { MEMORY_DIR, readStore } from "../src/store.ts";
import { newRecord, renderStatus, validateStore } from "../src/index.ts";

/** Kanonický tvar záznamu na disku — jeden pre obe jurisdikcie. */
const ZAZNAM = `---
okf: 1
id: D-001
type: decision
title: Nenapadat prislusnost
summary: zdrzanie prevazuje nad vyhodou
layer: L2
jurisdiction: sk
status: active
created: 2026-09-01
updated: 2026-09-01
deadlines: ["2026-09-12"]
---

## Truth

Miestnu prislusnost nenapadame.

## History

- 2026-09-01 — rozhodnute po porade s klientom
`;

// --- kľúče a sekcie sú kanonické, nie jurisdikčné ---

test("zaznam sa cita z kanonickych klucov", () => {
  const r = parseRecord(ZAZNAM);
  assert.equal(r.id, "D-001");
  assert.equal(r.type, "decision");
  assert.equal(r.jurisdiction, "sk");
  assert.equal(r.status, "active");
  assert.deepEqual(r.deadlines, ["2026-09-12"]);
});

test("slovensky zaznam sa serializuje do rovnakych klucov ako cesky", () => {
  const sk = serializeRecord(parseRecord(ZAZNAM));
  const cz = serializeRecord(parseRecord(ZAZNAM.replace("jurisdiction: sk", "jurisdiction: cz")));
  const klice = (s: string) => s.split("\n").filter((l) => /^[a-z_]+:/.test(l)).map((l) => l.split(":")[0]);
  assert.deepEqual(klice(sk), klice(cz), "kľúče nesmú závisieť od jurisdikcie");
  assert.match(sk, /^deadlines:/m);
  assert.doesNotMatch(sk, /^lehoty:|^lhuty:/m);
});

test("sekcie zaznamu su anglicke pre obe jurisdikcie", () => {
  assert.equal(HEADINGS.truth, "Truth");
  assert.equal(HEADINGS.timeline, "History");
  assert.match(serializeRecord(parseRecord(ZAZNAM)), /^## Truth$/m);
  assert.match(serializeRecord(parseRecord(ZAZNAM)), /^## History$/m);
});

test("typ zaznamu je kanonicky, nie prelozeny", () => {
  assert.match(serializeRecord(parseRecord(ZAZNAM)), /^type: decision$/m);
});

test("jurisdikcia sa cita z pola, nie z pritomnosti kluca", () => {
  const bez = ZAZNAM.replace("jurisdiction: sk\n", "");
  assert.throws(() => parseRecord(bez), /jurisdiction/i);
});

// --- mapovacia tabuľka prežíva ako i18n vrstva pre výstup ---

test("mapovacia tabulka je uz len popiskom pre cloveka", () => {
  assert.equal(fieldLabel("deadlines", "cz"), "lhůty");
  assert.equal(fieldLabel("deadlines", "sk"), "lehoty");
  assert.equal(fieldLabel("birth_place", "cz"), "místo narození");
  assert.equal(fieldLabel("birth_place", "sk"), "miesto narodenia");
});

test("kazde pole ma popisok pre obe jurisdikcie", () => {
  for (const f of FIELDS) {
    assert.ok(f.cz && f.sk, `pole ${f.canonical} nemá popisok`);
  }
});

test("canonicalField uz kluce neprekklada — kanonicky kluc je kanonicky", () => {
  assert.equal(canonicalField("deadlines"), "deadlines");
  assert.equal(canonicalField("lehoty"), undefined, "lokalizovaný kľúč už kľúčom nie je");
});

// --- hodnoty enumov ---

test("hodnoty enumov su anglicke a vymenovane", () => {
  assert.deepEqual([...STATUS], ["active", "superseded", "void"]);
  assert.deepEqual([...PERSON_KINDS], ["natural_person", "legal_person", "sole_trader"]);
  assert.deepEqual([...ROLES], ["client", "counterparty", "representative", "ubo"]);
  assert.deepEqual([...RISK], ["low", "medium", "high"]);
  assert.deepEqual([...CONCLUSION], ["proceed", "enhanced_diligence", "decline"]);
});

test("novy zaznam ma stav active, nie platny", () => {
  const r = newRecord({
    id: "D-002", type: "decision", jurisdiction: "cz", title: "X", summary: "y",
    created: "2026-09-01", updated: "2026-09-01", truth: "t", timeline: [],
  });
  assert.equal(r.status, "active");
});

// --- jeden adresár pamäte ---

test("adresar pamate je jeden pre obe jurisdikcie", () => {
  assert.equal(MEMORY_DIR, "memory");
});

test("readStore najde pamat bez ohladu na jurisdikciu zaznamov", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-en-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, MEMORY_DIR, "D-001.md"), ZAZNAM);
  const s = readStore(dir);
  assert.equal(s.records.length, 1);
  assert.equal(s.jurisdiction, "sk", "jurisdikcia sa berie zo záznamu, nie z názvu adresára");
});

test("cesky a slovensky zaznam mozu lezat vedla seba", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-mix-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, MEMORY_DIR, "D-001.md"), ZAZNAM);
  writeFileSync(
    join(dir, MEMORY_DIR, "D-002.md"),
    ZAZNAM.replace("id: D-001", "id: D-002").replace("jurisdiction: sk", "jurisdiction: cz"),
  );
  assert.equal(readStore(dir).records.length, 2,
    "spis prenesený medzi jurisdikciami sa nesmie rozpadnúť");
});

// --- výstup pre človeka zostáva lokalizovaný ---

test("renderovane tabulky zostavaju v jazyku pouzivatela", () => {
  const r = parseRecord(ZAZNAM);
  const sk = renderStatus("# Status\n", [r], "sk");
  const cz = renderStatus("# Status\n", [r], "cz");
  assert.match(sk, /^## Lehoty$/m);
  assert.match(cz, /^## Lhůty$/m);
  assert.match(sk, /\| Dátum \|/);
  assert.match(cz, /\| Datum \|/);
});

test("markery zostavaju kanonicke", () => {
  assert.match(renderStatus("# Status\n", [parseRecord(ZAZNAM)], "sk"), /okf:render:deadlines:start/);
});

test("hlasky validacie pouzivaju lokalizovany popisok pola", () => {
  const subjekt = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz", title: "Jan Novák",
    summary: "klient", created: "2026-09-01", updated: "2026-09-01",
    truth: "t", timeline: [{ date: "2026-09-01", text: "x" }],
    role: "client", person_type: "natural_person",
  });
  const f = validateStore([subjekt], { today: "2026-09-01" })
    .find((x) => x.code === "AML_INCOMPLETE");
  assert.ok(f, "neúplná identifikácia má byť nález");
  assert.match(f.message, /místo narození/, "popisok patrí do hlášky, kľúč do súboru");
});
