/** @jsxImportSource react */
import { DeadlineWorkflowPanel } from "./deadline-review";
import { deadlineText } from "../../okf/view-rules";
import { OkfPage, useMatterText } from "../okf-page";
import { Link, useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import {
  activeWorkspace,
  dayClass,
  formatDay,
  today,
  type OkfReadResult,
  type OkfScope,
} from "../../okf/read-model";
import type { OkfConnection } from "../../okf/connection";
import { clientDeadlines, ownerOfFolder } from "../../lite/client-projects";
import { usePublishedClientNav } from "../../lite/client-nav";
import { comparable, within } from "../../lite/matter-conversations";
import { LEHOTY_PATH } from "../../lite/links";
import type { UpcomingDeadline } from "../../../../../../lawoss/okf/read";

/**
 * Iba skutočné údaje zo spisov; chýbajúce údaje nenahrádza ukážka. `?klient=<id priečinka>` (položka
 * Lehoty klienta v bočnom paneli, MČ 19. 10. 2026): prax sa číta od klienta a register ukáže len jeho veci.
 */
export function LehotyPage() {
  const { text } = useMatterText();
  const client = useSearchParams()[0].get("klient");
  const pick = client ? (connection: OkfConnection | null) => connection?.workspaces.find((w) => w.id === client) ?? activeWorkspace(connection) : undefined;
  return <OkfPage title={text("deadlinesTitle")} pickWorkspace={pick}>{(data, _meta, scope) => client
    ? <ClientRegister data={data} scope={scope} workspaceId={client} />
    : <><DeadlineWorkflowPanel data={data} scope={scope} /><RealRegister data={data} /></>}</OkfPage>;
}

/** Register jedného klienta; neznámy priečinok (napr. odpojený) ukáže celý register. */
function ClientRegister({ data, scope, workspaceId }: { data: OkfReadResult; scope: OkfScope | null; workspaceId: string }) {
  const { locale } = useMatterText();
  const nav = usePublishedClientNav();
  if (!scope || scope.anchor.id !== workspaceId) return <><DeadlineWorkflowPanel data={data} scope={scope} /><RealRegister data={data} /></>;
  const workspace = scope.anchor;
  // Vlastník veci ako v bočnom paneli (koreň praxe nevidí veci registrovaných klientov); bez panela priečinok klienta.
  const owns = (folder: string) => nav ? ownerOfFolder(nav.model.visible, folder) === workspaceId : within(comparable(workspace.path), folder);
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

      <div className="lw-note">
        <span>
          {text("deadlineSource")}
        </span>
        <span>
          {text("deadlineReadOnly")}
        </span>
      </div>
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
