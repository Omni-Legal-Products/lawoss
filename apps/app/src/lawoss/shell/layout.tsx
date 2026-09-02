/** @jsxImportSource react */
import type { ReactNode } from "react";
import { ChevronRight, FlaskConical } from "lucide-react";
import { NavLink, useNavigate } from "react-router-dom";

import { PageTitlebarRegion } from "@/components/page";
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

import lawossMark from "../../../../../lawoss/brand/lawoss-mark.svg";
import { EXPERIMENT_VIEWS } from "../experiments/registry";
import { LawossWordmark } from "./wordmark";
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
export function LawossNav() {
  const navigate = useNavigate();
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

/**
 * Frame for the experimental screens. Deliberately not a second main
 * navigation: it carries the brand, a way back into the app, and the sibling
 * experiments — nothing that competes with the upstream shell.
 */
export function LawossLayout(props: { children: ReactNode }) {
  const items = experimentyNavItems();

  return (
    <div className="lw-desk">
      {/* Ťahacia lišta okna (mac) — rovnaký prvok, aký používa upstream. */}
      <PageTitlebarRegion />
      <aside className="lw-rail mac:titlebar-no-drag">
        <div className="lw-brand">
          <img src={lawossMark} alt="" />
          <div>
            <LawossWordmark className="lw-wordmark" />
            <small>CZECHIA SLOVAKIA AND BEYOND</small>
          </div>
        </div>

        <NavLink to="/session" className="lw-tab lw-tab-back">
          ← Späť do aplikácie
        </NavLink>

        <div className="lw-gap" />
        <div className="lw-rail-label">Experimenty</div>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} className="lw-tab">
            {item.label}
          </NavLink>
        ))}

        <div className="lw-who">
          Rozpracované
          <span>nie sú napojené na spisy</span>
        </div>
      </aside>
      <main className="lw-sheet mac:titlebar-no-drag">{props.children}</main>
    </div>
  );
}
