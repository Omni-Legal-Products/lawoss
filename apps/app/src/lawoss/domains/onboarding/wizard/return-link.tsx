/** @jsxImportSource react */
/**
 * Návrat do sprievodcu z natívnych Nastavení AI (C1, review R-2): krok AI asistent pred otvorením Nastavení
 * zapíše značku v `sessionStorage`; Nastavenia AI potom nad AI hranicami ukážu „Späť do nastavenia praxe“.
 * Sprievodca značku pri otvorení zmaže. Bez úložiska sa odkaz neukáže (karta na Dnes ostáva).
 */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import type { Language } from "@/i18n";
import { RESUME_ONBOARDING_PATH } from "../resume-card";
import { wizardText } from "./wizard-text";

export const ONBOARDING_RETURN_KEY = "lawoss.onboarding.return";

type FlagStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const session = (): FlagStorage | null => {
  try { return typeof window === "undefined" ? null : window.sessionStorage; } catch { return null; }
};

export function markOnboardingReturn(storage: FlagStorage | null = session()): void {
  try { storage?.setItem(ONBOARDING_RETURN_KEY, "1"); } catch { /* bez úložiska ostáva karta na Dnes */ }
}

export function clearOnboardingReturn(storage: FlagStorage | null = session()): void {
  try { storage?.removeItem(ONBOARDING_RETURN_KEY); } catch { /* nič */ }
}

export function onboardingReturnPending(storage: Pick<Storage, "getItem"> | null = session()): boolean {
  try { return storage?.getItem(ONBOARDING_RETURN_KEY) === "1"; } catch { return false; }
}

export function OnboardingReturnLinkView({ locale }: { locale: Language }) {
  const text = wizardText(locale);
  return (
    <p className="lw-status flex flex-wrap items-center gap-3" data-lawoss-onboarding-return>
      <span className="min-w-0 flex-1">{text("returnTitle")}</span>
      <Link className="lw-btn gold" to={RESUME_ONBOARDING_PATH} onClick={() => clearOnboardingReturn()}>
        <ArrowLeft className="size-4" aria-hidden /> {text("returnAction")}
      </Link>
    </p>
  );
}

/** V Nastaveniach AI: odkaz späť, len keď do nich advokát prišiel zo sprievodcu. */
export function OnboardingReturnLink({ locale }: { locale: Language }) {
  const [pending, setPending] = useState(false);
  useEffect(() => { setPending(onboardingReturnPending()); }, []);
  return pending ? <OnboardingReturnLinkView locale={locale} /> : null;
}
