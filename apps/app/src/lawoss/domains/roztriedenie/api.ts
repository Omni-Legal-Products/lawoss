/**
 * Hostové API roztriedenia (`/lawoss/triage/*`, apps/server/src/lawoss/triage.ts). Appka posiela
 * len cestu klona, voľby a potvrdenie odtlačku; presuny určuje server z uloženého náhľadu.
 */
import type { TriageRole } from "../../../../../../lawoss/okf/src/triage/rules";

export type TriageApiPath = "status" | "plan" | "replan" | "apply" | "undo" | "grant";
export type TriageClient = { lawossTriage<T>(path: TriageApiPath, body: unknown): Promise<T> };

export type TriageRun = { runId: string; createdAt: string; state: "applied" | "interrupted" | "undone" | "undoing" | "planned"; moves: number; matters: number };
export type TriageStatus = { trial: true; mode: "trial" | "in_place"; root: string; runs: TriageRun[] } | { trial: false; reason?: string; runs: [] };
export type TriageMoveView = {
  id: string; from: string; to: string; size: number; role: TriageRole; matter?: string;
  source: "rules" | "model" | "user" | "fallback"; confidence: "high" | "medium" | "low";
  rule?: string; matched?: string; reason?: string; truncated?: boolean; renamed?: boolean;
};
export type TriageMatterView = { key: string; title: string; folder: string; date: string; dateSource: "model" | "today"; kind: string; caseNumber?: string; counterparty?: string; court?: string; source: "rules" | "model"; documents: number };
export type TriageProposal = { state: "none" } | { state: "ready"; file: string; documents: number; matters: number } | { state: "stale"; file: string } | { state: "invalid"; file: string; message: string };
export type TriagePreview = {
  id: string; fingerprint: string; runId: string; root: string; language: "sk" | "cs" | "en";
  documents: number; keepInInbox: string[]; classification: { used: boolean; documents: number };
  matters: TriageMatterView[]; moves: TriageMoveView[]; stays: { id: string; path: string; why: "already_in_place" | "unclear" | "no_inbox" }[];
  newFolders: number; proposal?: TriageProposal;
};
export type TriageApplyResult = { status: "applied" | "already_applied"; runId: string; moved: number; created: number };
export type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number; kept: string[] };

export const triageStatus = (client: TriageClient, root: string) => client.lawossTriage<TriageStatus>("status", { root });
export const triagePlan = (client: TriageClient, root: string, useModel = false) => client.lawossTriage<TriagePreview>("plan", { root, ...(useModel ? { useModel: true } : {}) });
export const triageReplan = (client: TriageClient, id: string, keepInInbox: readonly string[]) => client.lawossTriage<TriagePreview>("replan", { id, keepInInbox });
export const triageApply = (client: TriageClient, preview: Pick<TriagePreview, "id" | "fingerprint">) => client.lawossTriage<TriageApplyResult>("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
export const triageUndo = (client: TriageClient, root: string, runId: string) => client.lawossTriage<TriageUndoResult>("undo", { root, runId, confirm: true });
/** Výslovný súhlas s usporiadaním priečinka klienta na mieste („Áno, usporiadaj“). */
export const triageGrant = (client: TriageClient, root: string) => client.lawossTriage<{ granted: true; root: string }>("grant", { root, confirm: true });

/** Trasa stránky; klon sa odovzdáva v parametri, inak sa použije klon z onboardingu. */
export const TRIAGE_PATH = "/roztriedenie";
export const triageLink = (root?: string) => root ? `${TRIAGE_PATH}?klon=${encodeURIComponent(root)}` : TRIAGE_PATH;
