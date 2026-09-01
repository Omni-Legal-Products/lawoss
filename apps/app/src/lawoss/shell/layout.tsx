/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { ChevronRight, FlaskConical } from "lucide-react";
import { NavLink } from "react-router-dom";

import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
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
export function LawossNav() {
  const [open, setOpen] = useState(true);
  const items = experimentyNavItems();

  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-expanded={open}
              onClick={() => setOpen((value) => !value)}
              className="gap-4 text-sidebar-foreground/80 [&_svg]:size-[18px]"
            >
              <FlaskConical strokeWidth={1.5} />
              <span>Experimenty</span>
              <span className="lw-badge">EXP</span>
              <ChevronRight className={`ms-auto transition-transform ${open ? "rotate-90" : ""}`} />
            </SidebarMenuButton>
            {open ? (
              <SidebarMenuSub>
                {items.map((item) => (
                  <SidebarMenuSubItem key={item.to}>
                    <SidebarMenuSubButton render={<NavLink to={item.to} />}>
                      <span>{item.label}</span>
                    </SidebarMenuSubButton>
                  </SidebarMenuSubItem>
                ))}
              </SidebarMenuSub>
            ) : null}
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
      <aside className="lw-rail">
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
      <main className="lw-sheet">{props.children}</main>
    </div>
  );
}
