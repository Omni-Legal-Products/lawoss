/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";
import { useControlAction, type LegalworkControlAction } from "../../../shell/control/control-provider";
import type { LegalworkServerClient, LegalworkServerStatus } from "../../../../app/lib/legalwork-server";
// 🟡 LAWOSS #454: pripojený server ešte neznamená bežiaci engine.
import { useEngineHealth, type EngineHealth } from "../../../../lawoss/shell/engine-health";

const STATUS_BAR_BOOT_STARTED_AT = Date.now();
const STATUS_BAR_INITIALIZING_MS = 15_000;

type StatusDotVariant = "connected" | "loading" | "partial" | "disconnected";

type StatusDotProps = {
  variant: StatusDotVariant;
};

function StatusDot({ variant }: StatusDotProps) {
  return (
    <span className="relative flex size-2.5 shrink-0 items-center justify-center">
      {variant === "loading" ? (
        <span
          className="absolute inline-flex size-full animate-ping rounded-full bg-amber-9/35"
        />
      ) : null}
      <span
        className={cn(
          "relative inline-flex size-2.5 rounded-full",
          variant === "connected" && "bg-green-9",
          variant === "loading" && "bg-amber-9",
          variant === "partial" && "bg-amber-9",
          variant === "disconnected" && "bg-red-9",
        )}
      />
    </span>
  );
}

type StatusIndicatorProps = {
  clientConnected: boolean;
  legalworkServerStatus: LegalworkServerStatus;
  developerMode: boolean;
  mcpConnectedCount: number;
  loading?: boolean;
  initializing: boolean;
  engineHealth: EngineHealth | null;
  onRetryEngine?: () => Promise<void>;
};

function StatusIndicator(props: StatusIndicatorProps) {
  const [retrying, setRetrying] = useState(false);
  if (props.loading || (props.legalworkServerStatus === "disconnected" && props.initializing)) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot variant="loading" />
        <span className="shrink-0 font-medium text-foreground text-xs">
          {t("session.preparing_workspace")}
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {t("session.loading_detail")}
        </span>
      </div>
    );
  }

  if (props.engineHealth === "restarting" || props.engineHealth === "unavailable") {
    const restarting = props.engineHealth === "restarting";
    return (
      <div className="flex min-w-0 items-center gap-2.5" role="status">
        <StatusDot variant={restarting ? "loading" : "disconnected"} />
        <span className="shrink-0 font-medium text-foreground text-xs">
          {t(restarting ? "lawoss.status.engine_restarting" : "lawoss.status.engine_unavailable")}
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {t(restarting ? "lawoss.status.engine_restarting_hint" : props.onRetryEngine ? "lawoss.status.engine_unavailable_retry_hint" : "lawoss.status.engine_unavailable_hint")}
        </span>
        {!restarting && props.onRetryEngine ? (
          <Button
            className="h-5 shrink-0 px-2 text-xs"
            variant="outline"
            size="xs"
            disabled={retrying}
            onClick={() => {
              const retry = props.onRetryEngine;
              if (!retry) return;
              setRetrying(true);
              void retry().catch(() => undefined).finally(() => setRetrying(false));
            }}
          >
            {t("lawoss.status.engine_retry")}
          </Button>
        ) : null}
      </div>
    );
  }

  if (props.clientConnected) {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <Tooltip>
          <TooltipTrigger render={<span className="inline-flex" />}>
            <StatusDot variant="connected" />
          </TooltipTrigger>
          <TooltipContent>{t("status.connected")}</TooltipContent>
        </Tooltip>
        <span className="truncate text-muted-foreground text-xs">
          {props.mcpConnectedCount > 0
            ? t("status.mcp_connected", undefined, { count: props.mcpConnectedCount })
            : t("status.ready_for_tasks")}
        </span>
        {props.developerMode ? (
          <span className="truncate text-muted-foreground text-xs">
            {t("status.developer_mode")}
          </span>
        ) : null}
      </div>
    );
  }

  if (props.legalworkServerStatus === "limited") {
    return (
      <div className="flex min-w-0 items-center gap-2.5">
        <StatusDot variant="partial" />
        <span className="shrink-0 font-medium text-foreground text-xs">
          {t("status.limited_mode")}
        </span>
        <span className="truncate text-muted-foreground text-xs">
          {props.mcpConnectedCount > 0
            ? t("status.limited_mcp_hint", undefined, { count: props.mcpConnectedCount })
            : t("status.limited_hint")}
        </span>
      </div>
    );
  }

  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <StatusDot variant="disconnected" />
      <span className="shrink-0 font-medium text-foreground text-xs">
        {t("status.disconnected_label")}
      </span>
      <span className="truncate text-muted-foreground text-xs">
        {t("status.disconnected_hint")}
      </span>
    </div>
  );
}

export type StatusBarProps = {
  clientConnected: boolean;
  legalworkServerStatus: LegalworkServerStatus;
  developerMode: boolean;
  settingsOpen: boolean;
  onOpenSettings: () => void;
  providerConnectedIds: string[];
  mcpConnectedCount: number;
  loading?: boolean;
  showSettingsButton?: boolean;
  initializing?: boolean;
  legalworkServerClient?: (Pick<LegalworkServerClient, "health"> & Partial<Pick<LegalworkServerClient, "restartEngine">>) | null;
};

export function StatusBar(props: StatusBarProps) {
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const engine = useEngineHealth(props.legalworkServerClient);
  const [initializing, setInitializing] = useState(
    () => Date.now() - STATUS_BAR_BOOT_STARTED_AT < STATUS_BAR_INITIALIZING_MS,
  );

  useEffect(() => {
    if (!initializing) return;
    const remaining = Math.max(
      0,
      STATUS_BAR_INITIALIZING_MS - (Date.now() - STATUS_BAR_BOOT_STARTED_AT),
    );
    const timeout = window.setTimeout(() => setInitializing(false), remaining);
    return () => window.clearTimeout(timeout);
  }, [initializing]);

  const settingsControlAction = useMemo<LegalworkControlAction>(() => ({
    id: "status.settings.open",
    label: props.settingsOpen ? "Go back from settings" : "Open settings from the status bar",
    description: "Use the visible settings button in the status bar.",
    sideEffect: "navigation",
    disabled: props.showSettingsButton === false,
    targetRef: settingsButtonRef,
    execute: props.onOpenSettings,
  }), [props.onOpenSettings, props.settingsOpen, props.showSettingsButton]);
  useControlAction(settingsControlAction);

  return (
    <div className="border-t border-border bg-background">
      <div className="flex h-8 items-center justify-between gap-3 px-4 md:px-6">
        <StatusIndicator
          clientConnected={props.clientConnected}
          legalworkServerStatus={props.legalworkServerStatus}
          developerMode={props.developerMode}
          mcpConnectedCount={props.mcpConnectedCount}
          loading={props.loading}
          initializing={initializing}
          engineHealth={engine.health}
          onRetryEngine={engine.retry}
        />

        <div className="flex items-center gap-1">
          {props.showSettingsButton !== false ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button
                    ref={settingsButtonRef}
                    className="text-muted-foreground gap-2"
                    variant="ghost"
                    size="icon-xs"
                    onClick={props.onOpenSettings}
                    aria-label={props.settingsOpen ? t("status.back") : t("status.settings")}
                  >
                    <Settings className="size-3.5" />
                  </Button>
                )}
              />
              <TooltipContent>{t("status.settings")}</TooltipContent>
            </Tooltip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
