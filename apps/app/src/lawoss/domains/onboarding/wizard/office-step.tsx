/** @jsxImportSource react */
/** Krok 1 „Vaša kancelária“ (C1): meno, právo a jazyk ako krátky formulár s voľbami namiesto rozbaľovačov. */
import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { LANGUAGE_OPTIONS, setLanguagePreference, type Language } from "@/i18n";
import type { Jurisdiction, OnboardingProfile } from "../api";
import { OfficeIllustration } from "./illustrations";
import { StepScreen } from "./wizard-frame";
import type { WizardText } from "./wizard-text";

/** Jazyky rozhrania v poradí LAWOSS (SK, CS, EN, DE) s pôvodnými názvami. */
const UI_LANGUAGE_ORDER: readonly Language[] = ["sk", "cs", "en", "de"];
const UI_LANGUAGES = UI_LANGUAGE_ORDER.flatMap((code) => LANGUAGE_OPTIONS.filter((option) => option.value === code));

type Choice<T extends string> = { value: T; label: string };

/** Skupina volieb ako tlačidlá (natívne rádiá, ovládanie šípkami a Tab ako pri formulári). */
function ChoiceGroup<T extends string>({ legend, name, value, options, disabled, onChange }: {
  legend: string; name: string; value: T; options: readonly Choice<T>[]; disabled: boolean; onChange: (value: T) => void;
}) {
  return (
    <fieldset className="lw-wiz-field">
      <legend className="lw-wiz-label">{legend}</legend>
      <div className="lw-wiz-chips">
        {options.map((option) => (
          <label key={option.value} className="lw-wiz-chip">
            <input type="radio" name={name} value={option.value} checked={value === option.value} disabled={disabled} onChange={() => onChange(option.value)} />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function OfficeStep({ base, locale, text, jurisdictionLabels, busy, onSave }: {
  base: OnboardingProfile;
  locale: Language;
  text: WizardText;
  jurisdictionLabels: Record<Jurisdiction, string>;
  busy: boolean;
  onSave: (value: Pick<OnboardingProfile, "lawyerName" | "jurisdiction" | "language">) => Promise<void>;
}) {
  const [name, setName] = useState(base.lawyerName);
  const [jurisdiction, setJurisdiction] = useState<Jurisdiction>(base.jurisdiction);
  const [language, setLanguage] = useState<Language>(base.language ?? locale);
  const nameId = useId(), hintId = useId(), group = useId();
  const missing = !name.trim();
  return (
    <StepScreen step="identity" title={text("officeTitle")} lead={<p>{text("officeLead")}</p>} art={<OfficeIllustration />}>
      <form
        className="lw-wiz-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (!missing && !busy) void onSave({ lawyerName: name, jurisdiction, language });
        }}
      >
        <div className="lw-wiz-field">
          <label className="lw-wiz-label" htmlFor={nameId}>{text("officeName")}</label>
          <Input id={nameId} value={name} autoComplete="name" placeholder={text("officeNamePlaceholder")} aria-describedby={missing ? hintId : undefined} onChange={(event) => setName(event.target.value)} />
          {missing ? <p id={hintId} className="lw-wiz-hint">{text("officeNameMissing")}</p> : null}
        </div>
        <ChoiceGroup
          legend={text("officeJurisdiction")} name={`${group}-jurisdiction`} value={jurisdiction} disabled={busy}
          options={[{ value: "sk", label: jurisdictionLabels.sk }, { value: "cz", label: jurisdictionLabels.cz }]}
          onChange={setJurisdiction}
        />
        <ChoiceGroup
          legend={text("officeLanguage")} name={`${group}-language`} value={language} disabled={busy}
          options={UI_LANGUAGES.map((option) => ({ value: option.value, label: option.nativeName }))}
          onChange={(next) => {
            setLanguage(next);
            // Rozhranie sa prepne hneď (rodič číta useLocale), nie až po uložení.
            setLanguagePreference(next);
          }}
        />
        <div className="lw-wiz-actions">
          <button type="submit" className="lw-btn gold" disabled={busy || missing}>{text("continue")}</button>
        </div>
      </form>
    </StepScreen>
  );
}
