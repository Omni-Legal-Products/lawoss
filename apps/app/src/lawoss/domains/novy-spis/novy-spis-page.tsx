/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { LawossLayout } from "../../shell/layout";
import { composePrompt, targetDir, type Jurisdikcia, type NovySpisForm, type SubjectKind } from "../../okf/compose-prompt";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { previewPlan } from "../../okf/preview";
import { NOVY_SPIS_SKILL_NAME, OKF_CLI_RESOURCE_NAME, okfCliSource, skillBody } from "../../okf/skill-bundle";

const SUBJECTS: Array<{ id: SubjectKind; label: string }> = [
  { id: "pravnicka-osoba", label: "Právnická osoba" },
  { id: "fyzicka-osoba", label: "Fyzická osoba" },
  { id: "spis", label: "Spis (pod existujúcim klientom)" },
  { id: "projekt", label: "Interný projekt" },
];

type Status = { tone: "ok" | "warn" | "err"; text: string } | null;

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
  const [busy, setBusy] = useState<"skill" | "session" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [form, setForm] = useState<NovySpisForm>({
    mode: "okf", subject: "pravnicka-osoba", title: "", ico: "", jurisdikcia: "SK", verify: true, root: "", protistrana: "",
  });

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
  const effectiveForm = useMemo<NovySpisForm>(() => ({ ...form, root: workspace?.path ?? "" }), [form, workspace]);
  const preview = useMemo(() => previewPlan(effectiveForm), [effectiveForm]);
  const prompt = useMemo(() => composePrompt(effectiveForm), [effectiveForm]);
  const set = <K extends keyof NovySpisForm>(key: K, value: NovySpisForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const canAct = Boolean(connection?.client && workspace && form.mode === "okf");

  async function installSkill() {
    if (!connection?.client || !workspace) return;
    setBusy("skill"); setStatus(null);
    try {
      const body = skillBody();
      await connection.client.upsertSkill(workspace.id, { name: NOVY_SPIS_SKILL_NAME, content: body.content, description: body.description });
      await connection.client.upsertSkillResource(workspace.id, NOVY_SPIS_SKILL_NAME, { name: OKF_CLI_RESOURCE_NAME, content: okfCliSource() });
      setStatus({ tone: "ok", text: `Skill /${NOVY_SPIS_SKILL_NAME} a ${OKF_CLI_RESOURCE_NAME} sú v .opencode/skills/ workspace-u „${workspace.name}“.` });
    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  async function openAssistant() {
    if (!connection || !workspace) return;
    setBusy("session"); setStatus(null);
    try {
      const route = await openSessionWithPrompt(connection, workspace, prompt);
      navigate(route);
    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
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
          <span className="lw-sc">Workspace (koreň)</span>
          <select className="lw-input" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} disabled={!connection}>
            {!connection ? <option value="">načítavam…</option> : null}
            {connection && connection.workspaces.length === 0 ? <option value="">žiadny workspace</option> : null}
            {connection?.workspaces.map((item) => (
              <option key={item.id} value={item.id}>{item.displayNameResolved || item.name} — {item.path}</option>
            ))}
          </select>
        </label>

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
          <h2>Čo vznikne — dry-run</h2>
          <span className="lw-meta">nič sa ešte nezapísalo</span>
        </div>
        <pre className="lw-pre lw-mono">{`${targetDir(effectiveForm)}/\n${preview.map((path, index) => `${index === preview.length - 1 ? "└──" : "├──"} ${path}`).join("\n")}`}</pre>
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
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — náhľad funguje, inštalácia a asistent nie.</div>
      ) : null}
      {status ? <div className={`lw-status ${status.tone}`}>{status.text}</div> : null}

      <div className="lw-actions">
        <button type="button" className="lw-btn-secondary" disabled={!canAct || busy !== null} onClick={() => void installSkill()}>
          {busy === "skill" ? "Inštalujem…" : "1 · Pripraviť skill a CLI vo workspace"}
        </button>
        <button type="button" className="lw-btn" disabled={!canAct || busy !== null} onClick={() => void openAssistant()}>
          {busy === "session" ? "Otváram…" : "2 · Založiť cez asistenta"}
        </button>
      </div>

      <div className="lw-note">
        <span>Krok 1 stačí raz na workspace — skill je súbor v <span className="lw-mono">.opencode/skills/</span>.</span>
        <span>Krok 2 otvorí session s požiadavkou. Agent spustí <b>plan</b> a čaká na tvoje áno.</span>
        <span>CLI beží cez <span className="lw-mono">node</span> alebo <span className="lw-mono">bun</span> na tvojom stroji — Fáza B to presunie na server.</span>
      </div>
    </LawossLayout>
  );
}
