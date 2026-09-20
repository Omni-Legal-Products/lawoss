/**
 * Ban-list prameňov (N4): `authority` môže niesť `status: banned | deprecated`
 * (Task 5) a `okf-memory preamble <spis>` z neho spolu s L1 pravidlami
 * a poučeniami zostaví session-preambulu (Task 6).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, findOfficeDir, MEMORY_DIR, OFFICE_DIR, CONFIG_FILE } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

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
  const root = mkdtempSync(join(tmpdir(), "okf-banlist-"));
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

const zaklad = (
  id: string,
  type: OkfRecord["type"],
  title: string,
  description: string,
) => ({
  id, type, title, description, jurisdiction: "cz" as const,
  created: D, updated: D, truth: "t",
  timeline: [{ date: D, text: "založené" }],
});

test("authority so statusom banned sa zapíše a validate nehlási UNKNOWN_VALUE", () => {
  const dir = spis();
  const p = newRecord({
    ...zaklad("A-201", "authority", "Prekonaný výklad",
      "1 VSPH 1195/2024 NECITOVAŤ ako oporu — NS otázku nevyriešil"),
    truth: "Pôvodný výklad, ktorý NS neskôr korigoval.",
    status: "banned",
    source: "1 VSPH 1195/2024", verified_via: "mcp:slv", verified_at: D,
  });
  const w = runCli(["write", dir, "--file", navrh(dir, p), "--reason", "test", "--apply"]);
  assert.equal(w.code, 0, w.out);

  const v = runCli(["validate", dir]);
  assert.equal(v.code, 0, v.out);
  assert.doesNotMatch(v.out, /UNKNOWN_VALUE/);
});
