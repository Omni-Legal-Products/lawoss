/** @jsxImportSource react */
/**
 * Rám sprievodcu (C1): ukazovateľ priebehu so stavom aj mimo farby (ikona a skrytý text), návrat na hotový
 * krok kliknutím a jednotná hlavička obrazovky (nadpis, krátka veta, obrázok, navigácia pri nadpise).
 */
import { useEffect, useRef, type ReactNode } from "react";
import { Check } from "lucide-react";
import type { OnboardingStep } from "../api";
import type { WizardText, WizardTextKey } from "./wizard-text";

/** Statická mapa názvov krokov (i18n audit nevidí skladané kľúče). */
const STEP_LABEL: Partial<Record<OnboardingStep, WizardTextKey>> = {
  identity: "stepIdentity",
  folder: "stepFolder",
  found: "stepFound",
  ai: "stepAi",
  approvals: "stepApprovals",
  ready: "stepReady",
};

export const wizardStepLabel = (text: WizardText, step: OnboardingStep): string => {
  const key = STEP_LABEL[step];
  return key ? text(key) : step;
};

/**
 * Hlavička krokov. Hotový krok je tlačidlo (návrat bez straty údajov, ak ho volajúci dovolí), aktuálny má
 * `aria-current="step"`. V úzkom okne ostane viditeľný len názov aktuálneho kroku a „Krok n z N“.
 */
export function WizardProgress({ text, steps, current, onGo, disabled = false }: {
  text: WizardText;
  steps: readonly OnboardingStep[];
  current: number;
  onGo?: (step: OnboardingStep) => void;
  disabled?: boolean;
}) {
  return (
    <nav aria-label={text("stepsLabel")} className="lw-wiz-progress">
      {/* Úzke okno: namiesto stĺpcov s názvami jeden riadok „Krok n z N: názov“ (čítačka má zoznam nižšie). */}
      <p className="lw-wiz-progress-count" aria-hidden="true">
        {text("stepOf", { n: Math.max(1, current + 1), total: steps.length })}
        {steps[current] ? `: ${wizardStepLabel(text, steps[current])}` : null}
      </p>
      <ol className="lw-onb-steps" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((item, index) => {
          const state = index < current ? "done" : index === current ? "current" : "next";
          const label = (
            <>
              <span className="lw-onb-step-bar" />
              <span className="lw-onb-step-label">
                {state === "done" ? <Check className="lw-onb-step-check" aria-hidden /> : null}
                {index + 1}. {wizardStepLabel(text, item)}
                {state === "done" ? <span className="sr-only"> ({text("stepDone")})</span> : null}
                {state === "current" ? <span className="sr-only"> ({text("stepCurrent")})</span> : null}
              </span>
            </>
          );
          return (
            <li key={item} data-state={state} aria-current={state === "current" ? "step" : undefined}>
              {state === "done" && onGo ? (
                <button type="button" className="lw-onb-step-link" disabled={disabled} onClick={() => onGo(item)}>{label}</button>
              ) : label}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/**
 * Obrazovka kroku: nadpis s navigáciou vpravo (Späť je dosiahnuteľné bez rolovania), krátka veta a obrázok
 * vedľa seba (v úzkom okne pod sebou), obsah a voliteľné „Podrobnosti“ na konci.
 */
export function StepScreen({ step, title, lead, art, nav, children, details, detailsLabel, focusOnMount = false }: {
  step: string;
  title: string;
  lead?: ReactNode;
  art?: ReactNode;
  nav?: ReactNode;
  children?: ReactNode;
  details?: ReactNode;
  detailsLabel?: string;
  /** Obsah sa objavil neskôr než krok (napr. po prezretí priečinka): fokus na nadpis, ak ho nič iné nemá. */
  focusOnMount?: boolean;
}) {
  const heading = useRef<HTMLHeadingElement | null>(null);
  useEffect(() => {
    if (!focusOnMount || typeof document === "undefined") return;
    const active = document.activeElement;
    if (!active || active === document.body) heading.current?.focus();
  }, [focusOnMount]);
  return (
    <div className="lw-wiz-screen" data-lawoss-wizard-screen={step}>
      <div className="lw-wiz-head">
        <h2 ref={heading} className="text-xl font-semibold" tabIndex={-1}>{title}</h2>
        {nav ? <div className="lw-wiz-nav">{nav}</div> : null}
      </div>
      {lead || art ? (
        <div className="lw-wiz-intro">
          {lead ? <div className="lw-wiz-lead">{lead}</div> : <span />}
          {art ? <div className="lw-wiz-art">{art}</div> : null}
        </div>
      ) : null}
      {children}
      {details ? (
        <details className="lw-wiz-details">
          <summary>{detailsLabel}</summary>
          <div className="lw-wiz-details-body">{details}</div>
        </details>
      ) : null}
    </div>
  );
}

export type StatusTone = "ok" | "missing" | "warn" | "checking" | "unknown";

/** Stav vždy ikonou aj slovom (Hotové / Chýba / Pozor / Overujem / Neoverené), farba je len doplnok. */
const TONE_TEXT: Record<StatusTone, WizardTextKey> = { ok: "stateOk", missing: "stateMissing", warn: "stateWarn", checking: "stateChecking", unknown: "stateUnknown" };

export function StatusBadge({ text, tone, icon }: { text: WizardText; tone: StatusTone; icon: ReactNode }) {
  return (
    <span className="lw-wiz-badge" data-tone={tone}>
      <span aria-hidden="true">{icon}</span>
      {text(TONE_TEXT[tone])}
    </span>
  );
}
