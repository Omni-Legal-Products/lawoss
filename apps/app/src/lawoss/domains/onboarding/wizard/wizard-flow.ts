/**
 * Riadenie sprievodcu (C1) bez Reactu, aby sa dalo testovať s falošným API: obnova po prerušení (krok,
 * priečinok, voľby, pripojenie, zmiznutý priečinok) a prechody medzi krokmi (uloženie kroku cez živého
 * klienta servera, pripojenie z kroku 3 s registráciou a pokračovaním len z kroku, ktorý zápis spustil).
 */
import type { OnboardingApi, OnboardingApplyResult, OnboardingProfile, OnboardingStep } from "../api";
import type { OnboardingCompletion } from "../lawoss-welcome-page";
import {
  patchOnboardingProgress,
  trustedProgress,
  visibleOnboardingStep,
  wizardOpeningStep,
  type FoundChoice,
  type OnboardingProgress,
  type WizardConnected,
} from "../onboarding-state";
import { openingStep, resumeFound } from "../resume";

type ProgressStorage = (Pick<Storage, "getItem"> & Pick<Storage, "setItem">) | null;
type ProfileApi = Pick<OnboardingApi, "updateOnboardingProfile">;

export type WizardResume = {
  step: OnboardingStep;
  foundRoot?: string;
  found?: FoundChoice;
  connected?: WizardConnected;
  /** Uložený priečinok zmizol: veta pre advokáta a zabudnutie priečinka aj pripojenia. */
  missing?: string;
  /** Zmena profilu na serveri pri zmiznutom priečinku. */
  profilePatch?: { foundRoot: null; step?: OnboardingStep };
};

/**
 * Kde sprievodca pokračuje po načítaní stavu servera. Zmiznutý priečinok v kroku 3 aj v krokoch 4–6 vráti
 * krok Dokumenty a zabudne pripojenie k nemu (súhrn by inak ponúkol chat s neexistujúcim klientom).
 */
export function wizardResume(input: {
  initialStep?: OnboardingStep;
  initialRoot?: string;
  profile: OnboardingProfile | null;
  saved: OnboardingProgress;
  foundRootMissing?: boolean;
  hasCompletedOnboarding: boolean;
  sidebarFlow: boolean;
}): WizardResume {
  const { initialStep, initialRoot, profile, saved, sidebarFlow } = input;
  const trusted = sidebarFlow ? {} : trustedProgress(saved, profile);
  const opening = wizardOpeningStep(
    visibleOnboardingStep(openingStep(initialStep, profile, saved.step, input.hasCompletedOnboarding), profile !== null),
    trusted.connected,
    profile?.foundRoot,
  );
  const step = initialRoot && !sidebarFlow && opening === "folder" ? "found" : opening;
  const resumed = resumeFound(opening, profile, initialRoot, input.foundRootMissing);
  if (resumed && "missing" in resumed) {
    return { step: "folder", missing: resumed.missing, profilePatch: { foundRoot: null, ...(opening === "folder" ? {} : { step: "folder" }) } };
  }
  return { step, ...(resumed ? { foundRoot: resumed.root } : {}), ...trusted };
}

export type WizardFlowDeps = {
  /** Živý klient servera: po skorej registrácii (krok 3) ten, ktorý vrátila registrácia. */
  live: () => ProfileApi;
  storage: () => ProgressStorage;
  /** Krok, ktorý je práve na obrazovke (nie ten, v ktorom sa zápis začal). */
  currentStep: () => OnboardingStep;
  register: (result?: OnboardingApplyResult, completion?: OnboardingCompletion) => Promise<unknown>;
  /** Uložený krok a profil pre stránku. */
  onStep: (step: OnboardingStep, profile: OnboardingProfile) => void;
};

export function createWizardFlow(deps: WizardFlowDeps) {
  /** Uloží krok do úložiska prehliadača (bez straty volieb) aj na server cez živého klienta. */
  const move = async (next: OnboardingStep, patch: Pick<Partial<OnboardingProfile>, "okf"> = {}): Promise<OnboardingProfile> => {
    patchOnboardingProgress(deps.storage(), { lane: "detailed", step: next });
    const profile = await deps.live().updateOnboardingProfile({ ...patch, step: next });
    deps.onStep(next, profile);
    return profile;
  };
  /**
   * Krok 3 pripojil priečinok: zapamätá sa, zaregistruje (okrem novej kancelárie, R7) a sprievodca pokračuje
   * krokom AI, ale len ak advokát medzitým neodišiel na iný krok. Zlyhaná registrácia nezastaví sprievodcu;
   * dokončenie ju zopakuje a chybu ohlási.
   */
  const connected = async (next: WizardConnected, result?: OnboardingApplyResult, completion?: OnboardingCompletion): Promise<boolean> => {
    patchOnboardingProgress(deps.storage(), { connected: next });
    if (next.kind !== "fresh") await deps.register(result, completion).catch((reason: unknown) => console.warn("[lawoss] onboarding early registration", reason));
    if (deps.currentStep() !== "found") return false;
    await move("ai");
    return true;
  };
  return { move, connected };
}
