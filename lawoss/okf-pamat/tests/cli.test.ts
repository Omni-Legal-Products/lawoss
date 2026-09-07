import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, MEMORY_DIR } from "../src/index.ts";

function spis(withLeak = false): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-cli-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), "# Status\n\n> **Fáze:** ruční\n");
  const s = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz", title: "Modrý Kámen s.r.o.",
    description: "protistrana", registry_id: "12345678",
    created: "2026-08-29", updated: "2026-08-29", truth: "t",
    timeline: [{ date: "2026-08-29", text: "overene" }],
  });
  writeFileSync(join(dir, MEMORY_DIR, "S-001-x.md"), serializeRecord(s));
  if (withLeak) {
    const j = newRecord({
      id: "J-001", type: "authority", jurisdiction: "cz", title: "Pramen", description: "p",
      created: "2026-08-29", updated: "2026-08-29", truth: "tykalo sa ICO 12345678",
      timeline: [{ date: "2026-08-29", text: "z" }],
    });
    writeFileSync(join(dir, MEMORY_DIR, "J-001-x.md"), serializeRecord(j));
  }
  return dir;
}

test("validate ciste pamate konci nulou", () => {
  const r = runCli(["validate", spis()]);
  assert.equal(r.code, 0, r.out);
});

test("validate uniku do L3 konci chybou a pomenuje ju", () => {
  const r = runCli(["validate", spis(true)]);
  assert.equal(r.code, 1);
  assert.match(r.out, /L3_LEAK/);
});

test("sync je bez --apply iba nahlad a subor nemeni", () => {
  const dir = spis();
  const pred = readFileSync(join(dir, "_STATUS.md"), "utf8");
  const r = runCli(["sync", dir]);
  assert.equal(r.code, 0);
  assert.match(r.out, /dry-run/i);
  assert.equal(readFileSync(join(dir, "_STATUS.md"), "utf8"), pred);
});

test("sync --apply subor prepise", () => {
  const dir = spis();
  const pred = readFileSync(join(dir, "_STATUS.md"), "utf8");
  const r = runCli(["sync", dir, "--apply"]);
  assert.equal(r.code, 0);
  assert.notEqual(readFileSync(join(dir, "_STATUS.md"), "utf8"), pred);
});

test("read vypise zaznamy", () => {
  const r = runCli(["read", spis()]);
  assert.equal(r.code, 0);
  assert.match(r.out, /S-001/);
});

test("neznamy prikaz konci kodom 2 a napovedou", () => {
  const r = runCli(["vymyslene", "/tmp"]);
  assert.equal(r.code, 2);
  assert.match(r.out, /okf-memory/);
});

test("chybajuca cesta konci kodom 2", () => {
  const r = runCli(["validate"]);
  assert.equal(r.code, 2);
});

test("pocet zaznamov sa sklonuje spravne", () => {
  const dir = spis();
  const jeden = runCli(["sync", dir]);
  assert.match(jeden.out, /1 riadok/, jeden.out);
  const dva = runCli(["sync", spis(true)]);
  assert.match(dva.out, /2 riadky/, dva.out);
});
