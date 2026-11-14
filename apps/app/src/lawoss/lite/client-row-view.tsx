/** @jsxImportSource react */
/**
 * Riadky bočného panela pre natívny `app-sidebar.tsx` (alfa2 B3, N-22): čitateľné meno klienta (aj na dva riadky)
 * s kódom klienta a priečinkom, stručný stav (lehota zo súborov; v bežnom režime vpravo v riadku), zvýraznenie
 * predka a kontext chatu (Klient · Prípad). Upstream len vymení volanie; mimo LAWOSS dát ostáva natívne meno.
 * Fakty riadkov počíta panel raz (`buildClientRows`); tu sa doplní len natívne meno a jazyk.
 */
import { useCallback, useMemo } from "react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { cn } from "@/lib/utils";
import { clientGroupDirectory } from "./client-projects";
import { cardTitle, clientGroupOfProject, clientLabel, groupOfDirectory, matterOfDirectory } from "./client-row";
import { clientCardLabel } from "./client-titles";
import type { ClientRowFacts } from "./client-row-data";
import { dueTextClass, rowDeadlineText, rowDueText, urgencyTextClass } from "./client-row-text";
import { useClientNav, useClientNavData, usePublishedClientNav, type PublishedClientNav } from "./client-nav";
import { JUST_CHANGED_CLASS, useJustChanged } from "./just-changed";
import { useUiMode, type UiMode } from "./ui-mode";

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
  /** Bežný režim: tá istá lehota vpravo v riadku, slovom do 14 dní („o 3 dni“), inak dátum. */
  due?: { text: string; urgency: string };
  /** Totožnosť lehoty (druh a dátum): mení sa, keď pribudne bližšia lehota, nie o polnoci pri „o 3 dni“ → „o 2 dni“. */
  dueKey?: string;
};

/**
 * Riadok z faktov panela: meno (karta → upravený priečinok, meno od používateľa ostáva), kód, bublinka a lehota.
 * Kým sa prehľad načítava (bez faktov alebo `pending`), meno z karty, ktoré si appka zapamätala skôr (N-A5-6).
 */
export function clientRowFrom(facts: ClientRowFacts | undefined, nativeLabel: string, locale: Language, remembered?: string): ClientRow {
  if (!facts || (facts.pending && remembered)) return { label: remembered ?? nativeLabel, nativeLabel, client: false };
  const named = clientLabel({ nativeLabel, path: facts.path, eligible: facts.eligible, cardTitle: facts.cardTitle });
  if (!named.path) return { label: named.label, nativeLabel, client: false };
  return {
    label: named.label, nativeLabel, client: true,
    // Celá lehota aj v bublinke (v úzkom riadku sa môže skrátiť nanajvýš kód klienta, nie lehota).
    tooltip: [t("lawoss.lite.client_folder_tooltip", locale, { path: named.path }), facts.deadline ? rowDeadlineText(facts.deadline, locale) : null].filter(Boolean).join("\n"),
    ...(named.code ? { code: named.code } : {}),
    ...(facts.deadline ? {
      status: { text: rowDeadlineText(facts.deadline, locale), urgency: facts.deadline.urgency },
      due: { text: rowDueText(facts.deadline, locale), urgency: facts.deadline.urgency },
      dueKey: facts.deadline.kind === "next" ? `next:${facts.deadline.date}` : facts.deadline.kind,
    } : {}),
  };
}

/** Test seam a natívne použitie: riadok projektu z dát panela. */
export function clientProjectRow(nav: Pick<PublishedClientNav, "rows"> | null, project: ProjectRef, nativeLabel: string, locale: Language): ClientRow {
  return clientRowFrom(nav?.rows.get(project.id), nativeLabel, locale, clientCardLabel(project.id, nativeLabel, project.path));
}

/**
 * Meno klienta pre zoznam mimo bočného panela (stránka Klienti). Panel tam nie je vykreslený a jeho zverejnené dáta
 * sú prázdne, preto si zoznam číta prehľad sám (rovnaká cache dopytu ako panel a samostatný Prehľad klienta).
 */
export function useClientListLabel(): (project: ProjectRef, nativeLabel: string) => string {
  const published = usePublishedClientNav();
  const own = useClientNavData();
  const locale = useLocale();
  const rows = (published ?? own).rows;
  return useCallback((project, nativeLabel) => clientProjectRow({ rows }, project, nativeLabel, locale).label, [rows, locale]);
}

export function useClientProjectRow(project: ProjectRef, nativeLabel: string): ClientRow {
  const facts = useClientNav()?.rows.get(project.id);
  const locale = useLocale();
  return useMemo(() => clientRowFrom(facts, nativeLabel, locale, clientCardLabel(project.id, nativeLabel, project.path)), [facts, nativeLabel, locale, project.id, project.path]);
}

/**
 * Meno projektu na Prehľade klienta (hlavička) – rovnaké ako v bočnom paneli. `path`: dnešný priečinok priestoru,
 * aby meno zapamätané pre iný priečinok neprežilo presmerovanie priestoru (#273).
 */
export function useClientDisplayName(projectId: string, nativeLabel: string, path: string): string {
  return useClientProjectRow({ id: projectId, path }, nativeLabel).label;
}

/** Riadok klienta je aktívny podľa trasy (vec alebo chat vo veci patrí jemu); inak natívny vybraný projekt. */
export function useClientRowActive(projectId: string, isSelected: boolean): boolean {
  const focused = useClientNav()?.focused;
  return focused ? focused === projectId : isSelected;
}

/**
 * Meno v hlavičke klienta: klient smie mať dva riadky (N-22), obyčajný projekt ostáva skrátený na jeden. Natívne
 * meno je v `data-lawoss-native-name`, aby ho natívny pomocník Files našiel presne aj pri mene z karty.
 * Bežný režim: najbližšia lehota vpravo vedľa mena (návrh sidebaru alfy 14); Pokročilý ju má v druhom riadku.
 */
export function ClientRowLabel({ row }: { row: ClientRow }) {
  // Alfa 14: zmena najbližšej lehoty (napr. po zápise lehoty) sa na riadku krátko zlato zvýrazní.
  const changed = useJustChanged(row.dueKey);
  return <ClientRowLabelView row={row} mode={useUiMode()} justChanged={changed} />;
}

export function ClientRowLabelView({ row, mode, justChanged = false }: { row: ClientRow; mode: UiMode; justChanged?: boolean }) {
  const name = <span className={row.client ? "line-clamp-2 whitespace-normal break-words" : "block truncate"} title={row.tooltip}
    data-lawoss-row-label="" data-lawoss-native-name={row.nativeLabel}>{row.label}</span>;
  if (mode !== "lite" || !row.due) return name;
  return <span className={cn("flex min-w-0 items-baseline gap-2 rounded-[var(--lw-radius-xs)]", justChanged && JUST_CHANGED_CLASS)} data-lawoss-just-changed={justChanged ? "" : undefined}>
    <span className="min-w-0 flex-1">{name}</span>
    <span className={cn("lw-row-due", dueTextClass(row.due.urgency))} data-lawoss-row-due="" data-urgency={row.due.urgency}>{row.due.text}</span>
  </span>;
}

/**
 * Druhý riadok klienta: najprv lehota (nikdy sa neskracuje, slovný stav, farba len dopĺňa text), potom kód klienta,
 * ktorý sa v úzkom paneli skráti ako jediný. Bežný režim: lehota je už vpravo v prvom riadku, tu len kód.
 */
export function ClientRowStatusLine({ row }: { row: ClientRow }) {
  return <ClientRowStatusLineView row={row} mode={useUiMode()} />;
}

export function ClientRowStatusLineView({ row, mode }: { row: ClientRow; mode: UiMode }) {
  const status = mode === "lite" ? undefined : row.status;
  if (!row.code && !status) return null;
  return <span className="flex min-w-0 items-baseline gap-1 text-xs text-muted-foreground" data-lawoss-row-secondary="" title={[status?.text, row.code].filter(Boolean).join(" · ")}>
    {status ? <span className={cn("shrink-0 whitespace-nowrap", urgencyTextClass(status.urgency))} data-lawoss-row-status="" data-urgency={status.urgency}>{status.text}</span> : null}
    {row.code && status ? <span aria-hidden className="shrink-0">·</span> : null}
    {row.code ? <span className="min-w-0 truncate" data-lawoss-row-code="">{row.code}</span> : null}
  </span>;
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
