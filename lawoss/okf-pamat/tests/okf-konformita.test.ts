/**
 * Zhoda s Open Knowledge Format v0.2.
 *
 * Bundle je `memory/`: `index.md` a `log.md` sú rezervované názvy, všetko
 * ostatné je koncept s povinným poľom `type`. `BRAIN.md` a `_STATUS.md` ležia
 * mimo bundle — sú to ľudské rozhrania spisu, nie koncepty.
 *
 * Spec: https://github.com/GoogleCloudPlatform/open-knowledge-format
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, serializeRecord } from "../src/record.ts";
import {
  newRecord, writeIndex, writeLog, readStore, MEMORY_DIR, OKF_VERSION, FIELDS, canonicalField,
} from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

function spis(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-konform-"));
  mkdirSync(join(dir, MEMORY_DIR));
  return dir;
}

function zaznam(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "D-001", type: "decision", jurisdiction: "cz",
      title: "Nenapadať príslušnosť", description: "zdržanie preváži",
      created: "2026-09-03", updated: "2026-09-03", truth: "Nenapádame.",
      timeline: [
        { date: "2026-09-01", text: "vec prevzatá", kind: "dorucenie" },
        { date: "2026-09-03", text: "rozhodnuté" },
      ],
    }),
    ...over,
  };
}

const put = (dir: string, r: OkfRecord) =>
  writeFileSync(join(dir, MEMORY_DIR, `${r.id}-x.md`), serializeRecord(r));

// --- povinné a odporúčané polia -------------------------------------------

test("type je povinne pole kazdeho konceptu", () => {
  const f = FIELDS.find((x) => x.canonical === "type");
  assert.ok(f);
  assert.equal(f.required, true, "OKF: „Every frontmatter block MUST contain a non-empty type field\"");
});

test("odporucane polia OKF su v scheme pod svojimi menami", () => {
  // `title`, `description` a `tags` sú v OKF odporúčané. Kým sme mali `summary`,
  // cudzí konzument videl koncept bez popisu.
  for (const k of ["title", "description", "tags"]) {
    assert.ok(FIELDS.some((x) => x.canonical === k), `chýba odporúčané pole ${k}`);
  }
});

test("stary kluc summary sa cita ako description", () => {
  // Spisy založené pred zladením musia ďalej fungovať.
  assert.equal(canonicalField("summary"), "description");
  const r = parseRecord(serializeRecord(zaznam()).replace("description:", "summary:"));
  assert.equal(r.description, "zdržanie preváži");
});

test("summary sa uz nezapisuje, zapisuje sa description", () => {
  const von = serializeRecord(parseRecord(serializeRecord(zaznam()).replace("description:", "summary:")));
  assert.match(von, /^description: /m);
  assert.doesNotMatch(von, /^summary: /m, "alias je iba na čítanie");
});

// --- MUST NOT reject -------------------------------------------------------

test("neznamy kluc dokument neodmietne a prezije round-trip", () => {
  // „Consumers MUST preserve unknown keys on round-trip and MUST NOT reject
  //  documents with unrecognized fields."
  const r = parseRecord(serializeRecord(zaznam()).replace(
    "status: active", "status: active\nresource: https://example.org/vec\ncustom_key: hodnota"));
  assert.deepEqual(r.extra, { resource: "https://example.org/vec", custom_key: "hodnota" });
  assert.deepEqual(parseRecord(serializeRecord(r)).extra, r.extra);
});

// --- rezervované názvy -----------------------------------------------------

test("rezervovane subory su male pismenami", () => {
  const dir = spis();
  put(dir, zaznam());
  writeIndex(dir);
  writeLog(dir);
  const subory = readdirSync(join(dir, MEMORY_DIR));
  assert.ok(subory.includes("index.md"), subory.join(", "));
  assert.ok(subory.includes("log.md"), subory.join(", "));
});

test("stary INDEX.md sa pri zapise odstrani, nie zdvoji", () => {
  // Na macOS (case-insensitive) sa `INDEX.md` musí zmazať PRED zápisom:
  // `existsSync("INDEX.md")` tam vráti true aj na práve zapísaný `index.md`
  // a zápis pod novým menom ponechá staré. Test to drží na oboch systémoch.
  const dir = spis();
  put(dir, zaznam());
  writeFileSync(join(dir, MEMORY_DIR, "INDEX.md"), "# starý rejstřík\n");
  writeIndex(dir);

  const subory = readdirSync(join(dir, MEMORY_DIR));
  assert.ok(subory.includes("index.md"));
  assert.ok(!subory.includes("INDEX.md"), `starý index zostal: ${subory.join(", ")}`);
  assert.match(readFileSync(join(dir, MEMORY_DIR, "index.md"), "utf8"), /D-001/,
    "nový obsah sa nesmie stratiť pri migrácii mena");
});

test("rezervovane subory sa necitaju ako zaznamy", () => {
  const dir = spis();
  put(dir, zaznam());
  writeIndex(dir);
  writeLog(dir);
  writeFileSync(join(dir, MEMORY_DIR, "INDEX.md"), "# starý\n");
  // readStore ich musí preskočiť — inak by padli na chýbajúcom `type`.
  const store = readStore(dir);
  assert.equal(store.records.length, 1);
  assert.deepEqual(store.problems, [], "rezervovaný súbor nie je nečitateľný záznam");
});

// --- tvar index.md ---------------------------------------------------------

test("index.md nesie okf_version a odrazkovy tvar", () => {
  const dir = spis();
  put(dir, zaznam());
  writeIndex(dir);
  const idx = readFileSync(join(dir, MEMORY_DIR, "index.md"), "utf8");

  assert.match(idx, new RegExp(`^okf_version: "${OKF_VERSION}"$`, "m"),
    "koreňový index je jediné miesto, kde smie byť frontmatter");
  assert.match(idx, /^\* \[D-001\]\(\.\/D-001-x\.md\) — /m, "OKF žiada odrážky, nie tabuľku");
  assert.doesNotMatch(idx, /^\|/m, "tabuľkový tvar sa opustil");
});

// --- tvar log.md -----------------------------------------------------------

test("log.md je zoskupeny podla ISO datumu, najnovsie hore", () => {
  const dir = spis();
  put(dir, zaznam());
  writeLog(dir);
  const log = readFileSync(join(dir, MEMORY_DIR, "log.md"), "utf8");

  const datumy = [...log.matchAll(/^## (\d{4}-\d{2}-\d{2})$/gm)].map((m) => m[1]);
  assert.deepEqual(datumy, ["2026-09-03", "2026-09-01"], "najnovšie hore");
  assert.match(log, /\* \*\*doručení\*\*: vec prevzatá/, "druh udalosti sa premietne lokalizovane");
  assert.match(log, /^\* rozhodnuté — /m, "bez druhu sa píše holý text");
  assert.match(log, /\[D-001\]\(\.\/D-001-x\.md\)/, "odkaz mieri na koncept");
});

test("log.md sa generuje z historii, nie je druhym zdrojom pravdy", () => {
  const dir = spis();
  put(dir, zaznam());
  writeLog(dir);
  const prvy = readFileSync(join(dir, MEMORY_DIR, "log.md"), "utf8");
  writeLog(dir);
  assert.equal(readFileSync(join(dir, MEMORY_DIR, "log.md"), "utf8"), prvy,
    "opakované generovanie nesmie nič meniť");
});
