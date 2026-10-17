import type { LegalworkServerClient, LawossDocumentSummary } from "@/app/lib/legalwork-server";
export type DeadlineReviewDto = { candidate: { candidateId: string; revisionHash: string; state: string; input: { jurisdiction: "cz" | "sk"; ruleId: string; ruleVersion: string; evidence: readonly { relativePath: string; locator: { locatorId: string; page: number | null; start: number; end: number; quote: string } }[]; delivery: { evidence?: { relativePath: string; locator: { locatorId: string; page: number | null; quote: string } }; localDate: string; occurredAt: string; recipientRef: string; method: string; timeZone: string } | null }; calculation: { kind: "determinate"; dueDate: string; timeZone: string; trace: readonly { operation: string; input: string; output: string; basis: string }[] } | { kind: "indeterminate"; uncertainties: readonly { code: string; detail: string }[] } }; reviewHash: string; sourceSetHash: string; okfDiff: string; icsPreview: string; warnings: readonly string[]; canConfirm: boolean; recordHash: string };
export type DeadlineItemDto = { candidateId: string; revisionHash: string; state: string; exportState: string; recordHash: string; trusted: boolean; candidate: DeadlineReviewDto["candidate"]; error?: string };
export type DeadlineAvailability = { enabled: boolean; legalReviewRequired: boolean; proposedProfiles: readonly { id: string; version: string; jurisdiction: "cz" | "sk"; status: string; sources: readonly { url: string; locator: string }[]; exclusions: readonly string[] }[] };
export type SelectedExcerpt = { documentId: string; locator: { locatorId: string; page: number | null; start: number; end: number; quote: string; quoteHash: string; preparationHash: string } };
export async function textHash(text: string): Promise<string> { return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)))].map(value => value.toString(16).padStart(2,"0")).join(""); }
export async function readDeadlineSource(client: LegalworkServerClient, workspaceId: string, documentId: string, signal?: AbortSignal): Promise<{ text: string; hash: string }> {
  let offset: number | null = 0, text = "", hash = ""; const seen = new Set<number>();
  while (offset !== null) { signal?.throwIfAborted(); if (seen.has(offset) || text.length > 2_000_000) throw new Error("Incomplete prepared text."); seen.add(offset); const read = await client.readLawossDocument(workspaceId, documentId, offset,16000,{signal}); signal?.throwIfAborted(); if (read.offset !== offset || (hash && hash !== read.hash)) throw new Error("Document changed."); hash = read.hash; text += read.text; offset = read.nextOffset; }
  return { text, hash };
}
export async function listDeadlineDocuments(client: LegalworkServerClient, workspaceId: string, matterPath: string, signal?: AbortSignal): Promise<LawossDocumentSummary[]> {
  let offset: number | null = 0; const all: LawossDocumentSummary[] = [], seen = new Set<number>();
  while (offset !== null) { signal?.throwIfAborted(); if (seen.has(offset) || all.length > 500) throw new Error("Incomplete document listing."); seen.add(offset); const page = await client.listLawossDocuments(workspaceId, offset,50,{signal}); signal?.throwIfAborted(); all.push(...page.documents); offset = page.nextOffset; }
  return all.filter(document => !matterPath || document.provenance.sourcePath.startsWith(`${matterPath}/`));
}

export type DeadlineOwner = { baseUrl: string; token: string; authGeneration: number; scopeKey: string; workspaceId: string; matterPath: string };
export type DeadlineQueryClient = Pick<LegalworkServerClient,"lawossDeadlineRequest">;
export function deadlineOwnerKey(owner: DeadlineOwner): string { return JSON.stringify([owner.baseUrl,owner.token,owner.authGeneration,owner.scopeKey,owner.workspaceId,owner.matterPath]); }
export function deadlineQueryOptions<T>(owner: DeadlineOwner,client: DeadlineQueryClient,suffix: string,enabled: boolean) {
  return { queryKey:["lawoss-deadlines",deadlineOwnerKey(owner),suffix],enabled,queryFn:async({signal}:{signal:AbortSignal}):Promise<T>=>{signal.throwIfAborted();const result=await client.lawossDeadlineRequest<T>(owner.workspaceId,suffix,undefined,{signal});signal.throwIfAborted();return result;} };
}
export function deadlineDocumentsQueryOptions(owner:DeadlineOwner,client:LegalworkServerClient,enabled:boolean){return{queryKey:["lawoss-deadlines",deadlineOwnerKey(owner),"documents"],enabled,queryFn:({signal}:{signal:AbortSignal})=>listDeadlineDocuments(client,owner.workspaceId,owner.matterPath,signal)};}
/** Captures one native owner for a read/mutation or delayed excerpt hash. */
export function createDeadlineOwnerLease(){
  const controller=new AbortController();
  return{signal:controller.signal,dispose:()=>controller.abort(new DOMException("Deadline owner changed.","AbortError")),async run<T>(action:(signal:AbortSignal)=>Promise<T>,publish?:(value:T)=>void):Promise<T>{controller.signal.throwIfAborted();const value=await action(controller.signal);controller.signal.throwIfAborted();publish?.(value);return value;}};
}
