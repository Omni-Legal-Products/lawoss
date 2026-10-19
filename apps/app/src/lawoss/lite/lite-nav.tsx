/** @jsxImportSource react */
import { CalendarDays, ChevronRight, FolderOpen, FolderPlus, MessageSquare, Plus } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueries, useQueryClient } from "@tanstack/react-query";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Button } from "@/components/ui/button";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { locateInScope, localMatter, officeWorkspace, today, useOkfConnection, useOkfOverview, useOkfScope, type OkfReadResult, type OkfScope } from "../okf/read-model";
import type { OkfConnection } from "../okf/connection";
import { openMatterSession } from "../okf/matter-session";
import { groupByClient } from "./today-model";
import { matterUrgency, useMinuteTick } from "./live";
import { ADD_FOLDER_PATH, clientOverviewLink, LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, liteMatterLink } from "./links";
import { openClientChat, openOfficeChat, restoreOfficeScope } from "./office-scope";
import { practiceClientChoices } from "./client-choice";
import { ClientPickerDialog } from "./client-picker";
import { currentUiMode, useUiMode, type UiMode } from "./ui-mode";
import { buildClientTree, clientToggle, matterToggle, routeFocus, sessionFocus, workspacesToFetch, type Locate, type TreeClient, type TreeMatter } from "./client-tree";
import { conversationsInDirectory, listWorkspaceSessions, matterDirectory, matterSessionSources, openMatterConversation, type MatterConversation } from "./matter-conversations";
import { composeQuickAction } from "./quick-actions";

/** „Zeptat se“ = nová konverzace v kanceláři (`openOfficeChat`); `/session` v Pokročilom režime (aktívny priečinok) a ako záloha při chybě. */
const ASK_PATH = "/session";
const OFFICE_PAGES = new Set([LITE_TODAY_PATH, LITE_CLIENTS_PATH, LITE_MATTER_PATH]);
/** Zoznamy rozhovorov stromu; po každej navigácii sa obnovia len tie práve čítané (rozbalené). */
const TREE_SESSIONS_KEY = "lite-tree-sessions";

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

/** Boční panel v oboch režimoch: Dnes · Klienti a věci · Zeptat se · Pridať priečinok + strom klientov (variant A, 19. 10. 2026). */
export function LiteNav(props: { activePane?: boolean }) {
  useMinuteTick(); // body naliehavosti sa o polnoci prepočítajú aj bez nového čítania
  const { connection } = useOkfConnection();
  // Prax „každý klient zvlášť“: strom zo všetkých klientov, ako Klienti a veci (N1).
  const { scope } = useOkfScope(connection, officeWorkspace(connection));
  const query = useOkfOverview(connection, scope);
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
  const tree = useClientTree(connection, scope, query.data, pathname, search, locale);
  return <>
    <LiteNavView tree={tree.nodes} activePane={props.activePane} onAsk={onAsk} onToggle={tree.toggle}
      onOpenConversation={tree.openConversation} onNewConversation={tree.newConversation} />
    <ClientPickerDialog open={picking} purpose="ask" choices={choices} activeId={connection?.activeWorkspaceId} locale={locale}
      onClose={() => setPicking(false)} onPick={(choice) => { setPicking(false); open(openClientChat(choice.id)); }} />
  </>;
}

/**
 * Dáta stromu: klienti a veci z prehľadu (žiadne ďalšie čítanie), rozhovory len pre priečinky
 * rozbalených vecí a práve otvorenej konverzácie (`workspacesToFetch`), v cache React Query.
 */
function useClientTree(connection: OkfConnection | null, scope: OkfScope | null, data: OkfReadResult | undefined, pathname: string, search: string, locale: Language) {
  const navigate = useNavigate();
  const queries = useQueryClient();
  const running = useRef(false);
  const [overrides, setOverrides] = useState<Readonly<Record<string, boolean>>>({});
  const groups = useMemo(() => data ? groupByClient(data.matters, data.inputs, data.clients) : [], [data]);
  const locate = useCallback<Locate>((path) => scope ? locateInScope(scope, path) : null, [scope]);
  const route = useMemo(() => routeFocus(pathname, search), [pathname, search]);
  const legacy = useCallback((path: string) => {
    const at = locate(path);
    return at && connection ? matterSessionSources(connection.workspaces, at.workspace, at.path).slice(1).map((w) => w.id) : [];
  }, [locate, connection]);
  const canStart = useCallback((path: string) => locate(path) !== null, [locate]);
  // Ktoré priečinky čítať: z trasy a prepnutí, ešte bez rozhovorov (vec z konverzácie je v jej priečinku).
  const ids = useMemo(() => workspacesToFetch(
    buildClientTree({ groups, focus: route, overrides, conversations: () => undefined, canStart }),
    locate, route.session?.workspaceId, legacy,
  ), [groups, route, overrides, canStart, locate, legacy]);
  const client = connection?.client ?? null;
  const results = useQueries({
    queries: ids.map((id) => ({
      queryKey: [TREE_SESSIONS_KEY, id, connection?.baseUrl ?? "", connection?.token ?? ""],
      enabled: Boolean(client),
      staleTime: 10_000,
      queryFn: () => {
        if (!client) throw new Error("no connection");
        return listWorkspaceSessions(client, id);
      },
    })),
  });
  // Nová konverzácia alebo jej názov (dá ho agent po prvej správe): po navigácii čítať znova.
  useEffect(() => { void queries.invalidateQueries({ queryKey: [TREE_SESSIONS_KEY] }); }, [pathname, queries]);
  const lists = results.flatMap((r) => r.data ? [r.data] : []);
  const focus = route.session
    ? sessionFocus(route.session, lists, groups.flatMap((g) => g.matters).map((m) => ({ path: m.path, at: locate(m.path) })), groups)
    : route;
  const nodes = buildClientTree({
    groups, focus, overrides, canStart,
    conversations: (path) => {
      const at = locate(path);
      return at ? conversationsInDirectory(lists, matterDirectory(at.workspace, at.path)) : undefined;
    },
  });
  const toggle = useCallback((key: string, expanded: boolean) => setOverrides((prev) => ({ ...prev, [key]: !expanded })), []);
  const run = (work: () => Promise<string>, fallback?: string) => {
    if (running.current) return;
    running.current = true;
    work().then((to) => {
      void queries.invalidateQueries({ queryKey: [TREE_SESSIONS_KEY] });
      navigate(to);
    }).catch((failure: unknown) => {
      console.warn("LAWOSS-lite: tree conversation", failure);
      // Záloha: konverzácia bez aktivácie, alebo detail veci, ktorý ukáže, čo chýba (napr. model).
      if (fallback) navigate(fallback);
    }).finally(() => { running.current = false; });
  };
  const openConversation = (conversation: MatterConversation) => {
    if (!connection) return;
    // Bez aktivácie (napr. mimo desktopu) aspoň otvoriť konverzáciu; priečinok vyberie trasa konverzácie.
    run(() => openMatterConversation(connection, conversation), workspaceSessionRoute(conversation.workspaceId, conversation.id));
  };
  /** Ako rýchla akcia na detaile veci: nová konverzácia v priečinku veci u jej klienta, s konceptom (nič sa neodošle). */
  const newConversation = (path: string) => {
    const matter = data?.matters.find((m) => m.path === path);
    const target = matter && scope && data ? localMatter(scope, matter, data.matters) : null;
    if (!connection || !matter || !target) return;
    const prompt = composeQuickAction("open", { title: matter.title, matterRef: matter.matterRef, path: target.selected.path }, locale);
    run(() => openMatterSession(connection, target.workspace, target.selected, target.discovered, prompt), liteMatterLink(path));
  };
  return { nodes, toggle, openConversation, newConversation };
}

type TreeActions = {
  onToggle?: (key: string, expanded: boolean) => void;
  onOpenConversation?: (conversation: MatterConversation) => void;
  onNewConversation?: (matterPath: string) => void;
};

export function LiteNavView(props: { tree?: readonly TreeClient[]; activePane?: boolean; onAsk?: () => void } & TreeActions) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const items = [
    { key: "today", label: "lawoss.lite.nav_today", to: LITE_TODAY_PATH, icon: CalendarDays, active: pathname === LITE_TODAY_PATH },
    { key: "clients", label: "lawoss.lite.nav_clients", to: LITE_CLIENTS_PATH, icon: FolderOpen, active: pathname === LITE_CLIENTS_PATH || pathname === LITE_MATTER_PATH },
    { key: "ask", label: "lawoss.lite.nav_ask", to: ASK_PATH, icon: MessageSquare, active: pathname === ASK_PATH },
    // Namiesto riadku ikon onboardingu (G2 V1, 19. 10. 2026).
    { key: "add_folder", label: "lawoss.lite.add_folder", to: ADD_FOLDER_PATH, icon: FolderPlus, active: `${pathname}${search}` === ADD_FOLDER_PATH },
  ] as const;
  const tree = props.tree ?? [];
  // Označená stránka: presne táto vec, prehľad klienta alebo konverzácia (nie celý rozbalený reťazec).
  const route = routeFocus(pathname, search);
  const page = props.activePane ? {} : route;
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
      {tree.length > 0 ? (
        <SidebarGroup className="mt-3 p-0 mac:titlebar-no-drag" data-lawoss-lite-tree="">
          <SidebarGroupLabel className="lw-section-eyebrow px-5">{t("lawoss.lite.tree_title", locale)}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-0.5 px-2">
              {tree.map((client) => {
                const title = client.title || t("lawoss.lite.client_unnamed", locale);
                const here = page.client === client.key;
                return <SidebarMenuItem key={client.key}>
                  <div className="flex min-w-0 items-center gap-0.5">
                    <TreeToggle kind="client" name={title} expanded={client.expanded} locale={locale} onToggle={() => props.onToggle?.(clientToggle(client.key), client.expanded)} />
                    {/* Link, nie NavLink: všetci klienti zdieľajú cestu /klienti, líšia sa len `?klient=`. */}
                    <SidebarMenuButton size="sm" isActive={here} className="min-w-0 flex-1 px-1.5 text-sidebar-foreground/85"
                      render={<Link to={clientOverviewLink(client.key)} aria-current={here ? "page" : undefined} data-lawoss-tree-client={client.key} title={title} />}>
                      <span className="truncate">{title}</span>
                    </SidebarMenuButton>
                  </div>
                  {client.expanded ? <SidebarMenuSub className="ms-3 gap-0.5 border-s border-sidebar-border/70 ps-1">
                    {client.matters.map((matter) => <MatterNode key={matter.path} matter={matter} page={page} locale={locale} {...props} />)}
                  </SidebarMenuSub> : null}
                </SidebarMenuItem>;
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      ) : null}
    </>
  );
}

function MatterNode({ matter, page, locale, onToggle, onOpenConversation, onNewConversation }: { matter: TreeMatter; page: ReturnType<typeof routeFocus>; locale: Language } & TreeActions) {
  const here = page.matter === matter.path;
  const now = today();
  // Obyčajné <li>, nie SidebarMenuSubItem: jeho group-hover by zvýraznil všetky vnorené rozhovory naraz.
  return <li className="relative min-w-0">
    <div className="flex min-w-0 items-center gap-0.5">
      <TreeToggle kind="matter" name={matter.title} expanded={matter.expanded} locale={locale} onToggle={() => onToggle?.(matterToggle(matter.path), matter.expanded)} />
      {/* Link, ne NavLink: všechny věci sdílejí cestu /vec, liší se jen `?vec=`. */}
      <SidebarMenuSubButton size="sm" isActive={here} className="h-7 min-w-0 flex-1 ps-1.5 pe-1.5"
        render={<Link to={liteMatterLink(matter.path)} aria-current={here ? "page" : undefined} data-lawoss-tree-matter="" title={matter.title} />}>
        <span className="truncate">{matter.title}</span>
        {urgencyDot(matter, now, locale)}
      </SidebarMenuSubButton>
    </div>
    {matter.expanded ? <SidebarMenuSub className="ms-3 gap-0.5 border-s border-sidebar-border/70 ps-1">
      {matter.conversations.map((conversation) => {
        const label = conversationLabel(conversation, locale);
        const current = page.session?.sessionId === conversation.id;
        return <SidebarMenuSubItem key={conversation.id}>
          <SidebarMenuSubButton size="sm" isActive={current} aria-current={current ? "page" : undefined} className="h-7 ps-2 pe-2" title={label}
            data-lawoss-tree-conversation={conversation.id} onClick={() => onOpenConversation?.(conversation)}>
            <span className="truncate">{label}</span>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>;
      })}
      {matter.more ? <SidebarMenuSubItem>
        <SidebarMenuSubButton size="sm" className="h-7 ps-2 pe-2" render={<Link to={liteMatterLink(matter.path)} data-lawoss-tree-all="" />}>
          <span className="truncate">{t("lawoss.lite.tree_show_all", locale)}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem> : null}
      {matter.canStart ? <SidebarMenuSubItem>
        <SidebarMenuSubButton size="sm" className="h-7 ps-2 pe-2" data-lawoss-tree-new="" onClick={() => onNewConversation?.(matter.path)}>
          <Plus strokeWidth={1.5} aria-hidden />
          <span className="truncate">{t("lawoss.lite.tree_new_conversation", locale)}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem> : null}
    </SidebarMenuSub> : null}
  </li>;
}

/** Šípka rozbalí alebo zbalí bez navigácie; názov vedľa nej je odkaz. */
function TreeToggle({ kind, name, expanded, locale, onToggle }: { kind: "client" | "matter"; name: string; expanded: boolean; locale: Language; onToggle: () => void }) {
  const label = t(expanded ? "lawoss.lite.tree_collapse" : "lawoss.lite.tree_expand", locale, { name });
  return <Button type="button" variant="ghost" size="icon-xs" className="shrink-0 text-muted-foreground hover:text-foreground"
    aria-expanded={expanded} aria-label={label} title={label} data-lawoss-tree-toggle={kind}
    onClick={(event) => { event.stopPropagation(); onToggle(); }}>
    <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200 motion-reduce:transition-none", expanded && "rotate-90")} />
  </Button>;
}

/** Názov konverzácie; bez názvu deň poslednej zmeny („Rozhovor 19. 10.“). */
function conversationLabel(conversation: MatterConversation, locale: Language): string {
  if (conversation.title) return conversation.title;
  if (!conversation.updated) return t("lawoss.lite.conversation_untitled", locale);
  const date = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" }).format(new Date(conversation.updated));
  return t("lawoss.lite.tree_conversation_on", locale, { date });
}

/** Bod pri veci: červený, keď lehota horí, zlatý, keď sa blíži; inak nič. */
function urgencyDot(matter: Pick<TreeMatter, "deadlines">, todayIso: string, locale: Language) {
  const urgency = matter.deadlines ? matterUrgency(matter.deadlines, todayIso) : undefined;
  return urgency ? <>
    <span className="lw-nav-urgency" data-urgency={urgency} aria-hidden />
    <span className="sr-only">{t(urgency === "hot" ? "lawoss.lite.urgent" : "lawoss.lite.matter_upcoming", locale)}</span>
  </> : null;
}
