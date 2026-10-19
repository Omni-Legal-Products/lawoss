/** @jsxImportSource react */
/**
 * Klienti a prípady v natívnom bočnom paneli (rozhodnutie MČ 19. 10. 2026): klient je natívny
 * projekt, pod ním upstream položky (Domov, Úlohy, Súbory, Chaty) a dve položky LAWOSS, ktoré
 * upstream mapa položiek projektu len vykreslí: **Prípady** (veci klienta z OKF, pod vecou jej
 * chaty a „+ Nový chat“) a **Lehoty** (register lehôt obmedzený na klienta).
 *
 * Dáta sa čítajú raz pre celý panel (`ClientNavProvider`); strom vecí a chatov je model
 * z `client-tree.ts` / `client-tree-data.ts` (rozbalenie podľa trasy, čítanie len rozbalených).
 */
import { Briefcase, CalendarClock, ChevronRight, Plus, RotateCw } from "lucide-react";
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { Button } from "@/components/ui/button";
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import type { OkfConnection } from "../okf/connection";
import { officeWorkspace, today, useOkfConnection, useOkfOverview, useOkfScope, usePracticeRoot, type OkfReadResult, type OkfScope } from "../okf/read-model";
import { clientGroupsOf, clientNavAnchor, hiddenClientProjects, isClientProject } from "./client-projects";
import { clientToggle, matterToggle, routeFocus, type TreeClient, type TreeMatter } from "./client-tree";
import { useClientTree } from "./client-tree-data";
import { clientDeadlinesLink, clientOverviewLink, LEHOTY_PATH, liteMatterLink } from "./links";
import { matterUrgency, useMinuteTick } from "./live";
import type { MatterConversation } from "./matter-conversations";
import { groupByClient, type ClientGroup } from "./today-model";

/**
 * Prehľad OKF pre klientov v natívnom zozname: spojenie, prax (od klienta praxe, nie od nesúvisiaceho
 * otvoreného priečinka), skryté priečinky (koreň praxe, staršia vec registrovaná zvlášť) a skupiny klientov.
 */
export function useClientNavData() {
  const { connection } = useOkfConnection();
  const practiceRoot = usePracticeRoot(connection);
  const workspaces = connection?.workspaces;
  const hidden = useMemo(() => hiddenClientProjects(workspaces ?? [], practiceRoot), [workspaces, practiceRoot]);
  const fallback = officeWorkspace(connection);
  const anchor = useMemo(() => clientNavAnchor(workspaces ?? [], practiceRoot, fallback), [workspaces, practiceRoot, fallback]);
  const { scope } = useOkfScope(connection, anchor);
  const query = useOkfOverview(connection, scope);
  const data = scope ? query.data : undefined;
  const groups = useMemo(() => data ? groupByClient(data.matters, data.inputs, data.clients) : [], [data]);
  return { connection, hidden, scope, data, groups };
}

type ClientNavValue = {
  connection: OkfConnection | null;
  scope: OkfScope | null;
  data: OkfReadResult | undefined;
  groups: readonly ClientGroup[];
  hidden: ReadonlySet<string>;
  tree: ReturnType<typeof useClientTree>;
  /** Prípady otvorené pri projekte s viacerými klientmi (jeden priečinok pre všetko). */
  open: Readonly<Record<string, boolean>>;
  setOpen: (workspaceId: string, open: boolean) => void;
};

const ClientNavContext = createContext<ClientNavValue | null>(null);
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** Jedno čítanie pre celý bočný panel; bez neho sa položky LAWOSS nevykreslia (napr. stránka Projekty). */
export function ClientNavProvider({ children }: { children: ReactNode }) {
  useMinuteTick(); // body naliehavosti sa o polnoci prepočítajú aj bez nového čítania
  const nav = useClientNavData();
  const { pathname, search } = useLocation();
  const locale = useLocale();
  const tree = useClientTree(nav.connection, nav.scope, nav.data, pathname, search, locale);
  const [open, setOpenState] = useState<Readonly<Record<string, boolean>>>({});
  const setOpen = useCallback((workspaceId: string, value: boolean) => setOpenState((prev) => ({ ...prev, [workspaceId]: value })), []);
  return <ClientNavContext.Provider value={{ ...nav, tree, open, setOpen }}>{children}</ClientNavContext.Provider>;
}

/** Priečinky, ktoré sekcia klientov neukáže (koreň praxe s klientmi pod ním, staršia vec registrovaná zvlášť). */
export function useHiddenClientProjects(): ReadonlySet<string> {
  return use(ClientNavContext)?.hidden ?? NOTHING_HIDDEN;
}

/** Uzly stromu (klienti z prehľadu), ktoré patria projektu; `null` = projekt nie je klient OKF. */
function projectNodes(nav: ClientNavValue, workspaceId: string): TreeClient[] | null {
  const workspace = nav.connection?.workspaces.find((w) => w.id === workspaceId);
  if (!nav.scope || !workspace || !isClientProject(nav.scope, workspace, nav.groups)) return null;
  const keys = new Set(clientGroupsOf(nav.scope, workspace, nav.groups).map((g) => g.key));
  return nav.tree.nodes.filter((node) => keys.has(node.key));
}

/** Položka „Prípady“ v natívnej mape položiek projektu. */
export function ClientMattersNavItem({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const nav = use(ClientNavContext);
  const locale = useLocale();
  const nodes = nav ? projectNodes(nav, workspaceId) : null;
  if (!nav || !nodes) return null;
  // Jeden klient: Prípady = jeho uzol (zbalený nič nečíta). Viac klientov: Prípady zvlášť, klienti pod nimi.
  const single = nodes.length === 1 ? nodes[0] : null;
  const open = single ? single.expanded : nav.open[workspaceId] ?? nodes.some((node) => node.expanded);
  const toggleOpen = () => single ? nav.tree.toggle(clientToggle(single.key), single.expanded) : nav.setOpen(workspaceId, !open);
  return <ClientMattersView nodes={nodes} open={open} className={className} locale={locale} onToggleOpen={toggleOpen}
    onToggle={nav.tree.toggle} onOpenConversation={nav.tree.openConversation} onNewConversation={nav.tree.newConversation} />;
}

/** Položka „Lehoty“: register lehôt len pre veci klienta; bod, keď niektorá horí. */
export function ClientDeadlinesNavItem({ workspaceId, className }: { workspaceId: string; className?: string }) {
  const nav = use(ClientNavContext);
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const nodes = nav ? projectNodes(nav, workspaceId) : null;
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
