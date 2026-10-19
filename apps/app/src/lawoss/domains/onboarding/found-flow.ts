/**
 * Logika obrazovky „Toto som našiel“ (spec 2026-10-08): predvolené hodnoty, hromadné pridanie
 * OKF súborov, pripojenie praxe a začiatok usporiadania na mieste. Bez Reactu, aby sa dala testovať.
 */
import type { Language } from "@/i18n";
import { hasLegalForm } from "../../../../../../lawoss/okf/src/onboarding/suggest-patterns";
import { triageGrant, triagePlan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import { LITE_CLIENTS_PATH } from "../../lite/links";
import type { OnboardingCompletion } from "./lawoss-welcome-page";
import type { DocumentLanguage, ExistingPlanRequest, Jurisdiction, OfficePlanRequest, OnboardingApi, OnboardingApplyResult, OnboardingSuggestion, PracticePlanRequest } from "./api";

export type FoundIdentity = { lawyerName: string; jurisdiction: Jurisdiction; language: Language };
/** `error` je už veta pre advokáta (DescribeError), nie surová správa servera. */
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

/** Chyba klienta ako veta pre advokáta v jazyku rozhrania (volajúci zapíše surovú správu do konzoly). */
export type DescribeError = (reason: unknown) => string;

async function convertOne(api: FlowApi, item: { root: string; name: string }, identity: FoundIdentity, today: Date, describe: DescribeError): Promise<BatchItem> {
  try {
    const preview = await api.planOnboarding(convertRequest(item.root, identity, today));
    const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
    return { ...item, status: "done", result };
  } catch (reason) {
    return { ...item, status: "failed", error: describe(reason) };
  }
}

/**
 * Pridá OKF súbory klientom po jednom (R4: zoznam potvrdil advokát raz). Chyba u jedného klienta
 * nezastaví ostatných; priebeh hlási po každom klientovi.
 */
export async function addOkfFiles(api: FlowApi, items: readonly { root: string; name: string }[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void, describe: DescribeError): Promise<BatchItem[]> {
  const state: BatchItem[] = items.map(item => ({ ...item, status: "pending" }));
  onProgress([...state]);
  for (const [index, item] of items.entries()) {
    state[index] = await convertOne(api, item, identity, today, describe);
    onProgress([...state]);
  }
  return state;
}

/** Zopakuje len neúspešných; hotových nechá tak. */
export async function retryFailed(api: FlowApi, items: readonly BatchItem[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void, describe: DescribeError): Promise<BatchItem[]> {
  const state = [...items];
  for (const [index, item] of items.entries()) {
    if (item.status !== "failed") continue;
    state[index] = await convertOne(api, { root: item.root, name: item.name }, identity, today, describe);
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

/**
 * „Začať nanovo“ (R7): len do prázdneho priečinka; oznámenie OKF sa berie na vedomie pred prvým zápisom.
 * Náhľad zmien netreba potvrdzovať zvlášť: do prázdneho priečinka sa len pridáva.
 */
export async function startFreshFolder(api: FlowApi & Pick<OnboardingApi, "suggestOnboarding">, parent: string, identity: FoundIdentity, acknowledge: () => Promise<void>): Promise<OnboardingApplyResult | "not_empty"> {
  if (!api.suggestOnboarding) throw new Error("suggest_unavailable");
  if (!isEmptyFolderSuggestion(await api.suggestOnboarding({ root: parent }))) return "not_empty";
  await acknowledge();
  const preview = await api.planOnboarding(freshOfficeRequest(parent, identity));
  const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  await api.updateOnboardingProfile({ officeRoot: parent });
  return result;
}

/**
 * Dokončenie „Začať nanovo“ (test 19. 10. 2026): vybraný priečinok s novou kanceláriou sa zaregistruje ako
 * pracovný priečinok (inak ho bočný panel nevidí) a advokát pristane na Klienti a prípady pri „Pridať klienta“.
 */
export function freshOfficeCompletion(parent: string): OnboardingCompletion {
  return { workingFolder: parent, landing: LITE_CLIENTS_PATH };
}

/** „Áno, usporiadaj“: výslovný súhlas, potom náhľad presunov; zápis až po potvrdení náhľadu. */
export async function startReorganize(client: TriageClient, root: string): Promise<TriagePreview> {
  await triageGrant(client, root);
  return triagePlan(client, root);
}

/** Náhľad usporiadania jedného klienta, alebo dôvod zlyhania (advokát dostane Skúsiť znova, nie tichý preskok). */
export type ReorganizeOutcome = { preview: TriagePreview } | { failure: unknown };

export async function reorganizePreview(client: TriageClient, item: BatchItem): Promise<ReorganizeOutcome> {
  try { return { preview: await startReorganize(client, reorganizeTarget(item)) }; }
  catch (failure) { return { failure }; }
}

/** Čo má obrazovka ukázať: náhľad presunov klienta, alebo zlyhanie so Skúsiť znova. */
export type ReorganizeView =
  | { name: "reorganize"; queue: BatchItem[]; preview: TriagePreview; result?: OnboardingApplyResult }
  | { name: "reorganizeFailed"; queue: BatchItem[]; failure: unknown; result?: OnboardingApplyResult };

/**
 * Usporiadanie po pripojení (MČ 19. 10. 2026). `begin` najprv zaregistruje a vyberie pripojený priečinok,
 * až potom začne usporiadanie: prerušený alebo zlyhaný /triage/plan (napr. obnovenie stránky) ho už nestratí.
 * Registrácia môže vrátiť nového klienta servera (server po aktivácii s iným tokenom či portom); `client`
 * ho drží pre ďalších klientov, potvrdenie aj zmenu náhľadu (review 6d).
 */
export function createReorganizeFlow(deps: {
  client: { current: TriageClient };
  register: (result?: OnboardingApplyResult) => Promise<TriageClient | undefined>;
  done: (result?: OnboardingApplyResult) => Promise<void> | void;
  show: (view: ReorganizeView) => void;
}) {
  const show = async (queue: BatchItem[], result?: OnboardingApplyResult): Promise<void> => {
    const [current] = queue;
    if (!current) { await deps.done(result); return; }
    const outcome = await reorganizePreview(deps.client.current, current);
    deps.show("preview" in outcome ? { name: "reorganize", queue, preview: outcome.preview, result } : { name: "reorganizeFailed", queue, failure: outcome.failure, result });
  };
  const begin = async (queue: BatchItem[], result?: OnboardingApplyResult): Promise<void> => {
    if (!queue.length) { await deps.done(result); return; }
    const fresh = await deps.register(result);
    if (fresh) deps.client.current = fresh;
    await show(queue, result);
  };
  return { begin, show };
}

/**
 * „Začať nanovo“: výber priečinka, pri zdieľanom alebo cloudovom disku najprv upozornenie
 * (Pokračovať / Zrušiť), až potom zápis (review 6d). `null` = advokát nič nevybral alebo zrušil.
 */
export async function freshFolderFlow<R>(deps: { pick: () => Promise<string | null>; confirm: (kind: "shared" | "cloud") => Promise<boolean>; start: (parent: string) => Promise<R> }): Promise<R | null> {
  const parent = await deps.pick();
  if (!parent) return null;
  const kind = cloudFolderKind(parent);
  if (kind && !(await deps.confirm(kind))) return null;
  return deps.start(parent);
}

/** Zdieľané disky Google Drive v jazykoch rozhrania Disku (SK, CS, EN, DE) a knižnice SharePointu z OneDrive na macOS. */
const SHARED_DRIVE = /(?:^|[\\/])(?:Shared drives|Zdieľané disky|Sdílené disky|Geteilte Ablagen|OneDrive-SharedLibraries-[^\\/]+)(?:[\\/]|$)/i;
/** Synchronizované priečinky: macOS File Provider (`~/Library/CloudStorage`), OneDrive, Dropbox, Disk Google, iCloud. */
const CLOUD_FOLDER = /[\\/]Library[\\/]CloudStorage[\\/]|[\\/]Mobile Documents[\\/]com~apple~CloudDocs(?:[\\/]|$)|(?:^|[\\/])(?:OneDrive(?: - [^\\/]+|-[^\\/]+)?|Dropbox(?: \([^\\/]+\))?|Google Drive|My Drive|Môj disk|Můj disk|Meine Ablage|iCloud Drive)(?:[\\/]|$)/i;

/**
 * Priečinok, do ktorého sa zapisuje, je na zdieľanom disku (vidia ho kolegovia) alebo v cloude
 * (zapísané súbory sa synchronizujú). MČ 19. 10. 2026: upozorniť pred zápisom, neblokovať.
 */
export function cloudFolderKind(path: string): "shared" | "cloud" | null {
  if (SHARED_DRIVE.test(path)) return "shared";
  return CLOUD_FOLDER.test(path) ? "cloud" : null;
}

export function firstWorkspaceResult(items: readonly BatchItem[]): OnboardingApplyResult | undefined {
  return items.find(item => item.status === "done" && item.result?.workspace)?.result;
}

/** Všetci úspešní klienti dávky s pracovným priečinkom, v poradí dávky (spec: každý je samostatný pracovný priečinok). */
export function workspaceResults(items: readonly BatchItem[]): OnboardingApplyResult[] {
  return items.flatMap(item => item.status === "done" && item.result?.workspace ? [item.result] : []);
}

/** Cieľ usporiadania: zaregistrovaný pracovný priečinok, inak koreň klienta, inak pôvodná cesta. */
export function reorganizeTarget(item: BatchItem): string {
  return item.result?.workspace?.path ?? item.result?.clientRoot ?? item.root;
}

