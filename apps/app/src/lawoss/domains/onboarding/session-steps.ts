import { isCommercialSurfaceHidden, isHiddenSettingsTab } from "@/lawoss/feature-flags";

/**
 * 🟡 LAWOSS (MČ 8. 11. 2026): the dots on the in-app onboarding steps count only
 * the steps LAWOSS actually shows. The LAWOSS welcome wizard has its own counter,
 * so these steps are numbered from 1. Upstream counted a fixed 6 (desktop) / 3 (web).
 *
 * Order and skips mirror session-route.tsx: office → audio → dictation → ai →
 * permissions on desktop; the web flow starts at ai. A hidden recorder skips
 * audio and dictation straight to permissions; hidden AI plans finish the
 * onboarding at the ai step, so permissions is never reached after it.
 */
export type SessionOnboardingStage = "office" | "audio" | "dictation" | "ai" | "permissions";

export function visibleSessionOnboardingStages(desktop: boolean): SessionOnboardingStage[] {
  const recorderHidden = isHiddenSettingsTab("recorder");
  const plansHidden = isCommercialSurfaceHidden("ai-plans");
  const stages: SessionOnboardingStage[] = [];
  if (desktop) {
    stages.push("office");
    if (!recorderHidden) stages.push("audio", "dictation");
    // A hidden recorder jumps from audio directly to permissions.
    if (recorderHidden) return [...stages, "permissions"];
  }
  if (plansHidden) return stages;
  return [...stages, "ai", "permissions"];
}

/** Position of a stage among the visible ones, or the last position when it is not listed. */
export function sessionOnboardingStep(stage: SessionOnboardingStage, desktop: boolean): { step: number; total: number } {
  const stages = visibleSessionOnboardingStages(desktop);
  const total = Math.max(1, stages.length);
  const index = stages.indexOf(stage);
  return { step: index >= 0 ? index + 1 : total, total };
}
