/** Small, versioned persistence seam for the LAWOSS welcome flow. */
import type { OnboardingPlanRequest, OnboardingPreview } from "./api";

export type PendingOnboarding = {
  request: Pick<OnboardingPlanRequest, "action">;
  value: OnboardingPreview;
};
const PENDING_KEY = "legalwork.lawoss.onboarding.pending.v1";
const isText = (value: unknown, max = 4_096): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const isCanonicalRoot = (value: unknown): value is string => {
  if (!isText(value, 16_384)) return false;
  const path = value.trim();
  if (!/^(?:\/|[A-Za-z]:[\\/])/.test(path)) return false;
  return !path.split(/[\\/]+/).some((part) => part === "." || part === "..");
};
export function readPendingOnboarding(
  storage: Pick<Storage, "getItem"> | null,
): PendingOnboarding | null {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    if (!raw || raw.length > 2 * 1024 * 1024) return null;
    const parsed = JSON.parse(raw);
    const preview = parsed?.value?.preview;
    if (
      !["office", "client", "subject", "matter", "existing"].includes(
        parsed?.request?.action,
      ) ||
      !/^[a-f0-9-]{36}$/.test(parsed?.value?.id) ||
      !/^[a-f0-9]{64}$/.test(parsed?.value?.fingerprint) ||
      !Array.isArray(preview?.operations) ||
      !preview.operations.every((item: unknown) => isText(item)) ||
      (preview.label !== undefined && !isText(preview.label)) ||
      (preview.warnings !== undefined &&
        (!Array.isArray(preview.warnings) ||
          !preview.warnings.every((item: unknown) => isText(item)))) ||
      (preview.officeMemoryRoot !== undefined &&
        !isCanonicalRoot(preview.officeMemoryRoot))
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
export function writePendingOnboarding(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  pending: PendingOnboarding | null,
): void {
  try {
    if (pending)
      storage?.setItem(
        PENDING_KEY,
        JSON.stringify({
          request: { action: pending.request.action },
          value: pending.value,
        }),
      );
    else storage?.removeItem(PENDING_KEY);
  } catch {
    /* Disk journal remains authoritative when browser storage is unavailable. */
  }
}

const ONBOARDING_PROGRESS_STORAGE_KEY = "legalwork.lawoss.onboarding.v1";

export type OnboardingLane = "recommended" | "detailed";
export type OnboardingStep =
  | "identity"
  | "office"
  | "ai"
  | "client"
  | "matter"
  | "done";

export type OnboardingProgress = {
  lane: OnboardingLane;
  step: OnboardingStep;
};

export const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
  lane: "recommended",
  step: "identity",
};

function isLane(value: unknown): value is OnboardingLane {
  return value === "recommended" || value === "detailed";
}

function isStep(value: unknown): value is OnboardingStep {
  return (
    value === "identity" ||
    value === "office" ||
    value === "ai" ||
    value === "client" ||
    value === "matter" ||
    value === "done"
  );
}

export function readOnboardingProgress(
  storage: Pick<Storage, "getItem"> | null,
): OnboardingProgress {
  if (!storage) return DEFAULT_ONBOARDING_PROGRESS;
  try {
    const raw = storage.getItem(ONBOARDING_PROGRESS_STORAGE_KEY);
    if (!raw) return DEFAULT_ONBOARDING_PROGRESS;
    const parsed = JSON.parse(raw) as { lane?: unknown; step?: unknown };
    if (!isLane(parsed?.lane)) return DEFAULT_ONBOARDING_PROGRESS;
    // v1's former folder checkpoint means the Office step in the native flow.
    if (parsed?.step === "folder") return { lane: parsed.lane, step: "office" };
    if (!isStep(parsed?.step)) return DEFAULT_ONBOARDING_PROGRESS;
    return { lane: parsed.lane, step: parsed.step };
  } catch {
    return DEFAULT_ONBOARDING_PROGRESS;
  }
}

export function writeOnboardingProgress(
  storage: Pick<Storage, "setItem"> | null,
  progress: OnboardingProgress,
): void {
  if (!storage) return;
  try {
    storage.setItem(ONBOARDING_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // localStorage can be unavailable or quota-limited; in-memory UI still works.
  }
}
