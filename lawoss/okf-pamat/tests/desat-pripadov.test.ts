/**
 * Desať vecí naprieč agendou — čo sa reálne zapíše na disk.
 *
 * Každý prípad ide **celou cestou agenta**: návrh → CLI write --apply pod
 * trvalým poverením → čítanie súboru späť → validácia. Netestuje sa API
 * v pamäti, ale to, čo v spise nájde človek.
 *
 * Údaje sú vymyslené. Repo je verejné, klientske dáta sem nepatria.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { serializeRecord, parseRecord } from "../src/record.ts";
import { newRecord, MEMORY_DIR, OFFICE_DIR, CONFIG_FILE } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";
import type { RecordType } from "../src/schema.ts";

const POVERENIE = [
  "standing_authorization: JUDr. Vojtěch Říha, Ph.D.",
  "granted_at: 2026-09-02",
  "expires_at: 2026-12-31",
  "scope: [L1, L3]",
  "reason: agentné vedenie spisov",
].join("\n") + "\n";

const D = "2026-09-02";

/** Kancelária s poverením, klient a jeden prázdny spis. */
function spis(meno: string): string {
  const root = mkdtempSync(join(tmpdir(), "okf-vec-"));
  mkdirSync(join(root, OFFICE_DIR, MEMORY_DIR), { recursive: true });
  writeFileSync(join(root, OFFICE_DIR, CONFIG_FILE), POVERENIE);
  const klient = join(root, meno);
  mkdirSync(join(klient, MEMORY_DIR), { recursive: true });
  writeFileSync(join(klient, "klient.md"), "---\ntype: klient\n---\n");
  const vec = join(klient, "3 - Soudni", "2026-09 vec");
  mkdirSync(join(vec, MEMORY_DIR), { recursive: true });
  writeFileSync(join(vec, "_STATUS.md"), "# Status\n");
  return vec;
}

/** Zapíše záznam cestou, ktorou ide agent, a vráti to, čo dosadlo na disk. */
function zapis(dir: string, r: OkfRecord, dovod: string): OkfRecord {
  const navrh = join(dir, `navrh-${r.id}.md`);
  writeFileSync(navrh, serializeRecord(r));
  const res = runCli(["write", dir, "--file", navrh, "--reason", dovod, "--apply"]);
  assert.equal(res.code, 0, res.out);
  const subor = readdirSync(join(dir, MEMORY_DIR)).find((f) => f.startsWith(`${r.id}`));
  assert.ok(subor, `${r.id} sa nezapísal`);
  return parseRecord(readFileSync(join(dir, MEMORY_DIR, subor), "utf8"));
}

const zaklad = (id: string, type: RecordType, title: string, summary: string) => ({
  id, type, title, summary, jurisdiction: "cz" as const,
  created: D, updated: D, truth: "t",
  timeline: [{ date: D, text: "založené" }],
});

// --- 1. insolvencia: dlžník ako právnická osoba ---------------------------

test("vec 1 — subjekt PO: identifikacia podla § 5 zapadne cela", () => {
  const dir = spis("Stavby Morava s.r.o.");
  const r = zapis(dir, newRecord({
    ...zaklad("S-001", "subject", "Stavby Morava s.r.o.", "dlžník v insolvenčnom konaní"),
    role: "counterparty", person_type: "legal",
    registry_id: "11223344", legal_form: "společnost s ručením omezeným",
    registered_office: "Nádražní 12, 602 00 Brno",
    registry_entry: "C 99999 vedená u Krajského soudu v Brně",
    representatives: ["Jan Dvořák, jednatel"], ubo: ["Jan Dvořák"],
    pep: "no", registries: ["OR", "ARES"],
  }), "založenie protistrany z ISIR");

  assert.equal(r.layer, "L2");
  assert.equal(r.registry_id, "11223344");
  assert.equal(r.registered_office, "Nádražní 12, 602 00 Brno");
  assert.deepEqual(r.representatives, ["Jan Dvořák, jednatel"]);
  assert.deepEqual(r.ubo, ["Jan Dvořák"]);
  // Čiarka v obchodnej firme sa nesmie stať oddeľovačom položiek.
  assert.equal(r.representatives?.length, 1);
});

// --- 2. subjekt ako fyzická osoba a maskovanie ----------------------------

test("vec 2 — subjekt FO: citlive polia sa citaju maskovane", () => {
  const dir = spis("Nováková Eva");
  const r = zapis(dir, newRecord({
    ...zaklad("S-002", "subject", "Eva Nováková", "klientka, veriteľka"),
    role: "client", person_type: "natural",
    birth_number: "885612/1234", birth_date: "1988-06-12", birth_place: "Praha",
    sex: "female", citizenship: "CZ", residence: "Krátká 4, 110 00 Praha 1",
    id_document_type: "občanský průkaz", id_document_number: "123456789",
    id_document_issuer: "MČ Praha 1", id_document_valid_to: "2031-04-30",
  }), "identifikácia klienta");

  assert.equal(r.birth_number, "885612/1234", "na disku zostáva úplný AML doklad");
  // Maskuje sa až výpis. Doklad musí zostať úplný, oči v kancelárii nie.
  const out = runCli(["aml", dir]).out;
  assert.match(out, /Eva Nováková/);
  assert.doesNotMatch(out, /885612\/1234/, "výpis nesmie ukázať celé rodné číslo");
  assert.doesNotMatch(out, /123456789/, "ani číslo dokladu");
  assert.match(out, /885612/, "prvé znaky zostávajú, inak sa údaj nedá skontrolovať");
});

// --- 3. AML preverenie ----------------------------------------------------

test("vec 3 — prevernie: rezim, riziko, zaver aj platnost", () => {
  const dir = spis("Nováková Eva");
  zapis(dir, newRecord({
    ...zaklad("S-002", "subject", "Eva Nováková", "klientka"),
    role: "client", person_type: "natural",
    birth_number: "885612/1234", residence: "Krátká 4, 110 00 Praha 1",
  }), "identifikácia");

  const r = zapis(dir, newRecord({
    ...zaklad("SC-001", "screening", "Preverenie klientky", "AML kontrola pri prevzatí veci"),
    subject_ref: "S-002", check_date: D, mode: "in_person",
    pep_result: "negative", sanctions_result: "negative",
    funds_origin: "príjem zo závislej činnosti", risk: "low",
    conclusion: "accept", valid_until: "2027-09-02",
  }), "vstupná AML kontrola");

  assert.equal(r.subject_ref, "S-002");
  assert.equal(r.risk, "low");
  assert.equal(r.conclusion, "accept");
  assert.equal(r.valid_until, "2027-09-02");
  assert.equal(runCli(["validate", dir]).code, 0, runCli(["validate", dir]).out);
});

// --- 4. rozhodnutie s lehotami a projekcia -------------------------------

test("vec 4 — rozhodnutie: lehota dotecie az do _STATUS.md", () => {
  const dir = spis("Stavby Morava s.r.o.");
  const r = zapis(dir, newRecord({
    ...zaklad("D-001", "decision", "Podať prihlášku pohľadávky", "prihláška do 30 dní"),
    deadlines: ["2026-10-02"], court: "Krajský soud v Brně",
    matter_ref: "KSBR 33 INS 12345/2026",
  }), "rozhodnutie o postupe");

  assert.deepEqual(r.deadlines, ["2026-10-02"]);
  assert.equal(runCli(["sync", dir, "--apply"]).code, 0);
  const status = readFileSync(join(dir, "_STATUS.md"), "utf8");
  assert.match(status, /2026-10-02/);
  assert.match(status, /okf:render:deadlines:start/);
});

// --- 5. tvrdenie a dôkaz --------------------------------------------------

test("vec 5 — tvrdenie a dokaz: vazba drzi v oboch smeroch", () => {
  const dir = spis("Nováková Eva");
  // Tvrdenie odkazuje na toho, kto ho vzniesol — bez subjektu je to rozbitý odkaz.
  zapis(dir, newRecord({
    ...zaklad("S-001", "subject", "Karel Doležal", "protistrana"),
    role: "counterparty", person_type: "natural",
  }), "protistrana");
  zapis(dir, newRecord({
    ...zaklad("C-001", "claim", "Výpoveď bola doručená 12. 6. 2026", "sporné doručenie"),
    claimed_by: "S-001", claimed_at: "2026-06-20", claimed_in: "žaloba, čl. III",
    burden_of_proof: "S-001", supporting_evidence: ["E-001"],
    proof_status: "disputed", credibility: "medium",
  }), "tvrdenie protistrany");

  const e = zapis(dir, newRecord({
    ...zaklad("E-001", "evidence", "Doručenka dátovej správy", "doklad o doručení"),
    evidence_kind: "document", origin_date: "2026-06-12", author: "ISDS",
    proves: ["C-001"], evidence_strength: "direct", reliability: "high",
    procedural_status: "proposed",
  }), "dôkaz do spisu");

  assert.deepEqual(e.proves, ["C-001"]);
  assert.equal(e.evidence_kind, "document");
  const v = runCli(["validate", dir]);
  assert.equal(v.code, 0, v.out);
  assert.doesNotMatch(v.out, /LINK_ASYMMETRY/);
});

// --- 6. úloha so závislosťou ---------------------------------------------

test("vec 6 — uloha: zavislost sa zapise a otvorena uloha sa vykresli", () => {
  const dir = spis("Stavby Morava s.r.o.");
  zapis(dir, newRecord({
    ...zaklad("T-001", "task", "Vyžiadať výpis z KN", "podklad pre prihlášku"),
    assignee: "VŘ", state: "todo", due: "2026-09-20",
  }), "úloha");
  const t2 = zapis(dir, newRecord({
    ...zaklad("T-002", "task", "Zostaviť prihlášku", "po výpise z KN"),
    assignee: "VŘ", state: "blocked", due: "2026-09-30", depends_on: ["T-001"],
  }), "nadväzná úloha");

  assert.deepEqual(t2.depends_on, ["T-001"]);
  writeFileSync(join(dir, "_STATUS.md"),
    "# Status\n\n## Otevřené úkoly\n<!-- okf:render:tasks:start -->\n<!-- okf:render:tasks:end -->\n");
  runCli(["sync", dir, "--apply"]);
  const status = readFileSync(join(dir, "_STATUS.md"), "utf8");
  assert.match(status, /T-002/);
  assert.match(status, /2026-09-30/);
});

// --- 7. právny prameň v kancelárii ---------------------------------------

test("vec 7 — pramen L3: overenie a ucinnost sa zapisu", () => {
  const dir = spis("Stavby Morava s.r.o.");
  const r = zapis(dir, newRecord({
    ...zaklad("A-001", "authority", "Prihlasovacia lehota v insolvencii",
              "lehota beží od rozhodnutia o úpadku"),
    truth: "Pohľadávku možno prihlásiť v lehote určenej rozhodnutím o úpadku.",
    sources: ["zák. č. 182/2006 Sb., § 173"],
    effective_from: "2008-01-01", verified_at: D, verified_against: "úplné znenie",
  }), "právna veta");

  assert.equal(r.layer, "L3");
  assert.equal(r.verified_at, D);
  assert.deepEqual(r.sources, ["zák. č. 182/2006 Sb., § 173"]);
  assert.equal(runCli(["validate", dir]).code, 0);
});

// --- 8. poučenie do praxe -------------------------------------------------

test("vec 8 — poucenie L1: zapise sa pod poverenim aj s auditom", () => {
  const dir = spis("Stavby Morava s.r.o.");
  const r = zapis(dir, newRecord({
    ...zaklad("L-001", "lesson", "Doručenku sťahovať hneď", "prílohy z DS expirujú"),
    truth: "Prílohy z dátovej schránky sťahovať do spisu ihneď po prijatí.",
  }), "poučenie z veci");

  assert.equal(r.layer, "L1");
  assert.match(r.timeline.at(-1)?.text ?? "", /trvalé poverenie/);
  assert.equal(r.timeline.length, 2, "pôvodná história musí zostať");
});

// --- 9. otázka na klienta a druh udalosti --------------------------------

test("vec 9 — otazka a druh udalosti: chronologia ma stlpec Druh", () => {
  const dir = spis("Nováková Eva");
  const r = zapis(dir, newRecord({
    ...zaklad("Q-001", "question", "Má klientka originál výpovede?", "chýba listina"),
    timeline: [
      { date: "2026-08-20", text: "otázka položená e-mailom", kind: "correspondence" },
      { date: D, text: "bez odpovede", kind: "note" },
    ],
  }), "otázka na klienta");

  assert.equal(r.timeline[0]?.kind, "correspondence");
  assert.equal(r.timeline.length, 2);
  runCli(["sync", dir, "--apply"]);
  const status = readFileSync(join(dir, "_STATUS.md"), "utf8");
  assert.match(status, /Druh/);
  assert.match(status, /2026-08-20/);
});

// --- 10. spor o spôsobilosť ----------------------------------------------

test("vec 10 — sposobilost a zastupenie: polia sa zapisu a validacia varuje", () => {
  const dir = spis("Nováková Eva");
  const r = zapis(dir, newRecord({
    ...zaklad("S-003", "subject", "Marie Dvořáková", "protistrana, obmedzená svojprávnosť"),
    role: "counterparty", person_type: "natural",
    procedural_role: "defendant", representation: "opatrovník Jan Dvořák",
    legal_capacity: "limited",
    capacity_notes: "obmedzenie rozsudkom Okresního soudu v Brně z 3. 3. 2025",
  }), "identifikácia protistrany");

  assert.equal(r.legal_capacity, "limited");
  assert.equal(r.representation, "opatrovník Jan Dvořák");
  assert.equal(r.procedural_role, "defendant");
  // Protistrana sama upozornenie na konflikt nespúšťa — povinnosť je voči klientovi.
  assert.doesNotMatch(runCli(["validate", dir]).out, /CAPACITY_CONFLICT_CHECK/);

  zapis(dir, newRecord({
    ...zaklad("S-004", "subject", "Eva Nováková", "klientka v insolvencii"),
    role: "client", person_type: "natural",
    capacity_notes: "prebieha insolvenčné konanie, majetkovú podstatu spravuje správca",
  }), "identifikácia klientky");
  const v = runCli(["validate", dir]);
  assert.match(v.out, /CAPACITY_CONFLICT_CHECK/);
  assert.match(v.out, /S-004/);
  assert.equal(v.code, 0, "je to varovanie, nie chyba");
});
