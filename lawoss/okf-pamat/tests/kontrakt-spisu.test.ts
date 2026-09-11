/**
 * Tri trenia jedného kontraktu spisu na strane `okf-pamat` (G4 z podkladu MČ
 * po calle 7. 9. 2026): `init` bez jurisdikcie, retrofit markerov do
 * existujúceho `_STATUS.md`, priečinok kancelárie `Office`.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord } from "../src/record.ts";
import { newRecord, retrofitStatus, findOfficeDir, MEMORY_DIR, OFFICE_DIR, LEGACY_OFFICE_DIR, CONFIG_FILE, STATUS_FILE } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const T = "2026-09-11";
const rec = (id: string, type: OkfRecord["type"], title: string, over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id, type, jurisdiction: "sk", title, description: "d", created: T, updated: T, truth: "t",
    timeline: [{ date: T, text: "založené" }] }), ...over });

/** Šablóna Fázy A: číslované sekcie, bez markerov, s vlastným textom advokáta. */
const SABLONA_A = `# Vec — Status

> **Fáza:** rozpracované
> **Ďalší krok:** doplniť podanie

## 1. Súhrn

Text advokáta.

## 3. Lehoty

| Dátum | Vec |
|---|---|
| 2026-10-01 | ručne zapísaná lehota |

## 4. Chronológia

- 2026-09-01 — prevzatie veci
`;

function spis(status = SABLONA_A): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-kontrakt-"));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, STATUS_FILE), status);
  return dir;
}

// --- (6) init bez jurisdikcie -------------------------------------------------

test("init s kartou veci jurisdikciu vezme a spis zalozi", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-karta-"));
  writeFileSync(join(dir, "spis.md"), "---\ntype: spis\njurisdiction: sk\n---\n");
  assert.equal(runCli(["init", dir, "--apply"]).code, 0);
  assert.ok(existsSync(join(dir, MEMORY_DIR)));
});

test("init s prepinacom zalozi aj bez karty", () => {
  const dir = mkdtempSync(join(tmpdir(), "okf-init-flag-"));
  assert.equal(runCli(["init", dir, "--sk", "--apply"]).code, 0);
});

// --- (7) retrofit markerov ----------------------------------------------------

test("sync nad sablonou Fazy A konci konfliktom, retrofit ho odstrani", () => {
  const dir = spis();
  writeFileSync(join(dir, MEMORY_DIR, "D-001-x.md"), serializeRecord(rec("D-001", "decision", "Podať odvolanie", { deadlines: ["2026-09-20"] })));
  assert.equal(runCli(["sync", dir, "--apply"]).code, 1, "bez markerov je to konflikt, nie tichý append");

  const dry = runCli(["retrofit", dir]);
  assert.equal(dry.code, 0, dry.out);
  assert.match(dry.out, /dry-run.*deadlines.*timeline/);
  assert.equal(readFileSync(join(dir, STATUS_FILE), "utf8"), SABLONA_A, "náhľad nič nezapíše");

  assert.equal(runCli(["retrofit", dir, "--apply"]).code, 0);
  const po = readFileSync(join(dir, STATUS_FILE), "utf8");
  assert.match(po, /## 3\. Lehoty\n<!-- okf:render:deadlines:start -->/, "markery hneď pod nadpisom");
  assert.match(po, /## 4\. Chronológia\n<!-- okf:render:timeline:start -->/);
  assert.match(po, /2026-09-20/, "blok je rovno naplnený");
  assert.match(po, /ručne zapísaná lehota/, "advokátov text pod markermi ostáva");
  assert.match(po, /Text advokáta\./, "cudzie sekcie sa nedotknú");
  assert.doesNotMatch(po, /okf:render:records:start/, "sekcia, ktorá v súbore nie je, sa nepridáva");

  assert.equal(runCli(["sync", dir, "--apply"]).code, 0, "po retrofite sync prejde");
});

test("retrofit je idempotentny", () => {
  const dir = spis();
  runCli(["retrofit", dir, "--apply"]);
  const prvy = readFileSync(join(dir, STATUS_FILE), "utf8");
  const r = runCli(["retrofit", dir, "--apply"]);
  assert.match(r.out, /Nič na doplnenie/);
  assert.equal(readFileSync(join(dir, STATUS_FILE), "utf8"), prvy);
  assert.equal((prvy.match(/okf:render:deadlines:start/g) ?? []).length, 1, "markery sa nezdvoja");
});

test("retrofitStatus vracia, co vlozil, a subor bez sekcii necha tak", () => {
  const { text, inserted } = retrofitStatus("# Len nadpis\n", [], "sk");
  assert.deepEqual(inserted, []);
  assert.equal(text, "# Len nadpis\n");
});

// --- (8) Office -----------------------------------------------------------

test("kancelaria sa zaklada ako Office a rozpozna sa aj stara _kancelaria", () => {
  assert.equal(OFFICE_DIR, "Office");
  const root = mkdtempSync(join(tmpdir(), "okf-office-"));
  const spisDir = join(root, "AK", "N", "Novák", "vec");
  mkdirSync(join(spisDir, MEMORY_DIR), { recursive: true });
  assert.equal(findOfficeDir(spisDir), undefined);

  mkdirSync(join(root, LEGACY_OFFICE_DIR, MEMORY_DIR), { recursive: true });
  assert.equal(findOfficeDir(spisDir), join(root, LEGACY_OFFICE_DIR), "starý koreň sa číta");

  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  assert.equal(findOfficeDir(spisDir), join(root, OFFICE_DIR), "nový má prednosť, keď sú oba");
});

test("z kancelarie samotnej je kancelariou ona sama — aj tej starej", () => {
  const root = mkdtempSync(join(tmpdir(), "okf-office-self-"));
  for (const n of [OFFICE_DIR, LEGACY_OFFICE_DIR]) {
    mkdirSync(join(root, n, MEMORY_DIR), { recursive: true });
    assert.equal(findOfficeDir(join(root, n)), join(root, n));
  }
});

test("L3 zo spisu pod starou _kancelaria skonci v nej, nie v neexistujucom Office", () => {
  const root = mkdtempSync(join(tmpdir(), "okf-office-legacy-"));
  const office = join(root, LEGACY_OFFICE_DIR);
  mkdirSync(join(office, MEMORY_DIR), { recursive: true });
  writeFileSync(join(office, CONFIG_FILE), "client_path: AK/*/*\nstanding_authorization: VŘ\ngranted_at: 2026-09-01\nexpires_at: 2026-12-31\nscope: [L1, L3]\nreason: test\n");
  const spisDir = join(root, "AK", "N", "Novák", "vec");
  mkdirSync(join(spisDir, MEMORY_DIR), { recursive: true });
  const f = join(spisDir, "navrh.md"); writeFileSync(f, serializeRecord(rec("A-001", "authority", "Veta")));
  const r = runCli(["write", spisDir, "--file", f, "--reason", "x", "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.ok(readdirSync(join(office, MEMORY_DIR)).some((x) => x.startsWith("A-001-")));
  assert.ok(!existsSync(join(root, OFFICE_DIR)), "nový priečinok sa nezakladá potichu");
});

// --- kancelária nad rozložením Fázy A -----------------------------------------

test("kancelaria sa najde aj nad spisom Fazy A: AK/<pismeno>/<klient>/Spisy/<vec>", () => {
  // Päť úrovní pod koreňom. S maxUp = 5 sa nenašla a pramen skončil potichu v spise.
  const root = mkdtempSync(join(tmpdir(), "okf-office-faza-a-"));
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  const spisDir = join(root, "AK", "R", "REAL 29 s.r.o.", "Spisy", "MSPH 79 INS 2047-2023");
  mkdirSync(join(spisDir, MEMORY_DIR), { recursive: true });
  assert.equal(findOfficeDir(spisDir), join(root, OFFICE_DIR));
});

test("bez kancelarie ostava pramen v spise, ale CLI to povie nahlas", () => {
  const root = mkdtempSync(join(tmpdir(), "okf-no-office-"));
  const spisDir = join(root, "vec"); mkdirSync(join(spisDir, MEMORY_DIR), { recursive: true });
  const f = join(spisDir, "navrh.md"); writeFileSync(f, serializeRecord(rec("A-001", "authority", "Veta")));
  const r = runCli(["write", spisDir, "--file", f, "--reason", "x", "--approve-as", "JUDr. Test", "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /nenašla kancelária/);
  assert.ok(readdirSync(join(spisDir, MEMORY_DIR)).some((x) => x.startsWith("A-001-")));
});
