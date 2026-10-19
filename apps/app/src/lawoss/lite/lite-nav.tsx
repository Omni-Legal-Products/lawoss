/** @jsxImportSource react */
import { CalendarDays, FolderOpen, FolderPlus, MessageSquare } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { locateInScope, officeWorkspace, today, useOkfConnection, useOkfOverview, useOkfScope, type OkfScope } from "../okf/read-model";
import { buildToday } from "./today-model";
import { matterUrgency, useMinuteTick } from "./live";
import { ADD_FOLDER_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, liteMatterLink } from "./links";
import { openClientChat, openOfficeChat, restoreOfficeScope } from "./office-scope";
import { practiceClientChoices } from "./client-choice";
import { ClientPickerDialog } from "./client-picker";
import { currentUiMode, useUiMode, type UiMode } from "./ui-mode";

const RECENT_LIMIT = 5;
/** „Zeptat se“ = nová konverzace v kanceláři (`openOfficeChat`); `/session` v Pokročilom režime (aktívny priečinok) a ako záloha při chybě. */
const ASK_PATH = "/session";
const OFFICE_PAGES = new Set([LITE_TODAY_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH]);

/**
 * Rozsah kancelárie len v bežnom režime. Pokročilý drží výber priečinka v sidebare
 * (`officeWorkspace` v okf/read-model.ts, G2 19. 10. 2026: navigácia je v oboch režimoch).
 */
export function restoresOfficeScope(pathname: string, mode: UiMode): boolean {
  return mode === "lite" && OFFICE_PAGES.has(pathname);
}

/** Kam vedie „Opýtať sa“. `active`: Pokročilý režim, konverzácia v práve vybranom priečinku bez zmeny rozsahu. */
export type AskTarget = { kind: "active" } | { kind: "office" } | { kind: "client"; workspaceId: string } | { kind: "pick" };

/** Prax (MČ 16. 10. 2026): z detailu veci rovno do jej klienta, inak krátky výber klienta. */
export function askTarget(mode: UiMode, scope: OkfScope | null, choiceCount: number, pathname: string, search: string): AskTarget {
  if (mode !== "lite") return { kind: "active" };
  if (choiceCount < 2 || !scope) return { kind: "office" };
  const matter = pathname === LITE_MATTER_PATH ? new URLSearchParams(search).get("vec") : null;
  const owner = matter === null ? null : locateInScope(scope, matter)?.workspace.id;
  return owner ? { kind: "client", workspaceId: owner } : { kind: "pick" };
}

/** `deadlines` z pamäte OKF: bod pri veci ukáže naliehavosť jej najbližšej lehoty. */
type RecentMatter = { path: string; title: string; deadlines?: readonly { date: string; invalid?: true; file?: string }[] };

/** Boční panel v oboch režimoch: Dnes · Klienti a věci · Zeptat se · Pridať priečinok + „Poslední věci“. */
export function LiteNav(props: { activePane?: boolean }) {
  useMinuteTick(); // body naliehavosti sa o polnoci prepočítajú aj bez nového čítania
  const { connection } = useOkfConnection();
  // Prax „každý klient zvlášť“: posledné veci zo všetkých klientov, ako Dnes (N1).
  const { scope } = useOkfScope(connection, officeWorkspace(connection));
  const query = useOkfOverview(connection, scope);
  const day = today();
  const recent = useMemo(() => (query.data ? buildToday(query.data, day).recent : []), [query.data, day]);
  const { pathname, search } = useLocation();
  const navigate = useNavigate();
  const locale = useLocale();
  const choices = useMemo(() => practiceClientChoices(scope, query.data?.clients), [scope, query.data?.clients]);
  const [picking, setPicking] = useState(false);
  const mode = useUiMode();
  // Návrat z konverzace na stránku kanceláře vrátí rozsah na kancelář (nová věc, nastavení, Zeptat se); len v bežnom režime.
  useEffect(() => {
    if (!restoresOfficeScope(pathname, mode)) return;
    restoreOfficeScope().catch((failure: unknown) => console.warn("LAWOSS-lite: office scope", failure));
  }, [pathname, mode]);
  const open = (chat: Promise<string>) => {
    chat.then(navigate).catch((failure: unknown) => {
      console.warn("LAWOSS-lite: ask", failure);
      navigate(ASK_PATH);
    });
  };
  const onAsk = () => {
    const target = askTarget(currentUiMode(), scope, choices.length, pathname, search);
    if (target.kind === "active") navigate(ASK_PATH);
    else if (target.kind === "office") open(openOfficeChat());
    else if (target.kind === "client") open(openClientChat(target.workspaceId));
    else setPicking(true);
  };
  return <>
    <LiteNavView recent={recent} activePane={props.activePane} onAsk={onAsk} />
    <ClientPickerDialog open={picking} purpose="ask" choices={choices} activeId={connection?.activeWorkspaceId} locale={locale}
      onClose={() => setPicking(false)} onPick={(choice) => { setPicking(false); open(openClientChat(choice.id)); }} />
  </>;
}

export function LiteNavView(props: { recent: readonly RecentMatter[]; activePane?: boolean; onAsk?: () => void }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const items = [
    { key: "today", label: "lawoss.lite.nav_today", to: LITE_TODAY_PATH, icon: CalendarDays, active: pathname === LITE_TODAY_PATH },
    { key: "clients", label: "lawoss.lite.nav_clients", to: LITE_CLIENTS_PATH, icon: FolderOpen, active: pathname === LITE_CLIENTS_PATH || pathname === LITE_MATTER_PATH },
    { key: "ask", label: "lawoss.lite.nav_ask", to: ASK_PATH, icon: MessageSquare, active: pathname === ASK_PATH },
    // Namiesto riadku ikon onboardingu (G2 V1, 19. 10. 2026).
    { key: "add_folder", label: "lawoss.lite.add_folder", to: ADD_FOLDER_PATH, icon: FolderPlus, active: `${pathname}${search}` === ADD_FOLDER_PATH },
  ] as const;
  const recent = props.recent.slice(0, RECENT_LIMIT);
  const currentMatter = pathname === LITE_MATTER_PATH ? new URLSearchParams(search).get("vec") : null;
  const now = today();
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
                  // Pridať priečinok: Link s aria-current z presnej adresy; NavLink porovnáva len cestu /welcome.
                  render={item.key === "add_folder"
                    ? <Link to={item.to} aria-current={item.active ? "page" : undefined} data-lawoss-lite-nav={item.key} />
                    : <NavLink to={item.to} end data-lawoss-lite-nav={item.key} onClick={item.key === "ask" && props.onAsk ? (event) => { event.preventDefault(); props.onAsk?.(); } : undefined} />}
                >
                  <item.icon strokeWidth={1.5} />
                  <span>{t(item.label, locale)}</span>
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
                    {urgencyDot(matter, now, locale)}
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

/** Bod pri poslednej veci: červený, keď lehota horí, zlatý, keď sa blíži; inak nič. */
function urgencyDot(matter: RecentMatter, todayIso: string, locale: Language) {
  const urgency = matter.deadlines ? matterUrgency(matter.deadlines, todayIso) : undefined;
  return urgency ? <>
    <span className="lw-nav-urgency" data-urgency={urgency} aria-hidden />
    <span className="sr-only">{t(urgency === "hot" ? "lawoss.lite.urgent" : "lawoss.lite.matter_upcoming", locale)}</span>
  </> : null;
}
