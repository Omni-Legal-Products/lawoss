/** @jsxImportSource react */
import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { MatterOverview } from "../../../../../../lawoss/okf/read";
import { buildCockpit, type Cockpit, type CockpitDeadline } from "../../../../../../lawoss/okf/cockpit";
import { OkfPage } from "../../domains/okf-page";
import { litePageProps } from "../state-text";
import { openMatterSession } from "../../okf/matter-session";
import { addDays, dayClass, officeWorkspace, formatDay, today, useOkfConnection, type OkfReadResult } from "../../okf/read-model";
import { composeQuickAction, MORE_ACTIONS, QUICK_ACTIONS } from "../quick-actions";
import { POSTPROCESS_RESOURCE_NAME, postprocessSource, VYSTUP_SKILL_NAME, vystupSkillBody } from "../../okf/skill-bundle";
import { nextDeadline } from "../today-model";
import { LITE_CLIENTS_PATH } from "../links";
import { listMatterConversations, openMatterConversation, type MatterConversation } from "../matter-conversations";
import { saveDocumentsToMatter } from "../matter-intake";
import "./lite.css";

type ActionId = (typeof QUICK_ACTIONS)[number]["id"] | (typeof MORE_ACTIONS)[number]["id"];
/** Z cockpitu stačí to, co lite ukazuje; zbytek zůstává v pro. */
type LiteCockpit = Pick<Cockpit, "deadlines" | "tasks" | "attention" | "facts">;

export function LiteMatterPage() {
  const locale = useLocale();
  // Bez nadpisu stránky: hlavním nadpisem je název věci (LiteMatterView), ne „Klienti a věci“.
  return <OkfPage {...litePageProps(locale)}>{(data) => <LiteMatterBody data={data} />}</OkfPage>;
}

/** Jen přesná shoda `?vec=`; na rozdíl od `selectMatter` nikdy nespadne na první věc (akce by běžely nad jinou). */
export function matterFromParams(matters: readonly MatterOverview[], params: URLSearchParams): MatterOverview | null {
  const path = params.get("vec");
  return path === null ? null : matters.find((m) => m.path === path) ?? null;
}

function LiteMatterBody({ data }: { data: OkfReadResult }) {
  const locale = useLocale();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { connection } = useOkfConnection();
  const running = useRef(false);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const queries = useQueryClient();
  const matter = matterFromParams(data.matters, params);
  const conversations = useQuery({
    queryKey: ["lite-matter-conversations", matter?.path ?? "", connection?.baseUrl ?? "", connection?.token ?? ""],
    enabled: Boolean(connection?.client && matter),
    queryFn: () => {
      if (!connection || !matter) throw new Error("no connection");
      return listMatterConversations(connection, matter.path);
    },
  });
  // Chybějící nebo neznámá cesta (smazaná nebo přejmenovaná věc) → zpět na seznam, nikdy jiná věc.
  if (!matter) return <p className="lw-empty"><Link to={LITE_CLIENTS_PATH}>{t("lawoss.lite.clients_title", locale)}</Link></p>;
  const cockpit = buildCockpit(data, matter.path, today());

  async function onAction(id: ActionId) {
    if (running.current || !matter) return;
    running.current = true; setBusy(id); setError(null);
    try {
      if (!connection) throw new Error(t("lawoss.integrations.error.registration_denied", locale));
      const prompt = composeQuickAction(id, { title: matter.title, matterRef: matter.matterRef, path: matter.path }, locale);
      // Jen připraví koncept v nové konverzaci nad věcí; nic se neodesílá.
      // Paměť klienta a kanceláře leží mimo složku věci — povolit čtení předem (bez dotazu u každého čtení).
      const readScope = data.inputs.find((input) => input.path === matter.path)?.scopePaths?.slice(1) ?? [];
      navigate(await openMatterSession(connection, officeWorkspace(connection), matter, data.matters, prompt, readScope, id === "document" ? installVystupSkill : undefined));
    } catch (failure) {
      // Surová hláška může obsahovat interní pojmy; advokát vidí obecný text, diagnostika jde do konzole.
      console.warn("LAWOSS-lite: quick action failed", failure);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { running.current = false; setBusy(null); }
  }

  async function onContinue(conversation: MatterConversation) {
    if (running.current || !connection) return;
    running.current = true; setError(null);
    try {
      navigate(await openMatterConversation(connection, conversation));
    } catch (failure) {
      console.warn("LAWOSS-lite: continue conversation failed", failure);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { running.current = false; }
  }

  async function onFiles(files: File[]) {
    const office = officeWorkspace(connection);
    if (running.current || !matter || files.length === 0) return;
    running.current = true; setBusy("add_document"); setError(null); setSaved(null);
    try {
      if (!connection?.client || !office) throw new Error(t("lawoss.integrations.error.registration_denied", locale));
      const result = await saveDocumentsToMatter(connection.client, office.id, matter, files);
      setSaved(result.map((r) => `${r.name} (${r.id})`).join(", "));
      // Dnes a „K zařazení“ mají nový vstup ukázat hned.
      void queries.invalidateQueries({ queryKey: ["okf-overview"] });
    } catch (failure) {
      console.warn("LAWOSS-lite: document intake failed", failure);
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally { running.current = false; setBusy(null); }
  }

  return <LiteMatterView matter={matter} cockpit={cockpit} busy={busy} error={error} onAction={(id) => void onAction(id)}
    conversations={conversations.data ?? []} onContinue={(c) => void onContinue(c)}
    onFiles={(files) => void onFiles(files)} saved={saved} />;
}

export function LiteMatterView({ matter, cockpit, busy, error, onAction, conversations = [], onContinue, onFiles, saved = null }: {
  matter: MatterOverview;
  cockpit: LiteCockpit | null;
  busy: ActionId | null;
  error: string | null;
  onAction: (id: ActionId) => void;
  /** Rozpracované konverzace nad věcí, nejnovější první. */
  conversations?: readonly MatterConversation[];
  onContinue?: (conversation: MatterConversation) => void;
  /** Přetažené nebo vybrané soubory — uloží se do věci jako vstupy k zařazení. */
  onFiles?: (files: File[]) => void;
  /** Co se právě uložilo (pro potvrzení advokátovi). */
  saved?: string | null;
}) {
  const locale = useLocale();
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const [tab, setTab] = useState<"overview" | "known">("overview");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const now = today();
  const all: CockpitDeadline[] = cockpit ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates] : [];
  const next = nextDeadline(cockpit ? all : matter.deadlines, now);
  // Stejný výřez jako Dnes: po lhůtě + příštích 14 dnů; neplatné datum vždy (k ověření).
  const horizon = addDays(now, 14);
  const deadlines = all.filter((d) => d.invalid || d.date <= horizon)
    .sort((a, b) => Number(Boolean(b.invalid)) - Number(Boolean(a.invalid)) || a.date.localeCompare(b.date));
  // Lhůty a úkoly mají vlastní sekce; z pozornosti zbývají jen záznamy, které čekají na advokáta.
  const attention = cockpit?.attention.filter((row) => row.kind !== "lehota" && row.kind !== "úloha") ?? [];
  const tabs = [["overview", "tab_overview"], ["known", "tab_known"]] as const;

  return (
    <div data-lawoss-lite="matter" data-dragging={dragging || undefined}
      onDragOver={(event) => { if (onFiles && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        if (!onFiles || !event.dataTransfer.files.length) return;
        event.preventDefault(); setDragging(false);
        onFiles([...event.dataTransfer.files]);
      }}>
      <h1 className="lw-h1">{matter.title}</h1>
      <p className="lw-lead">{[matter.matterRef, matter.court, next ? text("matter_next_deadline", { date: formatDay(next, locale) }) : null].filter(Boolean).join(" · ")}</p>

      <div className="lw-lite-actions">
        {QUICK_ACTIONS.map((action) => (
          <button key={action.id} type="button" className="lw-btn" disabled={busy !== null} aria-busy={busy === action.id}
            onClick={() => action.id === "add_document" && onFiles ? fileInput.current?.click() : onAction(action.id)}>
            {t(action.labelKey, locale)}
          </button>
        ))}
      </div>
      <div className="lw-lite-actions lw-lite-more" aria-label={text("more_actions")}>
        {MORE_ACTIONS.map((action) => (
          <button key={action.id} type="button" className="lw-btn" disabled={busy !== null} aria-busy={busy === action.id} onClick={() => onAction(action.id)}>
            {t(action.labelKey, locale)}
          </button>
        ))}
      </div>
      {onFiles ? <input ref={fileInput} type="file" multiple hidden data-lawoss-lite="intake-input"
        onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; onFiles(files); }} /> : null}
      {onFiles ? <p className="lw-lite-hint">{text(dragging ? "intake_drop" : "intake_hint")}</p> : null}
      {saved ? <div className="lw-status ok" role="status">{text("intake_saved", { names: saved })}</div> : null}
      {error ? <div className="lw-status err" role="alert">{text("action_error_generic")}</div> : null}

      {conversations.length > 0 ? (
        <div className="lw-reg lw-lite-conversations" data-lawoss-lite="conversations">
          <div className="lw-reg-h"><h2>{text("conversations_title")}</h2></div>
          {conversations.map((c) => (
            <button key={c.id} type="button" className="lw-row lw-cols-leh" disabled={busy !== null} onClick={() => onContinue?.(c)}>
              <span className="lw-no" />
              <span className="lw-d">{formatStamp(c.updated, locale)}</span>
              <span className="lw-t">{c.title ?? text("conversation_untitled")}</span>
              <span className="lw-ref" />
              <span className="lw-st">{text("conversation_continue")}</span>
            </button>
          ))}
        </div>
      ) : null}

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
              <span className={`lw-st${d.confirmed && !d.invalid ? "" : " warn"}`}>{d.invalid ? text("due_invalid") : d.overdue ? text("overdue") : d.confirmed ? "" : text("verify")}</span>
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

/** Den a čas poslední změny konverzace, např. „čt 24. 9. 14:32“. */
function formatStamp(ms: number, locale: string): string {
  return ms ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : "—";
}

/** Skill vyhotovení dokumentu do složky věci — konverzace nad věcí běží v ní. */
async function installVystupSkill(client: Parameters<NonNullable<Parameters<typeof openMatterSession>[6]>>[0], workspaceId: string): Promise<void> {
  const body = vystupSkillBody();
  await client.upsertSkill(workspaceId, { name: VYSTUP_SKILL_NAME, content: body.content, description: body.description });
  await client.upsertSkillResource(workspaceId, VYSTUP_SKILL_NAME, { name: POSTPROCESS_RESOURCE_NAME, content: postprocessSource() });
}
