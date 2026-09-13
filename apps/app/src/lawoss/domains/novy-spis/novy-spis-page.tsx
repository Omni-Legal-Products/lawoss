/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";

import { LawossLayout } from "../../shell/layout";
import { composePrompt, targetDir, type Jurisdikcia, type NovySpisForm, type SubjectKind } from "../../okf/compose-prompt";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { groupPlan, workspaceRelativePath, type PlanGroupItem } from "../../okf/plan-groups";
import { previewPlan } from "../../okf/preview";
import { NOVY_SPIS_SKILL_NAME, OKF_CLI_RESOURCE_NAME, okfCliSource, skillBody } from "../../okf/skill-bundle";

const SUBJECTS: Array<{ id: SubjectKind; label: string }> = [
  { id: "pravnicka-osoba", label: "Právnická osoba" },
  { id: "fyzicka-osoba", label: "Fyzická osoba" },
  { id: "spis", label: "Spis (pod existujúcim klientom)" },
  { id: "projekt", label: "Interný projekt" },
];

type Status = { tone: "ok" | "warn" | "err"; text: string } | null;
/** Obsah cieľového priečinka zistený pri „Zobraziť plán“, viazaný na cestu, pre ktorú platí. */
type Probe = { dir: string; names: string[] };

function PlanGroup({ title, items, empty, tone }: { title: string; items: PlanGroupItem[]; empty: string; tone?: "warn" }) {
  return (
    <div className={`lw-plan-group ${tone ?? ""}`}>
      <span className="lw-sc">{title}</span>
      {items.length === 0 ? <p className="lw-plan-empty">{empty}</p> : null}
      {items.map((item) => (
        <div className="lw-plan-row" key={`${title}:${item.label}`}>
          <b>{item.label}</b>
          <span>{item.note}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Nový spis — Fáza A. Nič nezakladá sám: pripraví skill + CLI vo workspace a
 * odovzdá požiadavku agentovi, ktorý plán ukáže advokátovi pred zápisom.
 * Žije pod Experimentmi; upstream „Add folder“ ostáva nedotknuté.
 */
export function NovySpisPage() {
  const navigate = useNavigate();
  const [connection, setConnection] = useState<OkfConnection | null>(null);
  const [connError, setConnError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  const [busy, setBusy] = useState<"plan" | "confirm" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [result, setResult] = useState<{ dir: string; route: string } | null>(null);
  const [form, setForm] = useState<NovySpisForm>({
    mode: "okf", subject: "pravnicka-osoba", title: "", ico: "", jurisdikcia: "SK", verify: true, root: "", protistrana: "",
  });
  /** Koreň zadaný ručne alebo cez dialóg; prázdny = koreň workspace-u. */
  const [rootOverride, setRootOverride] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadOkfConnection()
      .then((next) => {
        if (cancelled) return;
        setConnection(next);
        setWorkspaceId((current) => current || next.activeWorkspaceId);
      })
      .catch((error: unknown) => {
        if (!cancelled) setConnError(error instanceof Error ? error.message : String(error));
      });
    return () => { cancelled = true; };
  }, []);

  const workspace = useMemo(
    () => connection?.workspaces.find((item) => item.id === workspaceId) ?? null,
    [connection, workspaceId],
  );
  const effectiveRoot = rootOverride.trim() || workspace?.path || "";
  const effectiveForm = useMemo<NovySpisForm>(() => ({ ...form, root: effectiveRoot }), [form, effectiveRoot]);
  const rootOutsideWorkspace = Boolean(workspace?.path && effectiveRoot && !effectiveRoot.startsWith(workspace.path));

  async function pickRoot() {
    try {
      const picked = (await pickDirectory({ title: "Koreňový priečinok pre nový spis" })) as string | null;
      if (picked) setRootOverride(picked);
    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    }
  }
  const dir = useMemo(() => targetDir(effectiveForm), [effectiveForm]);
  // Zistený obsah platí len pre cestu, pri ktorej sa zisťoval — po zmene názvu
  // alebo koreňa je plán opäť „všetko nové“, kým advokát nestlačí Zobraziť plán.
  const existing = useMemo(() => new Set(probe?.dir === dir ? probe.names : []), [probe, dir]);
  const rows = useMemo(() => previewPlan(effectiveForm, (path) => existing.has(path)), [effectiveForm, existing]);
  const groups = useMemo(
    () => groupPlan(rows, { form: effectiveForm, workspacePath: workspace?.path ?? "" }),
    [rows, effectiveForm, workspace],
  );
  const prompt = useMemo(() => composePrompt(effectiveForm), [effectiveForm]);
  const set = <K extends keyof NovySpisForm>(key: K, value: NovySpisForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const canAct = Boolean(connection?.client && workspace && form.mode === "okf");
  // Plán platí len pre cestu, pre ktorú sa zisťoval. Premenovaním veci sa schová
  // a „Potvrdiť“ zhasne — advokát nepotvrdí plán, ktorý sa medzitým zmenil.
  const planShown = probe?.dir === dir;

  /**
   * Krok „03 Návrh štruktúry“. Pýta sa servera, čo v cieľovom priečinku už je —
   * bez toho by skupina ZOSTÁVA bola vždy prázdna a plán by tvrdil, že existujúce
   * súbory vznikajú nanovo. Neexistujúci priečinok nie je chyba, len prázdny výsledok.
   */
  async function showPlan() {
    setBusy("plan"); setStatus(null); setResult(null);
    const relative = workspace ? workspaceRelativePath(dir, workspace.path) : null;
    let names: string[] = [];
    if (connection?.client && workspace && relative !== null) {
      try {
        const list = await connection.client.listWorkspaceDirectory(workspace.id, relative);
        names = list.entries.map((entry) => entry.name);
      } catch {
        // priečinok ešte nie je — plán berie všetko ako nové
      }
    }
    setProbe({ dir, names });
    setBusy(null);
  }

  async function confirmCreate() {
    if (!connection?.client || !workspace) return;
    setBusy("confirm"); setStatus(null);
    try {
      const body = skillBody();
      await connection.client.upsertSkill(workspace.id, { name: NOVY_SPIS_SKILL_NAME, content: body.content, description: body.description });
      await connection.client.upsertSkillResource(workspace.id, NOVY_SPIS_SKILL_NAME, { name: OKF_CLI_RESOURCE_NAME, content: okfCliSource() });
      const route = await openSessionWithPrompt(connection, workspace, prompt);
      setResult({ dir, route });
      setStatus({
        tone: "ok",
        text: `Skill /${NOVY_SPIS_SKILL_NAME} je vo workspace „${workspace.name}“ a požiadavka čaká v novej session. Agent spustí plán a pred zápisom si vyžiada tvoje áno.`,
      });
    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <LawossLayout>
      <h1 className="lw-h1">Nový spis</h1>
      <p className="lw-lead">
        Založíme priečinok klienta tak, aby sa v ňom vyznal agent aj bez LAWOSS. Originály ostávajú, pridáva sa iba to,
        čo chýba. Fáza A: požiadavku dostane asistent, plán ti ukáže pred zápisom.
      </p>

      <div className="lw-form">
        <div className="lw-field lw-field-wide">
          <span className="lw-sc">Ako založiť</span>
          <div className="lw-choice">
            <button type="button" className={`lw-choice-item ${form.mode === "okf" ? "on" : ""}`} onClick={() => set("mode", "okf")}>
              <b>Spis podľa OKF</b><small>AGENTS.md, karta, MEMORY.md, CLAUDE.md mirror. Predvolené.</small>
            </button>
            <button type="button" className={`lw-choice-item ${form.mode === "plain" ? "on" : ""}`} onClick={() => set("mode", "plain")}>
              <b>Obyčajný priečinok</b><small>Presne to, čo robí LegalWork dnes — použi „Add folder“ v sidebare.</small>
            </button>
          </div>
        </div>

        <label className="lw-field">
          <span className="lw-sc">Workspace (kde beží agent)</span>
          <select className="lw-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={!connection}>
            {!connection ? <option value="">načítavam…</option> : null}
            {connection && connection.workspaces.length === 0 ? <option value="">žiadny workspace</option> : null}
            {connection?.workspaces.map((item) => (
              <option key={item.id} value={item.id}>{item.displayNameResolved || item.name} — {item.path}</option>
            ))}
          </select>
        </label>

        <div className="lw-field">
          <span className="lw-sc">Koreňový priečinok (kam vznikne)</span>
          <div className="lw-inline">
            <input
              className="lw-input lw-mono"
              value={rootOverride}
              onChange={(event) => setRootOverride(event.target.value)}
              placeholder={workspace?.path || "predvolene koreň workspace-u"}
            />
            {isDesktopRuntime() ? (
              <button type="button" className="lw-btn-secondary" onClick={() => void pickRoot()}>Vybrať…</button>
            ) : null}
          </div>
          {rootOutsideWorkspace ? (
            <small className="lw-hint-warn">Mimo workspace-u — agent naň potrebuje povolenie (Tool Permissions).</small>
          ) : null}
        </div>

        <label className="lw-field">
          <span className="lw-sc">Typ subjektu</span>
          <select className="lw-input" value={form.subject} onChange={(event) => set("subject", event.target.value as SubjectKind)}>
            {SUBJECTS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>

        <label className="lw-field">
          <span className="lw-sc">Názov</span>
          <input className="lw-input" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="ACME s.r.o." />
        </label>

        <label className="lw-field">
          <span className="lw-sc">IČO</span>
          <input className="lw-input lw-mono" value={form.ico} onChange={(event) => set("ico", event.target.value)} placeholder="12345678" />
        </label>

        <div className="lw-field">
          <span className="lw-sc">Jurisdikcia</span>
          <div className="lw-seg">
            {(["SK", "CZ"] as Jurisdikcia[]).map((value) => (
              <button key={value} type="button" className={`lw-seg-item ${form.jurisdikcia === value ? "on" : ""}`} onClick={() => set("jurisdikcia", value)}>
                {value === "SK" ? "Slovensko" : "Česko"}
              </button>
            ))}
          </div>
        </div>

        <label className="lw-field">
          <span className="lw-sc">Protistrana (pri spise)</span>
          <input className="lw-input" value={form.protistrana} onChange={(event) => set("protistrana", event.target.value)} placeholder="voliteľné" />
        </label>

        <label className="lw-field lw-field-row">
          <span>Overiť subjekt v registri pri založení (ORSR · RPO)</span>
          <button type="button" role="switch" aria-checked={form.verify} className={`lw-switch ${form.verify ? "on" : ""}`} onClick={() => set("verify", !form.verify)}>
            <span className="lw-switch-knob" />
          </button>
        </label>
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Návrh štruktúry</h2>
          <span className="lw-meta">{planShown ? `${dir}/ — nič sa ešte nezapísalo` : "dry-run · zatiaľ nezobrazený"}</span>
        </div>
        {planShown ? (
          <>
            <PlanGroup title="Pridá sa" items={groups.prida} empty="nič nové — priečinok už má všetko, čo profil predpisuje" />
            <PlanGroup title="Zostáva" items={groups.zostava} empty="priečinok je prázdny alebo ešte neexistuje" />
            <PlanGroup title="Vyžaduje pozornosť" items={groups.pozornost} empty="nič — plán je bez konfliktov" tone="warn" />
          </>
        ) : (
          <p className="lw-plan-empty">Plán sa zostaví z formulára a z obsahu cieľového priečinka. Nič sa pritom nezapisuje.</p>
        )}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Požiadavka pre asistenta</h2>
          <span className="lw-meta">toto dostane agent — skill /novy-spis, potom okf CLI</span>
        </div>
        <pre className="lw-pre">{prompt}</pre>
      </div>

      {connError ? <div className="lw-status err">{connError}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — plán sa zostaví z formulára, potvrdenie nie je dostupné.</div>
      ) : null}
      {status ? <div className={`lw-status ${status.tone}`}>{status.text}</div> : null}

      <div className="lw-actions">
        <button type="button" className="lw-btn-secondary" disabled={form.mode !== "okf" || busy !== null} onClick={() => void showPlan()}>
          {busy === "plan" ? "Zisťujem…" : "Zobraziť plán"}
        </button>
        {result ? (
          <button type="button" className="lw-btn" onClick={() => navigate(result.route)}>Otvoriť spis</button>
        ) : (
          <button type="button" className="lw-btn" disabled={!canAct || !planShown || busy !== null} onClick={() => void confirmCreate()}>
            {busy === "confirm" ? "Odovzdávam…" : "Potvrdiť vytvorenie spisu"}
          </button>
        )}
      </div>

      <div className="lw-note">
        <span><b>Zobraziť plán</b> prečíta cieľový priečinok a rozdelí zmeny na tri skupiny. Zápis sa nekoná.</span>
        <span><b>Potvrdiť vytvorenie spisu</b> vloží skill <span className="lw-mono">/{NOVY_SPIS_SKILL_NAME}</span> do workspace-u a odovzdá požiadavku agentovi — ten plán zopakuje a čaká na tvoje áno.</span>
        <span>CLI beží cez <span className="lw-mono">node</span> alebo <span className="lw-mono">bun</span> na tvojom stroji — Fáza B to presunie na server.</span>
      </div>
    </LawossLayout>
  );
}
