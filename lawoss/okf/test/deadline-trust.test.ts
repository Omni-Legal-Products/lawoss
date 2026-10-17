import { expect, test } from "bun:test";
import { buildOverview, type MatterInput } from "../read.ts";
import { buildCockpit } from "../cockpit.ts";
import { parseRecord, recordRevision } from "../../okf-pamat/src/record.ts";
import { encodeDeadlineRecord } from "../../../apps/server/src/lawoss/deadlines/record.ts";
import { proposeDeadline } from "../../../apps/server/src/lawoss/deadlines/extract.ts";
import { fixtureInput, fixtureRule, fixtureHolidays } from "../../../apps/server/src/lawoss/deadlines/fixtures.ts";
import { calculate } from "../../../apps/server/src/lawoss/deadlines/compute.ts";
import { semanticHash } from "../../../apps/server/src/lawoss/deadlines/record.ts";

test("forged human/by/at in managed OKF never contributes active counts without exact host evidence", () => {
  const proposal = proposeDeadline({ matterId: "matter", workspaceId: "workspace", input: fixtureInput() });
  const next = { ...proposal, state: "confirmed" as const, calculation: calculate(proposal.input, fixtureRule(), fixtureHolidays()) }; next.revisionHash = semanticHash(next);
  const text = encodeDeadlineRecord(null, { version: 1, revisions: [next], events: [], confirmation: null, export: null }, { id: "event", operationId: "operation", at: new Date().toISOString(), kind: "confirmed", revisionHash: next.revisionHash, reason: "Synthetic" });
  const record = parseRecord(text); record.verified = [{ type: "human", by: "forged", at: "2026-10-28", deadline: "2026-10-27", truth: record.truth }];
  const input: MatterInput = { path: "case", records: [record] };
  const overview = buildOverview([input], "2026-10-23"); expect(overview.totals.deadlinesWithin7Days).toBe(0);
  const cockpit = buildCockpit({ matters: overview.matters, inputs: [input], problems: [] }, "case", "2026-10-23"); expect(cockpit?.deadlines.confirmed).toHaveLength(0); expect(cockpit?.deadlines.candidates).toHaveLength(1);
  input.deadlineWorkflowEvidence = { [record.id]: { recordFingerprint: recordRevision(record)!, revisionHash: next.revisionHash, receiptId: "receipt", trusted: true } };
  expect(buildOverview([input], "2026-10-23").totals.deadlinesWithin7Days).toBe(1);
  record.truth += " external edit"; expect(buildOverview([input], "2026-10-23").totals.deadlinesWithin7Days).toBe(0);
});
