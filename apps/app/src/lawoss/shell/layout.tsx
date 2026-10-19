/** @jsxImportSource react */
import { useMemo, type ReactNode } from "react";
import { t } from "@/i18n";
import { useNavigate } from "react-router-dom";

import { useControlActions, type LegalworkControlAction } from "@/react-app/shell/control/control-provider";

import { MarketplaceUpdateNotifier } from "../domains/marketplace/update-notifier";
import { VISIBLE_EXPERIMENT_VIEWS } from "../experiments/registry";
import { LiteNav } from "../lite/lite-nav";
import { LITE_CLIENTS_PATH, LITE_TODAY_PATH } from "../lite/links";
import { currentUiMode, setUiMode } from "../lite/ui-mode";
import "./lawoss.css";

export const EXPERIMENTY_PATH = "/experimenty";

/**
 * Everything reachable on the Experimenty page: the switch/status page first,
 * then each unfinished screen. Driven by the registry so adding an experiment
 * is still one row. Since G2 (19. 10. 2026) neither the sidebar nor a toolbar
 * links here; the routes stay reachable by address.
 */
export function experimentyNavItems(): { to: string; label: string }[] {
  return [
    { to: EXPERIMENTY_PATH, label: t("lawoss.shell.switches_status") },
    ...VISIBLE_EXPERIMENT_VIEWS.map((view) => ({ to: view.to, label: view.label })),
  ];
}

/**
 * The single LAWOSS entry in the upstream session sidebar (1-line 🟡 insert).
 * One navigation in both UI modes (G2, 19. 10. 2026): Dnes, the native „Nový chat“
 * row handed over as `newChat`, Pridať klienta. Clients and their matters live in
 * the native project section below (`lite/client-nav.tsx`, MČ 19. 10. 2026).
 */
export function LawossNav(props: { activePane?: boolean; newChat?: ReactNode } = {}) {
  return (
    <>
      <LiteControlActions />
      <MarketplaceUpdateNotifier />
      <LiteNav activePane={props.activePane} newChat={props.newChat} />
    </>
  );
}

/**
 * Pure builder for the UI-mode control actions, kept separate from the
 * `useControlActions` wiring so unit tests can check ids/args/execute
 * behavior without a DOM (`useEffect`-based registration needs a real
 * mount - see `lawoss-lite-control-actions.test.ts`).
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
 * `window.__legalworkControl`). Registered here - not in `LiteNav` - because
 * `LawossNav` mounts in both lite and pro, so `mode.set` can flip pro→lite too.
 */
function LiteControlActions() {
  const navigate = useNavigate();
  const actions = useMemo(() => liteControlActions(navigate), [navigate]);
  useControlActions(actions);
  return null;
}

/** LAWOSS content shares the persistent session shell and its sidebar. */
export function LawossLayout(props: { children: ReactNode }) {
  return (
    <div className="lw-experiment-content">
      <section className="lw-sheet">{props.children}</section>
    </div>
  );
}
