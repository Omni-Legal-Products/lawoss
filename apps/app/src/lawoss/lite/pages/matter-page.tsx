/** @jsxImportSource react */
import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { missingScopeLevels, scopeLevels, type MatterOverview } from "../../../../../../lawoss/okf/read";
import { buildCockpit, type Cockpit, type CockpitDeadline, type CockpitEvent, type CockpitFact } from "../../../../../../lawoss/okf/cockpit";
import { OkfPage, type OkfPageMeta } from "../../domains/okf-page";
import { deadlineAnchor, hotDeadlineCount, LiveStamp, useHotTitle, useMinuteTick } from "../live";
import { litePageProps } from "../state-text";
import { openMatterSession } from "../../okf/matter-session";
import { officeWorkspace, formatDay, today, useOkfConnection, type OkfReadResult } from "../../okf/read-model";
import { daysUntil, deadlineKey, deadlineText, dueText, inHorizon, urgencyOf } from "../../okf/view-rules";
import { composeQuickAction, MORE_ACTIONS, QUICK_ACTIONS } from "../quick-actions";
import { POSTPROCESS_RESOURCE_NAME, postprocessSource, VYSTUP_SKILL_NAME, vystupSkillBody } from "../../okf/skill-bundle";
import { clientOf, nextDeadline } from "../today-model";
import { LITE_CLIENTS_PATH } from "../links";
import { listMatterConversations, openMatterConversation, type MatterConversation } from "../matter-conversations";
import { saveDocumentsToMatter } from "../matter-intake";
import "./lite.css";
import "./okf-glass.css";
import "./matter.css";

type ActionId = (typeof QUICK_ACTIONS)[number]["id"] | (typeof MORE_ACTIONS)[number]["id"];
/** Z cockpitu stačí to, co lite ukazuje; zbytek zůstává v pro. */
export type LiteCockpit = Pick<Cockpit, "deadlines" | "tasks" | "attention" | "facts" | "parties"> & Partial<Pick<Cockpit, "events" | "client">>;

export function LiteMatterPage() {
  const locale = useLocale();
  // Bez nadpisu stránky: hlavním nadpisem je název věci (LiteMatterView), ne „Klienti a věci“.
  const [params] = useSearchParams();
  // Kľúč podľa veci: pri prechode na inú vec sa vynulujú aj stavy akcií, potvrdenia a chyby.
  return <OkfPage {...litePageProps(locale)}>{(data, meta) => <LiteMatterBody key={params.get("vec") ?? ""} data={data} meta={meta} />}</OkfPage>;
}

/** Jen přesná shoda `?vec=`; na rozdíl od `selectMatter` nikdy nespadne na první věc (akce by běžely nad jinou). */
export function matterFromParams(matters: readonly MatterOverview[], params: URLSearchParams): MatterOverview | null {
  const path = params.get("vec");
  return path === null ? null : matters.find((m) => m.path === path) ?? null;
}

function LiteMatterBody({ data, meta }: { data: OkfReadResult; meta: OkfPageMeta }) {
  const locale = useLocale();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { connection } = useOkfConnection();
  const running = useRef(false);
  // Akcia dobehne až po prechode na inú vec: výsledok staršej veci už nesmie nikam presmerovať.
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const [busy, setBusy] = useState<ActionId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const queries = useQueryClient();
  const matter = matterFromParams(data.matters, params);
  useMinuteTick(); // o polnoci sa posunie „dnes" aj odpočet
  useHotTitle(hotDeadlineCount(data, today()));
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
  const input = data.inputs.find((entry) => entry.path === matter.path);

  async function onAction(id: ActionId) {
    if (running.current || !matter) return;
    running.current = true; setBusy(id); setError(null);
    try {
      if (!connection) throw new Error(t("lawoss.integrations.error.registration_denied", locale));
      const prompt = composeQuickAction(id, { title: matter.title, matterRef: matter.matterRef, path: matter.path }, locale);
      // Jen připraví koncept v nové konverzaci nad věcí; nic se neodesílá.
      // Shared client and office access remains controlled by native Permissions.
      const target = await openMatterSession(connection, officeWorkspace(connection), matter, data.matters, prompt, id === "document" ? installVystupSkill : undefined);
      if (alive.current) navigate(target);
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
      const target = await openMatterConversation(connection, conversation);
      if (alive.current) navigate(target);
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

  // Kľúč podľa veci: pri prechode na inú vec sa záložka, zvýraznenie aj potvrdenia vynulujú.
  return <LiteMatterView key={matter.path} matter={matter} cockpit={cockpit} busy={busy} error={error} onAction={(id) => void onAction(id)}
    conversations={conversations.data ?? []} onContinue={(c) => void onContinue(c)}
    onFiles={(files) => void onFiles(files)} saved={saved}
    scopePaths={input?.scopePaths}
    existingMemorySources={input?.existingMemorySources}
    truths={Object.fromEntries((input?.records ?? []).map((record) => [record.id, record.truth]))}
    client={clientCrumb(matter, input)}
    meta={meta} focusDeadline={params.get("lehota")} />;
}

export function LiteMatterView({ matter, cockpit, busy, error, onAction, conversations = [], onContinue, onFiles, saved = null, scopePaths = [], existingMemorySources = [], truths = {}, client, meta, focusDeadline = null }: {
  matter: MatterOverview;
  scopePaths?: readonly string[];
  existingMemorySources?: readonly string[];
  cockpit: LiteCockpit | null;
  busy: ActionId | null;
  error: string | null;
  onAction: (id: ActionId) => void;
  /** Rozpracované konverzace nad věcí, nejnovější první. */
  conversations?: readonly MatterConversation[];
  onContinue?: (conversation: MatterConversation) => void;
  /** Přetažené nebo vybrané soubory - uloží se do věci jako vstupy k zařazení. */
  onFiles?: (files: File[]) => void;
  /** Co se právě uložilo (pro potvrzení advokátovi). */
  saved?: string | null;
  /** Pravda záznamu podle ID: v „Čo vieme" ukáže, čo záznam tvrdí, nie len jeho názov. */
  truths?: Readonly<Record<string, string>>;
  /** Meno klienta, ak ho cesta alebo pamäť pozná. */
  client?: string;
  /** Kedy sa pamäť overila a zmenila (indikátor živosti). */
  meta?: OkfPageMeta;
  /** `záznam@dátum` z odkazu na lehotu: posunie sa na ňu a krátko ju zvýrazní. */
  focusDeadline?: string | null;
}) {
  const locale = useLocale();
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.lite.${key}`, locale, params);
  const [tab, setTab] = useState<"overview" | "known">("overview");
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const now = today();
  const all: CockpitDeadline[] = cockpit ? [...cockpit.deadlines.confirmed, ...cockpit.deadlines.candidates] : [];
  const next = nextDeadline(cockpit ? all : matter.deadlines, now);
  const nextEntry = next ? all.find((d) => !d.invalid && d.date === next) : undefined;
  // Stejný výřez jako Dnes (view-rules): po lhůtě + horizont; neplatné datum vždy (k ověření).
  const deadlines = all.filter((d) => inHorizon(d.date, now, d.invalid))
    .sort((a, b) => Number(Boolean(b.invalid)) - Number(Boolean(a.invalid)) || a.date.localeCompare(b.date));
  // Lhůty a úkoly mají vlastní sekce; z pozornosti zbývají jen záznamy, které čekají na advokáta.
  const attention = cockpit?.attention.filter((row) => row.kind !== "lehota" && row.kind !== "úloha") ?? [];
  const groups = groupFacts(cockpit?.facts ?? []);
  const timeline = buildTimeline(cockpit?.events ?? [], all, now);
  const tabs = [["overview", "tab_overview"], ["known", "tab_known"]] as const;
  const daysToNext = next ? daysUntil(now, next) : undefined;
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copyTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(copyTimer.current), []);
  const focused = focusDeadline ? deadlineAnchor(...splitFocus(focusDeadline)) : null;
  const [highlight, setHighlight] = useState<string | null>(null);
  useEffect(() => {
    if (!focused) return;
    setTab("overview");
    const frame = window.requestAnimationFrame(() => {
      document.getElementById(focused)?.scrollIntoView({ block: "center", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      setHighlight(focused);
    });
    const timer = window.setTimeout(() => setHighlight(null), 2200);
    return () => { window.cancelAnimationFrame(frame); window.clearTimeout(timer); };
  }, [focused]);
  const copyRef = () => {
    const ref = matter.matterRef;
    if (!ref) return;
    const done = (state: "ok" | "failed") => {
      setCopied(state);
      window.clearTimeout(copyTimer.current);
      copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
    };
    // Schránka nemusí byť dostupná (oprávnenie, nezabezpečený kontext): advokát sa to dozvie, nič nespadne.
    if (!navigator.clipboard?.writeText) { done("failed"); return; }
    navigator.clipboard.writeText(ref).then(() => done("ok"), () => done("failed"));
  };
  const moreMenu = useRef<HTMLDetailsElement | null>(null);
  useEffect(() => {
    // „Ďalšie" sa zavrie klikom mimo a klávesom Escape, ako bežná ponuka.
    const close = (event: Event) => {
      const menu = moreMenu.current;
      if (!menu?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !menu.contains(event.target instanceof Node ? event.target : null)) menu.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => { document.removeEventListener("pointerdown", close); document.removeEventListener("keydown", close); };
  }, []);
  const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowRight" && event.key !== "ArrowLeft" && event.key !== "Home" && event.key !== "End") return;
    event.preventDefault();
    const ids = tabs.map(([id]) => id);
    const index = ids.indexOf(tab);
    const next = event.key === "Home" ? 0 : event.key === "End" ? ids.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + ids.length) % ids.length;
    setTab(ids[next]!);
    document.getElementById(`lite-tab-${ids[next]}`)?.focus();
  };
  const overdueCount = all.filter((d) => d.invalid || d.date < now).length;
  // Kotvu (id) dostane len prvý výskyt lehoty; dve rovnaké lehoty v jeden deň nesmú mať rovnaké id.
  const anchored = new Set<string>();
  const anchorFor = (d: CockpitDeadline): string | undefined => {
    const anchor = deadlineAnchor(d.recordId, d.date);
    if (anchored.has(anchor)) return undefined;
    anchored.add(anchor);
    return anchor;
  };
  const recentPast = timeline.findIndex((entry) => entry.kind === "today");
  const visibleTimeline = recentPast < 0 ? timeline : timeline.slice(0, recentPast + 1 + TIMELINE_PAST_LIMIT);
  const olderTimeline = recentPast < 0 ? [] : timeline.slice(recentPast + 1 + TIMELINE_PAST_LIMIT);

  return (
    <div className="lw-matter" data-lawoss-lite="matter" data-dragging={dragging || undefined}
      onDragOver={(event) => { if (onFiles && event.dataTransfer.types.includes("Files")) { event.preventDefault(); setDragging(true); } }}
      onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false); }}
      onDrop={(event) => {
        if (!onFiles || !event.dataTransfer.files.length) return;
        event.preventDefault(); setDragging(false);
        onFiles([...event.dataTransfer.files]);
      }}>
      <header className="lw-matter-hero" style={reveal(0)}>
        <div className="lw-matter-hero-copy">
          <p className="lw-matter-topline"><Link className="lw-matter-crumb" to={LITE_CLIENTS_PATH}>{client ?? text("clients_title")}</Link>{meta ? <LiveStamp meta={meta} locale={locale} /> : null}</p>
          <h1 className="lw-h1">{matter.title}</h1>
          <p className="lw-matter-meta">
            {matter.matterRef ? <button type="button" className="lw-matter-ref lw-matter-copy" onClick={copyRef} title={text("copy_ref")} aria-label={`${text("copy_ref")}: ${matter.matterRef}`} data-copied={copied ?? undefined}>
              {matter.matterRef}<span className="lw-matter-copy-state" aria-live="polite">{copied === "ok" ? text("copied") : copied === "failed" ? text("copy_failed") : ""}</span>
            </button> : null}
            {matter.court ? <span>{matter.court}</span> : null}
            {next ? <span className="lw-matter-next-inline">{text("matter_next_deadline", { date: formatDay(next, locale) })}</span> : null}
          </p>
        </div>
        {next && daysToNext !== undefined ? (
          <div className="lw-matter-countdown" data-urgency={urgencyOf(next, now)} role="group" aria-label={`${text("next_deadline")}: ${formatDay(next, locale)}${nextEntry ? `, ${deadlineText(nextEntry)}` : ""}`}>
            <span className="lw-matter-countdown-label">{text("next_deadline")}</span>
            <strong>{daysToNext <= 0 ? formatDay(next, locale) : daysToNext}</strong>
            <span>{dueText(next, now, locale)}</span>
            {nextEntry ? <small>{deadlineText(nextEntry)}</small> : null}
            {overdueCount > 0 ? <em className="lw-matter-countdown-overdue">+{overdueCount} {text("overdue")}</em> : null}
          </div>
        ) : null}
      </header>

      <div className="lw-matter-dock" style={reveal(1)}>
        <div className="lw-matter-actions">
          {QUICK_ACTIONS.map((action, index) => (
            <button key={action.id} type="button" className={index === 0 ? "lw-matter-action is-primary" : "lw-matter-action"} disabled={busy !== null} aria-busy={busy === action.id}
              onClick={() => action.id === "add_document" && onFiles ? fileInput.current?.click() : onAction(action.id)}>{t(action.labelKey, locale)}</button>
          ))}
          <details className="lw-matter-more" ref={moreMenu}>
            <summary>{text("matter_more")}</summary>
            <div className="lw-matter-more-list" aria-label={text("more_actions")}>
              {MORE_ACTIONS.map((action) => (
                <button key={action.id} type="button" className="lw-matter-action" disabled={busy !== null} aria-busy={busy === action.id} onClick={() => { if (moreMenu.current) moreMenu.current.open = false; onAction(action.id); }}>{t(action.labelKey, locale)}</button>
              ))}
            </div>
          </details>
        </div>
        {onFiles ? <input ref={fileInput} type="file" multiple hidden data-lawoss-lite="intake-input"
          onChange={(event) => { const files = [...(event.target.files ?? [])]; event.target.value = ""; onFiles(files); }} /> : null}
        {onFiles ? <p className="lw-matter-drop">{text(dragging ? "intake_drop" : "intake_hint")}</p> : null}
        {saved ? <div className="lw-status ok" role="status">{text("intake_saved", { names: saved })}</div> : null}
        {error ? <div className="lw-status err" role="alert">{text("action_error_generic")}</div> : null}
      </div>

      {conversations.length > 0 ? (
        <section className="lw-matter-panel lw-matter-conversations" data-lawoss-lite="conversations" style={reveal(2)}>
          <h2 className="lw-matter-section">{text("conversations_title")}</h2>
          <div className="lw-matter-conv-list">
            {conversations.map((c) => (
              <button key={c.id} type="button" className="lw-matter-conv" disabled={busy !== null} onClick={() => onContinue?.(c)}>
                <span className="lw-matter-conv-title">{c.title ?? text("conversation_untitled")}</span>
                <span className="lw-matter-conv-meta"><span className="lw-matter-mono">{formatStamp(c.updated, locale)}</span><span className="lw-matter-conv-go">{text("conversation_continue")}</span></span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      <div className="lw-matter-tabs" role="tablist" style={reveal(3)} onKeyDown={onTabKey}>
        {tabs.map(([id, key]) => (
          <button key={id} id={`lite-tab-${id}`} type="button" role="tab" className="lw-matter-tab" aria-selected={tab === id} tabIndex={tab === id ? 0 : -1} aria-controls={`lite-panel-${id}`} onClick={() => setTab(id)}>
            {text(key)}{id === "known" && groups.length > 0 ? <span className="lw-matter-count">{groups.reduce((sum, g) => sum + g.facts.length, 0)}</span> : null}
          </button>
        ))}
      </div>

      <div id="lite-panel-overview" role="tabpanel" aria-labelledby="lite-tab-overview" hidden={tab !== "overview"}>
        <div className="lw-matter-grid">
          <section className="lw-matter-panel lw-matter-timeline" style={reveal(4)}>
            <h2 className="lw-matter-section">{text("matter_timeline")}</h2>
            {timeline.length === 0 ? <p className="lw-matter-empty">{text("matter_timeline_empty")}</p> : <>
              <TimelineList entries={visibleTimeline} locale={locale} text={text} />
              {olderTimeline.length > 0 ? <details className="lw-matter-older">
                <summary>{text("timeline_more", { count: olderTimeline.length })}</summary>
                <TimelineList entries={olderTimeline} locale={locale} text={text} />
              </details> : null}
            </>}
          </section>

          <div className="lw-matter-side">
            <section className="lw-matter-panel" style={reveal(5)}>
              <h2 className="lw-matter-section">{text("deadlines_title")}</h2>
              {deadlines.length === 0 ? <p className="lw-matter-empty">{text("deadlines_empty")}</p> : <ul className="lw-matter-list">
                {deadlines.map((d, index) => {
                  const anchor = anchorFor(d);
                  return (
                  <li key={deadlineKey(d, index)} id={anchor} className="lw-matter-item" data-urgency={urgencyOf(d.date, now, d.invalid)} data-highlight={(anchor && highlight === anchor) || undefined}>
                    <span className="lw-matter-cal" aria-hidden><span>{d.invalid ? "?" : weekdayShort(d.date, locale)}</span><strong>{d.invalid ? "!" : dayOfMonth(d.date)}</strong></span>
                    <span className="lw-matter-item-main">
                      <span className="lw-matter-item-title">{deadlineText(d)}</span>
                      <small>{[d.invalid ? d.date : formatDay(d.date, locale), d.source].filter(Boolean).join(" · ")}</small>
                    </span>
                    {d.invalid ? <span className="lw-matter-flag">{text("due_invalid")}</span> : d.overdue ? <span className="lw-matter-flag">{text("overdue")}</span> : !d.confirmed ? <span className="lw-matter-flag">{text("verify")}</span> : null}
                  </li>
                  );
                })}
              </ul>}
            </section>

            <section className="lw-matter-panel" style={reveal(6)}>
              <h2 className="lw-matter-section">{text("tasks_title")}</h2>
              {(cockpit?.tasks.length ?? 0) === 0 ? <p className="lw-matter-empty">{text("tasks_empty")}</p> : <ul className="lw-matter-list">
                {cockpit?.tasks.map((task) => (
                  <li key={`${task.file}/${task.id}`} className="lw-matter-item lw-matter-task" data-urgency={task.due ? urgencyOf(task.due, now) : "calm"}>
                    <span className="lw-matter-ring" aria-hidden />
                    <span className="lw-matter-item-main">
                      <span className="lw-matter-item-title">{task.title}</span>
                      {task.assignee ? <small>{task.assignee}</small> : null}
                    </span>
                    {task.due ? <span className="lw-matter-chip">{formatDay(task.due, locale)}</span> : null}
                    {task.overdue ? <span className="lw-matter-flag">{text("overdue")}</span> : null}
                  </li>
                ))}
              </ul>}
            </section>

            {cockpit && cockpit.parties.length > 0 ? (
              <section className="lw-matter-panel" data-lawoss-parties style={reveal(7)}>
                <h2 className="lw-matter-section">{t("lawoss.matters.parties", locale)}</h2>
                <ul className="lw-matter-parties">
                  {cockpit.parties.map((p, i) => (
                    <li key={`${p.file}/${p.recordId}/${i}`}>
                      <span className="lw-matter-avatar" aria-hidden>{initials(p.name)}</span>
                      <span className="lw-matter-item-main">
                        <span className="lw-matter-item-title">{p.name}</span>
                        <small>{[p.role, p.contact].filter(Boolean).join(" · ")}</small>
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}

            {attention.length > 0 ? (
              <section className="lw-matter-panel lw-matter-attention" style={reveal(8)}>
                <h2 className="lw-matter-section">{text("matter_waiting")}</h2>
                {attention.map((row) => (
                  <div key={`${row.kind}/${row.id}`} className="lw-matter-item" data-lawoss-scope={row.scope}>
                    <span className="lw-matter-dot" aria-hidden />
                    <span className="lw-matter-item-main"><span className="lw-matter-item-title">{row.title}</span>{row.date ? <small>{formatDay(row.date, locale)}</small> : null}</span>
                    <span className="lw-ref">{row.scope ? text(`scope_${row.scope}`) : null}</span>
                    <span className="lw-matter-flag">{text("verify")}</span>
                  </div>
                ))}
              </section>
            ) : null}
          </div>
        </div>
      </div>

      <div id="lite-panel-known" role="tabpanel" aria-labelledby="lite-tab-known" hidden={tab !== "known"}>
        {groups.length === 0 ? <p className="lw-matter-empty">{text("known_empty")}</p> : <div className="lw-matter-known">
          {groups.map((group, index) => (
            <section key={group.kind} className="lw-matter-panel" style={reveal(4 + index)}>
              <h2 className="lw-matter-section">{group.label || text("kind_other")}<span className="lw-matter-count">{group.facts.length}</span></h2>
              <ul className="lw-matter-facts">
                {group.facts.map((fact) => (
                  <li key={`${fact.file}/${fact.id}`} className="lw-matter-fact">
                    <span className="lw-matter-fact-head">
                      <span className="lw-matter-item-title">{fact.title}</span>
                      {fact.provenance === "overené" ? <span className="lw-matter-ok" aria-hidden>✓</span> : <span className="lw-matter-flag">{text("verify")}</span>}
                    </span>
                    {truths[fact.id] ? <p className="lw-matter-truth">{truths[fact.id]}</p> : null}
                    <small>{[fact.date ? formatDay(fact.date.slice(0, 10), locale) : null, fact.source ? `${fact.source}${fact.locator ? ` · ${fact.locator}` : ""}` : null].filter(Boolean).join(" · ")}</small>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>}
      </div>

      {scopePaths.length > 0 ? <details className="lw-matter-scope">
        <summary>{text("memory_scope")}</summary>
        <ul>{scopeLevels(scopePaths).map(({ path, level }) => <li className="break-all" key={path} data-lawoss-scope={level}><b>{text(`scope_${level}`)}</b> {path || "."}</li>)}
          {missingScopeLevels(scopePaths).map((level) => <li key={level} data-lawoss-scope-missing={level}><b>{text(`scope_${level}`)}:</b> {text(`scope_${level}_missing`)}</li>)}</ul>
      </details> : null}
      {existingMemorySources.length > 0 ? <details className="lw-matter-scope lw-matter-note" role="note">
        <summary>{text("additional_memory")} <span className="lw-matter-count">{existingMemorySources.length}</span></summary>
        <p>{text("additional_memory_note")}</p>
        <ul>{existingMemorySources.map((path) => <li className="break-all" key={path}>{path}</li>)}</ul>
        <Link className="underline" to="/settings/extensions">{text("memory_integrations")}</Link>
      </details> : null}
    </div>
  );
}

const TIMELINE_PAST_LIMIT = 8;
const parseDay = (iso: string) => new Date(`${iso}T00:00:00Z`);
/** `záznam@dátum` → [záznam, dátum]; ID záznamu môže obsahovať aj `@`, dátum je za posledným. */
const splitFocus = (value: string): [string, string] => {
  const at = value.lastIndexOf("@");
  return at < 0 ? [value, ""] : [value.slice(0, at), value.slice(at + 1)];
};

function TimelineList({ entries, locale, text }: { entries: readonly TimelineEntry[]; locale: string; text: (key: string, params?: Record<string, string | number>) => string }) {
  return <ol className="lw-matter-axis">
    {entries.map((entry) => entry.kind === "today"
      ? <li key="today" className="lw-matter-axis-today"><span>{text("strip_today")}</span></li>
      : <li key={entry.key} data-future={entry.future || undefined} data-urgency={entry.urgency}>
        <span className="lw-matter-axis-date">{formatDay(entry.date, locale)}</span>
        <span className="lw-matter-axis-text">{entry.text}{entry.future ? <small>{text("matter_upcoming")}</small> : null}</span>
      </li>)}
  </ol>;
}
const weekdayShort = (iso: string, locale: string) => new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" }).format(parseDay(iso)).replace(".", "");
const dayOfMonth = (iso: string) => parseDay(iso).getUTCDate();
const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });
const initials = (name: string) => name.split(/\s+/).filter((part) => /\p{L}/u.test(part[0] ?? "")).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "·";

/** Skupiny „Čo vieme" podľa typu záznamu, v poradí prvého výskytu - aj vlastné typy agenta. */
export function groupFacts(facts: readonly CockpitFact[]): { kind: string; label: string; facts: CockpitFact[] }[] {
  const groups = new Map<string, CockpitFact[]>();
  for (const fact of facts) groups.set(fact.kind, [...(groups.get(fact.kind) ?? []), fact]);
  return [...groups].map(([kind, items]) => ({ kind, label: kindTitle(kind) ?? "", facts: items }));
}

/** „hearing_note" → „Hearing note"; známa popiska len s veľkým začiatočným písmenom; prázdny typ = „ostatné". */
function kindTitle(kind: string): string | undefined {
  const spaced = kind.replace(/[_-]+/g, " ").trim();
  return spaced ? spaced[0].toUpperCase() + spaced.slice(1) : undefined;
}

type TimelineEntry = { kind: "event"; key: string; date: string; text: string; future: boolean; urgency?: "hot" | "near" | "calm" } | { kind: "today" };

/**
 * Časová os s rovnakým oknom ako zoznamy (view-rules): blížiace sa lehoty do horizontu nad dneškom,
 * pod ním zaznamenané udalosti a lehoty po termíne, najnovšie prvé.
 */
export function buildTimeline(events: readonly CockpitEvent[], deadlines: readonly CockpitDeadline[], todayIso: string): TimelineEntry[] {
  const dated = deadlines.filter((d) => !d.invalid && inHorizon(d.date, todayIso));
  const future: TimelineEntry[] = dated.filter((d) => d.date >= todayIso)
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((d, i) => ({ kind: "event", key: `d/${deadlineKey(d, i)}`, date: d.date, text: deadlineText(d), future: true, urgency: urgencyOf(d.date, todayIso) }));
  const past = [
    ...events.filter((e) => e.date.slice(0, 10) <= todayIso)
      .map((e, i) => ({ kind: "event" as const, key: `e/${e.recordId}/${e.date}/${i}`, date: e.date.slice(0, 10), text: e.text, future: false })),
    ...dated.filter((d) => d.date < todayIso)
      .map((d, i) => ({ kind: "event" as const, key: `p/${deadlineKey(d, i)}`, date: d.date, text: deadlineText(d), future: false, urgency: "hot" as const })),
  ].sort((a, b) => b.date.localeCompare(a.date));
  if (future.length === 0 && past.length === 0) return [];
  return [...future, { kind: "today" }, ...past];
}

/** Den a čas poslední změny konverzace, např. „čt 24. 9. 14:32“. */
function formatStamp(ms: number, locale: string): string {
  return ms ? new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(ms)) : "-";
}

/** Skill vyhotovení dokumentu do složky věci - konverzace nad věcí běží v ní. */
async function installVystupSkill(client: Parameters<NonNullable<Parameters<typeof openMatterSession>[5]>>[0], workspaceId: string): Promise<void> {
  const body = vystupSkillBody();
  await client.upsertSkill(workspaceId, { name: VYSTUP_SKILL_NAME, content: body.content, description: body.description });
  await client.upsertSkillResource(workspaceId, VYSTUP_SKILL_NAME, { name: POSTPROCESS_RESOURCE_NAME, content: postprocessSource() });
}

/** Drobček: meno klienta z tej istej funkcie ako stránka Klienti; vec bez klienta nemá drobček s menom. */
function clientCrumb(matter: MatterOverview, input: Parameters<typeof clientOf>[1]): string | undefined {
  const client = clientOf(matter, input);
  return client.key.startsWith("matter:") ? undefined : client.name;
}
