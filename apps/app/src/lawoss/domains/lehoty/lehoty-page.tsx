/** @jsxImportSource react */
import { OkfPage, useMatterText } from "../okf-page";
import {
  dayClass,
  formatDay,
  today,
  type OkfReadResult,
} from "../../okf/read-model";
import type { UpcomingDeadline } from "../../../../../../lawoss/okf/read";

/** Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. */
export function LehotyPage() {
  const { text } = useMatterText();
  return <OkfPage title={text("deadlinesTitle")}>{(data) => <RealRegister data={data} />}</OkfPage>;
}

export function RealRegister({ data }: { data: OkfReadResult }) {
  const { text } = useMatterText();
  const now = today();
  return (
    <>
      <p className="lw-lead">
        {text("deadlinesLead")}
      </p>

      {data.overdue.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>{text("overdueTitle")}</h2>
            <span className="lw-meta">{text("overdueNote", { count: data.overdue.length })}</span>
          </div>
          {data.overdue.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)}
        </div>
      ) : null}

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("upcoming")}</h2>
          <span className="lw-meta">
            {text("upcomingSummary", { total: data.upcomingDeadlines.length, soon: data.totals.deadlinesWithin7Days, matters: text("matters", { count: data.matters.length }) })}
          </span>
        </div>
        {data.upcomingDeadlines.length === 0 ? (
          <p className="lw-empty">{text("noUpcoming")}</p>
        ) : (
          data.upcomingDeadlines.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)
        )}
      </div>

      {data.truncated ? (
        <div className="lw-status warn">
          {text("truncatedRegister", { count: data.matters.length })}
        </div>
      ) : null}

      {data.problems.length > 0 ? (
        <div className="lw-status warn">
          {text("missingDeadlines", { files: text("filesUnreadable", { count: data.problems.length }) })}{" "}
          {data.problems.slice(0, 3).map((p) => p.path).join(", ")}
          {data.problems.length > 3 ? ", …" : ""}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          {text("deadlineSource")}
        </span>
        <span>
          {text("deadlineReadOnly")}
        </span>
      </div>
    </>
  );
}

const rowKey = (d: UpcomingDeadline): string => `${d.matter.path}/${d.recordId}/${d.date}`;

function DeadlineRow({ d, index, now }: { d: UpcomingDeadline; index: number; now: string }) {
  const { locale } = useMatterText();
  return (
    <div className="lw-row lw-cols-leh">
      <span className="lw-no">{index + 1}.</span>
      <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
      <span className="lw-t">
        {d.title}
        <small>
          {d.matter.title}
          {d.matter.matterRef ? ` · ${d.matter.matterRef}` : ""}
        </small>
      </span>
      <span className="lw-ref">{d.matter.court ?? "—"}</span>
      <span className="lw-st">{d.recordId}</span>
    </div>
  );
}
