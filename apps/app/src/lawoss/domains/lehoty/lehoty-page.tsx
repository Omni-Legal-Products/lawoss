/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import {
  activeWorkspace,
  dayClass,
  formatDay,
  today,
  useOkfConnection,
  useOkfOverview,
  type OkfReadResult,
} from "../../okf/read-model";
import type { UpcomingDeadline } from "../../../../../../lawoss/okf/read";

/**
 * Lehoty — register zo všetkých vecí v pamäti spisov (fáza C1/C3). Zobrazuje
 * zapísaný dátum z poľa `deadlines`, vec a súd; nič nepočíta (výpočet lehôt
 * je úloha 13, CZ a SK zvlášť) a nič nezapisuje — žiadna brána potvrdenia.
 * Bez jediného spisu ostáva pôvodná ukážka s viditeľným štítkom.
 */
export function LehotyPage() {
  const { connection, error } = useOkfConnection();
  const workspace = activeWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  const data = query.data;
  const hasMatters = Boolean(data && data.matters.length > 0);

  return (
    <LawossLayout>
      <h1 className="lw-h1">Lehoty</h1>

      {error ? <div className="lw-status err">{error}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — pamäť spisov sa nedá prečítať.</div>
      ) : null}
      {query.error ? <div className="lw-status err">{query.error instanceof Error ? query.error.message : String(query.error)}</div> : null}

      {query.isPending && query.fetchStatus === "fetching" ? (
        <p className="lw-lead">Načítavam pamäť spisov z workspace-u „{workspace?.displayNameResolved || workspace?.name}“…</p>
      ) : data && hasMatters ? (
        <RealRegister data={data} />
      ) : (
        <>
          {data ? (
            <p className="lw-empty">
              Workspace <b>{workspace?.displayNameResolved || workspace?.name}</b> nemá žiadnu vec s pamäťou. Založ ju cez{" "}
              <Link to="/experimenty/novy-spis">Nový spis</Link>. Nižšie je ukážka, ako register vyzerá.
            </p>
          ) : null}
          <SampleRegister />
        </>
      )}
    </LawossLayout>
  );
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

/** Pôvodná ukážka z fázy B — fiktívne dáta, zobrazuje sa iba bez spisov. */
function SampleRegister() {
  return (
    <>
      <p className="lw-lead">
        <span className="lw-badge">ukážka — fiktívne dáta</span> Register lehôt zo všetkých spisov. Kandidáti od agenta sa
        stávajú lehotami až po vašom potvrdení v rozhodovacej bráne — s citáciou predpisu, výpočtom a auditnou stopou.
      </p>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Čaká na potvrdenie</h2>
          <span className="lw-meta">1 kandidát · stav needs_review</span>
        </div>
        <Link className="lw-row lw-cols-leh" to="/session">
          <span className="lw-no">14.</span>
          <span className="lw-d soon">7. 6.</span>
          <span className="lw-t">
            Lehota na odvolanie
            <small>ABC s.r.o. v. DEF a.s. · doručenie 23. 5. · 15 dní kalendárnych · výpočet deterministický</small>
          </span>
          <span className="lw-ref">§ 362 ods. 1 CSP · Slov-Lex ✓</span>
          <span className="lw-st ai">otvoriť bránu</span>
        </Link>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Potvrdené</h2>
          <span className="lw-meta">
            zapísané v spise + ICS
            <a href="#ics">Exportovať ICS</a>
          </span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">1.</span>
          <span className="lw-d urg">zajtra</span>
          <span className="lw-t">
            Žaloba o náhradu škody
            <small>Novák v. Poisťovňa · 2024-03 Poisťovňa - náhrada škody</small>
          </span>
          <span className="lw-ref">Okresný súd Bratislava I</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">2.</span>
          <span className="lw-d soon">pi 23. 5.</span>
          <span className="lw-t">
            Vyjadrenie k žalobe
            <small>Kováč / rozvod</small>
          </span>
          <span className="lw-ref">Okresný súd Trnava</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">3.</span>
          <span className="lw-d">ne 25. 5.</span>
          <span className="lw-t">
            Odvolanie
            <small>STAV s.r.o. v. Mesto Žilina</small>
          </span>
          <span className="lw-ref">Krajský súd Žilina</span>
          <span className="lw-st ok">potvrdené</span>
        </div>
        <div className="lw-row lw-cols-leh">
          <span className="lw-no">4.</span>
          <span className="lw-d">po 2. 6.</span>
          <span className="lw-t">
            Návrh na zápis zmeny konateľa
            <small>Alfa s.r.o.</small>
          </span>
          <span className="lw-ref">ORSR</span>
          <span className="lw-st warn">čaká na doklady</span>
        </div>
      </div>

      <div className="lw-note">
        <span>
          Brána (spec 0005): zdroj s locatorom · deterministický výpočet · <b>Potvrdiť / Upraviť / Odmietnuť / Odložiť</b> ·
          zápis do <b>spis.md</b> + ICS + audit. Originál návrhu sa neprepíše.
        </span>
      </div>
    </>
  );
}
