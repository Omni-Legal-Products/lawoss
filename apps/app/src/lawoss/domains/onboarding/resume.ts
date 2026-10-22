/**
 * Návrat k nedokončenému nastaveniu praxe (lawOSS-like-SK-CZ#96, MF; prijaté MČ 18. 10. 2026).
 * Dokončenie sa odvodzuje z profilu na serveri (W4), nie z localStorage.
 */
import type { OnboardingProfile, OnboardingStep } from "./api";

type ProfilePatch = Omit<Partial<OnboardingProfile>, "foundRoot"> & { foundRoot?: string | null };
type ProfileWriter = { updateOnboardingProfile(patch: ProfilePatch): Promise<OnboardingProfile> };

/**
 * Nastavenie sa začalo, ale neskončilo. Bez profilu karta netreba: prvé spustenie rieši presmerovanie na /welcome.
 * `hasCompletedOnboarding` z prefs nestačí, nastavuje ho aj upstream vytvorenie pracovného priečinka. Profil
 * spred značky `completedAt` sa berie ako dokončený, ak sprievodca zapísal koreň praxe alebo klienta.
 */
export function onboardingIncomplete(profile: OnboardingProfile | null | undefined, hasCompletedOnboarding: boolean): boolean {
  if (!profile || profile.completedAt) return false;
  return !(hasCompletedOnboarding && Boolean(profile.officeRoot || profile.clientRoot));
}

/** Krok, ktorým sa otvorí sprievodca: výslovný krok, pri dokončenom nastavení prvý krok, inak posledný uložený. */
export function openingStep(
  initialStep: OnboardingStep | undefined,
  profile: OnboardingProfile | null,
  savedStep: OnboardingStep,
  hasCompletedOnboarding: boolean,
): OnboardingStep {
  if (initialStep) return initialStep;
  if (profile && !onboardingIncomplete(profile, hasCompletedOnboarding)) return "identity";
  return profile?.step ?? savedStep;
}

/** Kroky sprievodcu od „Toto sme našli“ ďalej; návrat na „Toto sme našli“ z nich potrebuje vybraný priečinok (C1). */
const AFTER_FOLDER: ReadonlySet<OnboardingStep> = new Set(["found", "ai", "approvals", "ready"]);

/**
 * Obnova kroku „Toto som našiel“ (M1, 22. 10. 2026): pri obnovenom kroku `found` alebo neskoršom kroku sprievodcu
 * (C1) bez priečinka z adresy (`?root=` má prednosť). `root` otvorí obrazovku s uloženým priečinkom; `missing`
 * (priečinok medzitým zmizol) nechá krok Priečinok s krátkou vetou; `null` znamená bežný výber priečinka.
 */
export function resumeFound(step: OnboardingStep, profile: OnboardingProfile | null, initialRoot?: string, foundRootMissing = false): { root: string } | { missing: string } | null {
  if (!AFTER_FOLDER.has(step) || initialRoot || !profile?.foundRoot) return null;
  return foundRootMissing ? { missing: profile.foundRoot } : { root: profile.foundRoot };
}

/**
 * Zapíše značku dokončenia raz a zmaže priečinok obnovy (po dokončení nie je čo obnovovať).
 * Zlyhanie (napr. presunutý koreň) nesmie zastaviť dokončenie onboardingu.
 */
export async function markOnboardingCompleted(api: ProfileWriter, profile: OnboardingProfile | null, now = new Date()): Promise<OnboardingProfile | null> {
  if (!profile || (profile.completedAt && !profile.foundRoot)) return profile;
  try {
    return await api.updateOnboardingProfile({ ...(profile.completedAt ? {} : { completedAt: now.toISOString() }), ...(profile.foundRoot ? { foundRoot: null } : {}) });
  } catch (reason) {
    console.warn("[lawoss] onboarding completion marker", reason);
    return profile;
  }
}
