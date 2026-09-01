import { test } from "node:test";
import assert from "node:assert/strict";
import { validateStore } from "../src/validate.ts";
import type { OkfRecord } from "../src/record.ts";

function base(over: Partial<OkfRecord>): OkfRecord {
  return {
    okf: 1,
    id: "X-001",
    type: "decision",
    title: "t",
    summary: "s",
    layer: "L2",
    jurisdiction: "cz",
    status: "active",
    created: "2026-08-29",
    updated: "2026-08-29",
    truth: "",
    timeline: [],
    ...over,
  } as OkfRecord;
}

const SUBJEKT = base({
  id: "S-001",
  type: "subject",
  layer: "L2",
  title: "Gh Real Estate s.r.o.",
  registry_id: "29139643",
  birth_date: "1975-04-11",
  truth: "Dlznik v insolvencnom konani.",
});

function codes(fs: ReturnType<typeof validateStore>): string[] {
  return fs.map((f) => f.code);
}

test("pravny pramen s ICO klienta je zablokovany", () => {
  const pramen = base({
    id: "J-001",
    type: "authority",
    layer: "L3",
    truth: "Rozhodnutie sa tykalo spolocnosti s ICO 29139643.",
  });
  const f = validateStore([SUBJEKT, pramen]);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
  assert.equal(f.find((x) => x.code === "L3_LEAK")?.severity, "error");
});

test("pravny pramen s menom klienta je zablokovany", () => {
  const pramen = base({
    id: "J-002",
    type: "authority",
    layer: "L3",
    truth: "Argumentacia pouzita vo veci Gh Real Estate s.r.o.",
  });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("pravny pramen s datumom narodenia klienta je zablokovany", () => {
  const pramen = base({ id: "J-003", type: "authority", layer: "L3", truth: "narodeny 1975-04-11" });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("uniku sa nevyhne ani cez historiu zaznamu", () => {
  const pramen = base({
    id: "J-004",
    type: "authority",
    layer: "L3",
    truth: "cista pravna veta",
    timeline: [{ date: "2026-08-29", text: "prevzate zo spisu ICO 29139643" }],
  });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("cisty pravny pramen prejde", () => {
  const pramen = base({
    id: "J-005",
    type: "authority",
    layer: "L3",
    truth: "29 NSCR 73/2024, odst. 29 — kumulativnost podmienok § 348 ods. 1 IZ.",
  });
  assert.deepEqual(validateStore([SUBJEKT, pramen]), []);
});

test("ten isty udaj v L2 zazname problem nie je", () => {
  const iny = base({ id: "R-001", truth: "ICO 29139643 overene v OR." });
  assert.deepEqual(validateStore([SUBJEKT, iny]), []);
});

test("odkaz na neexistujuci zaznam je nalez", () => {
  const r = base({ id: "R-002", related: ["S-999"] });
  assert.ok(codes(validateStore([SUBJEKT, r])).includes("BROKEN_LINK"));
});

test("duplicitne id je nalez", () => {
  const f = validateStore([base({ id: "R-003" }), base({ id: "R-003" })]);
  assert.ok(codes(f).includes("DUPLICATE_ID"));
});

test("zaznam starsi nez jeho vlastna historia je nalez", () => {
  const r = base({
    id: "R-004",
    updated: "2026-08-01",
    timeline: [{ date: "2026-08-29", text: "novsie nez updated" }],
  });
  assert.ok(codes(validateStore([r])).includes("STALE_UPDATED"));
});

test("wiki-link v texte na neexistujuci zaznam je nalez", () => {
  const r = base({ id: "R-005", truth: "viz [[R-999]]" });
  assert.ok(codes(validateStore([r])).includes("BROKEN_LINK"));
});

// --- tvrdé identifikátory: blokujú vždy, bez ohľadu na dĺžku a formát ---

test("ICO sa pozna aj napisane s medzerami", () => {
  const pramen = base({ id: "J-010", type: "authority", layer: "L3", truth: "spolocnost s ICO 291 396 43" });
  const f = validateStore([SUBJEKT, pramen]);
  assert.ok(codes(f).includes("L3_LEAK"), JSON.stringify(f));
});

test("kratky zahranicny identifikator sa nepreskoci kvoli dlzke", () => {
  const cudzi = base({
    id: "S-002", type: "subject", layer: "L2",
    title: "Zahranicna firma AG", registry_id: "4711", truth: "",
  });
  const pramen = base({ id: "J-011", type: "authority", layer: "L3", truth: "registracne cislo 4711" });
  assert.ok(codes(validateStore([cudzi, pramen])).includes("L3_LEAK"));
});

test("datum narodenia sa pozna aj v ceskom formate", () => {
  const p1 = base({ id: "J-012", type: "authority", layer: "L3", truth: "narodeny 11.04.1975" });
  const p2 = base({ id: "J-013", type: "authority", layer: "L3", truth: "narodeny 11. 4. 1975" });
  assert.ok(codes(validateStore([SUBJEKT, p1])).includes("L3_LEAK"), "11.04.1975");
  assert.ok(codes(validateStore([SUBJEKT, p2])).includes("L3_LEAK"), "11. 4. 1975");
});

test("cislo, ktore nie je identifikatorom, poplach nespusti", () => {
  const pramen = base({ id: "J-014", type: "authority", layer: "L3", truth: "§ 348 ods. 1, R 29139644/2024" });
  assert.deepEqual(validateStore([SUBJEKT, pramen]), []);
});

// --- mená: podľa sily zhody ---

test("nazov firmy sa pozna aj bez pravnej formy", () => {
  const pramen = base({ id: "J-015", type: "authority", layer: "L3", truth: "vo veci Gh Real Estate" });
  assert.ok(codes(validateStore([SUBJEKT, pramen])).includes("L3_LEAK"));
});

test("diakritika rozdiel nerobi", () => {
  const s = base({
    id: "S-003", type: "subject", layer: "L2",
    title: "Stavby Modrý Kámen s.r.o.", truth: "",
  });
  const pramen = base({ id: "J-016", type: "authority", layer: "L3", truth: "vo veci Stavby Modry Kamen" });
  assert.ok(codes(validateStore([s, pramen])).includes("L3_LEAK"));
});

test("samotne kratke priezvisko je varovanie na reviziu, nie chyba", () => {
  const osoba = base({ id: "S-004", type: "subject", layer: "L2", title: "Novák", truth: "" });
  const pramen = base({ id: "J-017", type: "authority", layer: "L3", truth: "zalobca Novák namietal" });
  const f = validateStore([osoba, pramen]);
  const nalez = f.find((x) => x.recordId === "J-017");
  assert.ok(nalez, JSON.stringify(f));
  assert.equal(nalez?.severity, "warning");
  assert.equal(nalez?.code, "L3_LEAK_SUSPECT");
});

test("cele meno je chyba, nie varovanie", () => {
  const osoba = base({ id: "S-005", type: "subject", layer: "L2", title: "Jan Novák", truth: "" });
  const pramen = base({ id: "J-018", type: "authority", layer: "L3", truth: "zalobca Jan Novák namietal" });
  const nalez = validateStore([osoba, pramen]).find((x) => x.recordId === "J-018");
  assert.equal(nalez?.severity, "error");
  assert.equal(nalez?.code, "L3_LEAK");
});

test("meno sa hlada na hranici slova, nie ako podretazec", () => {
  const osoba = base({ id: "S-006", type: "subject", layer: "L2", title: "Rada", truth: "" });
  const pramen = base({ id: "J-019", type: "authority", layer: "L3", truth: "po porade so zastupcom" });
  assert.deepEqual(validateStore([osoba, pramen]), []);
});

test("prilis kratky nazov po odstraneni pravnej formy sa nehlada vobec", () => {
  const s = base({ id: "S-007", type: "subject", layer: "L2", title: "Lex s.r.o.", truth: "" });
  const pramen = base({ id: "J-020", type: "authority", layer: "L3", truth: "podla lexikonu pojmov" });
  assert.deepEqual(validateStore([s, pramen]), []);
});

test("varovanie neblokuje, chyba blokuje", () => {
  const osoba = base({ id: "S-008", type: "subject", layer: "L2", title: "Novák", truth: "" });
  const pramen = base({ id: "J-021", type: "authority", layer: "L3", truth: "zalobca Novák" });
  const f = validateStore([osoba, pramen]);
  assert.equal(f.every((x) => x.severity === "warning"), true, JSON.stringify(f));
});
