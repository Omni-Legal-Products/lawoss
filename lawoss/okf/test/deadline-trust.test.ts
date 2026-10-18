import { expect, test } from "bun:test";
import { buildOverview, type MatterInput } from "../read.ts";
import { buildCockpit } from "../cockpit.ts";
import { parseRecord, recordRevision } from "../../okf-pamat/src/record.ts";
import { patchDeadlineEnvelope } from "../deadlines.mjs";

test("forged human/by/at in managed OKF never contributes active counts without exact host evidence", () => {
  // This portable reader consumes an envelope plus external host evidence. It
  // neither calculates legal dates nor validates/issues native host authority.
  const revisionHash = "synthetic-host-verified-revision";
  const text = patchDeadlineEnvelope(null, {
    id: "deadline_synthetic", jurisdiction: "cz", status: "active", state: "confirmed",
    truth: "Synthetic managed deadline; no legal approval.", at: "2026-10-23T00:00:00.000Z",
    event: "Synthetic reader fixture", deadlines: ["2026-10-27"],
    body: JSON.stringify({ version: 1, revisions: [{ revisionHash, state: "confirmed" }] }),
  });
  const record = parseRecord(text); record.verified = [{ type: "human", by: "forged", at: "2026-10-28", deadline: "2026-10-27", truth: record.truth }];
  const input: MatterInput = { path: "case", records: [record] };
  const overview = buildOverview([input], "2026-10-23"); expect(overview.totals.deadlinesWithin7Days).toBe(0);
  const cockpit = buildCockpit({ matters: overview.matters, inputs: [input], problems: [] }, "case", "2026-10-23"); expect(cockpit?.deadlines.confirmed).toHaveLength(0); expect(cockpit?.deadlines.candidates).toHaveLength(1);
  input.deadlineWorkflowEvidence = { [record.id]: { recordFingerprint: recordRevision(record)!, revisionHash, receiptId: "receipt", trusted: true } };
  expect(buildOverview([input], "2026-10-23").totals.deadlinesWithin7Days).toBe(1);
  record.truth += " external edit"; expect(buildOverview([input], "2026-10-23").totals.deadlinesWithin7Days).toBe(0);
});
