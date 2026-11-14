/** @jsxImportSource react */
/**
 * Vrch stránky Prípad v bežnom režime ako pasívny prehľad spisu (alfa 14, spec-pripad.md): štítky, tri dlaždice,
 * os priebehu, stĺpce „Lehoty a úlohy“ | „Čo vieme“ | „Strany“, rozhovory a pole chatu. Rovnaké diely ako Dnes
 * a Klient (today.css); odvodenia sú čisté funkcie v `matter-dashboard-model.ts`. Žiadne nové čítanie ani nové akcie:
 * rýchle akcie sú návrhy v poli chatu a správajú sa ako doteraz (`onAction`).
 */
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, Info, MessageSquare } from "lucide-react";
import { t, type Language } from "@/i18n";
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import type { MatterViews } from "../../../../../lawoss/okf/views";
import { formatDay } from "../okf/read-model";
import { deadlineText } from "../okf/view-rules";
import type { MatterConversation } from "./matter-conversations";
import type { MatterModelGap } from "./matter-model";
import { deadlinesEmpty, dockActions, factRows, matterAxis, matterNearest, matterRows, matterStage, matterWaiting, partyRows,
  type DashboardCockpit, type DeadlineOrigin, type MatterRow, type TimelineEntry } from "./matter-dashboard-model";
import { DayBox } from "./pages/today-page";

type Text = (key: string, params?: Record<string, string | number>) => string;
type ReadState = "fresh" | "failed";
const actions = dockActions();
export type DashboardActionId = (typeof actions.primary)[number]["id"] | (typeof actions.more)[number]["id"];

const ROWS = 5;
const FACTS = 4;
const PARTIES = 4;
const CHATS = 3;

const ORIGIN: Record<DeadlineOrigin, { key: string; tone: string }> = {
  instruction: { key: "origin_instruction", tone: "amber" },
  candidate: { key: "origin_candidate", tone: "gold" },
  recorded: { key: "origin_recorded", tone: "neutral" },
};

/** Tri dlaždice: najbližšia lehota alebo termín, kde vec stojí, čaká na vás. */
export function MatterTiles({ matter, cockpit, views, readState, todayIso, locale, text, onReveal }: { matter: Pick<MatterOverview, "deadlines" | "openTasks">; cockpit: DashboardCockpit | null; views?: MatterViews; readState: ReadState; todayIso: string; locale: Language; text: Text;
  /** Otvorí evidenciu a posunie sa na riadok lehoty (alebo len na evidenciu). */
  onReveal: (anchor?: string) => void }) {
  const known = readState === "fresh" && cockpit !== null;
  return <section className="lw-dnes-tiles lw-pripad-tiles" aria-label={text("tiles_label")}>
    <NearestTile matter={matter} todayIso={todayIso} locale={locale} text={text} known={known} onReveal={onReveal} />
    <StageTile views={views} readState={readState} text={text} />
    <WaitingTile cockpit={cockpit} listed={matter.deadlines} todayIso={todayIso} text={text} known={known} />
  </section>;
}

function NearestTile({ matter, todayIso, locale, text, known, onReveal }: { matter: Pick<MatterOverview, "deadlines" | "openTasks">; todayIso: string; locale: Language; text: Text; known: boolean; onReveal: (anchor?: string) => void }) {
  const term = matterNearest(matter, todayIso);
  if (term.kind === "none") return <div className="lw-dnes-tile" data-lawoss-tile="nearest" data-state="none">
    <span className="lw-dnes-tile-label">{text("tile_nearest")}</span>
    <span className="lw-dnes-num" data-tone="muted">—</span>
    {known ? <span className="lw-dnes-tile-sub">{text("next_term_none")}</span> : null}
  </div>;
  return <button type="button" className="lw-dnes-tile lw-pripad-tile-button" data-lawoss-tile="nearest" data-kind={term.kind} data-state={term.late ? "overdue" : "due"} data-tone={term.tone}
    onClick={() => onReveal(term.anchor)}>
    <span className="lw-dnes-tile-label">{text(term.kind === "work" ? "tile_nearest_work" : "tile_nearest")}</span>
    <span className="lw-pripad-num-row">
      {term.late ? <span className="lw-dnes-num lw-dnes-num-word" data-tone="red">{text("tile_overdue")}</span>
        : term.daysLeft === 0 ? <span className="lw-dnes-num lw-dnes-num-word" data-tone={term.tone}>{text("due_today")}</span>
        : <span className="lw-dnes-num" data-tone={term.tone}>{term.daysLeft}<small>{text("days_unit", { count: term.daysLeft })}</small></span>}
      <span className="lw-dnes-pill" data-tone={term.kind === "work" ? "work" : "neutral"}>{text(term.kind === "work" ? "origin_work" : "agenda_kind_deadline")}</span>
    </span>
    {/* Názov a dátum jedným riadkom (spec-lehoty.md B2): dlaždica je nízka ako na Dnes, dátum sa neskráti. */}
    <span className="lw-dnes-tile-sub lw-pripad-tile-line">
      <span className="lw-dnes-tile-title" title={term.title}>{term.title}</span>
      <span className="lw-pripad-tile-date">{formatDay(term.date, locale)}</span>
    </span>
  </button>;
}

function StageTile({ views, readState, text }: { views?: MatterViews; readState: ReadState; text: Text }) {
  const stage = matterStage(views, readState);
  return <div className="lw-dnes-tile lw-pripad-stage" data-lawoss-tile="stage" data-state={stage.missing ?? "recorded"}>
    <span className="lw-dnes-tile-label">{text("pripad_stage")}</span>
    {stage.phase ? <span className="lw-pripad-phase-row">
      <b className="lw-pripad-phase" title={stage.phase}><span className="sr-only">{text("card_phase")}: </span>{stage.phase}</b>
      {stage.stale ? <span className="lw-dnes-pill" data-tone="amber">{text("card_phase_stale")}</span> : null}
    </span> : <span className="lw-pripad-phase" data-muted="">{text(stage.missing === "not_loaded" ? "ov_not_loaded" : "pripad_phase_unrecorded")}</span>}
    {stage.nextStep ? <span className="lw-pripad-next" title={stage.nextStep}><ArrowRight aria-hidden size={14} /><span className="sr-only">{text("card_next_step")}: </span>{stage.nextStep}</span> : null}
  </div>;
}

function WaitingTile({ cockpit, listed, todayIso, text, known }: { cockpit: DashboardCockpit | null; listed: MatterOverview["deadlines"]; todayIso: string; text: Text; known: boolean }) {
  const waiting = cockpit ? matterWaiting(cockpit, listed, todayIso) : null;
  const parts = waiting ? ([["filing", waiting.filing], ["overdue", waiting.overdue], ["verify", waiting.verify], ["confirm", waiting.confirm]] as const)
    .filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${text(`wait_${kind}`)}`) : [];
  // Zlatá len keď niečo čaká; nula bez čerstvého čítania nie je „nič nečaká“.
  return <div className="lw-dnes-tile" data-lawoss-tile="waiting" data-gold={waiting && waiting.total > 0 || undefined} data-lawoss-waiting-total={waiting?.total}>
    <span className="lw-dnes-tile-label">{text("tile_waiting")}</span>
    {waiting && waiting.total > 0 ? <>
      <span className="lw-dnes-num" data-tone="gold">{waiting.total}</span>
      <span className="lw-dnes-tile-sub" title={parts.join(" · ")}>{parts.join(" · ")}</span>
    </> : known ? <>
      <span className="lw-dnes-num" data-tone="green"><Check aria-hidden size={28} /></span>
      <span className="lw-dnes-tile-sub">{text("wait_none")}</span>
    </> : <span className="lw-dnes-num" data-tone="muted">—</span>}
  </div>;
}

/** Vodorovná os priebehu; pod ňou celý priebeh (existujúci zoznam) zbalený. Bez udalostí sa blok nekreslí. */
export function MatterAxis({ timeline, eventCount, locale, text }: { timeline: readonly TimelineEntry[]; eventCount: number; locale: Language; text: Text }) {
  const { entries, hidden } = matterAxis(timeline, eventCount);
  if (entries.length === 0) return null;
  return <section className="lw-dnes-panel lw-pripad-axis" aria-labelledby="lw-pripad-axis">
    <h2 id="lw-pripad-axis" className="lw-dnes-h2">{text("pripad_course")}</h2>
    <ol className="lw-pripad-os">
      {entries.map((entry) => entry.kind === "today"
        ? <li key="today" data-today=""><span className="lw-pripad-os-date">{text("strip_today")}</span></li>
        : <li key={entry.key} data-future={entry.future || undefined} data-urgency={entry.urgency}>
          <span className="lw-pripad-os-date">{formatDay(entry.date, locale)}</span>
          <span className="lw-pripad-os-text" title={entry.text}>{entry.text}</span>
        </li>)}
    </ol>
    {hidden > 0 ? <details className="lw-pripad-all">
      <summary>{text("pripad_course_all")}</summary>
      <TimelineList entries={timeline} locale={locale} text={text} />
    </details> : null}
  </section>;
}

/** Zvislý zoznam priebehu (evidencia aj „Celý priebeh“). */
export function TimelineList({ entries, locale, text }: { entries: readonly TimelineEntry[]; locale: string; text: Text }) {
  return <ol className="lw-matter-axis">
    {entries.map((entry) => entry.kind === "today"
      ? <li key="today" className="lw-matter-axis-today"><span>{text("strip_today")}</span></li>
      : <li key={entry.key} data-future={entry.future || undefined} data-urgency={entry.urgency}>
        <span className="lw-matter-axis-date">{formatDay(entry.date, locale)}</span>
        <span className="lw-matter-axis-text">{entry.text}{entry.future ? <small>{text("matter_upcoming")}</small> : null}</span>
      </li>)}
  </ol>;
}

/** „Lehoty a úlohy“ | „Čo vieme“ | „Strany“; bez strán dva širšie stĺpce. */
export function MatterColumns({ matter, cockpit, views, readState, todayIso, locale, text, onReveal, onKnown, documentsHref }: { matter: Pick<MatterOverview, "deadlines">; cockpit: DashboardCockpit | null; views?: MatterViews; readState: ReadState; todayIso: string; locale: Language; text: Text;
  onReveal: (anchor?: string) => void;
  /** Prepne na záložku „Čo vieme“. */
  onKnown: () => void;
  /** Dokumenty klienta prípadu (natívne Súbory); bez priečinka klienta sa odkaz neukáže. */
  documentsHref?: string }) {
  const parties = partyRows(cockpit?.parties ?? [], PARTIES);
  return <div className="lw-pripad-cols" data-cols={parties.rows.length ? 3 : 2}>
    <TermsColumn cockpit={cockpit} listed={matter.deadlines} views={views} readState={readState} todayIso={todayIso} locale={locale} text={text} onReveal={onReveal} />
    <FactsColumn cockpit={cockpit} text={text} onKnown={onKnown} />
    {parties.rows.length ? <section className="lw-dnes-panel lw-pripad-col" aria-labelledby="lw-pripad-parties" data-lawoss-matter-parties="">
      <h2 id="lw-pripad-parties" className="lw-dnes-h2">{t("lawoss.matters.parties", locale)}</h2>
      <ul className="lw-dnes-list">
        {parties.rows.map((party, i) => <li key={`${party.file}/${party.recordId}/${i}`}><div className="lw-dnes-item" data-kind="party">
          <span className="lw-pripad-avatar" aria-hidden>{initials(party.name)}</span>
          <span className="lw-dnes-item-text"><b title={party.name}>{party.name}</b>{party.role ? <span>{party.role}</span> : null}</span>
        </div></li>)}
      </ul>
      <div className="lw-pripad-foot">
        {parties.more > 0 ? <button type="button" className="lw-dnes-more lw-pripad-link" onClick={() => onReveal()}>{text("more_items", { count: parties.more })}</button> : <span />}
        {documentsHref ? <Link className="lw-dnes-more lw-pripad-link" to={documentsHref} data-lawoss-matter-documents="">{text("nav_documents")}<ArrowRight aria-hidden size={13} /></Link> : null}
      </div>
    </section> : null}
  </div>;
}

function TermsColumn({ cockpit, listed, views, readState, todayIso, locale, text, onReveal }: { cockpit: DashboardCockpit | null; listed: MatterOverview["deadlines"]; views?: MatterViews; readState: ReadState; todayIso: string; locale: Language; text: Text; onReveal: (anchor?: string) => void }) {
  const { rows, more } = matterRows(cockpit, listed, todayIso, ROWS);
  const empty = deadlinesEmpty(readState, views);
  return <section className="lw-dnes-panel lw-pripad-col" aria-labelledby="lw-pripad-terms" data-lawoss-matter-terms="">
    <h2 id="lw-pripad-terms" className="lw-dnes-h2">{text("nav_deadlines_tasks")}</h2>
    {rows.length === 0 ? <p className="lw-dnes-quiet lw-pripad-empty" data-lawoss-deadlines={empty === "empty" ? undefined : empty}>
      <Info aria-hidden size={13} />{text(empty === "not_loaded" ? "deadlines_not_loaded" : empty === "unrecorded" ? "deadlines_unrecorded" : "deadlines_empty")}
    </p> : <ul className="lw-dnes-list">
      {rows.map((row) => <li key={row.key}><RowView row={row} locale={locale} text={text} onReveal={onReveal} /></li>)}
    </ul>}
    {more > 0 ? <button type="button" className="lw-dnes-more lw-pripad-link" onClick={() => onReveal()} data-lawoss-more="terms">{text("more_items", { count: more })}</button> : null}
  </section>;
}

function RowView({ row, locale, text, onReveal }: { row: MatterRow; locale: Language; text: Text; onReveal: (anchor?: string) => void }) {
  if (row.kind === "deadline") {
    const d = row.deadline;
    const origin = ORIGIN[row.origin];
    return <button type="button" className="lw-dnes-item" data-kind="deadline" data-invalid={row.daysLeft === null || undefined} onClick={() => onReveal(row.anchor)}>
      <DayBox daysLeft={row.daysLeft} tone={row.tone} text={text} />
      <span className="lw-dnes-item-text">
        <b title={deadlineText(d)}>{deadlineText(d)}</b>
        <span>{row.daysLeft === null ? <span className="lw-today-raw">? {d.date}</span> : formatDay(d.date, locale)}{d.source ? ` · ${d.source}` : ""}</span>
      </span>
      <span className="lw-dnes-pill" data-tone={origin.tone}>{text(origin.key)}</span>
    </button>;
  }
  // Úloha je len zobrazená: odškrtnutie a práca s ňou idú cez chat.
  const { task } = row;
  return <div className="lw-dnes-item" data-kind="task" data-invalid={row.daysLeft === null || undefined}>
    <DayBox daysLeft={row.daysLeft} tone={row.tone} text={text} />
    <span className="lw-dnes-item-text">
      <b title={task.title}>{task.title}</b>
      <span>{row.day ? `${formatDay(row.day, locale)}${row.time ? ` ${row.time}` : ""}` : <span className="lw-today-raw">{`? ${task.due?.trim() ?? ""}`.trim()}</span>}{task.assignee ? ` · ${task.assignee}` : ""}</span>
    </span>
    <span className="lw-dnes-pill" data-tone="work">{text("origin_work")}</span>
  </div>;
}

function FactsColumn({ cockpit, text, onKnown }: { cockpit: DashboardCockpit | null; text: Text; onKnown: () => void }) {
  const { rows, total } = factRows(cockpit?.facts ?? [], FACTS);
  return <section className="lw-dnes-panel lw-pripad-col" aria-labelledby="lw-pripad-facts" data-lawoss-matter-facts={total}>
    <div className="lw-pripad-head-row">
      <h2 id="lw-pripad-facts" className="lw-dnes-h2">{text("tab_known")}{total ? <span className="lw-pripad-count">{total}</span> : null}</h2>
      {total ? <button type="button" className="lw-dnes-more lw-pripad-link" onClick={onKnown}>{text("pripad_all")}</button> : null}
    </div>
    {rows.length === 0 ? <p className="lw-dnes-quiet lw-pripad-empty"><Info aria-hidden size={13} />{text("known_empty")}</p> : <ul className="lw-dnes-list">
      {rows.map(({ fact, verified, source }) => <li key={`${fact.file}/${fact.id}`}><div className="lw-dnes-item" data-kind="fact">
        <span className="lw-dnes-item-text"><b title={fact.title}>{fact.title}</b>{source ? <span title={source}>{source}</span> : null}</span>
        <span className="lw-dnes-pill" data-tone={verified ? "green" : "amber"}>{text(verified ? "fact_verified" : "verify")}</span>
      </div></li>)}
    </ul>}
  </section>;
}

/** Rozhovory o prípade: tri najnovšie, ostatné zbalené („všetky“); každý ide cez `onContinue` (overenie zdroja). */
export function MatterChats({ conversations, complete, disabled, onContinue, locale, text }: { conversations: readonly MatterConversation[]; complete: boolean; disabled: boolean;
  onContinue?: (conversation: MatterConversation) => void; locale: Language; text: Text }) {
  if (conversations.length === 0) return null;
  const item = (c: MatterConversation) => <li key={c.id}>
    <button type="button" className="lw-dnes-item lw-pripad-conv" disabled={disabled} onClick={() => onContinue?.(c)}>
      <span className="lw-dnes-mini-icon" aria-hidden><MessageSquare size={16} /></span>
      <span className="lw-dnes-item-text"><b className="lw-matter-conv-title" title={c.title ?? undefined}>{c.title ?? text("conversation_untitled")}</b></span>
      <small className="lw-pripad-when">{formatStamp(c.updated, locale)}</small>
      <span className="lw-matter-conv-go">{text("conversation_continue")}</span>
    </button>
  </li>;
  const rest = conversations.slice(CHATS);
  return <section className="lw-dnes-panel lw-pripad-chats" data-lawoss-lite="conversations" aria-labelledby="lw-pripad-chats">
    <h2 id="lw-pripad-chats" className="lw-dnes-h2">{text("conversations_title")}</h2>
    {complete ? null : <p className="lw-dnes-quiet lw-pripad-empty"><Info aria-hidden size={13} />{text("conversations_partial")}</p>}
    <ul className="lw-dnes-list">{conversations.slice(0, CHATS).map(item)}</ul>
    {rest.length ? <details className="lw-pripad-all">
      <summary>{text("conversations_all", { count: conversations.length })}</summary>
      <ul className="lw-dnes-list">{rest.map(item)}</ul>
    </details> : null}
  </section>;
}

/**
 * Pole chatu dole: rýchle akcie ako návrhy (štyri hlavné, ostatné pod „Ďalšie“) a voľný text. Všetko ide cez tie
 * isté kontroly ako doteraz (zdroj čerstvo prečítaný, nič nebeží, model pripojený); pridanie dokumentu ostáva aj
 * bez modelu. Nič sa neodosiela: otvorí sa nový chat prípadu s pripravenou správou.
 */
export function MatterDock({ text, locale, busy, sourceReady, modelGap, onAction, onAddDocument, onAsk, hint }: { text: Text; locale: Language;
  busy: DashboardActionId | "ask" | null; sourceReady: boolean; modelGap: MatterModelGap | null;
  onAction: (id: DashboardActionId) => void;
  /** Výber súborov („Pridať dokument“); bez neho ide „Pridať dokument“ ako pokyn asistentovi. */
  onAddDocument?: () => void;
  onAsk?: (request: string) => void;
  /** Krátky riadok o pretiahnutí súborov. */
  hint?: string }) {
  const [draft, setDraft] = useState("");
  const more = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    // „Ďalšie“ sa zavrie klikom mimo a klávesom Escape, ako bežná ponuka.
    const close = (event: Event) => {
      const menu = more.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target instanceof Node ? event.target : null)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  const blocked = !sourceReady || busy !== null;
  const run = (id: DashboardActionId) => id === "add_document" && onAddDocument ? onAddDocument() : onAction(id);
  const off = (id: DashboardActionId) => blocked || (modelGap !== null && !(id === "add_document" && onAddDocument));
  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (!onAsk || blocked || modelGap !== null || !draft.trim()) return;
    // Text ostáva v poli: keď sa chat nepodarí otvoriť, advokát o vetu nepríde (úspech presmeruje preč).
    onAsk(draft);
  };
  return <div className="lw-dnes-dock lw-pripad-dock"><section className="lw-dnes-chat" aria-label={text("chat_label")} data-lawoss-matter-chat="">
    <div className="lw-dnes-chat-suggest">
      {actions.primary.map((action) => <button key={action.id} type="button" className="lw-matter-action lw-dnes-suggest" disabled={off(action.id)} aria-busy={busy === action.id} onClick={() => run(action.id)}>{t(action.labelKey, locale)}</button>)}
      <details className="lw-matter-more lw-pripad-more" ref={more}>
        <summary className="lw-dnes-suggest">{text("matter_more")}</summary>
        <div className="lw-matter-more-list" aria-label={text("more_actions")}>
          {actions.more.map((action) => <button key={action.id} type="button" className="lw-matter-action" disabled={off(action.id)} aria-busy={busy === action.id}
            onClick={() => { if (more.current) more.current.open = false; run(action.id); }}>{t(action.labelKey, locale)}</button>)}
        </div>
      </details>
    </div>
    {onAsk ? <form className="lw-dnes-chat-field" onSubmit={submit}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={text("chat_placeholder")} aria-label={text("chat_placeholder")} />
      <button type="submit" className="lw-dnes-chat-go" disabled={blocked || modelGap !== null || !draft.trim()} aria-busy={busy === "ask"} aria-label={text("pripad_chat_go")} title={text("pripad_chat_go")}><ArrowRight aria-hidden size={16} /></button>
    </form> : null}
    {hint ? <p className="lw-pripad-hint">{hint}</p> : null}
  </section></div>;
}

const initials = (name: string) => name.split(/\s+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "·";

/** Deň a čas poslednej zmeny rozhovoru, napr. „št 24. 9. 14:32“. */
export function formatStamp(ms: number, locale: string): string {
  return ms ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : "-";
}
