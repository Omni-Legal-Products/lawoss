/** @jsxImportSource react */
import { useQuery } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMatterText } from "../okf-page";
import type { MatterTextKey } from "../../i18n/matters";
import { Button } from "@/components/ui/button";
import { openMatterSession } from "../../okf/matter-session";

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
import { daysBetween, ISO_DAY } from "../../../../../../lawoss/okf/read";

/**
 * Spisový prehľad — read-only cockpit jednej veci (spec MF, bod 3.3).
 *
 * Číta iba to, čo prečítal read-model: kartu veci a záznamy `memory/*.md`
 * vybranej veci. Nezapisuje, nevolá skill a nemá bránu potvrdenia — každý
 * riadok len ukazuje, z ktorého súboru pochádza. Vec sa vyberá parametrom
 * `?vec=<cesta>`; bez neho sa otvorí prvá vec v prehľade.
 */
export function SpisPage() {
  const { text } = useMatterText();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const opening = useRef(false);
  const [openingSession, setOpeningSession] = useState(false);
  const [sessionError, setSessionError] = useState("");
  const vec = params.get("vec");
  const { connection, error } = useOkfConnection();
  const workspace = activeWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  const data = query.data;
  const now = today();
  const cockpit = data ? buildCockpit(data, vec, now) : null;
  const raw = useRawFiles(connection?.client ?? null, workspace?.id ?? "", cockpit?.unreadable.map((p) => p.path) ?? []);
  async function openTask() {
    if (opening.current || !connection || !workspace || !cockpit || !data || query.error) return;
    opening.current = true; setOpeningSession(true); setSessionError("");
    try { navigate(await openMatterSession(connection, workspace, cockpit.matter, data.matters)); }
    catch (failure) { setSessionError(failure instanceof Error ? failure.message : String(failure)); }
    finally { opening.current = false; setOpeningSession(false); }
  }

  return (
    <LawossLayout>
      {error ? <div className="lw-status err">{error}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">{text("serverTokenMissing")}</div>
      ) : null}
      {query.error ? (
        <div className="lw-status err">{query.error instanceof Error ? query.error.message : String(query.error)}</div>
      ) : null}

      {query.isPending && query.fetchStatus === "fetching" ? (
        <>
          <h1 className="lw-h1">{text("matter")}</h1>
          <p className="lw-lead">{text("memoryLoading", { workspace: workspace?.displayNameResolved || workspace?.name || "" })}</p>
        </>
      ) : cockpit ? (
        <>
          <div className="mb-5 space-y-2">
            <p className="break-all text-sm">{text("selectedMatter", { title: cockpit.matter.title, reference: cockpit.matter.matterRef ?? text("noReference") })}<br />{workspace?.path} · {cockpit.matter.path || text("workspaceRoot")}</p>
            <Button disabled={openingSession || !connection?.client || !workspace || workspace.workspaceType === "remote" || Boolean(query.error)} onClick={() => void openTask()}>{openingSession ? text("openingConversation") : text("openTask")}</Button>
            {sessionError ? <p role="alert">{sessionError}</p> : null}
          </div>
          <MatterCockpit cockpit={cockpit} now={now} raw={raw.data ?? {}} />
        </>
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
  const { text } = useMatterText();
  return (
    <>
      <h1 className="lw-h1">{text("matter")}</h1>
      <p className="lw-empty">
        {vec ? (
          <>
            {text("matterNotFound", { path: vec })}
          </>
        ) : (
          <>
            {text("noMatters")} <Link to="/experimenty/novy-spis">{text("newMatter")}</Link>.
          </>
        )}
      </p>
      {found.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>{text("mattersInMemory")}</h2>
            <span className="lw-meta">{text("chooseOne", { count: found.length })}</span>
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
              <span className="lw-st">{text("open")}</span>
            </Link>
          ))}
        </div>
      ) : null}
    </>
  );
}

export const matterLink = (path: string): string => `/spis?vec=${encodeURIComponent(path)}`;

export function MatterCockpit({ cockpit, now, raw }: { cockpit: Cockpit; now: string; raw: Record<string, string> }) {
  const { locale, text } = useMatterText();
  const { matter } = cockpit;
  return (
    <>
      <h1 className="lw-h1">{matter.title}</h1>
      <p className="lw-lead">
        {cockpit.client ? <>{text("client")} <b>{cockpit.client}</b>. </> : null}
        {matter.matterRef ? <span className="lw-mono">{matter.matterRef}</span> : text("noMatterReference")}
        {matter.court ? ` · ${matter.court}` : ""}
        {matter.state ? ` · ${text("proceedingsState", { state: matter.state })}` : ""} · OKF:{" "}
        <b>{cockpit.okfValid ? text("valid") : text("withFindingsCount", { count: cockpit.attention.filter((r) => r.kind === "nález" || r.state === "neparsovateľné").length })}</b>
      </p>

      <div className="lw-obal">
        {cockpit.registers.map((r) => (
          <div key={r.id}>
            <span className="lw-sc">{text(`register.${r.id}`)}</span>
            <span className={`lw-v${r.id === "lehoty" && cockpit.deadlines.candidates.length > 0 ? " warn" : ""}`}>
              {r.count}
              <small>{registerNote(r.id, cockpit, text)}</small>
            </span>
          </div>
        ))}
        <div>
          <span className="lw-sc">{text("okfStatus")}</span>
          <span className={`lw-v${cockpit.okfValid ? "" : " warn"}`}>
            {cockpit.okfValid ? text("valid") : text("withFindings")}
            <small>{cockpit.unreadable.length > 0 ? text("unreadableCount", { count: cockpit.unreadable.length }) : text("allReadable")}</small>
          </span>
        </div>
      </div>

      <DeadlineStrip deadlines={[...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates]} now={now} />

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("attention")}</h2>
          <span className="lw-meta">{text("attentionNote")}</span>
        </div>
        {cockpit.attention.length === 0 ? (
          <p className="lw-empty">{text("noAttention")}</p>
        ) : (
          cockpit.attention.map((row, i) => <AttentionLine key={row.id} row={row} cockpit={cockpit} index={i} now={now} />)
        )}
      </div>

      {cockpit.registers.map((reg) => (
        <div className="lw-reg" key={reg.id}>
          <div className="lw-reg-h">
            <h2>{text(`register.${reg.id}`)}</h2>
            <span className="lw-meta">{registerNote(reg.id, cockpit, text)}</span>
          </div>
          <RegisterRows id={reg.id} cockpit={cockpit} now={now} />
        </div>
      ))}

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("recentEvents")}</h2>
          <span className="lw-meta">{text("eventsNote", { count: cockpit.events.length })}</span>
        </div>
        {cockpit.events.length === 0 ? (
          <p className="lw-empty">{text("noEvents")}</p>
        ) : (
          cockpit.events.slice(0, 12).map((e, i) => (
            <div className="lw-row lw-cols-leh" key={`${e.file}/${e.date}/${i}`}>
              <span className="lw-no">{i + 1}.</span>
              <span className="lw-d">{formatDay(e.date, locale)}</span>
              <span className="lw-t">
                {e.text}
                <small className="lw-mono">{e.file}</small>
              </span>
              <span className="lw-ref">{e.recordId}</span>
              <span className="lw-st">{e.kind ?? text("event")}</span>
            </div>
          ))
        )}
      </div>

      {cockpit.unreadable.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>{text("unreadableRecords")}</h2>
            <span className="lw-meta">{text("rawNote")}</span>
          </div>
          {cockpit.unreadable.map((p) => (
            <div key={p.path}>
              <div className="lw-status warn">
                <span className="lw-mono">{p.path}</span> — {p.message}
              </div>
              <pre className="lw-raw">{raw[p.path] ?? text("rawLoading")}</pre>
            </div>
          ))}
        </div>
      ) : null}

      <div className="lw-note">
        <span>
          {text("cockpitReadOnly")}
        </span>
        <span>
          {text("source")}: <span className="lw-mono">{matter.path}</span>
        </span>
      </div>
    </>
  );
}

function AttentionLine({ row, cockpit, index, now }: { row: AttentionRow; cockpit: Cockpit; index: number; now: string }) {
  const { locale, text } = useMatterText();
  const copy = attentionCopy(row, cockpit, text);
  return (
    <div className="lw-row lw-cols-wait">
      <span className="lw-no">{index + 1}.</span>
      <span className={row.date ? dayClass(row.date, now) : "lw-d"}>{row.date ? formatDay(row.date, locale) : cockpitLabel(row.kind, text)}</span>
      <span className="lw-t">
        {copy.title}
        <small>
          {copy.detail}
          {row.provenance ? ` · ${cockpitLabel(row.provenance, text)}` : ""}
        </small>
      </span>
      <span className="lw-ref" title={row.file}>
        {row.file.split("/").pop()}
      </span>
      <span className={`lw-st${row.state === "po termíne" || row.state === "neparsovateľné" ? " warn" : ""}`}>{cockpitLabel(row.state, text)}</span>
    </div>
  );
}

function RegisterRows({ id, cockpit, now }: { id: RegisterId; cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  if (id === "obal") {
    return (
      <>
        {cockpit.obal.map((f, i) => (
          <div className="lw-row lw-cols-leh" key={f.label}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{cockpitLabel(f.label, text)}</span>
            <span className="lw-t">
              <span className={f.missing ? "" : "lw-mono"}>{f.missing ? cockpitLabel(f.value, text) : f.value}</span>
              <small className="lw-mono">{cockpit.matter.cardPath ?? text("cardMissing")}</small>
            </span>
            <span className="lw-ref" />
            <span className={`lw-st${f.missing ? " warn" : ""}`}>{f.missing ? text("missingData") : text("recorded")}</span>
          </div>
        ))}
      </>
    );
  }
  if (id === "fakty") {
    if (cockpit.facts.length === 0) return <p className="lw-empty">{text("noFacts")}</p>;
    return (
      <>
        {cockpit.facts.map((f, i) => (
          <div className="lw-row lw-cols-leh" key={f.id}>
            <span className="lw-no">{i + 1}.</span>
            <span className="lw-d">{f.date ? formatDay(f.date, locale) : "—"}</span>
            <span className="lw-t">
              {f.title}
              <small>
                {cockpitLabel(f.kind, text)}
                {f.source ? ` · ${f.source}` : ` · ${text("noSource")}`}
                {f.locator ? ` · ${f.locator}` : ""}
              </small>
            </span>
            <span className="lw-ref" title={f.file}>
              {f.id}
            </span>
            <span className="lw-st">{cockpitLabel(f.provenance, text)}</span>
          </div>
        ))}
      </>
    );
  }
  if (id === "ulohy") {
    if (cockpit.tasks.length === 0) return <p className="lw-empty">{text("noTasks")}</p>;
    return (
      <>
        {cockpit.tasks.map((t, i) => (
          <div className="lw-row lw-cols-leh" key={t.id}>
            <span className="lw-no">{i + 1}.</span>
            <span className={t.due ? dayClass(t.due, now) : "lw-d"}>{t.due ? formatDay(t.due, locale) : text("noDue")}</span>
            <span className="lw-t">
              {t.title}
              <small className="lw-mono">{t.file}</small>
            </span>
            <span className="lw-ref">{t.assignee ?? "—"}</span>
            <span className={`lw-st${t.overdue ? " warn" : ""}`}>{t.overdue ? text("overdue") : text("openState")}</span>
          </div>
        ))}
      </>
    );
  }
  return (
    <>
      <DeadlineGroup title={text("confirmed")} rows={cockpit.deadlines.confirmed} now={now} empty={text("noConfirmed")} />
      <DeadlineGroup title={text("candidates")} rows={cockpit.deadlines.candidates} now={now} empty={text("noCandidates")} />
    </>
  );
}

function DeadlineGroup({ title, rows, now, empty }: { title: string; rows: readonly CockpitDeadline[]; now: string; empty: string }) {
  const { locale, text } = useMatterText();
  return (
    <>
      <p className="lw-empty">
        <b>{title}</b> · {rows.length === 0 ? empty : `${rows.length}`}
      </p>
      {rows.map((d, i) => (
        <div className="lw-row lw-cols-leh" key={`${d.recordId}/${d.date}`}>
          <span className="lw-no">{i + 1}.</span>
          <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
          <span className="lw-t">
            {d.title}
            <small>
              {d.source ?? text("noSource")} · <span className="lw-mono">{d.file}</span>
            </small>
          </span>
          <span className="lw-ref">{d.recordId}</span>
          <span className={`lw-st${d.overdue ? " warn" : ""}`}>{d.overdue ? text("overdue") : cockpitLabel(d.provenance, text)}</span>
        </div>
      ))}
    </>
  );
}

// ── pás lehôt ─────────────────────────────────────────────────────────────


/**
 * Jediný obrázok obrazovky: pás lehôt veci. Okno je od najstaršej lehoty (alebo
 * dneška) po najvzdialenejšiu (minimálne 14 dní dopredu). Plná značka =
 * zapísaná alebo overená lehota, čiarkovaná = kandidát od agenta.
 */
function DeadlineStrip({ deadlines: unsorted, now }: { deadlines: readonly CockpitDeadline[]; now: string }) {
  const { locale, text } = useMatterText();
  const deadlines = [...unsorted].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const dates = deadlines.map((d) => d.date).filter((d) => ISO_DAY.test(d));
  const from = dates.reduce((min, d) => (d < min ? d : min), now);
  const to = dates.reduce((max, d) => (d > max ? d : max), addDays(now, 14));
  const span = Math.max(daysBetween(from, to), 1);
  const x = (date: string): number => 20 + (daysBetween(from, date) / span) * 1120;

  return (
    <div className="lw-strip">
      <svg viewBox="0 0 1160 132" aria-label={text("stripLabel", { from: formatDay(from, locale), to: formatDay(to, locale) })}>
        <line x1="20" x2="1140" y1="92" y2="92" stroke="var(--lw-border-strong)" />
        <line x1={x(now)} x2={x(now)} y1="14" y2="92" stroke="var(--lw-accent)" strokeWidth="1.5" />
        <text x={x(now) + 6} y="24" fontSize="10.5" fill="var(--lw-accent)">
          {text("today")}
        </text>
        <text x="20" y="112" fontSize="11" fill="var(--lw-text-tertiary)">
          {formatDay(from, locale)}
        </text>
        <text x="1140" y="112" fontSize="11" textAnchor="end" fill="var(--lw-text-tertiary)">
          {formatDay(to, locale)}
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
                {formatDay(d.date, locale)} · {d.overdue ? text("overdue") : cockpitLabel(d.provenance, text)}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="lw-leg">
        <span className="t">{text("overdue")}</span>
        <span className="m">{text("humanConfirmed")}</span>
        <span className="k">{text("awaitingConfirmation")}</span>
      </div>
      {deadlines.length === 0 ? <p className="lw-empty">{text("noMatterDeadlines")}</p> : null}
    </div>
  );
}

// Portable cockpit values are stable data. Translate only known display labels,
// never matter titles, sources, history entries, state values or record contents.
type MatterText = ReturnType<typeof useMatterText>["text"];
const COCKPIT_LABELS: Readonly<Record<string, MatterTextKey>> = {
  "Spisová značka": "field.reference", "Súd / orgán": "field.court",
  "Jurisdikcia": "field.jurisdiction", "Stav konania": "field.state",
  "nie je v karte ani v zázname": "field.notRecorded", "záznam veci chýba": "field.noMatterRecord",
  "overené": "provenance.verified", "AI návrh": "provenance.ai", "zapísané": "recorded",
  "overenie neurčené": "provenance.unknown", "strojovo overené": "provenance.machine",
  "po termíne": "overdue", "blíži sa": "state.approaching", "neparsovateľné": "state.unparseable",
  "chýba údaj": "missingData", "bez prameňa": "noSource", "nespracované": "state.unprocessed",
  "spis": "kind.matter", "rozhodnutie": "kind.decision", "subjekt": "kind.subject",
  "otázka": "kind.question", "preverenie": "kind.screening", "tvrdenie": "kind.claim",
  "dôkaz": "kind.evidence", "úloha": "kind.task", "pravidlo": "kind.rule",
  "poučenie": "kind.lesson", "prameň": "kind.authority", "lehota": "kind.deadline",
  "nález": "kind.finding", "záznam": "kind.record",
};
function cockpitLabel(value: string, text: MatterText): string {
  const key = COCKPIT_LABELS[value];
  return key ? text(key) : value;
}
function registerNote(id: RegisterId, cockpit: Cockpit, text: MatterText): string {
  return text(`register.${id}Note`, {
    confirmed: cockpit.deadlines.confirmed.length, candidates: cockpit.deadlines.candidates.length,
  });
}
function attentionCopy(row: AttentionRow, cockpit: Cockpit, text: MatterText): { title: string; detail: string } {
  if (row.id === "status:manual") {
    const stale = /^Ručný stav z (\d{4}-\d{2}-\d{2}) je starší než pamäť/.exec(row.detail);
    return { title: text("attention.manualStatus"), detail: stale
      ? text("attention.manualStale", { date: stale[1] })
      : row.state === "chýba údaj" ? text("attention.manualUnknown") : row.detail };
  }
  if (row.id.startsWith("vstup:")) return { title: text("attention.pendingIntake", { id: row.id.slice(6) }), detail: row.detail };
  if (row.id.startsWith("nalez:obal:")) return {
    title: text("attention.fieldTitle", { field: cockpitLabel(row.id.slice("nalez:obal:".length), text) }), detail: text("attention.fieldDetail"),
  };
  if (row.id === "nalez:pamäť") return { title: text("attention.noMemory"), detail: text("attention.noMemoryDetail") };
  if (row.id.startsWith("nalez:prameň:")) {
    const fact = cockpit.facts.find((item) => item.id === row.id.slice("nalez:prameň:".length));
    if (fact) return { title: row.title, detail: text("attention.noSources", { kind: cockpitLabel(fact.kind, text) }) };
  }
  if (row.kind === "úloha") {
    const task = cockpit.tasks.find((item) => `uloha:${item.id}` === row.id);
    if (task) return { title: row.title, detail: task.assignee ? text("attention.assignee", { assignee: task.assignee }) : text("attention.noAssignee") };
  }
  if (row.kind === "lehota") {
    const deadline = [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates]
      .find((item) => `lehota:${item.recordId}:${item.date}` === row.id);
    if (deadline) return { title: row.title, detail: deadline.source ?? text("attention.record", { id: deadline.recordId }) };
  }
  return { title: row.title, detail: row.detail };
}
