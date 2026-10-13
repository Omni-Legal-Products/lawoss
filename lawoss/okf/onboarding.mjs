// Portable seam bundled into the server release by Bun.
import { parseOnboardingRequest, planOnboarding, applyOnboarding, recoverOnboarding } from "./src/onboarding/onboarding.ts";
export { inspectCardLevel, inspectOnboardingRoot } from "./src/onboarding/classify.ts";
export { suggestOnboardingLevel } from "./src/onboarding/suggest.ts";
export const previewOnboarding = (input) => planOnboarding(parseOnboardingRequest(input));
export const executeOnboarding = (preview, options) => applyOnboarding(preview, options);
export const recoverOnboardingOperation = (preview, options, action) => recoverOnboarding(preview, options, action);
// Roztriedenie dokumentov v skúšobnom klone (server appky).
export { applyTriagePlan, grantInPlaceReorganize, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTrialClone, verifyTriageTarget } from "./src/triage/index.ts";
