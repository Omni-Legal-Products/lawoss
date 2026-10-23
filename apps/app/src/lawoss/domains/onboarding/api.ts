import type { Language } from "@/i18n";

export type OnboardingStep =
  | "identity"
  | "okf"
  | "office"
  | "packs"
  | "ai"
  | "folder"
  | "found"
  | "approvals"
  | "ready"
  | "client"
  | "matter"
  | "done";
export type Jurisdiction = "sk" | "cz";
export type MatterKind = "contentious" | "non_contentious";
export type ExistingClientMode = "convert" | "map" | "trial_clone";
export type ClientType = "fo" | "fo-podnikatel" | "po" | "iny";
export type DocumentLanguage = "sk" | "cs" | "en";

/** Opt-in OKF choice; enabling stores a dated acknowledgement of a notice version. */
export type OkfChoice =
  | { enabled: true; acknowledgedAt: string; noticeVersion: string }
  | { enabled: false };

export type OnboardingProfile = {
  version: 1;
  lawyerName: string;
  jurisdiction: Jurisdiction;
  language: Language;
  officeRoot?: string;
  clientRoot?: string;
  subjectRoot?: string;
  matterRoot?: string;
  /** Priečinok vybraný v kroku „Toto som našiel“; obnova po prerušení ho otvorí znova (M1). */
  foundRoot?: string;
  /** Server-persisted marker for an active trial-clone client workspace. */
  trial?: boolean;
  okf?: OkfChoice;
  step?: OnboardingStep;
  /** Kedy sa nastavenie praxe dokončilo (ISO); neskoršie kroky z bočného panela ho neprepíšu (#96). */
  completedAt?: string;
};

export type OnboardingStatus = {
  profile: OnboardingProfile | null;
  capabilities: { map: boolean; trialClone: boolean };
  /** Uložený `foundRoot` už neexistuje (presunutý, premenovaný); obnova ponúkne výber priečinka (M1). */
  foundRootMissing?: boolean;
};

export type OfficePlanRequest = {
  action: "office";
  parent: string;
  title: string;
  name?: string;
  jurisdiction: Jurisdiction;
  language: DocumentLanguage;
  lawyerName: string;
};
export type ClientPlanRequest = {
  action: "client";
  parent: string;
  name: string;
  title: string;
  clientType: ClientType;
  jurisdiction: Jurisdiction;
  date: string;
  language: DocumentLanguage;
};
export type SubjectPlanRequest = {
  action: "subject";
  clientRoot: string;
  name: string;
  title: string;
};
export type MatterPlanRequest = {
  action: "matter";
  clientRoot: string;
  parent: string;
  title: string;
  date: string;
  kind: MatterKind;
  area: string;
  jurisdiction: Jurisdiction;
  subject?: string;
  language: DocumentLanguage;
};
export type ExistingPlanRequest = {
  action: "existing";
  root: string;
  mode: ExistingClientMode;
  title: string;
  clientType: ClientType;
  jurisdiction: Jurisdiction;
  date: string;
  language: DocumentLanguage;
  confirmUnknownClient?: boolean;
  memoryPath?: string;
  identityAnchor?: string;
  cloneParent?: string;
};
/** Plán zápisu praxe alebo klienta z vybraného priečinka (spec 2026-10-08). */
export type PracticePlanRequest = {
  action: "practice";
  root: string;
  title: string;
  jurisdiction: Jurisdiction;
  language: DocumentLanguage;
  lawyerName: string;
  clientPattern: string;
  scope: "client" | "practice";
};
export type OnboardingPlanRequest =
  | OfficePlanRequest
  | ClientPlanRequest
  | SubjectPlanRequest
  | MatterPlanRequest
  | ExistingPlanRequest
  | PracticePlanRequest;

export type OnboardingPreview = {
  id: string;
  fingerprint: string;
  preview: {
    operations?: readonly string[];
    warnings?: readonly string[];
    label?: string;
    officeMemoryRoot?: string;
  };
};
export type OnboardingApplyResult = {
  result: "applied" | "already_applied";
  root?: string;
  clientRoot?: string;
  subjectRoot?: string | null;
  matterRoot?: string;
  appFiles?: "inside" | "outside";
  trial?: boolean;
  workspace?: { id: string; path: string; name?: string; displayName?: string };
  workspaces?: readonly { id: string; path: string; displayName?: string }[];
  activeId?: string;
};
export type OnboardingClassificationIssue = { path: string; code: string };
export type OnboardingClassification = {
  level: "office" | "client" | "subject" | "matter" | "unknown" | "conflict";
  confidence?: "confirmed" | "unknown";
  complete?: boolean;
  issues?: readonly OnboardingClassificationIssue[];
  memoryCandidates?: readonly string[];
  message?: string;
};

/** Návrh úrovne vybraného priečinka (spec P4); vždy návrh, ktorý advokát potvrdí alebo opraví. */
export type OnboardingSuggestion = {
  root: string;
  level: "practice" | "client" | "matter" | "unknown";
  marked: boolean;
  score: number;
  signals: readonly string[];
  clientPattern?: string;
  clients: readonly SuggestedClient[];
  /** Klienti a vzor pre ručnú opravu na „Celá prax“ (N-9); starší server ich neposiela. */
  practiceCandidates?: readonly SuggestedClient[];
  practicePattern?: string;
  complete: boolean;
  /** Priame podpriečinky s kanceláriou OKF (`<meno>/Office/okf.config`); advokát má zrejme pripojiť ten podpriečinok. */
  childOffices?: readonly string[];
  /** Náhľad stromu (C1): koreň („“) a kandidáti praxe s prípadmi a počtom súborov; starší server ich neposiela. */
  units?: readonly SuggestedUnit[];
  /** Názov z karty klienta priamo vo vybranom priečinku (N-A4-2); starší server ho neposiela. */
  rootTitle?: string;
  /** Názov z karty klienta, pod ktorý patrí vybraný priečinok ako prípad (`matterClientPath`); starší server ho neposiela. */
  matterClientTitle?: string;
};

/** Klient v návrhu: relatívna cesta, meno priečinka a názov z karty `client.md`/`klient.md`, ak ho karta má (N-A4-2). */
export type SuggestedClient = { path: string; name: string; title?: string };

/** Jednotka náhľadu stromu; `exact: false` znamená, že počty sú dolná hranica (veľký alebo hlboký priečinok). */
export type SuggestedUnit = { path: string; matters: readonly { path: string; name: string }[]; matterCount: number; files: number; exact: boolean };

export type OnboardingApi = {
  onboardingStatus(): Promise<OnboardingStatus>;
  updateOnboardingProfile(
    profile: Omit<Partial<OnboardingProfile>, "subjectRoot" | "foundRoot"> & {
      subjectRoot?: string | null;
      foundRoot?: string | null;
    },
  ): Promise<OnboardingProfile>;
  classifyOnboarding(input: {
    root: string;
  }): Promise<OnboardingClassification>;
  suggestOnboarding?(input: { root: string }): Promise<OnboardingSuggestion>;
  planOnboarding(request: OnboardingPlanRequest): Promise<OnboardingPreview>;
  applyOnboarding(input: {
    id: string;
    fingerprint: string;
    confirm: true;
  }): Promise<OnboardingApplyResult>;
  recoverOnboarding?(input: {
    id: string;
    fingerprint: string;
    confirm: true;
    action: "finish" | "rollback";
  }): Promise<unknown>;
};
