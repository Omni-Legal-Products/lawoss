/** @jsxImportSource react */
/**
 * Klienti a prípady v natívnom bočnom paneli (rozhodnutie MČ 19. 10. 2026): klient je natívny
 * projekt, pod ním upstream položky (Domov, Úlohy, Súbory, Chaty) a dve položky LAWOSS, ktoré
 * upstream mapa položiek projektu len vykreslí: **Prípady** (veci klienta z OKF, pod vecou jej
 * chaty a „+ Nový chat“) a **Lehoty** (register lehôt obmedzený na klienta).
 *
 * Dáta sa čítajú raz pre celý panel (`ClientNavProvider`) zo živého zoznamu projektov panela; strom
 * vecí a chatov je model z `client-tree.ts` / `client-tree-data.ts`, vlastníctvo a skrytie
 * z `client-projects.ts`, Prípady projektu z `client-nav-model.ts`. Domov klienta, stránka Lehoty
 * a stránka Projekty čítajú to isté cez `usePublishedClientNav` (bez druhého načítania).
 */
import { Briefcase, CalendarClock, ChevronRight, Plus, RotateCw } from "lucide-react";
import { createContext, use, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Button } from "@/components/ui/button";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { WorkspaceSessionGroup } from "@/app/types";
import { mapDesktopWorkspace, type RouteWorkspace } from "@/react-app/shell/route-workspaces";
import type { OkfConnection } from "../okf/connection";
import { officeWorkspace, today, useOkfConnection, useOkfOverview, useOkfScope, usePracticeRoot } from "../okf/read-model";
import type { ClientChoice } from "./client-choice";
import { closedGroups, focusedProject, forgetProjectOverride, mattersOpen, newChatAction, newChatChoices, projectNodes, type NewChatTarget } from "./client-nav-model";
import { openClientFolderChat } from "./office-scope";
import { ClientPickerDialog } from "./client-picker";
import { clientGroupDirectory, clientNavAnchor, clientNavModel, type ClientOverviewState } from "./client-projects";
import { clientToggle, matterToggle, routeFocus, type TreeClient, type TreeMatter } from "./client-tree";
import { useClientTree } from "./client-tree-data";
import { clientDeadlinesLink, clientOverviewLink, LEHOTY_PATH, liteMatterLink } from "./links";
import { matterUrgency, useMinuteTick } from "./live";
import type { MatterConversation } from "./matter-conversations";
import { groupByClient } from "./today-model";
import { useUiMode } from "./ui-mode";

/**
 * Skupiny panela pre LAWOSS: režim wiki (session-route odovzdá len priečinok wiki) zoznam projektov nemení,
 * ostane posledný zoznam bez wiki. `undefined` = panel zoznam neodovzdal.
 */
export function liveProjectGroups(groups: readonly WorkspaceSessionGroup[] | undefined, previous: readonly WorkspaceSessionGroup[] | undefined): readonly WorkspaceSessionGroup[] | undefined {
  if (!groups) return previous;
  const projects = groups.filter((g) => g.workspace.preset !== "wiki");
  return projects.length === 0 && groups.length > 0 ? previous : projects;
}

function useLiveGroups(groups: readonly WorkspaceSessionGroup[] | undefined): readonly WorkspaceSessionGroup[] | undefined {
  const last = useRef<readonly WorkspaceSessionGroup[] | undefined>(undefined);
  const next = liveProjectGroups(groups, last.current);
  last.current = next;
  return next;
}

/** Projekty panela ako ich pozná LAWOSS; kľúč sa mení len pri zmene id, cesty alebo názvu (nie pri novom chate). */
function useLiveWorkspaces(groups: readonly WorkspaceSessionGroup[] | undefined): RouteWorkspace[] | undefined {
  const key = groups?.map((g) => [g.workspace.id, g.workspace.path, g.workspace.name, g.workspace.displayName, g.workspace.workspaceType].join("\u0000")).join("\u0001");
  const latest = useRef(groups);
  latest.current = groups;
  // Kľúč nesie všetko, čo mapovanie číta; nový chat v projekte zoznam nemení.
  return useMemo(() => latest.current?.map((g) => mapDesktopWorkspace(g.workspace)), [key]);
}

/**
 * Priečinok chatu zo živého zoznamu panela: chat v skupine svojho projektu s priečinkom → ten priečinok; chat,
 * ktorý v zozname nie je (filtrovaný, za limitom) alebo nemá priečinok → `undefined` (prečíta sa jeden chat).
 */
export function liveSessionDirectories(groups: readonly WorkspaceSessionGroup[] | undefined): (workspaceId: string, sessionId: string) => string | undefined {
  const map = new Map<string, string>();
  for (const group of groups ?? []) for (const s of group.sessions) if (s.directory) map.set(`${group.workspace.id}\u0000${s.id}`, s.directory);
  return (workspaceId, sessionId) => map.get(`${workspaceId}\u0000${sessionId}`);
}

/** Spojenie s aktuálnym zoznamom projektov: registrácia alebo odobratie klienta sa prejaví hneď (review 19. 10.). */
export function liveConnection(connection: OkfConnection | null, workspaces: readonly RouteWorkspace[] | undefined, selectedId?: string): OkfConnection | null {
  if (!connection || !workspaces) return connection;
  const active = selectedId && workspaces.some((w) => w.id === selectedId) ? selectedId : connection.activeWorkspaceId;
  return { ...connection, workspaces: [...workspaces], activeWorkspaceId: active };
}

/**
 * Prehľad OKF pre klientov: spojenie (so živým zoznamom projektov, ak ho panel odovzdá), prax (od priečinka
 * praxe, nie od nesúvisiaceho otvoreného), prehľad, skupiny klientov a model vlastníctva a skrytia.
 */
export function useClientNavData(live?: { groups?: readonly WorkspaceSessionGroup[]; selectedWorkspaceId?: string }) {
  const { connection: loaded } = useOkfConnection();
  const workspaces = useLiveWorkspaces(live?.groups);
  const connection = useMemo(() => liveConnection(loaded, workspaces, live?.selectedWorkspaceId), [loaded, workspaces, live?.selectedWorkspaceId]);
  // Kým sa spojenie číta, prax je neznáma: kandidáti na skrytie sa zatiaľ neukážu (radšej neskôr než bliknúť).
  const root = usePracticeRoot(connection);
  const practiceRoot = loaded === null ? undefined : root;
  const fallback = officeWorkspace(connection);
  const all = connection?.workspaces;
  const anchor = useMemo(() => clientNavAnchor(all ?? [], practiceRoot, fallback), [all, practiceRoot, fallback]);
  const { scope } = useOkfScope(connection, anchor);
  const query = useOkfOverview(connection, scope);
  const data = scope ? query.data : undefined;
  const groups = useMemo(() => data ? groupByClient(data.matters, data.inputs, data.clients) : [], [data]);
  const failed = Boolean(scope && !data && query.isError) || (connection !== null && !connection.client);
  const model = useMemo(() => {
    const overview: ClientOverviewState = scope && data ? { status: "ready", scope, groups, matters: data.matters } : failed ? { status: "unavailable" } : { status: "pending" };
    return clientNavModel(all ?? workspaces ?? [], practiceRoot, overview);
  }, [all, workspaces, practiceRoot, scope, data, groups, failed]);
  return { connection, scope, data, groups, model };
}

export type PublishedClientNav = Pick<ReturnType<typeof useClientNavData>, "connection" | "scope" | "data" | "groups" | "model">;

let published: PublishedClientNav | null = null;
const publishedListeners = new Set<() => void>();
function publish(next: PublishedClientNav | null) {
  published = next;
  for (const listener of publishedListeners) listener();
}
const subscribePublished = (listener: () => void) => { publishedListeners.add(listener); return () => { publishedListeners.delete(listener); }; };

/** To, čo bočný panel práve vie o klientoch; mimo panela (samostatné okno) `null`. */
export function usePublishedClientNav(): PublishedClientNav | null {
  return useSyncExternalStore(subscribePublished, () => published, () => null);
}

type ClientNavValue = PublishedClientNav & {
  tree: Pick<ReturnType<typeof useClientTree>, "nodes" | "toggle" | "openConversation" | "newConversation">;
  /** Otvorené Prípady projektu s viacerými klientmi; `undefined` = podľa trasy. */
  open: Readonly<Record<string, boolean>>;
  setOpen: (workspaceId: string, open: boolean) => void;
  /** Projekt, v ktorého veci alebo klientovi je trasa. */
  focused: string | null;
  /** Bežný režim bez otvoreného projektu: „Nový chat“ vyberie klienta; `false` = natívne správanie. */
  startNewChat: (create: (workspaceId: string) => void) => boolean;
};

const ClientNavContext = createContext<ClientNavValue | null>(null);
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** Test seam: pevné dáta namiesto čítania; vnútorný `ClientNavProvider` ich použije. */
export function ClientNavTestProvider({ value, children }: { value: ClientNavValue; children: ReactNode }) {
  return <ClientNavContext.Provider value={value}>{children}</ClientNavContext.Provider>;
}

/** Jedno čítanie pre celý bočný panel; bez neho sa položky LAWOSS nevykreslia (napr. stránka Projekty). */
export function ClientNavProvider(props: { groups?: readonly WorkspaceSessionGroup[]; selectedWorkspaceId?: string; children: ReactNode }) {
  return use(ClientNavContext) ? <>{props.children}</> : <ClientNavRoot {...props} />;
}

function ClientNavRoot({ groups, selectedWorkspaceId, children }: { groups?: readonly WorkspaceSessionGroup[]; selectedWorkspaceId?: string; children: ReactNode }) {
  useMinuteTick(); // body naliehavosti sa o polnoci prepočítajú aj bez nového čítania
  const live = useLiveGroups(groups);
  const nav = useClientNavData({ groups: live, selectedWorkspaceId });
  const navigate = useNavigate();
  const { pathname, search } = useLocation();
  const locale = useLocale();
  const mode = useUiMode();
  const [open, setOpenState] = useState<Readonly<Record<string, boolean>>>({});
  const setOpen = useCallback((workspaceId: string, value: boolean) => setOpenState((prev) => ({ ...prev, [workspaceId]: value })), []);
  // Vec otvoreného chatu podľa jeho priečinka (chat v koreni projektu nič nerozbalí ani nečíta).
  const sessionDirectory = useMemo(() => liveSessionDirectories(live), [live]);
  const tree = useClientTree(nav.connection, nav.scope, nav.data, pathname, search, locale, {
    sessionDirectory,
    closedFor: (focus) => closedGroups(nav.groups, nav.model.ownerOf, open, focusedProject(focus, nav.groups, nav.model.ownerOf)),
  });
  const focused = focusedProject(tree.focus, nav.groups, nav.model.ownerOf);
  // Trasa prešla do projektu alebo na inú jeho vec: zatvorenie používateľom sa zabudne (ako pri jednom klientovi).
  useEffect(() => {
    setOpenState((prev) => forgetProjectOverride(prev, focused));
  }, [focused, tree.focus.client, tree.focus.matter]);
  const snapshot = useMemo<PublishedClientNav>(() => ({ connection: nav.connection, scope: nav.scope, data: nav.data, groups: nav.groups, model: nav.model }), [nav.connection, nav.scope, nav.data, nav.groups, nav.model]);
  useEffect(() => { publish(snapshot); }, [snapshot]);
  useEffect(() => () => publish(null), []);
  // Klienti, ktorých vlastní koreň praxe: chat v koreni s priečinkom klienta, nikdy nad celou praxou.
  const rootClients = useMemo(() => {
    const rootId = nav.model.practiceRootId;
    if (!rootId || !nav.scope) return [];
    const scope = nav.scope;
    return nav.groups.flatMap((g) => {
      const folder = nav.model.ownerOf.get(g.key) === rootId ? clientGroupDirectory(scope, g) : null;
      return folder ? [{ key: g.key, title: g.client || t("lawoss.lite.client_unnamed", locale), folder }] : [];
    });
  }, [nav.model, nav.scope, nav.groups, locale]);
  const choices = useMemo(() => newChatChoices(nav.connection?.workspaces ?? [], nav.model, rootClients), [nav.connection, nav.model, rootClients]);
  const [picking, setPicking] = useState(false);
  const pending = useRef<((workspaceId: string) => void) | null>(null);
  const start = useCallback((target: NewChatTarget, create: (workspaceId: string) => void) => {
    if (!target.folder) { create(target.workspaceId); return; }
    openClientFolderChat(target.workspaceId, target.folder).then((to) => navigate(to)).catch((failure: unknown) => console.warn("LAWOSS: new chat in client folder", failure));
  }, [navigate]);
  const startNewChat = useCallback((create: (workspaceId: string) => void) => {
    const action = newChatAction(mode, choices);
    if (action.kind === "native") return false;
    if (action.kind === "create") { start(action.target, create); return true; }
    pending.current = create;
    setPicking(true);
    return true;
  }, [mode, choices, start]);
  const pick = (choice: ClientChoice) => {
    setPicking(false);
    const target = choices.find((c) => c.id === choice.id);
    if (target && pending.current) start(target, pending.current);
    pending.current = null;
  };
  return <ClientNavContext.Provider value={{ ...snapshot, tree, open, setOpen, focused, startNewChat }}>
    {children}
    <ClientPickerDialog open={picking} purpose="ask" choices={choices} activeId={nav.connection?.activeWorkspaceId} locale={locale}
      onClose={() => { setPicking(false); pending.current = null; }} onPick={pick} />
  </ClientNavContext.Provider>;
}

/** Priečinky, ktoré sekcia klientov neukáže (koreň praxe, ktorého klientov majú registrovaní klienti, staršia vec). */
export function useHiddenClientProjects(): ReadonlySet<string> {
  return use(ClientNavContext)?.model.hidden ?? NOTHING_HIDDEN;
}

/** „Nový chat“ bez otvoreného projektu v bežnom režime: výber klienta praxe; `false` = natívne správanie. */
export function useLawossNewChat(): (create: (workspaceId: string) => void) => boolean {
  const nav = use(ClientNavContext);
  return nav?.startNewChat ?? (() => false);
}

/** Stránka Projekty: Prípady a Lehoty len pri projektoch, ktoré sú klienti OKF. */
export function useClientProjectItem(): (key: string, workspaceId: string) => boolean {
  const nav = usePublishedClientNav();
  return (key, workspaceId) => (key !== "projectMatters" && key !== "projectDeadlines") || Boolean(nav?.model.clients.has(workspaceId));
}

/** Položka „Prípady“ v natívnej mape položiek projektu. */
export function ClientMattersNavItem({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const nav = use(ClientNavContext);
  const locale = useLocale();
  const nodes = nav ? projectNodes(nav.tree.nodes, nav.model, workspaceId) : null;
  if (!nav || !nodes) return null;
  const { open, toggle } = mattersOpen(nodes, nav.open[workspaceId], nav.focused === workspaceId);
  const onToggleOpen = () => toggle.kind === "client" ? nav.tree.toggle(toggle.key, toggle.expanded) : nav.setOpen(workspaceId, toggle.open);
  return <ClientMattersView nodes={nodes} open={open} className={className} locale={locale} onToggleOpen={onToggleOpen}
    onToggle={nav.tree.toggle} onOpenConversation={nav.tree.openConversation} onNewConversation={nav.tree.newConversation} />;
}

/** Položka „Lehoty“: register lehôt len pre veci klienta; bod, keď niektorá horí. */
export function ClientDeadlinesNavItem({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const nav = use(ClientNavContext);
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const nodes = nav ? projectNodes(nav.tree.nodes, nav.model, workspaceId) : null;
  if (!nodes) return null;
  const active = pathname === LEHOTY_PATH && new URLSearchParams(search).get("klient") === workspaceId;
  const now = today();
  const hot = nodes.some((node) => node.matters.some((m) => matterUrgency(m.deadlines, now) === "hot"));
  return <SidebarMenuSubItem>
    <SidebarMenuSubButton className={className} isActive={active}
      render={<Link to={clientDeadlinesLink(workspaceId)} aria-current={active ? "page" : undefined} data-lawoss-project-deadlines="" />}>
      <CalendarClock className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.shell.deadlines", locale)}</span>
      {hot ? <><span className="lw-nav-urgency" data-urgency="hot" aria-hidden /><span className="sr-only">{t("lawoss.lite.urgent", locale)}</span></> : null}
    </SidebarMenuSubButton>
  </SidebarMenuSubItem>;
}

type TreeActions = {
  onToggle?: (key: string, expanded: boolean) => void;
  onOpenConversation?: (conversation: MatterConversation) => void;
  onNewConversation?: (matterPath: string) => void;
};

/**
 * Prípady klienta: riadok so šípkou, pod ním veci (odkaz na prehľad veci) a pod rozbalenou vecou jej
 * chaty a „+ Nový chat“. Viac klientov v jednom projekte (jeden priečinok pre všetko) má medzistupeň klienta.
 */
export function ClientMattersView(props: { nodes: readonly TreeClient[]; open: boolean; locale: Language; className?: string; activePane?: boolean; onToggleOpen?: () => void } & TreeActions) {
  const { locale, nodes } = props;
  const { pathname, search } = useLocation();
  const page = props.activePane ? {} : routeFocus(pathname, search);
  const grouped = nodes.length > 1;
  const empty = nodes.every((node) => node.matters.length === 0);
  const actions: TreeActions = { onToggle: props.onToggle, onOpenConversation: props.onOpenConversation, onNewConversation: props.onNewConversation };
  return <li className="min-w-0" data-lawoss-project-matters-item="">
    <SidebarMenuSubButton className={props.className} aria-expanded={props.open} data-lawoss-project-matters="" onClick={props.onToggleOpen}>
      <Briefcase className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.project_matters", locale)}</span>
      <ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", props.open && "rotate-90")} />
    </SidebarMenuSubButton>
    {props.open ? <SidebarMenuSub className="mb-1 ms-[18px] mt-1 gap-0.5 border-s border-sidebar-border ps-1">
      {empty ? <li className="px-2 py-1 text-xs text-muted-foreground" data-lawoss-project-matters-empty="">{t("lawoss.lite.project_matters_empty", locale)}</li> : null}
      {nodes.map((node) => grouped
        ? <ClientNode key={node.key} node={node} page={page} locale={locale} {...actions} />
        : node.matters.map((matter) => <MatterNode key={matter.path} matter={matter} page={page} locale={locale} {...actions} />))}
    </SidebarMenuSub> : null}
  </li>;
}

type Page = ReturnType<typeof routeFocus>;

/** Klient vo „jeden priečinok pre všetko“: šípka, meno (prehľad klienta) a jeho veci. */
function ClientNode({ node, page, locale, ...actions }: { node: TreeClient; page: Page; locale: Language } & TreeActions) {
  const title = node.title || t("lawoss.lite.client_unnamed", locale);
  const here = page.client === node.key;
  return <li className="relative min-w-0">
    <div className="flex min-w-0 items-center gap-0.5">
      <TreeToggle kind="client" name={title} expanded={node.expanded} locale={locale} onToggle={() => actions.onToggle?.(clientToggle(node.key), node.expanded)} />
      <SidebarMenuSubButton size="sm" isActive={here} className="h-7 min-w-0 flex-1 ps-1.5 pe-1.5"
        render={<Link to={clientOverviewLink(node.key)} aria-current={here ? "page" : undefined} data-lawoss-tree-client={node.key} title={title} />}>
        <span className="truncate">{title}</span>
      </SidebarMenuSubButton>
    </div>
    {node.expanded ? <SidebarMenuSub className="ms-3 gap-0.5 border-s border-sidebar-border/70 ps-1">
      {node.matters.map((matter) => <MatterNode key={matter.path} matter={matter} page={page} locale={locale} {...actions} />)}
    </SidebarMenuSub> : null}
  </li>;
}

function MatterNode({ matter, page, locale, onToggle, onOpenConversation, onNewConversation }: { matter: TreeMatter; page: Page; locale: Language } & TreeActions) {
  const here = page.matter === matter.path;
  const now = today();
  // Obyčajné <li>, nie SidebarMenuSubItem: jeho group-hover by zvýraznil všetky vnorené chaty naraz.
  return <li className="relative min-w-0">
    <div className="flex min-w-0 items-center gap-0.5">
      <TreeToggle kind="matter" name={matter.title} expanded={matter.expanded} locale={locale} onToggle={() => onToggle?.(matterToggle(matter.path), matter.expanded)} />
      {/* Link, nie NavLink: všetky veci zdieľajú cestu /vec, líšia sa len `?vec=`. */}
      <SidebarMenuSubButton size="sm" isActive={here} className="h-7 min-w-0 flex-1 ps-1.5 pe-1.5"
        render={<Link to={liteMatterLink(matter.path)} aria-current={here ? "page" : undefined} data-lawoss-tree-matter="" title={matter.title} />}>
        <span className="truncate">{matter.title}</span>
        {urgencyDot(matter, now, locale)}
      </SidebarMenuSubButton>
    </div>
    {matter.expanded ? <SidebarMenuSub className="ms-3 gap-0.5 border-s border-sidebar-border/70 ps-1">
      <ConversationRows node={matter} page={page} locale={locale} allLink={liteMatterLink(matter.path)} onOpen={onOpenConversation} />
      {matter.canStart ? <SidebarMenuSubItem>
        <SidebarMenuSubButton size="sm" className="h-7 ps-2 pe-2" data-lawoss-tree-new="" onClick={() => onNewConversation?.(matter.path)}>
          <Plus strokeWidth={1.5} aria-hidden />
          <span className="truncate">{t("lawoss.lite.matter_new_chat", locale)}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem> : null}
    </SidebarMenuSub> : null}
  </li>;
}

/** Chaty veci (najviac 5), „Zobraziť všetky“ a pri chybe čítania hláška s „Skúsiť znova“ (nie prázdny zoznam). */
function ConversationRows({ node, page, locale, allLink, onOpen }: {
  node: Pick<TreeMatter, "conversations" | "more" | "status" | "retry">; page: Page; locale: Language; allLink: string;
  onOpen?: (conversation: MatterConversation) => void;
}) {
  return <>
    {node.conversations.map((conversation) => {
      const label = conversationLabel(conversation, locale);
      const current = page.session?.sessionId === conversation.id;
      return <SidebarMenuSubItem key={conversation.id}>
        <SidebarMenuSubButton size="sm" isActive={current} aria-current={current ? "page" : undefined} className="h-7 ps-2 pe-2" title={label}
          data-lawoss-tree-conversation={conversation.id} onClick={() => onOpen?.(conversation)}>
          <span className="truncate">{label}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>;
    })}
    {node.more ? <SidebarMenuSubItem>
      <SidebarMenuSubButton size="sm" className="h-7 ps-2 pe-2" render={<Link to={allLink} data-lawoss-tree-all="" />}>
        <span className="truncate">{t("lawoss.lite.tree_show_all", locale)}</span>
      </SidebarMenuSubButton>
    </SidebarMenuSubItem> : null}
    {node.status === "error" ? <SidebarMenuSubItem data-lawoss-tree-error="" className="flex items-center gap-1 ps-2 pe-1 text-xs text-muted-foreground">
      <span className="min-w-0 flex-1 truncate" role="status">{t("lawoss.lite.tree_load_error", locale)}</span>
      {node.retry ? <Button type="button" variant="ghost" size="xs" className="shrink-0" onClick={() => node.retry?.()}>
        <RotateCw aria-hidden className="size-3" />{t("lawoss.lite.state_retry", locale)}
      </Button> : null}
    </SidebarMenuSubItem> : null}
  </>;
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

/** Názov chatu; bez názvu deň poslednej zmeny („Rozhovor 19. 10.“). */
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
