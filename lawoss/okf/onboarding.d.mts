export interface Inspection {
  root: string;
  level: "office" | "client" | "subject" | "matter" | "unknown" | "conflict";
  confidence: string;
  complete: boolean;
  digest: string | null;
  memorySources: string[];
  issues: { path: string; code: string }[];
}
export interface OnboardingPreview {
  action: "office" | "client" | "subject" | "matter" | "existing";
  mode: "new" | "map" | "trial_clone";
  appFiles: "inside" | "outside";
  root?: string;
  target?: string;
  clientRoot?: string;
  officeMemoryRoot?: string;
  source?: string;
  plan?: { root: string; operations: { path: string; kind: "file" | "directory"; content?: string }[] };
}
export interface OnboardingResult {
  root: string;
  clientRoot?: string;
  matterRoot?: string;
  appFiles: "inside" | "outside";
  trial?: true;
  status?: "applied" | "already_applied" | "rolled_back";
}
export function inspectOnboardingRoot(root: string): Promise<Inspection>;
export function previewOnboarding(input: unknown): Promise<OnboardingPreview>;
export function executeOnboarding(preview: OnboardingPreview, options: { journalDirectory: string; externalProfileDirectory: string }): Promise<OnboardingResult>;
export function recoverOnboardingOperation(preview: OnboardingPreview, options: { journalDirectory: string; externalProfileDirectory: string }, action: "finish" | "rollback"): Promise<OnboardingResult>;

/** Roztriedenie v skúšobnom klone; tvary zodpovedajú `src/triage/types.ts`. */
export type TriageRole = "inbox" | "client_documents" | "research" | "drafts" | "outputs" | "correspondence" | "important_mail";
export interface TriageInventory {
  schema: "lawoss.triage.inventory/v1";
  root: string;
  treeDigest: string;
  language: "sk" | "cs" | "en";
  jurisdiction: "sk" | "cz";
  documents: { id: string; path: string; name: string; ext: string; size: number; sha256: string }[];
  [key: string]: unknown;
}
export interface TriageClassification { schema: "lawoss.triage.classification/v1"; treeDigest: string; matters: unknown[]; documents: { id: string }[] }
export interface TriageMove {
  id: string; from: string; to: string; size: number; sha256: string; role: TriageRole; matter?: string;
  source: "rules" | "model" | "user" | "fallback"; confidence: "high" | "medium" | "low";
  rule?: string; matched?: string; reason?: string; truncated?: boolean; renamed?: boolean;
}
export interface TriagePlan {
  schema: "lawoss.triage.plan/v1";
  runId: string; root: string; treeDigest: string; createdAt: string; language: "sk" | "cs" | "en";
  classification: { used: boolean; digest?: string; documents: number };
  matters: { key: string; title: string; folder: string; date: string; dateSource: "model" | "today"; kind: "contentious" | "non_contentious"; area: string; jurisdiction: "sk" | "cz"; caseNumber?: string; counterparty?: string; court?: string; source: "rules" | "model"; documents: number }[];
  create: { path: string; kind: "file" | "directory"; content?: string }[];
  moves: TriageMove[];
  stays: { id: string; path: string; why: "already_in_place" | "unclear" | "no_inbox" }[];
  fingerprint: string;
}
export type TriageModelProposal = { state: "none" } | { state: "ready"; file: string; documents: number; matters: number } | { state: "stale"; file: string } | { state: "invalid"; file: string; message: string };
export interface TriageRunStatus { runId: string; createdAt: string; state: "applied" | "interrupted" | "undone" | "undoing" | "planned"; moves: number; matters: number; fingerprint: string }
export function verifyTrialClone(root: string, trialJournalDirectory?: string): Promise<{ root: string; source: string; fingerprint: string; journalVerified: boolean }>;
export function prepareTriage(root: string, options?: { trialJournalDirectory?: string; classificationFile?: string; useModelProposal?: boolean; keepInInbox?: readonly string[]; today?: string; now?: Date; jurisdiction?: "sk" | "cz" }): Promise<{ inventory: TriageInventory; plan: TriagePlan; proposal: TriageModelProposal; classification?: TriageClassification }>;
export function replanTriage(inventory: TriageInventory, classification: TriageClassification | undefined, keepInInbox: readonly string[], now?: Date): TriagePlan;
export function parseClassification(value: unknown, inventory: TriageInventory): TriageClassification;
export function applyTriagePlan(plan: unknown, options?: { trialJournalDirectory?: string }): Promise<{ status: "applied" | "already_applied"; runId: string; moved: number; created: number; journal: string }>;
export function undoTriage(root: string, runId: string, options?: { trialJournalDirectory?: string }): Promise<{ status: "undone" | "already_undone"; runId: string; restored: number; removed: number }>;
export function listTriageRuns(root: string): Promise<TriageRunStatus[]>;
