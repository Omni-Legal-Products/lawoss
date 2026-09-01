/** @jsxImportSource react */
import type { ReactNode } from "react";
import { NavLink } from "react-router-dom";

import lawossMark from "../../../../../lawoss/brand/lawoss-mark.svg";
import { useExperiment } from "../experiments/store";
import "./lawoss.css";

export type LawossTabItem = {
  to: string;
  label: string;
  count?: string;
  external?: boolean;
  /** Short marker rendered next to the label, e.g. unfinished work. */
  badge?: string;
};

/**
 * Register tabs are themselves an experiment inside the upstream session
 * sidebar: without the switch that sidebar stays vanilla. `Experimenty` is the
 * one entry that always shows, otherwise the switch would be unreachable.
 */
export const REGISTROVE_ZALOZKY_FLAG = "sidebar-registrove-zalozky";
export const EXPERIMENTY_PATH = "/experimenty";

/**
 * LAWOSS navigation — the register-tab groups. The `Asistent` and `Nastavenia`
 * entries jump back into the upstream shell (session / settings routes).
 * Mockup counts are fictional until lawoss/okf/read.ts lands (fáza C1).
 */
export const LAWOSS_TABS: { group: string; items: LawossTabItem[] }[] = [
  {
    group: "prax",
    items: [
      { to: "/prehlad", label: "Prehľad" },
      { to: "/lehoty", label: "Lehoty", count: "7" },
    ],
  },
  {
    group: "agent",
    items: [{ to: "/session", label: "Asistent", external: true }],
  },
  {
    group: "system",
    items: [
      { to: "/konektory", label: "Konektory", count: "8" },
      { to: "/marketplace", label: "Marketplace" },
      { to: "/settings", label: "Nastavenia", external: true },
    ],
  },
  {
    group: "experiment",
    items: [{ to: EXPERIMENTY_PATH, label: "Experimenty", badge: "EXP" }],
  },
];

function RailTabs() {
  return (
    <>
      {LAWOSS_TABS.map((group, index) => (
        <div key={group.group}>
          {index > 0 ? <div className="lw-gap" /> : null}
          {group.items.map((item) => (
            <NavLink key={item.to} to={item.to} className="lw-tab">
              {item.label}
              {item.badge ? <span className="lw-badge">{item.badge}</span> : null}
              <span className="lw-count">{item.count ?? ""}</span>
            </NavLink>
          ))}
        </div>
      ))}
    </>
  );
}

/**
 * Standalone LAWOSS page frame: register tabs on the desk, content on the sheet.
 * Fáza B renders the new views in this frame; fáza C2 folds the matter view into
 * the upstream session shell.
 */
export function LawossLayout(props: { children: ReactNode }) {
  return (
    <div className="lw-desk">
      <aside className="lw-rail">
        <div className="lw-brand">
          <img src={lawossMark} alt="LAWOSS" />
          <div>
            <div className="lw-wordmark">
              LAW<b>OSS</b>
            </div>
            <small>CZECHIA · SLOVAKIA</small>
          </div>
        </div>
        <RailTabs />
        <div className="lw-who">
          JUDr. Martin Novák
          <span>advokát · SR · fiktívne dáta</span>
        </div>
      </aside>
      <main className="lw-sheet">{props.children}</main>
    </div>
  );
}

/**
 * What the upstream session sidebar shows. With the switch off it stays vanilla
 * apart from the `Experimenty` door — without that door the switch that brings
 * the register tabs back would be unreachable from the session shell.
 */
export function visibleNavItems(registreOn: boolean): LawossTabItem[] {
  return LAWOSS_TABS.flatMap((group) => group.items)
    .filter((item) => !item.external)
    .filter((item) => registreOn || item.to === EXPERIMENTY_PATH);
}

/** Compact variant mounted inside the upstream session sidebar (1-line 🟡 insert). */
export function LawossNav() {
  const registreOn = useExperiment(REGISTROVE_ZALOZKY_FLAG);
  const items = visibleNavItems(registreOn);

  return (
    <nav className="lw-sidebar-nav" style={{ padding: "2px 8px 6px" }}>
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className="lw-tab"
          style={{ height: 32, marginLeft: 0, borderRadius: 6, transform: "none", boxShadow: "none" }}
        >
          {item.label}
          {item.badge ? <span className="lw-badge">{item.badge}</span> : null}
          <span className="lw-count">{item.count ?? ""}</span>
        </NavLink>
      ))}
    </nav>
  );
}
