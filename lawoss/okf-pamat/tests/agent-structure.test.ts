/**
 * Štruktúru riadi agent (rozhodnutie 3 z 25. 9. 2026): vlastné typy, vlastné
 * sekcie a zapojené subjekty. Deterministické ostávajú brány a kritické údaje.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../src/cli.ts";
import { parseRecord, serializeRecord, type OkfRecord } from "../src/record.ts";
import { authorize, newRecord, planWrite, readStore, renderStatus, statusSkeleton, validateStore, ApprovalRequiredError, MEMORY_DIR } from "../src/index.ts";

const D = { today: "2026-10-04" };

function spis(t: { after(fn: () => void): void }): string {
  const dir = mkdtempSync(join(tmpdir(), "okf-agent-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, MEMORY_DIR));
  writeFileSync(join(dir, "_STATUS.md"), statusSkeleton("cz"));
  return dir;
}

function zaznam(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({ id: "X-001", type: "hearing_note", jurisdiction: "cz", title: "Poznámka z jednání",
      description: "Průběh jednání.", created: "2026-10-01", updated: "2026-10-01", truth: "Soud odročil.",
      timeline: [{ date: "2026-10-01", text: "Založeno." }] }),
    ...over,
  };
}

/** Vlastný typ ako text súboru — tak ho agent pošle do CLI. */
const text = (r: OkfRecord) => serializeRecord(r);

function write(dir: string, r: OkfRecord, extra: string[] = []) {
  const file = join(dir, "navrh.md");
  writeFileSync(file, text(r));
  return runCli(["write", dir, "--file", file, "--reason", "test", "--apply", ...extra]);
}

const revision = (dir: string, id: string) => new RegExp(`Revision ${id}: ([a-f0-9]{64})`).exec(runCli(["read", dir]).out)?.[1] ?? "";

// --- 1. vlastné typy ---

test("vlastny typ sa nacita ako L2 zaznam agenta a validator ho len oznaci", () => {
  const r = parseRecord(text(zaznam()));
  assert.equal(r.type, "hearing_note");
  assert.equal(r.layer, "L2");
  const f = validateStore([r], D);
  assert.ok(f.some((x) => x.code === "AGENT_TYPE" && x.severity === "warning"));
  assert.ok(!f.some((x) => x.severity === "error"), JSON.stringify(f));
});

test("vlastny typ v L1 alebo L3 je chyba parsera — branou L1/L3 sa neda obist", () => {
  for (const layer of ["L1", "L3"]) {
    assert.throws(() => parseRecord(text(zaznam()).replace("layer: L2", `layer: ${layer}`)), /vždy do vrstvy L2/);
  }
});

test("typ mimo tvaru identifikatora sa odmietne", () => {
  for (const bad of ["Subject", "hearing note", "\"\""]) {
    assert.throws(() => parseRecord(text(zaznam()).replace("type: hearing_note", `type: ${bad}`)), /typ/i, bad);
  }
});

test("vlastny typ prejde CLI zapisom, index.md, log.md a nie je problemom store", (t) => {
  const dir = spis(t);
  const out = write(dir, zaznam());
  assert.equal(out.code, 0, out.out);
  const store = readStore(dir);
  assert.deepEqual(store.problems, []);
  assert.equal(store.records[0]?.type, "hearing_note");
  assert.equal(runCli(["sync", dir, "--apply"]).code, 0);
  assert.match(readFileSync(join(dir, MEMORY_DIR, "index.md"), "utf8"), /\[X-001\]\(.*\) — hearing_note — Průběh jednání\./);
  assert.match(readFileSync(join(dir, MEMORY_DIR, "log.md"), "utf8"), /Založeno\. — \[X-001\]/);
});

test("vlastny typ podlieha append-only historii a atomicite pravdy", (t) => {
  const dir = spis(t);
  assert.equal(write(dir, zaznam()).code, 0);
  const rev = revision(dir, "X-001");
  const bezStopy = write(dir, zaznam({ updated: "2026-10-02", truth: "Soud rozhodl." }), ["--if-revision", rev]);
  assert.equal(bezStopy.code, 1);
  assert.match(bezStopy.out, /History/);
  const skratena = write(dir, zaznam({ updated: "2026-10-02", timeline: [] }), ["--if-revision", rev]);
  assert.equal(skratena.code, 1);
  assert.match(skratena.out, /skracovať/);
});

// --- 2. vlastné sekcie ---

const SO_SEKCIAMI = text(zaznam()) + "\n## Pokyn klienta\n\nNesmie sa uzavrieť zmier.\n\n### Detail\n- bod\n\n## Pravda\n\nVlastná sekcia v jazyku advokáta.\n";

test("vlastne sekcie sa zachovaju doslovne a v poradi pri round-tripe", () => {
  const r = parseRecord(SO_SEKCIAMI);
  assert.deepEqual(r.sections, [
    { heading: "Pokyn klienta", body: "Nesmie sa uzavrieť zmier.\n\n### Detail\n- bod" },
    { heading: "Pravda", body: "Vlastná sekcia v jazyku advokáta." },
  ]);
  assert.equal(r.truth, "Soud odročil.");
  const znova = serializeRecord(r);
  assert.deepEqual(parseRecord(znova), r);
  assert.equal(serializeRecord(parseRecord(znova)), znova, "druhý round-trip je stabilný");
});

test("sekcia sa pri zapise zachova a jej zmena vyzaduje riadok historie", (t) => {
  const dir = spis(t);
  writeFileSync(join(dir, "navrh.md"), SO_SEKCIAMI);
  assert.equal(runCli(["write", dir, "--file", join(dir, "navrh.md"), "--reason", "test", "--apply"]).code, 0);
  assert.deepEqual(readStore(dir).problems, []);
  const before = readStore(dir).records[0]!;
  const zmena = { ...before, updated: "2026-10-02", sections: [{ heading: "Pokyn klienta", body: "Zmier povolený." }] };
  const out = write(dir, zmena, ["--if-revision", revision(dir, "X-001")]);
  assert.equal(out.code, 1);
  assert.match(out.out, /History/);
  const sStopou = { ...zmena, timeline: [...before.timeline, { date: "2026-10-02", text: "Pokyn zmenený." }] };
  assert.equal(write(dir, sStopou, ["--if-revision", revision(dir, "X-001")]).code, 0);
  assert.deepEqual(readStore(dir).records[0]?.sections, [{ heading: "Pokyn klienta", body: "Zmier povolený." }]);
});

test("klientske meno vo vlastnej sekcii L3 prameňa je unik", () => {
  const s = newRecord({ id: "S-001", type: "subject", jurisdiction: "cz", title: "Jan Novák", description: "d",
    created: "2026-10-01", updated: "2026-10-01", truth: "t", timeline: [] });
  const a = { ...newRecord({ id: "A-001", type: "authority", jurisdiction: "cz", title: "Veta", description: "d",
    created: "2026-10-01", updated: "2026-10-01", truth: "Obecná veta.", timeline: [] }),
    sections: [{ heading: "Poznámka", body: "Týká se věci Jan Novák." }] };
  assert.ok(validateStore([s, a], D).some((f) => f.code === "L3_LEAK"));
});

// --- 3. participants ---

const UCASTNICI = [
  { name: "Krajský soud v Brně", role: "soud", ref: "KSBR 39 INS 1234/2020" },
  { name: "Petr Svoboda", role: "protistrana", contact: "petr@example.invalid", note: "jedná sám" },
];

test("participants prejdu round-tripom a holy retazec je meno", () => {
  const r = zaznam({ type: "matter", id: "M-001", participants: UCASTNICI });
  assert.deepEqual(parseRecord(serializeRecord(r)).participants, UCASTNICI);
  const holy = parseRecord(text(zaznam()).replace("---\n\n## Truth", "participants: [\"Policie ČR\"]\n---\n\n## Truth"));
  assert.deepEqual(holy.participants, [{ name: "Policie ČR" }]);
});

test("zapojeny subjekt bez mena je chyba", () => {
  const r = zaznam({ participants: [{ role: "soud" }] });
  assert.ok(validateStore([r], D).some((f) => f.code === "PARTICIPANT_NAME_MISSING" && f.severity === "error"));
});

test("_STATUS.md ukaze zapojene subjekty spolu so subjektmi, CZ aj SK", () => {
  const s = newRecord({ id: "S-001", type: "subject", jurisdiction: "cz", title: "Klient s.r.o.", description: "d",
    role: "client", created: "2026-10-01", updated: "2026-10-01", truth: "t", timeline: [] });
  const m = zaznam({ type: "matter", id: "M-001", participants: UCASTNICI });
  const cz = renderStatus(statusSkeleton("cz"), [s, m], "cz");
  assert.match(cz, /\| klient \| Klient s\.r\.o\. \|/);
  assert.match(cz, /\*\*Zapojené subjekty\*\*/);
  assert.match(cz, /\| soud \| Krajský soud v Brně \| — \| KSBR 39 INS 1234\/2020 \| — \| M-001 \|/);
  const sk = renderStatus(statusSkeleton("sk"), [{ ...m, jurisdiction: "sk" }], "sk");
  assert.match(sk, /\*\*Zapojené subjekty\*\*/);
  assert.doesNotMatch(sk, /Zúčastnené/, "slovenská popiska je všade Zapojené subjekty");
  assert.doesNotMatch(sk, /\| Rola \| Subjekt \| IČO/, "bez subjektov sa tabuľka strán nekreslí");
});

test("meno zapojeneho subjektu je jehlou uniku do L3", () => {
  const m = zaznam({ type: "matter", id: "M-001", participants: UCASTNICI });
  const a = newRecord({ id: "A-001", type: "authority", jurisdiction: "cz", title: "Veta", description: "d",
    created: "2026-10-01", updated: "2026-10-01", truth: "Protistranou byl Petr Svoboda.", timeline: [] });
  const leak = validateStore([m, a], D).find((f) => f.code === "L3_LEAK");
  assert.ok(leak, "meno zo participants musí byť chytené");
  assert.match(leak.message, /Petr Svoboda/);
});

const prameň = (over: Partial<OkfRecord> = {}): OkfRecord => ({
  ...newRecord({ id: "A-001", type: "authority", jurisdiction: "cz", title: "Veta", description: "d",
    created: "2026-10-01", updated: "2026-10-01", truth: "Obecná veta.", timeline: [] }),
  ...over,
});

test("participants samotneho L3 zaznamu su v kope brany uniku", () => {
  const m = zaznam({ type: "matter", id: "M-001", participants: [{ name: "Jaroslav Kopřivník" }] });
  const a = prameň({ participants: [{ name: "Jaroslav Kopřivník", contact: "+420 777 111 222" }] });
  assert.ok(validateStore([m, a], D).some((f) => f.code === "L3_LEAK" && f.recordId === "A-001"));
});

test("identifikatory z vlastneho typu agenta su jehlami uniku", () => {
  const p = zaznam({ type: "person", id: "P-001", registry_id: "29139643", birth_number: "750101/1234" });
  const a = prameň({ truth: "IČO 29139643, RČ 750101/1234." });
  const leaks = validateStore([p, a], D).filter((f) => f.code === "L3_LEAK");
  assert.ok(leaks.some((f) => /29139643/.test(f.message)), JSON.stringify(leaks));
});

test("verejna institucia v participants nie je jehlou, sukromna osoba ano", () => {
  const m = zaznam({ type: "matter", id: "M-001", participants: [
    { name: "Nejvyšší soud", role: "dovolací soud" }, { name: "Finanční úřad pro hl. m. Prahu" },
    { name: "Policie ČR" }, { name: "Okresná prokuratúra Bratislava" }, { name: "Petr Svoboda" }] });
  const a = prameň({ title: "Nejvyšší soud 22 Cdo 2886/2023",
    truth: "Nejvyšší soud dovodil, že Finanční úřad pro hl. m. Prahu, Policie ČR ani Okresná prokuratúra Bratislava nerozhodují." });
  assert.ok(!validateStore([m, a], D).some((f) => f.code === "L3_LEAK"));
  assert.ok(validateStore([m, prameň({ truth: "Petr Svoboda" })], D).some((f) => f.code === "L3_LEAK"));
});

test("zmena L1 zaznamu na vlastny typ stale vyzaduje schvalenie", () => {
  const pravidlo = newRecord({ id: "R-001", type: "rule", jurisdiction: "cz", title: "Pravidlo", description: "d",
    created: "2026-10-01", updated: "2026-10-01", truth: "Platí.", timeline: [{ date: "2026-10-01", text: "Založeno." }] });
  const prepis: OkfRecord = { ...pravidlo, type: "note_x", layer: "L2", truth: "Pravidlo zrušeno agentem.", updated: "2026-10-02",
    timeline: [...pravidlo.timeline, { date: "2026-10-02", text: "Zrušeno." }] };
  const diff = planWrite(pravidlo, prepis, "test");
  assert.equal(diff.requiresApproval, true);
  assert.equal(diff.layer, "L1");
  assert.throws(() => authorize(diff, undefined), ApprovalRequiredError);
});

// --- 4. nesporné typy ---

test("requirement, instrument a relation su zname L2 typy s popiskami a enumami", () => {
  const rq = zaznam({ id: "RQ-001", type: "requirement", demanded_by: "banka", demanded_from: "klient",
    source: "úvěrová smlouva čl. 5", fulfillment_status: "met" });
  const inst = zaznam({ id: "IN-001", type: "instrument", version: "3", file_hash: "sha256:ab", form: "notarial_deed",
    signed_by: ["Jan Novák", "Eva Malá"], signed_at: "2026-10-01", effect: "převod podílu", instrument_status: "signed",
    related: ["RQ-001"] });
  const rl = zaznam({ id: "RL-001", type: "relation", from_subject: "S-001", to_subject: "S-002",
    relation_kind: "executive", share: "50 %", valid_from: "2024-01-01", verified_at: "2026-10-01" });
  for (const r of [rq, inst, rl]) {
    const back = parseRecord(serializeRecord(r));
    assert.deepEqual(back, r);
    assert.equal(back.layer, "L2");
  }
  const f = validateStore([rq, inst, rl], D);
  assert.ok(!f.some((x) => x.code === "AGENT_TYPE" || x.code === "UNKNOWN_VALUE" || x.severity === "error"), JSON.stringify(f));
  const status = renderStatus(statusSkeleton("sk"), [rq, inst, rl].map((r) => ({ ...r, jurisdiction: "sk" as const })), "sk");
  assert.match(status, /\| RQ-001 \| požiadavka \|/);
  assert.match(status, /\| IN-001 \| listina \|/);
  assert.match(status, /\| RL-001 \| vzťah \|/);
});

test("neznamy stav ci druh vztahu je iba varovanie UNKNOWN_VALUE", () => {
  const f = validateStore([
    zaznam({ id: "RQ-001", type: "requirement", fulfillment_status: "partly" }),
    zaznam({ id: "IN-001", type: "instrument", form: "oral", instrument_status: "lost" }),
    zaznam({ id: "RL-001", type: "relation", relation_kind: "prokurista" }),
  ], D).filter((x) => x.code === "UNKNOWN_VALUE");
  assert.equal(f.length, 4);
  assert.ok(f.every((x) => x.severity === "warning"));
});

test("prefixy RQ-, IN-, RL- nekoliduju s R- ani L-", (t) => {
  const dir = spis(t);
  assert.equal(write(dir, zaznam({ id: "R-001", type: "question" })).code, 0);
  for (const [id, type] of [["RL-001", "relation"], ["RQ-001", "requirement"], ["IN-001", "instrument"]] as const) {
    const out = write(dir, zaznam({ id, type, title: type }));
    assert.equal(out.code, 0, out.out);
  }
  const store = readStore(dir);
  assert.deepEqual(store.problems, []);
  assert.deepEqual(store.records.map((r) => r.id).sort(), ["IN-001", "R-001", "RL-001", "RQ-001"]);
});

// --- 5. kritické údaje ---

test("lehota a termin musia byt platny ISO datum", () => {
  const f = validateStore([
    zaznam({ id: "X-001", deadlines: ["31.12.2026", "2026-02-30", "2026-12-01 odvolání", "2026-12-02"] }),
    zaznam({ id: "T-001", type: "task", state: "pending", due: "zítra" }),
  ], D).filter((x) => x.code === "DATE_INVALID");
  assert.deepEqual(f.map((x) => `${x.recordId}:${/„(.*)"/.exec(x.message)?.[1]}`),
    ["X-001:31.12.2026", "X-001:2026-02-30", "T-001:zítra"]);
  assert.ok(f.every((x) => x.severity === "error"));
});

test("uplynutie lehoty a terminu sa vyhodnocuje iba nad platnym datumom", () => {
  const f = validateStore([
    zaznam({ id: "X-001", deadlines: ["31.12.2025", "2026-09-01 odvolání", "2026-12-01"] }),
    zaznam({ id: "T-001", type: "task", state: "pending", due: "31.12.2025" }),
    zaznam({ id: "T-002", type: "task", state: "pending", due: "2026-09-01" }),
  ], D);
  assert.deepEqual(f.filter((x) => x.code === "DEADLINE_PASSED").map((x) => /Lehota (.*) záznamu/.exec(x.message)?.[1]),
    ["2026-09-01 odvolání"], "„31.12.2025“ textovo nie je minulosť, ale nesmie sa ani vyhodnotiť");
  assert.deepEqual(f.filter((x) => x.code === "TASK_OVERDUE").map((x) => x.recordId), ["T-002"]);
});

test("spisova znacka: CZ a SK tvary prejdu, iny udaj je varovanie", () => {
  const dobre = ["91 INS 5855/2024", "22 Cdo 2886/2023", "5 To 12/2025", "MSPH 91 INS 5855/2024-C1",
    "KSBR 39 INS 1234/2020-B-5", "1Cdo/12/2024", "8Co/123/2019", "31K/12/2019", "I. ÚS 1234/20", "Pl. ÚS 5/20"];
  const zle = ["064-2025", "spis 64/2025", "INS 5855/2024", "2026-10-01", "Novák v. Svoboda", "64/2025"];
  const kod = (ref: string) => validateStore([zaznam({ type: "matter", matter_ref: ref })], D).find((x) => x.code === "CASE_NUMBER_FORMAT");
  for (const ref of dobre) assert.equal(kod(ref), undefined, ref);
  for (const ref of zle) assert.equal(kod(ref)?.severity, "warning", ref);
});
