import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readStore, MEMORY_DIR, applyRecordWrite, writeIndex, ensureBrain, syncStatus,
} from "../src/store.ts";
import { planWrite, ApprovalRequiredError } from "../src/write.ts";
import { serializeRecord, type OkfRecord } from "../src/record.ts";

function spis(j: "cz" | "sk" = "cz"): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), "# Vec — Status\n\n> **Fáze:** ruční\n");
  return dir;
}

function rec(over: Partial<OkfRecord>): OkfRecord {
  return {
    okf: 1, id: "R-001", type: "decision", title: "Rozhodnuti", summary: "s",
    layer: "L2", jurisdiction: "cz", status: "active",
    created: "2026-08-29", updated: "2026-08-29", truth: "p", timeline: [],
    ...over,
  } as OkfRecord;
}

function put(dir: string, r: OkfRecord): void {
  writeFileSync(join(dir, MEMORY_DIR, `${r.id}-x.md`), serializeRecord(r));
}

test("adresar pamate sa vola inak v CZ a SK", () => {
  assert.equal(MEMORY_DIR, MEMORY_DIR);
  assert.equal(MEMORY_DIR, MEMORY_DIR);
});

test("nacita vsetky zaznamy zo spisu", () => {
  const dir = spis();
  put(dir, rec({ id: "R-001" }));
  put(dir, rec({ id: "O-001", type: "question" }));
  const s = readStore(dir);
  assert.equal(s.records.length, 2);
  assert.equal(s.jurisdiction, "cz");
});

test("INDEX.md sa nepocita ako zaznam", () => {
  const dir = spis();
  put(dir, rec({}));
  writeFileSync(join(dir, MEMORY_DIR, "INDEX.md"), "# index\n");
  assert.equal(readStore(dir).records.length, 1);
});

test("zapis do L2 agentom prejde a subor vznikne", () => {
  const dir = spis();
  const d = planWrite(undefined, rec({}), "novy zaznam");
  applyRecordWrite(dir, d, undefined);
  assert.equal(readStore(dir).records.length, 1);
});

test("zapis do L1 bez schvalenia neprejde a na disku nic nevznikne", () => {
  const dir = spis();
  const d = planWrite(undefined, rec({ id: "P-001", type: "lesson", layer: "L1" }), "povysenie");
  assert.throws(() => applyRecordWrite(dir, d, undefined), ApprovalRequiredError);
  assert.deepEqual(readdirSync(join(dir, MEMORY_DIR)), []);
});

test("zapis do L1 so schvalenim prejde", () => {
  const dir = spis();
  const d = planWrite(undefined, rec({ id: "P-001", type: "lesson", layer: "L1" }), "povysenie");
  applyRecordWrite(dir, d, { by: "advokat", at: "2026-08-29T10:00:00Z" });
  assert.equal(readStore(dir).records.length, 1);
});

test("INDEX.md nesie riadok na kazdy zaznam s popisom", () => {
  const dir = spis();
  put(dir, rec({ id: "R-001", summary: "prvy" }));
  put(dir, rec({ id: "O-001", type: "question", summary: "druhy" }));
  writeIndex(dir);
  const idx = readFileSync(join(dir, MEMORY_DIR, "INDEX.md"), "utf8");
  assert.match(idx, /R-001/);
  assert.match(idx, /prvy/);
  assert.match(idx, /druhy/);
});

test("BRAIN.md vznikne a povie, co citat ako prve", () => {
  const dir = spis();
  ensureBrain(dir, "cz");
  const brain = readFileSync(join(dir, "BRAIN.md"), "utf8");
  assert.match(brain, /_STATUS\.md/);
  assert.match(brain, /memory\//);
});

test("BRAIN.md sa uz existujuci neprepise", () => {
  const dir = spis();
  writeFileSync(join(dir, "BRAIN.md"), "vlastny obsah advokata\n");
  ensureBrain(dir, "cz");
  assert.equal(readFileSync(join(dir, "BRAIN.md"), "utf8"), "vlastny obsah advokata\n");
});

test("syncStatus prepise len bloky a je idempotentny", () => {
  const dir = spis();
  put(dir, rec({ deadlines: ["2026-09-12"] }));
  syncStatus(dir);
  const first = readFileSync(join(dir, "_STATUS.md"), "utf8");
  assert.match(first, /2026-09-12/);
  assert.match(first, /> \*\*Fáze:\*\* ruční/);
  syncStatus(dir);
  assert.equal(readFileSync(join(dir, "_STATUS.md"), "utf8"), first);
});

test("spis bez adresara pamate sa necha nacitat ako prazdny", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-"));
  assert.deepEqual(readStore(dir).records, []);
  assert.equal(existsSync(join(dir, MEMORY_DIR)), false);
});
