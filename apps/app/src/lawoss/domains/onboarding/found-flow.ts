/**
 * Logika obrazovky „Toto som našiel“ (spec 2026-10-08): predvolené hodnoty, hromadné pridanie
 * OKF súborov, pripojenie praxe a začiatok usporiadania na mieste. Bez Reactu, aby sa dala testovať.
 */
import type { Language } from "@/i18n";
import { hasLegalForm } from "../../../../../../lawoss/okf/src/onboarding/suggest-patterns";
import { triageGrant, triagePlan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import type { DocumentLanguage, ExistingPlanRequest, Jurisdiction, OfficePlanRequest, OnboardingApi, OnboardingApplyResult, OnboardingSuggestion, PracticePlanRequest } from "./api";

export type FoundIdentity = { lawyerName: string; jurisdiction: Jurisdiction; language: Language };
export type BatchItem = { root: string; name: string; status: "pending" | "done" | "failed"; error?: string; result?: OnboardingApplyResult };
type FlowApi = Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile">;

const separatorOf = (root: string) => (root.includes("\\") && !root.includes("/") ? "\\" : "/");
const trimEnd = (root: string) => root.replace(/[\\/]+$/, "");

export function folderName(root: string): string {
  return trimEnd(root).split(/[\\/]/).pop() ?? root;
}

export function parentPath(root: string): string {
  const trimmed = trimEnd(root);
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 0 ? trimmed.slice(0, index) : trimmed;
}

/**
 * Klient veci (R9): priamy rodič, pri veci v `<klient>/Spisy/<vec>` (štruktúra OKF) rodič priečinka Spisy.
 */
export function matterClientPath(root: string): string {
  const parent = parentPath(root);
  return folderName(parent).toLowerCase() === "spisy" ? parentPath(parent) : parent;
}

/** Cesta klienta z relatívnej cesty návrhu (vždy s „/“) v oddeľovači koreňa. */
export function childPath(root: string, relative: string): string {
  const separator = separatorOf(root);
  return [trimEnd(root), ...relative.split("/").filter(Boolean)].join(separator);
}

/** Jazyk dokumentov OKF: slovenčina, čeština alebo angličtina (nemecké rozhranie píše anglicky). */
export function documentLanguage(language: Language): DocumentLanguage {
  return language === "cs" ? "cs" : language === "sk" ? "sk" : "en";
}

/** Miestny deň (nie UTC): karta vytvorená o 0.30 alebo 23.30 nesie dnešný dátum advokáta. */
const isoDay = (date: Date) => [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((part, index) => String(part).padStart(index ? 2 : 4, "0")).join("-");

/** „Začať nanovo“: kancelária v novom priečinku; jazyk dokumentov ako pri ostatných zápisoch OKF. */
export function freshOfficeRequest(parent: string, identity: FoundIdentity): OfficePlanRequest {
  return { action: "office", parent, title: "LAWOSS", jurisdiction: identity.jurisdiction, language: documentLanguage(identity.language), lawyerName: identity.lawyerName };
}

/** „Začať nanovo“ zapisuje len do prázdneho priečinka (návrh bez položiek má signál `empty`). */
export function isEmptyFolderSuggestion(suggestion: OnboardingSuggestion): boolean {
  return suggestion.level === "unknown" && suggestion.signals.includes("empty");
}

/** „Nie, len pridaj OKF súbory“ bez formulára (R5): názov a typ z mena priečinka, zvyšok z kroku Ty. */
export function convertRequest(root: string, identity: FoundIdentity, today: Date): ExistingPlanRequest {
  const title = folderName(root);
  return {
    action: "existing", root, mode: "convert", title,
    clientType: hasLegalForm(title) ? "po" : "fo",
    jurisdiction: identity.jurisdiction, date: isoDay(today), language: documentLanguage(identity.language),
    confirmUnknownClient: true,
  };
}

export function practiceRequest(root: string, identity: FoundIdentity, suggestion: OnboardingSuggestion, scope: "client" | "practice"): PracticePlanRequest {
  return {
    action: "practice", root, title: folderName(root),
    jurisdiction: identity.jurisdiction, language: documentLanguage(identity.language), lawyerName: identity.lawyerName,
    clientPattern: suggestion.clientPattern ?? "*", scope,
  };
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

async function convertOne(api: FlowApi, item: { root: string; name: string }, identity: FoundIdentity, today: Date): Promise<BatchItem> {
  try {
    const preview = await api.planOnboarding(convertRequest(item.root, identity, today));
    const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
    return { ...item, status: "done", result };
  } catch (reason) {
    return { ...item, status: "failed", error: errorText(reason) };
  }
}

/**
 * Pridá OKF súbory klientom po jednom (R4: zoznam potvrdil advokát raz). Chyba u jedného klienta
 * nezastaví ostatných; priebeh hlási po každom klientovi.
 */
export async function addOkfFiles(api: FlowApi, items: readonly { root: string; name: string }[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void): Promise<BatchItem[]> {
  const state: BatchItem[] = items.map(item => ({ ...item, status: "pending" }));
  onProgress([...state]);
  for (const [index, item] of items.entries()) {
    state[index] = await convertOne(api, item, identity, today);
    onProgress([...state]);
  }
  return state;
}

/** Zopakuje len neúspešných; hotových nechá tak. */
export async function retryFailed(api: FlowApi, items: readonly BatchItem[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void): Promise<BatchItem[]> {
  const state = [...items];
  for (const [index, item] of items.entries()) {
    if (item.status !== "failed") continue;
    state[index] = await convertOne(api, { root: item.root, name: item.name }, identity, today);
    onProgress([...state]);
  }
  return state;
}

/**
 * Kancelária pre existujúcu prax (nič sa nepresúva) a jej zápis do profilu ako kancelárie.
 * Prax, ktorá už má `Office/okf.config`, sa nepláne znova (server by odmietol „už má kanceláriu“).
 */
export async function connectPractice(api: FlowApi, root: string, identity: FoundIdentity, suggestion: OnboardingSuggestion, scope: "client" | "practice"): Promise<OnboardingApplyResult> {
  if (suggestion.marked) {
    await api.updateOnboardingProfile({ officeRoot: root });
    return { result: "applied", root };
  }
  const preview = await api.planOnboarding(practiceRequest(root, identity, suggestion, scope));
  const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  await api.updateOnboardingProfile({ officeRoot: root });
  return result;
}

/** „Áno, usporiadaj“: výslovný súhlas, potom náhľad presunov; zápis až po potvrdení náhľadu. */
export async function startReorganize(client: TriageClient, root: string): Promise<TriagePreview> {
  await triageGrant(client, root);
  return triagePlan(client, root);
}

export function firstWorkspaceResult(items: readonly BatchItem[]): OnboardingApplyResult | undefined {
  return items.find(item => item.status === "done" && item.result?.workspace)?.result;
}

/** Cieľ usporiadania: zaregistrovaný pracovný priečinok, inak koreň klienta, inak pôvodná cesta. */
export function reorganizeTarget(item: BatchItem): string {
  return item.result?.workspace?.path ?? item.result?.clientRoot ?? item.root;
}

