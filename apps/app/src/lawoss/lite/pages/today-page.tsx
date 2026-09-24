/** @jsxImportSource react */
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { OkfPage } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { dayClass, formatDay, today } from "../../okf/read-model";
import { buildToday, type TodayDeadline, type TodayModel } from "../today-model";
import { liteMatterLink, NEW_MATTER_PATH } from "../links";

export function TodayPage() {
  const locale = useLocale();
  return <OkfPage title={t("lawoss.lite.today_title", locale)} {...litePageProps(locale)}>
    {(data) => <TodayView model={buildToday(data, today())} locale={locale} />}
  </OkfPage>;
}

function dueLabel(d: TodayDeadline, locale: Language): string {
  if (d.invalid) return t("lawoss.lite.due_invalid", locale);
  if (d.tier === "overdue") return t("lawoss.lite.overdue", locale);
  if (d.daysLeft === 0) return t("lawoss.lite.due_today", locale);
  if (d.daysLeft === 1) return t("lawoss.lite.due_tomorrow", locale);
  return t("lawoss.lite.due_in_days", locale, { count: d.daysLeft }); // _one/_few/_many/_other podle jazyka
}

/** Ranní otázka „co mi dnes hoří": lhůty → k zařazení → úkoly. Jen čte, nic nezapisuje. */
export function TodayView({ model, locale }: { model: TodayModel; locale: Language }) {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const now = today();
  return (
    <div data-lawoss-lite="today">
      <div className="lw-reg">
        <div className="lw-reg-h"><h2>{text("deadlines_title")}</h2></div>
        {model.deadlines.length === 0 ? <p className="lw-empty">{text("deadlines_empty")}</p> : model.deadlines.map((d) => (
          <Link key={`${d.matter.path}/${d.recordId}/${d.date}`} className="lw-row lw-cols-leh" to={liteMatterLink(d.matter.path)}>
            <span className="lw-no" />
            <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
            <span className="lw-t">{d.title}<small>{d.matter.title}</small></span>
            <span className="lw-ref">{d.matter.matterRef ?? ""}</span>
            <span className={`lw-st${d.tier === "overdue" || d.tier === "today" ? " warn" : ""}`}>{dueLabel(d, locale)}</span>
          </Link>
        ))}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h"><h2>{text("inputs_title")}</h2></div>
        {model.inputs.length === 0 ? <p className="lw-empty">{text("inputs_empty")}</p> : model.inputs.map((input, index) => (
          <Link key={`${input.file}/${input.id}/${index}`} className="lw-row lw-cols-leh" to={liteMatterLink(input.matterPath)}>
            <span className="lw-no">{input.id || "—"}</span>
            <span className="lw-d">{formatDay(input.received.slice(0, 10), locale)}</span>
            <span className="lw-t">{input.source}<small>{input.original}</small></span>
            <span className="lw-ref" />
            <span className="lw-st">{text("inputs_file")}</span>
          </Link>
        ))}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h"><h2>{text("tasks_title")}</h2></div>
        {model.tasks.length === 0 ? <p className="lw-empty">{text("tasks_empty")}</p> : model.tasks.map((task) => (
          <div key={task.key} className="lw-row lw-cols-leh">
            <span className="lw-no" />
            <span className="lw-d">{task.due ? formatDay(task.due, locale) : "—"}</span>
            <span className="lw-t">{task.title}<small>{task.matters.map((m, i) => (
              <span key={m.path}>{i > 0 ? " · " : ""}<Link to={liteMatterLink(m.path)}>{m.title}</Link></span>
            ))}</small></span>
            <span className="lw-ref" />
            <span className="lw-st" />
          </div>
        ))}
      </div>

      <p><Link className="lw-btn" to={NEW_MATTER_PATH}>+ {text("new_matter")}</Link></p>
    </div>
  );
}
