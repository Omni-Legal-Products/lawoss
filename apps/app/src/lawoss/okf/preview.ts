import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
/**
 * Náhľad „čo vznikne“ — rovnaká logika ako CLI `plan`, bez súborového systému.
 * `exists` je jediný vstup zvonku: bez neho je priečinok prázdny a všetko sa
 * vytvára; appka ho plní zo servera, aby existujúce súbory skončili v skupine
 * ZOSTÁVA a nie medzi tým, čo sa zapíše.
 */
import type { WorkingProfile } from "../../../../../lawoss/okf/src/profile";
import { CARD_ALIASES, planEntity, type PlanEntry, type PlanInput } from "../../../../../lawoss/okf/src/core";
import { clientTypeFor, entityTypeFor, targetDir, type NovySpisForm } from "./compose-prompt";
import { LOCALIZED_OKF_TEMPLATES } from "./templates";

export function previewPlan(form: NovySpisForm, exists: (relativePath: string) => boolean = () => false, workingProfile?: WorkingProfile): PlanEntry[] {
  const input: PlanInput = {
    type: entityTypeFor(form.subject),
    workingProfile,
    language: form.documentLanguage,
    advokat: form.advokat?.trim() || undefined,
    dir: targetDir(form),
    title: form.title.trim() || "[názov]",
    ico: !form.identifierType || form.identifierType === "ICO" ? form.ico.trim() || undefined : undefined,
    protistrana: form.protistrana.trim() || undefined,
    jurisdiction: form.jurisdikcia === "SK" ? "sk" : "cz",
    clientType: clientTypeFor(form.subject), country: form.country,
    citizenship: form.citizenship, residenceCountry: form.residenceCountry,
    identifierType: form.identifierType, identifier: form.ico.trim(),
    matterKind: form.matterKind, mode: form.matterMode, klient: form.clientName,
  };
  return planEntity(input, LOCALIZED_OKF_TEMPLATES, exists).entries;
}

/** Zistí existujúce súbory vrátane vnorených pracovných ciest. */
export async function probePlanFiles(client: Pick<LegalworkServerClient, "statWorkspaceFile">, workspaceId: string, target: string,
  form: NovySpisForm, profile?: WorkingProfile): Promise<string[]> {
  const entries = previewPlan(form, () => false, profile);
  const paths = new Set([...entries.map((entry) => entry.path), ...CARD_ALIASES[entityTypeFor(form.subject)]]);
  const stats = await Promise.all([...paths].map(async (path) => ({ path,
    exists: (await client.statWorkspaceFile(workspaceId, target ? `${target}/${path}` : path)).exists })));
  const names = stats.filter((entry) => entry.exists).map((entry) => entry.path);
  previewPlan(form, (path) => names.includes(path), profile); // Odmietni konflikt pred uložením náhľadu do UI.
  return names;
}
