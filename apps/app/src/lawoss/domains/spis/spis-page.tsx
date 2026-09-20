/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import {
  activeWorkspace,
  addDays,
  dayClass,
  formatDay,
  today,
  useOkfConnection,
  useOkfOverview,
  type OkfReadClient,
} from "../../okf/read-model";
import {
  buildCockpit,
  type AttentionRow,
  type Cockpit,
  type CockpitDeadline,
  type RegisterId,
} from "../../../../../../lawoss/okf/cockpit";

/**
 * Spisový prehľad — read-only cockpit jednej veci (spec MF, bod 3.3).
 *
 * Číta iba to, čo prečítal read-model: kartu `spis.md` a záznamy `memory/*.md`
 * vybranej veci. Nezapisuje, nevolá skill a nemá bránu potvrdenia — každý
 * riadok len ukazuje, z ktorého súboru pochádza. Vec sa vyberá parametrom
 * `?vec=<cesta>`; bez neho sa otvorí prvá vec v prehľade.
 */
export function SpisPage() {
  const [params] = useSearchParams();
  const vec = params.get("vec");
  const { connection, error } = useOkfConnection();
  const workspace = activeWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  const data = query.data;
  const now = today();
  const cockpit = data ? buildCockpit(data, vec, now) : null;
  const raw = useRawFiles(connection?.client ?? null, workspace?.id ?? "", cockpit?.unreadable.map((p) => p.path) ?? []);

  return (
    <LawossLayout>
      {error ? <div className="lw-status err">{error}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — pamäť spisu sa nedá prečítať.</div>
      ) : null}
      {query.error ? (
        <div className="lw-status err">{query.error instanceof Error ? query.error.message : String(query.error)}</div>
      ) : null}

      {query.isPending && query.fetchStatus === "fetching" ? (
        <>
          <h1 className="lw-h1">Spis</h1>
          <p className="lw-lead">Načítavam pamäť spisov z workspace-u „{workspace?.displayNameResolved || workspace?.name}“…</p>
        </>
      ) : cockpit ? (
        <MatterCockpit cockpit={cockpit} now={now} raw={raw.data ?? {}} />
      ) : (
        <NotFound found={data ? data.matters.map((m) => ({ path: m.path, title: m.title })) : []} vec={vec} />
      )}
    </LawossLayout>
  );
}

/** Surový obsah nečitateľných záznamov — bez neho by z obrazovky ticho zmizli. */
function useRawFiles(client: OkfReadClient | null, workspaceId: string, paths: readonly string[]) {
  const key = paths.join("|");
  return useQuery({
    queryKey: ["okf-raw", workspaceId, key],
    enabled: Boolean(client && workspaceId && paths.length > 0),
    queryFn: async (): Promise<Record<string, string>> => {
      if (!client) return {};
      const out: Record<string, string> = {};
      for (const path of paths) {
        try {
          out[path] = (await client.readWorkspaceFile(workspaceId, path)).content;
        } catch (e) {
          out[path] = e instanceof Error ? e.message : String(e);
        }
      }
      return out;
    },
  });
}

function NotFound({ found, vec }: { found: { path: string; title: string }[]; vec: string | null }) {
  return (
    <>
      <h1 className="lw-h1">Spis</h1>
      <p className="lw-empty">
        {vec ? (
          <>
            Vec <span className="lw-mono">{vec}</span> sa v pamäti workspace-u nenašla.
          </>
        ) : (
          <>
            Workspace nemá žiadnu vec s pamäťou (<span className="lw-mono">AK/&lt;písmeno&gt;/&lt;klient&gt;/Spisy/&lt;vec&gt;/memory/</span>).
            Založ ju cez <Link to="/experimenty/novy-spis">Nový spis</Link>.
          </>
        )}
      </p>
      {found.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>Veci v pamäti</h2>
            <span className="lw-meta">{found.length} · vyber jednu</span>
          </div>
          {found.map((m, i) => (
            <Link key={m.path} className="lw-row lw-cols-leh" to={matterLink(m.path)}>
              <span className="lw-no">{i + 1}.</span>
              <span className="lw-d">—</span>
              <span className="lw-t">
                {m.title}
                <small className="lw-mono">{m.path}</small>
              </span>
              <span className="lw-ref" />
              <span className="lw-st">otvoriť</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

export const matterLink = (path: string): string => `/spis?vec=${encodeURIComponent(path)}`;

function MatterCockpit({ cockpit, now, raw }: { cockpit: Cockpit; now: string; raw: Record<string, string> }) {
  const { matter } = cockpit;
  return (
    <>
      <h1 className="lw-h1">{matter.title}</h1>
      <p className="lw-lead">
        {cockpit.client ? <>Klient <b>{cockpit.client}</b>. </> : null}
        {matter.matterRef ? <span className="lw-mono">{matter.matterRef}</span> : "bez spisovej značky"}
        {matter.court ? ` · ${matter.court}` : ""}
        {matter.state ? ` · konanie: ${matter.state}` : ""} · OKF:{" "}
        <b>{cockpit.okfValid ? "validné" : `s nálezmi (${cockpit.attention.filter((r) => r.kind === "nález" || r.state === "neparsovateľné").length})`}</b>
      </p>

      <div className="lw-obal">
        {cockpit.registers.map((r) => (
          <div key={r.id}>
            <span className="lw-sc">{r.label}</span>
            <span className={`lw-v${r.id === "lehoty" && cockpit.deadlines.candidates.length > 0 ? " warn" : ""}`}>
              {r.count}
              <small>{r.note}</small>
            </span>
          </div>
        ))}
        <div>
          <span className="lw-sc">Stav OKF</span>
          <span className={`lw-v${cockpit.okfValid ? "" : " warn"}`}>
            {cockpit.okfValid ? "validné" : "s nálezmi"}
            <small>{cockpit.unreadable.length > 0 ? `${cockpit.unreadable.length} nečitateľných` : "všetko čitateľné"}</small>
          </span>
        </div>
      </div>

      <DeadlineStrip deadlines={[...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates]} now={now} />

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Čaká na pozornosť advokáta</h2>
          <span className="lw-meta">uplynuté a blížiace sa lehoty, nálezy, nečitateľné záznamy</span>
        </div>
        {cockpit.attention.length === 0 ? (
          <p className="lw-empty">Nič nečaká — žiadna lehota do 7 dní, žiaden nález, každý záznam sa dal prečítať.</p>
        ) : (
          cockpit.attention.map((row, i) => <AttentionLine key={row.id} row={row} index={i} now={now} />)
        )}
      </div>

      {cockpit.registers.map((reg) => (
        <div className="lw-reg" key={reg.id}>
          <div className="lw-reg-h">
            <h2>{reg.label}</h2>
            <span className="lw-meta">{reg.note}</span>
          </div>
          <RegisterRows id={reg.id} cockpit={cockpit} now={now} />
        </div>
      ))}

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Posledné udalosti</h2>
          <span className="lw-meta">chronológia zo sekcií History záznamov · {cockpit.events.length} celkom</span>
        </div>
        {cockpit.events.length === 0 ? (
          <p className="lw-empty">Záznamy veci nemajú v sekcii History žiadny riadok.</p>
        ) : (
          cockpit.events.slice(0, 12).map((e, i) => (
            <div className="lw-row lw-cols-leh" key={`${e.file}/${e.date}/${i}`}>
              <span className="lw-no">{i + 1}.</span>
              <span className="lw-d">{formatDay(e.date)}</span>
              <span className="lw-t">
                {e.text}
                <small className="lw-mono">{e.file}</small>
              </span>
              <span className="lw-ref">{e.recordId}</span>
              <span className="lw-st">{e.kind ?? "udalosť"}</span>
            </div>
          ))
        )}
      </div>

      {cockpit.unreadable.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>Nečitateľné záznamy</h2>
            <span className="lw-meta">surový obsah — nič sa nezahadzuje</span>
          </div>
          {cockpit.unreadable.map((p) => (
            <div key={p.path}>
              <div className="lw-status warn">
                <span className="lw-mono">{p.path}</span> — {p.message}
              </div>
              <pre className="lw-raw">{raw[p.path] ?? "Načítavam surový obsah…"}</pre>
            </div>
          ))}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          Iba <b>čítanie</b>. Cockpit nič nezapisuje do pamäte spisu, nevolá skill a nemá bránu potvrdenia — zmena sa
          robí v zázname.
        </span>
        <span>
          Zdroj: <span className="lw-mono">{matter.path}</span>
        </span>
      </div>
    </>
  );
}

function AttentionLine({ row, index, now }: { row: AttentionRow; index: number; now: string }) {
  return (
    <div className="lw-row lw-cols-wait">
      <span className="lw-no">{index + 1}.</span>
      <span className={row.date ? dayClass(row.date, now) : "lw-d"}>{row.date ? formatDay(row.date) : row.kind}</span>
      <span className="lw-t">
        {row.title}
        <small>
          {row.detail}
          {row.provenance ? ` · ${row.provenance}` : ""}
        </small>
      </span>
      <span className="lw-ref" title={row.file}>
        {row.file.split("/").pop()}
      </span>
      <span className={`lw-st${row.state === "po termíne" || row.state === "neparsovateľné" ? " warn" : ""}`}>{row.state}</span>
    </div>
  );
}

function RegisterRows({ id, cockpit, now }: { id: RegisterId; cockpit: Cockpit; now: string }) {
  if (id === "obal") {
    return (
      <>
        {cockpit.obal.map((f, i) => (
          <div className="lw-row lw-cols-leh" key={f.label}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{f.label}</span>
            <span className="lw-t">
              <span className={f.missing ? "" : "lw-mono"}>{f.value}</span>
              <small className="lw-mono">{cockpit.matter.path}/spis.md</small>
            </span>
            <span className="lw-ref" />
            <span className={`lw-st${f.missing ? " warn" : ""}`}>{f.missing ? "chýba údaj" : "zapísané"}</span>
          </div>
        ))}
      </>
    );
  }
  if (id === "fakty") {
    if (cockpit.facts.length === 0) return <p className="lw-empty">Vec nemá v pamäti žiadny fakt — len úlohy alebo nič.</p>;
    return (
      <>
        {cockpit.facts.map((f, i) => (
          <div className="lw-row lw-cols-leh" key={f.id}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{f.date ? formatDay(f.date) : "—"}</span>
            <span className="lw-t">
              {f.title}
              <small>
                {f.kind}
                {f.source ? ` · ${f.source}` : " · bez prameňa"}
                {f.locator ? ` · ${f.locator}` : ""}
              </small>
            </span>
            <span className="lw-ref" title={f.file}>
              {f.id}
            </span>
            <span className="lw-st">{f.provenance}</span>
          </div>
        ))}
      </>
    );
  }
  if (id === "ulohy") {
    if (cockpit.tasks.length === 0) return <p className="lw-empty">Žiadna otvorená úloha.</p>;
    return (
      <>
        {cockpit.tasks.map((t, i) => (
          <div className="lw-row lw-cols-leh" key={t.id}>
            <span className="lw-no">{i + 1}.</span>
            <span className={t.due ? dayClass(t.due, now) : "lw-d"}>{t.due ? formatDay(t.due) : "bez termínu"}</span>
            <span className="lw-t">
              {t.title}
              <small className="lw-mono">{t.file}</small>
            </span>
            <span className="lw-ref">{t.assignee ?? "—"}</span>
            <span className={`lw-st${t.overdue ? " warn" : ""}`}>{t.overdue ? "po termíne" : "otvorená"}</span>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      <DeadlineGroup title="Potvrdené" rows={cockpit.deadlines.confirmed} now={now} empty="Žiadna potvrdená lehota." />
      <DeadlineGroup title="Kandidáti" rows={cockpit.deadlines.candidates} now={now} empty="Žiadna nepotvrdená lehota." />
    </>
  );
}

function DeadlineGroup({ title, rows, now, empty }: { title: string; rows: readonly CockpitDeadline[]; now: string; empty: string }) {
  return (
    <>
      <p className="lw-empty">
        <b>{title}</b> · {rows.length === 0 ? empty : `${rows.length}`}
      </p>
      {rows.map((d, i) => (
        <div className="lw-row lw-cols-leh" key={`${d.recordId}/${d.date}`}>
          <span className="lw-no">{i + 1}.</span>
          <span className={dayClass(d.date, now)}>{formatDay(d.date)}</span>
          <span className="lw-t">
            {d.title}
            <small>
              {d.source ?? "bez prameňa"} · <span className="lw-mono">{d.file}</span>
            </small>
          </span>
          <span className="lw-ref">{d.recordId}</span>
          <span className={`lw-st${d.overdue ? " warn" : ""}`}>{d.overdue ? "po termíne" : d.provenance}</span>
        </div>
      ))}
    </>
  );
}

// ── pás lehôt ─────────────────────────────────────────────────────────────

const MS_DAY = 86_400_000;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Počet dní medzi dvomi `RRRR-MM-DD`; nevalidný vstup → 0. */
function daysBetween(from: string, to: string): number {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / MS_DAY);
}

/**
 * Jediný obrázok obrazovky: pás lehôt veci. Okno je od najstaršej lehoty (alebo
 * dneška) po najvzdialenejšiu (minimálne 14 dní dopredu). Plná značka =
 * zapísaná alebo overená lehota, čiarkovaná = kandidát od agenta.
 */
function DeadlineStrip({ deadlines: unsorted, now }: { deadlines: readonly CockpitDeadline[]; now: string }) {
  const deadlines = [...unsorted].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = deadlines.map((d) => d.date).filter((d) => ISO_DAY.test(d));
  const from = dates.reduce((min, d) => (d < min ? d : min), now);
  const to = dates.reduce((max, d) => (d > max ? d : max), addDays(now, 14));
  const span = Math.max(daysBetween(from, to), 1);
  const x = (date: string): number => 20 + (daysBetween(from, date) / span) * 1120;

  return (
    <div className="lw-strip">
      <svg viewBox="0 0 1160 132" aria-label={`Pás lehôt od ${from} do ${to}`}>
        <line x1="20" x2="1140" y1="92" y2="92" stroke="var(--lw-border-strong)" />
        <line x1={x(now)} x2={x(now)} y1="14" y2="92" stroke="var(--lw-accent)" strokeWidth="1.5" />
        <text x={x(now) + 6} y="24" fontSize="10.5" fill="var(--lw-accent)">
          dnes
        </text>
        <text x="20" y="112" fontSize="11" fill="var(--lw-text-tertiary)">
          {formatDay(from)}
        </text>
        <text x="1140" y="112" fontSize="11" textAnchor="end" fill="var(--lw-text-tertiary)">
          {formatDay(to)}
        </text>
        {deadlines.map((d, i) => {
          const color = d.overdue ? "var(--lw-danger)" : !d.confirmed ? "var(--lw-accent)" : "var(--lw-text-secondary)";
          const top = i % 2 === 0 ? 30 : 58;
          // Popisok pri pravom okraji sa otočí doľava, inak by vytiekol mimo plochu.
          const flip = x(d.date) > 860;
          const anchor = flip ? "end" : "start";
          const label = x(d.date) + (flip ? -8 : 8);
          return (
            <g key={`${d.recordId}/${d.date}`} fontSize="12">
              <line
                x1={x(d.date)}
                x2={x(d.date)}
                y1={top}
                y2="92"
                stroke={color}
                strokeDasharray={!d.confirmed ? "3 3" : undefined}
              />
              <circle cx={x(d.date)} cy="92" r="4.5" fill={d.overdue ? color : "var(--lw-surface)"} stroke={color} strokeWidth="1.5" />
              <text x={label} y={top + 4} textAnchor={anchor} fill={color} fontWeight="500">
                {d.title}
              </text>
              <text x={label} y={top + 17} textAnchor={anchor} fontSize="11" fill="var(--lw-text-secondary)">
                {formatDay(d.date)} · {d.overdue ? "po termíne" : d.provenance}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="lw-leg">
        <span className="t">po termíne</span>
        <span className="m">potvrdené človekom pre konkrétny dátum</span>
        <span className="k">kandidát — čaká na potvrdenie človekom</span>
      </div>
      {deadlines.length === 0 ? <p className="lw-empty">Vec nemá v pamäti zapísanú žiadnu lehotu.</p> : null}
    </div>
  );
}
