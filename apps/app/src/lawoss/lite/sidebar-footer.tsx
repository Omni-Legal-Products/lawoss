/** @jsxImportSource react */
/**
 * Spodok bočného panela v bežnom režime (alfa 14): stav registrov, Nahlásiť chybu alebo nápad, Nastavenia.
 * Bežný režim nemá ľavú lištu, preto sú Nastavenia tu. Pokročilý režim tento spodok nemá (lišta ostáva).
 */
import { MessageSquareWarning, Settings } from "lucide-react";
import { Link, useLocation } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { usePlatform } from "@/react-app/kernel/platform";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import { useMcpStatuses } from "./mcp-status-store";
import { feedbackPageUrl, registersSummary, type RegistersSummary } from "./sidebar-model";

const ROW_CLASS = "gap-2.5 text-[13px] text-sidebar-foreground/80 [&_svg]:size-4";

/** Nastavenia a Integrácie vybraného priečinka, ako tlačidlo Nastavenia v lište; bez priečinka globálne. */
export const settingsPath = (workspaceId: string | null | undefined, tab: string): string =>
  workspaceId ? workspaceSettingsRoute(workspaceId, tab) : `/settings/${tab}`;

const isSettingsPath = (pathname: string): boolean => /^(?:\/workspace\/[^/]+)?\/settings(?:\/|$)/.test(pathname);

/** Text riadku registrov; `null` = stav neznámy (nič netvrdí, riadok sa neukáže). */
export function registersText(summary: RegistersSummary, locale: Language): { label: string; meta?: string } | null {
  if (summary.state === "unknown") return null;
  if (summary.state === "failing") return { label: t("lawoss.lite.registers_failing", locale, { count: summary.failing }) };
  const meta = `${summary.ready}/${summary.total}`;
  return summary.state === "ready" ? { label: t("lawoss.lite.registers_ready", locale), meta } : { label: t("lawoss.lite.registers_starting", locale), meta };
}

export function LiteSidebarFooter({ workspaceId }: { workspaceId?: string | null }) {
  const platform = usePlatform();
  const locale = useLocale();
  const summary = registersSummary(useMcpStatuses());
  return <LiteSidebarFooterView workspaceId={workspaceId} summary={summary} locale={locale} onReport={() => platform.openLink(feedbackPageUrl(locale))} />;
}

export function LiteSidebarFooterView(props: { workspaceId?: string | null; summary: RegistersSummary; locale: Language; onReport: () => void }) {
  const { pathname, state } = useLocation();
  const registers = registersText(props.summary, props.locale);
  const inSettings = isSettingsPath(pathname);
  return (
    <SidebarMenu className="gap-0.5 border-t border-sidebar-border px-2 pb-2 pt-2 mac:titlebar-no-drag" data-lawoss-lite-footer="">
      {registers ? <SidebarMenuItem>
        <SidebarMenuButton className={`lw-registers ${ROW_CLASS}`} data-state={props.summary.state} render={<Link to={settingsPath(props.workspaceId, "extensions/mcp")} state={state} data-lawoss-lite-nav="registers" />}>
          <span aria-hidden className="lw-registers-dot" data-state={props.summary.state} />
          <span className="lw-registers-label min-w-0 flex-1 truncate">{registers.label}</span>
          {registers.meta ? <span className="lw-nav-meta">{registers.meta}</span> : null}
        </SidebarMenuButton>
      </SidebarMenuItem> : null}
      <SidebarMenuItem>
        <SidebarMenuButton className={ROW_CLASS} onClick={props.onReport} data-lawoss-lite-nav="report">
          <MessageSquareWarning strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.report_problem", props.locale)}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton isActive={inSettings} className={ROW_CLASS} render={<Link to={settingsPath(props.workspaceId, "general")} state={state} aria-current={inSettings ? "page" : undefined} data-lawoss-lite-nav="settings" />}>
          <Settings strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{t("settings.tab_settings", props.locale)}</span>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
