/**
 * Trvalé poverenie — advokát vypína potvrdzovanie jednotlivých zápisov.
 *
 * Testy držia hlavne to, čo poverenie **nesmie** vypnúť: mazanie, únik
 * klientskych údajov do L3 a atomicitu Pravdy s Históriou. Poverenie je
 * schválenie udelené vopred, nie vypnutá brána.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord, parseRecord } from "../src/record.ts";
import {
  newRecord, planWrite, applyRecordWrite, standingApproval, readStandingAuthorization,
  MEMORY_DIR, OFFICE_DIR, CONFIG_FILE, LeakBlockedError, ApprovalRequiredError,
} from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const PLATNE = [
  "standing_authorization: JUDr. Vojtěch Říha, Ph.D.",
  "granted_at: 2026-09-02",
  "expires_at: 2026-12-31",
  "scope: [L1, L3]",
  "reason: agentné vedenie spisov v rozsahu odsúhlasenom na porade 2. 9. 2026",
].join("\n") + "\n";

/** Kancelária → klient → spis. Poverenie žije v kancelárii, zápis v spise. */
function kancelaria(config?: string): { root: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-poverenie-"));
  const spis = join(root, "Novák Jan", "3 - Soudni", "2026-09 vec");
  mkdirSync(join(spis, MEMORY_DIR), { recursive: true });
  mkdirSync(join(root, "Novák Jan", MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, "Novák Jan", "klient.md"), "---\ntype: klient\n---\n");
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  if (config !== undefined) writeFileSync(join(root, OFFICE_DIR, CONFIG_FILE), config);
  writeFileSync(join(spis, "_STATUS.md"), "# Status\n");
  return { root, spis };
}

function poucenie(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "L-001", type: "lesson", jurisdiction: "cz",
      title: "Príslušnosť overovať pred podaním", description: "poučenie do praxe",
      created: "2026-09-02", updated: "2026-09-02", truth: "Overiť sídlo pred podaním.",
      timeline: [{ date: "2026-09-02", text: "vzniklo z veci" }],
    }),
    ...over,
  };
}

function navrh(dir: string, r: OkfRecord): string {
  const path = join(dir, "navrh.md");
  writeFileSync(path, serializeRecord(r));
  return path;
}

const pocet = (dir: string) =>
  readdirSync(join(dir, MEMORY_DIR)).filter((f) => f.endsWith(".md")).length;

// --- bez poverenia brána drží ---------------------------------------------

test("bez konfigu zostava brana zapnuta", () => {
  const { spis } = kancelaria();
  const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /--approve-as/);
  assert.equal(pocet(spis), 0);
});

test("neuplne poverenie nie je poverenie", () => {
  for (const chyba of ["standing_authorization", "expires_at", "reason", "scope"]) {
    const config = PLATNE.split("\n").filter((l) => !l.startsWith(`${chyba}:`)).join("\n");
    const { root, spis } = kancelaria(config);
    assert.equal(
      readStandingAuthorization(join(root, OFFICE_DIR)), undefined,
      `bez ${chyba} sa poverenie nesmie uznať`,
    );
    const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "x", "--apply"]);
    assert.equal(r.code, 1, `${chyba}: ${r.out}`);
  }
});

// --- s platným poverením zápis prejde --------------------------------------

test("platne poverenie pusti zapis do L1 bez --approve-as", () => {
  const { spis } = kancelaria(PLATNE);
  const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "poučenie z veci", "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(pocet(spis), 1);
});

test("audit riadok pomenuje poverenie, nie agenta", () => {
  const { spis } = kancelaria(PLATNE);
  runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "poučenie z veci Novák", "--apply"]);
  const subor = readdirSync(join(spis, MEMORY_DIR)).find((f) => f.startsWith("L-001"));
  assert.ok(subor);
  const audit = parseRecord(readFileSync(join(spis, MEMORY_DIR, subor), "utf8")).timeline.at(-1);
  assert.ok(audit);
  assert.match(audit.text, /JUDr\. Vojtěch Říha, Ph\.D\./);
  assert.match(audit.text, /trvalé poverenie do 2026-12-31/);
  assert.match(audit.text, /poučenie z veci Novák/);
});

test("dry-run povie, ze poverenie zapis kryje", () => {
  const { spis } = kancelaria(PLATNE);
  const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "x"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /trvalé poverenie/);
  assert.equal(pocet(spis), 0, "náhľad nesmie nič zapísať");
});

// --- hranice poverenia -----------------------------------------------------

test("prepadnute poverenie neplati", () => {
  const { spis } = kancelaria(PLATNE.replace("2026-12-31", "2026-08-31"));
  const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.equal(pocet(spis), 0);
});

test("vrstva mimo scope poverenim krytá nie je", () => {
  const { spis } = kancelaria(PLATNE.replace("scope: [L1, L3]", "scope: [L3]"));
  const r = runCli(["write", spis, "--file", navrh(spis, poucenie()), "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
});

test("mazanie poverenie nekryje nikdy — je nezvratne", () => {
  const { root, spis } = kancelaria(PLATNE);
  const p = poucenie();
  runCli(["write", spis, "--file", navrh(spis, p), "--reason", "založenie", "--apply"]);
  assert.equal(pocet(spis), 1);

  const zmazanie = planWrite(p, undefined, "duplicita");
  assert.equal(
    standingApproval(spis, zmazanie), undefined,
    "poverenie sa nesmie vzťahovať na mazanie",
  );
  assert.throws(() => applyRecordWrite(spis, zmazanie, undefined), ApprovalRequiredError);
  assert.equal(pocet(spis), 1, "záznam nesmie zmiznúť");
  assert.ok(readStandingAuthorization(join(root, OFFICE_DIR)), "poverenie pritom platí");
});

// --- čo poverenie NESMIE vypnúť -------------------------------------------

test("poverenie neotvara cestu klientskym udajom do L3", () => {
  const { spis } = kancelaria(PLATNE);
  const subjekt = newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz",
    title: "Gh Real Estate s.r.o.", description: "protistrana",
    created: "2026-09-02", updated: "2026-09-02", truth: "t",
    timeline: [{ date: "2026-09-02", text: "overené" }],
    registry_id: "29139643",
  });
  writeFileSync(join(spis, MEMORY_DIR, "S-001-x.md"), serializeRecord(subjekt));

  const pramen = newRecord({
    id: "A-001", type: "authority", jurisdiction: "cz",
    title: "Právna veta", description: "prameň",
    created: "2026-09-02", updated: "2026-09-02",
    truth: "Vec spoločnosti s IČO 29139643.",
    timeline: [{ date: "2026-09-02", text: "z" }],
  });
  assert.throws(
    () => applyRecordWrite(spis, planWrite(undefined, pramen, "veta"), undefined),
    LeakBlockedError,
    "poverenie schvaľuje zápis, nie únik údajov",
  );
});

test("poverenie neoslabuje atomicitu Pravdy a Historie", () => {
  const { spis } = kancelaria(PLATNE);
  const p = poucenie();
  runCli(["write", spis, "--file", navrh(spis, p), "--reason", "založenie", "--apply"]);

  const bezStopy = { ...p, truth: "Úplne inak." };
  const r = runCli(["write", spis, "--file", navrh(spis, bezStopy), "--reason", "obrat", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /Historie|História/);
});

// --- prepadnutie sa nesmie prejaviť ako porucha ----------------------------

test("validate ohlasi prepadnute poverenie", () => {
  const { spis } = kancelaria(PLATNE.replace("2026-12-31", "2026-08-31"));
  const r = runCli(["validate", spis]);
  assert.match(r.out, /STANDING_AUTH_EXPIRED/);
  assert.match(r.out, /2026-08-31/);
  assert.equal(r.code, 0, "uplynutie lehoty je varovanie, nie chyba");
});

test("platne poverenie validate nekomentuje", () => {
  const { spis } = kancelaria(PLATNE);
  assert.doesNotMatch(runCli(["validate", spis]).out, /STANDING_AUTH/);
});
