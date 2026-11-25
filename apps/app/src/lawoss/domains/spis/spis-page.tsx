import { isRetiredRemoteWorkspace } from "@legalwork/types/workspace";
import { DiagnosticMessage } from "../../i18n/diagnostic-message";
import { okfRawFilesQueryOptions } from "../../okf/raw-files";
import { revalidateScopeTarget } from "../../okf/scope-target";
import { PracticeCoverage } from "../../okf/practice-coverage";
/** @jsxImportSource react */
import { deadlineText, dueTextFromDays } from "../../okf/view-rules";
import { useQuery } from "@tanstack/react-query";
import { useRef, useState, type ReactNode } from "react";
import { AlertTriangle, Check, Clock, FileText, Flag, Folder, PenLine, Scale, Search, ShieldCheck, User } from "lucide-react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { isExperimentHidden } from "../../feature-flags";
import { NEW_MATTER_PATH } from "../../lite/links";
import { useMatterText } from "../okf-page";
import type { MatterTextKey } from "../../i18n/matters";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { openMatterSession } from "../../okf/matter-session";

import { LawossLayout } from "../../shell/layout";
import {
  activeWorkspace,
  dayClass,
  formatDay,
  formatLongDay,
  today,
  useOkfConnection,
  useOkfOverview,
  useOkfScope,
  canActOnSource, localMatter,
} from "../../okf/read-model";
import {
  buildCockpit,
  type AttentionRow,
  type Cockpit,
  type CockpitDeadline,
  type RegisterId,
  screeningNeedsAttention,
} from "../../../../../../lawoss/okf/cockpit";
import { daysBetween, ISO_DAY, missingScopeLevels, scopeLevels, taskDue, type MatterInput, type MatterOverview } from "../../../../../../lawoss/okf/read";
import { clientOf } from "../../lite/today-model";
import { holidayJurisdiction } from "../../../../../../lawoss/okf/holidays";
import { deadlineTone, groupEvents, monthDays } from "../overview-model";
import { AlertBox, CalendarGrid, conclusionText, DayItems, eventKindText, riskText, Trust } from "../overview-views";
import "../overview.css";

/** Meno klienta prípadu pre drobčeky; prípad bez klienta (vlastný priečinok) žiadne nemá. */
const clientName = (matter: MatterOverview, input?: MatterInput): string | undefined => {
  const owner = clientOf(matter, input);
  return owner.key.startsWith("matter:") ? undefined : owner.name;
};

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
  const active = activeWorkspace(connection);
  // Prax „každý klient zvlášť“: odkaz z Prehľadu či Lehôt môže viesť k veci iného klienta (N1).
  const { scope } = useOkfScope(connection, active);
  const query = useOkfOverview(connection, scope);
  const data = query.data;
  const now = today();
  const cockpit = data ? buildCockpit(data, vec, now) : null;
  // Konverzácia beží v priečinku klienta veci, nikdy nad celou praxou.
  const local = scope && cockpit && data ? localMatter(scope, cockpit.matter, data.matters) : null;
  const workspace = local?.workspace ?? null;
  const raw = useQuery(okfRawFilesQueryOptions(connection, scope, cockpit?.unreadable.map((p) => p.path) ?? []));
  async function openTask() {
    if (opening.current || !connection || !workspace || !cockpit || !data || !canActOnSource(data, workspace.id) || query.error) return;
    opening.current = true; setOpeningSession(true); setSessionError("");
    try {
      const current = await revalidateScopeTarget(scope,connection,workspace.id);
      navigate(await openMatterSession(current.connection, current.workspace, local?.selected ?? cockpit.matter, local?.discovered ?? data.matters));
    }
    catch (failure) { setSessionError(failure instanceof Error ? failure.message : String(failure)); }
    finally { opening.current = false; setOpeningSession(false); }
  }

  return (
    <LawossLayout>
      {data ? <PracticeCoverage data={data} scope={scope} failed={query.isRefetchError} /> : null}
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
          <p className="lw-lead">{text("memoryLoading", { workspace: active?.displayNameResolved || active?.name || "" })}</p>
        </>
      ) : cockpit ? (
        <>
          <MatterCockpit cockpit={cockpit} now={now} raw={raw.data ?? {}} scopePaths={data?.inputs.find((i) => i.path === cockpit.matter.path)?.scopePaths}
            client={clientName(cockpit.matter, data?.inputs.find((i) => i.path === cockpit.matter.path))}
            action={<div className="space-y-2">
              <Button disabled={!data || !workspace || !canActOnSource(data,workspace.id) || openingSession || !connection?.client || !workspace || isRetiredRemoteWorkspace(workspace) || Boolean(query.error)} onClick={() => void openTask()}>{openingSession ? text("openingConversation") : text("openTask")}</Button>
              {sessionError ? <p role="alert">{sessionError}</p> : null}
            </div>} />
        </>
      ) : (
        <NotFound found={data ? data.matters.map((m) => ({ path: m.path, title: m.title })) : []} vec={vec} />
      )}
    </LawossLayout>
  );
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
            {text("noMatters")} <Link to={isExperimentHidden("view-novy-spis") ? NEW_MATTER_PATH : "/experimenty/novy-spis"}>{text("newMatter")}</Link>.
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

export function MatterCockpit({ cockpit, now, raw, scopePaths = [], client, action }: { cockpit: Cockpit; now: string; raw: Record<string, string>; scopePaths?: readonly string[];
  /** Meno klienta pre drobčeky (karta klienta alebo priečinok); bez neho sa drobčeky neukážu. */
  client?: string;
  /** Hlavná akcia stránky (otvoriť prácu v chate) vpravo od názvu. */
  action?: ReactNode }) {
  const { locale, text } = useMatterText();
  const { matter } = cockpit;
  const findings = cockpit.attention.filter((r) => r.kind === "nález" || r.state === "neparsovateľné").length;
  const clientName = client ?? cockpit.client;
  const field = (label: string) => cockpit.obal.find((f) => f.label === label);
  const jurisdiction = field("Jurisdikcia");
  const reference = field("Spisová značka");
  return (
    <div className="lw-x lw-sp">
      {clientName ? <div className="lw-sp-crumb" data-lawoss-crumb=""><Folder aria-hidden size={14} /><b>{clientName}</b><span aria-hidden>›</span><span>{text("breadcrumbMatters")}</span></div> : null}
      <div className="lw-sp-head">
        <div>
          <h1 className="lw-h1">{matter.title}</h1>
          <div className="lw-sp-chips">
            {matter.matterRef ? <span className="lw-x-pill lw-x-mono" data-tone="line" title={text("field.reference")}>{matter.matterRef}</span>
              : reference ? <span className="lw-x-pill" data-tone="amber">{text("missingField", { field: text("field.reference") })}</span>
              : <span className="lw-x-pill" data-tone="line">{text("noMatterReference")}</span>}
            {matter.court ? <span className="lw-x-pill" data-tone="line" title={matter.court}><Scale aria-hidden size={12} />{matter.court}</span> : null}
            {jurisdiction && !jurisdiction.missing ? <span className="lw-x-pill" data-tone="line" title={text("field.jurisdiction")}>{jurisdiction.value}</span> : null}
            {matter.state ? <span className="lw-x-pill" data-tone="line">{text("proceedingsState", { state: matter.state })}</span> : null}
            <span className="lw-x-pill" data-tone={cockpit.okfValid ? "green" : "amber"}>{cockpit.okfValid ? <Check aria-hidden size={12} /> : null}OKF: {cockpit.okfValid ? text("valid") : text("withFindingsCount", { count: findings })}
              {" · "}{cockpit.unreadable.length > 0 ? text("unreadableCount", { count: cockpit.unreadable.length }) : text("allReadable")}</span>
          </div>
        </div>
        {action ? <div className="lw-sp-action">{action}</div> : null}
      </div>

      <DeadlineHero cockpit={cockpit} now={now} />
      <MatterHealth cockpit={cockpit} now={now} />

      <div className="lw-sp-cols">
        <div className="lw-x-grid">
          <AttentionPanel cockpit={cockpit} now={now} />
          <FactsPanel cockpit={cockpit} />
        </div>
        <div className="lw-x-grid">
          <CoursePanel cockpit={cockpit} now={now} />
          <PartyCards parties={cockpit.parties} />
        </div>
      </div>

      <details className="lw-x-panel lw-sp-records" data-lawoss-case-records="">
        <summary><h2 className="lw-x-h2">{text("caseDetailsTitle")}<small>{text("caseDetailsNote")}</small></h2></summary>
        {cockpit.registers.map((reg) => (
          <div className="lw-reg" key={reg.id}>
            <div className="lw-reg-h">
              <h2>{text(REGISTER_TITLE[reg.id])}</h2>
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
            cockpit.events.map((e, i) => (
              <div className="lw-row lw-cols-leh" key={`${e.file}/${e.date}/${i}`}>
                <span className="lw-no">{i + 1}.</span>
                <span className="lw-d">{formatDay(e.date, locale)}</span>
                <span className="lw-t">
                  {e.text}
                  <small className="lw-mono">{e.file}</small>
                </span>
                <span className="lw-ref">{e.recordId}</span>
                <span className="lw-st">{e.kind ? eventKindText(e.kind, text) : text("event")}</span>
              </div>
            ))
          )}
        </div>
      </details>

      {cockpit.unreadable.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>{text("unreadableRecords")}</h2>
            <span className="lw-meta">{text("rawNote")}</span>
          </div>
          {cockpit.unreadable.map((p) => (
            <div key={p.path}>
              <div className="lw-status warn">
                <span className="lw-mono">{p.path}</span> — <DiagnosticMessage value={p} />
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
        {scopePaths.length > 0 ? <ul data-lawoss-scopes>{scopeLevels(scopePaths).map(({ path, level }) => (
          <li className="break-all" key={path} data-lawoss-scope={level}><b>{t(`lawoss.lite.scope_${level}`, locale)}</b> <span className="lw-mono">{path || "."}</span></li>
        ))}{missingScopeLevels(scopePaths).map((level) => (
          <li key={level} data-lawoss-scope-missing={level}><b>{t(`lawoss.lite.scope_${level}`, locale)}:</b> {t(`lawoss.lite.scope_${level}_missing`, locale)}</li>
        ))}</ul> : null}
      </div>
    </div>
  );
}

const REGISTER_TITLE: Readonly<Record<RegisterId, MatterTextKey>> = { obal: "register.obal", fakty: "register.fakty", ulohy: "register.ulohy", lehoty: "register.lehoty" };
const lastName = (file: string): string => file.split("/").filter(Boolean).pop() ?? file;
const byDay = (a: { date: string }, b: { date: string }): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Otvorené úlohy s platným termínom vzostupne, bez termínu na konci. */
function datedTasks(cockpit: Cockpit): { task: Cockpit["tasks"][number]; day?: string }[] {
  return cockpit.tasks.map((task) => ({ task, day: taskDue(task.due).day })).sort((a, b) => (a.day ?? "9999") < (b.day ?? "9999") ? -1 : (a.day ?? "9999") > (b.day ?? "9999") ? 1 : 0);
}

/** Najbližšia lehota s odpočtom, overením a zdrojom; vedľa mesiac s lehotami, termínmi úloh a udalosťami. */
function DeadlineHero({ cockpit, now }: { cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  const all = [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].sort(byDay);
  const valid = all.filter((d) => !d.invalid);
  const invalid = all.filter((d) => d.invalid);
  const nearest = valid.find((d) => d.date < now) ?? valid.find((d) => d.date >= now);
  const tasks = datedTasks(cockpit);
  const anchor = nearest?.date ?? now;
  const jurisdiction = holidayJurisdiction(cockpit.jurisdiction);
  const days = monthDays(anchor, now, jurisdiction ? [jurisdiction] : []);
  const month = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${anchor.slice(0, 7)}-01T00:00:00Z`));
  const groups = groupEvents(cockpit.events);
  const tone = nearest ? deadlineTone(nearest.date, now) : undefined;
  const left = nearest ? daysBetween(now, nearest.date) : 0;
  return <section className="lw-x-panel lw-sp-hero lw-x-section" aria-label={text("nearestDeadline")} data-lawoss-deadline-hero={nearest ? tone : "none"}>
    <div className="lw-sp-countdown">
      <span className="lw-x-muted" style={{ fontSize: 12 }}>{text("nearestDeadline")}</span>
      {nearest && tone ? <>
        <span className="lw-sp-big" data-tone={tone}>{left < 0 ? <b style={{ fontSize: 34 }}>{text("overdue")}</b> : left === 0 ? <b style={{ fontSize: 40 }}>{text("today")}</b> : <><b>{left}</b><span>{text("daysLeft", { count: left }).replace(/^\d+\s*/, "")}</span></>}</span>
        <span className="lw-sp-dl-title">{deadlineText(nearest)}</span>
        <span className="lw-x-muted" style={{ fontSize: 13 }}>{formatLongDay(nearest.date, locale)}</span>
        <Trust confirmed={nearest.confirmed} by={nearest.verifiedBy} at={nearest.verifiedAt} locale={locale} text={text} />
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {nearest.source ? <span className="lw-x-src" title={nearest.source}><FileText aria-hidden size={12} /><span>{nearest.source}</span></span> : null}
          <span className="lw-x-src" title={nearest.file}><span className="lw-x-mono">{nearest.recordId}</span><span>{lastName(nearest.file)}</span></span>
        </span>
      </> : <span className="lw-empty" style={{ padding: 0 }}>{text("noMatterDeadlines")}</span>}
      {invalid.map((d) => <span key={`${d.recordId}/${d.date}`} className="lw-x-pill" data-tone="amber">? {d.date} · {cockpitLabel("neparsovateľné", text)}</span>)}
      {tasks.length > 0 ? <div className="lw-sp-tasks">
        <span className="lw-x-muted">{text("register.ulohy")}</span>
        {tasks.map(({ task, day }) => <span key={task.id} className="lw-sp-task">
          <span className="lw-x-pill" data-tone={day ? (day < now ? "red" : deadlineTone(day, now) === "later" ? undefined : "amber") : undefined}>
            {day ? dueTextFromDays(daysBetween(now, day), locale) : task.invalid ? `? ${task.due ?? ""}` : text("noDue")}</span>
          <span title={task.title}>{task.title}{task.assignee ? <span className="lw-x-muted"> · {task.assignee}</span> : null}</span>
        </span>)}
      </div> : null}
    </div>
    <div style={{ minWidth: 0 }}>
      <div className="lw-sp-month-h"><b>{month.charAt(0).toLocaleUpperCase(locale) + month.slice(1)}</b>
        <div className="lw-x-legend">
          <span data-key="weekend"><i aria-hidden />{text("legend.weekend")}</span>
          {jurisdiction ? <span data-key="holiday"><i aria-hidden />{text("legend.holiday", { jurisdictions: jurisdiction.toUpperCase() })}</span> : null}
          <span data-key="event"><i aria-hidden />{text("event")}</span>
          <span data-key="confirmed"><i aria-hidden />{text("legend.confirmed")}</span>
          <span data-key="task"><i aria-hidden />{text("legend.task")}</span>
        </div>
      </div>
      <CalendarGrid days={days} locale={locale} todayLabel={text("today")} holidayLabel={text("holiday")} size="small" label={month} renderDay={(day) => <DayItems max={2}
        more={(count) => text("calendarMore", { count })}
        items={[
          ...valid.filter((d) => d.date === day.iso).map((d) => <span key={`d/${d.recordId}/${d.date}`} className="lw-x-ev" data-kind="deadline" data-tone={deadlineTone(d.date, now)}
            data-confirmed={d.confirmed || undefined} title={deadlineText(d)}><span>{deadlineText(d)}</span></span>),
          ...tasks.filter((x) => x.day === day.iso).map(({ task }) => <span key={`t/${task.id}`} className="lw-x-ev" data-kind="task" data-tone={task.overdue ? "overdue" : undefined} title={task.title}><span>{task.title}</span></span>),
          ...groups.filter((g) => g.date === day.iso).map((g) => <span key={`e/${g.key}`} className="lw-x-ev" data-kind="event" title={g.texts.join(" · ")}><span>{g.texts[0]}</span></span>),
        ]} />} />
    </div>
  </section>;
}

const KIND_COLORS = ["#8fb2d9", "#b9a3d9", "#8dbb8f", "#d89a4e", "#c9a24a", "#e8836b", "#75808c"];

/** Stav spisu obrázkom: obal ako prstenec, fakty podľa druhu, úlohy a lehoty s overením. */
function MatterHealth({ cockpit, now }: { cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  const filled = cockpit.obal.filter((f) => !f.missing).length;
  const total = cockpit.obal.length;
  const sourced = cockpit.facts.filter((f) => f.source).length;
  const kinds = [...cockpit.facts.reduce((map, f) => map.set(f.kind, (map.get(f.kind) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1]);
  const tasks = datedTasks(cockpit);
  const overdue = cockpit.tasks.filter((x) => x.overdue).length;
  const next = tasks.find((x) => x.day && x.day >= now);
  const { confirmed, candidates } = cockpit.deadlines;
  const r = 22, c = 2 * Math.PI * r;
  return <section className="lw-sp-health" aria-label={text("okfStatus")}>
    <div className="lw-sp-hcell" data-lawoss-health="obal" data-warn={filled < total || undefined}>
      <svg width="54" height="54" viewBox="0 0 54 54" role="img" aria-label={text("healthOf", { count: filled, total })}>
        <circle cx="27" cy="27" r={r} fill="none" stroke="var(--lw-border)" strokeWidth="5" />
        {total > 0 ? <circle cx="27" cy="27" r={r} fill="none" stroke={filled === total ? "var(--lw-success)" : "var(--lw-warning)"} strokeWidth="5" strokeLinecap="round"
          strokeDasharray={`${(c * filled) / total} ${c}`} transform="rotate(-90 27 27)" /> : null}
        <text x="27" y="31" textAnchor="middle" fontSize="13" fontWeight="600" fill="var(--lw-text-primary)">{filled}</text>
      </svg>
      <div><span className="lbl">{text("register.obal")}</span><span className="big">{text("healthOf", { count: filled, total })}</span><span className="sub">{text("register.obalNote")}</span></div>
    </div>
    <div className="lw-sp-hcell" data-lawoss-health="fakty" data-warn={sourced < cockpit.facts.length || undefined}>
      <div><span className="lbl">{text("register.fakty")}</span>
        <span className="big">{cockpit.facts.length}<small>{text("healthSourced", { count: sourced, total: cockpit.facts.length })}</small></span>
        {kinds.length ? <span className="lw-sp-seg" aria-hidden>{kinds.map(([kind, n], i) => <i key={kind} style={{ flex: n, background: KIND_COLORS[i % KIND_COLORS.length] }} />)}</span> : null}
        <span className="sub">{kinds.map(([kind, n]) => `${n} ${cockpitLabel(kind, text)}`).join(" · ") || text("noFacts")}</span></div>
    </div>
    <div className="lw-sp-hcell" data-lawoss-health="ulohy" data-warn={overdue > 0 || undefined}>
      <div><span className="lbl">{text("register.ulohy")}</span>
        <span className="big">{cockpit.tasks.length}{overdue > 0 ? <small>{text("overdueCount", { count: overdue })}</small> : null}</span>
        <span className="sub">{next?.day ? `${text("healthNextTask", { when: dueTextFromDays(daysBetween(now, next.day), locale) })} · ${next.task.title}` : text("noTasks")}</span></div>
    </div>
    <div className="lw-sp-hcell" data-lawoss-health="lehoty" data-warn={cockpit.deadlines.confirmed.some((d) => d.overdue) || candidates.some((d) => d.overdue) || undefined}>
      <div><span className="lbl">{text("register.lehoty")}</span>
        <span className="big">{confirmed.length + candidates.length}</span>
        <span style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 4 }}>
          <span className="lw-x-pill" data-tone={confirmed.length ? "green" : undefined}><ShieldCheck aria-hidden size={12} />{text("healthConfirmed", { count: confirmed.length })}</span>
          <span className="lw-x-pill" data-tone={candidates.length ? "amber" : undefined}>{text("healthCandidates", { count: candidates.length })}</span>
        </span></div>
    </div>
  </section>;
}

/** Čo čaká na advokáta ako výrazné riadky; rizikové preverenie navrchu; prázdny stav povie, čo je v poriadku a čo príde. */
function AttentionPanel({ cockpit, now }: { cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  const risky = cockpit.screenings.filter(screeningNeedsAttention);
  const upcoming = [
    ...[...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].filter((d) => !d.invalid && d.date >= now).map((d) => ({ date: d.date, title: deadlineText(d) })),
    ...datedTasks(cockpit).filter((x) => x.day && x.day >= now).map((x) => ({ date: x.day ?? now, title: x.task.title })),
  ].sort(byDay)[0];
  const clear = cockpit.attention.length === 0;
  return <section className="lw-x-panel" aria-labelledby="lw-sp-attention" data-lawoss-attention={cockpit.attention.length + risky.length}>
    <h2 id="lw-sp-attention" className="lw-x-h2">{text("attention")}<small>{text("attentionNote")}</small></h2>
    <div className="lw-x-grid" style={{ gap: 10 }}>
      {risky.map((s) => <AlertBox key={s.id} tone="amber" icon="search" data-lawoss-screening={s.id}
        title={text("screening.title", { subject: s.subject ?? s.title })}
        detail={[s.id, s.date ? formatDay(s.date, locale) : "", ...s.registries].filter(Boolean).join(" · ")}
        tags={<>{s.risk ? <span className="lw-x-pill" data-tone="amber">{text("screening.risk", { value: riskText(s.risk, text) })}</span> : null}
          {s.conclusion ? <span className="lw-x-pill" data-tone="line">{text("screening.conclusion", { value: conclusionText(s.conclusion, text) })}</span> : null}</>} />)}
      {cockpit.attention.map((row) => <AttentionLine key={row.id} row={row} cockpit={cockpit} now={now} />)}
      {clear ? <AlertBox tone="ok" icon="ok" data-lawoss-attention-clear="" title={text(risky.length ? "alert.otherwiseClear" : "alert.clearTitle")} detail={text("alert.clearMatter")} /> : null}
      {upcoming ? <p className="lw-x-next" style={{ margin: 0 }}>{text("nextUp")}:
        <span className="lw-x-pill" data-tone={deadlineTone(upcoming.date, now) === "later" ? undefined : "amber"}>{dueTextFromDays(daysBetween(now, upcoming.date), locale)}</span>{upcoming.title}</p> : null}
    </div>
  </section>;
}

const FACTS_SHOWN = 6;
const FACT_ICON: Readonly<Record<string, typeof FileText>> = { rozhodnutie: Scale, pravidlo: Scale, prameň: Scale, subjekt: User, preverenie: Search, tvrdenie: Flag };

function FactCard({ fact, cockpit }: { fact: Cockpit["facts"][number]; cockpit: Cockpit }) {
  const { locale, text } = useMatterText();
  const Icon = FACT_ICON[fact.kind] ?? FileText;
  const screening = cockpit.screenings.find((s) => s.id === fact.id);
  const verified = fact.provenance === "overené";
  return <div className="lw-sp-fact" data-lawoss-fact={fact.id}>
    <span className="lw-sp-fact-icon"><Icon aria-hidden size={16} /></span>
    <b title={fact.title}>{fact.title}</b>
    <span className="lw-x-trust" data-trust={verified ? "confirmed" : "recorded"}>{verified ? <ShieldCheck aria-hidden size={13} /> : <PenLine aria-hidden size={12} />}{cockpitLabel(fact.provenance, text)}</span>
    <span className="lw-sp-fact-meta">
      <span className="lw-sp-kind">{cockpitLabel(fact.kind, text)}</span>
      <span className="lw-x-src" title={[fact.source, fact.locator].filter(Boolean).join(" · ")}><FileText aria-hidden size={12} /><span>{fact.source ?? text("noSource")}</span></span>
      {fact.locator ? <span className="lw-x-src" title={fact.locator}><span>{fact.locator}</span></span> : null}
      {screening?.risk ? <span className="lw-x-pill" data-tone="amber">{text("screening.risk", { value: riskText(screening.risk, text) })}</span> : null}
      {fact.date ? <span className="lw-x-muted" style={{ fontSize: 12, whiteSpace: "nowrap" }}>{formatDay(fact.date, locale)}</span> : null}
    </span>
    <span className="lw-x-rec" title={fact.file}>{fact.id}</span>
  </div>;
}

function FactsPanel({ cockpit }: { cockpit: Cockpit }) {
  const { text } = useMatterText();
  const sourced = cockpit.facts.filter((f) => f.source).length;
  const shown = cockpit.facts.slice(0, FACTS_SHOWN);
  const rest = cockpit.facts.slice(FACTS_SHOWN);
  return <section className="lw-x-panel" aria-labelledby="lw-sp-facts">
    <h2 id="lw-sp-facts" className="lw-x-h2">{text("factsTitle")}<small>{text("healthSourced", { count: sourced, total: cockpit.facts.length })}</small></h2>
    {cockpit.facts.length === 0 ? <p className="lw-empty">{text("noFacts")}</p> : <div className="lw-sp-facts">
      {shown.map((fact) => <FactCard key={fact.id} fact={fact} cockpit={cockpit} />)}
    </div>}
    {rest.length > 0 ? <details className="lw-sp-more"><summary>{text("showAll", { count: cockpit.facts.length })}</summary>
      <div className="lw-sp-facts">{rest.map((fact) => <FactCard key={fact.id} fact={fact} cockpit={cockpit} />)}</div>
    </details> : null}
  </section>;
}

const COURSE_PAST = 8;

/** Priebeh: nadchádzajúce lehoty a termíny úloh, dnešok, potom história zoskupená podľa dňa a druhu. */
function CoursePanel({ cockpit, now }: { cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  const groups = groupEvents(cockpit.events);
  const future = [
    ...[...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].filter((d) => !d.invalid && d.date >= now)
      .map((d) => ({ key: `d/${d.recordId}/${d.date}`, date: d.date, title: deadlineText(d), task: false, rec: d.recordId })),
    ...datedTasks(cockpit).filter((x) => x.day && x.day >= now).map((x) => ({ key: `t/${x.task.id}`, date: x.day ?? now, title: x.task.title, task: true, rec: x.task.id })),
  ].sort(byDay).reverse();
  const item = (g: ReturnType<typeof groupEvents>[number]) => <li key={g.key} data-kind={g.kind}>
    <span className="lw-sp-when">{formatDay(g.date, locale)}{g.kind ? <span className="lw-sp-kind" data-kind={g.kind}>{eventKindText(g.kind, text)}</span> : null}
      {g.recordIds.length > 1 ? <span>{text("groupRecords", { count: g.recordIds.length })}</span> : null}</span>
    <span className="lw-sp-what">{g.texts[0]}</span>
    {g.texts.slice(1).map((other) => <span key={other} className="lw-sp-also">{other}</span>)}
    <span className="lw-sp-recs">{g.recordIds.map((id, i) => <span key={id} className="lw-x-rec" title={g.files[i] ?? g.files[0]}>{id}</span>)}</span>
  </li>;
  return <section className="lw-x-panel" aria-labelledby="lw-sp-course" data-lawoss-course={groups.length}>
    <h2 id="lw-sp-course" className="lw-x-h2">{text("course")}<small>{text("courseNote", { count: cockpit.events.length })}</small></h2>
    {groups.length === 0 && future.length === 0 ? <p className="lw-empty">{text("noEvents")}</p> : <ol className="lw-sp-tl">
      {future.map((f) => <li key={f.key} data-future="" data-task={f.task || undefined}>
        <span className="lw-sp-when">{formatDay(f.date, locale)}<span className="lw-sp-kind">{f.task ? text("legend.task") : cockpitLabel("lehota", text)}</span></span>
        <span className="lw-sp-what">{f.title}</span>
        <span className="lw-sp-recs"><span className="lw-x-rec">{f.rec}</span></span>
      </li>)}
      <li data-today=""><span className="lw-sp-when">{text("today")} · {formatDay(now, locale)}</span></li>
      {groups.slice(0, COURSE_PAST).map(item)}
    </ol>}
    {groups.length > COURSE_PAST ? <details className="lw-sp-more"><summary>{text("courseAll", { count: groups.length })}</summary>
      <ol className="lw-sp-tl">{groups.slice(COURSE_PAST).map(item)}</ol>
    </details> : null}
  </section>;
}

/** Zapojené subjekty ako karty; rola a meno ostávajú tak, ako sú v zázname. */
function PartyCards({ parties }: { parties: Cockpit["parties"] }) {
  const { text } = useMatterText();
  if (parties.length === 0) return null;
  return <section className="lw-x-panel" data-lawoss-parties aria-labelledby="lw-sp-parties">
    <h2 id="lw-sp-parties" className="lw-x-h2">{text("parties")}</h2>
    <div className="lw-sp-facts">{parties.map((p, i) => <div key={`${p.file}/${p.recordId}/${i}`} className="lw-sp-fact">
      <span className="lw-sp-fact-icon"><User aria-hidden size={16} /></span>
      <b title={p.name}>{p.name}</b>
      {p.role ? <span className="lw-sp-kind">{p.role}</span> : <span />}
      <span className="lw-sp-fact-meta">{p.contact ? <span className="lw-x-muted" style={{ fontSize: 12 }}>{p.contact}</span> : null}</span>
      <span className="lw-x-rec" title={p.file}>{p.recordId}</span>
    </div>)}</div>
  </section>;
}

function AttentionLine({ row, cockpit, now }: { row: AttentionRow; cockpit: Cockpit; now: string }) {
  const { locale, text } = useMatterText();
  const copy = attentionCopy(row, cockpit, text);
  const red = row.state === "po termíne" || row.state === "neparsovateľné";
  // Pri lehote rozhoduje potvrdenie tejto lehoty, nie overenie celého záznamu (to isté pravidlo ako prehľad).
  const deadline = row.kind === "lehota" ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].find((d) => `lehota:${d.recordId}:${d.date}` === row.id) : undefined;
  const trust = deadline ? text(deadline.confirmed ? "provenance.verified" : "trust.recorded") : row.provenance ? cockpitLabel(row.provenance, text) : "";
  return (
    <div className="lw-x-alert" data-tone={red ? "red" : "amber"} data-lawoss-attention-row={row.id}>
      <span className="lw-x-alert-icon">{row.kind === "lehota" || row.kind === "úloha" ? <Clock aria-hidden size={16} /> : <AlertTriangle aria-hidden size={16} />}</span>
      <span className="lw-x-alert-body">
        <b>{copy.title}</b>
        <span>
          {copy.detail}
          {trust ? ` · ${trust}` : ""}
          {row.scope ? ` · ${t(`lawoss.lite.scope_${row.scope}`, locale)}` : ""}
        </span>
        <span className="lw-x-alert-tags">
          <span className="lw-x-pill" data-tone={red ? "red" : "amber"}>{cockpitLabel(row.state, text)}</span>
          {row.date ? <span className="lw-x-pill" data-tone="line">{formatDay(row.date, locale)}{ISO_DAY.test(row.date) && row.date >= now ? ` · ${dueTextFromDays(daysBetween(now, row.date), locale)}` : ""}</span> : null}
          <span className="lw-x-rec" title={row.file}>{lastName(row.file)}</span>
        </span>
      </span>
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
            {deadlineText(d)}
            <small>
              {d.source ?? text("noSource")} · <span className="lw-mono">{d.file}</span>
            </small>
          </span>
          <span className="lw-ref">{d.recordId}</span>
          <span className={`lw-st${d.overdue ? " warn" : ""}`}>{d.overdue ? text("overdue") : text(d.confirmed ? "provenance.verified" : "trust.recorded")}</span>
        </div>
      ))}
    </>
  );
}

// Portable cockpit values are stable data. Translate only known display labels,
// never matter titles, sources, history entries, state values or record contents.
type MatterText = ReturnType<typeof useMatterText>["text"];
const COCKPIT_LABELS: Readonly<Record<string, MatterTextKey>> = {
  "Spisová značka": "field.reference", "Súd / orgán": "field.court",
  "Jurisdikcia": "field.jurisdiction", "Stav konania": "field.state",
  "nie je v karte ani v zázname": "field.notRecorded", "záznam prípadu chýba": "field.noMatterRecord",
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
