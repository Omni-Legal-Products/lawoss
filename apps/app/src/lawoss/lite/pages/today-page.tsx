/** @jsxImportSource react */
import type { CSSProperties, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarClock, Check, FolderOpen, Inbox, ListChecks } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { addDays, formatDay, today, useOkfConnection, type OkfReadResult } from "../../okf/read-model";
import { deadlineText, urgencyOf, type Urgency } from "../../okf/view-rules";
import { buildToday, nextDeadline, type TodayDeadline, type TodayModel, type TodayTask } from "../today-model";
import { LITE_CLIENTS_PATH, liteDeadlineLink, liteMatterLink, NEW_MATTER_PATH } from "../links";
import { hotDeadlineCount, LiveStamp, useHotTitle } from "../live";
import "./okf-glass.css";
import "./today.css";

const STRIP_DAYS = 14;
const WEEK_DAYS = 7;
const MATTER_CARDS = 6;

export function TodayPage() {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  // Meno z onboardingu do pozdravu; bez neho ostáva pozdrav bez mena.
  const profile = useQuery({
    queryKey: ["lawoss-lawyer-name", connection?.baseUrl ?? ""],
    enabled: Boolean(connection?.client),
    retry: false,
    staleTime: 5 * 60_000,
    queryFn: async () => (await connection?.client?.onboardingStatus())?.profile?.lawyerName ?? "",
  });
  return <OkfPage {...litePageProps(locale)}>
    {(data, meta) => <TodayLive data={data} meta={meta} locale={locale} name={profile.data || undefined} />}
  </OkfPage>;
}

function TodayLive({ data, meta, locale, name }: { data: OkfReadResult; meta: OkfPageMeta; locale: Language; name?: string }) {
  const now = today();
  useHotTitle(hotDeadlineCount(data, now));
  return <TodayView model={buildToday(data, now)} locale={locale} meta={meta} name={name} />;
}

type Text = (key: string, params?: Record<string, string | number>) => string;

function dueLabel(d: TodayDeadline, text: Text): string {
  if (d.invalid) return text("due_invalid");
  if (d.tier === "overdue") return text("overdue");
  if (d.daysLeft === 0) return text("due_today");
  if (d.daysLeft === 1) return text("due_tomorrow");
  return text("due_in_days", { count: d.daysLeft }); // _one/_few/_many/_other podle jazyka
}

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
export function TodayView({ model, locale, now = new Date(), meta, name }: { model: TodayModel; locale: Language; now?: Date; meta?: OkfPageMeta; name?: string }) {
  const text: Text = (key, params) => t(`lawoss.lite.${key}`, locale, params);
  const todayIso = today(now);
  const thisWeek = model.deadlines.filter((d) => d.invalid || d.tier === "overdue" || d.daysLeft < WEEK_DAYS);
  const first = model.deadlines[0];
  return (
    <div className="lw-today" data-lawoss-lite="today">
      <header className="lw-today-hero" style={reveal(0)}>
        <div className="lw-today-hero-copy">
          <p className="lw-today-date">{longDate(todayIso, locale)}{meta ? <LiveStamp meta={meta} locale={locale} /> : null}</p>
          <h1 className="lw-today-greeting">{text(greetingKey(now.getHours()))}{name ? <span className="lw-today-name">, {name}</span> : null}</h1>
          <p className="lw-today-lead">{first && thisWeek.length > 0
            ? text("hero_next", { title: deadlineText(first), when: dueLabel(first, text) })
            : text("hero_calm")}</p>
        </div>
        <Link className="lw-today-primary" to={NEW_MATTER_PATH}>+ {text("new_matter")}</Link>
        <dl className="lw-today-stats">
          <Stat label={text("stat_week")} value={thisWeek.length} hot={thisWeek.some((d) => urgency(d, todayIso) === "hot")} />
          <Stat label={text("tasks_title")} value={model.tasks.length} />
          <Stat label={text("inputs_title")} value={model.inputs.length} />
        </dl>
      </header>

      <DeadlineStrip deadlines={model.deadlines} tasks={model.tasks} todayIso={todayIso} locale={locale} text={text} />

      <div className="lw-today-grid">
        <Panel index={2} icon={<CalendarClock aria-hidden size={16} />} title={text("deadlines_title")} className="lw-today-deadlines">
          {model.deadlines.length === 0 ? <Empty text={text("deadlines_empty")} /> : <ul className="lw-today-list">
            {model.deadlines.map((d) => (
              <li key={`${d.matter.path}/${d.recordId}/${d.date}`}>
                <Link className="lw-today-deadline" data-urgency={urgency(d, todayIso)} to={d.invalid ? liteMatterLink(d.matter.path) : liteDeadlineLink(d.matter.path, d.recordId, d.date)}>
                  <span className="lw-today-cal" aria-hidden>
                    <span>{d.invalid ? "?" : weekdayShort(d.date, locale)}</span>
                    <strong>{d.invalid ? "!" : dayOfMonth(d.date)}</strong>
                  </span>
                  <span className="lw-today-main">
                    <span className="lw-today-title">{deadlineText(d)}</span>
                    <small>{[d.matter, ...(d.alsoIn ?? [])].map((m) => m.title).join(" · ")}{d.matter.matterRef ? <span className="lw-today-ref">{d.matter.matterRef}</span> : null}</small>
                  </span>
                  <span className="lw-today-when"><span className="lw-today-date-short">{formatDay(d.date, locale)}</span><span className="lw-today-due">{dueLabel(d, text)}</span></span>
                </Link>
              </li>
            ))}
          </ul>}
        </Panel>

        <div className="lw-today-side">
          <Panel index={3} icon={<Inbox aria-hidden size={16} />} title={text("inputs_title")}>
            {model.inputs.length === 0 ? <Empty text={text("inputs_empty")} done /> : <ul className="lw-today-list">
              {model.inputs.map((input, index) => (
                <li key={`${input.file}/${input.id}/${index}`}>
                  <Link className="lw-today-input" to={input.scope === "client" ? LITE_CLIENTS_PATH : liteMatterLink(input.matterPath)} data-lawoss-scope={input.scope}>
                    <span className="lw-no">{input.id || "-"}</span>
                    <span className="lw-today-main">
                      <span className="lw-today-title">{input.source}</span>
                      <small>{input.original}</small>
                    </span>
                    <span className="lw-today-when"><span className="lw-today-date-short">{formatDay(input.received.slice(0, 10), locale)}</span><span className="lw-today-due">{text(input.scope === "client" ? "inputs_client" : "inputs_file")}</span></span>
                  </Link>
                </li>
              ))}
            </ul>}
          </Panel>
          <Panel index={4} icon={<ListChecks aria-hidden size={16} />} title={text("tasks_title")}>
            {model.tasks.length === 0 ? <Empty text={text("tasks_empty")} /> : <ul className="lw-today-list">
              {model.tasks.map((task) => (
                <li key={task.key} className="lw-today-task">
                  <span className="lw-today-ring" aria-hidden />
                  <span className="lw-today-main">
                    <span className="lw-today-title">{task.title}</span>
                    <small>{task.matters.map((m, i) => (
                      <span key={m.path}>{i > 0 ? " · " : ""}<Link to={liteMatterLink(m.path)}>{m.title}</Link></span>
                    ))}</small>
                  </span>
                  {task.due ? <span className="lw-today-chip" data-urgency={urgencyOf(task.due, todayIso)}>{formatDay(task.due, locale)}</span> : null}
                </li>
              ))}
            </ul>}
          </Panel>

        </div>
      </div>

      {model.recent.length > 0 ? <section className="lw-today-matters" style={reveal(5)} aria-label={text("matters_title")}>
        <h2 className="lw-today-section-title"><FolderOpen aria-hidden size={16} />{text("matters_title")}</h2>
        <div className="lw-today-cards">
          {model.recent.slice(0, MATTER_CARDS).map((matter) => {
            const next = nextDeadline(matter.deadlines, todayIso);
            return (
              <Link key={matter.path} className="lw-today-card" to={liteMatterLink(matter.path)}>
                <span className="lw-today-card-top">
                  <span className="lw-today-title">{matter.title}</span>
                  <ArrowUpRight aria-hidden size={15} className="lw-today-card-arrow" />
                </span>
                {matter.matterRef ? <span className="lw-today-ref">{matter.matterRef}</span> : null}
                <span className="lw-today-card-meta">
                  <span><small>{text("next_deadline")}</small>{next ? formatDay(next, locale) : text("no_next_deadline")}</span>
                  <span><small>{text("tasks_short")}</small>{matter.openTasks.length}</span>
                </span>
              </Link>
            );
          })}
        </div>
      </section> : null}

    </div>
  );
}

function Stat({ label, value, hot = false }: { label: string; value: number; hot?: boolean }) {
  return <div className="lw-today-stat" data-hot={hot || undefined}><dt>{label}</dt><dd>{value}</dd></div>;
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

/** Jeden diagram, který nese informaci: 14 dní, dnešek, lhůty jako body podle naléhavosti. */
function DeadlineStrip({ deadlines, tasks, todayIso, locale, text }: { deadlines: readonly TodayDeadline[]; tasks: readonly TodayTask[]; todayIso: string; locale: Language; text: Text }) {
  const overdue = deadlines.filter((d) => !d.invalid && d.tier === "overdue");
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(todayIso, i));
  const cells: { key: string; label: string; day: string; items: TodayDeadline[]; due: TodayTask[]; today?: boolean; weekend?: boolean; overdue?: boolean }[] = [
    ...(overdue.length ? [{ key: "overdue", label: text("overdue"), day: "!", items: overdue, due: [], overdue: true }] : []),
    ...days.map((iso, i) => ({
      key: iso,
      label: i === 0 ? text("strip_today") : weekdayShort(iso, locale),
      day: String(dayOfMonth(iso)),
      items: deadlines.filter((d) => !d.invalid && d.date === iso),
      due: tasks.filter((task) => task.due === iso),
      today: i === 0,
      weekend: isWeekend(iso),
    })),
  ];
  return (
    <section className="lw-today-strip" style={reveal(1)} aria-label={text("strip_title")}>
      <h2 className="lw-today-section-title">{text("strip_title")}</h2>
      <ol className="lw-today-days">
        {cells.map((cell) => {
          const body = <>
            <span className="lw-today-dow">{cell.label}</span>
            <span className="lw-today-dom">{cell.day}</span>
            <span className="lw-today-dots" aria-hidden>
              {cell.items.slice(0, 3).map((d) => <i key={`${d.matter.path}/${d.recordId}/${d.raw ?? d.date}`} data-urgency={urgency(d, todayIso)} />)}
              {cell.due.slice(0, 2).map((task) => <i key={task.key} data-kind="task" />)}
            </span>
            {cell.items.length + cell.due.length ? <span className="lw-today-tip" role="tooltip">
              {cell.items.map((d) => <span key={`${d.matter.path}/${d.recordId}/${d.raw ?? d.date}`}><b>{deadlineText(d)}</b>{d.matter.title}</span>)}
              {cell.due.map((task) => <span key={task.key} data-kind="task"><b>{task.title}</b>{task.matters.map((m) => m.title).join(" · ")}</span>)}
            </span> : null}
          </>;
          const lead = cell.items[0];
          const target = lead ? liteDeadlineLink(lead.matter.path, lead.recordId, lead.date) : cell.due[0]?.matters[0] ? liteMatterLink(cell.due[0].matters[0].path) : undefined;
          const names = [...cell.items.map(deadlineText), ...cell.due.map((task) => task.title)];
          return (
            <li key={cell.key} className="lw-today-day" data-today={cell.today || undefined} data-weekend={cell.weekend || undefined} data-overdue={cell.overdue || undefined} data-busy={names.length > 0 || undefined}>
              {target ? <Link to={target} aria-label={`${cell.label} ${cell.day}: ${names.join(", ")}`}>{body}</Link> : <span>{body}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
