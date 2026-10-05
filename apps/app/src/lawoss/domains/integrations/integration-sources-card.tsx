/** @jsxImportSource react */
import { useId, type ReactNode } from "react";
import { Check } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { BRAND_NAME, UPSTREAM_BRAND_NAME } from "@/lawoss/branding";
import { Surface } from "@/react-app/design-system/surface";

import { setLegalworkSource } from "./legalwork-source-sync";
import { useLegalworkSource } from "./use-legalwork-source";

/**
 * LAWOSS: zdroje integrácií v natívnych Integráciách, nad záložkami
 * (rozhodnutie MČ 5. 10. 2026). LAWOSS je predvolený a vždy zapnutý, LegalWork je
 * voliteľný prepínač, vlastné integrácie ostávajú bez zmeny. Meno upstreamu ide do
 * textu ako parameter (`{source}`), lebo `t()` by „LegalWork“ v slovníku nahradil
 * za LAWOSS; tu ho advokát vidieť má, aby vedel, odkiaľ konektory pochádzajú.
 */
export function IntegrationSourcesCard() {
  const locale = useLocale();
  const enabled = useLegalworkSource();
  return <IntegrationSourcesContent locale={locale} legalWorkEnabled={enabled} onLegalworkChange={setLegalworkSource} />;
}

/** Telo karty bez stavu, exportované pre testy. */
export function IntegrationSourcesContent({
  locale,
  legalWorkEnabled,
  onLegalworkChange,
}: {
  locale: Language;
  legalWorkEnabled: boolean;
  onLegalworkChange: (enabled: boolean) => void;
}) {
  const switchLabelId = useId();
  const source = UPSTREAM_BRAND_NAME;
  return (
    <Surface className="p-5" aria-label={t("lawoss.integrations.sources.aria", locale)} data-lawoss-sources="">
      <p className="text-[11px] font-medium text-dls-secondary">{t("lawoss.integrations.sources.eyebrow", locale)}</p>
      <div className="mt-3 grid gap-3 md:grid-cols-3">
        <SourceTile
          title={BRAND_NAME}
          state={
            <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(201,162,74,0.45)] bg-[var(--lw-gold-ink)] px-2.5 py-0.5 text-[11px] font-medium text-dls-text">
              <Check aria-hidden="true" className="size-3 text-[var(--lw-gold)]" />
              {t("lawoss.integrations.sources.lawoss_badge", locale)}
            </span>
          }
          description={t("lawoss.integrations.sources.lawoss_description", locale)}
          accent
        />
        <SourceTile
          title={<span id={switchLabelId}>{source}</span>}
          state={
            <Switch
              aria-labelledby={switchLabelId}
              data-lawoss-source-switch="legalwork"
              checked={legalWorkEnabled}
              onCheckedChange={(next) => onLegalworkChange(next)}
            />
          }
          description={t("lawoss.integrations.sources.legalwork_description", { source, lng: locale })}
          note={t(legalWorkEnabled ? "lawoss.integrations.sources.legalwork_on" : "lawoss.integrations.sources.legalwork_off", { source, lng: locale })}
        />
        <SourceTile
          title={t("lawoss.integrations.sources.custom_title", locale)}
          description={t("lawoss.integrations.sources.custom_description", locale)}
        />
      </div>
    </Surface>
  );
}

function SourceTile({
  title,
  state,
  description,
  note,
  accent = false,
}: {
  title: ReactNode;
  state?: ReactNode;
  description: string;
  note?: string;
  accent?: boolean;
}) {
  return (
    <div
      className={`flex flex-col gap-2 rounded-[var(--lw-radius-xl)] border p-4 ${
        accent ? "border-[rgba(201,162,74,0.35)] bg-[var(--lw-accent-soft)]" : "border-dls-border bg-dls-surface"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-[15px] font-semibold text-dls-text">{title}</h4>
        {state}
      </div>
      <p className="text-[13px] leading-relaxed text-dls-secondary">{description}</p>
      {note ? <p className="mt-auto border-t border-dls-border pt-2 text-[11px] leading-relaxed text-dls-secondary">{note}</p> : null}
    </div>
  );
}
