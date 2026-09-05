/** Small, versioned persistence seam for the LAWOSS welcome flow. */

export const ONBOARDING_PROGRESS_STORAGE_KEY = "legalwork.lawoss.onboarding.v1";

export type OnboardingLane = "recommended" | "detailed";
export type OnboardingStep = "welcome" | "folder";

export type OnboardingProgress = {
  lane: OnboardingLane;
  step: OnboardingStep;
};

export const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
  lane: "recommended",
  step: "welcome",
};

function isLane(value: unknown): value is OnboardingLane {
  return value === "recommended" || value === "detailed";
}

function isStep(value: unknown): value is OnboardingStep {
  return value === "welcome" || value === "folder";
}

export function readOnboardingProgress(storage: Pick<Storage, "getItem"> | null): OnboardingProgress {
  if (!storage) return DEFAULT_ONBOARDING_PROGRESS;
  try {
    const raw = storage.getItem(ONBOARDING_PROGRESS_STORAGE_KEY);
    if (!raw) return DEFAULT_ONBOARDING_PROGRESS;
    const parsed = JSON.parse(raw) as { lane?: unknown; step?: unknown };
    if (!isLane(parsed?.lane) || !isStep(parsed?.step)) return DEFAULT_ONBOARDING_PROGRESS;
    return { lane: parsed.lane, step: parsed.step };
  } catch {
    return DEFAULT_ONBOARDING_PROGRESS;
  }
}

export function writeOnboardingProgress(storage: Pick<Storage, "setItem"> | null, progress: OnboardingProgress): void {
  if (!storage) return;
  try {
    storage.setItem(ONBOARDING_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // localStorage can be unavailable or quota-limited; in-memory UI still works.
  }
}
