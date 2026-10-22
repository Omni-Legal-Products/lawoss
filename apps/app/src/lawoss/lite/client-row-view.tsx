/** @jsxImportSource react */
/**
 * Riadky bočného panela pre natívny `app-sidebar.tsx` (alfa2 B3, N-22): čitateľné meno klienta s priečinkom
 * v bublinke, stručný stav (lehota zo súborov), zvýraznenie predka, „Viac“ v bežnom režime a kontext chatu
 * (Klient · Prípad). Upstream len vymení volanie; mimo LAWOSS dát ostáva natívne meno.
 */
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SidebarMenuSub, SidebarMenuSubButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { today } from "../okf/read-model";
import { clientDeadlines, clientGroupDirectory, ownerOfFolder } from "./client-projects";
import { cardTitle, clientGroupOfProject, clientLabel, clientRowDeadline, groupOfDirectory, matterOfDirectory } from "./client-row";
import { rowDeadlineText } from "./client-row-text";
import { useClientNav, type PublishedClientNav } from "./client-nav";
import { LEHOTY_PATH } from "./links";

type ProjectRef = { id: string; path?: string | null };
export type ClientRow = { label: string; tooltip?: string; status?: { text: string; urgency: string } };

/**
 * Riadok projektu klienta: meno (karta → upravený priečinok, meno od používateľa ostáva), bublinka s priečinkom
 * a najbližšia lehota zo súborov (len pri úplnom čítaní). Nie klient alebo bez dát = natívne meno, nič navyše.
 */
export function clientProjectRow(nav: PublishedClientNav | null, project: ProjectRef, nativeLabel: string, locale: Language, todayIso: string): ClientRow {
  if (!nav) return { label: nativeLabel };
  const path = project.path ?? nav.connection?.workspaces.find((w) => w.id === project.id)?.path ?? null;
  const isClient = nav.model.clients.has(project.id) && !nav.excludedWorkspaceIds.includes(project.id);
  if (!isClient) return { label: nativeLabel };
  const group = clientGroupOfProject(nav.scope, nav.groups, path);
  const named = clientLabel({ nativeLabel, path, isClient, cardTitle: group ? cardTitle(nav.data, group.key) : undefined });
  const tooltip = named.path ? t("lawoss.lite.client_folder_tooltip", locale, { path: named.path }) : undefined;
  const { scope, data, model } = nav;
  if (!scope || !data) return { label: named.label, tooltip };
  const own = clientDeadlines(data, scope, (folder) => ownerOfFolder(model.visible, folder) === project.id, todayIso);
  const deadline = clientRowDeadline(own.matters, data.coverage.status === "complete", todayIso);
  return { label: named.label, tooltip, ...(deadline ? { status: { text: rowDeadlineText(deadline, locale), urgency: deadline.urgency } } : {}) };
}

export function useClientProjectRow(project: ProjectRef, nativeLabel: string): ClientRow {
  const nav = useClientNav();
  const locale = useLocale();
  const day = today();
  return useMemo(() => clientProjectRow(nav, project, nativeLabel, locale, day), [nav, project.id, project.path, nativeLabel, locale, day]);
}

/** Meno projektu na Prehľade klienta (hlavička) – rovnaké ako v bočnom paneli. */
export function useClientDisplayName(projectId: string, nativeLabel: string): string {
  return useClientProjectRow({ id: projectId }, nativeLabel).label;
}

/** Riadok klienta je aktívny podľa trasy (vec alebo chat vo veci patrí jemu); inak natívny vybraný projekt. */
export function useClientRowActive(projectId: string, isSelected: boolean): boolean {
  const focused = useClientNav()?.focused;
  return focused ? focused === projectId : isSelected;
}

/** Druhý riadok klienta: najbližšia lehota so slovným stavom (nie len farba). */
export function ClientRowStatusLine({ status }: { status: NonNullable<ClientRow["status"]> }) {
  return <span className="block truncate text-xs text-muted-foreground" data-lawoss-row-status="" data-urgency={status.urgency}>{status.text}</span>;
}

/** Bežný režim: zriedkavé položky klienta pod „Viac“; otvorené, keď je v nich otvorená stránka (aj Lehoty klienta). */
export function ClientMoreNavItem({ active = false, workspaceId, className, children }: { active?: boolean; workspaceId?: string; className?: string; children: ReactNode }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const onDeadlines = Boolean(workspaceId) && pathname === LEHOTY_PATH && new URLSearchParams(search).get("klient") === workspaceId;
  const [chosen, setChosen] = useState<boolean | null>(null);
  const open = chosen ?? (active || onDeadlines);
  return <li className="min-w-0" data-lawoss-project-more-item="">
    <SidebarMenuSubButton className={className} aria-expanded={open} data-lawoss-project-more="" onClick={() => setChosen(!open)}>
      <MoreHorizontal className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.nav_more", locale)}</span>
      <ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
    </SidebarMenuSubButton>
    {open ? <SidebarMenuSub className="mb-1 ms-[18px] mt-1 gap-1 border-s border-sidebar-border ps-1">{children}</SidebarMenuSub> : null}
  </li>;
}

/** Kontext chatu v Nedávnych a pripnutých: „Klient · Prípad“ podľa priečinka chatu. */
export function chatContextText(nav: PublishedClientNav | null, project: ProjectRef, nativeLabel: string, directory: string | null | undefined, locale: Language): string | null {
  if (!nav) return null;
  const { scope } = nav;
  const row = clientProjectRow(nav, project, nativeLabel, locale, today());
  if (!scope || !nav.model.clients.has(project.id)) return null;
  // Chat v priečinku klienta v kancelárii: jeho klient, nie meno kancelárie.
  const inner = groupOfDirectory(scope, nav.groups, directory, (group) => clientGroupDirectory(scope, group));
  const own = clientGroupOfProject(scope, nav.groups, project.path ?? nav.connection?.workspaces.find((w) => w.id === project.id)?.path);
  const client = inner && inner.key !== own?.key ? (cardTitle(nav.data, inner.key) || inner.client || row.label) : row.label;
  const matter = matterOfDirectory(scope, nav.data?.matters ?? [], directory);
  return matter ? `${client} · ${matter.title}` : client;
}

export function ChatContextLabel({ project, nativeLabel, directory }: { project: ProjectRef; nativeLabel: string; directory?: string | null }) {
  const nav = useClientNav();
  const locale = useLocale();
  const text = chatContextText(nav, project, nativeLabel, directory, locale);
  return text ? <span className="block truncate text-2xs text-muted-foreground" data-lawoss-chat-context="">{text}</span> : null;
}
