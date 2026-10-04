import { toast } from "@/components/ui/sonner";
import type { Language } from "@/i18n";

const notice: Record<Language, (names: string) => string> = {
  sk: (names) => `Skill ${names} obsahuje vaše úpravy, preto sme ho nenahradili novšou verziou z LAWOSS. Nástroje OKF sme aktualizovali.`,
  cs: (names) => `Skill ${names} obsahuje vaše úpravy, proto jsme ho nenahradili novější verzí z LAWOSS. Nástroje OKF jsme aktualizovali.`,
  en: (names) => `Skill ${names} contains your changes, so it was not replaced by the newer LAWOSS version. The OKF tools were updated.`,
  de: (names) => `Der Skill ${names} enthält Ihre Änderungen und wurde daher nicht durch die neuere LAWOSS-Version ersetzt. Die OKF-Werkzeuge wurden aktualisiert.`,
};

export function okfSkillRefreshNotice(modified: readonly string[], locale: Language): string | null {
  return modified.length ? notice[locale](modified.join(", ")) : null;
}

/** Non-blocking: a kept customization never stops onboarding or a draft. */
export function notifyModifiedOkfSkills(modified: readonly string[], locale: Language): void {
  const text = okfSkillRefreshNotice(modified, locale);
  if (text) toast.warning(text);
}
