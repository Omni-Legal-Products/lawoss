import { addDays, dayDate, dayInZone, weekday } from "../../calendar/dates.js";
import { legalFingerprint } from "./hash.js";
import { uncertainty } from "./extract.js";
import type { Calculation, CalculationInput, HolidaySet, RulePack, Uncertainty } from "./types.js";
export function selectRule(input: CalculationInput, catalogue: readonly RulePack[]): RulePack | Uncertainty {
  const rule = catalogue.find(rule => rule.id === input.ruleId && rule.version === input.ruleVersion && rule.jurisdiction === input.jurisdiction);
  if (!rule || rule.status !== "approved" || !rule.reviewedAt || !rule.reviewedBy.length) return uncertainty("unverified_rule", "No legally approved profile is available for this jurisdiction and version.");
  return rule;
}
export function calculate(input: CalculationInput, rule: RulePack, holidays: HolidaySet): Calculation {
  const fail = (code: Uncertainty["code"], detail: string): Calculation => ({ kind: "indeterminate", uncertainties: [uncertainty(code, detail)] });
  if (input.uncertainties.length) return { kind: "indeterminate", uncertainties: input.uncertainties };
  if (!input.delivery) return fail("missing_delivery", "Proof of actual service is required.");
  const delivery = input.delivery, zone = input.jurisdiction === "cz" ? "Europe/Prague" : "Europe/Bratislava";
  if (input.scenario && input.scenario !== "ordinary_actual_service") return fail("unsupported_scenario", "This service/appeal scenario requires separate legal review.");
  if (delivery.timeZone !== zone || dayInZone(delivery.occurredAt, zone) !== delivery.localDate || input.ruleEffectiveOn !== delivery.localDate) return fail("conflicting_trigger", "Service instant, local date and rule selection date must agree.");
  if (rule.id !== input.ruleId || rule.version !== input.ruleVersion || rule.jurisdiction !== input.jurisdiction || holidays.jurisdiction !== input.jurisdiction || holidays.id !== rule.holidaySetId || holidays.hash !== rule.holidaySetHash) return fail("rule_outside_coverage", "Rule and holiday catalogue binding do not match.");
  if (input.ruleEffectiveOn < rule.effectiveFrom || (rule.effectiveTo !== null && input.ruleEffectiveOn > rule.effectiveTo)) return fail("rule_outside_coverage", "The rule is not effective on the recorded service date.");
  if (input.evidence.some(e => e.completeness !== "complete") || delivery.evidence.completeness !== "complete") return fail("partial_extraction", "Evidence is incomplete.");
  if (input.statedDuration !== undefined && input.statedDuration !== rule.duration.count) return fail("conflicting_duration", "The document's duration differs from the selected rule.");
  dayDate(delivery.localDate);
  let due = addDays(delivery.localDate, rule.duration.count - (rule.excludeTriggerDay ? 0 : 1));
  const trace = [{ operation: "count_days", input: delivery.localDate, output: due, basis: `${rule.id}@${rule.version}: ${rule.duration.count} days; trigger excluded=${rule.excludeTriggerDay}` }];
  const covered = (day: string) => holidays.years.includes(Number(day.slice(0, 4))) && rule.coveredYears.includes(Number(day.slice(0, 4)));
  if (!covered(delivery.localDate) || !covered(due)) return fail("rule_outside_coverage", "The holiday catalogue does not cover every relevant year.");
  if (rule.finalDayAdjustment === "next_eligible_day") {
    for (let shifts = 0; weekday(due) === 0 || weekday(due) === 6 || holidays.dates.includes(due); shifts++) {
      if (shifts >= 366) return fail("rule_outside_coverage", "Holiday adjustment exceeds bounded coverage.");
      const before = due; due = addDays(due, 1);
      trace.push({ operation: "next_eligible_day", input: before, output: due, basis: holidays.dates.includes(before) ? `${holidays.id}: holiday` : `${rule.id}: weekend` });
      if (!covered(due)) return fail("rule_outside_coverage", "Adjustment crosses outside the approved holiday year.");
    }
  }
  return { kind: "determinate", dueDate: due, timeZone: zone, trace, inputHash: legalFingerprint(input), ruleSetHash: rule.sha256, holidaySetHash: holidays.hash };
}
