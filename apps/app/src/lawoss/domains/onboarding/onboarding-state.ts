/** Small, versioned persistence seam for the LAWOSS welcome flow. */
import type { OkfChoice, OnboardingApplyResult, OnboardingPlanRequest, OnboardingPreview, OnboardingProfile, OnboardingStep } from "./api";

export type PendingOnboarding = {
  request: Pick<OnboardingPlanRequest, "action">;
  value: OnboardingPreview;
};
const PENDING_KEY = "legalwork.lawoss.onboarding.pending.v1";
const isText = (value: unknown, max = 4_096): value is string =>
  typeof value === "string" &&
  value.trim().length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f]/.test(value);
const isCanonicalRoot = (value: unknown): value is string => {
  if (!isText(value, 16_384)) return false;
  const path = value.trim();
  // Unix, písmeno disku alebo UNC `\\server\share` (prax na NAS).
  if (!/^(?:\/|[A-Za-z]:[\\/]|\\\\[^\\/]+[\\/][^\\/]+)/.test(path)) return false;
  return !path.split(/[\\/]+/).some((part) => part === "." || part === "..");
};
export function readPendingOnboarding(
  storage: Pick<Storage, "getItem"> | null,
): PendingOnboarding | null {
  try {
    const raw = storage?.getItem(PENDING_KEY);
    if (!raw || raw.length > 2 * 1024 * 1024) return null;
    const parsed = JSON.parse(raw);
    const preview = parsed?.value?.preview;
    if (
      !["office", "client", "subject", "matter", "existing"].includes(
        parsed?.request?.action,
      ) ||
      !/^[a-f0-9-]{36}$/.test(parsed?.value?.id) ||
      !/^[a-f0-9]{64}$/.test(parsed?.value?.fingerprint) ||
      !Array.isArray(preview?.operations) ||
      !preview.operations.every((item: unknown) => isText(item)) ||
      (preview.label !== undefined && !isText(preview.label)) ||
      (preview.warnings !== undefined &&
        (!Array.isArray(preview.warnings) ||
          !preview.warnings.every((item: unknown) => isText(item)))) ||
      (preview.officeMemoryRoot !== undefined &&
        !isCanonicalRoot(preview.officeMemoryRoot))
    )
      return null;
    return parsed;
  } catch {
    return null;
  }
}
export function writePendingOnboarding(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  pending: PendingOnboarding | null,
): void {
  try {
    if (pending)
      storage?.setItem(
        PENDING_KEY,
        JSON.stringify({
          request: { action: pending.request.action },
          value: pending.value,
        }),
      );
    else storage?.removeItem(PENDING_KEY);
  } catch {
    /* Disk journal remains authoritative when browser storage is unavailable. */
  }
}

const ONBOARDING_PROGRESS_STORAGE_KEY = "legalwork.lawoss.onboarding.v1";

export type OnboardingLane = "recommended" | "detailed";

/**
 * Voľby obrazovky „Toto sme našli“ (C1): typ priečinka, rozsah praxe a označení klienti. Patria k jednému
 * priečinku; pri inom priečinku sa nepoužijú. Návrat a obnova ich vrátia bez straty.
 */
export type FoundChoice = {
  root: string;
  level: "practice" | "client" | "matter";
  scope: "client" | "practice";
  selected: string[];
};

/** Klient, ktorému sprievodca pridal pomocné súbory; `result` nesie pracovný priečinok pre chat a dokončenie. */
export type ConnectedClient = { root: string; name: string; result: OnboardingApplyResult };

/**
 * Čo krok „Toto sme našli“ pripojil (C1): klienti, celá prax ako jeden priečinok, alebo nová kancelária.
 * Kroky AI, Ako agent pracuje a Pripravené z toho skladajú súhrn a prvú úlohu; prežije obnovenie stránky.
 */
export type WizardConnected =
  | { kind: "clients"; root: string; clients: ConnectedClient[] }
  | { kind: "practice"; root: string }
  | { kind: "fresh"; root: string; result: OnboardingApplyResult };

export type OnboardingProgress = {
  lane: OnboardingLane;
  step: OnboardingStep;
  found?: FoundChoice;
  connected?: WizardConnected;
};

export const DEFAULT_ONBOARDING_PROGRESS: OnboardingProgress = {
  lane: "recommended",
  step: "identity",
};

function isLane(value: unknown): value is OnboardingLane {
  return value === "recommended" || value === "detailed";
}

function isStep(value: unknown): value is OnboardingStep {
  return (
    value === "approvals" ||
    value === "ready" ||
    value === "identity" ||
    value === "okf" ||
    value === "office" ||
    value === "packs" ||
    value === "ai" ||
    value === "folder" ||
    value === "found" ||
    value === "client" ||
    value === "matter" ||
    value === "done"
  );
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const field = (value: unknown, key: string): unknown => (isRecord(value) ? value[key] : undefined);

function readFoundChoice(value: unknown): FoundChoice | undefined {
  const root = field(value, "root"), level = field(value, "level"), scope = field(value, "scope"), selected = field(value, "selected");
  if (!isCanonicalRoot(root)) return undefined;
  if (level !== "practice" && level !== "client" && level !== "matter") return undefined;
  if (scope !== "client" && scope !== "practice") return undefined;
  if (!Array.isArray(selected) || selected.length > 10_000 || !selected.every((item: unknown) => isText(item))) return undefined;
  return { root, level, scope, selected: selected.filter((item): item is string => typeof item === "string") };
}

/** Výsledok zápisu z úložiska prehliadača: len známe polia a kanonické cesty, inak nič. */
function readApplyResult(value: unknown): OnboardingApplyResult | undefined {
  const result = field(value, "result");
  if (result !== "applied" && result !== "already_applied") return undefined;
  const out: OnboardingApplyResult = { result };
  const clientRoot = field(value, "clientRoot"), root = field(value, "root"), appFiles = field(value, "appFiles"), workspace = field(value, "workspace");
  if (isCanonicalRoot(clientRoot)) out.clientRoot = clientRoot;
  if (isCanonicalRoot(root)) out.root = root;
  if (appFiles === "inside" || appFiles === "outside") out.appFiles = appFiles;
  const id = field(workspace, "id"), path = field(workspace, "path"), displayName = field(workspace, "displayName");
  if (isText(id, 512) && isCanonicalRoot(path)) out.workspace = { id, path, ...(isText(displayName, 512) ? { displayName } : {}) };
  return out;
}

function readConnected(value: unknown): WizardConnected | undefined {
  const kind = field(value, "kind"), root = field(value, "root");
  if (!isCanonicalRoot(root)) return undefined;
  if (kind === "practice") return { kind, root };
  if (kind === "fresh") {
    const result = readApplyResult(field(value, "result"));
    return result ? { kind, root, result } : undefined;
  }
  const clients = field(value, "clients");
  if (kind !== "clients" || !Array.isArray(clients) || clients.length > 10_000) return undefined;
  const parsed = clients.flatMap((item: unknown) => {
    const clientRoot = field(item, "root"), name = field(item, "name"), result = readApplyResult(field(item, "result"));
    return isCanonicalRoot(clientRoot) && isText(name, 1_024) && result ? [{ root: clientRoot, name, result }] : [];
  });
  return parsed.length === clients.length ? { kind, root, clients: parsed } : undefined;
}

export function readOnboardingProgress(
  storage: Pick<Storage, "getItem"> | null,
): OnboardingProgress {
  if (!storage) return DEFAULT_ONBOARDING_PROGRESS;
  try {
    const raw = storage.getItem(ONBOARDING_PROGRESS_STORAGE_KEY);
    if (!raw) return DEFAULT_ONBOARDING_PROGRESS;
    const parsed: unknown = JSON.parse(raw);
    const lane = field(parsed, "lane"), step = field(parsed, "step");
    if (!isLane(lane)) return DEFAULT_ONBOARDING_PROGRESS;
    if (!isStep(step)) return DEFAULT_ONBOARDING_PROGRESS;
    const found = readFoundChoice(field(parsed, "found"));
    const connected = readConnected(field(parsed, "connected"));
    return { lane, step, ...(found ? { found } : {}), ...(connected ? { connected } : {}) };
  } catch {
    return DEFAULT_ONBOARDING_PROGRESS;
  }
}

export function writeOnboardingProgress(
  storage: Pick<Storage, "setItem"> | null,
  progress: OnboardingProgress,
): void {
  if (!storage) return;
  try {
    storage.setItem(ONBOARDING_PROGRESS_STORAGE_KEY, JSON.stringify(progress));
  } catch {
    // localStorage can be unavailable or quota-limited; in-memory UI still works.
  }
}

/**
 * Zmení len uvedené polia postupu a ostatné ponechá (krok nesmie zmazať voľby „Toto sme našli“ ani pripojenie).
 * `undefined` v `patch` pole zmaže.
 */
export function patchOnboardingProgress(
  storage: (Pick<Storage, "getItem"> & Pick<Storage, "setItem">) | null,
  patch: Partial<OnboardingProgress>,
): OnboardingProgress {
  const next: OnboardingProgress = { ...readOnboardingProgress(storage), ...patch };
  for (const key of ["found", "connected"] as const) if (Object.hasOwn(patch, key) && patch[key] === undefined) delete next[key];
  writeOnboardingProgress(storage, next);
  return next;
}

/**
 * Uložené voľby a pripojenie platia len k profilu servera (C1, review m-11): pripojení klienti a voľby
 * patria uloženému `foundRoot`, nová kancelária koreňu kancelárie profilu. Bez profilu (reset) sa zahodia.
 */
export function trustedProgress(progress: OnboardingProgress, profile: Pick<OnboardingProfile, "foundRoot" | "officeRoot"> | null): Pick<OnboardingProgress, "found" | "connected"> {
  if (!profile) return {};
  const found = progress.found && progress.found.root === profile.foundRoot ? progress.found : undefined;
  const connected = progress.connected?.kind === "fresh"
    ? (progress.connected.root === profile.officeRoot ? progress.connected : undefined)
    : progress.connected && progress.connected.root === profile.foundRoot ? progress.connected : undefined;
  return { ...(found ? { found } : {}), ...(connected ? { connected } : {}) };
}

/**
 * Krok, ktorým sa sprievodca otvorí po obnove (C1): staré uložené `ai` (pôvodné poradie AI pred priečinkom)
 * bez pripojeného priečinka vedie na Dokumenty; ostatné kroky ostávajú.
 */
export function wizardOpeningStep(step: OnboardingStep, connected: WizardConnected | undefined, foundRoot: string | undefined): OnboardingStep {
  if ((step === "ai" || step === "approvals" || step === "ready") && !connected && !foundRoot) return "folder";
  return step;
}

/** Verzia oznámenia OKF; nová verzia si vyžiada nové vzatie na vedomie (spec 2026-10-08, OKF vždy lokálne). */
export const OKF_NOTICE_VERSION = "2026-10-08-priecinok";

/** `undefined` means the user has not chosen yet. */
export type OkfEnabled = boolean | undefined;

/**
 * Hlavná cesta onboardingu po krokoch (C1, alfa 2, MČ 22. 10. 2026): Kancelária → Dokumenty → Toto sme našli →
 * AI asistent → Ako agent pracuje → Pripravené. Priečinok ide pred AI, aby krok AI a schvaľovania videl
 * zaregistrovaného klienta (stav modelu, oprávnenia) a prvá úloha na konci mala splnené predpoklady.
 */
export const MAIN_ONBOARDING_PATH: readonly OnboardingStep[] = ["identity", "folder", "found", "ai", "approvals", "ready"];

export function visibleOnboardingSteps(): readonly OnboardingStep[] {
  return MAIN_ONBOARDING_PATH;
}

/**
 * Staré kroky (voľba OKF, kancelária, balíky) uložené alfa testermi vedú na krok Priečinok.
 * Bez profilu na serveri by každý ďalší krok uložil zmenu, ktorú server odmietne (chýba meno,
 * jurisdikcia a jazyk), preto tok začína identitou bez ohľadu na localStorage (#147).
 */
export function visibleOnboardingStep(step: OnboardingStep, hasProfile = true): OnboardingStep {
  if (!hasProfile) return "identity";
  return step === "okf" || step === "office" || step === "packs" ? "folder" : step;
}

export function okfChoice(enabled: boolean, now: Date): OkfChoice {
  return enabled
    ? { enabled: true, acknowledgedAt: now.toISOString(), noticeVersion: OKF_NOTICE_VERSION }
    : { enabled: false };
}

/** Oznámenie OKF sa berie na vedomie raz za verziu; opakovaná odpoveď už `acknowledgedAt` neprepíše. */
export function needsOkfAcknowledgement(profile: OnboardingProfile | null | undefined): boolean {
  return profile?.okf?.enabled !== true || profile.okf.noticeVersion !== OKF_NOTICE_VERSION;
}
