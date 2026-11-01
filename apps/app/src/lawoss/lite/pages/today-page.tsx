/** @jsxImportSource react */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, ArrowUpRight, CalendarClock, Check, Clock, FolderOpen, Inbox, Info, ListChecks } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import { useOptionalLocal } from "@/react-app/kernel/local-provider";
import { PracticeMoveNotice } from "../../domains/practice-move-notice";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { onboardingIncomplete } from "../../domains/onboarding/resume";
import { OnboardingResumeCardView } from "../../domains/onboarding/resume-card";
import { litePageProps } from "../state-text";
import { addDays, formatDay, today, useOkfConnection, type OkfReadResult, type OkfScope } from "../../okf/read-model";
import { deadlineKey, deadlineText, dueTextFromDays, isCalendarDay, taskDueView, urgencyOf, type Urgency } from "../../okf/view-rules";
import { isOfficeFile, taskDue, type MatterOverview } from "../../../../../../lawoss/okf/read";
import { deadlineCoverage } from "../../../../../../lawoss/okf/views";
import { appTodayTasks, buildToday, caseDateRows, caseDates, invalidCaseDates, nextDeadline, startHere, taskLink, type CaseDate, type StartHere, type TodayDeadline, type TodayModel, type TodayTask } from "../today-model";
import { appTaskClient, inPractice, openAppTask, useAppTasks } from "../app-tasks";
import { agendaEvents, type AgendaEvent } from "../agenda-model";
import { CandidatesPanel, ModeSwitch, MonthCalendar, type ViewMode } from "../agenda-views";
import { LITE_INPUTS_PATH, liteDeadlineLink, liteMatterLink } from "../links";
import { clientPreferenceScope, practiceClientChoices, type ClientChoice } from "../client-choice";
import { NewMatterAction } from "../client-picker";
import { hotDeadlineCount, LiveStamp, useHotTitle, useMinuteTick } from "../live";
import "./okf-glass.css";
import "./today.css";

const STRIP_DAYS = 14;
const STRIP_DOTS = 3;
const STRIP_TASK_DOTS = 2;
const TIP_ITEMS = 6;
/** Lehota alebo úloha zdieľaná viacerými vecami ukáže dve a „+N ďalšie". */
const MATTERS_SHOWN = 2;
const MATTER_CARDS = 6;
/** N-A5-9: „Termíny z prípadov“ a „Otvorené úlohy“ ukážu toľko riadkov a počet ďalších, nie stovky. */
const LIST_ROWS = 8;

export function TodayPage() {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const local = useOptionalLocal();
  // Profil z onboardingu: meno do pozdravu a karta nedokončeného nastavenia (#96). Bez cache, aby karta po dokončení hneď zmizla.
  const profile = useQuery({
    queryKey: ["lawoss-onboarding-profile", connection?.baseUrl ?? ""],
    enabled: Boolean(connection?.client),
    retry: false,
    staleTime: 0,
    queryFn: async () => (await connection?.client?.onboardingStatus())?.profile ?? null,
  });
  const resume = profile.data && onboardingIncomplete(profile.data, local?.prefs.hasCompletedOnboarding ?? false)
    ? <OnboardingResumeCardView locale={locale} />
    : null;
  // N-A7-1: nedokončený presun praxe sa ponúkne dokončiť (klienti sú už prepojení).
  return <OkfPage {...litePageProps(locale)} notice={<>{resume}<PracticeMoveNotice /></>}>
    {(data, meta, scope) => <TodayLive data={data} meta={meta} scope={scope} locale={locale} name={profile.data?.lawyerName || undefined} />}
  </OkfPage>;
}

function TodayLive({ data, meta, scope, locale, name }: { data: OkfReadResult; meta: OkfPageMeta; scope: OkfScope | null; locale: Language; name?: string }) {
  useMinuteTick(); // o polnoci nový „dnes", počas dňa nový pozdrav
  const now = today();
  // Model len pri novom obsahu pamäte alebo novom dni, nie pri každom tichom obnovení.
  const { connection } = useOkfConnection();
  // N-A5-4: úlohy aplikácie (Nová úloha) praxe patria na Dnes, do mesiaca aj na os (app-tasks.ts).
  const { tasks: rawAppTasks, complete: appTasksComplete } = useAppTasks(connection);
  // Spojenie sa obnovuje každých 15 s s novým poľom priečinkov: model sa prepočíta len pri skutočnej zmene.
  const workspacesKey = JSON.stringify(connection?.workspaces.map((w) => [w.id, w.path, w.displayNameResolved]) ?? []);
  const appTasks = useMemo(() => {
    const workspaces = connection?.workspaces ?? [];
    const belongs = scope ? inPractice(workspaces, scope) : () => true;
    return appTodayTasks(rawAppTasks.filter(belongs), appTaskClient(workspaces, scope, data.clients ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspacesKey nesie obsah connection.workspaces.
  }, [rawAppTasks, workspacesKey, scope, data.clients]);
  const model = useMemo(() => buildToday(data, now, undefined, appTasks), [data, now, appTasks]);
  const events = useMemo(() => agendaEvents(data, appTasks), [data, appTasks]);
  useHotTitle(hotDeadlineCount(data, now));
  // Prax: „+ Nová vec“ sa najprv opýta, pre ktorého klienta (prehľad praxe).
  const choices = useMemo(() => practiceClientChoices(scope, data.clients), [scope, data.clients]);
  // „Nič nehorí“ len po úplnom čítaní a pri evidovaných lehotách; inak to prehľad povie (UX P2 Denný prehľad).
  // Po prípadoch: jeden prípad s lehotami nerobí evidovanými ostatné (I-5b).
  // #271: nedočítaný zoznam úloh aplikácie robí prehľad neúplným rovnako ako nedočítaná pamäť.
  const evidence = useMemo(() => ({ complete: data.coverage.status === "complete" && appTasksComplete, ...deadlineCoverage(data.inputs) }), [data, appTasksComplete]);
  return <TodayView model={model} locale={locale} meta={meta} name={name} choices={choices} evidence={evidence} events={events} preferenceScope={clientPreferenceScope(scope, connection?.baseUrl)} activeId={connection?.activeWorkspaceId} />;
}

type Text = (key: string, params?: Record<string, string | number>) => string;
/** Texty `lawoss.lite.*` pre zdieľané časti (časová os aj na Domove klienta). */
export const liteText = (locale: Language): Text => (key, params) => t(`lawoss.lite.${key}`, locale, params);


/** Naléhavost lhůty podle společných pravidel (view-rules), stejně jako v detailu věci. */
const urgency = (d: Pick<TodayDeadline, "date" | "invalid">, todayIso: string): Urgency => urgencyOf(d.date, todayIso, d.invalid);

function greetingKey(hour: number): string {
  if (hour < 10) return "greeting_morning";
  return hour < 18 ? "greeting_day" : "greeting_evening";
}

const parseDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
const longDate = (iso: string, locale: Language) =>
  new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parseDay(iso));
const weekdayShort = (iso: string, locale: Language) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(parseDay(iso)).replace(".", "");
const dayOfMonth = (iso: string) => parseDay(iso).getUTCDate();
const isWeekend = (iso: string) => [0, 6].includes(parseDay(iso).getUTCDay());
/** Postupné odhalení panelů; pořadí nese CSS proměnná. */
const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });

/** Ranní otázka „co mi dnes hoří": přehled, pás lhůt, lhůty, úkoly, k zařazení a věci. Jen čte, nic nezapisuje. */
export function TodayView({ model, locale, now = new Date(), meta, name, choices, activeId, preferenceScope, evidence, events, initialMode = "overview" }: { model: TodayModel; locale: Language; now?: Date; meta?: OkfPageMeta; name?: string; choices?: readonly ClientChoice[]; activeId?: string | null; preferenceScope?: string;
  /** Úplnosť čítania a evidencia lehôt v podkladoch: bez nich prázdny zoznam nie je „nič nehorí“. */
  evidence?: { complete: boolean; recorded: number; unrecorded: number };
  /** Udalosti praxe pre mesiac (spec 0020); bez nich sa prepínač ani mesiac neukážu. */
  events?: readonly AgendaEvent[];
  /** Režim po otvorení; voľba sa nepamätá (spec 0020). */
  initialMode?: ViewMode }) {
  const text = liteText(locale);
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const month = Boolean(events) && mode === "month";
  const todayIso = today(now);
  // „Tento týždeň" = všetko, čo nie je v pokoji (po lehote, neplatné, do 7 dní) - rovnaké pravidlo ako farby.
  const thisWeek = model.deadlines.filter((d) => urgency(d, todayIso) !== "calm");
  const first = model.deadlines[0];
  // N-A2-11: termíny z prípadov (úlohy s dátumom) oddelene od lehôt; „nie sú evidované“ len keď nie je ani termín
  // a „nič nehorí“ nie, keď termín uplynul alebo príde do 7 dní. Uplynulý termín má prednosť (zoradené podľa dátumu).
  const dates = caseDates(model.tasks, todayIso, STRIP_DAYS, model.deadlines);
  // Úvod a „Termíny z prípadov“ hovoria o prípadoch; úloha aplikácie je v Začnite tu, na osi a v Otvorených úlohách.
  const caseOnly = dates.filter((d) => !d.app);
  // N-A7-4 (MČ 31. 10. 2026): neplatný dátum úlohy prípadu je aj navrchu „Termínov z prípadov“; v „Otvorených
  // úlohách“ ostáva (nie je v `datedKeys`).
  const unreadable = invalidCaseDates(model.tasks);
  // Otvorené úlohy bez tých, ktoré už sú v „Termínoch z prípadov“ (N-A5-9); úloha aplikácie s dátumom tam nie je,
  // preto ostane v Otvorených úlohách.
  const datedKeys = new Set(caseOnly.map((d) => d.key));
  // Úloha s nečitateľným dátumom (na kontrolu) nesmie skončiť za „+N ďalšie“: ide pred ostatné (review N-A5-9).
  const otherTasks = model.tasks.filter((task) => !datedKeys.has(task.key))
    .sort((a, b) => Number(Boolean(taskDue(b.due).invalid)) - Number(Boolean(taskDue(a.due).invalid)));
  const pressing = caseOnly.find((d) => d.daysLeft <= 7);
  const dateParams = (d: CaseDate) => ({ title: d.title, when: caseDateWhen(d, locale, text) });
  const lead = !first || thisWeek.length === 0
    ? evidence && !evidence.complete ? text("hero_partial")
      : evidence && evidence.recorded === 0 ? caseOnly[0] ? text("hero_unrecorded_dates", dateParams(caseOnly[0])) : text("hero_unrecorded")
      // #242: počet prípadov bez evidovaných lehôt nezmizne kvôli termínu; termín sa pridá ako druhá veta.
      : evidence && evidence.unrecorded > 0 ? [text("hero_calm_partial", { count: evidence.unrecorded }), ...(pressing ? [text("hero_date_line", dateParams(pressing))] : [])].join(" ")
      : pressing ? text("hero_calm_dates", dateParams(pressing))
      : text("hero_calm")
    : first.invalid ? text("hero_invalid", { title: deadlineText(first) })
    : first.tier === "overdue" ? text("hero_overdue", { title: deadlineText(first) })
    : text("hero_next", { title: deadlineText(first), when: dueTextFromDays(first.daysLeft, locale) });
  return (
    <div className="lw-today" data-lawoss-lite="today">
      <header className="lw-today-hero" style={reveal(0)}>
        <div className="lw-today-hero-copy">
          <p className="lw-today-date">{longDate(todayIso, locale)}{meta ? <LiveStamp meta={meta} locale={locale} /> : null}</p>
          <h1 className="lw-today-greeting">{text(greetingKey(now.getHours()))}{name ? <span className="lw-today-name">, {name}</span> : null}</h1>
          <p className="lw-today-lead">{lead}</p>
        </div>
        <div className="lw-today-actions">
          {events ? <ModeSwitch mode={mode} onChange={setMode} locale={locale} /> : null}
          <NewMatterAction className="lw-today-primary" locale={locale} choices={choices} activeId={activeId} preferenceScope={preferenceScope}>+ {text("new_matter")}</NewMatterAction>
        </div>
        <dl className="lw-today-stats">
          <Stat icon={<CalendarClock aria-hidden size={18} />} label={text("stat_week")} sub={text("stat_week_sub")} value={thisWeek.length} hot={thisWeek.some((d) => urgency(d, todayIso) === "hot")} />
          <Stat icon={<ListChecks aria-hidden size={18} />} label={text("tasks_title")} sub={text("stat_tasks_sub", { count: dates.length })} value={model.tasks.length} />
          <Stat icon={<Inbox aria-hidden size={18} />} label={text("inputs_title")} sub={text("stat_inputs_sub")} value={model.inputs.length} />
        </dl>
      </header>

      {month && events ? <div className="lw-today-month" style={reveal(1)}>
        <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="full" aside={<CandidatesPanel events={events} locale={locale} />} />
      </div> : <>
      <div className="lw-today-grid">
        <div className="lw-today-side">
        <StartHereCard start={startHere(model.deadlines, dates)} lead={lead} todayIso={todayIso} locale={locale} text={text} />
        <Panel index={2} icon={<CalendarClock aria-hidden size={16} />} title={text("deadlines_title")} className="lw-today-deadlines">
          {evidence && evidence.complete && evidence.recorded > 0 && evidence.unrecorded > 0
            ? <Callout data="partial">{text("deadlines_partial_note", { count: evidence.unrecorded })}</Callout> : null}
          {model.deadlines.length === 0 ? evidence && !evidence.complete
            ? <Callout data="not_loaded">{text("deadlines_not_loaded")}</Callout>
            : evidence && evidence.recorded === 0
            ? dates.length || unreadable.length ? <Callout data="unrecorded_dates">{text("deadlines_unrecorded_dates")} {text("deadlines_unrecorded_hint")}</Callout>
              : <Callout data="unrecorded">{text("deadlines_unrecorded")} {text("deadlines_unrecorded_hint")}</Callout>
            : <Empty text={text("deadlines_empty")} /> : <ul className="lw-today-list">
            {model.deadlines.map((d, index) => (
              <li key={`${d.matter.path}/${deadlineKey(d, index)}`}>
                <Link className="lw-today-deadline" data-urgency={urgency(d, todayIso)} to={d.invalid ? liteMatterLink(d.matter.path) : liteDeadlineLink(d.matter.path, d.recordId, d.date)}>
                  <span className="lw-today-cal" aria-hidden>
                    <span>{d.invalid ? "?" : weekdayShort(d.date, locale)}</span>
                    <strong>{d.invalid ? "!" : dayOfMonth(d.date)}</strong>
                  </span>
                  <span className="lw-today-main">
                    <span className="lw-today-title" title={deadlineText(d)}>{deadlineText(d)}</span>
                    <small>{isOfficeFile(d.file) ? text("scope_office") : matterList([d.matter, ...(d.alsoIn ?? [])], text)}
                      {d.invalid ? <span className="lw-today-raw">{d.raw ?? d.date}</span> : d.matter.matterRef && !isOfficeFile(d.file) ? <span className="lw-today-ref">{d.matter.matterRef}</span> : null}</small>
                  </span>
                  <span className="lw-today-when"><span className="lw-today-date-short">{d.invalid ? "?" : formatDay(d.date, locale)}</span><span className="lw-today-due">{dueTextFromDays(d.tier === "overdue" ? -1 : d.daysLeft, locale, d.invalid)}</span></span>
                </Link>
              </li>
            ))}
          </ul>}
          <CaseDates dates={caseOnly} invalid={unreadable} todayIso={todayIso} locale={locale} text={text} onMore={events ? () => setMode("month") : undefined} />
        </Panel>
        </div>

        <div className="lw-today-side">
          {events ? <div style={reveal(3)}><MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="compact" /></div> : null}
          {/* Rozhodnutie MČ 23. 10. 2026 (N-A3-2): len počet dokumentov mimo prípadov a odkaz na podrobný zoznam. */}
          <Panel index={3} icon={<Inbox aria-hidden size={16} />} title={text("inputs_title")}>
            {model.inputs.length === 0 ? <Empty text={text("inputs_empty")} done /> : <Link className="lw-today-input" to={LITE_INPUTS_PATH} data-lawoss-inputs-count={model.inputs.length}>
              <span className="lw-no">{model.inputs.length}</span>
              <span className="lw-today-main">
                <span className="lw-today-title">{text("inputs_outside")}</span>
                <small>{text("inputs_open_list")}</small>
              </span>
            </Link>}
          </Panel>
          <Panel index={4} icon={<ListChecks aria-hidden size={16} />} title={text("tasks_title")}>
            {/* N-A5-9: úlohy s termínom do 14 dní sú v „Termínoch z prípadov“; tu ostatné, nie ten istý zoznam druhýkrát. */}
            {model.tasks.length === 0 ? <Empty text={text("tasks_empty")} /> : otherTasks.length === 0 ? <Empty text={text("tasks_all_dated")} /> : <ul className="lw-today-list">
              {otherTasks.slice(0, LIST_ROWS).map((task) => { const due = taskDueView(task.due, todayIso, locale); return (
                <li key={task.key} className="lw-today-task">
                  <span className="lw-today-ring" aria-hidden />
                  <span className="lw-today-main">
                    <span className="lw-today-title" title={task.title}>{task.title}</span>
                    <small>{task.app ? <Link to={taskLink(task)} onClick={openAppTask(task.id)}>{taskPlace(task, text)}</Link> : task.matters.slice(0, MATTERS_SHOWN).map((m, i) => (
                      <span key={m.path}>{i > 0 ? " · " : ""}<Link to={liteMatterLink(m.path)}>{m.client ? `${m.client} – ${m.title}` : m.title}</Link></span>
                    ))}{task.matters.length > MATTERS_SHOWN ? <span> · {text("more_items", { count: task.matters.length - MATTERS_SHOWN })}</span> : null}</small>
                  </span>
                  {due ? <span className="lw-today-chip" data-urgency={due.urgency}>
                    {due.label}{due.flag === "overdue" ? ` · ${text("overdue")}` : due.flag === "invalid" ? ` · ${text("due_invalid")}` : ""}
                  </span> : null}
                </li>
              ); })}
              {otherTasks.length > LIST_ROWS ? <li className="lw-today-more" data-lawoss-more="tasks">{text("more_items", { count: otherTasks.length - LIST_ROWS })}</li> : null}
            </ul>}
          </Panel>

        </div>
      </div>

      <DeadlineStrip deadlines={model.deadlines} tasks={model.tasks} todayIso={todayIso} locale={locale} text={text} />

      {model.recent.length > 0 ? <section className="lw-today-matters" style={reveal(5)} aria-label={text("matters_title")}>
        <h2 className="lw-today-section-title"><FolderOpen aria-hidden size={16} />{text("matters_title")}</h2>
        <div className="lw-today-cards">
          {model.recent.slice(0, MATTER_CARDS).map((matter) => {
            const next = nextDeadline(matter.deadlines, todayIso);
            // N-A5-9: bez nadchádzajúcej lehoty ukáže najbližší pracovný termín prípadu (len úlohu, nikdy zmeškanú lehotu
            // ako pracovný termín); lehoty a termíny ostávajú oddelené (N-A2-11).
            const work = next ? undefined : nextWorkDate(matter, todayIso);
            return (
              <Link key={matter.path} className="lw-today-card" to={liteMatterLink(matter.path)}>
                <span className="lw-today-card-top">
                  <span className="lw-today-title">{matter.title}</span>
                  <ArrowUpRight aria-hidden size={15} className="lw-today-card-arrow" />
                </span>
                {matter.matterRef ? <span className="lw-today-ref">{matter.matterRef}</span> : null}
                <span className="lw-today-card-meta">
                  <span><small>{text(work ? "next_term_title" : "next_deadline")}</small>{next ? formatDay(next, locale) : work ? `${formatDay(work, locale)} · ${text("agenda_kind_work")}` : text("no_next_deadline")}</span>
                  <span><small>{text("tasks_short")}</small>{matter.openTasks.length}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section> : null}
      </>}

    </div>
  );
}

/** Jeden dominantný ďalší krok (spec 0020); bez lehoty či termínu rovnaká veta ako úvod, s jej výhradami. */
function StartHereCard({ start, lead, todayIso, locale, text }: { start: StartHere | null; lead: string; todayIso: string; locale: Language; text: Text }) {
  const body = start?.kind === "deadline"
    ? { title: deadlineText(start.item), kind: text("agenda_kind_deadline"), matters: isOfficeFile(start.item.file) ? text("scope_office") : matterList([start.item.matter, ...(start.item.alsoIn ?? [])], text),
      when: `${formatDay(start.item.date, locale)} · ${dueTextFromDays(start.item.tier === "overdue" ? -1 : start.item.daysLeft, locale)}`, urgency: urgency(start.item, todayIso),
      to: liteDeadlineLink(start.item.matter.path, start.item.recordId, start.item.date) }
    : start?.kind === "work"
    ? { title: start.item.title, kind: text("agenda_kind_work"), matters: taskPlace(start.item, text),
      when: `${formatDay(start.item.due, locale)} · ${caseDateWhen(start.item, locale, text)}`, urgency: urgencyOf(start.item.due, todayIso),
      to: taskLink(start.item), onClick: start.item.app ? openAppTask(start.item.id) : undefined }
    : null;
  return <section className="lw-today-panel lw-today-start" style={reveal(2)} data-lawoss-start={start?.kind ?? "none"} data-urgency={body?.urgency}>
    <p className="lw-today-start-label">{text("start_title")}{body ? <span>{body.kind}</span> : null}</p>
    {body ? <>
      <h2 className="lw-today-start-title">{body.title}</h2>
      <p className="lw-today-start-meta">{body.matters}</p>
      <div className="lw-today-start-foot">
        <span className="lw-today-start-when"><Clock aria-hidden size={14} />{body.when}</span>
        <Link className="lw-today-primary lw-today-start-open" to={body.to} onClick={"onClick" in body ? body.onClick : undefined}>{text("start_open")}<ArrowRight aria-hidden size={15} /></Link>
      </div>
    </> : <p className="lw-today-start-meta">{lead}</p>}
  </section>;
}

/** Termíny z prípadov pod lehotami: vlastný nadpis a veta, že nejde o evidované lehoty (N-A2-11). */
function CaseDates({ dates, invalid = [], todayIso, locale, text, onMore }: { dates: readonly CaseDate[]; invalid?: readonly TodayTask[]; todayIso: string; locale: Language; text: Text; onMore?: () => void }) {
  if (!dates.length && !invalid.length) return null;
  return <div className="lw-today-case-dates" data-lawoss-case-dates="">
    <h3 className="lw-today-subtitle">{text("case_dates_title")}<Info aria-hidden size={13} className="lw-today-subtitle-info" /></h3>
    <p className="lw-today-note">{text("case_dates_note")}</p>
    <ul className="lw-today-list">
      {/* N-A7-4: neplatný dátum vždy a navrchu („? 31. 2. 2026 · overiť dátum“), mimo počtu riadkov, ako v Lehotách. */}
      {invalid.map((d) => (
        <li key={d.key}>
          <Link className="lw-today-deadline" data-urgency="hot" data-kind="case-date" data-invalid="" to={taskLink(d)}>
            <span className="lw-today-cal" aria-hidden><span>?</span><strong>!</strong></span>
            <span className="lw-today-main">
              <span className="lw-today-title" title={d.title}>{d.title}</span>
              <small>{taskPlace(d, text)}</small>
            </span>
            <span className="lw-today-when"><span className="lw-today-date-short">{taskDueView(d.due, todayIso, locale)?.label ?? "?"}</span><span className="lw-today-due">{text("due_invalid")}</span></span>
          </Link>
        </li>
      ))}
      {caseDateRows(dates, LIST_ROWS).map((d) => (
        <li key={d.key}>
          <Link className="lw-today-deadline" data-urgency={urgencyOf(d.due, todayIso)} data-kind="case-date" to={taskLink(d)} onClick={d.app ? openAppTask(d.id) : undefined}>
            <span className="lw-today-cal" aria-hidden><span>{weekdayShort(d.due, locale)}</span><strong>{dayOfMonth(d.due)}</strong></span>
            <span className="lw-today-main">
              <span className="lw-today-title" title={d.title}>{d.title}</span>
              <small>{taskPlace(d, text)}</small>
            </span>
            <span className="lw-today-when"><span className="lw-today-date-short">{formatDay(d.due, locale)}</span><span className="lw-today-due">{caseDateWhen(d, locale, text)}</span></span>
          </Link>
        </li>
      ))}
      {/* Ďalšie termíny sú v mesiaci: „+N ďalšie“ ho otvorí (review N-A5-9). */}
      {dates.length > LIST_ROWS ? <li className="lw-today-more" data-lawoss-more="case-dates">{onMore
        ? <button type="button" className="lw-today-more-link" onClick={onMore}>{text("more_items", { count: dates.length - LIST_ROWS })}</button>
        : text("more_items", { count: dates.length - LIST_ROWS })}</li> : null}
    </ul>
  </div>;
}

/** Kedy je termín: uplynulý termín nie je „po lehote“ (lehota je evidovaná zvlášť), inak „zajtra“, „o 5 dní“. */
function caseDateWhen(d: CaseDate, locale: Language, text: Text): string {
  return d.daysLeft < 0 ? text("case_date_passed") : dueTextFromDays(d.daysLeft, locale);
}

/** Číslo prehľadu ako v návrhu 0020: ikona, veľké číslo, názov a vysvetlenie pod ním. */
function Stat({ icon, label, sub, value, hot = false }: { icon: ReactNode; label: string; sub: string; value: number; hot?: boolean }) {
  // Názov pred číslom kvôli čítačke obrazovky; vizuálne ide ikona s číslom prvá (CSS order).
  return <div className="lw-today-stat" data-hot={hot || undefined}>
    <dt>{label}<small>{sub}</small></dt>
    <dd><span className="lw-today-stat-icon">{icon}</span>{value}</dd>
  </div>;
}

/** Krátka poznámka s ikonou namiesto odseku textu (prázdne alebo neúplné lehoty). */
function Callout({ data, children }: { data: string; children: ReactNode }) {
  return <p className="lw-today-callout" data-lawoss-deadlines={data}><Info aria-hidden size={15} /><span>{children}</span></p>;
}

function Panel({ index, icon, title, className, children }: { index: number; icon: ReactNode; title: string; className?: string; children: ReactNode }) {
  return <section className={`lw-today-panel${className ? ` ${className}` : ""}`} style={reveal(index)}>
    <h2 className="lw-today-section-title">{icon}{title}</h2>
    {children}
  </section>;
}

function Empty({ text, done = false }: { text: string; done?: boolean }) {
  return <p className="lw-today-empty">{done ? <Check aria-hidden size={15} /> : null}{text}</p>;
}

/**
 * Jeden diagram, který nese informaci: 14 dní, dnešek, lhůty jako body podle naléhavosti. Úlohy ukáže ako termíny
 * z prípadov (`caseDates`, #251) na Dnes aj na Domove klienta: záznam s lehotou v ten istý deň nie je dvakrát.
 */
export function DeadlineStrip({ deadlines, tasks, todayIso, locale, text }: { deadlines: readonly TodayDeadline[]; tasks: readonly TodayTask[]; todayIso: string; locale: Language; text: Text }) {
  const dates = caseDates(tasks, todayIso, STRIP_DAYS, deadlines);
  const overdue = deadlines.filter((d) => !d.invalid && d.tier === "overdue");
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(todayIso, i));
  const cells: { key: string; label: string; day: string; items: TodayDeadline[]; due: TodayTask[]; today?: boolean; weekend?: boolean; overdue?: boolean }[] = [
    ...(overdue.length ? [{ key: "overdue", label: text("overdue"), day: "!", items: overdue, due: [], overdue: true }] : []),
    ...days.map((iso, i) => ({
      key: iso,
      label: i === 0 ? text("strip_today") : weekdayShort(iso, locale),
      day: String(dayOfMonth(iso)),
      items: deadlines.filter((d) => !d.invalid && d.date === iso),
      due: dates.filter((date) => date.due === iso),
      today: i === 0,
      weekend: isWeekend(iso),
    })),
  ];
  return (
    <section className="lw-today-strip" style={reveal(1)} aria-label={text("strip_title")}>
      <h2 className="lw-today-section-title">{text("strip_title")}</h2>
      <ol className="lw-today-days">
        {cells.map((cell) => {
          const hidden = Math.max(0, cell.items.length - STRIP_DOTS) + Math.max(0, cell.due.length - STRIP_TASK_DOTS);
          const tips = [
            ...cell.items.map((d, i) => <span key={`${d.matter.path}/${deadlineKey(d, i)}`}><b>{deadlineText(d)}</b>{d.matter.title}</span>),
            ...cell.due.map((task) => <span key={task.key} data-kind="task"><b>{task.title}</b>{task.app ? taskPlace(task, text) : task.matters.map((m) => m.title).join(" · ")}</span>),
          ];
          const body = <>
            <span className="lw-today-dow">{cell.label}</span>
            <span className="lw-today-dom">{cell.day}</span>
            <span className="lw-today-dots" aria-hidden>
              {cell.items.slice(0, STRIP_DOTS).map((d, i) => <i key={`${d.matter.path}/${deadlineKey(d, i)}`} data-urgency={urgency(d, todayIso)} />)}
              {cell.due.slice(0, STRIP_TASK_DOTS).map((task) => <i key={task.key} data-kind="task" />)}
              {hidden > 0 ? <em className="lw-today-dots-more">+{hidden}</em> : null}
            </span>
            {tips.length ? <span className="lw-today-tip" role="tooltip">
              {tips.slice(0, TIP_ITEMS)}
              {tips.length > TIP_ITEMS ? <span className="lw-today-tip-more">{text("more_items", { count: tips.length - TIP_ITEMS })}</span> : null}
            </span> : null}
          </>;
          const lead = cell.items[0];
          const target = lead ? liteDeadlineLink(lead.matter.path, lead.recordId, lead.date) : cell.due[0] && (cell.due[0].app || cell.due[0].matters[0]) ? taskLink(cell.due[0]) : undefined;
          const open = !lead && cell.due[0]?.app ? openAppTask(cell.due[0].id) : undefined;
          const names = [...cell.items.map(deadlineText), ...cell.due.map((task) => task.title)];
          return (
            <li key={cell.key} className="lw-today-day" data-today={cell.today || undefined} data-weekend={cell.weekend || undefined} data-overdue={cell.overdue || undefined} data-busy={names.length > 0 || undefined}>
              {target ? <Link to={target} onClick={open} aria-label={`${cell.label} ${cell.day}: ${names.join(", ")}`}>{body}</Link> : <span>{body}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Najbližší pracovný termín prípadu (úloha s platným dátumom dnes alebo neskôr). */
function nextWorkDate(matter: Pick<MatterOverview, "openTasks">, todayIso: string): string | undefined {
  return matter.openTasks.map((task) => task.due?.trim().slice(0, 10) ?? "").filter((due) => isCalendarDay(due) && due >= todayIso).sort()[0];
}

/** Kde úloha patrí: prípady úlohy z pamäte, pri úlohe aplikácie jej klient (N-A5-4). */
function taskPlace(task: Pick<TodayTask, "matters" | "app">, text: Text): string {
  return task.app ? task.app.client ? `${text("app_task")} · ${task.app.client}` : text("app_task") : matterList(task.matters, text);
}

function matterList(matters: readonly { title: string; client?: string }[], text: Text): string {
  // N-A5-9: „Klient – prípad“, aby riadok bez mena klienta nebol „zákazka SYN-00xx“ bez súvislosti.
  const shown = matters.slice(0, MATTERS_SHOWN).map((m) => m.client ? `${m.client} – ${m.title}` : m.title).join(" · ");
  return matters.length > MATTERS_SHOWN ? `${shown} · ${text("more_items", { count: matters.length - MATTERS_SHOWN })}` : shown;
}
