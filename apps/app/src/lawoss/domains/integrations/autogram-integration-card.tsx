/** @jsxImportSource react */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { desktopBridge, openDesktopUrl } from "@/app/lib/desktop";
import { isDesktopRuntime, isMacPlatform } from "@/app/utils";
import { t } from "@/i18n";

import autogramIcon from "../../../../../../lawoss/brand/autogram-icon.png";
import {
  AUTOGRAM_RELEASES_URL,
  resolveAutogramCardAction,
  shouldShowAutogramCard,
} from "./autogram-status";

const AUTOGRAM_STATUS_QUERY_KEY = ["lawoss", "autogram", "status"] as const;

/**
 * LAWOSS: presents Autogram (a separate, already-working native macOS
 * signing app by the same author) and detects whether it is installed. This
 * is a teaser, not a working integration — Autogram runs entirely on its
 * own; LAWOSS only offers to open it or point to its releases page. Renders
 * nothing outside the macOS desktop app.
 */
export function AutogramIntegrationCard() {
  const visible = shouldShowAutogramCard({
    desktopRuntime: isDesktopRuntime(),
    isMac: isMacPlatform(),
  });
  const [opening, setOpening] = useState(false);

  const statusQuery = useQuery({
    queryKey: AUTOGRAM_STATUS_QUERY_KEY,
    queryFn: () => desktopBridge.autogramStatus(),
    enabled: visible,
    refetchOnWindowFocus: false,
  });

  if (!visible) return null;

  const action = resolveAutogramCardAction(statusQuery.data);

  const handlePrimaryAction = async () => {
    if (action === "open") {
      setOpening(true);
      try {
        const result = await desktopBridge.autogramOpen();
        if (!result.ok) {
          toast.warning(result.error ?? t("autogram.open_failed"));
        }
      } catch (error) {
        toast.warning(error instanceof Error ? error.message : String(error));
      } finally {
        setOpening(false);
      }
      return;
    }
    await openDesktopUrl(AUTOGRAM_RELEASES_URL);
  };

  const busy = opening || statusQuery.isLoading;

  return (
    <div className="rounded-[18px] border border-dls-border bg-dls-surface p-4">
      <div className="flex items-start gap-3">
        <img src={autogramIcon} alt="" className="size-10 shrink-0 rounded-xl" />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="text-sm font-semibold text-dls-text">{t("autogram.title")}</h4>
            <span className="shrink-0 rounded-full border border-dls-border bg-dls-hover px-2 py-0.5 text-[10px] font-medium text-dls-secondary">
              {t("autogram.badge")}
            </span>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-dls-secondary">{t("autogram.description")}</p>
        </div>
      </div>

      <ul className="mt-3 grid grid-cols-1 gap-1 text-[11px] text-dls-secondary sm:grid-cols-2">
        <li>• {t("autogram.module_signing")}</li>
        <li>• {t("autogram.module_conversion")}</li>
        <li>• {t("autogram.module_safari")}</li>
        <li>• {t("autogram.module_registry")}</li>
      </ul>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-dls-secondary/70">
          {statusQuery.isPending
            ? t("autogram.status_loading")
            : statusQuery.data?.installed
              ? t("autogram.status_installed")
              : t("autogram.status_not_installed")}
          {" · "}
          {t("autogram.integration_note")}
        </p>
        <Button size="sm" disabled={busy} onClick={() => void handlePrimaryAction()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : null}
          {action === "open" ? t("autogram.open_app") : t("autogram.get_app")}
          <ArrowUpRight />
        </Button>
      </div>
    </div>
  );
}
