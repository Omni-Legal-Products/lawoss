/** @jsxImportSource react */
import { AlertTriangle, CheckCircle2, ShieldCheck } from "lucide-react";

import { Checkbox } from "@/components/ui/checkbox";
import { t } from "../../../i18n";
import {
  AI_DATA_REGIMES,
  type AiDataRegime,
  type SubscriptionDetection,
} from "./ai-guidance-state";

type AiGuidancePanelVariant = "onboarding" | "settings" | "compact";

export type AiGuidancePanelProps = {
  regime: AiDataRegime | null;
  onRegimeChange: (regime: AiDataRegime) => void;
  acknowledged: boolean;
  onAcknowledgedChange: (acknowledged: boolean) => void;
  subscription: SubscriptionDetection;
  variant?: AiGuidancePanelVariant;
};

const REGIME_OPTIONS: Array<{
  value: AiDataRegime;
  titleKey: string;
  descriptionKey: string;
}> = [
  { value: "local", titleKey: "ai_guidance.regime_local", descriptionKey: "ai_guidance.regime_local_desc" },
  { value: "dpa", titleKey: "ai_guidance.regime_dpa", descriptionKey: "ai_guidance.regime_dpa_desc" },
  { value: "consent", titleKey: "ai_guidance.regime_consent", descriptionKey: "ai_guidance.regime_consent_desc" },
];

function subscriptionLabel(subscription: SubscriptionDetection): string {
  switch (subscription.type) {
    case "eigenwelt-plus":
      return t("ai_guidance.subscription_plus");
    case "eigenwelt-pro":
      return t("ai_guidance.subscription_pro");
    case "eigenwelt-hub":
      return t("ai_guidance.subscription_hub");
    case "byo":
      return t("ai_guidance.subscription_byo");
    default:
      return t("ai_guidance.subscription_unknown");
  }
}

function confidenceLabel(subscription: SubscriptionDetection): string {
  if (subscription.confidence === "high") return t("ai_guidance.confidence_high");
  if (subscription.confidence === "medium") return t("ai_guidance.confidence_medium");
  return t("ai_guidance.confidence_low");
}

export function AiGuidancePanel({
  regime,
  onRegimeChange,
  acknowledged,
  onAcknowledgedChange,
  subscription,
  variant = "settings",
}: AiGuidancePanelProps) {
  const selectedRegime = regime;
  const selectedOption = selectedRegime
    ? REGIME_OPTIONS.find((option) => option.value === selectedRegime) ?? null
    : null;
  const isCompact = variant === "compact";

  return (
    <section className="rounded-[6px] border border-subtle bg-surface p-4 shadow-sm" data-ai-guidance-panel={variant}>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-[3px] border border-amber-7/40 bg-amber-2/60 text-amber-11">
            <ShieldCheck size={18} aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <span className="lw-section-eyebrow uppercase text-dls-secondary">{t("ai_guidance.eyebrow")}</span>
            <h3 className="mt-1 text-base font-medium text-dls-text">
              {variant === "onboarding" ? t("ai_guidance.onboarding_title") : t("ai_guidance.title")}
            </h3>
            <p className="mt-1 max-w-2xl text-sm leading-6 text-dls-secondary">
              {variant === "onboarding" ? t("ai_guidance.onboarding_desc") : t("ai_guidance.settings_desc")}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 rounded-[3px] border border-subtle bg-sunken px-2.5 py-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-dls-text">{t("ai_guidance.subscription")}</span>
          <span>{subscriptionLabel(subscription)}</span>
          <span className="text-[10px] uppercase tracking-[0.12em]">{confidenceLabel(subscription)}</span>
        </div>
      </div>

      {!isCompact ? (
        <div className="mt-4 grid gap-2 md:grid-cols-3" role="radiogroup" aria-label={t("ai_guidance.regime_group_label")}>
          {AI_DATA_REGIMES.map((value) => {
            const option = REGIME_OPTIONS.find((candidate) => candidate.value === value) ?? REGIME_OPTIONS[0];
            const selected = selectedRegime === value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`rounded-[3px] border p-3 text-left transition-colors ${
                  selected ? "border-amber-8 bg-amber-2/50" : "border-subtle bg-sunken hover:border-amber-7/50"
                }`}
                onClick={() => onRegimeChange(option.value)}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium text-dls-text">
                  {t(option.titleKey)}
                  {selected ? <CheckCircle2 size={15} className="shrink-0 text-amber-11" aria-hidden="true" /> : null}
                </span>
                <span className="mt-1 block text-xs leading-5 text-dls-secondary">{t(option.descriptionKey)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="mt-4 rounded-[3px] border border-subtle bg-sunken px-3 py-2 text-sm text-dls-text">
          <span className="text-muted-foreground">{t("ai_guidance.selected_regime")}: </span>
          {selectedOption ? t(selectedOption.titleKey) : t("ai_guidance.regime_unselected")}
        </div>
      )}

      <div className="mt-4 flex items-start gap-3 rounded-[3px] border border-amber-7/40 bg-amber-2/30 p-3 text-sm text-dls-text">
        <AlertTriangle size={17} className="mt-0.5 shrink-0 text-amber-11" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{t("ai_guidance.reminder_title")}</p>
          <p className="mt-1 leading-6 text-dls-secondary">
            {selectedRegime === "dpa"
              ? t("ai_guidance.reminder_dpa")
              : selectedRegime === "consent"
                ? t("ai_guidance.reminder_consent")
                : selectedRegime === "local"
                  ? t("ai_guidance.reminder_local")
                  : t("ai_guidance.reminder_unselected")}
          </p>
        </div>
      </div>

      <p className="mt-3 text-xs leading-5 text-dls-secondary" data-guidance-marker="no-training">
        {t("ai_guidance.no_training_note")}
      </p>

      {!isCompact ? (
        <>
          <label className="mt-4 flex items-start gap-3 text-sm text-dls-text">
            <Checkbox
              checked={acknowledged}
              onCheckedChange={(checked) => onAcknowledgedChange(checked === true)}
              className="mt-0.5"
            />
            <span>{t("ai_guidance.acknowledgement")}</span>
          </label>
          <p className="mt-3 border-t border-subtle pt-3 text-xs leading-5 text-dls-secondary" data-guidance-marker="AI lawyer">
            {t("ai_guidance.human_review")}
          </p>
        </>
      ) : null}

      <p className="mt-3 text-[11px] leading-5 text-muted-foreground">{t("ai_guidance.not_certificate")}</p>
    </section>
  );
}
