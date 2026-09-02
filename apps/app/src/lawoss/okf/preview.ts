/** Náhľad „čo vznikne“ — rovnaká logika ako CLI plan, bez disku (všetko chýba). */
import { planEntity, type PlanInput } from "../../../../../lawoss/okf/src/core";
import { entityTypeFor, targetDir, type NovySpisForm } from "./compose-prompt";
import { OKF_TEMPLATES } from "./templates";

export function previewPlan(form: NovySpisForm): string[] {
  const input: PlanInput = {
    type: entityTypeFor(form.subject),
    dir: targetDir(form),
    title: form.title.trim() || "[názov]",
    ico: form.ico.trim() || undefined,
    protistrana: form.protistrana.trim() || undefined,
  };
  return planEntity(input, OKF_TEMPLATES, () => false).entries.map((entry) => entry.path);
}
