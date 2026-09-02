import { test } from "node:test";
import assert from "node:assert/strict";
import { LAYER_OF, RECORD_TYPES, TASK_STATES, typeLabel, valueLabel } from "../src/schema.ts";
import { renderStatus, MARKER_ONLY } from "../src/render.ts";
import { newRecord, validateStore } from "../src/index.ts";
import type { OkfRecord } from "../src/record.ts";

const DNES = { today: "2026-09-02" };

function ukol(over: Partial<OkfRecord> = {}): OkfRecord {
  return {
    ...newRecord({
      id: "T-001", type: "task", jurisdiction: "cz",
      title: "Připravit doplnění k § 348", summary: "argumentace k písm. d)",
      created: "2026-09-02", updated: "2026-09-02", truth: "t",
      timeline: [{ date: "2026-09-02", text: "zadáno" }],
      assignee: "VŘ", state: "pending", priority: "1", due: "2026-09-12",
      acceptance: ["cituje 29 NSČR 73/2024", "obsahuje výpočet z posudku B-209"],
    }),
    ...over,
  };
}

const kody = (r: OkfRecord[]) => validateStore(r, DNES).map((f) => f.code);

test("task je typ vo vrstve L2 s popiskami", () => {
  assert.ok(RECORD_TYPES.includes("task"));
  assert.equal(LAYER_OF.task, "L2");
  assert.equal(typeLabel("task", "cz"), "úkol");
  assert.equal(typeLabel("task", "sk"), "úloha");
});

test("stavy ukolu su vymenovane", () => {
  assert.deepEqual([...TASK_STATES], ["pending", "in_progress", "blocked", "done"]);
  assert.equal(valueLabel("state", "blocked", "cz"), "blokován");
});

test("prezije round-trip vratane akceptacnych kriterii", async () => {
  const { parseRecord, serializeRecord } = await import("../src/record.ts");
  assert.deepEqual(parseRecord(serializeRecord(ukol())), ukol());
});

test("uplny ukol je bez nalezov", () => {
  assert.deepEqual(validateStore([ukol()], DNES), []);
});

// --- závislosti ---

test("cyklus v zavislostiach je chyba", () => {
  const a = ukol({ id: "T-001", depends_on: ["T-002"] });
  const b = ukol({ id: "T-002", depends_on: ["T-001"] });
  const f = validateStore([a, b], DNES).find((x) => x.code === "TASK_CYCLE");
  assert.ok(f, "zacyklený plán si nikto nevšimne");
  assert.equal(f.severity, "error");
});

test("dlhsi cyklus sa najde tiez", () => {
  const r = ["T-001", "T-002", "T-003"].map((id, i, all) =>
    ukol({ id, depends_on: [all[(i + 1) % all.length]!] }));
  assert.ok(kody(r).includes("TASK_CYCLE"));
});

test("retazec bez cyklu chybu nesposobi", () => {
  const r = [
    ukol({ id: "T-001", depends_on: ["T-002"] }),
    ukol({ id: "T-002", depends_on: ["T-003"] }),
    ukol({ id: "T-003" }),
  ];
  assert.ok(!kody(r).includes("TASK_CYCLE"));
});

test("blokovany ukol bez blokatora je varovanie", () => {
  const f = validateStore([ukol({ state: "blocked" })], DNES)
    .find((x) => x.code === "TASK_BLOCKED_WITHOUT_BLOCKER");
  assert.ok(f, "blokovaná úloha bez blokátora je zabudnutá úloha");
  assert.equal(f.severity, "warning");
});

test("blokovany ukol s neuzavretou zavislostou varovanie nesposobi", () => {
  const r = [ukol({ id: "T-001", state: "blocked", depends_on: ["T-002"] }), ukol({ id: "T-002" })];
  assert.ok(!kody(r).includes("TASK_BLOCKED_WITHOUT_BLOCKER"));
});

test("blokovany ukol, ktoreho zavislost je hotova, je varovanie", () => {
  const r = [
    ukol({ id: "T-001", state: "blocked", depends_on: ["T-002"] }),
    ukol({ id: "T-002", state: "done" }),
  ];
  assert.ok(kody(r).includes("TASK_BLOCKED_WITHOUT_BLOCKER"));
});

// --- termín ---

test("zmeskany termin nehotoveho ukolu je varovanie", () => {
  const f = validateStore([ukol({ due: "2026-08-01" })], DNES).find((x) => x.code === "TASK_OVERDUE");
  assert.ok(f);
  assert.equal(f.severity, "warning");
});

test("zmeskany termin hotoveho ukolu varovanie nesposobi", () => {
  assert.ok(!kody([ukol({ due: "2026-08-01", state: "done" })]).includes("TASK_OVERDUE"));
});

test("termin ukolu sa nemieša s procesnou lehotou", () => {
  // `due` je interný záväzok, `deadlines` je procesná lehota. Zámena je
  // nebezpečná: zmeškaný interný termín sa dá dohnať, zmeškaná lehota nie.
  const s = "# Status\n\n## Lhůty\n<!-- okf:render:deadlines:start -->\n<!-- okf:render:deadlines:end -->\n";
  const out = renderStatus(s, [ukol()], "cz");
  assert.doesNotMatch(out, /2026-09-12/, "termín úlohy nepatrí do tabuľky lehôt");
});

// --- projekcia ---

test("ukoly maju vlastny marker-only blok", () => {
  assert.ok(MARKER_ONLY.includes("tasks"));
  const s = "# Status\n\n## 5. Otevřené úkoly\n<!-- okf:render:tasks:start -->\n<!-- okf:render:tasks:end -->\n";
  const out = renderStatus(s, [ukol()], "cz");
  assert.match(out, /T-001/);
  assert.match(out, /Připravit doplnění/);
  assert.match(out, /2026-09-12/);
  assert.equal(renderStatus(out, [ukol()], "cz"), out, "render musí byť idempotentný");
});

test("hotove ukoly sa do prehladu otvorenych nedavaju", () => {
  const s = "# Status\n\n## Úkoly\n<!-- okf:render:tasks:start -->\n<!-- okf:render:tasks:end -->\n";
  const out = renderStatus(s, [ukol({ state: "done" })], "cz");
  const blok = out.split("tasks:start")[1]?.split("tasks:end")[0] ?? "";
  assert.doesNotMatch(blok, /T-001/, "prehľad je o tom, čo zostáva");
  assert.match(blok, /zatím nic/);
  assert.match(out, /T-001/, "v chronológii úloha zostáva — tam patrí");
});
