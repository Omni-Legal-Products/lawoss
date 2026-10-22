/** @jsxImportSource react */
/**
 * Prehľad klienta z OKF na natívnom Domove projektu (slot `extra` v `ProjectHome`, MČ 19. 10. 2026):
 * prípady klienta s najbližšou lehotou, súčty a najbližšie lehoty s odkazom na register lehôt klienta,
 * pod nimi pripojené priečinky klienta (natívne povolené priečinky projektu, `linked-folders-view.tsx`).
 * Projekt, ktorý nie je klient OKF, nedostane nič.
 */
import { ArrowUpRight } from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SectionHeading, Surface } from "@/react-app/design-system/surface";
import { cn } from "@/lib/utils";
import { isOfficeFile, recordKey, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { buildMatterViews, deadlineCoverage } from "../../../../../lawoss/okf/views";
import { familyNames } from "./matter-views";
import { canActOnSource, dayClass, formatDay, today } from "../okf/read-model";
import { deadlineText, urgencyOf } from "../okf/view-rules";
import { clientDeadlines, clientGroupDirectory, ownerOfFolder } from "./client-projects";
import { useClientNavData, usePublishedClientNav, type PublishedClientNav } from "./client-nav";
import { clientDeadlinesLink, liteDeadlineLink, liteMatterLink } from "./links";
import { otherClientFolders } from "./linked-folders";
import { LinkedFolders } from "./linked-folders-view";
import { nextDeadline } from "./today-model";
import { useMinuteTick } from "./live";

/** Najbližšie lehoty na Domove; ďalšie sú v registri lehôt klienta. */
const DEADLINE_LIMIT = 5;

export function ClientOverview({ workspaceId }: { workspaceId: string }) {
  const nav = usePublishedClientNav();
  // Panel zverejní dáta v efekte toho istého vykreslenia: prvé vykreslenie počká, samostatné čítanie len bez panela.
  const [settled, setSettled] = useState(false);
  useEffect(() => { setSettled(true); }, []);
  if (nav) return <ClientOverviewFrom nav={nav} workspaceId={workspaceId} />;
  // Bočný panel už prehľad číta; samostatné okno projektu (bez panela) si ho prečíta samo.
  return settled ? <StandaloneClientOverview workspaceId={workspaceId} /> : null;
}

function StandaloneClientOverview({ workspaceId }: { workspaceId: string }) {
  return <ClientOverviewFrom nav={useClientNavData()} workspaceId={workspaceId} />;
}

/** Prehľad z dát panela (export pre testy správania). */
export function ClientOverviewFrom({ nav, workspaceId }: { nav: PublishedClientNav; workspaceId: string }) {
  useMinuteTick();
  const locale = useLocale();
  const { scope, data, model } = nav;
  // #168: priečinok mimo rozsahu praxe (`excludedWorkspaceIds`) prehľad klienta nedostane.
  if (!scope || !data || !model.clients.has(workspaceId) || nav.excludedWorkspaceIds.includes(workspaceId)) return null;
  const todayIso = today();
  const own = clientDeadlines(data, scope, (folder) => ownerOfFolder(model.visible, folder) === workspaceId, todayIso);
  const clientRoot = nav.connection?.workspaces.find((w) => w.id === workspaceId)?.path ?? "";
  // Iní klienti: registrovaní klienti panela a priečinky klientov z prehľadu praxe (únik medzi klientmi).
  const otherClients = otherClientFolders(clientRoot, (nav.connection?.workspaces ?? []).filter((w) => model.clients.has(w.id)),
    nav.groups.flatMap((group) => clientGroupDirectory(scope, group) ?? []));
  const ownPaths = new Set(own.matters.map((m) => m.path));
  const ownInputs = data.inputs.filter((input) => ownPaths.has(input.path));
  // Typ práce prípadu z tých istých súborov ako detail prípadu (views.ts); bez rozpoznania nič.
  const kinds = Object.fromEntries(ownInputs.map((input) => [input.path, familyNames(buildMatterViews(input, todayIso).families, locale)]).filter(([, names]) => names));
  return <div className="space-y-4">
    <ClientOverviewView workspaceId={workspaceId} locale={locale} todayIso={todayIso} matters={own.matters}
      deadlines={[...own.overdue, ...own.upcomingDeadlines]} soon={own.totals.deadlinesWithin7Days} partial={data.coverage.status !== "complete"}
      deadlineEvidence={deadlineCoverage(ownInputs)} readFailed={!canActOnSource(data, workspaceId)} kinds={kinds} />
    <LinkedFolders connection={nav.connection} workspaceId={workspaceId} practiceRoot={scope.practiceRoot ?? null} otherClients={otherClients} locale={locale} />
  </div>;
}

export function ClientOverviewView({ workspaceId, locale, todayIso, matters, deadlines, soon, partial = false, deadlineEvidence, readFailed = false, kinds = {} }: {
  workspaceId: string; locale: Language; todayIso: string; matters: readonly MatterOverview[]; deadlines: readonly UpcomingDeadline[];
  /** Lehoty do 7 dní, spočítané ako register (`totals.deadlinesWithin7Days`). */
  soon: number;
  /** Pokrytie praxe nie je úplné (#168): prehľad to povie, aby „žiadne lehoty“ neznelo ako istota. */
  partial?: boolean;
  /** Koľko prípadov klienta lehoty eviduje: bez evidencie „neevidované“, nie „žiadne“. */
  deadlineEvidence?: { recorded: number; unrecorded: number };
  /** Zdroj klienta sa nepodarilo čerstvo prečítať: lehoty sú „nenačítané“. */
  readFailed?: boolean;
  /** Rozpoznaný typ práce podľa cesty prípadu (napr. „Konanie · Duševné vlastníctvo“). */
  kinds?: Readonly<Record<string, string>>;
}) {
  const evidence = matters.reduce((sum, m) => sum + m.counts.evidence, 0);
  const title = t("lawoss.lite.client_overview_title", locale);
  const mattersLabel = t("lawoss.lite.project_matters", locale);
  const stats = [
    { key: "matters", label: mattersLabel, value: matters.length },
    { key: "week", label: t("lawoss.lite.client_overview_week", locale), value: soon },
    { key: "evidence", label: t("lawoss.lite.client_overview_evidence", locale), value: evidence },
    // Rovnaký zdroj a počítanie ako Dnes: otvorené úlohy zo záznamov prípadov, zdieľaný súbor raz.
    { key: "tasks", label: t("lawoss.lite.client_overview_tasks", locale), value: new Set(matters.flatMap((m) => m.openTasks.map((task) => recordKey(m.path, task)))).size },
  ];
  return <section aria-label={title} data-lawoss-client-overview="" className="space-y-3">
    <SectionHeading title={title} />
    {partial ? <p className="lw-status warn" role="alert" data-lawoss-client-overview-partial="">{t("lawoss.practice.incomplete", locale)}</p> : null}
    <dl className="grid grid-cols-2 gap-3 @min-[640px]/project-page:grid-cols-4">
      {stats.map((stat) => <Surface key={stat.key} className="rounded-xl px-4 py-3" title={stat.key === "tasks" ? t("lawoss.lite.client_overview_tasks_hint", locale) : undefined}>
        <dt className="text-xs text-muted-foreground">{stat.label}</dt>
        <dd className="mt-1 text-xl font-semibold tabular-nums">{stat.value}</dd>
      </Surface>)}
    </dl>
    <div className="grid grid-cols-1 gap-4 @min-[640px]/project-page:grid-cols-2">
      <Surface className="rounded-xl p-4">
        <h3 className="text-sm font-medium">{mattersLabel}</h3>
        {matters.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("lawoss.lite.project_matters_empty", locale)}</p> : <ul className="mt-2 space-y-1">
          {matters.map((m) => {
            const next = nextDeadline(m.deadlines.filter((d) => !isOfficeFile(d.file)), todayIso);
            return <li key={m.path}>
              <Link to={liteMatterLink(m.path)} className="group flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60" title={m.title}>
                <span className="min-w-0 flex-1 truncate">{m.title}{m.matterRef ? <small className="ms-2 text-xs text-muted-foreground">{m.matterRef}</small> : null}{kinds[m.path] ? <small className="ms-2 text-xs text-muted-foreground" data-lawoss-matter-kind="">{kinds[m.path]}</small> : null}</span>
                {next ? <span className="shrink-0 text-xs tabular-nums text-muted-foreground" data-urgency={urgencyOf(next, todayIso)}>{t("lawoss.lite.matter_next_deadline", locale, { date: formatDay(next, locale) })}</span> : null}
                <ArrowUpRight aria-hidden className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100" />
              </Link>
            </li>;
          })}
        </ul>}
      </Surface>
      <Surface className="rounded-xl p-4">
        <h3 className="text-sm font-medium">{t("lawoss.lite.client_overview_deadlines", locale)}</h3>
        {deadlines.length === 0 ? <p className="mt-2 text-xs text-muted-foreground" data-lawoss-deadlines={readFailed ? "not_loaded" : deadlineEvidence && deadlineEvidence.recorded === 0 ? "unrecorded" : undefined}>
          {readFailed ? t("lawoss.lite.deadlines_not_loaded", locale)
            : deadlineEvidence && deadlineEvidence.recorded === 0 ? <>{t("lawoss.lite.deadlines_unrecorded", locale)} {t("lawoss.lite.deadlines_unrecorded_hint", locale)}</>
            : t("lawoss.lite.client_overview_no_deadlines", locale)}
        </p> : <ul className="mt-2 space-y-1">
          {deadlines.slice(0, DEADLINE_LIMIT).map((d, index) => <li key={`${d.matter.path}/${d.recordId}/${d.date}/${index}`}>
            <Link to={liteDeadlineLink(d.matter.path, d.recordId, d.date)} className="flex min-w-0 items-baseline gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60">
              <span className={cn("shrink-0 tabular-nums", dayClass(d.date, todayIso))}>{formatDay(d.date, locale)}</span>
              <span className="min-w-0 flex-1 truncate">{deadlineText(d)}<small className="ms-2 text-xs text-muted-foreground">{d.matter.title}</small></span>
            </Link>
          </li>)}
        </ul>}
        {!readFailed && deadlineEvidence && deadlineEvidence.recorded > 0 && deadlineEvidence.unrecorded > 0
          ? <p className="mt-2 px-2 text-xs text-muted-foreground" data-lawoss-deadlines="partial">{t("lawoss.lite.deadlines_partial_note", locale, { count: deadlineEvidence.unrecorded })}</p> : null}
        <Link to={clientDeadlinesLink(workspaceId)} className="mt-2 inline-flex px-2 text-xs text-muted-foreground underline-offset-2 hover:underline">{t("lawoss.lite.client_deadlines_all", locale)}</Link>
      </Surface>
    </div>
  </section>;
}

