/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { OkfPage } from "../okf-page";
import {
  addDays,
  dayClass,
  formatDay,
  formatLongDay,
  today,
  type OkfReadResult,
} from "../../okf/read-model";
import { matterLink } from "../spis/spis-page";

/** Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. */
export function PrehladPage() {
  return <OkfPage title="Prehľad praxe">{(data) => <RealOverview data={data} />}</OkfPage>;
}

function RealOverview({ data }: { data: OkfReadResult }) {
  const now = today();
  const fortnight = addDays(now, 14);
  const soon = data.upcomingDeadlines.filter((d) => d.date <= fortnight);
  const dueToday = data.upcomingDeadlines.filter((d) => d.date === now).length;
  const withDue = data.matters.reduce((n, m) => n + m.openTasks.filter((t) => t.due).length, 0);
  const t = data.totals;

  return (
    <>
      <p className="lw-lead">
        {formatLongDay(now)}. {t.matters} {plural(t.matters, "spis", "spisy", "spisov")}, {t.deadlinesWithin7Days}{" "}
        {plural(t.deadlinesWithin7Days, "lehota", "lehoty", "lehôt")} do 7 dní, {t.openTasks}{" "}
        {plural(t.openTasks, "otvorená úloha", "otvorené úlohy", "otvorených úloh")}.
      </p>

      <div className="lw-obal">
        <div>
          <span className="lw-sc">Aktívne spisy</span>
          <span className="lw-v">
            {t.matters}
            {data.truncated ? <small>zobrazených prvých {t.matters}</small> : null}
          </span>
        </div>
        <div>
          <span className="lw-sc">Lehoty · 7 dní</span>
          <span className={`lw-v${t.deadlinesWithin7Days > 0 ? " warn" : ""}`}>
            {t.deadlinesWithin7Days}
            <small>{dueToday > 0 ? `${dueToday} dnes` : t.overdue > 0 ? `${t.overdue} po termíne` : "žiadna dnes"}</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Otvorené úlohy</span>
          <span className="lw-v">
            {t.openTasks}
            <small>{withDue} s termínom</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Záznamy v pamäti</span>
          <span className={`lw-v${data.problems.length > 0 ? " warn" : ""}`}>
            {t.records}
            <small>{data.problems.length > 0 ? `${data.problems.length} nečitateľných` : "všetky čitateľné"}</small>
          </span>
        </div>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Lehoty · najbližších 14 dní</h2>
          <span className="lw-meta">
            zapísané v pamäti spisov, nič sa nedopočítava
            <Link to="/lehoty">Celý register</Link>
          </span>
        </div>
        {t.overdue > 0 ? (
          <Link className="lw-row lw-cols-leh" to="/lehoty">
            <span className="lw-no">!</span>
            <span className="lw-d urg">po termíne</span>
            <span className="lw-t">
              {t.overdue} {plural(t.overdue, "lehota", "lehoty", "lehôt")} s dátumom pred dneškom
              <small>otvor register a skontroluj, či sú vybavené</small>
            </span>
            <span className="lw-ref" />
            <span className="lw-st warn">skontrolovať</span>
          </Link>
        ) : null}
        {soon.length === 0 ? (
          <p className="lw-empty">V najbližších 14 dňoch nie je v pamäti zapísaná žiadna lehota.</p>
        ) : (
          soon.map((d, i) => (
            <Link key={`${d.matter.path}/${d.recordId}/${d.date}`} className="lw-row lw-cols-leh" to="/lehoty">
              <span className="lw-no">{i + 1}.</span>
              <span className={dayClass(d.date, now)}>{formatDay(d.date)}</span>
              <span className="lw-t">
                {d.title}
                <small>
                  {d.matter.title}
                  {d.matter.court ? ` · ${d.matter.court}` : ""}
                </small>
              </span>
              <span className="lw-ref">{d.matter.matterRef ?? d.recordId}</span>
              <span className="lw-st">zapísané</span>
            </Link>
          ))
        )}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Spisy</h2>
          <span className="lw-meta">posledná udalosť z histórie záznamov · klikni na spis pre detail</span>
        </div>
        {data.matters.map((m, i) => (
          <Link key={m.path} className="lw-row lw-cols-leh" to={matterLink(m.path)}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{m.lastEvent ? formatDay(m.lastEvent.date) : "—"}</span>
            <span className="lw-t">
              {m.title}
              <small>{m.lastEvent ? m.lastEvent.text : "bez udalosti v histórii"}</small>
            </span>
            <span className="lw-ref">{m.matterRef ?? m.court ?? ""}</span>
            <span className={`lw-st${m.openTasks.length > 0 ? " warn" : " off"}`}>
              {m.openTasks.length} {plural(m.openTasks.length, "úloha", "úlohy", "úloh")}
              {m.state ? ` · ${m.state}` : ""}
            </span>
          </Link>
        ))}
      </div>

      {data.problems.length > 0 ? (
        <div className="lw-status warn">
          {data.problems.length} {plural(data.problems.length, "súbor sa nedal prečítať", "súbory sa nedali prečítať", "súborov sa nedalo prečítať")}:{" "}
          {data.problems.slice(0, 3).map((p) => p.path).join(", ")}
          {data.problems.length > 3 ? ", …" : ""}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          Všetko beží <b>lokálne</b>; pamäť spisov sa iba <b>číta</b>, nič sa nezapisuje.
        </span>
        <span>
          Chat a agent: záložka <b>Asistent</b>.
        </span>
      </div>
    </>
  );
}

function plural(n: number, one: string, few: string, many: string): string {
  return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
