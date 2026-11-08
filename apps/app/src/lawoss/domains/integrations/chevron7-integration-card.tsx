/** @jsxImportSource react */
import { useState, type MouseEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Check } from "lucide-react";

import { Button } from "@/components/ui/button";
import { desktopBridge, openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime, isMacPlatform } from "@/app/utils";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Surface } from "@/react-app/design-system/surface";

import chevron7Icon from "../../../../../../lawoss/brand/chevron7-icon.png";
import {
  CHEVRON7_NAME,
  CHEVRON7_WEB_URL,
  shouldCheckChevron7Installed,
  shouldShowChevron7Card,
} from "./chevron7-card";

const CHEVRON7_STATUS_QUERY_KEY = ["lawoss", "chevron7", "status"] as const;

/** Native PDF picker and installed Chevron7 own the signing flow. */
export function Chevron7IntegrationCard() {
  const locale = useLocale();
  const isMac = isMacPlatform();
  const statusQuery = useQuery({
    queryKey: CHEVRON7_STATUS_QUERY_KEY,
    queryFn: () => desktopBridge.chevron7Status(),
    enabled: shouldCheckChevron7Installed({ desktopRuntime: isDesktopRuntime(), isMac }),
    staleTime: 30_000,
    retry: false,
  });
  if (!shouldShowChevron7Card({ isMac })) return null;
  return <Chevron7CardContent locale={locale} installed={statusQuery.data?.installed === true}
    version={statusQuery.data?.version} available={statusQuery.data?.signingAvailable === true} />;
}

function openChevron7Web(event: MouseEvent<HTMLAnchorElement>) {
  event.preventDefault();
  void openDesktopUrl(CHEVRON7_WEB_URL);
}

/** Ungated card body, exported for tests (navigator is absent under bun). */
export function Chevron7CardContent({ locale, installed = false, available = false, version }: { locale: Language; installed?: boolean; available?: boolean; version?: string }) {
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<"returned" | "failed" | "interrupted" | null>(null);
  const sign = async () => {
    if (busy) return;
    setBusy(true); setOutcome(null);
    try {
      const result = await desktopBridge.chevron7SignPdf();
      if (result.status !== "cancelled") setOutcome(result.status === "returned" || result.status === "interrupted" ? result.status : "failed");
    } catch { setOutcome("failed"); }
    finally { setBusy(false); }
  };
  return (
    <Surface className="p-5" aria-label={t("lawoss.integrations.chevron7.aria", locale)}>
      <div className="flex items-start gap-4">
        <img
          src={chevron7Icon}
          alt=""
          className="size-12 shrink-0 rounded-[var(--lw-radius-xl)] shadow-[0_10px_24px_-12px_rgba(201,162,74,0.65)]"
        />
        <div className="min-w-0 flex-1">
          <div className="mt-0.5 flex flex-wrap items-center gap-2">
            <h4 className="text-[15px] font-semibold text-dls-text">{CHEVRON7_NAME}</h4>
            <span
              data-lawoss-badge="chevron7-signing"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(201,162,74,0.45)] bg-[var(--lw-gold-ink)] px-2.5 py-0.5 text-[11px] font-medium text-dls-text"
            >
              {t("lawoss.integrations.chevron7.badge", locale)}
            </span>
          </div>
          <p className="mt-2 max-w-prose text-[13px] leading-relaxed text-dls-secondary">
            {t("lawoss.integrations.chevron7.description", locale)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-dls-border pt-3">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dls-secondary">
          {installed ? (
            <span data-lawoss-status="chevron7-installed" className="inline-flex items-center gap-1 font-medium text-dls-text">
              <Check aria-hidden="true" className="size-3.5 text-[var(--lw-gold)]" />
              {t("lawoss.integrations.chevron7.installed", locale)}
              {version ? ` · ${version}` : null}
            </span>
          ) : null}
          {!available ? <span>{t("lawoss.integrations.chevron7.note", locale)}</span> : null}
        </p>
        {available ? <Button size="sm" disabled={busy} onClick={() => void sign()}>
          {t(busy ? "lawoss.integrations.chevron7.busy" : "lawoss.integrations.chevron7.sign", locale)}
        </Button> : null}
        <Button
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={
            <a
              href={CHEVRON7_WEB_URL}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t("lawoss.integrations.chevron7.link_aria", locale)}
              onClick={openChevron7Web}
            />
          }
        >
          {t("lawoss.integrations.chevron7.link", locale)}
          <ArrowUpRight />
        </Button>
      </div>
      {outcome ? <p role="status" className="mt-3 text-sm text-dls-secondary">{t(`lawoss.integrations.chevron7.${outcome}`, locale)}</p> : null}
    </Surface>
  );
}
