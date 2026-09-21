/**
 * L3 bez pramena sa nezapisuje (N5).
 *
 * `authority` musí niesť `source` (ECLI / § citácia so znením k dátumu),
 * `verified_via` (konektor, ktorým sa overilo) a `verified_at` (kedy).
 * Bez toho je „prameň" iba navigačný nález — a ten sa do zdieľateľnej
 * vrstvy L3 nezapisuje, kým sa nedoverí v primárnom prameni.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseRecord, serializeRecord } from "../src/record.ts";
import { runCli } from "../src/cli.ts";
import { newRecord, findOfficeDir, MEMORY_DIR, OFFICE_DIR, CONFIG_FILE } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const AUTHORITY = `---
okf: 1
id: A-001
type: authority
title: Posun ulozni doby
description: 4 Afs 264/2018 bod 86 — ulozna doba konci podla pravidiel pre lehoty
layer: L3
jurisdiction: cz
status: active
created: 2026-09-19
updated: 2026-09-19
source: "ECLI:CZ:NSS:2022:4.Afs.264.2018.85, bod [86]"
verified_via: "mcp:slv"
verified_at: 2026-09-19
---

## Truth

Ulozna doba podla § 49 ods. 4 o. s. r. konci podla pravidiel pre lehoty.

## History

- 2026-09-19 — overene v plnom zneni rozhodnutia
`;

test("authority round-trip zachová prameň", () => {
  const r = parseRecord(AUTHORITY);
  assert.ok(String((r as unknown as Record<string, unknown>).source).includes("ECLI"));
  assert.match(serializeRecord(r), /verified_via: "?mcp:slv"?/);
});

// --- brána zápisu (Task 4) -------------------------------------------------

const POVERENIE = [
  "standing_authorization: JUDr. Vojtěch Říha, Ph.D.",
  "granted_at: 2026-09-19",
  "expires_at: 2026-12-31",
  "scope: [L1, L3]",
  "reason: agentné vedenie spisov",
].join("\n") + "\n";

const D = "2026-09-19";

/** Kancelária s poverením a jeden prázdny spis — vzor z tests/desat-pripadov.test.ts. */
function spis(): string {
  const root = mkdtempSync(join(tmpdir(), "okf-l3-source-"));
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, OFFICE_DIR, CONFIG_FILE), POVERENIE);
  const klient = join(root, "Testovací klient");
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  writeFileSync(join(klient, "klient.md"), "---\ntype: klient\n---\n");
  const vec = join(klient, "3 - Soudni", "2026-09 vec");
  mkdirSync(join(vec, MEMORY_DIR), { recursive: true });
  return vec;
}

function navrh(dir: string, r: OkfRecord): string {
  const path = join(dir, `navrh-${r.id}.md`);
  writeFileSync(path, serializeRecord(r));
  return path;
}

test("authority bez source se nezapíše", () => {
  const dir = spis();
  const p = newRecord({
    id: "A-101", type: "authority", jurisdiction: "cz",
    title: "Prameň bez zdroja", description: "chýba source aj verified_via",
    created: D, updated: D, truth: "Čistá právna veta bez identifikátorov.",
    timeline: [{ date: D, text: "založené" }],
    verified_at: D,
  });
  const r = runCli(["write", dir, "--file", navrh(dir, p), "--reason", "test", "--apply"]);
  assert.notEqual(r.code, 0, r.out);
  assert.match(r.out, /L3_SOURCE_MISSING/);
  const office = findOfficeDir(dir);
  assert.ok(office, "kancelária musí existovať");
  assert.equal(readdirSync(join(office, MEMORY_DIR)).length, 0, "na disku nesmie nič pribudnúť");
});

test("authority se source projde a validate mlčí", () => {
  const dir = spis();
  const p = newRecord({
    id: "A-102", type: "authority", jurisdiction: "cz",
    title: "Overený prameň", description: "source aj verified_via sú vyplnené",
    created: D, updated: D, truth: "Čistá právna veta bez identifikátorov.",
    timeline: [{ date: D, text: "založené" }],
    source: "§ 49 ods. 4 zák. č. 99/1963 Sb.",
    verified_via: "mcp:slv",
    verified_at: D,
  });
  const w = runCli(["write", dir, "--file", navrh(dir, p), "--reason", "test", "--apply"]);
  assert.equal(w.code, 0, w.out);
  const v = runCli(["validate", dir]);
  assert.equal(v.code, 0, v.out);
});

test("subjekt bez source je warning, ne error", () => {
  const dir = spis();
  const s = newRecord({
    id: "S-101", type: "subject", jurisdiction: "cz",
    title: "Protistrana bez zdroja", description: "subjekt bez poľa source",
    created: D, updated: D, truth: "t",
    timeline: [{ date: D, text: "založené" }],
    role: "counterparty",
  });
  const w = runCli(["write", dir, "--file", navrh(dir, s), "--reason", "test", "--apply"]);
  assert.equal(w.code, 0, w.out);
  const v = runCli(["validate", dir]);
  assert.equal(v.code, 0, v.out);
  assert.match(v.out, /SUBJECT_SOURCE_MISSING/);
});

for (const field of ["source", "verified_via", "verified_at"] as const) {
  test(`dry-run odmietne authority bez ${field} aj so schválením`, () => {
    const dir = spis();
    const proposal = { ...parseRecord(AUTHORITY), [field]: undefined };
    const file = navrh(dir, proposal);
    const result = runCli(["write", dir, "--file", file, "--reason", "kontrola", "--approve-as", "Tester"]);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /L3_SOURCE_MISSING/);
    assert.ok(result.out.includes(field));
    assert.equal(readdirSync(join(findOfficeDir(dir)!, MEMORY_DIR)).length, 0);
  });
}
