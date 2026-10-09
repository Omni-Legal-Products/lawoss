/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowRight, CheckCircle2, FolderTree, Inbox, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { normalizeDirectoryPath } from "@/app/utils";
import { LawossLayout } from "../../shell/layout";
import { activeWorkspace, useOkfConnection } from "../../okf/read-model";
import { openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { AI_SETTINGS_PATH, useMatterModelGap } from "../../lite/matter-model";
import { LITE_CLIENTS_PATH, organizeFolderLink } from "../../lite/links";
import { installMissingOnboardingSkills } from "../onboarding/install-pack";
import { ensureSkillAvailable, workspaceSkillEngine } from "../../okf/skill-availability";

const ROZTRIED_SPIS_SKILL = "roztried-spis";
import { triageApply, triagePlan, triageReplan, triageStatus, triageTargetRoot, triageUndo, type TriageClient, type TriageMoveView, type TriagePreview, type TriageRun, type TriageStatus, type TriageUndoResult } from "./api";
import { OFFICE_CONFIG_ENCODING_CODE } from "../../../../../../lawoss/okf/src/profile";
import "../../lite/pages/okf-glass.css";
import "./triage.css";

type Text = (key: string, params?: Record<string, string | number>) => string;
/** Stabilná funkcia pre daný jazyk; nová funkcia pri každom vykreslení by znova spúšťala načítanie náhľadu. */
export const useTriageText = (locale: Language): Text => useMemo(() => (key, params) => t(`lawoss.triage.${key}`, locale, params), [locale]);
const reveal = (index: number): CSSProperties & Record<"--lw-i", number> => ({ "--lw-i": index });
const lastSegment = (path: string) => path.split(/[\\/]/).filter(Boolean).pop() ?? path;
const folderOf = (path: string) => path.split("/").slice(0, -1).join("/");

/** Kód chyby servera → veta pre advokáta. Surové hlášky (cesty, interné názvy) idú len do konzoly. */
function friendlyError(error: unknown, text: Text): string {
  console.warn("LAWOSS triage:", error);
  if (error instanceof LegalworkServerError) {
    if (error.code === "not_trial_clone") return text("not_trial");
    if (error.code === OFFICE_CONFIG_ENCODING_CODE) return text("error_office_config");
    if (error.code === "stale_preview" || (error.code === "triage_conflict" && /zmenil/.test(error.message))) return text("error_changed");
    if (error.code === "triage_conflict" && error.message.includes(": ")) return text("error_undo", { paths: error.message.slice(error.message.indexOf(": ") + 2) });
  }
  return text("error_generic");
}

/** Klon z parametra stránky, inak aktívny skúšobný klon z onboardingu, inak aktívny klient (usporiadanie na mieste). */
function useTrialRoot(connection: OkfConnection | null): { root: string | null; loading: boolean } {
  const [params] = useSearchParams();
  const fromParams = params.get("klon");
  const [fromProfile, setFromProfile] = useState<string | null | undefined>(fromParams ? null : undefined);
  useEffect(() => {
    if (fromParams || !connection?.client) return;
    let alive = true;
    connection.client.onboardingStatus().then(
      (status) => { if (alive) setFromProfile(status.profile?.trial && status.profile.clientRoot ? status.profile.clientRoot : null); },
      () => { if (alive) setFromProfile(null); },
    );
    return () => { alive = false; };
  }, [connection, fromParams]);
  return { root: triageTargetRoot({ param: fromParams, trialRoot: fromProfile, activeRoot: activeWorkspace(connection)?.path }), loading: !fromParams && fromProfile === undefined };
}

export function TriagePage() {
  const locale = useLocale();
  const { connection } = useOkfConnection();
  const { root, loading } = useTrialRoot(connection);
  const text = useTriageText(locale);
  return (
    <LawossLayout>
      <div className="lw-triage" data-lawoss="triage">
        {!connection || loading ? <p className="lw-triage-quiet">{text("loading")}</p>
          : !root ? <TriageEmpty text={text} message={text("no_root")} create />
          : <TriageFlow key={root} root={root} connection={connection} locale={locale} />}
      </div>
    </LawossLayout>
  );
}

function TriageEmpty({ text, message, create = false, organizeRoot }: { text: Text; message: string; create?: boolean; organizeRoot?: string }) {
  return (
    <section className="lw-triage-panel lw-triage-empty" style={reveal(1)}>
      <FolderTree aria-hidden size={28} />
      <p>{message}</p>
      <div className="lw-triage-row">
        {create ? <Link className="lw-today-primary" to="/welcome?continue=client">{text("create_trial")}</Link> : null}
        {organizeRoot ? <Link className="lw-btn gold" to={organizeFolderLink(organizeRoot)}>{text("organize_okf")}</Link> : null}
        <Link className="lw-triage-ghost" to={LITE_CLIENTS_PATH}>{text("back")}</Link>
      </div>
    </section>
  );
}

/** Súhrn vrátenia: koľko sa vrátilo a ktoré dokumenty ostali, lebo ich advokát medzitým zmenil (spec). */
export function TriageUndoSummary({ text, result }: { text: Text; result: TriageUndoResult }) {
  return (
    <div className="grid gap-1" role="status">
      <p>{text("undo_restored", { count: result.restored })}</p>
      {result.kept.length ? (
        <>
          <p>{text("undo_kept")}</p>
          <ul className="list-disc pl-5">{result.kept.map((path) => <li key={path}>{path}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}

type Phase = { kind: "idle" } | { kind: "busy"; label: string } | { kind: "applied"; runId: string; moved: number } | { kind: "undone"; result: TriageUndoResult };

/** Štítok a meno priečinka: skúšobný klon, alebo priečinok klienta pri usporiadaní na mieste (D1 9. 10.). */
export function TriageTopline({ text, root, inPlace }: { text: Text; root: string; inPlace: boolean }) {
  return <p className="lw-triage-topline"><span className="lw-triage-chip">{text(inPlace ? "folder_in_place" : "folder")}</span> {lastSegment(root)}</p>;
}

function TriageFlow({ root, connection, locale }: { root: string; connection: OkfConnection; locale: Language }) {
  const text = useTriageText(locale);
  const navigate = useNavigate();
  const client: TriageClient | null = connection.client;
  const [status, setStatus] = useState<TriageStatus | null>(null);
  const [preview, setPreview] = useState<TriagePreview | null>(null);
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const [error, setError] = useState<string | null>(null);
  const [askUndo, setAskUndo] = useState<string | null>(null);
  const alive = useRef(true);
  // StrictMode efekt odpojí a znova pripojí; príznak sa musí pri pripojení obnoviť.
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  const run = useCallback(async <T,>(label: string, action: () => Promise<T>): Promise<T | undefined> => {
    setPhase({ kind: "busy", label }); setError(null);
    try { return await action(); }
    catch (failure) { if (alive.current) setError(friendlyError(failure, text)); return undefined; }
    finally { if (alive.current) setPhase((current) => current.kind === "busy" ? { kind: "idle" } : current); }
  }, [text]);

  const load = useCallback(async (useModel = false) => {
    if (!client) return;
    const next = await run(text("loading"), async () => {
      const state = await triageStatus(client, root);
      if (alive.current) setStatus(state);
      return state.trial ? triagePlan(client, root, useModel) : null;
    });
    if (alive.current && next !== undefined) setPreview(next);
  }, [client, root, run, text]);
  useEffect(() => { void load(); }, [load]);

  const lastApplied: TriageRun | undefined = status?.trial ? status.runs.find((item) => item.state === "applied") : undefined;
  const busy = phase.kind === "busy";

  async function toggleKeep(id: string, keep: boolean) {
    if (!client || !preview) return;
    const ids = new Set(preview.keepInInbox);
    if (keep) ids.add(id); else ids.delete(id);
    const next = await run(text("updating"), () => triageReplan(client, preview.id, [...ids]));
    if (next && alive.current) setPreview(next);
  }
  async function confirm() {
    if (!client || !preview) return;
    const result = await run(text("applying"), () => triageApply(client, preview));
    if (result && alive.current) { setPhase({ kind: "applied", runId: result.runId, moved: result.moved }); setPreview(null); setStatus(await triageStatus(client, root).catch(() => status)); }
  }
  async function undo(runId: string) {
    if (!client) return;
    setAskUndo(null);
    const result = await run(text("undoing"), () => triageUndo(client, root, runId));
    if (result && alive.current) { setPhase({ kind: "undone", result }); await load(); setPhase({ kind: "undone", result }); }
  }

  if (status && !status.trial) return <TriageEmpty text={text} message={text("not_reorganizable")} organizeRoot={root} />;
  const inPlace = status?.trial === true && status.mode === "in_place";
  return (
    <>
      <header className="lw-triage-hero" style={reveal(0)}>
        <TriageTopline text={text} root={root} inPlace={inPlace} />
        <h1 className="lw-h1">{text(inPlace ? "in_place_title" : "title")}</h1>
        {inPlace ? null : <p className="lw-triage-lead">{text("lead")}</p>}
      </header>

      {error ? <div className="lw-status warn lw-triage-alert" role="alert"><TriangleAlert aria-hidden size={18} /><span>{error}</span><button type="button" className="lw-triage-ghost" onClick={() => void load()}>{text("refresh")}</button></div> : null}

      {phase.kind === "applied" || phase.kind === "undone" ? (
        <section className="lw-triage-panel lw-triage-done" style={reveal(1)} role="status">
          <CheckCircle2 aria-hidden size={22} />
          {phase.kind === "applied" ? <p>{text("done", { count: phase.moved })}</p> : inPlace ? <TriageUndoSummary text={text} result={phase.result} /> : <p>{text("undone")}</p>}
          {phase.kind === "applied" ? <Link className="lw-triage-ghost" to={LITE_CLIENTS_PATH}>{text("open_clients")}</Link> : null}
          {phase.kind === "applied" ? <button type="button" className="lw-triage-ghost" onClick={() => setAskUndo(phase.runId)}><RotateCcw aria-hidden size={15} /> {text("undo")}</button> : null}
        </section>
      ) : null}
      {phase.kind !== "applied" && lastApplied ? (
        <section className="lw-triage-panel lw-triage-last" style={reveal(1)}>
          <span>{text("last_run", { date: new Date(lastApplied.createdAt).toLocaleString(locale) })}</span>
          <button type="button" className="lw-triage-ghost" disabled={busy} onClick={() => setAskUndo(lastApplied.runId)}><RotateCcw aria-hidden size={15} /> {text("undo")}</button>
        </section>
      ) : null}
      {askUndo ? (
        <section className="lw-triage-panel lw-triage-ask" role="alertdialog" aria-label={text("undo")}>
          <p>{text(inPlace ? "undo_question_in_place" : "undo_question")}</p>
          <div className="lw-triage-row">
            <button type="button" className="lw-today-primary" disabled={busy} onClick={() => void undo(askUndo)}>{text("undo_yes")}</button>
            <button type="button" className="lw-triage-ghost" onClick={() => setAskUndo(null)}>{text("cancel")}</button>
          </div>
        </section>
      ) : null}

      {busy ? <p className="lw-triage-quiet" aria-live="polite">{phase.label}</p> : null}
      {phase.kind !== "applied" && !askUndo && preview ? <TriagePreviewView preview={preview} text={text} busy={busy} inPlace={inPlace} onKeep={toggleKeep} onConfirm={confirm} onModel={(useModel) => void load(useModel)}
        model={<ModelPanel root={root} connection={connection} locale={locale} preview={preview} busy={busy} inPlace={inPlace} onOpen={(path) => navigate(path)} onError={(message) => setError(message)} />} /> : null}
    </>
  );
}

/** Spresnenie modelom: jasná informácia o odoslaní obsahu, súhlas, potom rozhovor so skillom /roztried-spis. */
function ModelPanel({ root, connection, locale, preview, busy, inPlace, onOpen, onError }: { root: string; connection: OkfConnection; locale: Language; preview: TriagePreview; busy: boolean; inPlace: boolean; onOpen: (path: string) => void; onError: (message: string) => void }) {
  const text = useTriageText(locale);
  const gap = useMatterModelGap(connection);
  const [consent, setConsent] = useState(false);
  const [opening, setOpening] = useState(false);
  const workspace = useMemo(() => connection.workspaces.find((item) => normalizeDirectoryPath(item.path) === normalizeDirectoryPath(root)) ?? null, [connection.workspaces, root]);
  async function open() {
    if (!workspace || !connection.client) { onError(text("model_no_workspace")); return; }
    setOpening(true);
    try {
      await installMissingOnboardingSkills(connection.client, workspace.id, locale);
      // Engine musí skill vidieť skôr, než sa rozhovor otvorí; inak prvá správa skončí „Command not found“.
      const engine = workspaceSkillEngine(connection, workspace);
      const availability = engine ? await ensureSkillAvailable(engine, ROZTRIED_SPIS_SKILL) : "missing";
      if (availability === "busy" || availability === "missing") { onError(text(availability === "busy" ? "model_skill_busy" : "model_skill_missing")); return; }
      // Advokát vidí meno klona; cestu si skill zistí sám (`triage status` v priečinku rozhovoru).
      onOpen(await openSessionWithPrompt(connection, workspace, text("model_prompt", { client: lastSegment(root) })));
    } catch (failure) { onError(friendlyError(failure, text)); }
    finally { setOpening(false); }
  }
  return (
    <section className="lw-triage-panel lw-triage-model" style={reveal(2)}>
      <header><Sparkles aria-hidden size={18} /><h2>{text("model_title")}</h2></header>
      <p className="lw-triage-muted">{text("model_lead")}</p>
      {preview.proposal?.state === "stale" ? <p className="lw-triage-note">{text("model_stale")}</p> : null}
      {preview.proposal?.state === "invalid" ? <p className="lw-triage-note">{text("model_invalid")}</p> : null}
      {gap ? (
        <p className="lw-triage-note">{text("model_missing")} <Link to={AI_SETTINGS_PATH}>{text("model_connect")}</Link></p>
      ) : (
        <>
          <p className="lw-triage-privacy" role="note"><TriangleAlert aria-hidden size={16} /> {text(inPlace ? "model_privacy_in_place" : "model_privacy")}</p>
          <label className="lw-triage-consent"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> {text("model_consent")}</label>
          <button type="button" className="lw-triage-ghost" disabled={!consent || opening || busy} onClick={() => void open()}>{text("model_open")} <ArrowRight aria-hidden size={15} /></button>
        </>
      )}
    </section>
  );
}

const ROLE_KEYS = ["inbox", "client_documents", "research", "drafts", "outputs", "correspondence", "important_mail"] as const;
const RULE_KEYS = new Set(["email_file", "data_box", "power_of_attorney", "court_decision", "demand_letter", "draft_marker", "filing_final", "filing_draft", "contract", "invoice", "registry_extract", "research", "final_output", "folder_hint", "unknown"]);

function reasonOf(move: TriageMoveView, text: Text): string {
  if (move.source === "user") return text("reason_user");
  if (move.source === "fallback") return text("reason_fallback");
  if (move.source === "model") return move.reason || text("source_model");
  return move.rule && RULE_KEYS.has(move.rule) ? text(`reason_${move.rule}`, { matched: move.matched ?? "" }) : "";
}

/**
 * Náhľad ako tabuľka: dokument, odkiaľ, kam, prečo, istota, nová vec; riadok sa dá nechať na zatriedenie.
 * `inPlace`: priečinok klienta na mieste (nie skúšobný klon), texty potom o klone nehovoria.
 */
export function TriagePreviewView({ preview, text, busy, inPlace = false, onKeep, onConfirm, onModel, model }: { preview: TriagePreview; text: Text; busy: boolean; inPlace?: boolean; onKeep: (id: string, keep: boolean) => void; onConfirm: () => void; onModel: (useModel: boolean) => void; model?: ReactNode }) {
  const matters = new Map(preview.matters.map((matter) => [matter.key, matter]));
  const inbox = preview.moves.filter((move) => move.role === "inbox").length;
  const keep = new Set(preview.keepInInbox);
  // Najprv zaradené u klienta, potom veci, nakoniec to, čo čaká na zatriedenie.
  const order = (move: TriageMoveView) => move.role === "inbox" ? ROLE_KEYS.length : ROLE_KEYS.indexOf(move.role);
  const rows = [...preview.moves].sort((a, b) => Number(a.role === "inbox") - Number(b.role === "inbox") || (a.matter ?? "").localeCompare(b.matter ?? "") || order(a) - order(b) || a.from.localeCompare(b.from));
  if (preview.documents === 0) return <p className="lw-triage-quiet">{text(inPlace ? "nothing_in_place" : "nothing")}</p>;
  return (
    <>
      <dl className="lw-triage-stats" style={reveal(1)}>
        <div><dd>{preview.documents}</dd><dt>{text("stat_documents")}</dt></div>
        <div><dd>{preview.moves.length - inbox}</dd><dt>{text("stat_sorted")}</dt></div>
        <div data-tone={inbox ? "calm" : undefined}><dd>{inbox}</dd><dt>{text("stat_inbox")}</dt></div>
        <div data-tone={preview.matters.length ? "gold" : undefined}><dd>{preview.matters.length}</dd><dt>{text("stat_matters")}</dt></div>
      </dl>

      {model}
      {preview.proposal?.state === "ready" || preview.classification.used ? (
        <div className="lw-triage-switch" role="group" style={reveal(2)}>
          <span>{preview.classification.used ? text("model_used") : text("model_ready")}</span>
          <button type="button" className="lw-triage-ghost" disabled={busy} aria-pressed={!preview.classification.used} onClick={() => onModel(false)}>{text("model_rules_only")}</button>
          <button type="button" className="lw-triage-ghost" disabled={busy} aria-pressed={preview.classification.used} onClick={() => onModel(true)}>{text("model_use")}</button>
        </div>
      ) : null}

      {preview.matters.length ? (
        <section className="lw-triage-matters" style={reveal(3)}>
          <h2>{text("matters_title")}</h2>
          <ul>
            {preview.matters.map((matter) => (
              <li key={matter.key} className="lw-triage-panel lw-triage-matter">
                <strong>{matter.title}</strong>
                <small>{[matter.caseNumber ? text("matter_case", { case: matter.caseNumber }) : "", matter.counterparty ? text("matter_counterparty", { name: matter.counterparty }) : "", text("matter_documents", { count: matter.documents })].filter(Boolean).join(" · ")}</small>
                <small className="lw-triage-muted">{matter.source === "model" ? text("matter_from_model") : text("matter_from_rules")}{matter.dateSource === "today" ? ` · ${text("matter_date_today")}` : ""}</small>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="lw-triage-panel lw-triage-table-wrap" style={reveal(4)}>
        <table className="lw-triage-table">
          <thead><tr><th>{text("col_document")}</th><th>{text("col_from")}</th><th>{text("col_to")}</th><th>{text("col_reason")}</th><th>{text("col_confidence")}</th><th>{text("col_keep")}</th></tr></thead>
          <tbody>
            {rows.map((move) => {
              const matter = move.matter ? matters.get(move.matter) : undefined;
              const from = folderOf(move.from);
              return (
                <tr key={move.id} data-role={move.role}>
                  <td className="lw-triage-name" title={move.from}>{lastSegment(move.from)}</td>
                  <td className={from ? "lw-triage-path" : "lw-triage-from-root"}>{from || text("root_folder")}</td>
                  <td>
                    <span className="lw-triage-role">{move.role === "inbox" ? <Inbox aria-hidden size={13} /> : null}{text(`role_${move.role}`)}</span>
                    {matter ? <span className="lw-triage-matter-chip">{matter.title} <em>{text("new_matter_badge")}</em></span> : move.matter ? <span className="lw-triage-matter-chip">{folderOf(folderOf(move.to)).split("/").pop()}</span> : null}
                    <small className="lw-triage-path" title={move.to}>{folderOf(move.to)}{move.renamed ? ` · ${text("renamed")}` : ""}</small>
                  </td>
                  <td className="lw-triage-reason">{reasonOf(move, text)}{move.truncated ? <small> · {text("truncated")}</small> : null}</td>
                  <td><span className="lw-triage-confidence" data-level={move.confidence}>{text(`confidence_${move.confidence}`)}</span></td>
                  <td className="lw-triage-keep"><input type="checkbox" aria-label={`${text("col_keep")}: ${lastSegment(move.from)}`} checked={keep.has(move.id)} disabled={busy || (move.role === "inbox" && !keep.has(move.id) && !move.matter)} onChange={(event) => onKeep(move.id, event.target.checked)} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {preview.stays.length ? (
        <section className="lw-triage-stays" style={reveal(5)}>
          <h2>{text("stays_title")}</h2>
          <ul>{preview.stays.map((stay) => <li key={stay.id}><span>{stay.path}</span> <small>{text(`stay_${stay.why}`)}</small></li>)}</ul>
        </section>
      ) : null}

      <footer className="lw-triage-bar" style={reveal(6)}>
        <p>{inPlace ? text("confirm_note_in_place") : text("confirm_note", { count: preview.moves.length })}</p>
        <button type="button" className="lw-today-primary" disabled={busy || preview.moves.length === 0} onClick={onConfirm}>{text("confirm")}</button>
      </footer>
    </>
  );
}
