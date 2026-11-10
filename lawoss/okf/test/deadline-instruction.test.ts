// Rozhodnutie MČ 10. 11. 2026: lehota z pokynu advokáta v chate je zapísaná, nie overená z listiny. Čitatelia (prehľad,
// Dnes, kokpit) ju nesú so značkou `basis: "instruction"`; riadok pokynu vo VSTUPY.md nie je nespracovaný vstup.
import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildOverview, type MatterInput } from "../read.ts";
import { buildCockpit } from "../cockpit.ts";
import { appendInputRow, instructionInputRow, nextInputId, pendingInputs } from "../inputs.ts";
import { parseRecord, type OkfRecord } from "../../okf-pamat/src/record.ts";
import { validateStore } from "../../okf-pamat/src/validate.ts";
import { instructionDeadlineRecord } from "../../okf-handoff/matter-memory-write.mjs";

function composed(card = "---\njurisdiction: sk\n---\n") {
  const dir = mkdtempSync(join(tmpdir(), "lawoss-okf-lehota-pokyn-"));
  try {
    mkdirSync(join(dir, "memory"));
    writeFileSync(join(dir, "matter.md"), card);
    return instructionDeadlineRecord(dir, { date: "2026-11-25", what: "Odpoveď  protistrane", instruction: "odpovedať protistrane\ndo 25. novembra", inputId: "IN-004", today: "2026-11-10" });
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test("lehota z pokynu advokáta: úloha s deadlines a značkou, čitatelia ju ukážu ako neoverenú z listiny", () => {
  const result = composed();
  expect(result).toMatchObject({ code: 0, id: "T-001", jurisdiction: "sk" });
  const record = parseRecord(result.text ?? "");
  expect(record).toMatchObject({ type: "task", layer: "L2", state: "pending", title: "Odpoveď protistrane", deadlines: ["2026-11-25 Odpoveď protistrane"], extra: { deadline_basis: "lawyer_instruction" } });
  expect(record.verified).toBeUndefined();
  expect(record.due).toBeUndefined();
  expect(record.truth).toContain("podľa pokynu advokáta v chate (IN-004), neoverené z listiny");
  expect(record.truth).toContain("„odpovedať protistrane do 25. novembra“");
  expect(record.timeline).toEqual([{ date: "2026-11-10", kind: "request", text: "Lehota 2026-11-25 zapísaná podľa pokynu advokáta v chate (IN-004); neoverená z listiny." }]);
  // The canonical validator has no error for it (a custom field is preserved, not a schema violation).
  expect(validateStore([record]).filter((finding) => finding.severity === "error")).toEqual([]);

  const input: MatterInput = { path: "Spisy/M001", records: [record] };
  const overview = buildOverview([input], "2026-11-10");
  expect(overview.upcomingDeadlines).toMatchObject([{ date: "2026-11-25", raw: "2026-11-25 Odpoveď protistrane", recordId: "T-001", basis: "instruction" }]);
  const cockpit = buildCockpit({ matters: overview.matters, inputs: [input], problems: [] }, "Spisy/M001", "2026-11-10");
  expect(cockpit?.deadlines.confirmed).toHaveLength(0);
  expect(cockpit?.deadlines.candidates).toMatchObject([{ date: "2026-11-25", confirmed: false, basis: "instruction", provenance: "zapísané" }]);

  // After the lawyer's own verification of this date the note goes away; the record's field stays as history.
  const verified: OkfRecord = { ...record, verified: [{ type: "human", by: "JUDr. SYN", at: "2026-11-11T10:00:00Z", deadline: "2026-11-25 Odpoveď protistrane", truth: record.truth }] };
  const after = buildOverview([{ path: "Spisy/M001", records: [verified] }], "2026-11-10");
  expect(after.upcomingDeadlines[0]?.basis).toBeUndefined();
  // A record without the field is unchanged.
  expect(buildOverview([{ path: "Spisy/M001", records: [{ ...record, extra: {} }] }], "2026-11-10").upcomingDeadlines[0]?.basis).toBeUndefined();
});

test("lehota z pokynu advokáta: česká vec má český text; bez jurisdikcie alebo skutočného dňa sa nič nezloží", () => {
  const cz = parseRecord(composed("---\njurisdiction: cz\n---\n").text ?? "");
  expect(cz.jurisdiction).toBe("cz");
  expect(cz.truth).toContain("podle pokynu advokáta v chatu (IN-004), neověřeno z listiny");
  expect(composed("---\ntitle: bez jurisdikcie\n---\n")).toMatchObject({ code: 1 });
  const dir = mkdtempSync(join(tmpdir(), "lawoss-okf-lehota-pokyn-"));
  try {
    writeFileSync(join(dir, "matter.md"), "---\njurisdiction: sk\n---\n");
    for (const date of ["25. novembra", "2026-02-30", "2026-11-25T10:00", ""]) {
      const refused = instructionDeadlineRecord(dir, { date, what: "Odpoveď", instruction: "x", inputId: "IN-001", today: "2026-11-10" });
      expect(refused.code).toBe(1);
      expect(refused.out).toContain("Never derive or compute");
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("riadok pokynu advokáta vo VSTUPY.md je uzavretý a nezvyšuje počet nespracovaných vstupov", () => {
  const row = instructionInputRow("IN-001", "2026-11-10T09:30:00+01:00", "odpovedať | protistrane do 25. novembra", "T-001");
  expect(row).toBe("| IN-001 | 2026-11-10T09:30:00+01:00 | pokyn advokáta v chate (LAWOSS): „odpovedať   protistrane do 25. novembra“ | — | processed | T-001 |");
  const register = appendInputRow(null, row, "M001");
  expect(pendingInputs({ path: "Spisy/M001", records: [], intake: register })).toEqual([]);
  expect(nextInputId(register)).toBe("IN-002");
});
