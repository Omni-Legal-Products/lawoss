// tsc consumes the portable declaration; Bun bundles the implementation for Node.
export { inspectOnboardingRoot, previewOnboarding, executeOnboarding, recoverOnboardingOperation } from "../../../../lawoss/okf/onboarding.mjs";
export type { OnboardingPreview, OnboardingResult } from "../../../../lawoss/okf/onboarding.mjs";
export { applyTriagePlan, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTrialClone } from "../../../../lawoss/okf/onboarding.mjs";
export type { TriageClassification, TriageInventory, TriagePlan } from "../../../../lawoss/okf/onboarding.mjs";
