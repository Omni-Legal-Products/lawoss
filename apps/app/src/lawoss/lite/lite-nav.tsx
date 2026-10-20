/** @jsxImportSource react */
import { CalendarDays, UserPlus } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SidebarGroup, SidebarGroupContent, SidebarMenu, SidebarMenuButton, SidebarMenuItem } from "@/components/ui/sidebar";
import { LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, NEW_CLIENT_PATH } from "./links";
import { restoreOfficeScope } from "./office-scope";
import { useUiMode, type UiMode } from "./ui-mode";

const OFFICE_PAGES = new Set([LITE_TODAY_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH]);

/**
 * Rozsah kancelárie len v bežnom režime. Pokročilý drží výber priečinka v sidebare
 * (`officeWorkspace` v okf/read-model.ts, G2 19. 10. 2026: navigácia je v oboch režimoch).
 */
export function restoresOfficeScope(pathname: string, mode: UiMode): boolean {
  return mode === "lite" && OFFICE_PAGES.has(pathname);
}

/**
 * Horné riadky bočného panela v oboch režimoch (MČ 19. 10. 2026): Dnes · Nový chat (natívny,
 * odovzdá ho `app-sidebar.tsx`) · Pridať klienta. Klienti a ich prípady sú v natívnej sekcii
 * projektov pod tým (`client-nav.tsx`); „Klienti a prípady“ otvára mriežka v jej hlavičke.
 */
export function LiteNav(props: { activePane?: boolean; newChat?: ReactNode }) {
  const { pathname } = useLocation();
  const mode = useUiMode();
  // Návrat z konverzace na stránku kanceláře vrátí rozsah na kancelář (nová věc, nastavení); len v bežnom režime.
  useEffect(() => {
    if (!restoresOfficeScope(pathname, mode)) return;
    restoreOfficeScope().catch((failure: unknown) => console.warn("LAWOSS-lite: office scope", failure));
  }, [pathname, mode]);
  return <LiteNavView activePane={props.activePane} newChat={props.newChat} />;
}

export function LiteNavView(props: { activePane?: boolean; newChat?: ReactNode }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const today = !props.activePane && pathname === LITE_TODAY_PATH;
  // Pridať klienta: Link s aria-current z presnej adresy; NavLink porovnáva len cestu /welcome.
  const adding = !props.activePane && `${pathname}${search}` === NEW_CLIENT_PATH;
  const rowClass = "gap-3 text-sidebar-foreground/80 [&_svg]:size-[18px]";
  return (
    <SidebarGroup className="p-0 mac:titlebar-no-drag">
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5 px-2">
          <SidebarMenuItem>
            <SidebarMenuButton isActive={today} className={rowClass} render={<NavLink to={LITE_TODAY_PATH} end data-lawoss-lite-nav="today" />}>
              <CalendarDays strokeWidth={1.5} />
              <span>{t("lawoss.lite.nav_today", locale)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
          {props.newChat}
          <SidebarMenuItem>
            <SidebarMenuButton isActive={adding} className={rowClass} render={<Link to={NEW_CLIENT_PATH} aria-current={adding ? "page" : undefined} data-lawoss-lite-nav="add_client" />}>
              <UserPlus strokeWidth={1.5} />
              <span>{t("lawoss.lite.add_client", locale)}</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
