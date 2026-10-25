/** @jsxImportSource react */
/**
 * Prehľad klienta z OKF na natívnom Domove projektu (slot `extra` v `ProjectHome`, MČ 19. 10. 2026) ako portfólio
 * prípadov (spec 0020, variant C): súhrn (vstupy, najbližší termín, úlohy), prípady ako karty, časová os, lehoty
 * a malý mesiac; prepínač Prehľad / Mesiac. Pod ním pripojené priečinky klienta (`linked-folders-view.tsx`).
 * Projekt, ktorý nie je klient OKF, nedostane nič.
 */
import { ArrowUpRight, CalendarClock, FolderOpen, Inbox, ListChecks } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { SectionHeading } from "@/react-app/design-system/surface";
import { cn } from "@/lib/utils";
import type { MatterOverview, UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { buildMatterViews, deadlineCoverage } from "../../../../../lawoss/okf/views";
import { familyNames } from "./matter-views";
import { canActOnSource, dayClass, formatDay, today } from "../okf/read-model";
import { deadlineText, urgencyOf } from "../okf/view-rules";
import { clientDeadlines, clientGroupDirectory, overviewFolder, overviewOwners, ownerOfFolder } from "./client-projects";
import { useClientNavData, usePublishedClientNav, type PublishedClientNav } from "./client-nav";
import { clientDeadlinesLink, LITE_INPUTS_PATH, liteDeadlineLink, liteMatterLink } from "./links";
import { otherClientFolders } from "./linked-folders";
import { LinkedFolders } from "./linked-folders-view";
import { buildToday, type TodayModel } from "./today-model";
import { agendaEvents, type AgendaEvent } from "./agenda-model";
import { CandidatesPanel, ModeSwitch, MonthCalendar, type ViewMode } from "./agenda-views";
import { CARDS_SHOWN, caseCards, cardStatus, clientTerm, inputCounts, type CardStatus, type CardTerm, type InputCounts } from "./client-cards";
import { DeadlineStrip, liteText } from "./pages/today-page";
import { useMinuteTick } from "./live";
import "./pages/okf-glass.css";
import "./pages/client-home.css";

/** Najbližšie lehoty na Domove; ďalšie sú v registri lehôt klienta. */
const DEADLINE_LIMIT = 5;
/** Pruhy úloh podľa prípadov v súhrne. */
const TASK_BARS = 4;

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
  const todayIso = today();
  // #168: priečinok mimo rozsahu praxe (`excludedWorkspaceIds`) prehľad klienta nedostane.
  const allowed = Boolean(scope && data && model.clients.has(workspaceId) && !nav.excludedWorkspaceIds.includes(workspaceId));
  const derived = useMemo(() => {
    if (!allowed || !scope || !data) return null;
    // Review #246 (P2): prípad zaregistrovaného vnoreného klienta (skrytého v paneli) patrí jemu, nie vonkajšiemu.
    const owners = overviewOwners(model, nav.connection?.workspaces ?? [], scope, nav.groups);
    const own = clientDeadlines(data, scope, (folder) => ownerOfFolder(owners, folder) === workspaceId, todayIso);
    const ownPaths = new Set(own.matters.map((m) => m.path));
    const ownInputs = data.inputs.filter((input) => ownPaths.has(input.path));
    const ownFolder = (relative: string) => {
      const folder = overviewFolder(scope, relative);
      return folder !== null && ownerOfFolder(owners, folder) === workspaceId;
    };
    // Review #246 (P3): klientsky `VSTUPY.md` aj bez prípadov; register, ktorý sa nedal prečítať, nie je „neevidovaný“.
    const ownClients = (data.clients ?? []).filter((client) => ownFolder(client.path));
    const intakeFailed = data.problems.some((problem) => /(?:^|\/)VSTUPY\.md$/.test(problem.path) && ownFolder(problem.path.split("/").slice(0, -1).join("/")));
    // Priečinok klienta chýba (presunutý, odpojený disk): o registri nevieme nič. Iný problém zdroja (napr. zlý
    // záznam pamäte) register nespochybní.
    const folderMissing = data.problems.some((problem) => problem.folderUnavailable !== undefined && ownFolder(problem.path));
    // Typ práce aj fáza a ďalší krok z tých istých súborov ako detail prípadu (views.ts).
    const views = ownInputs.map((input) => [input.path, buildMatterViews(input, todayIso)] as const);
    const kinds = Object.fromEntries(views.map(([path, view]) => [path, familyNames(view.families, locale)]).filter(([, names]) => names));
    const statuses = Object.fromEntries(views.map(([path, view]) => [path, cardStatus(view)]));
    // Len vlastní klienti: `own` nesie všetkých klientov prehľadu, Domov nemá rátať priečinky na nezaradené iných.
    const source = { ...own, inputs: ownInputs, clients: ownClients };
    return { own, ownInputs, kinds, statuses, events: agendaEvents(source), todayModel: buildToday(source, todayIso), inputs: inputCounts(ownInputs, own.matters.map((m) => m.path), ownClients), intakeFailed, folderMissing };
  }, [allowed, scope, data, model, nav.connection, nav.groups, workspaceId, todayIso, locale]);
  if (!scope || !data || !derived) return null;
  const { own, ownInputs, kinds, statuses, events, todayModel, inputs, intakeFailed, folderMissing } = derived;
  const clientRoot = nav.connection?.workspaces.find((w) => w.id === workspaceId)?.path ?? "";
  // Iní klienti: registrovaní klienti panela a priečinky klientov z prehľadu praxe (únik medzi klientmi).
  const otherClients = otherClientFolders(clientRoot, (nav.connection?.workspaces ?? []).filter((w) => model.clients.has(w.id)),
    nav.groups.flatMap((group) => clientGroupDirectory(scope, group) ?? []));
  return <div className="space-y-4">
    <ClientOverviewView workspaceId={workspaceId} locale={locale} todayIso={todayIso} matters={own.matters}
      deadlines={[...own.overdue, ...own.upcomingDeadlines]} soon={own.totals.deadlinesWithin7Days} partial={data.coverage.status !== "complete"}
      deadlineEvidence={deadlineCoverage(ownInputs)} readFailed={!canActOnSource(data, workspaceId)} kinds={kinds}
      statuses={statuses} inputs={inputs} inputsFailed={intakeFailed || (inputs === null && folderMissing)} events={events} today={todayModel} />
    <LinkedFolders connection={nav.connection} workspaceId={workspaceId} practiceRoot={scope.practiceRoot ?? null} otherClients={otherClients} locale={locale} />
  </div>;
}

export function ClientOverviewView({ workspaceId, locale, todayIso, matters, deadlines, soon, partial = false, deadlineEvidence, readFailed = false, kinds = {}, statuses = {}, inputs, inputsFailed = false, events, today: todayModel }: {
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
  /** Fáza a ďalší krok prípadu z `_STATUS.md` (kľúč = cesta prípadu). */
  statuses?: Readonly<Record<string, CardStatus>>;
  /** Vstupy klienta z `VSTUPY.md`; `null` = neevidované, `undefined` = karta sa neukáže. */
  inputs?: InputCounts | null;
  /** Niektorý `VSTUPY.md` klienta sa nedal prečítať: bez počtov „nenačítané“, s počtami „čiastočné“. */
  inputsFailed?: boolean;
  /** Udalosti klienta pre mesiac (spec 0020); bez nich sa prepínač ani mesiac neukážu. */
  events?: readonly AgendaEvent[];
  /** Lehoty a termíny klienta pre 14-dňovú časovú os. */
  today?: TodayModel;
}) {
  const [mode, setMode] = useState<ViewMode>("overview");
  const [showAll, setShowAll] = useState(false);
  const evidence = matters.reduce((sum, m) => sum + m.counts.evidence, 0);
  const title = t("lawoss.lite.client_overview_title", locale);
  const mattersLabel = t("lawoss.lite.project_matters", locale);
  const cards = caseCards(matters, statuses, todayIso);
  const shown = showAll ? cards : cards.slice(0, CARDS_SHOWN);
  const month = Boolean(events) && mode === "month";
  return <section aria-label={title} data-lawoss-client-overview="" className="lw-client-home">
    <SectionHeading title={title} action={events ? <ModeSwitch mode={mode} onChange={setMode} locale={locale} /> : undefined} />
    {partial ? <p className="lw-status warn" role="alert" data-lawoss-client-overview-partial="">{t("lawoss.practice.incomplete", locale)}</p> : null}
    {month && events ? <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="full" aside={<CandidatesPanel events={events} locale={locale} />} /> : <>
      <div className="lw-client-summary">
        {inputs !== undefined ? <InputsCard counts={inputs} failed={inputsFailed} evidence={evidence} locale={locale} /> : null}
        <TermCard term={clientTerm(matters, todayIso)} soon={soon} todayIso={todayIso} locale={locale} />
        <TasksCard matters={matters} locale={locale} />
      </div>

      <section className="lw-client-cases" aria-label={mattersLabel}>
        <h3 className="lw-client-title"><FolderOpen aria-hidden size={16} />{mattersLabel}<span className="lw-matter-count">{matters.length}</span></h3>
        {matters.length === 0 ? <p className="lw-client-empty">{t("lawoss.lite.project_matters_empty", locale)}</p> : <div className="lw-client-grid">
          {shown.map((card) => <CaseCardView key={card.matter.path} matter={card.matter} term={card.term} status={card.status} kind={kinds[card.matter.path]} todayIso={todayIso} locale={locale} />)}
        </div>}
        {!showAll && cards.length > CARDS_SHOWN ? <button type="button" className="lw-client-more" onClick={() => setShowAll(true)}>{t("lawoss.lite.cards_show_all", locale, { count: cards.length })}</button> : null}
      </section>

      {todayModel ? <DeadlineStrip deadlines={todayModel.deadlines} tasks={todayModel.tasks} todayIso={todayIso} locale={locale} text={liteText(locale)} /> : null}

      <div className={cn("lw-client-time", events ? "" : "lw-client-time-single")}>
        <section className="lw-month-panel">
          <h3 className="lw-client-title"><CalendarClock aria-hidden size={16} />{t("lawoss.lite.client_overview_deadlines", locale)}</h3>
          {deadlines.length === 0 ? <p className="lw-client-empty" data-lawoss-deadlines={readFailed ? "not_loaded" : deadlineEvidence && deadlineEvidence.recorded === 0 ? "unrecorded" : undefined}>
            {readFailed ? t("lawoss.lite.deadlines_not_loaded", locale)
              : deadlineEvidence && deadlineEvidence.recorded === 0 ? <>{t("lawoss.lite.deadlines_unrecorded", locale)} {t("lawoss.lite.deadlines_unrecorded_hint", locale)}</>
              : t("lawoss.lite.client_overview_no_deadlines", locale)}
          </p> : <ul className="lw-client-list">
            {deadlines.slice(0, DEADLINE_LIMIT).map((d, index) => <li key={`${d.matter.path}/${d.recordId}/${d.date}/${index}`}>
              <Link to={liteDeadlineLink(d.matter.path, d.recordId, d.date)} className="lw-agenda-item" data-kind="deadline">
                <span className={cn("lw-client-day", dayClass(d.date, todayIso))}>{formatDay(d.date, locale)}</span>
                <span className="lw-agenda-main"><span className="lw-agenda-name">{deadlineText(d)}</span><small>{d.matter.title}</small></span>
              </Link>
            </li>)}
          </ul>}
          {!readFailed && deadlineEvidence && deadlineEvidence.recorded > 0 && deadlineEvidence.unrecorded > 0
            ? <p className="lw-client-empty" data-lawoss-deadlines="partial">{t("lawoss.lite.deadlines_partial_note", locale, { count: deadlineEvidence.unrecorded })}</p> : null}
          <Link to={clientDeadlinesLink(workspaceId)} className="lw-client-link">{t("lawoss.lite.client_deadlines_all", locale)}</Link>
        </section>
        {events ? <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="compact" /> : null}
      </div>
    </>}
  </section>;
}

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

/** Prstenec vstupov z `VSTUPY.md`: spracované / čakajú na spracovanie / nezaradené; bez registra „neevidované“. */
function InputsCard({ counts, failed, evidence, locale }: { counts: InputCounts | null; failed: boolean; evidence: number; locale: Language }) {
  const total = counts ? counts.processed + counts.waiting + counts.unfiled : 0;
  const parts = counts ? [
    { key: "processed", value: counts.processed, label: t("lawoss.lite.inputs_processed", locale) },
    { key: "waiting", value: counts.waiting, label: t("lawoss.lite.inputs_waiting", locale) },
    { key: "unfiled", value: counts.unfiled, label: t("lawoss.lite.inputs_unfiled", locale) },
  ] : [];
  let offset = 0;
  return <section className="lw-month-panel lw-client-card" data-lawoss-inputs={counts ? total : failed ? "not_loaded" : "unrecorded"} data-lawoss-inputs-partial={counts && failed ? "" : undefined}>
    <h3 className="lw-client-title"><Inbox aria-hidden size={16} />{t("lawoss.lite.inputs_ring_title", locale)}</h3>
    {counts ? <div className="lw-client-ring-row">
      <svg className="lw-client-ring" viewBox="0 0 80 80" role="img" aria-label={parts.map((p) => `${p.label}: ${p.value}`).join(", ")}>
        <circle cx="40" cy="40" r={RING_R} className="lw-client-ring-track" />
        {total > 0 ? parts.map((part) => {
          const length = (part.value / total) * RING_C;
          const segment = <circle key={part.key} cx="40" cy="40" r={RING_R} data-part={part.key} strokeDasharray={`${length} ${RING_C - length}`} strokeDashoffset={-offset} transform="rotate(-90 40 40)" />;
          offset += length;
          return part.value > 0 ? segment : null;
        }) : null}
        <text x="40" y="45" textAnchor="middle">{total}</text>
      </svg>
      <ul className="lw-client-ring-legend">
        {parts.map((part) => <li key={part.key} data-part={part.key}><i aria-hidden /><b>{part.value}</b> {part.label}</li>)}
      </ul>
    </div> : <p className="lw-client-empty">{t(failed ? "lawoss.lite.inputs_not_loaded" : "lawoss.lite.inputs_unrecorded", locale)}</p>}
    {counts && failed ? <p className="lw-client-empty" role="note">{t("lawoss.lite.inputs_partial", locale)}</p> : null}
    <dl className="lw-client-mini">
      <div><dt>{t("lawoss.lite.client_overview_evidence", locale)}</dt><dd>{evidence}</dd></div>
    </dl>
    {counts && counts.unfiled > 0 ? <Link to={LITE_INPUTS_PATH} className="lw-client-link">{t("lawoss.lite.inputs_open_list", locale)}</Link> : null}
  </section>;
}

const TERM_KIND: Record<CardTerm["kind"], string> = { deadline: "lawoss.lite.agenda_kind_deadline", work: "lawoss.lite.agenda_kind_work" };

function TermCard({ term, soon, todayIso, locale }: { term?: CardTerm & { matter: MatterOverview }; soon: number; todayIso: string; locale: Language }) {
  return <section className="lw-month-panel lw-client-card" data-lawoss-next-term={term?.kind ?? "none"} data-urgency={term ? urgencyOf(term.date, todayIso) : undefined}>
    <h3 className="lw-client-title"><CalendarClock aria-hidden size={16} />{t("lawoss.lite.next_term_title", locale)}</h3>
    {term ? <Link to={liteMatterLink(term.matter.path)} className="lw-client-term">
      <strong>{formatDay(term.date, locale)}</strong>
      <span className="lw-client-term-kind">{t(TERM_KIND[term.kind], locale)}</span>
      <span className="lw-agenda-name">{term.title}</span>
      <small>{term.matter.title}</small>
    </Link> : <p className="lw-client-empty">{t("lawoss.lite.next_term_none", locale)}</p>}
    <dl className="lw-client-mini">
      <div><dt>{t("lawoss.lite.client_overview_week", locale)}</dt><dd>{soon}</dd></div>
    </dl>
  </section>;
}

/** Otvorené úlohy zo záznamov prípadov (rovnaký zdroj ako Dnes) a ich rozdelenie podľa prípadov. */
function TasksCard({ matters, locale }: { matters: readonly MatterOverview[]; locale: Language }) {
  const rows = matters.filter((m) => m.openTasks.length > 0).sort((a, b) => b.openTasks.length - a.openTasks.length);
  const total = new Set(matters.flatMap((m) => m.openTasks.map((task) => task.file ?? `${m.path}\u0000${task.id}`))).size;
  const max = rows[0]?.openTasks.length ?? 1;
  return <section className="lw-month-panel lw-client-card" title={t("lawoss.lite.client_overview_tasks_hint", locale)}>
    <h3 className="lw-client-title"><ListChecks aria-hidden size={16} />{t("lawoss.lite.client_overview_tasks", locale)}</h3>
    <strong className="lw-client-big">{total}</strong>
    {rows.length ? <ul className="lw-client-bars">
      {rows.slice(0, TASK_BARS).map((m) => <li key={m.path}>
        <span title={m.title}>{m.title}</span>
        <i aria-hidden style={{ width: `${Math.max(8, (m.openTasks.length / max) * 100)}%` }} />
        <b>{m.openTasks.length}</b>
      </li>)}
    </ul> : null}
  </section>;
}

function CaseCardView({ matter, term, status, kind, todayIso, locale }: { matter: MatterOverview; term?: CardTerm; status: CardStatus; kind?: string; todayIso: string; locale: Language }) {
  return <Link to={liteMatterLink(matter.path)} className="lw-case" data-urgency={term ? urgencyOf(term.date, todayIso) : undefined} title={matter.title}>
    <span className="lw-case-top">
      <span className="lw-case-title">{matter.title}</span>
      <ArrowUpRight aria-hidden size={15} className="lw-case-arrow" />
    </span>
    {matter.matterRef || kind ? <span className="lw-case-meta">
      {matter.matterRef ? <span className="lw-today-ref">{matter.matterRef}</span> : null}
      {kind ? <span data-lawoss-matter-kind="">{kind}</span> : null}
    </span> : null}
    <span className="lw-case-line">
      <small>{t("lawoss.lite.card_phase", locale)}</small>
      {status.phase ? <span>{status.phase}</span> : <em>{t("lawoss.lite.card_phase_missing", locale)}</em>}
      {status.stale ? <span className="lw-case-stale">{t("lawoss.lite.card_phase_stale", locale)}</span> : null}
    </span>
    {status.nextStep ? <span className="lw-case-line"><small>{t("lawoss.lite.card_next_step", locale)}</small><span>{status.nextStep}</span></span> : null}
    <span className="lw-case-foot">
      <span className="lw-case-term" data-kind={term?.kind}>{term
        ? `${formatDay(term.date, locale)} · ${t(TERM_KIND[term.kind], locale)}`
        : t("lawoss.lite.card_no_date", locale)}</span>
      <span>{t("lawoss.lite.tasks_short", locale)} {matter.openTasks.length}</span>
    </span>
  </Link>;
}
