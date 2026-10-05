import type { Language } from "@/i18n";

export type OnboardingStep =
  | "identity"
  | "okf"
  | "office"
  | "packs"
  | "ai"
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
  /** Server-persisted marker for an active trial-clone client workspace. */
  trial?: boolean;
  okf?: OkfChoice;
  step?: OnboardingStep;
};

export type OnboardingStatus = {
  profile: OnboardingProfile | null;
  capabilities: { map: boolean; trialClone: boolean };
};

export type OfficePlanRequest = {
  action: "office";
  parent: string;
  title: string;
  name?: string;
  jurisdiction: Jurisdiction;
  language: Language;
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
export type OnboardingPlanRequest =
  | OfficePlanRequest
  | ClientPlanRequest
  | SubjectPlanRequest
  | MatterPlanRequest
  | ExistingPlanRequest;

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
  workspace?: { id: string; path: string; displayName?: string };
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

export type OnboardingApi = {
  onboardingStatus(): Promise<OnboardingStatus>;
  updateOnboardingProfile(
    profile: Omit<Partial<OnboardingProfile>, "subjectRoot"> & {
      subjectRoot?: string | null;
    },
  ): Promise<OnboardingProfile>;
  classifyOnboarding(input: {
    root: string;
  }): Promise<OnboardingClassification>;
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
