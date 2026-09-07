import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStore } from "../src/validate.ts";
import { newRecord } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-08-31" };

function subjekt(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "S-001", type: "subject", jurisdiction: "cz",
      title: "Jan Novák", description: "klient",
      created: "2026-08-31", updated: "2026-08-31", truth: "klient",
      timeline: [{ date: "2026-08-31", text: "identifikace" }],
      role: "client", person_type: "natural_person",
      birth_number: "750101/1234", birth_place: "Praha", sex: "muz",
      citizenship: "CR", residence: "Krátká 12, 110 00 Praha 1",
      id_document_type: "obcansky prukaz", id_document_number: "123456789",
      id_document_issuer: "MC Praha 1", id_document_valid_to: "2032-05-14",
    }),
    ...over,
  };
}

function provereni(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "P-001", type: "screening", jurisdiction: "cz",
      title: "Prověření", description: "AML prověření, riziko nízké",
      created: "2026-08-31", updated: "2026-08-31", truth: "bez nálezu",
      timeline: [{ date: "2026-08-31", text: "provedeno" }],
      subject_ref: "S-001", check_date: "2026-08-31", mode: "medium",
      risk: "low", conclusion: "proceed", valid_until: "2027-08-31",
    }),
    ...over,
  };
}

function pramen(truth: string, id = "J-001"): OkfRecord {
  return newRecord({
    id, type: "authority", jurisdiction: "cz",
    title: "Právní věta", description: "pramen",
    created: "2026-08-31", updated: "2026-08-31", truth,
    timeline: [{ date: "2026-08-31", text: "z" }],
    verified_at: "2026-08-31",
  });
}

const codes = (f: ReturnType<typeof validateStore>) => f.map((x) => x.code);

// --- rozšírená brána úniku ---

test("rodne cislo v pravnom prameni blokuje", () => {
  const f = validateStore([subjekt(), provereni(), pramen("narozen r.c. 750101/1234")], DNES);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
});

test("rodne cislo bez lomitka sa tiez najde", () => {
  const f = validateStore([subjekt(), provereni(), pramen("rc 7501011234")], DNES);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
});

test("cislo dokladu v pravnom prameni blokuje", () => {
  const f = validateStore([subjekt(), provereni(), pramen("OP c. 123456789")], DNES);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
});

test("trvaly pobyt v pravnom prameni blokuje", () => {
  const f = validateStore([subjekt(), provereni(), pramen("bytem Krátká 12, 110 00 Praha 1")], DNES);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
});

test("cisty pramen pri plnej AML evidencii zostava cisty", () => {
  const f = validateStore(
    [subjekt(), provereni(), pramen("§ 8 zák. č. 253/2008 Sb. vyžaduje identifikaci klienta.")],
    DNES,
  );
  assert.deepEqual(f, []);
});

// --- citlivy udaj v popise ---

test("rodne cislo v popise je chyba — popis ide do rejstrika a projekcie", () => {
  const f = validateStore([subjekt({ description: "klient, r.c. 750101/1234" }), provereni()], DNES);
  const n = f.find((x) => x.code === "SENSITIVE_IN_SUMMARY");
  assert.ok(n, JSON.stringify(f));
  assert.equal(n?.severity, "error");
});

test("bezne cislo v popise poplach nespusti", () => {
  const f = validateStore([subjekt({ description: "klient, spis 12 C 345/2026" }), provereni()], DNES);
  assert.deepEqual(codes(f), []);
});

// --- AML lehoty a uplnost ---

test("prosle provereni je varovanie na opakovanie podla § 9", () => {
  const f = validateStore([subjekt(), provereni({ valid_until: "2026-01-01" })], DNES);
  const n = f.find((x) => x.code === "AML_EXPIRED");
  assert.ok(n, JSON.stringify(f));
  assert.equal(n?.severity, "warning");
});

test("klient bez akehokolvek proverenia je varovanie", () => {
  const f = validateStore([subjekt()], DNES);
  assert.ok(codes(f).includes("AML_MISSING"), JSON.stringify(f));
});

test("protistrana bez proverenia varovanie nesposobi", () => {
  const f = validateStore([subjekt({ id: "S-002", role: "counterparty" })], DNES);
  assert.ok(!codes(f).includes("AML_MISSING"), JSON.stringify(f));
});

test("neuplna identifikacia FO je varovanie, pomenuje polia a cituje § 5", () => {
  const neuplny = subjekt();
  delete (neuplny as unknown as Record<string, unknown>).id_document_number;
  delete (neuplny as unknown as Record<string, unknown>).birth_place;
  const f = validateStore([neuplny, provereni()], DNES);
  const n = f.find((x) => x.code === "AML_INCOMPLETE");
  assert.ok(n, JSON.stringify(f));
  assert.match(n?.message ?? "", /číslo dokladu/);
  assert.match(n?.message ?? "", /místo narození/);
  assert.match(n?.message ?? "", /§ 5 ods\. 1 zák\. č\. 253\/2008 Sb\./,
    "výpočet údajov je v § 5; § 8 upravuje vykonanie identifikácie");
});

test("slovensky spis sa kontroluje podla § 7, nie podla ceskych pravidiel", () => {
  const sk = newRecord({
    id: "S-009", type: "subject", jurisdiction: "sk",
    title: "Ján Malý", description: "klient", created: "2026-08-31", updated: "2026-08-31",
    truth: "t", timeline: [{ date: "2026-08-31", text: "x" }],
    role: "client", person_type: "natural_person",
  });
  const f = validateStore([sk], DNES);
  const n = f.find((x) => x.code === "AML_INCOMPLETE");
  assert.ok(n, JSON.stringify(f));
  assert.match(n?.message ?? "", /§ 7 ods\. 1 zák\. č\. 297\/2008 Z\. z\./);
  assert.ok(!codes(f).includes("AML_RULESET_UNVERIFIED"), "SK sada je overená");
  assert.ok(!(n?.message ?? "").includes("miesto narodenia"),
    "miesto narodenia je český požiadavok, na slovenský spis nepatrí");
});

test("uplna evidencia s platnym proverenim je bez nalezov", () => {
  assert.deepEqual(validateStore([subjekt(), provereni()], DNES), []);
});

test("subjekt bez typ_osoby v neoverenej jurisdikcii varovanie nesposobi", () => {
  const sk = newRecord({
    id: "S-010", type: "subject", jurisdiction: "sk",
    title: "Protistrana s.r.o.", description: "protistrana", created: "2026-08-31",
    updated: "2026-08-31", truth: "t", timeline: [{ date: "2026-08-31", text: "x" }],
  });
  assert.deepEqual(validateStore([sk], DNES), [],
    "bez AML identifikácie sa nemá čo hlásiť — inak je to šum, nie signál");
});
