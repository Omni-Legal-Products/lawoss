import { expect, test } from "bun:test";
import { calculate, selectRule } from "./compute.js";
import { fixtureInput, fixtureRule, fixtureHolidays } from "./fixtures.js";

test("synthetic date-only profile skips trigger and weekend/holiday chain and refuses missing coverage", () => {
  const rule = fixtureRule(), holidays = fixtureHolidays(), input = fixtureInput("2026-10-23");
  const result = calculate(input, rule, holidays);
  expect(result.kind).toBe("determinate");
  if (result.kind === "determinate") { expect(result.dueDate).toBe("2026-10-27"); expect(result.timeZone).toBe("Europe/Prague"); }
  expect(calculate(input, rule, { ...holidays, years: [] }).kind).toBe("indeterminate");
  expect(selectRule(input, [rule])).toMatchObject({ code: "unverified_rule" });
  expect(calculate({ ...input, scenario: "correction" }, rule, holidays).kind).toBe("indeterminate");
  expect(calculate({ ...input, statedDuration: 15 }, rule, holidays).kind).toBe("indeterminate");
});

import { proposedRulePacks, proposedHolidaySet } from "./rules.js";
test("independent Oct13 oracle distinguishes Czech Oct28 holiday from Slovak ordinary working day", () => {
  for (const jurisdiction of ["cz","sk"] as const) {
    const rule=proposedRulePacks.find(rule=>rule.jurisdiction===jurisdiction)!;
    const input=fixtureInput("2026-10-13"); input.jurisdiction=jurisdiction;input.ruleId=rule.id;input.ruleVersion=rule.version;input.delivery!.timeZone=jurisdiction==="cz"?"Europe/Prague":"Europe/Bratislava";
    const result=calculate(input,rule,proposedHolidaySet(jurisdiction));
    expect(result.kind).toBe("determinate"); if(result.kind==="determinate")expect(result.dueDate).toBe(jurisdiction==="cz"?"2026-10-29":"2026-10-28");
    expect(selectRule(input,proposedRulePacks)).toMatchObject({code:"unverified_rule"});
  }
});
test("2026 Slovak temporary exceptions and nonworking removals are explicit; year boundary is unavailable", () => {
  const holidays=proposedHolidaySet("sk");
  for(const day of ["2026-05-08","2026-09-15","2026-09-01","2026-10-28","2026-11-17"])expect(holidays.dates).not.toContain(day);
  const rule=fixtureRule(), input=fixtureInput("2026-12-31");
  expect(calculate(input,rule,fixtureHolidays()).kind).toBe("indeterminate");
});
