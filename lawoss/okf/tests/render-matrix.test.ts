import { test } from "node:test";
import assert from "node:assert/strict";
import { renderStatus, BLOCKS } from "../src/render.ts";
import { valueLabel } from "../src/schema.ts";
import { newRecord } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const SABLONA = `# Status

## 5. Dokazování
<!-- okf:render:evidence_matrix:start -->
<!-- okf:render:evidence_matrix:end -->
`;

function tvrdenie(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "C-001", type: "claim", jurisdiction: "cz",
      title: "Výpověď byla doručena", summary: "sporné doručení",
      created: "2026-09-02", updated: "2026-09-02", truth: "t",
      timeline: [{ date: "2026-09-02", text: "x" }],
      burden_of_proof: "S-002", proof_status: "disputed", credibility: "medium",
      supporting_evidence: ["E-001"],
    }),
    ...over,
  };
}

function dokaz(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "E-001", type: "evidence", jurisdiction: "cz",
      title: "Doručenka", summary: "doklad", created: "2026-09-02", updated: "2026-09-02",
      truth: "t", timeline: [{ date: "2026-09-02", text: "x" }],
      evidence_kind: "document", evidence_strength: "direct", reliability: "high",
      proves: ["C-001"],
    }),
    ...over,
  };
}

const matica = (records: OkfRecord[], j: "cz" | "sk" = "cz"): string => {
  const out = renderStatus(SABLONA, records, j);
  return out.split("evidence_matrix:start")[1]?.split("evidence_matrix:end")[0] ?? "";
};

// --- blok a markery ---

test("evidence_matrix je blok schemy", () => {
  assert.ok(BLOCKS.includes("evidence_matrix"));
});

test("matica sa sama do _STATUS.md nepridava", () => {
  const out = renderStatus("# Status\n", [tvrdenie(), dokaz()], "cz");
  assert.doesNotMatch(out, /evidence_matrix/,
    "dokazovanie je vlastná sekcia advokáta — renderuje sa len tam, kde si ju vyžiadal");
});

test("marker je kanonicky, hlavicky jurisdikcne", () => {
  assert.match(matica([tvrdenie(), dokaz()], "cz"), /Tvrzení/);
  assert.match(matica([tvrdenie(), dokaz()], "sk"), /Tvrdenie/);
});

// --- obsah matice ---

test("riadky su tvrdenia, stlpce dokazy", () => {
  const m = matica([tvrdenie(), dokaz()]);
  assert.match(m, /\| E-001 \|/, "dôkaz má byť stĺpec");
  assert.match(m, /\| C-001 \|/, "tvrdenie má byť riadok");
});

test("priamy a spolahlivy dokaz ma najsilnejsiu znacku", () => {
  assert.match(matica([tvrdenie(), dokaz()]), /✓✓/);
});

test("nepriamy dokaz ma slabsiu znacku", () => {
  const m = matica([tvrdenie(), dokaz({ evidence_strength: "indirect" })]);
  const riadok = m.split('\n').find((l) => l.startsWith("| C-001 |")) ?? "";
  assert.match(riadok, /~/);
  assert.doesNotMatch(riadok, /✓✓/, "legenda ✓✓ obsahuje vždy — kontroluje sa riadok, nie blok");
});

test("vyvracajuci dokaz ma vlastnu znacku", () => {
  const m = matica([
    tvrdenie({ supporting_evidence: [], contradicting_evidence: ["E-001"] }),
    dokaz(),
  ]);
  assert.match(m, /✗/);
});

test("nesuvisiaci dokaz ma prazdnu bunku", () => {
  const m = matica([
    tvrdenie({ supporting_evidence: [] }),
    dokaz({ proves: [] }),
  ]);
  assert.match(m, /\| – \|/);
});

test("pod maticou je legenda", () => {
  const m = matica([tvrdenie(), dokaz()]);
  assert.match(m, /✓✓/);
  assert.match(m, /priamy|přímý/i);
});

// --- dôkazné bremeno ---

test("pod maticou sa renderuje dokazne bremeno", () => {
  const m = matica([tvrdenie(), dokaz()]);
  assert.match(m, /S-002/, "kto nesie bremeno");
  assert.match(m, /sporné/, "stav preukázania lokalizovane");
});

test("stav preukazania sa zobrazuje, nie odvodzuje", () => {
  // Tri podporujúce dôkazy a napriek tomu „neprokázáno" — hodnotu zapísal
  // advokát a nástroj ju nesmie prepočítať. „Tri dôkazy = preukázané"
  // je právna domnienka, nie výpočet.
  const m = matica([
    tvrdenie({ proof_status: "unproven", supporting_evidence: ["E-001", "E-002", "E-003"] }),
    dokaz(),
    dokaz({ id: "E-002", proves: ["C-001"] }),
    dokaz({ id: "E-003", proves: ["C-001"] }),
  ]);
  assert.match(m, /neprokázáno/);
  assert.doesNotMatch(m, /\bprokázáno\b(?!.*neprokázáno)/);
});

// --- hraničné stavy ---

test("bez tvrdeni zostane blok prazdny, nie rozbity", () => {
  const m = matica([dokaz({ proves: [] })]);
  assert.match(m, /zatím nic|zatiaľ nič/);
});

test("render je idempotentny", () => {
  const raz = renderStatus(SABLONA, [tvrdenie(), dokaz()], "cz");
  assert.equal(renderStatus(raz, [tvrdenie(), dokaz()], "cz"), raz);
});

test("tvrdenie bez dokazov sa v matici objavi aj tak", () => {
  const m = matica([tvrdenie({ supporting_evidence: [] })]);
  assert.match(m, /C-001/, "tvrdenie bez opory je práve to, čo treba vidieť");
});

// --- popisky hodnôt ---

test("valueLabel prelozi hodnotu enumu do jazyka pouzivatela", () => {
  assert.equal(valueLabel("proof_status", "proven", "cz"), "prokázáno");
  assert.equal(valueLabel("proof_status", "proven", "sk"), "preukázané");
  assert.equal(valueLabel("evidence_kind", "document", "cz"), "listina");
  assert.equal(valueLabel("evidence_kind", "inspection", "cz"), "ohledání");
});

test("valueLabel neznamu hodnotu vrati tak, ako je", () => {
  assert.equal(valueLabel("proof_status", "vymyslene", "cz"), "vymyslene");
  assert.equal(valueLabel("neznamePole", "x", "cz"), "x");
});
