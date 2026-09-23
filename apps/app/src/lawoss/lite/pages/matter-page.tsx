/** @jsxImportSource react */
import { useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { MatterOverview } from "../../../../../../lawoss/okf/read";
import { buildCockpit, selectMatter, type Cockpit, type CockpitDeadline } from "../../../../../../lawoss/okf/cockpit";
import { OkfPage } from "../../domains/okf-page";
import { openMatterSession } from "../../okf/matter-session";
import { activeWorkspace, dayClass, formatDay, today, useOkfConnection, type OkfReadResult } from "../../okf/read-model";
import { composeQuickAction, QUICK_ACTIONS } from "../quick-actions";
import { LITE_CLIENTS_PATH } from "../links";
import "./lite.css";

type ActionId = (typeof QUICK_ACTIONS)[number]["id"];
/** Z cockpitu stačí to, co lite ukazuje; zbytek zůstává v pro. */
export type LiteCockpit = Pick<Cockpit, "deadlines" | "tasks" | "attention" | "facts">;

export function LiteMatterPage() {
  const locale = useLocale();
  return <OkfPage title={t("lawoss.lite.clients_title", locale)}>{(data) => <LiteMatterBody data={data} />}</OkfPage>;
}

function LiteMatterBody({ data }: { data: OkfReadResult }) {
  const locale = useLocale();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { connection } = useOkfConnection();
  const running = useRef(false);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const path = params.get("vec");
  const matter = selectMatter(data.matters, path);
  // Neznámá cesta (smazaná nebo přejmenovaná věc) → zpět na seznam, nikdy jiná věc.
  if (!matter) return <p className="lw-empty"><Link to={LITE_CLIENTS_PATH}>{t("lawoss.lite.clients_title", locale)}</Link></p>;
  const cockpit = buildCockpit(data, matter.path, today());

  async function onAction(id: ActionId) {
    if (running.current || !matter) return;
    running.current = true; setBusy(id); setError(null);
    try {
      if (!connection) throw new Error(t("lawoss.integrations.error.registration_denied", locale));
      const prompt = composeQuickAction(id, { title: matter.title, matterRef: matter.matterRef, path: matter.path }, locale);
      // Jen připraví koncept v nové konverzaci nad věcí; nic se neodesílá.
      navigate(await openMatterSession(connection, activeWorkspace(connection), matter, data.matters, prompt));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { running.current = false; setBusy(null); }
  }

  return <LiteMatterView matter={matter} cockpit={cockpit} busy={busy} error={error} onAction={(id) => void onAction(id)} />;
}

export function LiteMatterView({ matter, cockpit, busy, error, onAction }: {
  matter: MatterOverview;
  cockpit: LiteCockpit | null;
  busy: ActionId | null;
  error: string | null;
  onAction: (id: ActionId) => void;
}) {
  const locale = useLocale();
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const [tab, setTab] = useState<"overview" | "known">("overview");
  const now = today();
  const upcoming = cockpit
    ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].filter((d) => !d.overdue).map((d) => d.date)
    : matter.deadlines.map((d) => d.date);
  const next = upcoming.sort()[0];
  const deadlines: CockpitDeadline[] = cockpit ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates].sort((a, b) => a.date.localeCompare(b.date)) : [];
  // Lhůty a úkoly mají vlastní sekce; z pozornosti zbývají jen záznamy, které čekají na advokáta.
  const attention = cockpit?.attention.filter((row) => row.kind !== "lehota" && row.kind !== "úloha") ?? [];
  const tabs = [["overview", "tab_overview"], ["known", "tab_known"]] as const;

  return (
    <div data-lawoss-lite="matter">
      <h2 className="lw-h1">{matter.title}</h2>
      <p className="lw-lead">{[matter.matterRef, matter.court, next ? text("matter_next_deadline", { date: formatDay(next, locale) }) : null].filter(Boolean).join(" · ")}</p>

      <div className="lw-lite-actions">
        {QUICK_ACTIONS.map((action) => (
          <button key={action.id} type="button" className="lw-btn" disabled={busy !== null} aria-busy={busy === action.id} onClick={() => onAction(action.id)}>
            {t(action.labelKey, locale)}
          </button>
        ))}
      </div>
      {error ? <div className="lw-status err" role="alert">{text("action_error", { error })}</div> : null}

      <div className="lw-lite-tabs" role="tablist">
        {tabs.map(([id, key]) => (
          <button key={id} id={`lite-tab-${id}`} type="button" role="tab" className="lw-btn" aria-selected={tab === id} aria-controls={`lite-panel-${id}`} onClick={() => setTab(id)}>
            {text(key)}
          </button>
        ))}
      </div>

      <div id="lite-panel-overview" role="tabpanel" aria-labelledby="lite-tab-overview" hidden={tab !== "overview"}>
        <div className="lw-reg">
          <div className="lw-reg-h"><h2>{text("deadlines_title")}</h2></div>
          {deadlines.length === 0 ? <p className="lw-empty">{text("deadlines_empty")}</p> : deadlines.map((d) => (
            <div key={`${d.recordId}/${d.date}`} className="lw-row lw-cols-leh">
              <span className="lw-no" />
              <span className={dayClass(d.date, now)}>{formatDay(d.date, locale)}</span>
              <span className="lw-t">{d.title}{d.source ? <small>{d.source}</small> : null}</span>
              <span className="lw-ref" />
              <span className={`lw-st${d.confirmed ? "" : " warn"}`}>{d.overdue ? text("overdue") : d.confirmed ? "" : text("verify")}</span>
            </div>
          ))}
        </div>
        <div className="lw-reg">
          <div className="lw-reg-h"><h2>{text("tasks_title")}</h2></div>
          {(cockpit?.tasks.length ?? 0) === 0 ? <p className="lw-empty">{text("tasks_empty")}</p> : cockpit?.tasks.map((task) => (
            <div key={task.id} className="lw-row lw-cols-leh">
              <span className="lw-no" />
              <span className={task.due ? dayClass(task.due, now) : "lw-d"}>{task.due ? formatDay(task.due, locale) : "—"}</span>
              <span className="lw-t">{task.title}{task.assignee ? <small>{task.assignee}</small> : null}</span>
              <span className="lw-ref" />
              <span className={`lw-st${task.overdue ? " warn" : ""}`}>{task.overdue ? text("overdue") : ""}</span>
            </div>
          ))}
        </div>
        {attention.length > 0 ? (
          <div className="lw-reg">
            {attention.map((row) => (
              <div key={`${row.kind}/${row.id}`} className="lw-row lw-cols-leh">
                <span className="lw-no" />
                <span className="lw-d">{row.date ? formatDay(row.date, locale) : "—"}</span>
                <span className="lw-t">{row.title}</span>
                <span className="lw-ref" />
                <span className="lw-st warn">{text("verify")}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div id="lite-panel-known" role="tabpanel" aria-labelledby="lite-tab-known" hidden={tab !== "known"}>
        <div className="lw-reg">
          {(cockpit?.facts.length ?? 0) === 0 ? <p className="lw-empty">{text("known_empty")}</p> : cockpit?.facts.map((fact) => (
            <div key={fact.id} className="lw-row lw-cols-leh">
              <span className="lw-no" />
              <span className="lw-d">{fact.date ? formatDay(fact.date.slice(0, 10), locale) : "—"}</span>
              <span className="lw-t">{fact.title}{fact.source ? <small>{fact.source}{fact.locator ? ` · ${fact.locator}` : ""}</small> : null}</span>
              <span className="lw-ref" />
              <span className={`lw-st${fact.provenance === "overené" ? "" : " warn"}`}>{fact.provenance === "overené" ? "" : text("verify")}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
