/** @jsxImportSource react */
import { OkfPage } from "../okf-page";
import {
  dayClass,
  formatDay,
  today,
  type OkfReadResult,
} from "../../okf/read-model";
import type { UpcomingDeadline } from "../../../../../../lawoss/okf/read";

/** Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. */
export function LehotyPage() {
  return <OkfPage title="Lehoty">{(data) => <RealRegister data={data} />}</OkfPage>;
}

function RealRegister({ data }: { data: OkfReadResult }) {
  const now = today();
  return (
    <>
      <p className="lw-lead">
        Register lehôt zo všetkých spisov v pamäti. Zobrazuje sa dátum tak, ako je zapísaný v zázname — výpočet
        lehôt nie je súčasťou tejto fázy a nič sa nezapisuje.
      </p>

      {data.overdue.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>Po termíne</h2>
            <span className="lw-meta">{data.overdue.length} · dátum pred dneškom, stav v zázname neoverený</span>
          </div>
          {data.overdue.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)}
        </div>
      ) : null}

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Nadchádzajúce</h2>
          <span className="lw-meta">
            {data.upcomingDeadlines.length} · {data.totals.deadlinesWithin7Days} do 7 dní · {data.matters.length}{" "}
            {data.matters.length === 1 ? "spis" : data.matters.length <= 4 ? "spisy" : "spisov"}
          </span>
        </div>
        {data.upcomingDeadlines.length === 0 ? (
          <p className="lw-empty">V pamäti spisov nie je zapísaná žiadna nadchádzajúca lehota.</p>
        ) : (
          data.upcomingDeadlines.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)
        )}
      </div>

      {data.truncated ? (
        <div className="lw-status warn">
          Workspace má viac spisov, než sa číta naraz — register je z prvých {data.matters.length} spisov a lehoty
          zvyšných tu nie sú.
        </div>
      ) : null}

      {data.problems.length > 0 ? (
        <div className="lw-status warn">
          {data.problems.length} súborov pamäte sa nedalo prečítať — ich lehoty tu chýbajú:{" "}
          {data.problems.slice(0, 3).map((p) => p.path).join(", ")}
          {data.problems.length > 3 ? ", …" : ""}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          Zdroj: pole <span className="lw-mono">deadlines</span> záznamov v <span className="lw-mono">memory/</span> každej veci.
          Odkiaľ lehota plynie a koľko dní má, záznam zatiaľ nenesie.
        </span>
        <span>
          Iba čítanie. Zmena lehoty sa robí v zázname, nie tu.
        </span>
      </div>
    </>
  );
}

const rowKey = (d: UpcomingDeadline): string => `${d.matter.path}/${d.recordId}/${d.date}`;

function DeadlineRow({ d, index, now }: { d: UpcomingDeadline; index: number; now: string }) {
  return (
    <div className="lw-row lw-cols-leh">
      <span className="lw-no">{index + 1}.</span>
      <span className={dayClass(d.date, now)}>{formatDay(d.date)}</span>
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
