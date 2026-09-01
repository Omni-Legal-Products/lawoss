import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStore } from "../src/validate.ts";
import { newRecord, FIELDS } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";
import type { Jurisdiction } from "../src/schema.ts";

const DNES = { today: "2026-08-31" };

function osoba(j: Jurisdiction, over: Record<string, unknown> = {}): OkfRecord {
  const base = newRecord({
    id: "S-001", type: "subject", jurisdiction: j,
    title: "Jan Novák", summary: "klient", created: "2026-08-31", updated: "2026-08-31",
    truth: "t", timeline: [{ date: "2026-08-31", text: "x" }],
    role: "counterparty", person_type: "natural_person",
  });
  return { ...base, ...over } as OkfRecord;
}

function firma(j: Jurisdiction, over: Record<string, unknown> = {}): OkfRecord {
  const base = newRecord({
    id: "S-002", type: "subject", jurisdiction: j,
    title: "Firma s.r.o.", summary: "protistrana", created: "2026-08-31", updated: "2026-08-31",
    truth: "t", timeline: [{ date: "2026-08-31", text: "x" }],
    role: "counterparty", person_type: "legal_person",
  });
  return { ...base, ...over } as OkfRecord;
}

const nalez = (r: OkfRecord) =>
  validateStore([r], DNES).find((f) => f.code === "AML_INCOMPLETE");

// --- česká sada podle § 5 odst. 1 písm. a) ---

const CZ_FO_UPLNA = {
  birth_number: "750101/1234", birth_place: "Praha",
  residence: "Krátká 12, Praha 1", citizenship: "CR",
  id_document_type: "obcansky prukaz", id_document_number: "123456789",
  id_document_issuer: "MC Praha 1", id_document_valid_to: "2032-05-14",
};

test("CZ FO s rodnym cislom nepotrebuje pohlavie", () => {
  assert.equal(nalez(osoba("cz", CZ_FO_UPLNA)), undefined);
});

test("CZ FO bez rodneho cisla potrebuje datum narodenia AJ pohlavie", () => {
  const bez = { ...CZ_FO_UPLNA } as Record<string, unknown>;
  delete bez.birth_number;
  const f = nalez(osoba("cz", { ...bez, birth_date: "1975-01-01" }));
  assert.ok(f, "bez pohlavia má chýbať");
  assert.match(f?.message ?? "", /pohlaví/);
});

test("CZ FO bez rodneho cisla s datumom aj pohlavim je uplna", () => {
  const bez = { ...CZ_FO_UPLNA } as Record<string, unknown>;
  delete bez.birth_number;
  assert.equal(nalez(osoba("cz", { ...bez, birth_date: "1975-01-01", sex: "muz" })), undefined);
});

test("CZ FO bez mista narodenia je neuplna — § 5 ho ziada vzdy", () => {
  const bez = { ...CZ_FO_UPLNA } as Record<string, unknown>;
  delete bez.birth_place;
  assert.match(nalez(osoba("cz", bez))?.message ?? "", /místo narození/);
});

test("CZ PO nepotrebuje pravnu formu ani zapis v rejstriku — § 5 ich neziada", () => {
  assert.equal(
    nalez(firma("cz", {
      registered_office: "Moulíkova 3, Praha", registry_id: "12345678",
      representatives: ["Jan Novák"],
    })),
    undefined,
  );
});

// --- slovenská sada podle § 7 ods. 1 ---

const SK_FO_UPLNA = {
  birth_number: "750101/1234", residence: "Hlavná 1, Bratislava",
  citizenship: "SR", id_document_type: "obciansky preukaz",
  id_document_number: "AB123456",
};

test("SK FO nepotrebuje miesto narodenia ani pohlavie", () => {
  assert.equal(nalez(osoba("sk", SK_FO_UPLNA)), undefined);
});

test("SK FO nepotrebuje ani vydavatela dokladu a jeho platnost", () => {
  const f = nalez(osoba("sk", SK_FO_UPLNA));
  assert.equal(f, undefined, JSON.stringify(f));
});

test("SK FO bez rodneho cisla staci datum narodenia — pohlavie netreba", () => {
  const bez = { ...SK_FO_UPLNA } as Record<string, unknown>;
  delete bez.birth_number;
  assert.equal(nalez(osoba("sk", { ...bez, birth_date: "1975-01-01" })), undefined);
});

test("SK PO potrebuje oznacenie registra a cislo zapisu", () => {
  const f = nalez(firma("sk", {
    registered_office: "Hlavná 1, Bratislava", registry_id: "12345678",
    representatives: ["Ján Malý"],
  }));
  assert.ok(f, "chýbajúci zápis v registri má byť nález");
  assert.match(f?.message ?? "", /zápis v registri/);
});

test("SK PO s zapisom v registri je uplna", () => {
  assert.equal(
    nalez(firma("sk", {
      registered_office: "Hlavná 1, Bratislava", registry_id: "12345678",
      registry_entry: "OR OS BA I, odd. Sro, vl. 1234/B", representatives: ["Ján Malý"],
    })),
    undefined,
  );
});

// --- podnikatel ---

test("CZ podnikajuca FO potrebuje navyse sidlo a ICO", () => {
  const f = nalez(osoba("cz", { ...CZ_FO_UPLNA, person_type: "sole_trader" }));
  assert.ok(f);
  assert.match(f?.message ?? "", /sídlo/);
  assert.match(f?.message ?? "", /IČO/);
});

test("SK podnikatel potrebuje navyse miesto podnikania a zapis v registri", () => {
  const f = nalez(osoba("sk", { ...SK_FO_UPLNA, person_type: "sole_trader" }));
  assert.ok(f);
  assert.match(f?.message ?? "", /miesto podnikania|zápis v registri/);
});

// --- schéma a strážca neznámej jurisdikcie ---

test("adresa miesta podnikania je v scheme pre obe jurisdikcie", () => {
  const f = FIELDS.find((x) => x.canonical === "business_address");
  assert.ok(f, "chýba pole business_address");
  assert.equal(f?.cz, "místo podnikání");
  assert.equal(f?.sk, "miesto podnikania");
});

test("obe jurisdikcie uz maju overenu sadu — varovanie sa nevydava", () => {
  assert.ok(!validateStore([osoba("sk", SK_FO_UPLNA)], DNES).some((f) => f.code === "AML_RULESET_UNVERIFIED"));
  assert.ok(!validateStore([osoba("cz", CZ_FO_UPLNA)], DNES).some((f) => f.code === "AML_RULESET_UNVERIFIED"));
});

test("neznama jurisdikcia sa nekontroluje ceskymi pravidlami, ale ohlasi sa", () => {
  const pl = osoba("pl" as Jurisdiction, { person_type: "natural_person" });
  const f = validateStore([pl], DNES);
  assert.ok(f.some((x) => x.code === "AML_RULESET_UNVERIFIED"), JSON.stringify(f));
  assert.ok(!f.some((x) => x.code === "AML_INCOMPLETE"));
});
