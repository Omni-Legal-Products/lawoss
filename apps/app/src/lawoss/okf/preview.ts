/**
 * Náhľad „čo vznikne“ — rovnaká logika ako CLI `plan`, bez súborového systému.
 * `exists` je jediný vstup zvonku: bez neho je priečinok prázdny a všetko sa
 * vytvára; appka ho plní zo servera, aby existujúce súbory skončili v skupine
 * ZOSTÁVA a nie medzi tým, čo sa zapíše.
 */
import { planEntity, type PlanEntry, type PlanInput } from "../../../../../lawoss/okf/src/core";
import { clientTypeFor, entityTypeFor, targetDir, type NovySpisForm } from "./compose-prompt";
import { OKF_TEMPLATES } from "./templates";

export function previewPlan(form: NovySpisForm, exists: (relativePath: string) => boolean = () => false): PlanEntry[] {
  const input: PlanInput = {
    type: entityTypeFor(form.subject),
    dir: targetDir(form),
    title: form.title.trim() || "[názov]",
    ico: !form.identifierType || form.identifierType === "ICO" ? form.ico.trim() || undefined : undefined,
    protistrana: form.protistrana.trim() || undefined,
    jurisdiction: form.jurisdikcia === "SK" ? "sk" : "cz",
    clientType: clientTypeFor(form.subject), country: form.country,
    identifierType: form.identifierType, identifier: form.ico.trim(),
    matterKind: form.matterKind, mode: form.matterMode, klient: form.clientName,
  };
  return planEntity(input, OKF_TEMPLATES, exists).entries;
}
