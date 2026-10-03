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
