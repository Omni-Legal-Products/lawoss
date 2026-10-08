// tsc consumes the portable declaration; Bun bundles the implementation for Node.
export { inspectCardLevel, inspectOnboardingRoot, previewOnboarding, suggestOnboardingLevel, executeOnboarding, recoverOnboardingOperation } from "../../../../lawoss/okf/onboarding.mjs";
export type { OnboardingPreview, OnboardingResult, OnboardingSuggestion } from "../../../../lawoss/okf/onboarding.mjs";
export { applyTriagePlan, grantInPlaceReorganize, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTrialClone, verifyTriageTarget } from "../../../../lawoss/okf/onboarding.mjs";
export type { TriageClassification, TriageInventory, TriagePlan } from "../../../../lawoss/okf/onboarding.mjs";
