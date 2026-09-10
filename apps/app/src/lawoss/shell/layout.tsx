/** @jsxImportSource react */
import type { ReactNode } from "react";
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

import { EXPERIMENT_VIEWS } from "../experiments/registry";
import "./lawoss.css";

export const EXPERIMENTY_PATH = "/experimenty";

/**
 * Everything reachable under the Experimenty item: the switch/status page
 * first, then each unfinished screen. Driven by the registry so adding an
 * experiment is still one row.
 */
export function experimentyNavItems(): { to: string; label: string }[] {
  return [
    { to: EXPERIMENTY_PATH, label: "Prepínače a stav" },
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
  const navigate = useNavigate();
  const location = useLocation();
  const items = experimentyNavItems();

  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">
          <SidebarMenuItem>
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <SidebarMenuButton
                    type="button"
                    isActive={!props.activePane && items.some((item) => item.to === location.pathname)}
                    className="gap-4 text-sidebar-foreground/80 [&_svg]:size-[18px]"
                  >
                    <FlaskConical strokeWidth={1.5} />
                    <span>Experimenty</span>
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
  return (
    <div className="lw-experiment-content">
      <nav className="lw-experiment-nav" aria-label="Experimenty">
        {experimentyNavItems().map((item) => (
          <NavLink key={item.to} to={item.to} end>{item.label}</NavLink>
        ))}
      </nav>
      <section className="lw-sheet">{props.children}</section>
    </div>
  );
}
