import { describe, expect, test } from "bun:test";
import { encodeDeadlineRecord, parseDeadlineRecord } from "./record.js";
import { proposeDeadline } from "./extract.js";

describe("managed deadline OKF boundary", () => {
  test("missing delivery is never the document date; round trip preserves canonical candidate", () => {
    const candidate = proposeDeadline({ workspaceId: "workspace", matterId: "matter", input: {
      jurisdiction: "cz", ruleId: "cz-civil-appeal", ruleVersion: "2026-proposed", ruleEffectiveOn: "2026-10-17", delivery: null, evidence: [], uncertainties: [],
    } });
    expect(candidate.state).toBe("needs_review");
    expect(candidate.calculation.kind).toBe("indeterminate");
    const text = encodeDeadlineRecord(null, { version: 1, revisions: [candidate], events: [], confirmation: null, export: null }, { id: "event", operationId: "operation", at: "2026-10-17T12:00:00Z", kind: "candidate", revisionHash: candidate.revisionHash, reason: "Manual selection" });
    expect(parseDeadlineRecord(text)?.revisions[0]).toEqual(candidate);
    expect(text).toContain("type: task");
    expect(text).not.toContain("deadlines:\n  -");
    expect(() => parseDeadlineRecord(text + '\n## LAWOSS deadline workflow v1\n{}\n')).toThrow();
  });
});

test("unsupported duration/unit or conflicting excerpt cannot be converted to an ordinary day rule", () => {
  for (const quote of ["Appeal within 30 days", "Appeal within 1 month", "No duration is stated here"]) {
    const input=fixtureInput(); input.evidence[0]!.locator.quote=quote; input.statedDuration=1;
    const candidate=proposeDeadline({workspaceId:"workspace",matterId:"matter",input});
    expect(candidate.input.uncertainties.some(issue=>issue.code==="conflicting_duration")).toBe(true);
  }
});
import { fixtureInput } from "./fixtures.js";
