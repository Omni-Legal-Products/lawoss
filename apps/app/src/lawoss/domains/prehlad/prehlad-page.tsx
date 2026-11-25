/** @jsxImportSource react */
import { deadlineText, dueTextFromDays } from "../../okf/view-rules";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, Clock, Search } from "lucide-react";

import { OkfPage, useMatterText } from "../okf-page";
import {
  formatDay,
  formatLongDay,
  today,
  type OkfReadResult,
} from "../../okf/read-model";
import { matterLink } from "../spis/spis-page";
import { daysBetween, recordKey, type UpcomingDeadline } from "../../../../../../lawoss/okf/read";
import { clientInitials } from "../../lite/client-cards";
import { deadlineTone, matterCards, practiceAlerts, practiceTasks, weekDays, type MatterCard, type PracticeAlert, type PracticeTask } from "../overview-model";
import { AlertBox, CalendarGrid, conclusionText, DayCount, DayItems, riskText, Trust, type MatterText } from "../overview-views";
import "../overview.css";

/** Kalendár praxe: tri týždne od pondelka; v dni najviac tri položky, zvyšok „+N ďalšie“. */
const CALENDAR_WEEKS = 3;
const DAY_ITEMS = 3;

/** Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. */
export function PrehladPage() {
  const { text } = useMatterText();
  return <OkfPage title={text("overview")}>{(data) => <RealOverview data={data} />}</OkfPage>;
}

/**
 * Prehľad praxe (variant A, MČ 25. 11. 2026): čísla v riadku, upozornenia, kalendár troch týždňov a karta za každý
 * prípad s klientom, najbližšou lehotou, overením, fázou, ďalším krokom a preverením. Nič sa nedopočítava.
 */
export function RealOverview({ data }: { data: OkfReadResult }) {
  const { locale, text } = useMatterText();
  const now = today();
  const dueToday = data.upcomingDeadlines.filter((d) => d.date === now).length;
  // Stejná totožnost jako v součtu úkolů: sdílený soubor = jedna úloha.
  const withDue = new Set(data.matters.flatMap((m) => m.openTasks.filter((t) => t.due).map((t) => recordKey(m.path, t)))).size;
  const t = data.totals;
  const alerts = practiceAlerts(data, now);
  const cards = matterCards(data, now);
  const tasks = practiceTasks(data.matters, now);
  const nextUp = data.upcomingDeadlines.find((d) => !d.invalid);

  return (
    <div className="lw-x lw-po">
      <p className="lw-lead">
        {text("summary", { date: formatLongDay(now, locale), matters: text("matters", { count: t.matters }),
          deadlines: text("deadlines", { count: t.deadlinesWithin7Days }), tasks: text("openTasksCount", { count: t.openTasks }) })}
      </p>

      <div className="lw-po-stats" data-lawoss-practice-stats="">
        <div><span>{text("activeMatters")}</span><b>{t.matters}</b>{data.truncated ? <small>{text("firstShown", { count: t.matters })}</small> : null}</div>
        <div data-warn={t.deadlinesWithin7Days > 0 || undefined}><span>{text("deadlines7")}</span><b>{t.deadlinesWithin7Days}</b>
          <small>{dueToday > 0 ? text("todayCount", { count: dueToday }) : t.overdue > 0 ? text("overdueCount", { count: t.overdue }) : text("noneToday")}</small></div>
        <div><span>{text("openTasks")}</span><b>{t.openTasks}</b><small>{text("withDue", { count: withDue })}</small></div>
        <div data-warn={data.problems.length > 0 || undefined}><span>{text("memoryRecords")}</span><b>{t.records}</b>
          <small>{data.problems.length > 0 ? text("unreadableCount", { count: data.problems.length }) : text("allReadable")}</small></div>
      </div>

      <section className="lw-x-section" aria-label={text("alertsTitle")} data-lawoss-practice-alerts={alerts.length}>
        <div className="lw-x-alerts">
          {alerts.length > 0 ? alerts.map((alert) => <PracticeAlertView key={alertKey(alert)} alert={alert} now={now} locale={locale} text={text} />) : <>
            <AlertBox tone="ok" icon="ok" title={text("alert.clearTitle")} detail={text("alert.clearPractice")} data-lawoss-practice-clear="" />
            {nextUp ? <Link className="lw-x-alert" data-tone="ok" to="/lehoty" data-lawoss-next-up="">
              <AlertInner icon="clock" title={`${text("nextUp")}: ${deadlineText(nextUp)}`}
                detail={`${dueTextFromDays(daysBetween(now, nextUp.date), locale)} · ${formatDay(nextUp.date, locale)} · ${nextUp.matter.title}`} />
            </Link> : null}
          </>}
        </div>
      </section>

      <section className="lw-x-panel lw-x-section" aria-labelledby="lw-po-calendar">
        <h2 id="lw-po-calendar" className="lw-x-h2">{text("calendarTitle")}<small>{text("calendarNote")} · <Link to="/lehoty">{text("fullRegister")}</Link></small></h2>
        <PracticeCalendar deadlines={[...data.overdue, ...data.upcomingDeadlines]} tasks={tasks} now={now} locale={locale} text={text} />
        <Legend text={text} keys={["hot", "soon", "later", "confirmed", "task", "weekend"]} />
      </section>

      <section className="lw-x-section" aria-labelledby="lw-po-cards">
        <h2 id="lw-po-cards" className="lw-x-h2" style={{ marginTop: 26 }}>{text("clientsTitle")}<small>{text("clientsNote")}</small></h2>
        <div className="lw-po-cards">{cards.map((card) => <MatterCardView key={card.matter.path} card={card} now={now} locale={locale} text={text} />)}</div>
      </section>

      {data.problems.length > 0 ? (
        <div className="lw-status warn">
          {text("filesUnreadable", { count: data.problems.length })}:{" "}
          {data.problems.slice(0, 3).map((p) => p.path).join(", ")}
          {data.problems.length > 3 ? ", …" : ""}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          {text("localReadOnly")}
        </span>
        <span>
          {text("assistantNote")}
        </span>
      </div>
    </div>
  );
}

type Text = MatterText;
type Locale = ReturnType<typeof useMatterText>["locale"];

const alertKey = (alert: PracticeAlert): string => alert.kind === "overdueDeadlines" ? "overdue"
  : alert.kind === "deadline" ? `d:${alert.deadline.matter.path}/${alert.deadline.recordId}/${alert.deadline.raw ?? alert.deadline.date}`
  : alert.kind === "task" ? `t:${alert.task.key}` : `s:${alert.matter.path}/${alert.screening.id}`;

function PracticeAlertView({ alert, now, locale, text }: { alert: PracticeAlert; now: string; locale: Locale; text: Text }) {
  // Názov prípadu, ktorý už meno klienta obsahuje, ho neopakuje.
  const where = (title: string, client?: string) => (client && !title.startsWith(client) ? `${client} · ${title}` : title);
  switch (alert.kind) {
    case "overdueDeadlines":
      return <Link to="/lehoty" className="lw-x-alert" data-tone="red" data-lawoss-alert="overdue">
        <AlertInner icon="clock" title={text("overdueSummary", { deadlines: text("deadlines", { count: alert.count }) })} detail={text("checkRegister")} />
      </Link>;
    case "deadline": {
      const d = alert.deadline;
      return <Link to="/lehoty" className="lw-x-alert" data-tone="red" data-lawoss-alert="deadline">
        <AlertInner icon="clock" title={text("alert.deadlineDue", { when: dueTextFromDays(daysBetween(now, d.date), locale), title: deadlineText(d) })}
          detail={<>{where(d.matter.title, alert.client)}{d.matter.matterRef ? ` · ${d.matter.matterRef}` : ""} · <Trust confirmed={Boolean(d.confirmed)} locale={locale} text={text} /></>} />
      </Link>;
    }
    case "task":
      return <Link to={matterLink(alert.task.matter.path)} className="lw-x-alert" data-tone="red" data-lawoss-alert="task">
        <AlertInner icon="task" title={text("alert.taskOverdue", { date: formatDay(alert.task.due, locale), title: alert.task.title })}
          detail={`${where(alert.task.matter.title, alert.client)}${alert.task.assignee ? ` · ${alert.task.assignee}` : ""}`} />
      </Link>;
    case "screening": {
      const s = alert.screening;
      return <Link to={matterLink(alert.matter.path)} className="lw-x-alert" data-tone="amber" data-lawoss-alert="screening">
        <AlertInner icon="search" title={text("screening.title", { subject: s.subject ?? s.title })}
          detail={<>{where(alert.matter.title, alert.client)}{s.registries.length ? ` · ${s.registries.join(" · ")}` : ""}</>}
          tags={<>{s.risk ? <span className="lw-x-pill" data-tone="amber">{text("screening.risk", { value: riskText(s.risk, text) })}</span> : null}
            {s.conclusion ? <span className="lw-x-pill" data-tone="line">{text("screening.conclusion", { value: conclusionText(s.conclusion, text) })}</span> : null}</>} />
      </Link>;
    }
  }
}

function AlertInner({ icon, title, detail, tags }: { icon: "clock" | "task" | "search"; title: string; detail?: ReactNode; tags?: ReactNode }) {
  const Icon = icon === "search" ? Search : icon === "clock" ? Clock : AlertTriangle;
  return <>
    <span className="lw-x-alert-icon"><Icon aria-hidden size={16} /></span>
    <span className="lw-x-alert-body"><b>{title}</b>{detail ? <span>{detail}</span> : null}{tags ? <span className="lw-x-alert-tags">{tags}</span> : null}</span>
  </>;
}

function PracticeCalendar({ deadlines, tasks, now, locale, text }: { deadlines: readonly UpcomingDeadline[]; tasks: readonly PracticeTask[]; now: string; locale: Locale; text: Text }) {
  const days = weekDays(now, CALENDAR_WEEKS);
  return <CalendarGrid days={days} locale={locale} todayLabel={text("today")} label={text("calendarTitle")} renderDay={(day) => <DayItems max={DAY_ITEMS}
    more={(count) => text("calendarMore", { count })}
    items={[
      ...deadlines.filter((d) => !d.invalid && d.date === day.iso).map((d) => <Link key={`d/${d.matter.path}/${d.recordId}/${d.raw ?? d.date}`} to="/lehoty" className="lw-x-ev"
        data-kind="deadline" data-tone={deadlineTone(d.date, now)} data-confirmed={d.confirmed || undefined} title={`${deadlineText(d)} · ${d.matter.title}`}>
        <span>{deadlineText(d)}</span><small>{d.matter.title}{d.confirmed ? ` · ${text("provenance.verified")}` : ""}</small>
      </Link>),
      ...tasks.filter((task) => task.due === day.iso).map((task) => <Link key={`t/${task.key}`} to={matterLink(task.matter.path)} className="lw-x-ev" data-kind="task"
        data-tone={task.overdue ? "overdue" : undefined} title={`${task.title} · ${task.matter.title}`}>
        <span>{task.title}</span><small>{text("legend.task")} · {task.matter.title}</small>
      </Link>),
    ]} />} />;
}

/** Tituly pred menom (Ing., JUDr., Mgr. …) nie sú meno: iniciály „Ing. Petra Kováčová“ sú PK, „Novák s. r. o.“ ostáva NS. */
const withoutTitles = (name: string): string => {
  const words = name.trim().split(/\s+/);
  const first = words.findIndex((word) => !/^\p{L}{2,}\.,?$/u.test(word));
  return first > 0 ? words.slice(first).join(" ") : name;
};

type LegendKey = "hot" | "soon" | "later" | "confirmed" | "task" | "weekend";
const LEGEND = { hot: "legend.hot", soon: "legend.soon", later: "legend.later", confirmed: "legend.confirmed", task: "legend.task", weekend: "legend.weekend" } as const;

export function Legend({ text, keys }: { text: Text; keys: readonly LegendKey[] }) {
  return <div className="lw-x-legend">{keys.map((key) => <span key={key} data-key={key}><i aria-hidden />{text(LEGEND[key])}</span>)}</div>;
}

function MatterCardView({ card, now, locale, text }: { card: MatterCard; now: string; locale: Locale; text: Text }) {
  const { matter, nearest, status, screening, client } = card;
  const tone = nearest ? deadlineTone(nearest.date, now) : undefined;
  const urgent = card.overdueTasks > 0 || tone === "overdue" || tone === "hot";
  const who = client ?? matter.title;
  const meta = [matter.matterRef, matter.court].filter(Boolean).join(" · ");
  return <Link to={matterLink(matter.path)} className="lw-x-panel lw-po-card" data-urgent={urgent || undefined} data-lawoss-matter-card={matter.path}>
    <span className="lw-po-card-top">
      <span className="lw-po-initials" aria-hidden>{clientInitials(withoutTitles(who)) || "·"}</span>
      <span className="lw-po-who"><b title={who}>{who}</b>{client ? <span title={matter.title}>{matter.title}</span> : null}</span>
    </span>
    <span className="lw-po-term">
      {nearest && tone ? <>
        <DayCount date={nearest.date} todayIso={now} tone={tone} text={text} overdueLabel={text("overdue")} todayLabel={text("today")} />
        <span className="lw-po-term-text">
          <b title={deadlineText(nearest)}>{deadlineText(nearest)}</b>
          <span>{formatDay(nearest.date, locale)}<Trust confirmed={Boolean(nearest.confirmed)} locale={locale} text={text} /></span>
        </span>
      </> : <span className="lw-po-term-text"><b>{text("noDeadline")}</b></span>}
    </span>
    {status.phase ? <span className="lw-po-phase" title={status.phase}>{status.phase}</span> : null}
    {status.nextStep ? <span className="lw-po-next"><ArrowRight aria-hidden size={13} />{status.nextStep}</span> : null}
    <span className="lw-po-last" title={matter.lastEvent?.text}>{text("lastEvent")}: {matter.lastEvent ? `${formatDay(matter.lastEvent.date, locale)} · ${matter.lastEvent.text}` : text("noHistoryEvent")}</span>
    <span className="lw-po-foot">
      <span className="lw-x-pill" data-tone={card.overdueTasks > 0 ? "red" : undefined}>
        {text("tasksCount", { count: matter.openTasks.length })}{card.overdueTasks > 0 ? ` · ${text("overdueCount", { count: card.overdueTasks })}` : ""}
      </span>
      {screening?.risk ? <span className="lw-x-pill" data-tone="amber"><Search aria-hidden size={12} />{text("screening.risk", { value: riskText(screening.risk, text) })}</span> : null}
      {matter.state ? <span className="lw-x-pill" data-tone="line">{matter.state}</span> : null}
      {meta ? <span className="lw-po-ref" title={meta}>{meta}</span> : null}
    </span>
  </Link>;
}
