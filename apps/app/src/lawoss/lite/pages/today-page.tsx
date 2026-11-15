/** @jsxImportSource react */
import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowRight, CalendarClock, Check, Clock, FolderPlus, Inbox, Info, ShieldCheck } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useQuery } from "@tanstack/react-query";
import { useOptionalLocal } from "@/react-app/kernel/local-provider";
import { PracticeMoveNotice } from "../../domains/practice-move-notice";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { resumeOnToday } from "../../domains/onboarding/resume";
import { OnboardingResumeCardView } from "../../domains/onboarding/resume-card";
import { litePageProps } from "../state-text";
import { addDays, formatDay, today, useOkfConnection, type OkfReadResult, type OkfScope } from "../../okf/read-model";
import { deadlineKey, deadlineText, dueTextFromDays, urgencyOf, type Urgency } from "../../okf/view-rules";
import { isOfficeFile } from "../../../../../../lawoss/okf/read";
import { deadlineCoverage } from "../../../../../../lawoss/okf/views";
import { adoptLink, appTodayTasks, buildToday, caseDates, continueCard, dayTone, hotRows, invalidCaseDates, nearestTile, taskLink, todayLead, waitingCounts, waitingLink, weekCounts, type CaseDate, type DayTone, type HotRow, type NearestTile, type TodayDeadline, type TodayLead, type TodayModel, type TodayTask } from "../today-model";
import { appTaskClient, inPractice, openAppTask, useAppTasks } from "../app-tasks";
import { agendaEvents, type AgendaEvent } from "../agenda-model";
import { CandidatesPanel, ModeSwitch, MonthCalendar, type ViewMode } from "../agenda-views";
import { LEHOTY_PATH, LITE_INPUTS_PATH, liteDeadlineLink, liteMatterLink } from "../links";
import { hotDeadlineCount, LiveStamp, useHotTitle, useMinuteTick } from "../live";
import { useMcpStatuses } from "../mcp-status-store";
import { registersSummary, type RegistersSummary } from "../sidebar-model";
import { settingsPath } from "../sidebar-footer";
import { requestHomePrefill } from "../home-prefill";
import { homeRoute } from "@/react-app/shell/workspace-routes";
import "./okf-glass.css";
import "./today.css";

const STRIP_DAYS = 14;
const STRIP_DOTS = 3;
const STRIP_TASK_DOTS = 2;
const TIP_ITEMS = 6;
/** Lehota alebo úloha zdieľaná viacerými vecami ukáže dve a „+N ďalšie". */
const MATTERS_SHOWN = 2;
/** Spec Dnes (alfa 14): tri karty „Pokračovať“ a päť riadkov „Čo horí“, zvyšok v Lehotách a úlohách. */
const MATTER_CARDS = 3;
const HOT_ROWS = 5;

export function TodayPage() {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const local = useOptionalLocal();
  // Profil z onboardingu: meno do pozdravu a karta nedokončeného nastavenia (#96). Bez cache, aby karta po dokončení hneď zmizla.
  const profile = useQuery({
    queryKey: ["lawoss-onboarding-profile", connection?.baseUrl ?? ""],
    enabled: Boolean(connection?.client),
    retry: false,
    staleTime: 0,
    queryFn: async () => (await connection?.client?.onboardingStatus())?.profile ?? null,
  });
  const resume = resumeOnToday(profile.data, local?.prefs.hasCompletedOnboarding ?? false, connection?.workspaces ?? [])
    ? <OnboardingResumeCardView locale={locale} />
    : null;
  // N-A7-1: nedokončený presun praxe sa ponúkne dokončiť (klienti sú už prepojení).
  return <OkfPage {...litePageProps(locale)} notice={<>{resume}<PracticeMoveNotice /></>}>
    {(data, meta, scope) => <TodayLive data={data} meta={meta} scope={scope} locale={locale} name={profile.data?.lawyerName || undefined} />}
  </OkfPage>;
}

function TodayLive({ data, meta, scope, locale, name }: { data: OkfReadResult; meta: OkfPageMeta; scope: OkfScope | null; locale: Language; name?: string }) {
  useMinuteTick(); // o polnoci nový „dnes", počas dňa nový pozdrav
  const now = today();
  // Model len pri novom obsahu pamäte alebo novom dni, nie pri každom tichom obnovení.
  const { connection } = useOkfConnection();
  // N-A5-4: úlohy aplikácie (Nová úloha) praxe patria na Dnes, do mesiaca aj na os (app-tasks.ts).
  const { tasks: rawAppTasks, complete: appTasksComplete, loading: appTasksLoading } = useAppTasks(connection);
  // Stav registrov z tej istej mapy ako pätka bočného panela; žiadne ďalšie čítanie MCP.
  const statuses = useMcpStatuses();
  // Spojenie sa obnovuje každých 15 s s novým poľom priečinkov: model sa prepočíta len pri skutočnej zmene.
  const workspacesKey = JSON.stringify(connection?.workspaces.map((w) => [w.id, w.path, w.displayNameResolved]) ?? []);
  const appTasks = useMemo(() => {
    const workspaces = connection?.workspaces ?? [];
    const belongs = scope ? inPractice(workspaces, scope) : () => true;
    return appTodayTasks(rawAppTasks.filter(belongs), appTaskClient(workspaces, scope, data.clients ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspacesKey nesie obsah connection.workspaces.
  }, [rawAppTasks, workspacesKey, scope, data.clients]);
  const model = useMemo(() => buildToday(data, now, undefined, appTasks), [data, now, appTasks]);
  const events = useMemo(() => agendaEvents(data, appTasks), [data, appTasks]);
  useHotTitle(hotDeadlineCount(data, now));
  // „Nič nehorí“ len po úplnom čítaní a pri evidovaných lehotách; inak to prehľad povie (UX P2 Denný prehľad).
  // Po prípadoch: jeden prípad s lehotami nerobí evidovanými ostatné (I-5b).
  // #271: nedočítaný zoznam úloh aplikácie robí prehľad neúplným rovnako ako nedočítaná pamäť.
  const evidence = useMemo(() => ({ complete: data.coverage.status === "complete" && appTasksComplete, ...deadlineCoverage(data.inputs) }), [data, appTasksComplete]);
  // #425: priečinky v `Klienti/` kancelárie, ktoré nie sú klientmi. Len zoznam priečinkov; nový zoznam po zmene klientov.
  const client = connection?.client;
  const unadopted = useQuery({
    queryKey: ["lawoss-unadopted-clients", connection?.baseUrl ?? "", workspacesKey],
    enabled: Boolean(client),
    retry: false,
    staleTime: 0,
    queryFn: async () => (await client?.lawossUnadoptedClients())?.folders ?? [],
  });
  return <TodayView model={model} locale={locale} meta={meta} name={name} evidence={evidence} events={events} activeId={connection?.activeWorkspaceId}
    registers={registersSummary(statuses)} pending={appTasksLoading} unadopted={unadopted.data} />;
}

type Text = (key: string, params?: Record<string, string | number>) => string;
/** Texty `lawoss.lite.*` pre zdieľané časti (časová os aj na Domove klienta). */
export const liteText = (locale: Language): Text => (key, params) => t(`lawoss.lite.${key}`, locale, params);


/** Naléhavost lhůty podle společných pravidel (view-rules), stejně jako v detailu věci. */
const urgency = (d: Pick<TodayDeadline, "date" | "invalid">, todayIso: string): Urgency => urgencyOf(d.date, todayIso, d.invalid);

function greetingKey(hour: number): string {
  if (hour < 10) return "greeting_morning";
  return hour < 18 ? "greeting_day" : "greeting_evening";
}

const parseDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
const longDate = (iso: string, locale: Language) =>
  new Intl.DateTimeFormat(locale, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(parseDay(iso));
const weekdayShort = (iso: string, locale: Language) =>
  new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(parseDay(iso)).replace(".", "");
const dayOfMonth = (iso: string) => parseDay(iso).getUTCDate();
const isWeekend = (iso: string) => [0, 6].includes(parseDay(iso).getUTCDay());
/** Postupné odhalení panelů; pořadí nese CSS proměnná. */
const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });

/**
 * Dnes ako pasívny prehľad spisu (alfa 14, spec-dnes.md): čísla, krátke riadky a štítky, žiadne nové akcie.
 * Práca ide cez chat; pole chatu dole len otvorí Domov s pripravenou vetou. Odvodenia sú v `today-model.ts`.
 */
export function TodayView({ model, locale, now = new Date(), meta, name, activeId, evidence, events, registers, pending = false, initialMode = "overview", unadopted = [] }: { model: TodayModel; locale: Language; now?: Date; meta?: OkfPageMeta; name?: string; activeId?: string | null;
  /** Úplnosť čítania a evidencia lehôt v podkladoch: bez nich prázdny zoznam nie je „nič nehorí“. */
  evidence?: { complete: boolean; recorded: number; unrecorded: number };
  /** Udalosti praxe pre mesiac (spec 0020); bez nich sa prepínač ani mesiac neukážu. */
  events?: readonly AgendaEvent[];
  /** Stav registrov ako v pätke bočného panela; neznámy stav (aj bez mapy stavov) dlaždicu neukáže, ako pätka. */
  registers?: RegistersSummary;
  /** Úlohy aplikácie sa ešte čítajú: počty, ktoré od nich závisia, ukážu kostru, nie nulu. */
  pending?: boolean;
  /** Režim po otvorení; voľba sa nepamätá (spec 0020). */
  initialMode?: ViewMode;
  /** #425: priečinky v `Klienti/` kancelárie, ktoré nie sú klientmi (na zavedenie). */
  unadopted?: readonly { path: string; name: string }[] }) {
  const text = liteText(locale);
  const greeting = text(greetingKey(now.getHours()));
  const [mode, setMode] = useState<ViewMode>(initialMode);
  const month = Boolean(events) && mode === "month";
  const todayIso = today(now);
  const dates = caseDates(model.tasks, todayIso, STRIP_DAYS, model.deadlines);
  // N-A7-4: úloha s nečitateľným dátumom je v „Čo horí“ navrchu s „overiť dátum“ (nie je v `caseDates`).
  const unreadable = invalidCaseDates(model.tasks);
  // #242 (rozhodnutie MČ č. 6): počet prípadov bez evidovaných lehôt je tichý riadok pod „Čo horí“, nikdy nezmizne.
  const unrecorded = evidence && evidence.complete && evidence.unrecorded > 0
    ? <p className="lw-dnes-quiet" data-lawoss-unrecorded={evidence.unrecorded}><Info aria-hidden size={13} />{text("deadlines_partial_note", { count: evidence.unrecorded })}</p>
    : null;
  return (
    <div className="lw-today lw-dnes" data-lawoss-lite="today">
      <header className="lw-today-hero" style={reveal(0)}>
        <div className="lw-today-hero-copy">
          <p className="lw-today-date">{longDate(todayIso, locale)}{meta ? <LiveStamp meta={meta} locale={locale} /> : null}</p>
          <h1 className="lw-today-greeting" title={name ? `${greeting}, ${name}` : greeting}><span>{greeting}</span>{name ? <span className="lw-today-name">, {name}</span> : null}</h1>
          <p className="lw-today-lead">{leadText(todayLead(model.deadlines, dates, evidence), locale, text)}</p>
        </div>
        <div className="lw-today-actions">
          {events ? <ModeSwitch mode={mode} onChange={setMode} locale={locale} /> : null}
          {/* #428: „+ Nový prípad“ preč, prípad sa zakladá vetou v chate. */}
        </div>
      </header>

      {month && events ? <>
        <div className="lw-today-month" style={reveal(1)}>
          <MonthCalendar events={events} todayIso={todayIso} locale={locale} variant="full" aside={<CandidatesPanel events={events} locale={locale} />} />
        </div>
        {unrecorded}
      </> : <>
        <Tiles model={model} dates={dates} unreadable={unreadable} todayIso={todayIso} locale={locale} text={text} evidence={evidence} events={events} registers={registers} activeId={activeId} pending={pending} unadopted={unadopted} />
        <DeadlineStrip deadlines={model.deadlines} tasks={model.tasks} todayIso={todayIso} locale={locale} text={text} />
        <div className="lw-dnes-cols">
          <HotList model={model} dates={dates} unreadable={unreadable} locale={locale} text={text} evidence={evidence} footer={unrecorded} />
          <WaitingPanel model={model} dates={dates} unreadable={unreadable} events={events} text={text} pending={pending} unadopted={unadopted} />
        </div>
        <ContinueSection model={model} todayIso={todayIso} locale={locale} text={text} />
      </>}

      <ChatBar text={text} suggestions={[text("chat_suggest_today"), ...(model.inputs.length > 0 ? [text("chat_suggest_file")] : []), text("chat_suggest_week")]} />
    </div>
  );
}

/** Jedna veta pod pozdravom (spec: bez počtu prípadov bez lehôt, ten je pod „Čo horí“). */
function leadText(lead: TodayLead, locale: Language, text: Text): string {
  switch (lead.kind) {
    case "deadline": return lead.item.invalid ? text("hero_invalid", { title: deadlineText(lead.item) })
      : lead.item.tier === "overdue" ? text("hero_overdue", { title: deadlineText(lead.item) })
      : text("hero_next", { title: deadlineText(lead.item), when: dueTextFromDays(lead.item.daysLeft, locale) });
    case "partial": return text("hero_partial");
    case "date": return text("hero_date_line", { title: lead.item.title, when: caseDateWhen(lead.item, locale, text) });
    case "unrecorded": return text("deadlines_unrecorded");
    case "quiet": return text("hero_quiet");
  }
}

type Shared = { model: TodayModel; dates: readonly CaseDate[]; unreadable: readonly TodayTask[]; text: Text };
type Unadopted = { unadopted: readonly { path: string; name: string }[] };

/** Štyri dlaždice: najbližšia lehota, tento týždeň, čaká na vás, registre. */
function Tiles({ model, dates, unreadable, todayIso, locale, text, evidence, events, registers, activeId, pending, unadopted }: Shared & Unadopted & { todayIso: string; locale: Language; evidence?: { complete: boolean }; events?: readonly AgendaEvent[]; registers?: RegistersSummary; activeId?: string | null; pending: boolean }) {
  const week = weekCounts(model.deadlines, dates, todayIso);
  const waiting = waitingCounts({ inputs: model.inputs.length, deadlines: model.deadlines, dates, unreadable, events, unadopted: unadopted.length });
  const known = evidence?.complete !== false;
  const parts = ([["filing", waiting.filing], ["overdue", waiting.overdue], ["verify", waiting.verify], ["confirm", waiting.confirm], ["adopt", waiting.adopt]] as const)
    .filter(([, count]) => count > 0).map(([kind, count]) => `${count} ${text(`wait_${kind}`)}`);
  return <section className="lw-dnes-tiles" style={reveal(1)} aria-label={text("tiles_label")}>
    <NearestTileView tile={nearestTile(model.deadlines, dates)} locale={locale} text={text} known={known} />
    <Link className="lw-dnes-tile" to={LEHOTY_PATH} data-lawoss-tile="week">
      <span className="lw-dnes-tile-label">{text("tile_week")}</span>
      {pending ? <Skeleton /> : <>
        <span className="lw-dnes-num">{week.deadlines}<small>{text("deadlines_unit", { count: week.deadlines })}</small></span>
        <span className="lw-dnes-tile-sub">{text("week_dates", { count: week.dates })}</span>
      </>}
    </Link>
    {/* Zlatá len keď niečo čaká; nula bez úplného čítania nie je „nič nečaká“. */}
    <Link className="lw-dnes-tile" to={waitingLink(waiting, adoptLink(unadopted))} data-lawoss-tile="waiting" data-gold={!pending && waiting.total > 0 || undefined}>
      <span className="lw-dnes-tile-label">{text("tile_waiting")}</span>
      {pending ? <Skeleton /> : waiting.total > 0 ? <>
        <span className="lw-dnes-num" data-tone="gold">{waiting.total}</span>
        <span className="lw-dnes-tile-sub">{parts.join(" · ")}</span>
      </> : known ? <>
        <span className="lw-dnes-num" data-tone="green"><Check aria-hidden size={28} /></span>
        <span className="lw-dnes-tile-sub">{text("wait_none")}</span>
      </> : <span className="lw-dnes-num" data-tone="muted">—</span>}
    </Link>
    <RegistersTile registers={registers} activeId={activeId} text={text} />
  </section>;
}

function NearestTileView({ tile, locale, text, known }: { tile: NearestTile; locale: Language; text: Text; known: boolean }) {
  if (tile.kind === "none") return <div className="lw-dnes-tile" data-lawoss-tile="nearest" data-state="none">
    <span className="lw-dnes-tile-label">{text("tile_nearest")}</span>
    <span className="lw-dnes-num" data-tone="muted">—</span>
    {known ? <span className="lw-dnes-tile-sub">{text("tile_none")}</span> : null}
  </div>;
  const deadline = tile.kind === "deadline" ? tile.item : null;
  const to = deadline ? deadline.invalid ? liteMatterLink(deadline.matter.path) : liteDeadlineLink(deadline.matter.path, deadline.recordId, deadline.date) : tile.kind === "work" ? taskLink(tile.item) : "";
  const title = deadline ? deadlineText(deadline) : tile.kind === "work" ? tile.item.title : "";
  const days = deadline ? deadline.daysLeft : tile.kind === "work" ? tile.item.daysLeft : 0;
  const late = tile.state === "overdue" || tile.state === "passed";
  return <Link className="lw-dnes-tile" to={to} onClick={tile.kind === "work" && tile.item.app ? openAppTask(tile.item.id) : undefined}
    data-lawoss-tile="nearest" data-state={tile.state} data-kind={tile.kind} data-tone={dayTone(tile.state === "invalid" ? null : days)}>
    {/* Pracovný termín nie je lehota: dlaždica ho tak aj nazve (štítok „pracovný termín“ ostáva). */}
    <span className="lw-dnes-tile-label">{text(tile.kind === "work" ? "tile_nearest_work" : "tile_nearest")}</span>
    {tile.state === "invalid" ? <span className="lw-dnes-num" data-tone="red">?<small>{text("due_invalid")}</small></span>
      : late ? <span className="lw-dnes-num lw-dnes-num-word" data-tone="red">{text("tile_overdue")}</span>
      : <span className="lw-dnes-num" data-tone={dayTone(days)}>{days}<small>{text("days_unit", { count: days })}</small></span>}
    <span className="lw-dnes-tile-sub lw-dnes-tile-title" title={title}>{title}</span>
    {tile.kind === "work" ? <span className="lw-dnes-pill" data-tone="work">{tile.item.app ? text("app_task") : text("origin_work")}</span> : null}
  </Link>;
}

/** Rovnaký stav a cieľ ako riadok registrov v bočnom paneli; neznámy stav nič netvrdí. */
function RegistersTile({ registers, activeId, text }: { registers?: RegistersSummary; activeId?: string | null; text: Text }) {
  // `null` mapa stavov znamená aj „priečinok nie je vybraný / čítanie zlyhalo“, nie len načítanie: bez kostry naveky.
  if (!registers || registers.state === "unknown") return null;
  const label = <span className="lw-dnes-tile-label">{text("tile_registers")}</span>;
  return <Link className="lw-dnes-tile" to={settingsPath(activeId, "extensions/mcp")} data-lawoss-tile="registers" data-state={registers.state}>
    {label}
    {registers.state === "failing"
      ? <><span className="lw-dnes-num" data-tone="amber">{registers.failing}<small>/{registers.total}</small></span><span className="lw-dnes-tile-sub">{text("tile_reg_failing", { count: registers.failing })}</span></>
      : <><span className="lw-dnes-num" data-tone={registers.state === "ready" ? "green" : "muted"}>{registers.ready}<small>/{registers.total}</small></span>
        <span className="lw-dnes-tile-sub">{text(registers.state === "ready" ? "tile_reg_ready" : "tile_reg_starting")}</span></>}
  </Link>;
}

/** „Čo horí“: lehoty a termíny do 14 dní, najviac päť riadkov, zvyšok v Lehotách a úlohách. */
function HotList({ model, dates, unreadable, locale, text, evidence, footer }: Shared & { locale: Language; evidence?: { complete: boolean; recorded: number }; footer: ReactNode }) {
  const { rows, more } = hotRows(model.deadlines, dates, unreadable, HOT_ROWS);
  const noRecorded = evidence?.complete === true && evidence.recorded === 0;
  return <section className="lw-dnes-panel" style={reveal(3)} aria-labelledby="lw-dnes-hot">
    <h2 id="lw-dnes-hot" className="lw-dnes-h2">{text("hot_title")}</h2>
    {rows.length === 0 ? evidence && !evidence.complete
      ? <Callout data="not_loaded">{text("deadlines_not_loaded")}</Callout>
      : noRecorded ? <Callout data="unrecorded">{text("deadlines_unrecorded")}</Callout>
      : <Empty text={text("deadlines_empty")} done={evidence?.complete === true} />
      : <>
        {noRecorded ? <p className="lw-dnes-quiet" data-lawoss-deadlines="unrecorded_dates"><Info aria-hidden size={13} />{text("deadlines_unrecorded")}</p> : null}
        <ul className="lw-dnes-list">
          {rows.map((row) => <li key={row.key}><HotRowView row={row} locale={locale} text={text} /></li>)}
        </ul>
      </>}
    {more > 0 ? <Link className="lw-dnes-more" to={LEHOTY_PATH} data-lawoss-more="hot">{text("more_items", { count: more })}</Link> : null}
    {footer}
  </section>;
}

function HotRowView({ row, locale, text }: { row: HotRow; locale: Language; text: Text }) {
  const title = row.kind === "deadline" ? deadlineText(row.item) : row.item.title;
  const place = row.kind === "deadline"
    ? isOfficeFile(row.item.file) ? text("scope_office") : matterList([{ title: row.item.matter.title, client: row.item.client }, ...(row.item.alsoIn ?? [])], text)
    : taskPlace(row.item, text);
  const to = row.kind === "deadline" ? row.item.invalid ? liteMatterLink(row.item.matter.path) : liteDeadlineLink(row.item.matter.path, row.item.recordId, row.item.date) : taskLink(row.item);
  const app = row.kind !== "deadline" && row.item.app;
  const pill = row.origin === "instruction" ? { tone: "amber", label: text("origin_instruction") }
    : row.origin === "work" ? { tone: "work", label: app ? text("app_task") : text("origin_work") }
    : { tone: "neutral", label: text("origin_recorded") };
  return <Link className="lw-dnes-item" to={to} onClick={app ? openAppTask(row.item.id) : undefined}
    data-kind={row.kind === "deadline" ? "deadline" : "case-date"} data-invalid={row.daysLeft === null || undefined}>
    <DayBox daysLeft={row.daysLeft} tone={row.tone} text={text} />
    <span className="lw-dnes-item-text">
      <b title={title}>{title}</b>
      <span>{place}{row.kind === "deadline" && row.item.invalid ? <span className="lw-today-raw"> · {row.item.raw ?? row.item.date}</span>
        : row.kind === "unreadable" ? <span className="lw-today-raw"> · {row.item.due}</span>
        : <> · {formatDay(row.kind === "deadline" ? row.item.date : row.item.due, locale)}</>}</span>
    </span>
    <span className="lw-dnes-pill" data-tone={pill.tone}>{pill.label}</span>
  </Link>;
}

/** Štvorček dní: číslo a jednotka; neplatný dátum „?“, po termíne „!“, dnes slovom (aj Domov klienta). */
export function DayBox({ daysLeft, tone, text }: { daysLeft: number | null; tone: DayTone; text: Text }) {
  const [value, unit] = daysLeft === null ? ["?", text("due_invalid")]
    : daysLeft < 0 ? ["!", text("tile_overdue")]
    : daysLeft === 0 ? ["0", text("due_today")]
    : [String(daysLeft), text("days_unit", { count: daysLeft })];
  return <span className="lw-dnes-dni" data-tone={tone} aria-hidden><b>{value}</b><span>{unit}</span></span>;
}

/** „Čaká na vás“: na zaradenie, po termíne, na overenie (a na potvrdenie, keď nejaký návrh je). Nula tlmene. */
function WaitingPanel({ model, dates, unreadable, events, text, pending, unadopted }: Shared & Unadopted & { events?: readonly AgendaEvent[]; pending: boolean }) {
  const waiting = waitingCounts({ inputs: model.inputs.length, deadlines: model.deadlines, dates, unreadable, events, unadopted: unadopted.length });
  // #425: len navigácia na zavedenie priečinka v sprievodcovi (advokát tam potvrdí pridanie súborov OKF).
  const adopt = adoptLink(unadopted);
  const tiles = [
    { kind: "filing", to: LITE_INPUTS_PATH, count: waiting.filing, icon: <Inbox aria-hidden size={16} />, tone: "gold", wait: false },
    { kind: "overdue", to: LEHOTY_PATH, count: waiting.overdue, icon: <Clock aria-hidden size={16} />, tone: "red", wait: pending },
    { kind: "verify", to: LEHOTY_PATH, count: waiting.verify, icon: <ShieldCheck aria-hidden size={16} />, tone: "amber", wait: false },
    ...(waiting.confirm > 0 ? [{ kind: "confirm", to: LEHOTY_PATH, count: waiting.confirm, icon: <CalendarClock aria-hidden size={16} />, tone: "gold", wait: false }] : []),
    ...(adopt && waiting.adopt > 0 ? [{ kind: "adopt", to: adopt, count: waiting.adopt, icon: <FolderPlus aria-hidden size={16} />, tone: "gold", wait: false }] : []),
  ];
  return <section className="lw-dnes-panel" style={reveal(4)} aria-labelledby="lw-dnes-waiting">
    <h2 id="lw-dnes-waiting" className="lw-dnes-h2">{text("tile_waiting")}</h2>
    <div className="lw-dnes-minis">
      {tiles.map((tile) => <Link key={tile.kind} className="lw-dnes-mini" to={tile.to} data-tone={tile.tone} data-zero={!tile.wait && tile.count === 0 || undefined}
        data-lawoss-waiting={tile.kind} {...(tile.kind === "filing" ? { "data-lawoss-inputs-count": tile.count } : {})}>
        <span className="lw-dnes-mini-icon">{tile.icon}</span>
        {tile.wait ? <Skeleton small /> : <b>{tile.count}</b>}
        <span>{text(`wait_${tile.kind}`)}</span>
      </Link>)}
    </div>
  </section>;
}

/** „Pokračovať“: tri naposledy živé prípady a zbalený riadok otvorených úloh. */
function ContinueSection({ model, todayIso, locale, text }: { model: TodayModel; todayIso: string; locale: Language; text: Text }) {
  if (model.recent.length === 0 && model.tasks.length === 0) return null;
  return <section className="lw-dnes-continue" style={reveal(5)} aria-labelledby="lw-dnes-continue">
    <h2 id="lw-dnes-continue" className="lw-dnes-h2">{text("continue_title")}</h2>
    {model.recent.length ? <div className="lw-dnes-cards">
      {model.recent.slice(0, MATTER_CARDS).map((matter) => {
        const card = continueCard(matter, todayIso);
        return <Link key={card.path} className="lw-dnes-card" to={liteMatterLink(card.path)}>
          <span className="lw-dnes-card-top">
            <span className="lw-dnes-card-client">{card.client ?? ""}</span>
            {card.next ? <span className="lw-dnes-pill" data-tone={card.next.kind === "work" ? "work" : card.next.tone}>
              {card.next.kind === "work" ? `${formatDay(card.next.date, locale)} · ${text("origin_work")}`
                : card.next.daysLeft <= 7 ? card.next.daysLeft === 0 ? text("due_today") : `${card.next.daysLeft} ${text("days_unit", { count: card.next.daysLeft })}`
                : formatDay(card.next.date, locale)}
            </span> : null}
          </span>
          <b className="lw-dnes-card-title">{card.title}</b>
          {card.state ? <span className="lw-dnes-pill" data-tone="neutral">{card.state}</span> : null}
          {card.line ? <span className="lw-dnes-card-line">{card.line.kind === "event" ? card.line.text : text("continue_tasks", { count: card.line.count })}</span> : null}
        </Link>;
      })}
    </div> : null}
    {model.tasks.length ? <Link className="lw-dnes-tasks-row" to={LEHOTY_PATH} data-lawoss-tasks-count={model.tasks.length}>
      <span>{text("tasks_row", { count: model.tasks.length })}</span>
      <span className="lw-dnes-tasks-link">{text("nav_deadlines_tasks")}<ArrowRight aria-hidden size={14} /></span>
    </Link> : null}
  </section>;
}

/**
 * Pole chatu: návrh ani Enter nič neodosiela, len otvorí Domov (nový chat) s vetou v poli správy. Z Dnes si klienta
 * advokát vyberie tam; z Domova klienta (`projectId`) je jeho klient na Domove už vybraný (`/home?project=`).
 * Veta ide cez pamäť (`home-prefill.ts`), nikdy cez adresu.
 */
/** Návrh v poli chatu: text na tlačidle a veta, ktorú pripraví (predvolene tá istá). */
export type ChatSuggestion = string | { label: string; text: string };

export function ChatBar({ text, suggestions, projectId, className }: { text: Text; suggestions: readonly ChatSuggestion[]; projectId?: string;
  /** Ďalšia trieda doku (Domov klienta: dok mimo sekcie prehľadu, pripnutý na celú stránku). */
  className?: string }) {
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const open = (value: string) => {
    if (!value.trim()) return;
    // Veta ide Domovu: pole sa vyprázdni, aby ju návrat na túto stránku neukázal znova (test alfy 14. 11.).
    setDraft("");
    requestHomePrefill(value);
    navigate(homeRoute(projectId));
  };
  return <div className={className ? `lw-dnes-dock ${className}` : "lw-dnes-dock"}><section className="lw-dnes-chat" aria-label={text("chat_label")} data-lawoss-chatbar="">
    <div className="lw-dnes-chat-suggest">
      {suggestions.map((suggestion) => {
        const { label, text: prefill } = typeof suggestion === "string" ? { label: suggestion, text: suggestion } : suggestion;
        return <button key={label} type="button" className="lw-dnes-suggest" onClick={() => open(prefill)}>{label}</button>;
      })}
    </div>
    <form className="lw-dnes-chat-field" onSubmit={(event) => { event.preventDefault(); open(draft); }}>
      <input value={draft} onChange={(event) => setDraft(event.target.value)} autoComplete="off" placeholder={text("chat_placeholder")} aria-label={text("chat_placeholder")} />
      <button type="submit" className="lw-dnes-chat-go" disabled={!draft.trim()} aria-label={text("chat_open")} title={text("chat_open")}><ArrowRight aria-hidden size={16} /></button>
    </form>
  </section></div>;
}

export function Skeleton({ small = false }: { small?: boolean }) {
  return <span className="lw-dnes-skel" data-small={small || undefined} aria-hidden data-lawoss-skeleton="" />;
}

/** Krátka poznámka s ikonou namiesto odseku textu (prázdne alebo neúplné lehoty). */
function Callout({ data, children }: { data: string; children: ReactNode }) {
  return <p className="lw-today-callout" data-lawoss-deadlines={data}><Info aria-hidden size={15} /><span>{children}</span></p>;
}

function Empty({ text, done = false }: { text: string; done?: boolean }) {
  return <p className="lw-today-empty">{done ? <Check aria-hidden size={15} /> : null}{text}</p>;
}

/** Kedy je termín: uplynulý termín nie je „po lehote“ (lehota je evidovaná zvlášť), inak „zajtra“, „o 5 dní“. */
function caseDateWhen(d: CaseDate, locale: Language, text: Text): string {
  return d.daysLeft < 0 ? text("case_date_passed") : dueTextFromDays(d.daysLeft, locale);
}

/**
 * Jeden diagram, který nese informaci: 14 dní, dnešek, lhůty jako body podle naléhavosti. Úlohy ukáže ako termíny
 * z prípadov (`caseDates`, #251) na Dnes aj na Domove klienta: záznam s lehotou v ten istý deň nie je dvakrát.
 */
export function DeadlineStrip({ deadlines, tasks, todayIso, locale, text, compact = false }: { deadlines: readonly TodayDeadline[]; tasks: readonly TodayTask[]; todayIso: string; locale: Language; text: Text;
  /** Malý pás v dlaždici (Domov klienta v bežnom režime): tie isté dni a bodky, nadpis ako popis dlaždice. */
  compact?: boolean }) {
  const dates = caseDates(tasks, todayIso, STRIP_DAYS, deadlines);
  const overdue = deadlines.filter((d) => !d.invalid && d.tier === "overdue");
  const days = Array.from({ length: STRIP_DAYS }, (_, i) => addDays(todayIso, i));
  const cells: { key: string; label: string; day: string; items: TodayDeadline[]; due: TodayTask[]; today?: boolean; weekend?: boolean; overdue?: boolean }[] = [
    ...(overdue.length ? [{ key: "overdue", label: text("overdue"), day: "!", items: overdue, due: [], overdue: true }] : []),
    ...days.map((iso, i) => ({
      key: iso,
      label: i === 0 ? text("strip_today") : weekdayShort(iso, locale),
      day: String(dayOfMonth(iso)),
      items: deadlines.filter((d) => !d.invalid && d.date === iso),
      due: dates.filter((date) => date.due === iso),
      today: i === 0,
      weekend: isWeekend(iso),
    })),
  ];
  return (
    <section className="lw-today-strip" style={reveal(1)} aria-label={text("strip_title")} data-compact={compact || undefined}>
      <h2 className={compact ? "lw-dnes-tile-label" : "lw-today-section-title"}>{text("strip_title")}</h2>
      <ol className="lw-today-days">
        {cells.map((cell) => {
          const hidden = Math.max(0, cell.items.length - STRIP_DOTS) + Math.max(0, cell.due.length - STRIP_TASK_DOTS);
          const tips = [
            ...cell.items.map((d, i) => <span key={`${d.matter.path}/${deadlineKey(d, i)}`}><b>{deadlineText(d)}</b>{d.matter.title}</span>),
            ...cell.due.map((task) => <span key={task.key} data-kind="task"><b>{task.title}</b>{task.app ? taskPlace(task, text) : task.matters.map((m) => m.title).join(" · ")}</span>),
          ];
          const body = <>
            <span className="lw-today-dow">{cell.label}</span>
            <span className="lw-today-dom">{cell.day}</span>
            <span className="lw-today-dots" aria-hidden>
              {cell.items.slice(0, STRIP_DOTS).map((d, i) => <i key={`${d.matter.path}/${deadlineKey(d, i)}`} data-urgency={urgency(d, todayIso)} />)}
              {cell.due.slice(0, STRIP_TASK_DOTS).map((task) => <i key={task.key} data-kind="task" />)}
              {hidden > 0 ? <em className="lw-today-dots-more">+{hidden}</em> : null}
            </span>
            {tips.length ? <span className="lw-today-tip" role="tooltip">
              {tips.slice(0, TIP_ITEMS)}
              {tips.length > TIP_ITEMS ? <span className="lw-today-tip-more">{text("more_items", { count: tips.length - TIP_ITEMS })}</span> : null}
            </span> : null}
          </>;
          const lead = cell.items[0];
          const target = lead ? liteDeadlineLink(lead.matter.path, lead.recordId, lead.date) : cell.due[0] && (cell.due[0].app || cell.due[0].matters[0]) ? taskLink(cell.due[0]) : undefined;
          const open = !lead && cell.due[0]?.app ? openAppTask(cell.due[0].id) : undefined;
          const names = [...cell.items.map(deadlineText), ...cell.due.map((task) => task.title)];
          return (
            <li key={cell.key} className="lw-today-day" data-today={cell.today || undefined} data-weekend={cell.weekend || undefined} data-overdue={cell.overdue || undefined} data-busy={names.length > 0 || undefined}>
              {target ? <Link to={target} onClick={open} aria-label={`${cell.label} ${cell.day}: ${names.join(", ")}`}>{body}</Link> : <span>{body}</span>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Kde úloha patrí: prípady úlohy z pamäte, pri úlohe aplikácie jej klient (N-A5-4). */
function taskPlace(task: Pick<TodayTask, "matters" | "app">, text: Text): string {
  return task.app ? task.app.client ? `${text("app_task")} · ${task.app.client}` : text("app_task") : matterList(task.matters, text);
}

function matterList(matters: readonly { title: string; client?: string }[], text: Text): string {
  // N-A5-9 a spec Dnes: „klient · prípad“, aby riadok bez mena klienta nebol „zákazka SYN-00xx“ bez súvislosti.
  const shown = matters.slice(0, MATTERS_SHOWN).map((m) => m.client ? `${m.client} · ${m.title}` : m.title).join(", ");
  return matters.length > MATTERS_SHOWN ? `${shown}, ${text("more_items", { count: matters.length - MATTERS_SHOWN })}` : shown;
}
