/** @jsxImportSource react */
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import "./resume-card.css";

/** Plain `/welcome` otvorí posledný uložený krok (`openingStep`); karta nič neblokuje ani nepresmeruje (#96). */
export const RESUME_ONBOARDING_PATH = "/welcome";

export function OnboardingResumeCardView({ locale }: { locale: Language }) {
  const text = (key: string) => t(`lawoss.lite.${key}`, locale);
  return <section className="lw-status lw-onb-resume" aria-labelledby="lw-onb-resume-title" data-lawoss-onboarding-resume>
    <div>
      <h2 id="lw-onb-resume-title">{text("resume_title")}</h2>
      <p>{text("resume_text")}</p>
    </div>
    <Link className="lw-btn gold" to={RESUME_ONBOARDING_PATH}>{text("resume_action")}</Link>
  </section>;
}
