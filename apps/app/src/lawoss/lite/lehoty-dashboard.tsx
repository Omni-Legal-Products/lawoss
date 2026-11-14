/** @jsxImportSource react */
/**
 * Lehoty a úlohy v bežnom režime ako pasívny prehľad (alfa 14, spec-lehoty.md, časť A): nadpis s tromi číslami,
 * vľavo zoznam v skupinách, vpravo mesiac, návrhy na potvrdenie a počty podľa klienta, dole pole chatu. Rovnaké diely
 * ako Dnes, Klient a Prípad (today.css); odvodenia sú čisté funkcie v `lehoty-model.ts`. Žiadne nové čítanie ani
 * akcie: filtre len menia zobrazenie (klient cez `?klient=`, ako doteraz), práca ide cez chat.
 */
import { useState, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Info } from "lucide-react";
import type { Language } from "@/i18n";
import { formatDay } from "../okf/read-model";
import type { AgendaEvent } from "./agenda-model";
import { CandidatesPanel, MonthCalendar } from "./agenda-views";
import { openAppTask } from "./app-tasks";
import { clientDeadlinesLink, LEHOTY_PATH } from "./links";
import { LEHOTY_KINDS, lehotyGroups, lehotySummary, type LehotyClient, type LehotyGroupId, type LehotyKind, type LehotyRow } from "./lehoty-model";
import { ChatBar, DayBox, liteText } from "./pages/today-page";
import "./pages/lehoty.css";

type Text = (key: string, params?: Record<string, string | number>) => string;

const ORIGIN: Record<LehotyRow["origin"], { key: string; tone: string }> = {
  recorded: { key: "origin_recorded", tone: "neutral" },
  instruction: { key: "origin_instruction", tone: "amber" },
  work: { key: "origin_work", tone: "work" },
  task: { key: "lehoty_origin_task", tone: "work" },
  candidate: { key: "origin_candidate", tone: "gold" },
};

export type LehotyDashboardProps = {
  title: string; locale: Language; todayIso: string;
  rows: readonly LehotyRow[]; undated: number; events: readonly AgendaEvent[];
  /** Klienti na výber; prázdny zoznam (jeden priečinok) výber neukáže. */
  clients: readonly LehotyClient[];
  /** Vybraný klient (`?klient=`), ak ho stránka naozaj zúžila; inak všetci. */
  clientId: string | null;
  /** Počty podľa klienta; len pri pohľade na všetkých klientov. */
  byClient?: readonly (LehotyClient & { count: number })[];
  /** Čítanie pamäte aj úloh appky je úplné: prázdny zoznam je „nič“, nie „nenačítané“. */
  complete: boolean;
  /** Úlohy appky sa ešte čítajú: počty od nich závisia, preto sa neukážu ako nula. */
  pending?: boolean;
  /** #242: prípady s evidovanými lehotami a bez nich. */
  coverage: { recorded: number; unrecorded: number };
  truncated?: number; unreadable?: number;
  /** Panel postupu lehôt (#168) pod zoznamom, s dnešnými podmienkami zobrazenia. */
  workflow?: ReactNode;
};

export function LehotyDashboard({ title, locale, todayIso, rows, undated, events, clients, clientId, byClient, complete, pending = false, coverage, truncated, unreadable, workflow }: LehotyDashboardProps) {
  const text = liteText(locale);
  const [kind, setKind] = useState<LehotyKind>("all");
  const [expanded, setExpanded] = useState<ReadonlySet<LehotyGroupId>>(new Set());
  const groups = lehotyGroups(rows, kind, expanded);
  const summary = lehotySummary(rows);
  const candidates = events.some((event) => event.kind === "candidate");
  const client = clientId ? clients.find((c) => c.id === clientId) : undefined;
  const suggestions = [
    text("lehoty_chat_week"),
    clientId ? text("client_chat_suggest_deadlines") : text("lehoty_chat_check"),
    { label: text("lehoty_chat_record"), text: text("lehoty_chat_record_text") },
  ];
  return <div className="lw-today lw-dnes lw-lehoty" data-lawoss-lite="deadlines" data-lawoss-client={clientId ?? undefined}>
    <header className="lw-lehoty-head">
      <h1 className="lw-lehoty-title">{title}</h1>
      <span className="lw-lehoty-info" title={text("lehoty_info")} aria-label={text("lehoty_info")} role="note"><Info aria-hidden size={15} /></span>
      <span className="lw-lehoty-pills" data-lawoss-summary="">
        {pending ? null : <>
          <span className="lw-dnes-pill" data-tone={summary.overdue > 0 ? "red" : undefined} data-lawoss-count="overdue">{text("lehoty_pill_overdue", { count: summary.overdue })}</span>
          <span className="lw-dnes-pill" data-lawoss-count="week">{text("lehoty_pill_week", { count: summary.week })}</span>
        </>}
        {summary.confirm > 0 ? <span className="lw-dnes-pill" data-tone="gold" data-lawoss-count="confirm">{text("lehoty_pill_confirm", { count: summary.confirm })}</span> : null}
      </span>
    </header>

    <div className="lw-lehoty-cols">
      <div className="lw-lehoty-main">
        <section className="lw-dnes-panel lw-lehoty-list" aria-label={title}>
          <Filters kind={kind} onKind={setKind} clients={clients} clientId={client ? client.id : null} text={text} />
          {groups.length === 0 ? <p className="lw-dnes-quiet lw-lehoty-empty" data-lawoss-deadlines={!complete ? "not_loaded" : coverage.recorded === 0 ? "unrecorded" : "empty"}>
            <Info aria-hidden size={13} />{text(!complete ? "deadlines_not_loaded" : coverage.recorded === 0 && kind !== "tasks" ? "deadlines_unrecorded" : "lehoty_empty")}
          </p> : groups.map((group) => <section key={group.id} className="lw-lehoty-group" data-group={group.id} aria-labelledby={`lw-lehoty-${group.id}`}>
            <h2 id={`lw-lehoty-${group.id}`} className="lw-lehoty-group-title">{text(`lehoty_group_${group.id}`)}<span className="lw-lehoty-count">{group.total}</span></h2>
            <ul className="lw-dnes-list">
              {group.rows.map((row) => <li key={row.key}><RowView row={row} locale={locale} text={text} /></li>)}
            </ul>
            {group.more > 0 ? <button type="button" className="lw-dnes-more lw-lehoty-all" data-lawoss-more={group.id}
              onClick={() => setExpanded(new Set([...expanded, group.id]))}>{text("lehoty_show_all", { count: group.total })}</button> : null}
          </section>)}
          {undated > 0 && kind !== "deadlines" ? <p className="lw-dnes-quiet" data-lawoss-undated={undated}><Info aria-hidden size={13} />{text("lehoty_undated", { count: undated })}</p> : null}
          {/* #242: prípady bez evidovaných lehôt ostanú viditeľné tichým riadkom, aj keď iné prípady lehoty majú. */}
          {coverage.recorded > 0 && coverage.unrecorded > 0 ? <p className="lw-dnes-quiet" data-lawoss-unrecorded={coverage.unrecorded}><Info aria-hidden size={13} />{text("deadlines_partial_note", { count: coverage.unrecorded })}</p> : null}
          {/* Ako Dnes: termíny a úlohy sú, ale žiadny prípad nemá evidované lehoty; prázdny zoznam to povie sám. */}
          {complete && coverage.recorded === 0 && groups.length > 0 ? <p className="lw-dnes-quiet" data-lawoss-deadlines="unrecorded_dates"><Info aria-hidden size={13} />{text("deadlines_unrecorded")}</p> : null}
          {truncated ? <p className="lw-dnes-quiet" data-lawoss-truncated={truncated} role="note"><Info aria-hidden size={13} />{text("lehoty_truncated", { count: truncated })}</p> : null}
          {unreadable ? <p className="lw-dnes-quiet" data-lawoss-unreadable={unreadable} role="note"><Info aria-hidden size={13} />{text("lehoty_unreadable", { count: unreadable })}</p> : null}
        </section>
        {workflow}
      </div>

      <aside className="lw-lehoty-side">
        <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="compact" />
        {candidates ? <CandidatesPanel events={events} locale={locale} /> : null}
        {byClient?.length ? <ByClient rows={byClient} text={text} /> : null}
      </aside>
    </div>

    <ChatBar text={text} suggestions={suggestions} projectId={client?.id} />
  </div>;
}

function Filters({ kind, onKind, clients, clientId, text }: { kind: LehotyKind; onKind: (kind: LehotyKind) => void; clients: readonly LehotyClient[]; clientId: string | null; text: Text }) {
  const navigate = useNavigate();
  return <div className="lw-lehoty-filters">
    <div className="lw-mode" role="group" aria-label={text("lehoty_kind_label")} data-lawoss-kind={kind}>
      {LEHOTY_KINDS.map((id) => <button key={id} type="button" aria-pressed={kind === id} onClick={() => onKind(id)}>{text(`lehoty_kind_${id}`)}</button>)}
    </div>
    {clients.length ? <label className="lw-lehoty-client">
      <span>{text("lehoty_client_label")}</span>
      <select value={clientId ?? ""} onChange={(event) => navigate(event.target.value ? clientDeadlinesLink(event.target.value) : LEHOTY_PATH)} data-lawoss-client-filter="">
        <option value="">{text("lehoty_client_all")}</option>
        {clients.map((client) => <option key={client.id} value={client.id}>{client.title}</option>)}
      </select>
    </label> : null}
  </div>;
}

function RowView({ row, locale, text }: { row: LehotyRow; locale: Language; text: Text }) {
  const origin = ORIGIN[row.origin];
  const place = row.place.office ? text("scope_office")
    : [row.place.client, row.place.matter].filter(Boolean).join(" · ") || (row.kind === "task" ? text("app_task") : "");
  const more = row.place.more > 0 ? `, ${text("more_items", { count: row.place.more })}` : "";
  // Úloha je len zobrazená (bez krúžku na odškrtnutie): klik ju otvorí, práca ide cez chat.
  return <Link className="lw-dnes-item lw-lehoty-item" to={row.link} onClick={openAppTask(row.appTaskId)}
    data-kind={row.kind} data-invalid={row.daysLeft === null || undefined}>
    <DayBox daysLeft={row.daysLeft} tone={row.tone} text={text} />
    <span className="lw-dnes-item-text">
      <b title={row.title}>{row.title}</b>
      <span>{place}{more}{row.date === null ? <span className="lw-today-raw"> · {row.raw}</span> : <> · {formatDay(row.date, locale)}</>}</span>
    </span>
    <span className="lw-dnes-pill" data-tone={origin.tone}>{text(origin.key)}</span>
  </Link>;
}

/** „Podľa klienta“: počet riadkov a pruh; klik nastaví filter klienta (`?klient=`). */
function ByClient({ rows, text }: { rows: readonly (LehotyClient & { count: number })[]; text: Text }) {
  const max = Math.max(...rows.map((row) => row.count));
  return <section className="lw-dnes-panel lw-lehoty-clients" aria-labelledby="lw-lehoty-clients">
    <h2 id="lw-lehoty-clients" className="lw-dnes-h2">{text("lehoty_by_client")}</h2>
    <ul>
      {rows.map((row) => <li key={row.id}>
        <Link to={clientDeadlinesLink(row.id)} data-lawoss-client-count={row.count}>
          <span className="lw-lehoty-client-name" title={row.title}>{row.title}</span>
          <span className="lw-lehoty-bar" aria-hidden><i style={{ width: `${Math.round((row.count / max) * 100)}%` }} /></span>
          <b>{row.count}</b>
        </Link>
      </li>)}
    </ul>
  </section>;
}
