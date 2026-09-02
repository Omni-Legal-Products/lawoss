import { test } from "node:test";
import assert from "node:assert/strict";
import { parseRecord, serializeRecord } from "../src/record.ts";
import {
  LAYER_OF, RECORD_TYPES, FIELDS, EVIDENCE_KINDS, EVIDENCE_KIND_PROVISION,
  PROOF_STATUS, EVIDENCE_STRENGTH, PROCEDURAL_STATUS, CONFIDENCE, typeLabel,
} from "../src/schema.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-02" };

function subjekt(): OkfRecord {
  return newRecord({
    id: "S-001", type: "subject", jurisdiction: "cz",
    title: "Jan Novák", summary: "klient", created: "2026-09-02", updated: "2026-09-02",
    truth: "t", timeline: [{ date: "2026-09-02", text: "x" }],
    role: "counterparty", registry_id: "12345678",
  });
}

function tvrzenie(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "C-001", type: "claim", jurisdiction: "cz",
      title: "Výpověď byla doručena 12. 6. 2026",
      summary: "sporná otázka doručení výpovědi z nájmu",
      created: "2026-09-02", updated: "2026-09-02",
      truth: "Protistrana tvrdí doručení 12. 6.; klient popírá.",
      timeline: [{ date: "2026-09-02", text: "tvrzeno v žalobě" }],
      claimed_by: "S-001", claimed_at: "2026-06-20", claimed_in: "žaloba, čl. III",
      legal_question: "běh výpovědní doby",
      burden_of_proof: "S-001",
      supporting_evidence: ["E-001"],
      proof_status: "disputed", credibility: "medium",
    }),
    ...over,
  };
}

function dokaz(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "E-001", type: "evidence", jurisdiction: "cz",
      title: "Doručenka datové zprávy", summary: "doklad o doručení výpovědi",
      created: "2026-09-02", updated: "2026-09-02",
      truth: "Doručenka ze systému ISDS, sestava z 20. 6. 2026.",
      timeline: [{ date: "2026-09-02", text: "založeno do spisu" }],
      evidence_kind: "document", origin_date: "2026-06-12", author: "ISDS",
      proves: ["C-001"], evidence_strength: "direct", reliability: "high",
      procedural_status: "proposed",
    }),
    ...over,
  };
}

// --- typy a vrstvy ---

test("claim a evidence su typy vo vrstve L2", () => {
  assert.ok(RECORD_TYPES.includes("claim"));
  assert.ok(RECORD_TYPES.includes("evidence"));
  assert.equal(LAYER_OF.claim, "L2");
  assert.equal(LAYER_OF.evidence, "L2");
});

test("oba typy maju popisok pre obe jurisdikcie", () => {
  assert.equal(typeLabel("claim", "cz"), "tvrzení");
  assert.equal(typeLabel("claim", "sk"), "tvrdenie");
  assert.equal(typeLabel("evidence", "cz"), "důkaz");
  assert.equal(typeLabel("evidence", "sk"), "dôkaz");
});

test("polia oboch typov su v scheme", () => {
  for (const c of [
    "claimed_by", "claimed_at", "claimed_in", "legal_question", "burden_of_proof",
    "supporting_evidence", "contradicting_evidence", "proof_status", "credibility",
    "evidence_kind", "origin_date", "author", "formal_requirements", "proves",
    "evidence_strength", "reliability", "objection", "procedural_status",
  ]) {
    assert.ok(FIELDS.some((f) => f.canonical === c), `chýba pole ${c}`);
  }
});

// --- round-trip ---

test("tvrdenie prejde serializaciou tam a spat bez straty", () => {
  const r = tvrzenie();
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

test("dokaz prejde serializaciou tam a spat bez straty", () => {
  const r = dokaz();
  assert.deepEqual(parseRecord(serializeRecord(r)), r);
});

// --- enumy a právne ukotvenie ---

test("hodnoty enumov su vymenovane a anglicke", () => {
  assert.deepEqual([...PROOF_STATUS], ["proven", "unproven", "disputed"]);
  assert.deepEqual([...EVIDENCE_STRENGTH], ["direct", "indirect"]);
  assert.deepEqual([...PROCEDURAL_STATUS], ["proposed", "taken"]);
  assert.deepEqual([...CONFIDENCE], ["high", "medium", "low"]);
  assert.deepEqual(
    [...EVIDENCE_KINDS],
    ["document", "witness", "expert_opinion", "party_examination", "inspection"],
  );
});

test("ceske ukotvenie druhov dokazu sedi na o. s. r.", () => {
  const cz = EVIDENCE_KIND_PROVISION.cz;
  assert.ok(cz);
  // Overené 2. 9. 2026 v plnom znení: § 129 je listina, § 130 ohliadka.
  assert.match(cz.document, /§ 129/);
  assert.match(cz.witness, /§ 126/);
  assert.match(cz.expert_opinion, /§ 127/);
  assert.match(cz.inspection, /§ 130/);
  assert.match(cz.party_examination, /§ 131/);
  assert.doesNotMatch(cz.document, /§ 125/, "§ 125 je obecný výčet, nie listina");
});

test("slovenske ukotvenie sa nepredstiera", () => {
  assert.equal(EVIDENCE_KIND_PROVISION.sk, undefined,
    "slovenský procesný predpis nebol overený — nesmie sa domýšľať");
});

test("neznamy druh dokazu je varovanie, nie chyba", () => {
  const f = validateStore([tvrzenie(), dokaz({ evidence_kind: "vymysleny" })], DNES)
    .find((x) => x.code === "UNKNOWN_EVIDENCE_KIND");
  assert.ok(f);
  assert.equal(f.severity, "warning");
});

// --- väzby ---

test("odkaz na neexistujuci dokaz je rozbity odkaz", () => {
  const f = validateStore([tvrzenie({ supporting_evidence: ["E-999"] })], DNES);
  assert.ok(f.some((x) => x.code === "BROKEN_LINK"), JSON.stringify(f));
});

test("odkaz z dokazu na neexistujuce tvrdenie je rozbity odkaz", () => {
  const f = validateStore([dokaz({ proves: ["C-999"] })], DNES);
  assert.ok(f.some((x) => x.code === "BROKEN_LINK"), JSON.stringify(f));
});

test("obojsmerna vazba tvrdenie a dokaz musi sediet", () => {
  // Jednosmerne vedená väzba sa po pár mesiacoch rozíde a nikto si toho
  // nevšimne — matica potom ukáže dôkaz, ktorý k tvrdeniu nevedie.
  const f = validateStore([tvrzenie(), dokaz({ proves: [] })], DNES)
    .find((x) => x.code === "LINK_ASYMMETRY");
  assert.ok(f, "asymetria má byť nález");
  assert.equal(f.severity, "warning");
  assert.match(f.message, /C-001/);
  assert.match(f.message, /E-001/);
});

test("suladna obojsmerna vazba nalez nesposobi", () => {
  assert.deepEqual(validateStore([subjekt(), tvrzenie(), dokaz()], DNES), []);
});

test("vyvracajuci dokaz sa kontroluje rovnako", () => {
  const protidokaz = dokaz({ id: "E-002", proves: [] });
  const f = validateStore([tvrzenie({ contradicting_evidence: ["E-002"] }), dokaz(), protidokaz], DNES);
  assert.ok(f.some((x) => x.code === "LINK_ASYMMETRY" && x.message.includes("E-002")), JSON.stringify(f));
});

// --- dôkazy nie sú klientske identifikátory ---

test("udaje z dokazu nie su jehlami detektora uniku", () => {
  // Dôkaz nesie údaje o listine, nie o klientovi. Keby sa jeho autor
  // alebo dátum stali jehlou, každý prameň citujúci ISDS by spadol.
  const pramen = newRecord({
    id: "A-001", type: "authority", jurisdiction: "cz",
    title: "Doručování datovou schránkou", summary: "právní věta",
    created: "2026-09-02", updated: "2026-09-02",
    truth: "Doručenka ze systému ISDS prokazuje okamžik doručení.",
    timeline: [{ date: "2026-09-02", text: "z" }],
  });
  const f = validateStore([subjekt(), tvrzenie(), dokaz(), pramen], DNES);
  assert.ok(!f.some((x) => x.code === "L3_LEAK"), JSON.stringify(f));
});

test("klientsky identifikator v prameni blokuje aj vedla dokazov", () => {
  const pramen = newRecord({
    id: "A-002", type: "authority", jurisdiction: "cz",
    title: "Veta", summary: "p", created: "2026-09-02", updated: "2026-09-02",
    truth: "Ve věci IČO 12345678.", timeline: [{ date: "2026-09-02", text: "z" }],
  });
  const f = validateStore([subjekt(), dokaz(), pramen], DNES);
  assert.ok(f.some((x) => x.code === "L3_LEAK"), JSON.stringify(f));
});
