/**
 * Hostové API roztriedenia (`/lawoss/triage/*`, apps/server/src/lawoss/triage.ts). Appka posiela
 * len cestu klona, voľby a potvrdenie odtlačku; presuny určuje server z uloženého náhľadu.
 */
import type { TriageRole } from "../../../../../../lawoss/okf/src/triage/rules";

export type TriageApiPath = "status" | "plan" | "replan" | "apply" | "undo" | "grant";
export type TriageClient = { lawossTriage<T>(path: TriageApiPath, body: unknown): Promise<T> };

export type TriageRun = { runId: string; createdAt: string; state: "applied" | "interrupted" | "undone" | "undoing" | "planned"; moves: number; matters: number };
export type TriageStatus = { trial: true; mode: "trial" | "in_place"; root: string; canPlan?: boolean; undoRunId?: string; runs: TriageRun[] } | { trial: false; reason?: string; runs: [] };

/**
 * Beh, ktorý sa dá vrátiť: v klone posledný zapísaný, na mieste len ten, na ktorý sa spotreboval súhlas.
 * Po novom súhlase sa predošlé usporiadanie vrátiť nedá a tlačidlo sa neukáže (rozhodnutie MČ 13. 10. 2026).
 * Na mieste aj prerušený zápis alebo vrátenie (Word pri presune): súhlas je spotrebovaný, iná cesta späť v appke nie je.
 */
export function undoableRun(status: TriageStatus | null): TriageRun | undefined {
  if (!status?.trial) return undefined;
  const applied = status.runs.filter((item) => item.state === "applied");
  return status.mode === "in_place" ? status.runs.find((item) => item.runId === status.undoRunId && item.state !== "undone") : applied[0];
}
/** Náhľad sa pýta, len kým súhlas na mieste nie je spotrebovaný: po zápise ostáva len vrátenie (rozhodnutie MČ 12. 10.). */
export const plansPreview = (state: TriageStatus): boolean => state.trial && state.canPlan !== false;
export type TriageMoveView = {
  id: string; from: string; to: string; size: number; role: TriageRole; matter?: string;
  source: "rules" | "model" | "user" | "fallback"; confidence: "high" | "medium" | "low";
  rule?: string; matched?: string; reason?: string; truncated?: boolean; renamed?: boolean;
  /** Patrí k odškrtnutému priečinku, preto ide na zatriedenie (fix round 3). */
  leftFolder?: string;
};
export type TriageMatterView = { key: string; title: string; folder: string; date: string; dateSource: "model" | "today"; kind: string; caseNumber?: string; counterparty?: string; court?: string; source: "rules" | "model" | "folder"; documents: number; left?: boolean };
export type TriageProposal = { state: "none" } | { state: "ready"; file: string; documents: number; matters: number } | { state: "stale"; file: string } | { state: "invalid"; file: string; message: string };
export type TriagePreview = {
  id: string; fingerprint: string; runId: string; root: string; language: "sk" | "cs" | "en";
  /** `leaveInPlace`: existujúce priečinky, ktoré advokát odškrtol; ostanú nedotknuté. */
  documents: number; keepInInbox: string[]; leaveInPlace?: string[]; classification: { used: boolean; documents: number };
  matters: TriageMatterView[]; moves: TriageMoveView[]; stays: { id: string; path: string; why: "already_in_place" | "unclear" | "no_inbox" }[];
  newFolders: number; proposal?: TriageProposal;
};
export type TriageApplyResult = { status: "applied" | "already_applied"; runId: string; moved: number; created: number };
export type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number; kept: string[] };

export const triageStatus = (client: TriageClient, root: string) => client.lawossTriage<TriageStatus>("status", { root });
/** `leaveInPlace`: odškrtnuté priečinky z predošlého náhľadu; bez neho predvoľba servera (archív, holý rok). */
export const triagePlan = (client: TriageClient, root: string, useModel = false, leaveInPlace?: readonly string[]) =>
  client.lawossTriage<TriagePreview>("plan", { root, ...(useModel ? { useModel: true } : {}), ...(leaveInPlace ? { leaveInPlace } : {}) });
export const triageReplan = (client: TriageClient, id: string, keepInInbox: readonly string[], leaveInPlace?: readonly string[]) =>
  client.lawossTriage<TriagePreview>("replan", { id, keepInInbox, ...(leaveInPlace ? { leaveInPlace } : {}) });
/** Nový zoznam odškrtnutých priečinkov po prepnutí jedného (rozhodnutie 19. 10. 2026). */
export const toggledLeave = (preview: Pick<TriagePreview, "leaveInPlace">, key: string, leave: boolean): string[] =>
  leave ? [...new Set([...(preview.leaveInPlace ?? []), key])] : (preview.leaveInPlace ?? []).filter((item) => item !== key);
export const triageApply = (client: TriageClient, preview: Pick<TriagePreview, "id" | "fingerprint">) => client.lawossTriage<TriageApplyResult>("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
/**
 * Stav po neúspešnom zápise. Prerušený zápis na mieste (Word uprostred presunu) súhlas spotreboval: náhľad treba
 * zahodiť, Potvrdiť by skončilo 403 a „Vrátiť“ sa má ukázať hneď. Zámok pred prvým zápisom súhlas nespotrebuje.
 */
export async function statusAfterFailedApply(client: TriageClient, root: string): Promise<{ status: TriageStatus; keepPreview: boolean } | null> {
  const status = await triageStatus(client, root).catch(() => null);
  return status && { status, keepPreview: plansPreview(status) };
}
export const triageUndo = (client: TriageClient, root: string, runId: string) => client.lawossTriage<TriageUndoResult>("undo", { root, runId, confirm: true });
/** Výslovný súhlas s usporiadaním priečinka klienta na mieste („Áno, usporiadaj“). */
export const triageGrant = (client: TriageClient, root: string) => client.lawossTriage<{ granted: true; root: string }>("grant", { root, confirm: true });

/** Trasa stránky; klon sa odovzdáva v parametri, inak sa použije klon z onboardingu. */
export const TRIAGE_PATH = "/roztriedenie";
export const triageLink = (root?: string) => root ? `${TRIAGE_PATH}?klon=${encodeURIComponent(root)}` : TRIAGE_PATH;
/** Cieľ roztriedenia: priečinok z odkazu, inak skúšobný klon z onboardingu, inak aktívny klient (usporiadanie na mieste). */
export const triageTargetRoot = (input: { param?: string | null; trialRoot?: string | null; activeRoot?: string | null }): string | null =>
  input.param || input.trialRoot || input.activeRoot || null;
/** Vstup do roztriedenia len pre priečinok, ktorý server pustí (skúšobný klon alebo súhlas na mieste). */
export const offersTriageEntry = (status: TriageStatus | null): boolean => status?.trial === true;
