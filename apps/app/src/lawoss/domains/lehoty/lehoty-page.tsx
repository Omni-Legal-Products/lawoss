/** @jsxImportSource react */
import { DeadlineWorkflowPanel } from "./deadline-review";
import { deadlineText } from "../../okf/view-rules";
import { OkfPage, useMatterText } from "../okf-page";
import { Link, useSearchParams } from "react-router-dom";
import { useMemo } from "react";
import { t } from "@/i18n";
import {
  activeWorkspace,
  dayClass,
  formatDay,
  today,
  useOkfConnection,
  type OkfReadResult,
  type OkfScope,
} from "../../okf/read-model";
import type { OkfConnection } from "../../okf/connection";
import { clientDeadlines, overviewFolder, overviewOwners, ownerOfFolder } from "../../lite/client-projects";
import { usePublishedClientNav, type PublishedClientNav } from "../../lite/client-nav";
import { comparable, within } from "../../lite/matter-conversations";
import { LEHOTY_PATH } from "../../lite/links";
import { useUiMode } from "../../lite/ui-mode";
import { appTaskClient, inPractice, useAppTasks } from "../../lite/app-tasks";
import { appTodayTasks, buildToday } from "../../lite/today-model";
import { agendaEvents } from "../../lite/agenda-model";
import { practiceClientChoices } from "../../lite/client-choice";
import { useMinuteTick } from "../../lite/live";
import { clientCounts, LEHOTY_HORIZON_DAYS, lehotyClients, lehotyRows, ownInputs, undatedTasks, type LehotyClient } from "../../lite/lehoty-model";
import { LehotyDashboard } from "../../lite/lehoty-dashboard";
import type { UpcomingDeadline } from "../../../../../../lawoss/okf/read";
import type { AppTask } from "../../lite/today-model";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { deadlineCoverage } from "../../../../../../lawoss/okf/views";

/**
 * Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. `?klient=<id priečinka>` (položka
 * Lehoty klienta v bočnom paneli, MČ 19. 10. 2026): prax sa číta od klienta a register ukáže len jeho veci.
 */
export function LehotyPage() {
  const { text, locale } = useMatterText();
  // Bežný režim (alfa 14): nadpis ako riadok v bočnom paneli („Lehoty a úlohy“), Pokročilý „Lehoty“.
  const title = useUiMode() === "lite" ? t("lawoss.lite.nav_deadlines_tasks", locale) : text("deadlinesTitle");
  // Bežný režim (alfa 14, spec-lehoty.md A): pasívny prehľad s vlastným nadpisom; Pokročilý register bez zmeny.
  const lite = useUiMode() === "lite";
  const client = useSearchParams()[0].get("klient");
  const pick = client ? (connection: OkfConnection | null) => connection?.workspaces.find((w) => w.id === client) ?? activeWorkspace(connection) : undefined;
  return <OkfPage title={lite ? undefined : title} pickWorkspace={pick}>{(data, _meta, scope) => lite
    ? <LiteDeadlines data={data} scope={scope} clientId={client} title={title} />
    : client
    ? <ClientRegister data={data} scope={scope} workspaceId={client} />
    : <><DeadlineWorkflowPanel data={data} scope={scope} /><RealRegister data={data} /></>}</OkfPage>;
}

/**
 * Vlastník priečinka prípadu pre „Podľa klienta“ rovnakým pravidlom ako `registerOwns` (#246): s panelom vlastníci
 * z `overviewOwners` (vnorený zaregistrovaný klient vlastní svoje prípady), bez panela najhlbší priečinok rozsahu.
 */
export function registerOwnerOf(nav: Pick<PublishedClientNav, "model" | "connection" | "scope" | "groups"> | null, scope: OkfScope): { owners: readonly { id: string; path: string; name?: string; displayNameResolved?: string }[]; owner: (folder: string) => string | null } {
  const owners = nav ? overviewOwners(nav.model, nav.connection?.workspaces ?? [], nav.scope ?? scope, nav.groups) : scope.members.map((member) => member.workspace);
  return { owners, owner: (folder) => ownerOfFolder(owners, folder) };
}

/**
 * Bežný režim: tie isté dáta ako register (`?klient=` zúži na prípady klienta cez `registerOwns`, #246), úlohy
 * appky z tej istej požiadavky ako Dnes (filter podľa projektu), panel postupu lehôt (#168) s tými istými vstupmi.
 */
function LiteDeadlines({ data, scope, clientId, title }: { data: OkfReadResult; scope: OkfScope | null; clientId: string | null; title: string }) {
  useMinuteTick();
  const { locale } = useMatterText();
  const nav = usePublishedClientNav();
  const { connection } = useOkfConnection();
  const { tasks: rawAppTasks, complete: appTasksComplete, loading } = useAppTasks(connection);
  const now = today();
  const workspacesKey = JSON.stringify(connection?.workspaces.map((w) => [w.id, w.path, w.displayNameResolved]) ?? []);
  const derived = useMemo(() => liteDeadlines({ data, scope, clientId, nav, appTasks: rawAppTasks, workspaces: connection?.workspaces ?? [], todayIso: now }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- workspacesKey nesie obsah connection.workspaces.
    [data, scope, clientId, nav, rawAppTasks, workspacesKey, now]);
  const filtered = derived.filtered;
  return <LehotyDashboard title={title} locale={locale} todayIso={now} rows={derived.rows} undated={undatedTasks(derived.model.tasks)} events={derived.events}
    clients={derived.clients} clientId={filtered ? clientId : null} byClient={derived.byClient}
    complete={data.coverage.status === "complete" && appTasksComplete} pending={loading} coverage={deadlineCoverage(derived.source.inputs)}
    truncated={data.truncated ? data.matters.length : undefined} unreadable={data.problems.length || undefined}
    workflow={<DeadlineWorkflowPanel data={derived.own} scope={scope} />} />;
}

/**
 * Čisté odvodenie pre bežný režim (export pre testy). `?klient=` zúži dáta rovnako ako register klienta
 * (`clientDeadlines` + `registerOwns`, #246) a podklady na jeho prípady; neznámy klient ukáže celý register.
 * `own` ide do panela postupu lehôt (#168) bez zmeny oproti registru.
 */
export function liteDeadlines({ data, scope, clientId, nav, appTasks: rawAppTasks, workspaces, todayIso: now }: {
  data: OkfReadResult; scope: OkfScope | null; clientId: string | null; nav: Pick<PublishedClientNav, "model" | "connection" | "scope" | "groups" | "data"> | null;
  appTasks: readonly AppTask[]; workspaces: readonly RouteWorkspace[]; todayIso: string;
}) {
  const filtered = Boolean(clientId && scope && scope.anchor.id === clientId);
  const own = filtered && scope ? clientDeadlines(data, scope, registerOwns(nav, scope, scope.anchor), now) : data;
  const source = filtered ? ownInputs(own) : data;
  const kept = rawAppTasks.filter(filtered ? (task) => task.projectId === clientId : scope ? inPractice(workspaces, scope) : () => true);
  const appTasks = appTodayTasks(kept, appTaskClient(workspaces, scope, data.clients ?? []));
  const model = buildToday(source, now, LEHOTY_HORIZON_DAYS, appTasks);
  const events = agendaEvents(source, appTasks);
  const rows = lehotyRows(model, events, now);
  // Výber klienta: klienti praxe. Kotva rozsahu je vybraný priečinok (aj pri `?klient=`), rozsah je celá prax;
  // vynechá sa len zaregistrovaný koreň praxe, ktorý klientom nie je.
  const root = scope?.practiceRoot ? comparable(scope.practiceRoot) : null;
  const ownership = scope && root ? registerOwnerOf(nav, scope) : null;
  const choices = practiceClientChoices(scope, data.clients ?? []);
  const listed = ownership ? lehotyClients(ownership.owners.filter((owner) => comparable(owner.path) !== root), choices) : [];
  const current: LehotyClient[] = filtered && scope && !listed.some((c) => c.id === scope.anchor.id)
    ? [{ id: scope.anchor.id, title: scope.anchor.displayNameResolved || scope.anchor.name || scope.anchor.path }] : [];
  const clients = [...listed, ...current];
  const byClient = !filtered && scope && ownership ? clientCounts(rows, listed, (path) => {
    const folder = overviewFolder(scope, path);
    return folder === null ? null : ownership.owner(folder);
  }, (id) => kept.find((task) => task.id === id)?.projectId) : undefined;
  return { filtered, own, source, model, events, rows, clients, byClient };
}

/**
 * Vlastník veci ako na Domove klienta (koreň praxe nevidí veci registrovaných klientov, vonkajší klient veci
 * zaregistrovaného vnoreného klienta, review #246); bez panela priečinok klienta. Export pre testy.
 */
export function registerOwns(nav: Pick<PublishedClientNav, "model" | "connection" | "scope" | "groups"> | null, scope: OkfScope, workspace: OkfScope["anchor"]): (folder: string) => boolean {
  if (!nav) return (folder) => within(comparable(workspace.path), folder);
  const owners = overviewOwners(nav.model, nav.connection?.workspaces ?? [], nav.scope ?? scope, nav.groups);
  return (folder) => ownerOfFolder(owners, folder) === workspace.id;
}

/** Register jedného klienta; neznámy priečinok (napr. odpojený) ukáže celý register. */
function ClientRegister({ data, scope, workspaceId }: { data: OkfReadResult; scope: OkfScope | null; workspaceId: string }) {
  const { locale } = useMatterText();
  const nav = usePublishedClientNav();
  if (!scope || scope.anchor.id !== workspaceId) return <><DeadlineWorkflowPanel data={data} scope={scope} /><RealRegister data={data} /></>;
  const workspace = scope.anchor;
  const owns = registerOwns(nav, scope, workspace);
  const name = workspace.displayNameResolved || workspace.name || workspace.path;
  // Postup lehôt (#168) len nad prípadmi tohto klienta, ako register pod ním.
  const own = clientDeadlines(data, scope, owns, today());
  return <>
    <p className="lw-lead">
      <strong>{t("lawoss.lite.client_deadlines_title", locale, { name })}</strong>{" · "}
      <Link to={LEHOTY_PATH}>{t("lawoss.lite.client_deadlines_back", locale)}</Link>
    </p>
    <DeadlineWorkflowPanel data={own} scope={scope} />
    <RealRegister data={own} />
  </>;
}

export function RealRegister({ data }: { data: OkfReadResult }) {
  const { text } = useMatterText();
  const now = today();
  return (
    <>
      <p className="lw-lead">
        {text("deadlinesLead")}
      </p>

      {data.overdue.length > 0 ? (
        <div className="lw-reg">
          <div className="lw-reg-h">
            <h2>{text("overdueTitle")}</h2>
            <span className="lw-meta">{text("overdueNote", { count: data.overdue.length })}</span>
          </div>
          {data.overdue.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)}
        </div>
      ) : null}

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("upcoming")}</h2>
          <span className="lw-meta">
            {text("upcomingSummary", { total: data.upcomingDeadlines.length, soon: data.totals.deadlinesWithin7Days, matters: text("matters", { count: data.matters.length }) })}
          </span>
        </div>
        {data.upcomingDeadlines.length === 0 ? (
          <p className="lw-empty">{text("noUpcoming")}</p>
        ) : (
          data.upcomingDeadlines.map((d, i) => <DeadlineRow key={rowKey(d)} d={d} index={i} now={now} />)
        )}
      </div>

      {data.truncated ? (
        <div className="lw-status warn">
          {text("truncatedRegister", { count: data.matters.length })}
        </div>
      ) : null}

      {data.problems.length > 0 ? (
        <div className="lw-status warn">
          {text("missingDeadlines", { files: text("filesUnreadable", { count: data.problems.length }) })}{" "}
          {data.problems.slice(0, 3).map((p) => p.path).join(", ")}
          {data.problems.length > 3 ? ", …" : ""}
        </div>
      ) : null}

    </>
  );
}

const rowKey = (d: UpcomingDeadline): string => `${d.matter.path}/${d.recordId}/${d.date}`;

function DeadlineRow({ d, index, now }: { d: UpcomingDeadline; index: number; now: string }) {
  const { locale } = useMatterText();
  return (
    <div className="lw-row lw-cols-leh">
      <span className="lw-no">{index + 1}.</span>
      <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
      <span className="lw-t">
        {deadlineText(d)}
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
