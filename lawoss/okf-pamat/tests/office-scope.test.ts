import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readScope, findOfficeDir, OFFICE_DIR, MEMORY_DIR } from "../src/store.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

/** Koreň spisov: _kancelaria/ vedľa priečinkov klientov. */
function kancelaria(): { root: string; office: string; klient: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-office-"));
  const office = join(root, OFFICE_DIR);
  const klient = join(root, "Gh Real Estate s.r.o.");
  const spis = join(klient, "3 - Insolvence", "2026-04 vec");
  mkdirSync(join(office, MEMORY_DIR), { recursive: true });
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  writeFileSync(join(klient, "client.md"), "---\ntype: client\njurisdiction: cz\n---\n");
  return { root, office, klient, spis };
}

function put(dir: string, r: OkfRecord): void {
  writeFileSync(join(dir, MEMORY_DIR, `${r.id}.md`), serializeRecord(r));
}

const poucenie = newRecord({
  id: "L-001", type: "lesson", jurisdiction: "cz",
  title: "Příslušnost ověřovat před podáním", summary: "poučení do praxe",
  created: "2026-09-02", updated: "2026-09-02", truth: "t",
  timeline: [{ date: "2026-09-02", text: "vzniklo" }],
});

const pramen = newRecord({
  id: "A-001", type: "authority", jurisdiction: "cz",
  title: "29 NSČR 73/2024", summary: "kumulativnost § 348",
  created: "2026-09-02", updated: "2026-09-02", truth: "Podmínky jsou kumulativní.",
  timeline: [{ date: "2026-09-02", text: "ověřeno" }],
  verified_at: "2026-09-02",
});

test("zlozka kancelarie sa najde nad klientom", () => {
  const { root, office, spis } = kancelaria();
  assert.equal(findOfficeDir(spis), office);
  assert.equal(findOfficeDir(join(root, "iny klient")), office);
});

test("bez kancelarie vrati undefined", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-noof-"));
  assert.equal(findOfficeDir(dir), undefined);
});

test("readScope cita tri urovne: spis, klient, kancelaria", () => {
  const { office, klient, spis } = kancelaria();
  put(office, poucenie);
  put(klient, newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz", title: "Klient", summary: "k",
    created: "2026-09-02", updated: "2026-09-02", truth: "t",
    timeline: [{ date: "2026-09-02", text: "x" }],
  }));
  put(spis, newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz", title: "R", summary: "s",
    created: "2026-09-02", updated: "2026-09-02", truth: "t",
    timeline: [{ date: "2026-09-02", text: "x" }],
  }));
  const s = readScope(spis);
  assert.equal(s.records.length, 3);
  assert.equal(s.officeRecords.length, 1);
  assert.equal(s.clientRecords.length, 1);
  assert.equal(s.matter.records.length, 1);
  assert.equal(s.officeDir, office);
});

test("pravny pramen zije v kancelarii, nie v kazdom spise", () => {
  // Inak sa ten istý judikát skopíruje do desiatich spisov a L3_LEAK
  // sa kontroluje desaťkrát nad tým istým textom.
  const { office, spis } = kancelaria();
  put(office, pramen);
  const s = readScope(spis);
  assert.equal(s.records.filter((r) => r.layer === "L3").length, 1);
});

test("odkaz zo spisu na poucenie kancelarie nie je rozbity", () => {
  const { office, spis } = kancelaria();
  put(office, poucenie);
  put(spis, newRecord({
    id: "D-001", type: "decision", jurisdiction: "cz", title: "R", summary: "s",
    created: "2026-09-02", updated: "2026-09-02", truth: "viz [[L-001]]",
    timeline: [{ date: "2026-09-02", text: "x" }],
  }));
  assert.deepEqual(validateStore(readScope(spis).records, { today: "2026-09-02" }), []);
});

test("kancelaria sa nepovazuje za spis", () => {
  const { office } = kancelaria();
  const s = readScope(office);
  assert.equal(s.officeDir, undefined, "kancelária nie je sama sebe nadradenou úrovňou");
  assert.equal(s.clientDir, undefined);
});

test("spis bez kancelarie funguje ako doteraz", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-solo-"));
  mkdirSync(join(dir, MEMORY_DIR));
  const s = readScope(dir);
  assert.deepEqual(s.officeRecords, []);
  assert.equal(s.officeDir, undefined);
});
