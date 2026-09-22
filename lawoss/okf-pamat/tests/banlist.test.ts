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

// --- composePreamble + CLI `preamble` (Task 6) -----------------------------

test("preamble vypíše pravidlá, poučenia a ban-list; L2 obsah nie", () => {
  const dir = spis();

  const pravidlo = newRecord({
    ...zaklad("R-001", "rule", "Termíny vždy s rezervou",
      "kancelária počíta interný termín o deň skôr, než beží procesná lehota"),
    truth: "Interné termíny sa nastavujú deň pred procesnou lehotou.",
  });
  const poucenie = newRecord({
    ...zaklad("L-001", "lesson", "Doručenku sťahovať hneď", "prílohy z DS expirujú"),
    truth: "Prílohy z dátovej schránky sťahovať do spisu ihneď po prijatí.",
  });
  const vec = newRecord(
    zaklad("M-001", "matter", "Stav veci", "prehľad skutkového stavu veci"),
  );
  const pramen = newRecord({
    ...zaklad("A-301", "authority", "Prekonaný výklad prihlasovacej lehoty",
      "1 VSPH 1195/2024 NECITOVAŤ ako oporu — NS otázku nevyriešil"),
    truth: "Pôvodný výklad, ktorý NS neskôr korigoval.",
    status: "banned",
    source: "1 VSPH 1195/2024", verified_via: "mcp:slv", verified_at: D,
  });

  for (const r of [pravidlo, poucenie, vec, pramen]) {
    const res = runCli(["write", dir, "--file", navrh(dir, r), "--reason", "test", "--apply"]);
    assert.equal(res.code, 0, res.out);
  }

  const p = runCli(["preamble", dir]);
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /Termíny vždy s rezervou/);
  assert.match(p.out, /Doručenku sťahovať hneď/);
  assert.match(p.out, /Necitovať/);
  assert.match(p.out, /Prekonaný výklad prihlasovacej lehoty/);
  assert.doesNotMatch(p.out, /Stav veci/);
});

test("preamble hlási rozbitý súbor rovnako ako read — ban-list nesmie zmiznúť potichu", () => {
  const dir = spis();
  // Rovnaká vada ako v tests/parse-errors.test.ts — chýbajúce povinné polia
  // (created/updated/description) zhodia parseRecord, čítanie ostatných
  // súborov to nesmie zastaviť.
  writeFileSync(
    join(dir, MEMORY_DIR, "A-901-rozbity.md"),
    "---\nokf: 1\nid: A-901\ntype: authority\ntitle: Rozbitý\njurisdiction: cz\nstatus: banned\n---\n\n## Truth\nx\n",
  );

  const p = runCli(["preamble", dir]);
  assert.equal(p.code, 1, p.out);
  assert.match(p.out, /NEÚPLNÉ ČÍTANIE/);
  assert.match(p.out, /ERROR PARSE_ERROR/);
  assert.match(p.out, /A-901-rozbity\.md/);
});

test("preamble prazdnej pamate bez problemov je prazdny retazec", () => {
  const dir = spis();
  const p = runCli(["preamble", dir]);
  assert.equal(p.code, 0, p.out);
  assert.equal(p.out, "");
});


test("ban-list rozlišuje banned/deprecated od superseded/void a číta celý rozsah", () => {
  const dir = spis();
  const office = findOfficeDir(dir)!;
  const locations = [dir, join(dir, "..", ".."), office];
  for (const [index, status] of (["banned", "deprecated", "superseded", "void"] as const).entries()) {
    const record = newRecord({ ...zaklad(`A-${index + 400}`, "authority", `Prameň ${status}`, "Dôvod vylúčenia"), status });
    writeFileSync(join(locations[index % locations.length]!, MEMORY_DIR, `${record.id}.md`), serializeRecord(record));
  }
  const p = runCli(["preamble", dir]);
  assert.equal(p.code, 0, p.out);
  assert.match(p.out, /Prameň banned/);
  assert.match(p.out, /Prameň deprecated/);
  assert.doesNotMatch(p.out, /Prameň superseded|Prameň void/);
});
