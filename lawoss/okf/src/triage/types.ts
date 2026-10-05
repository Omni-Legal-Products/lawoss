/** Dátové tvary roztriedenia. Žiadny súborový systém; zdieľa ich CLI, server aj appka. */
import type { DocumentLanguage } from "../language.ts";
import type { CreateOperation } from "../onboarding/transaction.ts";
import type { WorkingProfile } from "../profile.ts";
import type { Confidence, RuleCode, TriageRole } from "./rules.ts";

export const INVENTORY_SCHEMA = "lawoss.triage.inventory/v1";
export const CLASSIFICATION_SCHEMA = "lawoss.triage.classification/v1";
export const PLAN_SCHEMA = "lawoss.triage.plan/v1";

export type TriageDocument = { id: string; path: string; name: string; ext: string; size: number; sha256: string };
export type SkipReason = "system" | "hidden" | "memory" | "in_matter" | "inside_entity" | "already_sorted" | "system_name";
export type ExistingMatter = { id: string; path: string; title?: string; caseKey?: string; roles: Record<string, string> };

export type TriageInventory = {
  schema: typeof INVENTORY_SCHEMA;
  root: string;
  /** SHA-256 súborov klona okrem skrytých (`.lawoss`, `.opencode`, `.DS_Store`). Viaže klasifikáciu aj plán. */
  treeDigest: string;
  language: DocumentLanguage;
  jurisdiction: "sk" | "cz";
  client: { title?: string; card: string };
  profile: { folders: string[]; roles: Record<string, string> };
  /** Kancelársky profil pre nové veci (rovnako ako formulár novej veci); bez neho jazykový default. */
  newMatterProfile?: WorkingProfile;
  matters: ExistingMatter[];
  documents: TriageDocument[];
  skipped: { path: string; reason: SkipReason }[];
  /** Všetky existujúce cesty v klone (aj skryté), aby nový názov nikdy nič neprepísal. */
  occupied: string[];
};

export type MatterKind = "contentious" | "non_contentious";
export type ModelMatter = { key: string; title: string; date?: string; kind: MatterKind; area?: string; caseNumber?: string; counterparty?: string; court?: string };
export type ModelDecision = { id: string; role: TriageRole; matter?: string; confidence: Confidence; reason: string; truncated?: boolean };
export type TriageClassification = { schema: typeof CLASSIFICATION_SCHEMA; treeDigest: string; matters: ModelMatter[]; documents: ModelDecision[] };

export type MoveSource = "rules" | "model" | "user" | "fallback";
export type TriageMove = {
  id: string; from: string; to: string; size: number; sha256: string;
  role: TriageRole; matter?: string; source: MoveSource; confidence: Confidence;
  rule?: RuleCode; matched?: string; reason?: string; truncated?: boolean; renamed?: boolean;
};
export type TriageStay = { id: string; path: string; why: "already_in_place" | "no_inbox" };
export type TriageNewMatter = {
  key: string; title: string; folder: string; date: string; dateSource: "model" | "today";
  kind: MatterKind; area: string; jurisdiction: "sk" | "cz"; caseNumber?: string; counterparty?: string; court?: string;
  source: "rules" | "model"; documents: number;
};
export type TriagePlan = {
  schema: typeof PLAN_SCHEMA;
  runId: string;
  root: string;
  treeDigest: string;
  createdAt: string;
  language: DocumentLanguage;
  classification: { used: boolean; digest?: string; documents: number };
  matters: TriageNewMatter[];
  /** Nové priečinky a súbory (karty nových vecí, chýbajúce pracovné priečinky) v poradí zápisu. */
  create: CreateOperation[];
  moves: TriageMove[];
  stays: TriageStay[];
  fingerprint: string;
};
