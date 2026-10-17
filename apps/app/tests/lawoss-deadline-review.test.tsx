import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { DeadlineReviewView } from "../src/lawoss/domains/lehoty/deadline-review";

test("native review shows actual locator, service, source-law status, uncertainty, diff and ICS state", () => {
  const html = renderToStaticMarkup(<DeadlineReviewView locale="cs" busy={false} onDecision={() => {}} onRetry={() => {}} preview={{ candidate: { candidateId: "deadline-test", revisionHash: "abc", state: "needs_review", input: { jurisdiction: "cz", ruleId: "cz-civil-appeal", ruleVersion: "2026-proposed", evidence: [{ relativePath: "decision.txt", locator: { locatorId: "advice", page: 2, start: 100, end: 110, quote: "Appeal advice" } }], delivery: null }, calculation: { kind: "indeterminate", uncertainties: [{ code: "missing_delivery", detail: "Doručení není doloženo." }] } }, reviewHash: "preview", sourceSetHash: "sources", okfDiff: "candidate → confirmed + export_pending", icsPreview: "", warnings: ["Právní profil čeká na schválení."], canConfirm: false, recordHash: "record" }} />);
  expect(html).toContain("Appeal advice"); expect(html).toContain("decision.txt"); expect(html).toContain("2026-proposed"); expect(html).toContain("Doručení není doloženo."); expect(html).toContain("disabled"); expect(html).toContain("export_pending");
});
