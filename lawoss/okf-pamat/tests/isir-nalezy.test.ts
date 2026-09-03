/**
 * Nálezy z desiatich skutočných konaní z ISIR (3. 9. 2026), ktoré 66
 * zápisov cestou agenta ukázalo a vymyslené dáta nie.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord, parseRecord } from "../src/record.ts";
import { newRecord, validateStore, applyRecordWrite, planWrite, LeakBlockedError,
  MEMORY_DIR, OFFICE_DIR, CONFIG_FILE, STATUS_FILE } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const D = { today: "2026-09-03" };
const T = "2026-09-03";
const rec = (id: string, type: OkfRecord["type"], title: string, over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id, type, jurisdiction: "cz", title, description: "d", created: T, updated: T, truth: "t",
    timeline: [{ date: T, text: "z" }] }), ...over });

/** kancelária → klient → spis, s trvalým poverením pre L1/L3 */
function kancelaria(): { root: string; klient: string; spis: string } {
  const root = mkdtempSync(join(tmpdir(), "okf-isir-"));
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, OFFICE_DIR, CONFIG_FILE),
    "client_path: AK/*/*\nstanding_authorization: VŘ\ngranted_at: 2026-09-03\nexpires_at: 2026-12-31\nscope: [L1, L3]\nreason: test\n");
  const klient = join(root, "AK", "H", "Harnach Pavel");
  const spis = join(klient, "2024 INS 16948");
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  mkdirSync(spis, { recursive: true });
  return { root, klient, spis };
}
function zapis(dir: string, r: OkfRecord): string {
  const f = join(dir, `navrh-${r.id}.md`); writeFileSync(f, serializeRecord(r));
  const res = runCli(["write", dir, "--file", f, "--reason", "x", "--apply"]);
  assert.equal(res.code, 0, res.out);
  return res.out;
}

// --- 1. rodné číslo vo voľnom texte ---------------------------------------

test("rodne cislo v Pravde otazky je jehlou — pramen L3 s nim je unik", () => {
  const q = rec("Q-001", "question", "Výrok osvobozuje jinou osobu", {
    truth: "Výrok: „osvobozuje dlužníka Tomáše Navrátila, rč 820829/2224“ — zřejmě chyba v psaní." });
  const a = rec("A-001", "authority", "Oprava zjevné nesprávnosti", { truth: "V jednom výroku figurovala osoba s rč 820829/2224." });
  const f = validateStore([q, a], D).find((x) => x.code === "L3_LEAK");
  assert.ok(f, "RČ z voľného textu musí byť jehla");
  assert.match(f.message, /Q-001/);
});

test("ta ista jehla blokuje zapis L3 aj v ceste zapisu", () => {
  const { spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  zapis(spis, rec("Q-001", "question", "x", { truth: "rč 820829/2224 vo výroku" }));
  const a = rec("A-001", "authority", "Veta", { truth: "Osoba s rč 820829/2224." });
  assert.throws(() => applyRecordWrite(spis, planWrite(undefined, a, "veta"), { by: "VŘ", at: "2026-09-03T10:00:00Z" }), LeakBlockedError);
});

test("suma ani ICO vo volnom texte jehlou nie su — osem cislic je v spise vsade", () => {
  const q = rec("Q-001", "question", "x", { truth: "Pohledávka 14873382 Kč, IČO 29269865." });
  const a = rec("A-001", "authority", "Veta", { truth: "Částka 14873382 a číslo 29269865." });
  assert.ok(!validateStore([q, a], D).some((x) => x.code === "L3_LEAK"));
});

// --- 2. uplynutá lehota ---------------------------------------------------

test("uplynuta lehota aktivneho zaznamu je varovanie", () => {
  const f = validateStore([rec("D-001", "decision", "x", { deadlines: ["2026-08-27"] })], D).find((x) => x.code === "DEADLINE_PASSED");
  assert.ok(f); assert.equal(f.severity, "warning"); assert.match(f.message, /2026-08-27/);
});

test("buduca lehota ani lehota prekonaneho zaznamu sa nehlasi", () => {
  const k = (r: OkfRecord) => validateStore([r], D).map((x) => x.code);
  assert.ok(!k(rec("D-001", "decision", "x", { deadlines: ["2026-09-30"] })).includes("DEADLINE_PASSED"));
  assert.ok(!k(rec("D-001", "decision", "x", { deadlines: ["2026-08-27"], status: "superseded" })).includes("DEADLINE_PASSED"));
});

// --- 3. kostra _STATUS.md ---------------------------------------------------

test("init zalozi _STATUS.md so vsetkymi piatimi blokmi a sync ich vyplni", () => {
  const { spis } = kancelaria();
  const r = runCli(["init", spis, "--apply"]);
  assert.equal(r.code, 0, r.out);
  const status = readFileSync(join(spis, STATUS_FILE), "utf8");
  for (const b of ["deadlines", "timeline", "records", "evidence_matrix", "tasks"]) {
    assert.match(status, new RegExp(`okf:render:${b}:start`), `chýba blok ${b}`);
  }
  zapis(spis, rec("T-001", "task", "Podnět k opravě", { state: "pending", due: "2026-09-08" }));
  assert.equal(runCli(["sync", spis, "--apply"]).code, 0);
  assert.match(readFileSync(join(spis, STATUS_FILE), "utf8"), /T-001.*Podnět k opravě/);
});

test("existujuci _STATUS.md init neprepise", () => {
  const { spis } = kancelaria();
  writeFileSync(join(spis, STATUS_FILE), "# Moje\n");
  runCli(["init", spis, "--apply"]);
  assert.equal(readFileSync(join(spis, STATUS_FILE), "utf8"), "# Moje\n");
});

// --- 4. L1/L3 smerujú do kancelárie ----------------------------------------

test("pramen L3 zapisany cez <spis> skonci v _kancelaria/memory", () => {
  const { root, spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  const out = zapis(spis, rec("A-001", "authority", "Lehota § 198 IZ je hmotněprávní"));
  assert.match(out, /_kancelaria/);
  assert.ok(readdirSync(join(root, OFFICE_DIR, MEMORY_DIR)).some((f) => f.startsWith("A-001-")), "prameň má byť v kancelárii");
  assert.ok(!readdirSync(join(spis, MEMORY_DIR)).some((f) => f.startsWith("A-001-")), "a nie v spise");
});

test("presmerovanie do kancelarie branu uniku neoslepi", () => {
  // Subjekt s IČO žije u klienta; prameň mieri do kancelárie, ktorej scope
  // klienta nevidí. Jehly musia prísť zo spisu, z ktorého zápis prichádza.
  const { klient, spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  writeFileSync(join(klient, MEMORY_DIR, "S-001-x.md"), serializeRecord(rec("S-001", "subject", "EUROTON s.r.o.", { role: "client", person_type: "legal_person", registry_id: "02872579" })));
  const f = join(spis, "navrh.md"); writeFileSync(f, serializeRecord(rec("A-001", "authority", "Veta", { truth: "Ve věci IČO 02872579." })));
  const r = runCli(["write", spis, "--file", f, "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /02872579/);
});

test("zapis priamo do kancelarie sa nepresmeruje sam na seba", () => {
  const { root } = kancelaria();
  const office = join(root, OFFICE_DIR);
  const out = zapis(office, rec("L-001", "lesson", "Poučenie"));
  assert.doesNotMatch(out, /Cieľ:/);
});

// --- 5. klientský bundle a viditeľnosť subjektov ---------------------------

test("sync zapise index.md a log.md aj u klienta a vec ich odkazuje", () => {
  const { klient, spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  writeFileSync(join(klient, MEMORY_DIR, "S-001-pavel-harnach.md"), serializeRecord(rec("S-001", "subject", "Pavel Harnach", { role: "client", person_type: "natural_person" })));
  zapis(spis, rec("M-001", "matter", "KSPA 71 INS 16948/2024"));
  assert.equal(runCli(["sync", spis, "--apply"]).code, 0);
  assert.ok(existsSync(join(klient, MEMORY_DIR, "index.md")), "klientský index");
  assert.ok(existsSync(join(klient, MEMORY_DIR, "log.md")), "klientský log");
  const idx = readFileSync(join(spis, MEMORY_DIR, "index.md"), "utf8");
  const m = /\[S-001\]\(([^)]+)\)/.exec(idx);
  assert.ok(m, `sekcia Klient chýba:\n${idx}`);
  const cesta = m[1] ?? "";
  assert.ok(existsSync(join(spis, MEMORY_DIR, cesta)), `odkaz ${cesta} musí viesť na súbor`);
});

// --- 6. kolízia identifikátorov v spoločnej kancelárii ----------------------

test("druhe A-001 z inej veci sa nezamieňa za prepis prveho — navrhne volne id", () => {
  const { root, spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  const office = join(root, OFFICE_DIR);
  zapis(spis, rec("A-001", "authority", "Lehota § 198 IZ", { created: "2026-09-01", updated: "2026-09-01" }));

  const ina = join(root, "AK", "E", "EUROTON", "2025 INS 14748");
  mkdirSync(ina, { recursive: true });
  runCli(["init", ina, "--apply"]);
  const f = join(ina, "navrh.md");
  writeFileSync(f, serializeRecord(rec("A-001", "authority", "Zrušenie konkursu § 308", { created: "2026-09-03", updated: "2026-09-03" })));
  const r = runCli(["write", ina, "--file", f, "--reason", "x", "--apply"]);
  assert.equal(r.code, 1, r.out);
  assert.match(r.out, /patrí inému záznamu/);
  assert.match(r.out, /Lehota § 198 IZ/);
  assert.match(r.out, /Voľné je A-002/);
  assert.doesNotMatch(r.out, /História/, "dôvod má byť kolízia, nie história");
  assert.equal(readdirSync(join(office, MEMORY_DIR)).filter((x) => x.startsWith("A-")).length, 1);
});

test("uprava toho isteho pramena z inej veci prejde — created sedi", () => {
  const { root, spis } = kancelaria();
  runCli(["init", spis, "--apply"]);
  const p1 = rec("A-001", "authority", "Lehota § 198 IZ", { created: "2026-09-01", updated: "2026-09-01" });
  zapis(spis, p1);
  const ina = join(root, "AK", "E", "EUROTON", "2025 INS 14748");
  mkdirSync(ina, { recursive: true });
  runCli(["init", ina, "--apply"]);
  // Úprava sa stavia z toho, čo je na disku — CLI pri zápise pripojilo
  // audit riadok a história sa smie len predlžovať.
  const officeMem = join(root, OFFICE_DIR, MEMORY_DIR);
  const subor = readdirSync(officeMem).find((x) => x.startsWith("A-001-")) ?? "";
  const ulozeny = parseRecord(readFileSync(join(officeMem, subor), "utf8"));
  // Uložený záznam má `updated` na dni audit riadku; zmena obsahu ho musí posunúť.
  const p2 = { ...ulozeny, truth: "doplnené", updated: "2026-09-04",
    timeline: [...ulozeny.timeline, { date: "2026-09-04", text: "doplnené z inej veci" }] };
  const f = join(ina, "navrh.md"); writeFileSync(f, serializeRecord(p2));
  const r = runCli(["write", ina, "--file", f, "--reason", "x", "--apply"]);
  assert.equal(r.code, 0, r.out);
  assert.equal(readdirSync(join(root, OFFICE_DIR, MEMORY_DIR)).filter((x) => x.startsWith("A-")).length, 1);
});
