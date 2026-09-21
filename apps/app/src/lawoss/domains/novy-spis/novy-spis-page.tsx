/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { useLocal } from "@/react-app/kernel/local-provider";
import { lawyerName } from "../../okf/lawyer-name";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { useNavigate } from "react-router-dom";

import { pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";

import { LawossLayout } from "../../shell/layout";
import { composePrompt, targetDir, type Jurisdikcia, type NovySpisForm, type SubjectKind } from "../../okf/compose-prompt";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { groupPlan, workspaceRelativePath, type PlanGroupItem } from "../../okf/plan-groups";
import { loadProfilePreview, type ProfilePreview } from "../../okf/load-profile";
import { previewPlan, probePlanFiles } from "../../okf/preview";
import { NOVY_SPIS_SKILL_NAME } from "../../okf/skill-bundle";
import { prepareOkfDraft, okfTargetWithinWorkspace } from "./prepare-draft";

const SUBJECTS: Array<{ id: SubjectKind; label: string }> = [
  { id: "pravnicka-osoba", label: "Právnická osoba" },
  { id: "fyzicka-osoba", label: "Fyzická osoba" },
  { id: "fyzicka-osoba-podnikatel", label: "Fyzická osoba – podnikateľ" },
  { id: "iny-subjekt", label: "Iný subjekt" },
  { id: "spis", label: "Spis (pod existujúcim klientom)" },
  { id: "projekt", label: "Interný projekt" },
];

type Status = { tone: "ok" | "warn" | "err"; text: string } | null;
/** Obsah cieľového priečinka zistený pri „Zobraziť plán“, viazaný na cestu, pre ktorú platí. */
type Probe = { dir: string; names: string[]; formKey: string; profile: ProfilePreview };

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

export type NovySpisPanelProps = {
  connection: Pick<OkfConnection, "client" | "baseUrl" | "token">;
  workspace: RouteWorkspace;
  onOpenSession: (route: string) => void;
  documentAuthor?: string;
};

/** The native dialog and the legacy route share this workspace-bound form. */
export function NovySpisPanel({ connection, workspace, onOpenSession, documentAuthor }: NovySpisPanelProps) {
  const [canWrite, setCanWrite] = useState(false);
  const [permissionError, setPermissionError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCanWrite(false);
    setPermissionError(null);
    if (!connection.client) return;
    connection.client.capabilities().then((capabilities) => {
      if (cancelled) return;
      const allowed = capabilities.skills.write && Boolean(capabilities.skillResources?.write);
      setCanWrite(allowed);
      if (!allowed) setPermissionError("Workspace nepovoľuje zápis skillov a ich súborov.");
    }).catch((error: unknown) => {
      if (!cancelled) setPermissionError(error instanceof Error ? error.message : String(error));
    });
    return () => { cancelled = true; };
  }, [connection.client]);
  const [busy, setBusy] = useState<"plan" | "confirm" | null>(null);
  const [status, setStatus] = useState<Status>(null);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [result, setResult] = useState<{ dir: string; route: string } | null>(null);
  const [form, setForm] = useState<NovySpisForm>({
    mode: "okf", subject: "pravnicka-osoba", title: "", ico: "", jurisdikcia: "SK", root: "", protistrana: "", country: "SK", identifierType: "ICO", matterKind: "dispute", matterMode: "bounded", clientName: "",
  });
  /** Koreň zadaný ručne alebo cez dialóg; prázdny = koreň workspace-u. */
  const [rootOverride, setRootOverride] = useState("");

  const effectiveRoot = rootOverride.trim() || workspace?.path || "";
  const effectiveForm = useMemo<NovySpisForm>(() => ({ ...form, root: effectiveRoot, advokat: lawyerName(documentAuthor) }), [form, effectiveRoot, documentAuthor]);
  const rootOutsideWorkspace = !okfTargetWithinWorkspace(targetDir(effectiveForm), workspace);
  useEffect(() => {
    setProbe(null);
    setResult(null);
    setStatus(null);
  }, [effectiveForm, workspace.id]);

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
  const existing = useMemo(() => new Set(probe?.dir === dir && probe.formKey === JSON.stringify(effectiveForm) ? probe.names : []), [probe, dir, effectiveForm]);
  const rows = useMemo(() => previewPlan(effectiveForm, (path) => existing.has(path), probe?.profile.profile), [effectiveForm, existing, probe]);
  const groups = useMemo(
    () => groupPlan(rows, { form: effectiveForm, workspacePath: workspace?.path ?? "" }),
    [rows, effectiveForm, workspace],
  );
  const prompt = useMemo(() => composePrompt(effectiveForm, probe?.dir === dir && probe.formKey === JSON.stringify(effectiveForm)
    ? { source: probe.profile.source, warning: probe.profile.warning, profile: probe.profile.profile, paths: rows.map((row) => row.path) } : undefined), [effectiveForm, probe, dir, rows]);
  const set = <K extends keyof NovySpisForm>(key: K, value: NovySpisForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const canAct = Boolean(connection.client && canWrite && workspace.workspaceType !== "remote" && workspace.path && !rootOutsideWorkspace && form.title.trim() && form.mode === "okf");
  // Plán platí len pre cestu, pre ktorú sa zisťoval. Premenovaním veci sa schová
  // a „Potvrdiť“ zhasne — advokát nepotvrdí plán, ktorý sa medzitým zmenil.
  const planShown = probe?.dir === dir && probe.formKey === JSON.stringify(effectiveForm);

  /**
   * Krok „03 Návrh štruktúry“. Pýta sa servera, čo v cieľovom priečinku už je —
   * bez toho by skupina ZOSTÁVA bola vždy prázdna a plán by tvrdil, že existujúce
   * súbory vznikajú nanovo. Neexistujúci priečinok nie je chyba, len prázdny výsledok.
   */
  async function showPlan() {
    if (!connection.client || rootOutsideWorkspace || workspace.workspaceType === "remote") return;
    setBusy("plan"); setStatus(null); setResult(null);
    const relative = workspace ? workspaceRelativePath(dir.replaceAll("\\", "/"), workspace.path.replaceAll("\\", "/")) : null;
    let names: string[] = [];
    if (connection?.client && workspace && relative !== null) {
      try {
        const list = await connection.client.listWorkspaceDirectory(workspace.id, relative);
        names = list.entries.map((entry) => entry.name);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (!/404|not found|ENOENT/i.test(message)) {
          setStatus({ tone: "err", text: `Obsah priečinka sa nepodarilo overiť: ${message}` });
          setProbe(null); setBusy(null); return;
        }
      }
    }
    try {
      if (relative === null) throw new Error("Cieľ je mimo workspace.");
      const profile = await loadProfilePreview(connection.client, workspace.id, relative, form.subject === "spis");
      // Root listings omit nested .keep files; probe every planned path before calling it new.
      names = await probePlanFiles(connection.client, workspace.id, relative, effectiveForm, profile.profile);
      setProbe({ dir, names, formKey: JSON.stringify(effectiveForm), profile });
    } catch (error) {
      setProbe(null);
      setStatus({ tone: "err", text: `Profil alebo súbory sa nepodarilo overiť: ${error instanceof Error ? error.message : String(error)}` });
    }
    setBusy(null);
  }

  async function confirmCreate() {
    if (!connection.client || !canAct || !planShown) return;
    setBusy("confirm"); setStatus(null);
    try {
      const route = await prepareOkfDraft(connection.client, workspace, () => openSessionWithPrompt(
        { ...connection, workspaces: [workspace], activeWorkspaceId: workspace.id }, workspace, prompt,
      ));
      setResult({ dir, route });
      setStatus({
        tone: "ok",
        text: `Návrh čaká v novom rozhovore workspace „${workspace.name}“. Cieľový priečinok zatiaľ nebol vytvorený. Otvorte rozhovor, skontrolujte a odošlite požiadavku agentovi.`,
      });

    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label="Spis podľa OKF">
      <h2 className="text-lg font-medium">Spis podľa OKF</h2>
      <p className="lw-lead">
        Pripravte plán a návrh požiadavky pre asistenta. Po odoslaní v rozhovore agent overí plán a vytvorí priečinok; pri konflikte si vyžiada upresnenie.
      </p>

      <fieldset className="lw-form" disabled={busy !== null}>
        <div className="lw-field lw-field-wide">
          <span className="lw-sc">Workspace (kde beží agent)</span>
          <p>{workspace.displayNameResolved || workspace.name} — {workspace.path}</p>
        </div>

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
            <small className="lw-hint-warn">Vyberte cieľ vo vybranom workspace. Iný koreň najprv otvorte cez „Pridať priečinok“.</small>
          ) : null}
        </div>

        <div className="lw-field lw-field-wide">
          <span className="lw-sc">Advokát / autor dokumentov</span>
          <p>{effectiveForm.advokat || "Meno nie je nastavené. Doplňte ho v Nastavenia → Prispôsobenie; agent si chýbajúce meno vyžiada."}</p>
          <small>Spoločné meno pre nové karty a úpravy dokumentov. Meno samo neudeľuje oprávnenie na zápis.</small>
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
          <span className="lw-sc">Názov priečinka (voliteľné)</span>
          <input className="lw-input" value={form.slug ?? ""} onChange={(event) => set("slug", event.target.value)} placeholder={form.title || "Podľa názvu"} />
          <small>Názov na karte ostane nezmenený.</small>
        </label>

        <label className="lw-field">
          <span className="lw-sc">Identifikátor klienta</span>
          <input className="lw-input lw-mono" value={form.ico} onChange={(event) => set("ico", event.target.value)} placeholder={form.subject === "fyzicka-osoba" ? "interný identifikátor (voliteľné)" : "napr. IČO alebo zahraničné registračné číslo"} />
        </label>

        {form.subject !== "spis" && form.subject !== "projekt" ? <>
          <label className="lw-field">
            <span className="lw-sc">Krajina registrácie / sídla (ISO kód)</span>
            <input className="lw-input" value={form.country ?? ""} onChange={(event) => set("country", event.target.value.toUpperCase())} placeholder="SK, CZ, AT…" maxLength={2} />
          </label>
          <label className="lw-field">
            <span className="lw-sc">Typ identifikátora</span>
            <input className="lw-input" value={form.identifierType ?? ""} onChange={(event) => set("identifierType", event.target.value)} placeholder="ICO, FN, interný identifikátor…" />
          </label>
        </> : null}
        {form.subject === "fyzicka-osoba" || form.subject === "fyzicka-osoba-podnikatel" ? <>
          <label className="lw-field">
            <span className="lw-sc">Občianstvo (ISO kódy)</span>
            <input className="lw-input" value={form.citizenship ?? ""} onChange={(event) => set("citizenship", event.target.value.toUpperCase())} placeholder="SK alebo SK,CZ" />
          </label>
          <label className="lw-field">
            <span className="lw-sc">Krajina pobytu (ISO kód)</span>
            <input className="lw-input" value={form.residenceCountry ?? ""} onChange={(event) => set("residenceCountry", event.target.value.toUpperCase())} placeholder="SK, CZ, AT…" maxLength={2} />
          </label>
          <p className="lw-hint">Pri nepodnikateľovi absencia v obchodnom registri nepotvrdzuje identitu. Chýbajúce údaje asistent doplní pri identifikácii.</p>
        </> : null}
        {form.subject === "spis" ? <>
          <label className="lw-field">
            <span className="lw-sc">Klient</span>
            <input className="lw-input" value={form.clientName ?? ""} onChange={(event) => set("clientName", event.target.value)} placeholder="Názov existujúceho klienta" />
            <small>Koreňový priečinok nastav na klientov priečinok Spisy.</small>
          </label>
          <label className="lw-field">
            <span className="lw-sc">Druh veci</span>
            <select className="lw-input" value={form.matterKind ?? "dispute"} onChange={(event) => set("matterKind", event.target.value === "advisory" ? "advisory" : event.target.value === "transaction" ? "transaction" : event.target.value === "other" ? "other" : "dispute")}>
              <option value="dispute">Spor</option><option value="advisory">Poradenstvo</option><option value="transaction">Transakcia</option><option value="other">Iná vec</option>
            </select>
          </label>
          <label className="lw-field">
            <span className="lw-sc">Režim práce</span>
            <select className="lw-input" value={form.matterMode ?? "bounded"} onChange={(event) => set("matterMode", event.target.value === "ongoing" ? "ongoing" : "bounded")}>
              <option value="bounded">Ohraničené zadanie</option><option value="ongoing">Priebežná činnosť</option>
            </select>
          </label>
        </> : null}

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

        {form.subject !== "spis" && form.subject !== "projekt" ? <p className="lw-hint">
          Pri založení sa preverí príslušný register. Nedostupný alebo nejednoznačný výsledok ostane označený ako neoverený.
        </p> : null}
      </fieldset>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>Návrh štruktúry</h2>
          <span className="lw-meta">{planShown ? `${dir}/ — nič sa ešte nezapísalo` : "dry-run · zatiaľ nezobrazený"}</span>
        </div>
        {planShown ? (
          <>
            <p className="lw-plan-empty">Pracovný profil: {probe?.profile.source}</p>
            {probe?.profile.warning ? <p className="lw-hint-warn">{probe.profile.warning}</p> : null}
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

      {permissionError ? <div role="alert" className="lw-status err">{permissionError}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">Pripojenie nie je dostupné — overenie plánu ani príprava rozhovoru zatiaľ nie sú možné.</div>
      ) : null}
      {status ? <div className={`lw-status ${status.tone}`}>{status.text}</div> : null}

      <div className="lw-actions">
        <button type="button" className="lw-btn-secondary" disabled={!connection.client || rootOutsideWorkspace || workspace.workspaceType === "remote" || !form.title.trim() || busy !== null} onClick={() => void showPlan()}>
          {busy === "plan" ? "Zisťujem…" : "Zobraziť plán"}
        </button>
        {result ? (
          <button type="button" className="lw-btn" onClick={() => onOpenSession(result.route)}>Otvoriť rozhovor</button>
        ) : (
          <button type="button" className="lw-btn" disabled={!canAct || !planShown || busy !== null} onClick={() => void confirmCreate()}>
            {busy === "confirm" ? "Odovzdávam…" : "Pripraviť návrh rozhovoru"}
          </button>
        )}
      </div>

      <div className="lw-note">
        <span><b>Zobraziť plán</b> prečíta cieľový priečinok a rozdelí zmeny na tri skupiny. Zápis sa nekoná.</span>
        <span><b>Pripraviť návrh rozhovoru</b> vloží skill <span className="lw-mono">/{NOVY_SPIS_SKILL_NAME}</span> do workspace-u a uloží neodoslaný návrh v novom rozhovore. Cieľový priečinok tým ešte nevznikne.</span>
        <span>Preverenie je do získania a posúdenia zdroja neúplné. Založenie priečinka nepotvrdzuje splnenie AML povinností.</span>
      </div>
    </section>
  );
}

/** Compatibility route; native Add folder supplies its existing connection directly. */
export function NovySpisPage() {
  const local = useLocal();
  const navigate = useNavigate();
  const [connection, setConnection] = useState<OkfConnection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");
  useEffect(() => {
    let cancelled = false;
    loadOkfConnection().then((next) => {
      if (cancelled) return;
      setConnection(next);
      setWorkspaceId(next.activeWorkspaceId);
    }).catch((value: unknown) => {
      if (!cancelled) setError(value instanceof Error ? value.message : String(value));
    });
    return () => { cancelled = true; };
  }, []);
  const workspaces = connection?.workspaces.filter((item) => item.workspaceType !== "remote" && item.path) ?? [];
  const workspace = workspaces.find((item) => item.id === workspaceId) ?? workspaces[0];
  return <LawossLayout>
    {error ? <p role="alert">{error}</p> : null}
    {!connection && !error ? <p>Načítavam workspace…</p> : null}
    {connection && !workspace ? <p>Najprv otvorte lokálny pracovný priečinok cez „Pridať priečinok“.</p> : null}
    {workspaces.length > 1 ? <label>Workspace <select value={workspace?.id ?? ""} onChange={(event) => setWorkspaceId(event.target.value)}>
      {workspaces.map((item) => <option key={item.id} value={item.id}>{item.displayNameResolved || item.name}</option>)}
    </select></label> : null}
    {connection && workspace ? <NovySpisPanel documentAuthor={local.prefs.documentAuthor} key={workspace.id} connection={connection} workspace={workspace} onOpenSession={navigate} /> : null}
  </LawossLayout>;
}
