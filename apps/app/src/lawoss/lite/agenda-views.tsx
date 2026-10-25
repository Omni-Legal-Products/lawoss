/** @jsxImportSource react */
/**
 * Prepínač Prehľad / Mesiac a mesiac s agendou dňa (spec 0020). Jeden komponent pre Dnes aj Domov klienta;
 * rozsah určujú udalosti, ktoré dostane (`agenda-model.ts`). Iba čítanie a odkazy, nič nezapisuje.
 */
import { useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, ChevronRight, CircleDashed } from "lucide-react";
import { t, type Language } from "@/i18n";
import { formatDay } from "../okf/read-model";
import { AGENDA_KINDS, eventsByDay, monthOf, monthWeeks, shiftMonth, type AgendaEvent, type AgendaKind } from "./agenda-model";
import { openAppTask } from "./app-tasks";
import "./pages/agenda.css";

export type ViewMode = "overview" | "month";

const KIND_LABEL: Record<AgendaKind, string> = {
  deadline: "lawoss.lite.agenda_kind_deadline",
  work: "lawoss.lite.agenda_kind_work",
  candidate: "lawoss.lite.agenda_kind_candidate",
};
const FILTER_LABEL: Record<AgendaKind | "all", string> = {
  all: "lawoss.lite.agenda_filter_all",
  deadline: "lawoss.lite.agenda_filter_deadline",
  work: "lawoss.lite.agenda_filter_work",
  candidate: "lawoss.lite.agenda_filter_candidate",
};
/** V bunke veľkého mesiaca najviac toľko udalostí, zvyšok ako „+N“. */
const CELL_EVENTS = 3;

export function ModeSwitch({ mode, onChange, locale }: { mode: ViewMode; onChange: (mode: ViewMode) => void; locale: Language }) {
  const options: { id: ViewMode; label: string }[] = [
    { id: "overview", label: t("lawoss.lite.mode_overview", locale) },
    { id: "month", label: t("lawoss.lite.mode_month", locale) },
  ];
  return <div className="lw-mode" role="group" aria-label={t("lawoss.lite.mode_label", locale)} data-lawoss-mode={mode}>
    {options.map((option) => <button key={option.id} type="button" aria-pressed={mode === option.id} onClick={() => onChange(option.id)}>{option.label}</button>)}
  </div>;
}

const parseDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
const monthTitle = (month: string, locale: Language) =>
  new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(parseDay(`${month}-01`));
/** Skratky dní od pondelka (1. 1. 2024 bol pondelok). */
const weekdayNames = (locale: Language) => Array.from({ length: 7 }, (_, i) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(parseDay(`2024-01-0${i + 1}`)).replace(".", ""));

/**
 * `compact`: malý mesiac s bodkami a agendou vybraného dňa pod ním (Prehľad).
 * `full`: veľký mesiac s pomenovanými udalosťami, filtre typov a vpravo agenda dňa a `aside` (režim Mesiac).
 */
export function MonthCalendar({ events, todayIso, locale, variant, aside }: {
  events: readonly AgendaEvent[]; todayIso: string; locale: Language; variant: "compact" | "full"; aside?: ReactNode;
}) {
  const [month, setMonth] = useState(monthOf(todayIso));
  const [selected, setSelected] = useState(todayIso);
  const [filter, setFilter] = useState<AgendaKind | "all">("all");
  const shown = useMemo(() => filter === "all" ? events : events.filter((e) => e.kind === filter), [events, filter]);
  const days = useMemo(() => eventsByDay(shown), [shown]);
  const weeks = monthWeeks(month);
  const pick = (iso: string) => { setSelected(iso); if (monthOf(iso) !== month) setMonth(monthOf(iso)); };
  const calendar = <section className="lw-month" data-variant={variant} aria-label={monthTitle(month, locale)}>
    <header className="lw-month-head">
      <h2 className="lw-month-title">{monthTitle(month, locale)}</h2>
      <div className="lw-month-nav">
        {month !== monthOf(todayIso) ? <button type="button" className="lw-month-today" onClick={() => { setMonth(monthOf(todayIso)); setSelected(todayIso); }}>{t("lawoss.lite.month_today", locale)}</button> : null}
        <button type="button" aria-label={t("lawoss.lite.month_prev", locale)} onClick={() => setMonth(shiftMonth(month, -1))}><ChevronLeft aria-hidden size={16} /></button>
        <button type="button" aria-label={t("lawoss.lite.month_next", locale)} onClick={() => setMonth(shiftMonth(month, 1))}><ChevronRight aria-hidden size={16} /></button>
      </div>
    </header>
    {variant === "full" ? <div className="lw-month-filters" role="group" aria-label={t("lawoss.lite.agenda_filter_label", locale)}>
      {(["all", ...AGENDA_KINDS] as const).map((id) => <button key={id} type="button" aria-pressed={filter === id} data-kind={id} onClick={() => setFilter(id)}>{t(FILTER_LABEL[id], locale)}</button>)}
    </div> : null}
    <div className="lw-month-grid">
      <div className="lw-month-row lw-month-dow" aria-hidden>{weekdayNames(locale).map((name) => <span key={name}>{name}</span>)}</div>
      {weeks.map((week) => <div key={week[0]!.iso} className="lw-month-row">
        {week.map((day) => {
          const items = days.get(day.iso) ?? [];
          const label = `${formatDay(day.iso, locale)}${items.length ? `: ${items.map((e) => e.title).join(", ")}` : ""}`;
          return <button key={day.iso} type="button" className="lw-month-day" aria-label={label} aria-pressed={day.iso === selected}
            data-outside={day.inMonth ? undefined : ""} data-today={day.iso === todayIso ? "" : undefined} data-busy={items.length ? "" : undefined} onClick={() => pick(day.iso)}>
            <span className="lw-month-num">{parseDay(day.iso).getUTCDate()}</span>
            {variant === "compact"
              ? <span className="lw-month-dots" aria-hidden>{AGENDA_KINDS.filter((kind) => items.some((e) => e.kind === kind)).map((kind) => <i key={kind} data-kind={kind} />)}</span>
              : <span className="lw-month-events" aria-hidden>
                {items.slice(0, CELL_EVENTS).map((e) => <span key={e.key} data-kind={e.kind} title={e.title}>{e.title}</span>)}
                {items.length > CELL_EVENTS ? <em>+{items.length - CELL_EVENTS}</em> : null}
              </span>}
          </button>;
        })}
      </div>)}
    </div>
    <Legend locale={locale} />
  </section>;
  const agenda = <DayAgenda day={selected} items={days.get(selected) ?? []} todayIso={todayIso} locale={locale} />;
  if (variant === "compact") return <div className="lw-month-panel" data-lawoss-month="compact">{calendar}{agenda}</div>;
  return <div className="lw-month-layout" data-lawoss-month="full">
    <div className="lw-month-panel">{calendar}</div>
    <div className="lw-month-side">
      <div className="lw-month-panel">{agenda}</div>
      {aside}
    </div>
  </div>;
}

function Legend({ locale }: { locale: Language }) {
  return <ul className="lw-month-legend">
    {AGENDA_KINDS.map((kind) => <li key={kind} data-kind={kind}><i aria-hidden />{t(KIND_LABEL[kind], locale)}</li>)}
  </ul>;
}

function DayAgenda({ day, items, todayIso, locale }: { day: string; items: readonly AgendaEvent[]; todayIso: string; locale: Language }) {
  return <section className="lw-agenda" aria-label={t("lawoss.lite.agenda_title", locale)} data-lawoss-agenda={day}>
    <h3 className="lw-agenda-title">
      <span>{day === todayIso ? t("lawoss.lite.strip_today", locale) : formatDay(day, locale)}</span>
      <small>{t("lawoss.lite.agenda_count", locale, { count: items.length })}</small>
    </h3>
    {items.length === 0 ? <p className="lw-agenda-empty">{t("lawoss.lite.agenda_day_empty", locale)}</p> : <ul>
      {items.map((e) => <li key={e.key}>
        <Link to={e.link} onClick={openAppTask(e.appTaskId)} className="lw-agenda-item" data-kind={e.kind}>
          <span className="lw-agenda-main">
            <span className="lw-agenda-name" title={e.title}>{e.title}</span>
            <small>{e.office ? t("lawoss.lite.scope_office", locale) : e.matter.title}</small>
          </span>
          <span className="lw-agenda-kind">{t(KIND_LABEL[e.kind], locale)}</span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}

/** Návrhy na potvrdenie (riadené lehoty bez potvrdenia); do lehôt sa nepočítajú. */
export function CandidatesPanel({ events, locale }: { events: readonly AgendaEvent[]; locale: Language }) {
  const candidates = events.filter((e) => e.kind === "candidate");
  return <section className="lw-month-panel lw-candidates" data-lawoss-candidates={candidates.length}>
    <h3 className="lw-agenda-title"><span><CircleDashed aria-hidden size={15} />{t("lawoss.lite.candidates_title", locale)}</span><small>{candidates.length}</small></h3>
    <p className="lw-agenda-note">{t("lawoss.lite.candidates_note", locale)}</p>
    {candidates.length === 0 ? <p className="lw-agenda-empty">{t("lawoss.lite.candidates_empty", locale)}</p> : <ul>
      {candidates.map((e) => <li key={e.key}>
        <Link to={e.link} className="lw-agenda-item" data-kind="candidate">
          <span className="lw-agenda-main"><span className="lw-agenda-name" title={e.title}>{e.title}</span><small>{e.matter.title}</small></span>
          <span className="lw-agenda-kind">{formatDay(e.date, locale)}</span>
        </Link>
      </li>)}
    </ul>}
  </section>;
}
