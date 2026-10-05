/** Roztriedenie spisu v skúšobnom klone: inventár → pravidlá (a voliteľne model) → plán → zápis → vrátenie. */
import { basename } from "node:path";
import { parseClassification } from "./classification.ts";
import { listClassificationFiles, readJsonFile } from "./files.ts";
import { buildTriagePlan } from "./plan.ts";
import { newRunId } from "./apply.ts";
import { scanTriage } from "./scan.ts";
import type { TriageClassification, TriageInventory, TriagePlan } from "./types.ts";

export { applyTriagePlan, listTriageRuns, newRunId, parseTriagePlan, undoTriage, TriageConflictError, type TriageApplyResult, type TriageRunStatus, type TriageUndoResult } from "./apply.ts";
export { ClassificationError, parseClassification } from "./classification.ts";
export { buildTriagePlan, planFingerprint } from "./plan.ts";
export { classifyByRules, findCaseNumber, TRIAGE_ROLES, type RuleCode, type TriageRole } from "./rules.ts";
export { looksLikeTrialName, scanTriage, TrialCloneError, TRIAL_MARKER, verifyTrialClone } from "./scan.ts";
export * from "./types.ts";

export type ModelProposal = { state: "none" } | { state: "ready"; file: string; documents: number; matters: number } | { state: "stale"; file: string } | { state: "invalid"; file: string; message: string };

/** Najnovšia klasifikácia od modelu v klone a či sedí na aktuálny stav. Neplatná sa nikdy nepoužije. */
export async function latestModelProposal(inventory: TriageInventory): Promise<{ proposal: ModelProposal; classification?: TriageClassification }> {
  const [file] = await listClassificationFiles(inventory.root);
  if (!file) return { proposal: { state: "none" } };
  let raw: unknown;
  try { raw = await readJsonFile(file); }
  catch (error) { return { proposal: { state: "invalid", file: basename(file), message: error instanceof Error ? error.message : String(error) } }; }
  if (raw && typeof raw === "object" && "treeDigest" in raw && raw.treeDigest !== inventory.treeDigest) return { proposal: { state: "stale", file: basename(file) } };
  try {
    const classification = parseClassification(raw, inventory);
    return { proposal: { state: "ready", file: basename(file), documents: classification.documents.length, matters: classification.matters.length }, classification };
  } catch (error) { return { proposal: { state: "invalid", file: basename(file), message: error instanceof Error ? error.message : String(error) } }; }
}

export type PrepareOptions = {
  trialJournalDirectory?: string;
  /** Klasifikácia z konkrétneho súboru (CLI, skill). */
  classificationFile?: string;
  /** Najnovšia platná klasifikácia z `.lawoss/triage/classifications/` (appka). */
  useModelProposal?: boolean;
  keepInInbox?: readonly string[];
  today?: string;
  now?: Date;
  /** Jurisdikcia z profilu onboardingu; karta klienta ju nenesie. */
  jurisdiction?: "sk" | "cz";
};

export async function prepareTriage(root: string, options: PrepareOptions = {}): Promise<{ inventory: TriageInventory; plan: TriagePlan; proposal: ModelProposal; classification?: TriageClassification }> {
  const inventory = await scanTriage(root, { trialJournalDirectory: options.trialJournalDirectory, jurisdiction: options.jurisdiction });
  let classification: TriageClassification | undefined;
  let proposal: ModelProposal = { state: "none" };
  if (options.classificationFile) classification = parseClassification(await readJsonFile(options.classificationFile), inventory);
  else {
    const latest = await latestModelProposal(inventory);
    proposal = latest.proposal;
    if (options.useModelProposal) classification = latest.classification;
  }
  const now = options.now ?? new Date();
  const plan = buildTriagePlan(inventory, { classification, keepInInbox: options.keepInInbox, today: options.today ?? now.toISOString().slice(0, 10), runId: newRunId(now), createdAt: now.toISOString() });
  return { inventory, plan, proposal, ...(classification ? { classification } : {}) };
}

/** Ten istý inventár s inými voľbami (napr. ponechať dokument na zatriedenie) bez nového čítania disku. */
export function replanTriage(inventory: TriageInventory, classification: TriageClassification | undefined, keepInInbox: readonly string[], now: Date = new Date()): TriagePlan {
  return buildTriagePlan(inventory, { classification, keepInInbox, today: now.toISOString().slice(0, 10), runId: newRunId(now), createdAt: now.toISOString() });
}
