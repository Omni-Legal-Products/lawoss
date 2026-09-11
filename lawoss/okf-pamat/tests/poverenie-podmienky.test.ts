/**
 * Podmienky trvalého poverenia a brána úniku — z rozhodovacieho podkladu MČ
 * (G1, G2) po calle 7. 9. 2026.
 *
 * G1: dátum sa porovnával ako text (31.12.2026 by nikdy nevypršalo), knižnica
 * dostávala poverenie automaticky, agent si ho mohol napísať sám.
 * G2: nečitateľný subjekt vypadol z jehiel a brána ticho oslepla.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import {
  newRecord, validateStore, applyRecordWrite, planWrite, STANDING,
  readStandingAuthorization, inspectStandingAuthorization, isIsoDate, readNameLeakSeverity,
  ApprovalRequiredError, LeakBlockedError, MEMORY_DIR, OFFICE_DIR, CONFIG_FILE,
} from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const D = { today: "2026-09-11" };
const T = "2026-09-11";
const rec = (id: string, type: OkfRecord["type"], title: string, over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id, type, jurisdiction: "cz", title, description: "d", created: T, updated: T, truth: "t",
    timeline: [{ date: T, text: "z" }] }), ...over });

const PLATNE = "client_path: AK/*/*\nstanding_authorization: JUDr. Vojtěch Říha\ngranted_at: 2026-09-01\nexpires_at: 2026-12-31\nscope: [L1, L3]\nreason: test\n";

function kancelaria(config: string): { root: string; office: string; klient: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-g1g2-"));
  const office = join(root, OFFICE_DIR);
  mkdirSync(join(office, MEMORY_DIR), { recursive: true });
  writeFileSync(join(office, CONFIG_FILE), config);
  const klient = join(root, "AK", "N", "Novák Jan");
  const spis = join(klient, "2026 vec");
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  return { root, office, klient, spis };
}
function navrh(dir: string, r: OkfRecord): string {
  const f = join(dir, `navrh-${r.id}.md`); writeFileSync(f, serializeRecord(r)); return f;
}
const SCHVALENIE = { by: "JUDr. Vojtěch Říha", at: "2026-09-11T10:00:00Z" };

// --- G1.1 dátum musí byť dátum ---------------------------------------------

test("isIsoDate: RRRR-MM-DD a skutocny den", () => {
  assert.ok(isIsoDate("2026-12-31"));
  assert.ok(!isIsoDate("31.12.2026"));
  assert.ok(!isIsoDate("2026-02-30"));
  assert.ok(!isIsoDate("2026-13-01"));
  assert.ok(!isIsoDate("2026-9-1"));
});

test("expires_at v ceskom zapise nie je poverenie — a validate povie preco", () => {
  const { office, spis } = kancelaria(PLATNE.replace("expires_at: 2026-12-31", "expires_at: 31.12.2026"));
  assert.equal(readStandingAuthorization(office), undefined, "textové porovnanie by nikdy nevypršalo");
  assert.match(inspectStandingAuthorization(office).problem ?? "", /expires_at/);
  const r = runCli(["write", spis, "--file", navrh(spis, rec("L-001", "lesson", "Poučenie")), "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(runCli(["validate", spis]).out, /STANDING_AUTH_INVALID.*expires_at/);
});

test("neexistujuci den a granted_at po expires_at poverenie zneplatnia", () => {
  const a = kancelaria(PLATNE.replace("2026-12-31", "2026-02-30"));
  assert.match(inspectStandingAuthorization(a.office).problem ?? "", /2026-02-30/);
  const b = kancelaria(PLATNE.replace("granted_at: 2026-09-01", "granted_at: 2027-01-01"));
  assert.match(inspectStandingAuthorization(b.office).problem ?? "", /granted_at/);
});

test("platne poverenie ziadny nalez nedava", () => {
  const { spis } = kancelaria(PLATNE);
  assert.doesNotMatch(runCli(["validate", spis]).out, /STANDING_AUTH/);
});

test("bez konfigu poverenia nie je co hlasit", () => {
  const { spis } = kancelaria("client_path: AK/*/*\n");
  assert.doesNotMatch(runCli(["validate", spis]).out, /STANDING_AUTH/);
});

// --- G1.2 knižnica si musí o poverenie povedať ------------------------------

test("kniznicne volanie bez vyslovnej ziadosti poverenie nedostane", () => {
  const { spis } = kancelaria(PLATNE);
  const diff = planWrite(undefined, rec("L-001", "lesson", "Poučenie"), "x");
  assert.throws(() => applyRecordWrite(spis, diff, undefined), ApprovalRequiredError,
    'undefined znamená bez schválenia, nie „skús poverenie“');
  assert.equal(readdirSync(join(spis, MEMORY_DIR)).length, 0);
});

test("so STANDING kniznica pod poverenim zapise", () => {
  const { spis } = kancelaria(PLATNE);
  const diff = planWrite(undefined, rec("L-001", "lesson", "Poučenie"), "x");
  assert.doesNotThrow(() => applyRecordWrite(spis, diff, STANDING));
  assert.equal(readdirSync(join(spis, MEMORY_DIR)).filter((f) => f.startsWith("L-001")).length, 1);
});

test("STANDING bez platneho poverenia zostava odmietnute", () => {
  const { spis } = kancelaria(PLATNE.replace("2026-12-31", "2026-01-01"));
  const diff = planWrite(undefined, rec("L-001", "lesson", "Poučenie"), "x");
  assert.throws(() => applyRecordWrite(spis, diff, STANDING), ApprovalRequiredError);
});

// --- G2.1 nečitateľný subjekt oslepuje bránu → zápis do L3 sa odmietne -----

test("necitatelny zaznam v dosahu blokuje zapis do L3", () => {
  const { klient, spis } = kancelaria(PLATNE);
  writeFileSync(join(klient, MEMORY_DIR, "S-001-x.md"), "---\nokf: 1\nid: S-001\ntype: subject\ntitle: Firma\ndescription: d\nlayer: L2\njurisdiction: cz\nstatus: active\ncreated: 2026-09-11\nupdated: 2026-09-11\nregistry_id: 04920040\naliases:\n  - Firma\n  - meta:\n      deep: x\n---\n\n## Truth\nt\n\n## History\n- 2026-09-11 — z\n");
  const pramen = rec("A-001", "authority", "Veta", { truth: "Všeobecná právna veta bez identifikátorov." });
  assert.throws(
    () => applyRecordWrite(spis, planWrite(undefined, pramen, "x"), SCHVALENIE),
    (e: unknown) => e instanceof LeakBlockedError && /S-001-x\.md/.test(String(e)),
    "aj čistý prameň sa odmietne — brána nevie, čo v nečitateľnom subjekte je",
  );
});

test("necitatelny zaznam zapis do L2 nezdrzuje", () => {
  const { klient, spis } = kancelaria(PLATNE);
  writeFileSync(join(klient, MEMORY_DIR, "S-001-x.md"), "toto nie je záznam\n");
  const d = rec("D-001", "decision", "Rozhodnutie");
  assert.doesNotThrow(() => applyRecordWrite(spis, planWrite(undefined, d, "x"), undefined));
});

// --- G2.2 politika mena: len meno, len s dôvodom, identifikátory nikdy -----

test("leak_name_severity warning s dovodom znizi zhodu mena na varovanie", () => {
  const { office } = kancelaria(PLATNE + "leak_name_severity: warning\nleak_name_reason: judikáty o vlastných klientoch citujeme menom\n");
  assert.equal(readNameLeakSeverity(office), "warning");
  const s = rec("S-001", "subject", "Kolář a Klaudy v.o.s.");
  const a = rec("A-001", "authority", "Veta", { truth: "Správcom bola Kolář a Klaudy v.o.s." });
  const f = validateStore([s, a], { ...D, nameLeakSeverity: "warning" });
  assert.ok(f.some((x) => x.code === "L3_LEAK_NAME" && x.severity === "warning"));
  assert.ok(!f.some((x) => x.code === "L3_LEAK"));
});

test("bez dovodu sa politika ignoruje", () => {
  const { office } = kancelaria(PLATNE + "leak_name_severity: warning\n");
  assert.equal(readNameLeakSeverity(office), "error");
});

test("identifikatory sa politikou nezmakcia", () => {
  const s = rec("S-001", "subject", "Firma", { registry_id: "04920040" });
  const a = rec("A-001", "authority", "Veta", { truth: "Vo veci IČO 04920040." });
  const f = validateStore([s, a], { ...D, nameLeakSeverity: "warning" });
  assert.ok(f.some((x) => x.code === "L3_LEAK" && x.severity === "error"), "IČO je únik, nie prah");
});

test("brana zapisu politiku mena respektuje, identifikator nie", () => {
  const { klient, spis } = kancelaria(PLATNE + "leak_name_severity: warning\nleak_name_reason: citujeme menom\n");
  writeFileSync(join(klient, MEMORY_DIR, "S-001-x.md"), serializeRecord(rec("S-001", "subject", "Kolář a Klaudy v.o.s.", { registry_id: "04920040" })));
  const menom = rec("A-001", "authority", "Veta", { truth: "Správcom bola Kolář a Klaudy v.o.s." });
  assert.doesNotThrow(() => applyRecordWrite(spis, planWrite(undefined, menom, "x"), SCHVALENIE));
  const icom = rec("A-002", "authority", "Veta", { truth: "Vo veci IČO 04920040." });
  assert.throws(() => applyRecordWrite(spis, planWrite(undefined, icom, "x"), SCHVALENIE), LeakBlockedError);
});
