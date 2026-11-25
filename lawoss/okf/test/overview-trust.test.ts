import { expect, test } from "bun:test";
import { buildOverview, type MatterInput } from "../read.ts";
import { buildCockpit, screeningNeedsAttention } from "../cockpit.ts";
import { parseRecord } from "../../okf-pamat/src/record.ts";

// Syntetické záznamy (fiktívny spis); nič z nich nie je právne overený údaj.
const decision = (verifiedFor: string) => parseRecord(`---
okf: 1
id: D-001
type: decision
title: "Rozsudok"
description: ""
layer: L2
jurisdiction: sk
status: active
created: 2026-11-23
updated: 2026-12-10
deadlines: ["2026-12-28 Lehota na odvolanie", "2027-01-15 Iná lehota"]
verified:
  - type: "human"
    by: "JUDr. Testovacia"
    at: "2026-12-10T09:30:00Z"
    deadline: "${verifiedFor}"
    truth: "Syntetický rozsudok."
---

## Truth

Syntetický rozsudok.

## History

- 2026-12-09 [delivery] — Fikcia doručenia.
`);

const screening = parseRecord(`---
okf: 1
id: SC-001
type: screening
title: "Preverenie protistrany"
description: ""
layer: L2
jurisdiction: sk
status: active
created: 2026-12-10
updated: 2026-12-10
subject_ref: S-001
check_date: 2026-12-10
risk: medium
conclusion: enhanced_diligence
registries: ["Finančná správa: daňový nedoplatok", "Register úpadcov: bez záznamu"]
---

## Truth

Syntetické preverenie.

## History

- 2026-12-10 — Preverenie.
`);

const subject = parseRecord(`---
okf: 1
id: S-001
type: subject
title: "Protistrana, a. s."
description: ""
layer: L2
jurisdiction: sk
status: active
created: 2026-12-10
updated: 2026-12-10
---

## Truth

Syntetický subjekt.

## History

- 2026-12-10 — Subjekt zapísaný.
`);

test("overview and cockpit share one confirmation per deadline, with the verifier", () => {
  const input: MatterInput = { path: "case", records: [decision("2026-12-28 Lehota na odvolanie")] };
  const overview = buildOverview([input], "2026-12-14");
  const byDate = Object.fromEntries(overview.upcomingDeadlines.map((d) => [d.date, d.confirmed === true]));
  expect(byDate).toEqual({ "2026-12-28": true, "2027-01-15": false });
  const cockpit = buildCockpit({ matters: overview.matters, inputs: [input], problems: [] }, "case", "2026-12-14");
  expect(cockpit?.deadlines.confirmed.map((d) => [d.date, d.verifiedBy, d.verifiedAt])).toEqual([["2026-12-28", "JUDr. Testovacia", "2026-12-10"]]);
  expect(cockpit?.deadlines.candidates.map((d) => [d.date, d.verifiedBy])).toEqual([["2027-01-15", undefined]]);
});

test("a confirmation for a different deadline text confirms nothing", () => {
  const input: MatterInput = { path: "case", records: [decision("2026-12-29 Lehota na odvolanie")] };
  expect(buildOverview([input], "2026-12-14").upcomingDeadlines.some((d) => d.confirmed)).toBe(false);
});

test("screenings expose canonical risk, conclusion and verbatim registries without reading free text", () => {
  const input: MatterInput = { path: "case", records: [screening, subject], recordFiles: { "SC-001": "case/memory/SC-001.md" } };
  const overview = buildOverview([input], "2026-12-14");
  const cockpit = buildCockpit({ matters: overview.matters, inputs: [input], problems: [] }, "case", "2026-12-14");
  expect(cockpit?.screenings).toEqual([{ id: "SC-001", title: "Preverenie protistrany", subject: "Protistrana, a. s.", risk: "medium", conclusion: "enhanced_diligence",
    registries: ["Finančná správa: daňový nedoplatok", "Register úpadcov: bez záznamu"], date: "2026-12-10", provenance: "zapísané", file: "case/memory/SC-001.md" }]);
  expect(screeningNeedsAttention({ risk: "medium" })).toBe(true);
  expect(screeningNeedsAttention({ conclusion: "decline" })).toBe(true);
  expect(screeningNeedsAttention({ risk: "low", conclusion: "proceed" })).toBe(false);
  // Voľný text Truth ani názvy registrov riziko nezakladajú.
  expect(screeningNeedsAttention({})).toBe(false);
});
