/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { ExternalLink, Eye, FolderOpen, Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

import type { DesktopApplication } from "@/app/lib/desktop";
import { getDesktopApplicationsForFile, openDesktopWithApp } from "@/app/lib/desktop";
import { isElectronRuntime } from "@/app/utils";
import type { OpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import type { OpenTargetOptions } from "@/lib/target-provider";
import { t } from "@/i18n";

const SUPPORTED_PANEL_PREVIEWS = new Set(["browser", "markdown", "sheet", "slides", "word", "image", "audio", "video", "pdf", "html", "text"]);

type LinkActionMenuProps = {
  target: OpenTarget;
  anchor: HTMLElement;
  onOpenTarget: (target: OpenTarget, options?: OpenTargetOptions) => void;
  onClose: () => void;
};

export function LinkActionMenu({ target, anchor, onOpenTarget, onClose }: LinkActionMenuProps) {
  const [apps, setApps] = useState<DesktopApplication[] | null>(null);
  const [appsLoading, setAppsLoading] = useState(false);
  const canOpenInPanel = SUPPORTED_PANEL_PREVIEWS.has(target.preview);
  const canOpenExternally = isElectronRuntime();
  const canReveal = canOpenExternally && target.kind === "file";

  useEffect(() => {
    anchor.setAttribute("aria-haspopup", "menu");
    anchor.setAttribute("aria-expanded", "true");
    return () => {
      anchor.setAttribute("aria-expanded", "false");
    };
  }, [anchor]);

  useEffect(() => {
    setApps(null);
    setAppsLoading(canReveal);
    if (!canReveal) return;
    let cancelled = false;
    void (async () => {
      try {
        const result = await getDesktopApplicationsForFile(target.value);
        if (!cancelled) {
          setApps(result.slice(0, 3));
        }
      } catch {
        if (!cancelled) setApps([]);
      } finally {
        if (!cancelled) setAppsLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [canReveal, target.value]);

  const handleOpenDefault = () => {
    onOpenTarget(target, { external: true });
    onClose();
  };

  const handleOpenInPanel = () => {
    onOpenTarget(target);
    onClose();
  };

  const handleReveal = () => {
    onOpenTarget(target, { external: true, reveal: true });
    onClose();
  };

  const handleOpenWithApp = async (app: DesktopApplication) => {
    try {
      await openDesktopWithApp(target.value, app.appPath);
    } catch {
      // fall back to default open
      onOpenTarget(target, { external: true });
    }
    onClose();
  };

  return (
    <DropdownMenu open modal={false} onOpenChange={(open, details) => {
      if (details.reason === "outside-press" && details.event.target instanceof Node && anchor.contains(details.event.target)) {
        details.cancel();
        return;
      }
      if (!open) onClose();
    }}>
      <DropdownMenuContent
        anchor={anchor}
        align="end"
        finalFocus={() => anchor}
        aria-label={t("markdown.open_with")}
        className="w-60 max-w-[calc(100vw-1rem)] rounded-xl bg-popover shadow-lg"
      >
        <DropdownMenuItem
          onClick={handleOpenDefault}
          disabled={!canOpenExternally}
        >
          <ExternalLink className="size-4 shrink-0" />
          {t(target.kind === "url" ? "link_menu.open_default_browser" : "link_menu.open_default_app")}
        </DropdownMenuItem>
        {canOpenInPanel ? (
          <DropdownMenuItem onClick={handleOpenInPanel}>
            <Eye className="size-4 shrink-0" />
            {t("link_menu.open_in_panel")}
          </DropdownMenuItem>
        ) : null}
        {target.kind === "file" ? <DropdownMenuItem
          onClick={handleReveal}
          disabled={!canReveal}
        >
          <FolderOpen className="size-4 shrink-0" />
          {t("link_menu.show_in_folder")}
        </DropdownMenuItem> : null}
        {canOpenExternally && apps && apps.length > 0 ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuLabel className="py-1">{t("markdown.open_with")}</DropdownMenuLabel>
              {apps.map((app) => (
                <DropdownMenuItem
                  key={app.appPath}
                  onClick={() => void handleOpenWithApp(app)}
                >
                  {app.icon ? (
                    <img src={app.icon} alt="" className="size-4 shrink-0 object-contain" />
                  ) : (
                    <span className="size-4 shrink-0" />
                  )}
                  <span className="truncate">{app.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </>
        ) : appsLoading ? (
          <>
            <DropdownMenuSeparator />
            <div className="flex items-center gap-2 px-3 py-1.5 text-sm text-muted-foreground">
              <Loader2 className="size-3.5 shrink-0 animate-spin" />
              {t("markdown.open_with")}
            </div>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
