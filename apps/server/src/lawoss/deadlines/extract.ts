import { fingerprint } from "./hash.js";
import { inputSchema } from "./schema.js";
import { semanticHash } from "./record.js";
import type { CandidateRevision, ProposedExtraction, Uncertainty } from "./types.js";
export const uncertainty = (code: Uncertainty["code"], detail: string): Uncertainty => ({ code, detail, evidenceIds: [], blocking: true });
/** Manual and optional model extraction share this untrusted input boundary. */
export function proposeDeadline(proposal: ProposedExtraction): CandidateRevision {
  const input = inputSchema.parse(proposal.input), issues = [...input.uncertainties];
  if (!input.delivery) issues.push(uncertainty("missing_delivery", "Select proof of actual service to the relevant recipient. Document dates are not service."));
  if (input.evidence.some(value => value.completeness !== "complete") || (input.delivery && input.delivery.evidence.completeness !== "complete")) issues.push(uncertainty("partial_extraction", "Selected extraction is incomplete."));
  if (input.scenario && input.scenario !== "ordinary_actual_service") issues.push(uncertainty("unsupported_scenario", "Only ordinary actual service is supported; corrections, deemed service and disputed advice require manual legal review."));
  if (input.delivery && !input.evidence.some(value => value.documentId === input.delivery!.documentIdentity)) issues.push(uncertainty("conflicting_trigger", "Service proof does not identify the selected decision."));
  if (input.delivery) {
    const proof = input.delivery.evidence.locator.quote;
    const dates = new Set([...proof.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)].map(match=>`${match[1]}-${match[2]}-${match[3]}`));
    for (const match of proof.matchAll(/\b(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\b/g)) dates.add(`${match[3]}-${match[2]!.padStart(2,"0")}-${match[1]!.padStart(2,"0")}`);
    if (dates.size !== 1 || !dates.has(input.delivery.localDate) || !proof.toLocaleLowerCase().includes(input.delivery.recipientRef.toLocaleLowerCase())) issues.push(uncertainty("conflicting_trigger","The exact proof excerpt must identify one matching service date and the relevant recipient; conflicting or missing proof facts require review."));
  }
  const excerpt = input.evidence.map(evidence=>evidence.locator.quote).join("\n").toLocaleLowerCase();
  const numeric = [...excerpt.matchAll(/(?<![\p{L}\p{N}_])(\d+)\s*(days?|dn[ůuíiy]?|dní|dň(?:a|ov|ová)?|denn[íi]|day)(?![\p{L}\p{N}_])/gu)].map(match=>Number(match[1]));
  const written = /patnáct|pätnásť|pätnást|patnact/.test(excerpt) ? [15] : [];
  const counts = [...new Set([...numeric,...written])];
  if (input.evidence.length && (counts.length !== 1 || /\b(?:month|week|hour|měsíc|mesiac|týdn|týžd|hodin)/u.test(excerpt) || (input.statedDuration !== undefined && counts[0] !== input.statedDuration))) issues.push(uncertainty("conflicting_duration", "Select an unambiguous day-based duration from the actual appeal advice; unsupported units or disagreement require legal review."));
  else if (counts.length === 1) input.statedDuration = counts[0];
  const candidateId = proposal.candidateId ?? `deadline_${fingerprint({ workspaceId: proposal.workspaceId, matterId: proposal.matterId, lineage: input.evidence.map(e => [e.sourceLineageId, e.locator.locatorId]), recipient: input.delivery?.recipientRef ?? null, ruleId: input.ruleId }).slice(0, 32)}`;
  const candidate = { candidateId, matterId: proposal.matterId, workspaceId: proposal.workspaceId, revision: 1, state: "needs_review" as const, input: { ...input, uncertainties: issues }, calculation: { kind: "indeterminate" as const, uncertainties: issues.length ? issues : [uncertainty("unverified_rule", "A legally approved RulePack is required.")] }, supersedesRevisionHash: null };
  return { ...candidate, revisionHash: semanticHash(candidate) };
}
