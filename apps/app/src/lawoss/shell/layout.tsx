/** @jsxImportSource react */
import { useMemo, type ReactNode } from "react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { ChevronRight, FlaskConical } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useControlActions, type LegalworkControlAction } from "@/react-app/shell/control/control-provider";

import { EXPERIMENT_VIEWS } from "../experiments/registry";
import { LiteNav } from "../lite/lite-nav";
import { LITE_CLIENTS_PATH, LITE_TODAY_PATH } from "../lite/links";
import { currentUiMode, setUiMode, useUiMode } from "../lite/ui-mode";
import "./lawoss.css";

export const EXPERIMENTY_PATH = "/experimenty";

/**
 * Everything reachable under the Experimenty item: the switch/status page
 * first, then each unfinished screen. Driven by the registry so adding an
 * experiment is still one row.
 */
export function experimentyNavItems(): { to: string; label: string }[] {
  return [
    { to: EXPERIMENTY_PATH, label: t("lawoss.shell.switches_status") },
    ...EXPERIMENT_VIEWS.map((view) => ({ to: view.to, label: view.label })),
  ];
}

/**
 * The single LAWOSS entry in the upstream session sidebar (1-line 🟡 insert).
 * Everything else in that sidebar stays upstream — this only adds a collapsible
 * group holding the unfinished screens, never hides working navigation.
 */
/**
 * The single LAWOSS entry in the upstream session sidebar (1-line 🟡 insert).
 * Sub-items open in a menu, not inline: the upstream sidebar's top pane has a
 * fixed flex ratio, and an inline list overflowed into the folders pane at
 * small window heights. A menu takes no vertical space regardless of count.
 */
export function LawossNav(props: { activePane?: boolean } = {}) {
  const lite = useUiMode() === "lite";
  return (
    <>
      <LiteControlActions />
      {lite ? <LiteNav activePane={props.activePane} /> : <ExperimentsNav {...props} />}
    </>
  );
}

/**
 * Pure builder for the UI-mode control actions, kept separate from the
 * `useControlActions` wiring so unit tests can check ids/args/execute
 * behavior without a DOM (`useEffect`-based registration needs a real
 * mount — see `lawoss-lite-control-actions.test.ts`).
 */
export function liteControlActions(navigate: (path: string) => void): LegalworkControlAction[] {
  return [
    {
      id: "lawoss.lite.mode.get",
      label: "Get LAWOSS UI mode",
      description: "Return the current LAWOSS UI mode: lite or pro.",
      sideEffect: "none",
      execute: () => ({ mode: currentUiMode() }),
    },
    {
      id: "lawoss.lite.mode.set",
      label: "Set LAWOSS UI mode",
      description: "Switch between LAWOSS-lite and LAWOSS-pro.",
      sideEffect: "mutation",
      requiresArgs: true,
      args: [{ name: "mode", type: "string", required: true, description: "lite | pro" }],
      previewArgs: { mode: "lite" },
      execute: (args) => {
        const requested = (args as { mode?: unknown } | undefined)?.mode;
        if (requested !== "lite" && requested !== "pro") {
          return { ok: false, error: `Unknown mode: ${String(requested)}. Expected "lite" or "pro".` };
        }
        setUiMode(requested);
        return { ok: true, mode: requested };
      },
    },
    {
      id: "lawoss.lite.route.today",
      label: "Open LAWOSS-lite: Dnes",
      description: "Navigate to the LAWOSS-lite today view.",
      sideEffect: "navigation",
      execute: () => navigate(LITE_TODAY_PATH),
    },
    {
      id: "lawoss.lite.route.clients",
      label: "Open LAWOSS-lite: Klienti",
      description: "Navigate to the LAWOSS-lite clients view.",
      sideEffect: "navigation",
      execute: () => navigate(LITE_CLIENTS_PATH),
    },
  ];
}

/**
 * Control-mode actions for the UI-mode bridge (lawoss-smoke.mjs over CDP,
 * `window.__legalworkControl`). Registered here — not in `LiteNav` — because
 * `LawossNav` mounts in both lite and pro, so `mode.set` can flip pro→lite too.
 */
function LiteControlActions() {
  const navigate = useNavigate();
  const actions = useMemo(() => liteControlActions(navigate), [navigate]);
  useControlActions(actions);
  return null;
}

function ExperimentsNav(props: { activePane?: boolean }) {
  const locale = useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const items = experimentyNavItems();

  return (
    <SidebarGroup className="p-0 mac:titlebar-no-drag">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    type="button"
                    isActive={!props.activePane && items.some((item) => item.to === location.pathname)}
                    className="gap-3 text-sidebar-foreground/80 [&_svg]:size-[18px]"
                    data-lawoss-nav="experiments"
                  >
                    <FlaskConical strokeWidth={1.5} />
                    <span>{t("lawoss.shell.experiments", locale)}</span>
                    <span className="lw-badge">EXP</span>
                    <ChevronRight className="ms-auto" />
                  </SidebarMenuButton>
                }
              />
              <DropdownMenuContent align="start" side="right" className="min-w-52">
                {items.map((item) => (
                  <DropdownMenuItem key={item.to} onClick={() => navigate(item.to)}>
                    {item.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

/** Experiment content shares the persistent session shell and its sidebar. */
export function LawossLayout(props: { children: ReactNode }) {
  const locale = useLocale();
  // Lite: jen list — experimentální lišta (i „Nový spis (OKF)“) patří do pro.
  const lite = useUiMode() === "lite";
  return (
    <div className="lw-experiment-content">
      {lite ? null : <nav className="lw-experiment-nav" aria-label={t("lawoss.shell.experiments", locale)}>
        {experimentyNavItems().map((item) => (
          <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>
        ))}
      </nav>}
      <section className="lw-sheet">{props.children}</section>
    </div>
  );
}
