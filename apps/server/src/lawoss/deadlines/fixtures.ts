/** Synthetic test factories only. Production never imports this module. */
import { fingerprint, sha256 } from "./hash.js";
import type { CalculationInput, EvidenceRef, HolidaySet, RulePack } from "./types.js";
export function fixtureEvidence(day = "2026-10-23"): EvidenceRef {
  const quote = `Service proof 1 day ${day} synthetic-recipient`;
  return { sourceLineageId: sha256("source.txt"), documentId: "decision", originalId: "decision", relativePath: "source.txt", sha256: sha256(quote), parentChainHashes: [], locator: { locatorId: "appeal", page: null, start: 0, end: quote.length, quote, quoteHash: sha256(quote), preparationHash: null }, retrievedAt: "2026-10-17T12:00:00Z", completeness: "complete" };
}
export function fixtureHolidays(): HolidaySet { const value = { id: "synthetic-holidays", jurisdiction: "cz" as const, years: [2026], dates: ["2026-10-26"], sources: ["https://example.invalid/synthetic"] }; return { ...value, hash: fingerprint(value) }; }
export function fixtureRule(): RulePack { const holidays = fixtureHolidays(); const value = { id: "synthetic", jurisdiction: "cz" as const, legalArea: "civil_procedure" as const, version: "test-1", status: "synthetic_only" as const, effectiveFrom: "2026-01-01", effectiveTo: "2026-12-31", selectionBasis: "actual_service_date" as const, sources: [{ url: "https://example.invalid/synthetic", locator: "SYNTHETIC", textHash: sha256("synthetic"), retrievedAt: "2026-10-17T12:00:00Z" }], duration: { count: 1, unit: "days" as const }, excludeTriggerDay: true, finalDayAdjustment: "next_eligible_day" as const, holidaySetId: holidays.id, holidaySetHash: holidays.hash, coveredYears: [2026], exclusions: ["all real legal use"], reviewedBy: [], reviewedAt: null }; return { ...value, sha256: fingerprint(value) }; }
export function fixtureInput(day = "2026-10-23"): CalculationInput { const evidence = fixtureEvidence(day); return { jurisdiction: "cz", ruleId: "synthetic", ruleVersion: "test-1", ruleEffectiveOn: day, delivery: { kind: "actual_service", evidence, occurredAt: `${day}T12:00:00+02:00`, localDate: day, timeZone: "Europe/Prague", recipientRef: "synthetic-recipient", documentIdentity: evidence.documentId, method: "synthetic actual service" }, evidence: [evidence], uncertainties: [], scenario: "ordinary_actual_service" }; }

/** Explicit isolated authority fixture; never selected by production configuration. */
export function fixtureLedger(): import("./ledger.js").DeadlineReceiptLedger {
  const values = new Map<string, import("./ledger.js").ReceiptUse>();
  return { async run(action) { return action({ current: key => values.get(key) ?? null, advance(key,expected,next) { const old=values.get(key); if (old?.receiptId === next.receiptId && old.bindingHash === next.bindingHash) return true; if ((old?.receiptId ?? null)!==expected) return false; values.set(key,next); return true; },restore(key,expected,previous) { if(values.get(key)?.receiptId!==expected)return; if(previous)values.set(key,previous);else values.delete(key); } }); } };
}
