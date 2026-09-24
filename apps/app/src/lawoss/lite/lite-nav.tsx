/** @jsxImportSource react */
import { CalendarDays, FolderOpen, MessageSquare } from "lucide-react";
import { Link, NavLink, useLocation } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { officeWorkspace, today, useOkfConnection, useOkfOverview } from "../okf/read-model";
import { buildToday } from "./today-model";
import { LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, liteMatterLink } from "./links";

const RECENT_LIMIT = 5;
/** „Zeptat se“ = upstream nový chat bez věci. */
const ASK_PATH = "/session";

type RecentMatter = { path: string; title: string };

/** Boční panel v lite: Dnes · Klienti a věci · Zeptat se + „Poslední věci“. */
export function LiteNav(props: { activePane?: boolean }) {
  const { connection } = useOkfConnection();
  const query = useOkfOverview(connection, officeWorkspace(connection));
  const recent = query.data ? buildToday(query.data, today()).recent : [];
  return <LiteNavView recent={recent} activePane={props.activePane} />;
}

export function LiteNavView(props: { recent: readonly RecentMatter[]; activePane?: boolean }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const items = [
    { key: "today", to: LITE_TODAY_PATH, icon: CalendarDays, active: pathname === LITE_TODAY_PATH },
    { key: "clients", to: LITE_CLIENTS_PATH, icon: FolderOpen, active: pathname === LITE_CLIENTS_PATH || pathname === LITE_MATTER_PATH },
    { key: "ask", to: ASK_PATH, icon: MessageSquare, active: pathname === ASK_PATH },
  ] as const;
  const recent = props.recent.slice(0, RECENT_LIMIT);
  const currentMatter = pathname === LITE_MATTER_PATH ? new URLSearchParams(search).get("vec") : null;
  return (
    <>
      <SidebarGroup className="p-0 mac:titlebar-no-drag">
        <SidebarGroupContent>
          <SidebarMenu className="gap-0.5 px-2">
            {items.map((item) => (
              <SidebarMenuItem key={item.key}>
                <SidebarMenuButton
                  isActive={!props.activePane && item.active}
                  className="gap-3 text-sidebar-foreground/80 [&_svg]:size-[18px]"
                  render={<NavLink to={item.to} end data-lawoss-lite-nav={item.key} />}
                >
                  <item.icon strokeWidth={1.5} />
                  <span>{t(`lawoss.lite.nav_${item.key}`, locale)}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroupContent>
      </SidebarGroup>
      {recent.length > 0 ? (
        <SidebarGroup className="mt-3 p-0 mac:titlebar-no-drag">
          <SidebarGroupLabel className="lw-section-eyebrow px-5">{t("lawoss.lite.recent_matters", locale)}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {recent.map((matter) => {
                const active = !props.activePane && currentMatter === matter.path;
                // Link, ne NavLink: všechny věci sdílejí cestu /vec, liší se jen `?vec=`.
                return <SidebarMenuItem key={matter.path}>
                  <SidebarMenuButton
                    size="sm"
                    isActive={active}
                    render={<Link to={liteMatterLink(matter.path)} aria-current={active ? "page" : undefined} data-lawoss-lite-recent="" title={matter.title} />}
                  >
                    <span className="truncate">{matter.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>;
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}
