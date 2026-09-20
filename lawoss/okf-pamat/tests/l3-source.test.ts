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
import { parseRecord, serializeRecord } from "../src/record.ts";

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
