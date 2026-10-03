/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { OkfPage, useMatterText } from "../okf-page";
import {
  addDays,
  dayClass,
  formatDay,
  formatLongDay,
  today,
  type OkfReadResult,
} from "../../okf/read-model";
import { matterLink } from "../spis/spis-page";
import { recordKey } from "../../../../../../lawoss/okf/read";

/** Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. */
export function PrehladPage() {
  const { text } = useMatterText();
  return <OkfPage title={text("overview")}>{(data) => <RealOverview data={data} />}</OkfPage>;
}

export function RealOverview({ data }: { data: OkfReadResult }) {
  const { locale, text } = useMatterText();
  const now = today();
  const fortnight = addDays(now, 14);
  const soon = data.upcomingDeadlines.filter((d) => d.date <= fortnight);
  const dueToday = data.upcomingDeadlines.filter((d) => d.date === now).length;
  // Stejná totožnost jako v součtu úkolů: sdílený soubor = jedna úloha.
  const withDue = new Set(data.matters.flatMap((m) => m.openTasks.filter((t) => t.due).map((t) => recordKey(m.path, t)))).size;
  const t = data.totals;

  return (
    <>
      <p className="lw-lead">
        {text("summary", { date: formatLongDay(now, locale), matters: text("matters", { count: t.matters }),
          deadlines: text("deadlines", { count: t.deadlinesWithin7Days }), tasks: text("openTasksCount", { count: t.openTasks }) })}
      </p>

      <div className="lw-obal">
        <div>
          <span className="lw-sc">{text("activeMatters")}</span>
          <span className="lw-v">
            {t.matters}
            {data.truncated ? <small>{text("firstShown", { count: t.matters })}</small> : null}
          </span>
        </div>
        <div>
          <span className="lw-sc">{text("deadlines7")}</span>
          <span className={`lw-v${t.deadlinesWithin7Days > 0 ? " warn" : ""}`}>
            {t.deadlinesWithin7Days}
            <small>{dueToday > 0 ? text("todayCount", { count: dueToday }) : t.overdue > 0 ? text("overdueCount", { count: t.overdue }) : text("noneToday")}</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">{text("openTasks")}</span>
          <span className="lw-v">
            {t.openTasks}
            <small>{text("withDue", { count: withDue })}</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">{text("memoryRecords")}</span>
          <span className={`lw-v${data.problems.length > 0 ? " warn" : ""}`}>
            {t.records}
            <small>{data.problems.length > 0 ? text("unreadableCount", { count: data.problems.length }) : text("allReadable")}</small>
          </span>
        </div>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("deadlines14")}</h2>
          <span className="lw-meta">
            {text("recordedNoCalculation")}
            <Link to="/lehoty">{text("fullRegister")}</Link>
          </span>
        </div>
        {t.overdue > 0 ? (
          <Link className="lw-row lw-cols-leh" to="/lehoty">
            <span className="lw-no">!</span>
            <span className="lw-d urg">{text("overdue")}</span>
            <span className="lw-t">
              {text("overdueSummary", { deadlines: text("deadlines", { count: t.overdue }) })}
              <small>{text("checkRegister")}</small>
            </span>
            <span className="lw-ref" />
            <span className="lw-st warn">{text("review")}</span>
          </Link>
        ) : null}
        {soon.length === 0 ? (
          <p className="lw-empty">{text("noDeadlines14")}</p>
        ) : (
          soon.map((d, i) => (
            <Link key={`${d.matter.path}/${d.recordId}/${d.date}`} className="lw-row lw-cols-leh" to="/lehoty">
              <span className="lw-no">{i + 1}.</span>
              <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
              <span className="lw-t">
                {d.title}
                <small>
                  {d.matter.title}
                  {d.matter.court ? ` · ${d.matter.court}` : ""}
                </small>
              </span>
              <span className="lw-ref">{d.matter.matterRef ?? d.recordId}</span>
              <span className="lw-st">{text("recorded")}</span>
            </Link>
          ))
        )}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("mattersTitle")}</h2>
          <span className="lw-meta">{text("lastEventNote")}</span>
        </div>
        {data.matters.map((m, i) => (
          <Link key={m.path} className="lw-row lw-cols-leh" to={matterLink(m.path)}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{m.lastEvent ? formatDay(m.lastEvent.date, locale) : "—"}</span>
            <span className="lw-t">
              {m.title}
              <small>{m.lastEvent ? m.lastEvent.text : text("noHistoryEvent")}</small>
            </span>
            <span className="lw-ref">{m.matterRef ?? m.court ?? ""}</span>
            <span className={`lw-st${m.openTasks.length > 0 ? " warn" : " off"}`}>
              {text("tasksCount", { count: m.openTasks.length })}
              {m.state ? ` · ${m.state}` : ""}
            </span>
          </Link>
        ))}
      </div>

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
    </>
  );
}
