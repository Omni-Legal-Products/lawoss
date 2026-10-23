/** @jsxImportSource react */
/**
 * Riadky bočného panela pre natívny `app-sidebar.tsx` (alfa2 B3, N-22): čitateľné meno klienta (aj na dva riadky)
 * s kódom klienta a priečinkom, stručný stav (lehota zo súborov), zvýraznenie predka, „Viac“ v bežnom režime
 * a kontext chatu (Klient · Prípad). Upstream len vymení volanie; mimo LAWOSS dát ostáva natívne meno.
 * Fakty riadkov počíta panel raz (`buildClientRows`); tu sa doplní len natívne meno a jazyk.
 */
import { ChevronRight, MoreHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SidebarMenuSub, SidebarMenuSubButton } from "@/components/ui/sidebar";
import { cn } from "@/lib/utils";
import { clientGroupDirectory } from "./client-projects";
import { cardTitle, clientGroupOfProject, clientLabel, groupOfDirectory, matterOfDirectory } from "./client-row";
import type { ClientRowFacts } from "./client-row-data";
import { rowDeadlineText, urgencyTextClass } from "./client-row-text";
import { useClientNav, type PublishedClientNav } from "./client-nav";
import { LEHOTY_PATH } from "./links";

type ProjectRef = { id: string; path?: string | null };
export type ClientRow = {
  label: string;
  /** Natívne meno projektu (natívne pomocníky a testy ho hľadajú presne). */
  nativeLabel: string;
  /** Klient s menom z karty/priečinka: meno smie mať dva riadky. */
  client: boolean;
  tooltip?: string;
  /** Kód klienta (C001), ak ho meno neobsahuje. */
  code?: string;
  status?: { text: string; urgency: string };
};

/** Riadok z faktov panela: meno (karta → upravený priečinok, meno od používateľa ostáva), kód, bublinka a lehota. */
export function clientRowFrom(facts: ClientRowFacts | undefined, nativeLabel: string, locale: Language): ClientRow {
  if (!facts) return { label: nativeLabel, nativeLabel, client: false };
  const named = clientLabel({ nativeLabel, path: facts.path, eligible: facts.eligible, cardTitle: facts.cardTitle });
  if (!named.path) return { label: named.label, nativeLabel, client: false };
  return {
    label: named.label, nativeLabel, client: true,
    // Celá lehota aj v bublinke (v úzkom riadku sa môže skrátiť nanajvýš kód klienta, nie lehota).
    tooltip: [t("lawoss.lite.client_folder_tooltip", locale, { path: named.path }), facts.deadline ? rowDeadlineText(facts.deadline, locale) : null].filter(Boolean).join("\n"),
    ...(named.code ? { code: named.code } : {}),
    ...(facts.deadline ? { status: { text: rowDeadlineText(facts.deadline, locale), urgency: facts.deadline.urgency } } : {}),
  };
}

/** Test seam a natívne použitie: riadok projektu z dát panela. */
export function clientProjectRow(nav: Pick<PublishedClientNav, "rows"> | null, project: ProjectRef, nativeLabel: string, locale: Language): ClientRow {
  return clientRowFrom(nav?.rows.get(project.id), nativeLabel, locale);
}

export function useClientProjectRow(project: ProjectRef, nativeLabel: string): ClientRow {
  const facts = useClientNav()?.rows.get(project.id);
  const locale = useLocale();
  return useMemo(() => clientRowFrom(facts, nativeLabel, locale), [facts, nativeLabel, locale]);
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

/**
 * Meno v hlavičke klienta: klient smie mať dva riadky (N-22), obyčajný projekt ostáva skrátený na jeden. Natívne
 * meno je v `data-lawoss-native-name`, aby ho natívny pomocník Files našiel presne aj pri mene z karty.
 */
export function ClientRowLabel({ row }: { row: ClientRow }) {
  return <span className={row.client ? "line-clamp-2 whitespace-normal break-words" : "block truncate"} title={row.tooltip}
    data-lawoss-row-label="" data-lawoss-native-name={row.nativeLabel}>{row.label}</span>;
}

/**
 * Druhý riadok klienta: najprv lehota (nikdy sa neskracuje, slovný stav, farba len dopĺňa text), potom kód klienta,
 * ktorý sa v úzkom paneli skráti ako jediný.
 */
export function ClientRowStatusLine({ row }: { row: ClientRow }) {
  if (!row.code && !row.status) return null;
  return <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground" data-lawoss-row-secondary="" title={[row.status?.text, row.code].filter(Boolean).join(" · ")}>
    {row.status ? <span className={cn("shrink-0 whitespace-nowrap", urgencyTextClass(row.status.urgency))} data-lawoss-row-status="" data-urgency={row.status.urgency}>{row.status.text}</span> : null}
    {row.code && row.status ? <span aria-hidden className="shrink-0">·</span> : null}
    {row.code ? <span className="min-w-0 truncate" data-lawoss-row-code="">{row.code}</span> : null}
  </span>;
}

/**
 * Bežný režim: zriedkavé položky klienta pod „Viac“. Otvorí sa samo, keď sa v ňom otvorí stránka (aj Lehoty klienta),
 * aj keď ho používateľ predtým zbalil; zbalené ukáže bod, keď lehota klienta horí.
 */
export function ClientMoreNavItem({ active = false, workspaceId, className, children }: { active?: boolean; workspaceId?: string; className?: string; children: ReactNode }) {
  const locale = useLocale();
  const { pathname, search } = useLocation();
  const onDeadlines = Boolean(workspaceId) && pathname === LEHOTY_PATH && new URLSearchParams(search).get("klient") === workspaceId;
  const inside = active || onDeadlines;
  const hot = useClientNav()?.rows.get(workspaceId ?? "")?.deadline?.urgency === "hot";
  const [chosen, setChosen] = useState<boolean | null>(null);
  const wasInside = useRef(inside);
  useEffect(() => {
    if (inside && !wasInside.current) setChosen(null);
    wasInside.current = inside;
  }, [inside]);
  const open = chosen ?? inside;
  return <li className="min-w-0" data-lawoss-project-more-item="">
    <SidebarMenuSubButton className={className} aria-expanded={open} data-lawoss-project-more="" onClick={() => setChosen(!open)}>
      <MoreHorizontal className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.nav_more", locale)}</span>
      {!open && hot ? <><span className="lw-nav-urgency" data-urgency="hot" aria-hidden /><span className="sr-only">{t("lawoss.lite.urgent", locale)}</span></> : null}
      <ChevronRight aria-hidden className={cn("size-3.5 text-muted-foreground transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} />
    </SidebarMenuSubButton>
    {open ? <SidebarMenuSub className="mb-1 ms-[18px] mt-1 gap-1 border-s border-sidebar-border ps-1">{children}</SidebarMenuSub> : null}
  </li>;
}

/** Kontext chatu v Nedávnych a pripnutých: „Klient · Prípad“ podľa priečinka chatu (lacné meno, bez lehôt). */
export function chatContextText(nav: Omit<PublishedClientNav, "connection"> | null, project: ProjectRef, nativeLabel: string, directory: string | null | undefined, locale: Language): string | null {
  if (!nav || nav.excludedWorkspaceIds.includes(project.id)) return null;
  const row = clientRowFrom(nav.rows.get(project.id), nativeLabel, locale);
  const { scope } = nav;
  if (!scope || !nav.model.clients.has(project.id)) return row.client ? row.label : null;
  // Chat v priečinku klienta v kancelárii: jeho klient, nie meno kancelárie.
  const inner = groupOfDirectory(scope, nav.groups, directory, (group) => clientGroupDirectory(scope, group));
  const own = clientGroupOfProject(scope, nav.groups, project.path ?? nav.rows.get(project.id)?.path ?? null);
  const client = inner && inner.key !== own?.key ? (cardTitle(nav.data, inner.key) || inner.client || row.label) : row.label;
  const matter = matterOfDirectory(scope, nav.data?.matters ?? [], directory);
  return matter ? `${client} · ${matter.title}` : client;
}

export function ChatContextLabel({ project, nativeLabel, directory }: { project: ProjectRef; nativeLabel: string; directory?: string | null }) {
  const nav = useClientNav();
  const locale = useLocale();
  const rows = nav?.rows, scope = nav?.scope ?? null, data = nav?.data, groups = nav?.groups, model = nav?.model, excluded = nav?.excludedWorkspaceIds;
  const text = useMemo(() => rows && groups && model && excluded
    ? chatContextText({ rows, scope, data, groups, model, excludedWorkspaceIds: excluded }, project, nativeLabel, directory, locale)
    : null, [rows, scope, data, groups, model, excluded, project.id, project.path, nativeLabel, directory, locale]);
  return text ? <span className="block truncate text-2xs text-muted-foreground" data-lawoss-chat-context="">{text}</span> : null;
}
