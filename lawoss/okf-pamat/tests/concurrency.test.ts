import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyRecordWrite, MEMORY_DIR, ConcurrentWriteError } from "../src/store.ts";
import { parseRecord } from "../src/record.ts";
import { newRecord, planWrite } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

function spis(): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-conc-"));
  mkdirSync(join(dir, MEMORY_DIR));
  return dir;
}

function zaznam(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "D-001", type: "decision", jurisdiction: "cz",
      title: "Rozhodnutie", summary: "s", created: "2026-09-02", updated: "2026-09-02",
      truth: "pôvodná", timeline: [{ date: "2026-09-02", text: "založené" }],
    }),
    ...over,
  };
}

function zmena(z: OkfRecord, truth: string, den: string): OkfRecord {
  return { ...z, truth, updated: den, timeline: [...z.timeline, { date: den, text: truth }] };
}

test("druhy zapis z toho isteho vychodiska sa odmietne", () => {
  const dir = spis();
  const zaklad = zaznam();
  applyRecordWrite(dir, planWrite(undefined, zaklad, "založenie"), undefined);

  // Dve session vychádzajú z rovnakého stavu na disku.
  const prva = planWrite(zaklad, zmena(zaklad, "verzia A", "2026-09-03"), "A");
  const druha = planWrite(zaklad, zmena(zaklad, "verzia B", "2026-09-04"), "B");

  applyRecordWrite(dir, prva, undefined);
  assert.throws(() => applyRecordWrite(dir, druha, undefined), ConcurrentWriteError);
});

test("odmietnuty zapis obsah na disku nezmeni", () => {
  const dir = spis();
  const zaklad = zaznam();
  applyRecordWrite(dir, planWrite(undefined, zaklad, "založenie"), undefined);
  const prva = planWrite(zaklad, zmena(zaklad, "verzia A", "2026-09-03"), "A");
  const druha = planWrite(zaklad, zmena(zaklad, "verzia B", "2026-09-04"), "B");
  applyRecordWrite(dir, prva, undefined);

  const pred = readFileSync(join(dir, MEMORY_DIR, readdirSync(join(dir, MEMORY_DIR))[0]!), "utf8");
  try { applyRecordWrite(dir, druha, undefined); } catch { /* očakávané */ }
  const po = readFileSync(join(dir, MEMORY_DIR, readdirSync(join(dir, MEMORY_DIR))[0]!), "utf8");
  assert.equal(po, pred);
  assert.match(po, /verzia A/);
});

test("chyba povie, co sa medzitym stalo", () => {
  const dir = spis();
  const zaklad = zaznam();
  applyRecordWrite(dir, planWrite(undefined, zaklad, "založenie"), undefined);
  applyRecordWrite(dir, planWrite(zaklad, zmena(zaklad, "A", "2026-09-03"), "A"), undefined);
  try {
    applyRecordWrite(dir, planWrite(zaklad, zmena(zaklad, "B", "2026-09-04"), "B"), undefined);
    assert.fail("malo padnúť");
  } catch (e) {
    assert.ok(e instanceof ConcurrentWriteError);
    assert.match((e as Error).message, /2026-09-02/, "východisko");
    assert.match((e as Error).message, /2026-09-03/, "stav na disku");
  }
});

test("nadvazujuci zapis z aktualneho stavu prejde", () => {
  const dir = spis();
  const zaklad = zaznam();
  applyRecordWrite(dir, planWrite(undefined, zaklad, "založenie"), undefined);
  const poA = zmena(zaklad, "verzia A", "2026-09-03");
  applyRecordWrite(dir, planWrite(zaklad, poA, "A"), undefined);
  applyRecordWrite(dir, planWrite(poA, zmena(poA, "verzia B", "2026-09-04"), "B"), undefined);
  const ulozeny = parseRecord(readFileSync(join(dir, MEMORY_DIR, readdirSync(join(dir, MEMORY_DIR))[0]!), "utf8"));
  assert.equal(ulozeny.truth, "verzia B");
  assert.equal(ulozeny.timeline.length, 3, "história oboch zápisov musí zostať");
});

test("zalozenie noveho zaznamu kontrolu nespusti", () => {
  const dir = spis();
  assert.doesNotThrow(() => applyRecordWrite(dir, planWrite(undefined, zaznam(), "založenie"), undefined));
});
