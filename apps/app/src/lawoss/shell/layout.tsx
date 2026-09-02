/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { ChevronRight, FlaskConical } from "lucide-react";
import { NavLink } from "react-router-dom";

import { PageTitlebarRegion } from "@/components/page";
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
const NAV_OPEN_KEY = "lawoss.experimenty.open";

function readNavOpen(): boolean {
  try {
    return globalThis.localStorage?.getItem(NAV_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

export function LawossNav() {
  // Predvolene zbalené: upstream sidebar má hornú časť s pevným pomerom a
  // rozbalené sub-items by ju pretiekli do zoznamu priečinkov.
  const [open, setOpen] = useState(readNavOpen);
  const items = experimentyNavItems();
  const toggle = () =>
    setOpen((value) => {
      try {
        globalThis.localStorage?.setItem(NAV_OPEN_KEY, value ? "0" : "1");
      } catch {
        // ignore
      }
      return !value;
    });

  return (
    <SidebarGroup className="py-0">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">
          <SidebarMenuItem>
            <SidebarMenuButton
              type="button"
              aria-expanded={open}
              onClick={toggle}
              className="gap-4 text-sidebar-foreground/80 [&_svg]:size-[18px]"
            >
              <FlaskConical strokeWidth={1.5} />
              <span>Experimenty</span>
              <span className="lw-badge">EXP</span>
              <ChevronRight className={`ms-auto transition-transform ${open ? "rotate-90" : ""}`} />
            </SidebarMenuButton>
            {open ? (
              <SidebarMenuSub className="lw-exp-sub">
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
