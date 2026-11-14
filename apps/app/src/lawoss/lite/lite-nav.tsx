/** @jsxImportSource react */
import { CalendarClock, CalendarDays, Search, UserPlus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { isMacPlatform } from "@/app/utils";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { useClientNav } from "./client-nav";
import { LEHOTY_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, NEW_CLIENT_PATH } from "./links";
import { restoreOfficeScope } from "./office-scope";
import { deadlineAttentionCount } from "./sidebar-model";
import { useUiMode, type UiMode } from "./ui-mode";

const OFFICE_PAGES = new Set([LITE_TODAY_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH]);

/**
 * Rozsah kancelárie len v bežnom režime. Pokročilý drží výber priečinka v sidebare
 * (`officeWorkspace` v okf/read-model.ts, G2 19. 10. 2026: navigácia je v oboch režimoch).
 */
export function restoresOfficeScope(pathname: string, mode: UiMode): boolean {
  return mode === "lite" && OFFICE_PAGES.has(pathname);
}

type NavProps = {
  activePane?: boolean;
  /** Natívny „Nový chat“ z `app-sidebar.tsx`; len Pokročilý režim (bežný ho má pri klientovi, prípade a na ⌘N). */
  newChat?: ReactNode;
  /** Natívny dialóg hľadania (⌘K / Ctrl K). */
  onOpenSearch?: () => void;
};

/**
 * Horné riadky bočného panela.
 * - Bežný režim (alfa 14): Dnes · Lehoty a úlohy (počet po termíne a do 7 dní) · Hľadať. „Pridať klienta“ je „+“
 *   v hlavičke Klienti, nový chat pri klientovi, v prípade a cez ⌘N / Ctrl N.
 * - Pokročilý režim bez zmeny (MČ 19. 10. 2026): Dnes · Nový chat (natívny) · Pridať klienta.
 * Klienti a ich prípady sú v natívnej sekcii projektov pod tým (`client-nav.tsx`).
 */
export function LiteNav(props: NavProps) {
  const { pathname } = useLocation();
  const mode = useUiMode();
  // Návrat z konverzace na stránku kanceláře vrátí rozsah na kancelář (nová věc, nastavení); len v bežnom režime.
  useEffect(() => {
    if (!restoresOfficeScope(pathname, mode)) return;
    restoreOfficeScope().catch((failure: unknown) => console.warn("LAWOSS-lite: office scope", failure));
  }, [pathname, mode]);
  const deadlines = deadlineAttentionCount(useClientNav()?.data);
  return <LiteNavView {...props} mode={mode} deadlines={deadlines} />;
}

const ROW_CLASS = "gap-3 text-sidebar-foreground/80 [&_svg]:size-[18px]";

export function LiteNavView(props: NavProps & { mode?: UiMode; deadlines?: number | null }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const today = !props.activePane && pathname === LITE_TODAY_PATH;
  const todayRow = <SidebarMenuItem>
    <SidebarMenuButton isActive={today} className={ROW_CLASS} render={<NavLink to={LITE_TODAY_PATH} end data-lawoss-lite-nav="today" />}>
      <CalendarDays strokeWidth={1.5} />
      <span>{t("lawoss.lite.nav_today", locale)}</span>
    </SidebarMenuButton>
  </SidebarMenuItem>;
  if (props.mode === "lite") {
    const deadlinesActive = !props.activePane && pathname === LEHOTY_PATH && !new URLSearchParams(search).has("klient");
    const shortcut = isMacPlatform() ? "⌘K" : "Ctrl K";
    return <LiteNavGroup>
      {todayRow}
      <SidebarMenuItem>
        <SidebarMenuButton isActive={deadlinesActive} className={ROW_CLASS} render={<Link to={LEHOTY_PATH} aria-current={deadlinesActive ? "page" : undefined} data-lawoss-lite-nav="deadlines" />}>
          <CalendarClock strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.nav_deadlines_tasks", locale)}</span>
          {props.deadlines ? <span className="lw-nav-meta" data-tone="warning" data-lawoss-lite-nav-count="">
            <span aria-hidden>{props.deadlines}</span>
            <span className="sr-only">{t("lawoss.lite.nav_deadlines_count", locale, { count: props.deadlines })}</span>
          </span> : null}
        </SidebarMenuButton>
      </SidebarMenuItem>
      <SidebarMenuItem>
        <SidebarMenuButton className={ROW_CLASS} aria-haspopup="dialog" aria-keyshortcuts={isMacPlatform() ? "Meta+k" : "Control+k"} data-lawoss-lite-nav="search" onClick={props.onOpenSearch} disabled={!props.onOpenSearch}>
          <Search strokeWidth={1.5} />
          <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.nav_search", locale)}</span>
          <kbd className="lw-nav-meta font-sans">{shortcut}</kbd>
        </SidebarMenuButton>
      </SidebarMenuItem>
    </LiteNavGroup>;
  }
  // Pridať klienta: Link s aria-current z presnej adresy; NavLink porovnáva len cestu /welcome.
  const adding = !props.activePane && `${pathname}${search}` === NEW_CLIENT_PATH;
  return <LiteNavGroup>
    {todayRow}
    {props.newChat}
    <SidebarMenuItem>
      <SidebarMenuButton isActive={adding} className={ROW_CLASS} render={<Link to={NEW_CLIENT_PATH} aria-current={adding ? "page" : undefined} data-lawoss-lite-nav="add_client" />}>
        <UserPlus strokeWidth={1.5} />
        <span>{t("lawoss.lite.add_client", locale)}</span>
      </SidebarMenuButton>
    </SidebarMenuItem>
  </LiteNavGroup>;
}

function LiteNavGroup({ children }: { children: ReactNode }) {
  return (
    <SidebarGroup className="p-0 mac:titlebar-no-drag">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">{children}</SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
