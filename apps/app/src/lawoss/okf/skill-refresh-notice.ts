import { toast } from "@/components/ui/sonner";
import type { Language } from "@/i18n";

const notice: Record<Language, (names: string, many: boolean) => string> = {
  sk: (names, many) => many
    ? `Skilly ${names} obsahujú vaše úpravy, preto sme ich nenahradili novšou verziou z LAWOSS. Nástroje OKF sme aktualizovali.`
    : `Skill ${names} obsahuje vaše úpravy, preto sme ho nenahradili novšou verziou z LAWOSS. Nástroje OKF sme aktualizovali.`,
  cs: (names, many) => many
    ? `Skilly ${names} obsahují vaše úpravy, proto jsme je nenahradili novější verzí z LAWOSS. Nástroje OKF jsme aktualizovali.`
    : `Skill ${names} obsahuje vaše úpravy, proto jsme ho nenahradili novější verzí z LAWOSS. Nástroje OKF jsme aktualizovali.`,
  en: (names, many) => many
    ? `Skills ${names} contain your changes, so they were not replaced by the newer LAWOSS version. The OKF tools were updated.`
    : `Skill ${names} contains your changes, so it was not replaced by the newer LAWOSS version. The OKF tools were updated.`,
  de: (names, many) => many
    ? `Die Skills ${names} enthalten Ihre Änderungen und wurden daher nicht durch die neuere LAWOSS-Version ersetzt. Die OKF-Werkzeuge wurden aktualisiert.`
    : `Der Skill ${names} enthält Ihre Änderungen und wurde daher nicht durch die neuere LAWOSS-Version ersetzt. Die OKF-Werkzeuge wurden aktualisiert.`,
};

export function okfSkillRefreshNotice(modified: readonly string[], locale: Language): string | null {
  return modified.length ? notice[locale](modified.join(", "), modified.length > 1) : null;
}

/** Non-blocking: a kept customization never stops onboarding or a draft. */
export function notifyModifiedOkfSkills(modified: readonly string[], locale: Language): void {
  const text = okfSkillRefreshNotice(modified, locale);
  if (text) toast.warning(text);
}
