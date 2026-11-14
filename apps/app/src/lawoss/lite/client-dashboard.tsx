/** @jsxImportSource react */
/**
 * Domov klienta v bežnom režime ako pasívny prehľad spisu (alfa 14, spec-klient.md): dlaždice s číslami, karty
 * prípadov so štítkami, „Čaká na vás“, krátky zoznam lehôt a pole chatu. Rovnaký vizuálny jazyk a diely ako Dnes
 * (`pages/today-page.tsx`); odvodenia sú čisté funkcie v `client-cards.ts` a `today-model.ts`. Žiadne nové čítanie,
 * žiadne nové akcie: práca ide cez chat. Režim Pokročilé ostáva pri `ClientOverviewView`.
 */
import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, Check, ChevronRight, Clock, Inbox, Info, MessageSquare, ShieldCheck } from "lucide-react";
import { t, type Language } from "@/i18n";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { MatterOverview, UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { formatDay } from "../okf/read-model";
import { deadlineText, dueTextFromDays } from "../okf/view-rules";
import { CARDS_SHOWN, caseCards, cardPill, clientDeadlineRows, kindBreakdown, openTaskTotal, phaseMissing, termTile, type CardPill, type CardStatus, type CaseCard, type InputCounts, type RecentChat, type TermTile } from "./client-cards";
import { caseDates, invalidCaseDates, waitingCounts, type TodayModel } from "./today-model";
import { CandidatesPanel, ModeSwitch, MonthCalendar, type ViewMode } from "./agenda-views";
import type { AgendaEvent } from "./agenda-model";
import { clientDeadlinesLink, LITE_INPUTS_PATH, liteDeadlineLink, liteMatterLink } from "./links";
import { focusLinkedFolders, useLinkedFoldersFocus } from "./linked-folders-view";
import { ChatBar, DayBox, DeadlineStrip, liteText, Skeleton } from "./pages/today-page";
import "./pages/client-dashboard.css";

/** Spec: najviac päť lehôt, zvyšok v registri lehôt klienta; tri posledné chaty. */
const DEADLINE_ROWS = 5;
const STRIP_DAYS = 14;

type Text = (key: string, params?: Record<string, string | number>) => string;

export function ClientDashboardView({ workspaceId, locale, todayIso, matters, deadlines, partial = false, deadlineEvidence, readFailed = false, kinds = {}, statuses = {}, inputs, inputsFailed = false, events, today: todayModel, foreignFolders = [], pending = false, chats, folders, chat = true }: {
  workspaceId: string; locale: Language; todayIso: string; matters: readonly MatterOverview[]; deadlines: readonly UpcomingDeadline[];
  partial?: boolean; deadlineEvidence?: { recorded: number; unrecorded: number }; readFailed?: boolean;
  kinds?: Readonly<Record<string, string>>; statuses?: Readonly<Record<string, CardStatus>>;
  inputs?: InputCounts | null; inputsFailed?: boolean; events?: readonly AgendaEvent[]; today?: TodayModel; foreignFolders?: readonly string[];
  /** Úlohy aplikácie sa ešte čítajú: počty, ktoré od nich závisia, ukážu kostru, nie nulu. */
  pending?: boolean;
  /** Posledné chaty klienta z bočného panela; bez nich (nenačítané) sa blok „Pokračovať“ neukáže. */
  chats?: readonly RecentChat[];
  /** Pripojené priečinky klienta: na konci stránky pod zbaleným riadkom. */
  folders?: ReactNode;
  /** Pole chatu dole (nie pri koreni praxe, kde by chat nemal klienta). */
  chat?: boolean;
}) {
  const text = liteText(locale);
  const [mode, setMode] = useState<ViewMode>("overview");
  const month = Boolean(events) && mode === "month";
  const cards = caseCards(matters, statuses, todayIso);
  const filing = todayModel ? todayModel.inputs.length : inputs?.unfiled ?? 0;
  const known = !partial && !readFailed;
  const suggestions = [text("client_chat_suggest_new"), ...(filing > 0 ? [text("chat_suggest_file")] : []), text("client_chat_suggest_deadlines")];
  return <section aria-label={text("client_overview_title")} data-lawoss-client-overview="" data-lawoss-lite="client" className="lw-client-home lw-klient">
    <div className="lw-klient-bar">
      <h2 className="lw-klient-title">{text("client_overview_title")}</h2>
      {events ? <ModeSwitch mode={mode} onChange={setMode} locale={locale} /> : null}
    </div>
    {partial ? <Quiet data={{ "data-lawoss-client-overview-partial": "" }} role="alert">{t("lawoss.practice.incomplete", locale)}</Quiet> : null}
    {foreignFolders.length ? <Quiet data={{ "data-lawoss-client-overview-foreign": "" }} role="note">{text("foreign_client_folders", { names: foreignFolders.join(", ") })}</Quiet> : null}

    {month && events ? <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="full" aside={<CandidatesPanel events={events} locale={locale} />} /> : <>
      <section className="lw-dnes-tiles lw-klient-tiles" aria-label={text("tiles_label")}>
        <TermTileView tile={termTile(matters, todayIso)} locale={locale} text={text} known={known} />
        <MattersTile workspaceId={workspaceId} matters={matters} kinds={kinds} text={text} />
        <WaitingTile model={todayModel} filing={filing} todayIso={todayIso} text={text} known={known} pending={pending} />
        {todayModel ? <DeadlineStrip deadlines={todayModel.deadlines} tasks={todayModel.tasks} todayIso={todayIso} locale={locale} text={text} compact /> : null}
      </section>

      <CaseCards cards={cards} kinds={kinds} todayIso={todayIso} locale={locale} text={text} />

      <div className="lw-dnes-cols lw-klient-cols">
        <WaitingPanel workspaceId={workspaceId} model={todayModel} filing={filing} todayIso={todayIso} text={text} pending={pending}
          inputs={inputs} inputsFailed={inputsFailed} evidence={matters.reduce((sum, m) => sum + m.counts.evidence, 0)} tasks={openTaskTotal(matters)} />
        <DeadlineList workspaceId={workspaceId} deadlines={deadlines} todayIso={todayIso} locale={locale} text={text} evidence={deadlineEvidence} readFailed={readFailed} />
      </div>

      {chats?.length ? <ContinueChats workspaceId={workspaceId} chats={chats} locale={locale} text={text} /> : null}
    </>}

    {folders ? <FoldersDisclosure workspaceId={workspaceId} text={text}>{folders}</FoldersDisclosure> : null}
    {chat ? <ChatBar text={text} suggestions={suggestions} projectId={workspaceId} /> : null}
  </section>;
}

/** Tichý riadok s ikonou namiesto odseku (neúplné čítanie, cudzie priečinky, neevidované lehoty). */
function Quiet({ children, data, role }: { children: ReactNode; data: Record<`data-${string}`, string | number>; role?: "alert" | "note" }) {
  return <p className="lw-dnes-quiet lw-klient-quiet" role={role} {...data}><Info aria-hidden size={13} />{children}</p>;
}

function TermTileView({ tile, locale, text, known }: { tile: TermTile; locale: Language; text: Text; known: boolean }) {
  if (tile.kind === "none") return <div className="lw-dnes-tile" data-lawoss-tile="nearest" data-state="none">
    <span className="lw-dnes-tile-label">{text("tile_nearest")}</span>
    <span className="lw-dnes-num" data-tone="muted">—</span>
    {known ? <span className="lw-dnes-tile-sub">{text("next_term_none")}</span> : null}
  </div>;
  return <Link className="lw-dnes-tile" to={liteMatterLink(tile.matter.path)} data-lawoss-tile="nearest" data-kind={tile.kind} data-state={tile.late ? "overdue" : "due"} data-tone={tile.tone}>
    <span className="lw-dnes-tile-label">{text("tile_nearest")}</span>
    {tile.late ? <span className="lw-dnes-num lw-dnes-num-word" data-tone="red">{text("tile_overdue")}</span>
      : <span className="lw-dnes-num" data-tone={tile.tone}>{tile.daysLeft}<small>{text("days_unit", { count: tile.daysLeft })}</small></span>}
    <span className="lw-dnes-tile-sub lw-dnes-tile-title" title={tile.title}>{tile.title}</span>
    <span className="lw-dnes-tile-sub" title={tile.matter.title}>{tile.matter.title}</span>
    <span className="lw-dnes-pill" data-tone={tile.kind === "work" ? "work" : "neutral"}>{text(tile.kind === "work" ? "origin_work" : "agenda_kind_deadline")}</span>
  </Link>;
}

function MattersTile({ workspaceId, matters, kinds, text }: { workspaceId: string; matters: readonly MatterOverview[]; kinds: Readonly<Record<string, string>>; text: Text }) {
  const breakdown = kindBreakdown(kinds, matters.map((m) => m.path));
  return <div className="lw-dnes-tile" data-lawoss-tile="matters" data-workspace={workspaceId}>
    <span className="lw-dnes-tile-label">{text("project_matters")}</span>
    <span className="lw-dnes-num">{matters.length}</span>
    {breakdown.length ? <span className="lw-dnes-tile-sub" data-lawoss-kinds="">{breakdown.map((kind) => `${kind.label} ${kind.count}`).join(" · ")}</span> : null}
  </div>;
}

/** Termíny a nečitateľné dátumy rovnako ako na Dnes, aby „Čaká na vás“ rátalo každú položku raz. */
function waitingFor(model: TodayModel | undefined, filing: number, todayIso: string) {
  const dates = model ? caseDates(model.tasks, todayIso, STRIP_DAYS, model.deadlines) : [];
  // Bez návrhov z agendy: dlaždica sa rovná trom číslam panela (na zaradenie, po termíne, na overenie).
  return waitingCounts({ inputs: filing, deadlines: model?.deadlines ?? [], dates, unreadable: model ? invalidCaseDates(model.tasks) : [] });
}

function WaitingTile({ model, filing, todayIso, text, known, pending }: { model?: TodayModel; filing: number; todayIso: string; text: Text; known: boolean; pending: boolean }) {
  const waiting = waitingFor(model, filing, todayIso);
  const parts = [{ count: waiting.filing, label: text("wait_filing") }, { count: waiting.overdue, label: text("wait_overdue") }, { count: waiting.verify, label: text("wait_verify") }]
    .filter((part) => part.count > 0).map((part) => `${part.count} ${part.label}`);
  return <div className="lw-dnes-tile" data-lawoss-tile="waiting" data-gold={!pending && waiting.total > 0 || undefined}>
    <span className="lw-dnes-tile-label">{text("tile_waiting")}</span>
    {pending ? <Skeleton /> : waiting.total > 0 ? <>
      <span className="lw-dnes-num" data-tone="gold">{waiting.total}</span>
      <span className="lw-dnes-tile-sub">{parts.join(" · ")}</span>
    </> : known ? <>
      <span className="lw-dnes-num" data-tone="green"><Check aria-hidden size={28} /></span>
      <span className="lw-dnes-tile-sub">{text("wait_none")}</span>
    </> : <span className="lw-dnes-num" data-tone="muted">—</span>}
  </div>;
}

function CaseCards({ cards, kinds, todayIso, locale, text }: { cards: readonly CaseCard[]; kinds: Readonly<Record<string, string>>; todayIso: string; locale: Language; text: Text }) {
  const [showAll, setShowAll] = useState(false);
  const shown = showAll ? cards : cards.slice(0, CARDS_SHOWN);
  const missing = phaseMissing(cards);
  return <section className="lw-klient-cases" aria-labelledby="lw-klient-cases">
    <h2 id="lw-klient-cases" className="lw-dnes-h2">{text("project_matters")}<span className="lw-klient-count">{cards.length}</span></h2>
    {cards.length === 0 ? <p className="lw-today-empty">{text("project_matters_empty")}</p> : <div className="lw-klient-grid">
      {shown.map((card) => <CaseCardView key={card.matter.path} card={card} kind={kinds[card.matter.path]} todayIso={todayIso} locale={locale} text={text} />)}
    </div>}
    {!showAll && cards.length > CARDS_SHOWN ? <button type="button" className="lw-dnes-secondary lw-klient-all" onClick={() => setShowAll(true)}>{text("cards_show_all", { count: cards.length })}</button> : null}
    {missing > 0 ? <p className="lw-dnes-quiet" data-lawoss-phase-missing={missing}><Info aria-hidden size={13} />{text("client_phase_missing", { count: missing })}</p> : null}
  </section>;
}

function PillView({ pill, locale, text }: { pill: CardPill; locale: Language; text: Text }) {
  switch (pill.kind) {
    case "invalid": return <span className="lw-dnes-pill" data-tone="red" data-kind="invalid">{`${`? ${pill.raw}`.trim()} · ${text("due_invalid")}`}</span>;
    case "late": return <span className="lw-dnes-pill" data-tone="red" data-kind={pill.term.kind} title={formatDay(pill.term.date, locale)}>{text("tile_overdue")}</span>;
    case "due": return <span className="lw-dnes-pill" data-tone={pill.tone} data-kind={pill.term.kind} title={`${formatDay(pill.term.date, locale)} · ${text(pill.term.kind === "work" ? "origin_work" : "agenda_kind_deadline")}`}>{dueTextFromDays(pill.daysLeft, locale)}</span>;
    case "none": return <span className="lw-dnes-pill" data-tone="muted" data-kind="none">{text("card_no_date")}</span>;
  }
}

function CaseCardView({ card, kind, todayIso, locale, text }: { card: CaseCard; kind?: string; todayIso: string; locale: Language; text: Text }) {
  const { matter, status } = card;
  const meta = [matter.matterRef, matter.court].filter(Boolean).join(" · ");
  return <Link to={liteMatterLink(matter.path)} className="lw-dnes-card lw-klient-card" title={matter.title}>
    <span className="lw-dnes-card-top">
      {kind ? <span className="lw-dnes-pill lw-klient-kind" data-lawoss-matter-kind="" title={kind}>{kind}</span> : <span />}
      <PillView pill={cardPill(card, todayIso)} locale={locale} text={text} />
    </span>
    <span className="lw-klient-card-head">
      <b className="lw-dnes-card-title">{matter.title}</b>
      {meta ? <span className="lw-klient-ref">{meta}</span> : null}
    </span>
    {status.phase ? <span className="lw-klient-phase" title={text("card_phase")}>
      <span className="sr-only">{text("card_phase")}: </span>{status.phase}
      {status.stale ? <span className="lw-case-stale">{text("card_phase_stale")}</span> : null}
    </span> : null}
    {status.nextStep || matter.openTasks.length ? <span className="lw-klient-foot">
      {status.nextStep ? <span className="lw-klient-next" title={status.nextStep}><ArrowRight aria-hidden size={13} /><span className="sr-only">{text("card_next_step")}: </span>{status.nextStep}</span> : <span />}
      {matter.openTasks.length ? <small>{text("tasks_short")} {matter.openTasks.length}</small> : null}
    </span> : null}
  </Link>;
}

/** „Čaká na vás“: tri čísla ako na Dnes, pod nimi vstupy klienta a otvorené úlohy jedným riadkom. */
function WaitingPanel({ workspaceId, model, filing, todayIso, text, pending, inputs, inputsFailed, evidence, tasks }: { workspaceId: string; model?: TodayModel; filing: number; todayIso: string; text: Text; pending: boolean;
  inputs?: InputCounts | null; inputsFailed: boolean; evidence: number; tasks: number }) {
  const waiting = waitingFor(model, filing, todayIso);
  const deadlinesLink = clientDeadlinesLink(workspaceId);
  const minis = [
    { kind: "filing", to: LITE_INPUTS_PATH, count: waiting.filing, icon: <Inbox aria-hidden size={16} />, tone: "gold", label: text("wait_filing"), wait: false },
    { kind: "overdue", to: deadlinesLink, count: waiting.overdue, icon: <Clock aria-hidden size={16} />, tone: "red", label: text("wait_overdue"), wait: pending },
    { kind: "verify", to: deadlinesLink, count: waiting.verify, icon: <ShieldCheck aria-hidden size={16} />, tone: "amber", label: text("wait_verify"), wait: false },
  ];
  return <section className="lw-dnes-panel" aria-labelledby="lw-klient-waiting">
    <h2 id="lw-klient-waiting" className="lw-dnes-h2">{text("tile_waiting")}</h2>
    <div className="lw-dnes-minis">
      {minis.map((mini) => <Link key={mini.kind} className="lw-dnes-mini" to={mini.to} data-tone={mini.tone} data-zero={!mini.wait && mini.count === 0 || undefined} data-lawoss-waiting={mini.kind}>
        <span className="lw-dnes-mini-icon">{mini.icon}</span>
        {mini.wait ? <Skeleton small /> : <b>{mini.count}</b>}
        <span>{mini.label}</span>
      </Link>)}
    </div>
    {inputs !== undefined ? <InputsLine counts={inputs} failed={inputsFailed} evidence={evidence} text={text} /> : null}
    {tasks > 0 ? <Link className="lw-dnes-tasks-row lw-klient-tasks" to={deadlinesLink} data-lawoss-tasks-count={tasks}>
      <span>{text("tasks_row", { count: tasks })}</span>
      <span className="lw-dnes-tasks-link">{text("nav_deadlines_tasks")}<ArrowRight aria-hidden size={14} /></span>
    </Link> : null}
  </section>;
}

/** Vstupy z `VSTUPY.md` jedným riadkom; bez registra „neevidované“, nečitateľný register „nenačítané“, nie nula. */
function InputsLine({ counts, failed, evidence, text }: { counts: InputCounts | null; failed: boolean; evidence: number; text: Text }) {
  const total = counts ? counts.processed + counts.waiting + counts.unfiled : 0;
  return <p className="lw-klient-inputs" data-lawoss-inputs={counts ? total : failed ? "not_loaded" : "unrecorded"} data-lawoss-inputs-partial={counts && failed ? "" : undefined}>
    <span className="lw-klient-inputs-title">{text("inputs_ring_title")}</span>
    {counts ? <>
      <span><b>{counts.processed}</b> {text("inputs_processed")}</span>
      <span><b>{counts.waiting}</b> {text("inputs_waiting")}</span>
      <span><b>{counts.unfiled}</b> {text("inputs_unfiled")}</span>
    </> : <span>{text(failed ? "inputs_not_loaded" : "inputs_unrecorded")}</span>}
    <span>{text("client_overview_evidence")} <b>{evidence}</b></span>
    {counts && failed ? <span className="lw-klient-inputs-note" role="note">{text("inputs_partial")}</span> : null}
  </p>;
}

/** Lehoty klienta v štýle „Čo horí“: štvorček dní a štítok pôvodu, najviac päť, potom register lehôt klienta. */
function DeadlineList({ workspaceId, deadlines, todayIso, locale, text, evidence, readFailed }: { workspaceId: string; deadlines: readonly UpcomingDeadline[]; todayIso: string; locale: Language; text: Text;
  evidence?: { recorded: number; unrecorded: number }; readFailed: boolean }) {
  const { rows, more } = clientDeadlineRows(deadlines, todayIso, DEADLINE_ROWS);
  const unrecorded = !readFailed && evidence?.recorded === 0;
  return <section className="lw-dnes-panel" aria-labelledby="lw-klient-deadlines">
    <h2 id="lw-klient-deadlines" className="lw-dnes-h2">{text("client_overview_deadlines")}</h2>
    {rows.length === 0 ? <p className="lw-today-callout" data-lawoss-deadlines={readFailed ? "not_loaded" : unrecorded ? "unrecorded" : undefined}>
      <Info aria-hidden size={15} /><span>{text(readFailed ? "deadlines_not_loaded" : unrecorded ? "deadlines_unrecorded" : "client_overview_no_deadlines")}</span>
    </p> : <ul className="lw-dnes-list">
      {rows.map((row) => <li key={row.key}>
        <Link className="lw-dnes-item" data-kind="deadline" data-invalid={row.daysLeft === null || undefined}
          to={row.deadline.invalid ? liteMatterLink(row.deadline.matter.path) : liteDeadlineLink(row.deadline.matter.path, row.deadline.recordId, row.deadline.date)}>
          <DayBox daysLeft={row.daysLeft} tone={row.tone} text={text} />
          <span className="lw-dnes-item-text">
            <b title={deadlineText(row.deadline)}>{deadlineText(row.deadline)}</b>
            <span>{row.deadline.matter.title}{row.deadline.invalid ? <span className="lw-today-raw"> · {row.deadline.raw ?? row.deadline.date}</span> : <> · {formatDay(row.deadline.date, locale)}</>}</span>
          </span>
          <span className="lw-dnes-pill" data-tone={row.origin === "instruction" ? "amber" : "neutral"}>{text(row.origin === "instruction" ? "origin_instruction" : "origin_recorded")}</span>
        </Link>
      </li>)}
    </ul>}
    {/* #242: prípady bez evidovaných lehôt ostanú viditeľné tichým riadkom, aj keď iné prípady lehoty majú. */}
    {!readFailed && evidence && evidence.recorded > 0 && evidence.unrecorded > 0
      ? <p className="lw-dnes-quiet" data-lawoss-deadlines="partial"><Info aria-hidden size={13} />{text("deadlines_partial_note", { count: evidence.unrecorded })}</p> : null}
    <Link to={clientDeadlinesLink(workspaceId)} className="lw-dnes-more" data-lawoss-more="deadlines">{more > 0 ? `${text("more_items", { count: more })} · ` : ""}{text("client_deadlines_all")}</Link>
  </section>;
}

/** „Pokračovať“: posledné chaty klienta, ktoré už načítal bočný panel; dokumenty nie (nemajú poradie podľa času). */
function ContinueChats({ workspaceId, chats, locale, text }: { workspaceId: string; chats: readonly RecentChat[]; locale: Language; text: Text }) {
  const day = new Intl.DateTimeFormat(locale, { day: "numeric", month: "numeric" });
  return <section className="lw-dnes-panel lw-klient-continue" aria-labelledby="lw-klient-continue">
    <h2 id="lw-klient-continue" className="lw-dnes-h2">{text("continue_title")}</h2>
    <ul className="lw-dnes-list">
      {chats.map((item) => <li key={item.id}>
        <Link className="lw-dnes-item" to={workspaceSessionRoute(workspaceId, item.id)} data-lawoss-chat={item.id}>
          <span className="lw-dnes-mini-icon" aria-hidden><MessageSquare size={16} /></span>
          <span className="lw-dnes-item-text"><b title={item.title}>{item.title}</b></span>
          {item.updated ? <small className="lw-klient-when">{day.format(new Date(item.updated))}</small> : null}
        </Link>
      </li>)}
    </ul>
  </section>;
}

/** Pripojené priečinky na konci stránky, predvolene zbalené; panel ich otvorí („Pripojené priečinky“ v paneli). */
function FoldersDisclosure({ workspaceId, text, children }: { workspaceId: string; text: Text; children: ReactNode }) {
  const focused = useLinkedFoldersFocus() === workspaceId;
  const [open, setOpen] = useState(false);
  const shown = open || focused;
  return <section className="lw-klient-folders" data-lawoss-client-folders={shown ? "open" : "closed"}>
    <button type="button" className="lw-dnes-tasks-row lw-klient-folders-toggle" aria-expanded={shown} onClick={() => {
      // Otvorené z panela: zatvorenie zabudne aj zvýraznenie, inak by sa riadok hneď znova otvoril.
      if (shown && focused) focusLinkedFolders(null);
      setOpen(!shown);
    }}>
      <span>{text("linked_folders_title")}</span>
      <ChevronRight aria-hidden size={14} className="lw-klient-chevron" />
    </button>
    {shown ? <div className="lw-klient-folders-body">{children}</div> : null}
  </section>;
}
