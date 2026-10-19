/** @jsxImportSource react */
import { CalendarDays, ChevronRight, FolderOpen, FolderPlus, MessageSquare, Plus, RotateCw } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
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
import { isFolderUnavailable, locateInScope, officeWorkspace, today, useOkfConnection, useOkfOverview, useOkfScope, type OkfScope } from "../okf/read-model";
import { matterUrgency, useMinuteTick } from "./live";
import { ADD_FOLDER_PATH, clientOverviewLink, LITE_CLIENTS_PATH, LITE_MATTER_PATH, LITE_TODAY_PATH, liteMatterLink } from "./links";
import { openClientChat, openOfficeChat, restoreOfficeScope } from "./office-scope";
import { practiceClientChoices } from "./client-choice";
import { ClientPickerDialog } from "./client-picker";
import { currentUiMode, useUiMode, type UiMode } from "./ui-mode";
import { clientToggle, matterToggle, routeFocus, type TreeClient, type TreeMatter } from "./client-tree";
import { useClientTree } from "./client-tree-data";
import type { MatterConversation } from "./matter-conversations";

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

/** Kam po zlyhanom „Opýtať sa“: chýbajúci priečinok vysvetlí Dnes (s voľbou iného priečinka), inak konverzácie. */
export const askFailurePath = (failure: unknown): string => isFolderUnavailable(failure) ? LITE_TODAY_PATH : ASK_PATH;

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
      navigate(askFailurePath(failure));
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
                    {/* Rozhovory nad celým klientom (napr. „Opýtať sa“ z detailu veci) sú nad jeho vecami. */}
                    <ConversationRows node={client} page={page} locale={locale} allLink={clientOverviewLink(client.key)} onOpen={props.onOpenConversation} />
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
      <ConversationRows node={matter} page={page} locale={locale} allLink={liteMatterLink(matter.path)} onOpen={onOpenConversation} />
      {matter.canStart ? <SidebarMenuSubItem>
        <SidebarMenuSubButton size="sm" className="h-7 ps-2 pe-2" data-lawoss-tree-new="" onClick={() => onNewConversation?.(matter.path)}>
          <Plus strokeWidth={1.5} aria-hidden />
          <span className="truncate">{t("lawoss.lite.tree_new_conversation", locale)}</span>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem> : null}
    </SidebarMenuSub> : null}
  </li>;
}

/** Rozhovory uzla (najviac 5), „Zobraziť všetky“ a pri chybe čítania hláška s „Skúsiť znova“ (nie prázdny zoznam). */
function ConversationRows({ node, page, locale, allLink, onOpen }: {
  node: Pick<TreeClient, "conversations" | "more" | "status" | "retry">; page: ReturnType<typeof routeFocus>; locale: Language; allLink: string;
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
