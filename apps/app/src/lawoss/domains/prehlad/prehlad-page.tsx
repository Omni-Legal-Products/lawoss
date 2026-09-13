/** @jsxImportSource react */
import { Link } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import {
  activeWorkspace,
  addDays,
  dayClass,
  formatDay,
  formatLongDay,
  today,
  useOkfConnection,
  useOkfOverview,
  type OkfReadResult,
} from "../../okf/read-model";

/**
 * Prehľad praxe nad skutočnou pamäťou spisov (fáza C1/C2): čísla v hlavičke,
 * lehoty na 14 dní a zoznam vecí pochádzajú zo záznamov `memory/*.md` vo
 * workspace-i. Iba čítanie. Bez jediného spisu ostáva pôvodná ukážka
 * s viditeľným štítkom.
 */
export function PrehladPage() {
  const { connection, error } = useOkfConnection();
  const workspace = activeWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  const data = query.data;
  const hasMatters = Boolean(data && data.matters.length > 0);

  return (
    <LawossLayout>
      <h1 className="lw-h1">Prehľad praxe</h1>

      {error ? <div className="lw-status err">{error}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — pamäť spisov sa nedá prečítať.</div>
      ) : null}
      {query.error ? <div className="lw-status err">{query.error instanceof Error ? query.error.message : String(query.error)}</div> : null}

      {query.isPending && query.fetchStatus === "fetching" ? (
        <p className="lw-lead">Načítavam pamäť spisov z workspace-u „{workspace?.displayNameResolved || workspace?.name}“…</p>
      ) : data && hasMatters ? (
        <RealOverview data={data} />
      ) : (
        <>
          {data ? (
            <p className="lw-empty">
              Workspace <b>{workspace?.displayNameResolved || workspace?.name}</b> nemá žiadnu vec s pamäťou
              (<span className="lw-mono">AK/&lt;písmeno&gt;/&lt;klient&gt;/Spisy/&lt;vec&gt;/memory/</span>). Založ ju cez{" "}
              <Link to="/experimenty/novy-spis">Nový spis</Link>. Nižšie je ukážka, ako prehľad vyzerá.
            </p>
          ) : null}
          <SampleOverview />
        </>
      )}
    </LawossLayout>
  );
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
          <span className="lw-meta">posledná udalosť z histórie záznamov</span>
        </div>
        {data.matters.map((m, i) => (
          <div key={m.path} className="lw-row lw-cols-leh">
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
          </div>
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

/** Pôvodná ukážka z fázy B — fiktívne dáta, zobrazuje sa iba bez spisov. */
function SampleOverview() {
  return (
    <>
      <p className="lw-lead">
        <span className="lw-badge">ukážka — fiktívne dáta</span> Utorok 23. augusta. Tri veci čakajú na vaše rozhodnutie, dve
        lehoty sú tento týždeň.
      </p>

      <div className="lw-obal">
        <div>
          <span className="lw-sc">Aktívne spisy</span>
          <span className="lw-v">
            24<small>+3 tento týždeň</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Lehoty · 7 dní</span>
          <span className="lw-v warn">
            7<small>2 dnes</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Dokumenty</span>
          <span className="lw-v">
            128<small>+12 · 4 z e-mailu</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Agent</span>
          <span className="lw-v">
            lokálny<small>cloud vypnutý</small>
          </span>
        </div>
        <div>
          <span className="lw-sc">Zdroje</span>
          <span className="lw-v">
            4 / 5<small>Autogram chýba</small>
          </span>
        </div>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Čaká na advokáta</h2>
          <span className="lw-meta">
            agent pripravil, vy rozhodujete
            <Link to="/lehoty">Otvoriť lehoty</Link>
          </span>
        </div>
        <Link className="lw-row lw-cols-wait" to="/lehoty">
          <span className="lw-no">1.</span>
          <span className="lw-d soon">do 7. 6.</span>
          <span className="lw-t">
            Lehota na odvolanie
            <small>ABC s.r.o. v. DEF a.s. · Okresný súd Bratislava I</small>
          </span>
          <span className="lw-ref">§ 362 ods. 1 CSP</span>
          <span className="lw-st ai">návrh agenta</span>
        </Link>
        <Link className="lw-row lw-cols-wait" to="/session">
          <span className="lw-no">2.</span>
          <span className="lw-d">dnes 10:24</span>
          <span className="lw-t">
            Návrh odpovede klientovi
            <small>KLIENT s.r.o. · Re: Zmluva o dielo · odíde až po schválení</small>
          </span>
          <span className="lw-ref">e-mail</span>
          <span className="lw-st ai">návrh agenta</span>
        </Link>
        <Link className="lw-row lw-cols-wait" to="/session">
          <span className="lw-no">3.</span>
          <span className="lw-d">včera</span>
          <span className="lw-t">
            Zápis do pamäte spisu
            <small>nový fakt: uhradených 40 % z ceny diela (82 400 €)</small>
          </span>
          <span className="lw-ref">MEMORY.md · L2</span>
          <span className="lw-st ai">návrh agenta</span>
        </Link>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Lehoty · najbližších 14 dní</h2>
          <span className="lw-meta">
            <Link to="/lehoty">Celý register</Link>
          </span>
        </div>
        <div className="lw-strip">
          <DeadlineStrip />
        </div>
        <div className="lw-leg">
          <span className="t">dnes / zajtra</span>
          <span className="m">potvrdené</span>
          <span className="k">návrh agenta, čaká na potvrdenie</span>
        </div>
      </div>

      <div className="lw-agent">
        <i />
        <div>
          <b>Agent</b> · dnes 09:02 — Spracoval som 4 nové e-maily. V spise <span className="lw-mono">ABC v. DEF</span> som
          našiel doručený rozsudok a navrhol lehotu na odvolanie (list č. 14). Dva dokumenty z KLIENT s.r.o. som zaradil do{" "}
          <span className="lw-mono">03_komunikacia</span>.
          <div className="lw-tools">
            <span>read · ocr</span>
            <span>okf-validate ✓</span>
            <span>lehoty.md +1 kandidát</span>
            <span>audit 09:02</span>
          </div>
        </div>
      </div>

      <div className="lw-note">
        <span>
          Všetko beží <b>lokálne</b>; registre sú iba na čítanie.
        </span>
        <span>
          Chat a agent: záložka <b>Asistent</b>.
        </span>
      </div>
    </>
  );
}

function DeadlineStrip() {
  const days = ["ut 23.", "st 24.", "št 25.", "pi 26.", "so 27.", "ne 28.", "po 29.", "ut 30.", "st 31.", "št 1.", "pi 2.", "so 3.", "ne 4.", "po 5.", "ut 6."];
  const x = (index: number) => 20 + index * 80;
  return (
    <svg viewBox="0 0 1160 118" aria-label="Pás lehôt na 14 dní">
      <defs>
        <linearGradient id="lw-today" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--lw-accent)" stopOpacity=".35" />
          <stop offset="1" stopColor="var(--lw-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <rect x={x(3.5)} y="20" width="160" height="58" fill="color-mix(in srgb, var(--lw-text-primary) 2.5%, transparent)" />
      <rect x={x(10.5)} y="20" width="160" height="58" fill="color-mix(in srgb, var(--lw-text-primary) 2.5%, transparent)" />
      <line x1="20" x2="1140" y1="78" y2="78" stroke="var(--lw-border-strong)" />
      {days.map((_, index) => (
        <line key={index} x1={x(index)} x2={x(index)} y1="74" y2="82" stroke="var(--lw-border)" />
      ))}
      {days.map((day, index) => (
        <text key={day} x={x(index)} y="100" textAnchor="middle" fontSize="11" fill={index === 4 || index === 5 || index === 11 || index === 12 ? "var(--lw-text-placeholder)" : "var(--lw-text-tertiary)"}>
          {day}
        </text>
      ))}
      <rect x="12" y="8" width="16" height="70" fill="url(#lw-today)" />
      <line x1="20" x2="20" y1="8" y2="78" stroke="var(--lw-accent)" strokeWidth="1.5" />
      <text x="28" y="18" fontSize="10.5" fill="var(--lw-accent)">dnes</text>
      <Flag x={x(1)} tier="high" color="var(--lw-danger)" title="Žaloba o náhradu škody" sub="Novák v. Poisťovňa · OS Bratislava I" solid />
      <Flag x={x(3)} tier="low" color="var(--lw-warning)" title="Vyjadrenie k žalobe" sub="Kováč / rozvod · OS Trnava" solid />
      <Flag x={x(5)} tier="high" color="var(--lw-text-secondary)" title="Odvolanie" sub="STAV s.r.o. v. Mesto Žilina · KS Žilina" />
      <Flag x={x(10)} tier="high" color="var(--lw-accent)" title="Lehota na odvolanie · návrh" sub="ABC v. DEF · čaká na potvrdenie" dashed />
      <Flag x={x(13)} tier="low" color="var(--lw-text-secondary)" title="Zmena konateľa" sub="Alfa s.r.o. · ORSR" />
    </svg>
  );
}

function Flag(props: { x: number; tier: "high" | "low"; color: string; title: string; sub: string; solid?: boolean; dashed?: boolean }) {
  const top = props.tier === "high" ? 16 : 46;
  return (
    <g fontSize="12">
      <line x1={props.x} x2={props.x} y1={top} y2="78" stroke={props.color} strokeDasharray={props.dashed ? "3 3" : undefined} />
      <circle
        cx={props.x}
        cy="78"
        r="4.5"
        fill={props.solid ? props.color : "var(--lw-surface)"}
        stroke={props.color}
        strokeWidth="1.5"
        strokeDasharray={props.dashed ? "2 2" : undefined}
      />
      <text x={props.x + 8} y={top + 4} fill={props.color} fontWeight="500">
        {props.title}
      </text>
      <text x={props.x + 8} y={top + 18} fontSize="11" fill="var(--lw-text-secondary)">
        {props.sub}
      </text>
    </g>
  );
}
