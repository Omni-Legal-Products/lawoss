/** @jsxImportSource react */
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { SetupTextKey } from "../../i18n/setup";
import { useEffect, useMemo, useState } from "react";
import { useLocal } from "@/react-app/kernel/local-provider";
import { lawyerName } from "../../okf/lawyer-name";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { useNavigate } from "react-router-dom";

import { pickDirectory } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";

import { LawossLayout } from "../../shell/layout";
import { composePrompt, documentLanguageForLocale, targetDir, type Jurisdikcia, type NovySpisForm, type SubjectKind } from "../../okf/compose-prompt";
import { loadOkfConnection, openSessionWithPrompt, type OkfConnection } from "../../okf/connection";
import { groupPlan, workspaceRelativePath, type PlanGroupItem } from "../../okf/plan-groups";
import { loadProfilePreview, type ProfilePreview } from "../../okf/load-profile";
import { previewPlan, probePlanFiles } from "../../okf/preview";
import { NOVY_SPIS_SKILL_NAME } from "../../okf/skill-bundle";
import { prepareOkfDraft, okfTargetWithinWorkspace } from "./prepare-draft";

const SUBJECTS: Array<{ id: SubjectKind; label: SetupTextKey }> = [
  { id: "pravnicka-osoba", label: "subject.company" },
  { id: "fyzicka-osoba", label: "subject.individual" },
  { id: "fyzicka-osoba-podnikatel", label: "subject.soleTrader" },
  { id: "iny-subjekt", label: "subject.other" },
  { id: "spis", label: "subject.matter" },
  { id: "projekt", label: "subject.project" },
];

type Notice = { key: SetupTextKey; params?: Record<string, string | number> } | { text: string };
type Status = ({ tone: "ok" | "warn" | "err" } & Notice) | null;
function useSetupText() {
  const locale = useLocale();
  const text = (key: SetupTextKey, params?: Record<string, string | number>): string => t(`lawoss.setup.${key}`, locale, params);
  const notice = (value: Notice): string => "key" in value ? text(value.key, value.params) : value.text;
  return { locale, text, notice };
}
/** Obsah cieľového priečinka zistený pri „Zobraziť plán“, viazaný na cestu, pre ktorú platí. */
type Probe = { dir: string; names: string[]; formKey: string; profile: ProfilePreview };

/** A confirmed preview is bound to generation inputs, including document language. */
export function isCurrentCreationPlan(probe: Pick<Probe, "dir" | "formKey"> | null, form: NovySpisForm): boolean {
  return probe?.dir === targetDir(form) && probe.formKey === JSON.stringify(form);
}

export function PlanGroup({ title, items, empty, tone }: { title: string; items: PlanGroupItem[]; empty: string; tone?: "warn" }) {
  const locale = useLocale();
  return (
    <div className={`lw-plan-group ${tone ?? ""}`}>
      <span className="lw-sc">{title}</span>
      {items.length === 0 ? <p className="lw-plan-empty">{empty}</p> : null}
      {items.map((item) => (
        <div className="lw-plan-row" key={`${title}:${item.label}`}>
          <b>{item.labelKey ? t(item.labelKey, locale) : item.label}</b>
          <span>{item.noteKey ? t(item.noteKey, locale, item.noteParams) : item.note}</span>
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
  const { locale, text, notice } = useSetupText();
  const [canWrite, setCanWrite] = useState(false);
  const [permissionError, setPermissionError] = useState<Notice | null>(null);
  useEffect(() => {
    let cancelled = false;
    setCanWrite(false);
    setPermissionError(null);
    if (!connection.client) return;
    connection.client.capabilities().then((capabilities) => {
      if (cancelled) return;
      const allowed = capabilities.skills.write && Boolean(capabilities.skillResources?.write);
      setCanWrite(allowed);
      if (!allowed) setPermissionError({ key: "error.skillWrite" });
    }).catch((error: unknown) => {
      if (!cancelled) setPermissionError({ text: error instanceof Error ? error.message : String(error) });
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
  const effectiveForm = useMemo<NovySpisForm>(() => ({ ...form, root: effectiveRoot, advokat: lawyerName(documentAuthor), documentLanguage: documentLanguageForLocale(locale) }), [form, effectiveRoot, documentAuthor, locale]);
  const rootOutsideWorkspace = !okfTargetWithinWorkspace(targetDir(effectiveForm), workspace);
  useEffect(() => {
    setProbe(null);
    setResult(null);
    setStatus(null);
  }, [effectiveForm, workspace.id]);

  async function pickRoot() {
    try {
      const picked = (await pickDirectory({ title: text("wizard.root") })) as string | null;
      if (picked) setRootOverride(picked);
    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    }
  }
  const dir = useMemo(() => targetDir(effectiveForm), [effectiveForm]);
  // Zistený obsah platí len pre cestu, pri ktorej sa zisťoval — po zmene názvu
  // alebo koreňa je plán opäť „všetko nové“, kým advokát nestlačí Zobraziť plán.
  const existing = useMemo(() => new Set(probe && isCurrentCreationPlan(probe, effectiveForm) ? probe.names : []), [probe, dir, effectiveForm]);
  const rows = useMemo(() => previewPlan(effectiveForm, (path) => existing.has(path), probe?.profile.profile), [effectiveForm, existing, probe]);
  const groups = useMemo(
    () => groupPlan(rows, { form: effectiveForm, workspacePath: workspace?.path ?? "" }),
    [rows, effectiveForm, workspace],
  );
  const prompt = useMemo(() => composePrompt(effectiveForm, probe && isCurrentCreationPlan(probe, effectiveForm)
    ? { source: probe.profile.source, warning: probe.profile.warning, profile: probe.profile.profile, paths: rows.map((row) => row.path) } : undefined), [effectiveForm, probe, dir, rows]);
  const set = <K extends keyof NovySpisForm>(key: K, value: NovySpisForm[K]) => setForm((current) => ({ ...current, [key]: value }));

  const canAct = Boolean(connection.client && canWrite && workspace.workspaceType !== "remote" && workspace.path && !rootOutsideWorkspace && form.title.trim() && form.mode === "okf");
  // Plán platí len pre cestu, pre ktorú sa zisťoval. Premenovaním veci sa schová
  // a „Potvrdiť“ zhasne — advokát nepotvrdí plán, ktorý sa medzitým zmenil.
  const planShown = isCurrentCreationPlan(probe, effectiveForm);

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
          setStatus({ tone: "err", key: "status.directoryError", params: { error: message } });
          setProbe(null); setBusy(null); return;
        }
      }
    }
    try {
      if (relative === null) throw new Error(text("error.outsideWorkspace"));
      const profile = await loadProfilePreview(connection.client, workspace.id, relative, form.subject === "spis", effectiveForm.documentLanguage);
      // Root listings omit nested .keep files; probe every planned path before calling it new.
      names = await probePlanFiles(connection.client, workspace.id, relative, effectiveForm, profile.profile);
      setProbe({ dir, names, formKey: JSON.stringify(effectiveForm), profile });
    } catch (error) {
      setProbe(null);
      setStatus({ tone: "err", key: "status.profileError", params: { error: error instanceof Error ? error.message : String(error) } });
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
        key: "status.ready", params: { workspace: workspace.name },
      });

    } catch (error) {
      setStatus({ tone: "err", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  }

  return (
    <section aria-label={text("wizard.title")}>
      <h2 className="text-lg font-medium">{text("wizard.title")}</h2>
      <p className="lw-lead">
        {text("wizard.intro")}
      </p>

      <fieldset className="lw-form" disabled={busy !== null}>
        <div className="lw-field lw-field-wide">
          <span className="lw-sc">{text("wizard.workspace")}</span>
          <p>{workspace.displayNameResolved || workspace.name} — {workspace.path}</p>
        </div>

        <div className="lw-field">
          <span className="lw-sc">{text("wizard.root")}</span>
          <div className="lw-inline">
            <input
              className="lw-input lw-mono"
              value={rootOverride}
              onChange={(event) => setRootOverride(event.target.value)}
              placeholder={workspace?.path || text("wizard.rootPlaceholder")}
            />
            {isDesktopRuntime() ? (
              <button type="button" className="lw-btn-secondary" onClick={() => void pickRoot()}>{text("wizard.browse")}</button>
            ) : null}
          </div>
          {rootOutsideWorkspace ? (
            <small className="lw-hint-warn">{text("wizard.outsideHint")}</small>
          ) : null}
        </div>

        <div className="lw-field lw-field-wide">
          <span className="lw-sc">{text("wizard.author")}</span>
          <p>{effectiveForm.advokat || text("wizard.authorMissing")}</p>
          <small>{text("wizard.authorNote")}</small>
        </div>

        <label className="lw-field">
          <span className="lw-sc">{text("wizard.subject")}</span>
          <select className="lw-input" value={form.subject} onChange={(event) => set("subject", event.target.value as SubjectKind)}>
            {SUBJECTS.map((item) => <option key={item.id} value={item.id}>{text(item.label)}</option>)}
          </select>
        </label>

        <label className="lw-field">
          <span className="lw-sc">{text("wizard.name")}</span>
          <input className="lw-input" value={form.title} onChange={(event) => set("title", event.target.value)} placeholder="ACME s.r.o." />
        </label>

        <label className="lw-field">
          <span className="lw-sc">{text("wizard.folderName")}</span>
          <input className="lw-input" value={form.slug ?? ""} onChange={(event) => set("slug", event.target.value)} placeholder={form.title || text("wizard.fromName")} />
          <small>{text("wizard.cardNameUnchanged")}</small>
        </label>

        <label className="lw-field">
          <span className="lw-sc">{text("wizard.clientId")}</span>
          <input className="lw-input lw-mono" value={form.ico} onChange={(event) => set("ico", event.target.value)} placeholder={form.subject === "fyzicka-osoba" ? text("wizard.optionalInternalId") : text("wizard.registrationExample")} />
        </label>

        {form.subject !== "spis" && form.subject !== "projekt" ? <>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.country")}</span>
            <input className="lw-input" value={form.country ?? ""} onChange={(event) => set("country", event.target.value.toUpperCase())} placeholder="SK, CZ, AT…" maxLength={2} />
          </label>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.idType")}</span>
            <input className="lw-input" value={form.identifierType ?? ""} onChange={(event) => set("identifierType", event.target.value)} placeholder={text("wizard.idTypeExample")} />
          </label>
        </> : null}
        {form.subject === "fyzicka-osoba" || form.subject === "fyzicka-osoba-podnikatel" ? <>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.citizenship")}</span>
            <input className="lw-input" value={form.citizenship ?? ""} onChange={(event) => set("citizenship", event.target.value.toUpperCase())} placeholder={text("wizard.citizenshipExample")} />
          </label>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.residence")}</span>
            <input className="lw-input" value={form.residenceCountry ?? ""} onChange={(event) => set("residenceCountry", event.target.value.toUpperCase())} placeholder="SK, CZ, AT…" maxLength={2} />
          </label>
          <p className="lw-hint">{text("wizard.individualHint")}</p>
        </> : null}
        {form.subject === "spis" ? <>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.client")}</span>
            <input className="lw-input" value={form.clientName ?? ""} onChange={(event) => set("clientName", event.target.value)} placeholder={text("wizard.existingClient")} />
            <small>{text("wizard.clientRootHint")}</small>
          </label>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.matterKind")}</span>
            <select className="lw-input" value={form.matterKind ?? "dispute"} onChange={(event) => set("matterKind", event.target.value === "advisory" ? "advisory" : event.target.value === "transaction" ? "transaction" : event.target.value === "other" ? "other" : "dispute")}>
              <option value="dispute">{text("wizard.dispute")}</option><option value="advisory">{text("wizard.advisory")}</option><option value="transaction">{text("wizard.transaction")}</option><option value="other">{text("wizard.otherMatter")}</option>
            </select>
          </label>
          <label className="lw-field">
            <span className="lw-sc">{text("wizard.workMode")}</span>
            <select className="lw-input" value={form.matterMode ?? "bounded"} onChange={(event) => set("matterMode", event.target.value === "ongoing" ? "ongoing" : "bounded")}>
              <option value="bounded">{text("wizard.bounded")}</option><option value="ongoing">{text("wizard.ongoing")}</option>
            </select>
          </label>
        </> : null}

        <div className="lw-field">
          <span className="lw-sc">{text("wizard.jurisdiction")}</span>
          <div className="lw-seg">
            {(["SK", "CZ"] as Jurisdikcia[]).map((value) => (
              <button key={value} type="button" className={`lw-seg-item ${form.jurisdikcia === value ? "on" : ""}`} onClick={() => set("jurisdikcia", value)}>
                {value === "SK" ? text("wizard.slovakia") : text("wizard.czechia")}
              </button>
            ))}
          </div>
        </div>

        <div className="lw-field" data-lawoss-document-language={effectiveForm.documentLanguage}>
          <span className="lw-sc">{text("wizard.documentLanguage")}</span>
          <span>{text(`wizard.documentLanguage_${effectiveForm.documentLanguage ?? "en"}`)}</span>
          <small>{text("wizard.documentLanguageHint")}</small>
        </div>

        <label className="lw-field">
          <span className="lw-sc">{text("wizard.opposingParty")}</span>
          <input className="lw-input" value={form.protistrana} onChange={(event) => set("protistrana", event.target.value)} placeholder={text("wizard.optional")} />
        </label>

        {form.subject !== "spis" && form.subject !== "projekt" ? <p className="lw-hint">
          {text("wizard.screeningHint")}
        </p> : null}
      </fieldset>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("wizard.structure")}</h2>
          <span className="lw-meta">{planShown ? text("wizard.noWrites", { path: dir }) : text("wizard.planNotShown")}</span>
        </div>
        {planShown ? (
          <>
            <p className="lw-plan-empty">{text("wizard.profile", { source: probe?.profile.sourceKey ? t(probe.profile.sourceKey, locale, probe.profile.sourceParams) : probe?.profile.source ?? "" })}</p>
            {probe?.profile.warning ? <p className="lw-hint-warn">{probe.profile.warningKey ? t(probe.profile.warningKey, locale) : probe.profile.warning}</p> : null}
            <PlanGroup title={text("wizard.added")} items={groups.prida} empty={text("wizard.noAdded")} />
            <PlanGroup title={text("wizard.kept")} items={groups.zostava} empty={text("wizard.noKept")} />
            <PlanGroup title={text("wizard.attention")} items={groups.pozornost} empty={text("wizard.noAttention")} tone="warn" />
          </>
        ) : (
          <p className="lw-plan-empty">{text("wizard.planHint")}</p>
        )}
      </div>

      <div className="lw-reg">
        <div className="lw-reg-h">
          <h2>{text("wizard.request")}</h2>
          <span className="lw-meta">{text("wizard.requestNote")}</span>
        </div>
        <pre className="lw-pre">{prompt}</pre>
      </div>

      {permissionError ? <div role="alert" className="lw-status err">{notice(permissionError)}</div> : null}
      {connection && !connection.client ? (
        <div className="lw-status warn">{text("wizard.disconnected")}</div>
      ) : null}
      {status ? <div className={`lw-status ${status.tone}`}>{notice(status)}</div> : null}

      <div className="lw-actions">
        <button type="button" className="lw-btn-secondary" disabled={!connection.client || rootOutsideWorkspace || workspace.workspaceType === "remote" || !form.title.trim() || busy !== null} onClick={() => void showPlan()}>
          {busy === "plan" ? text("wizard.checking") : text("wizard.showPlan")}
        </button>
        {result ? (
          <button type="button" className="lw-btn" onClick={() => onOpenSession(result.route)}>{text("wizard.openConversation")}</button>
        ) : (
          <button type="button" className="lw-btn" disabled={!canAct || !planShown || busy !== null} onClick={() => void confirmCreate()}>
            {busy === "confirm" ? text("wizard.handingOff") : text("wizard.prepareDraft")}
          </button>
        )}
      </div>

      <div className="lw-note">
        <span>{text("wizard.planNote")}</span>
        <span>{text("wizard.draftNote", { skill: NOVY_SPIS_SKILL_NAME })}</span>
        <span>{text("wizard.amlNote")}</span>
      </div>
    </section>
  );
}

/** Compatibility route; native Add folder supplies its existing connection directly. */
export function NovySpisPage() {
  const { text } = useSetupText();
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
    {!connection && !error ? <p>{text("wizard.loadingWorkspace")}</p> : null}
    {connection && !workspace ? <p>{text("wizard.openLocalFirst")}</p> : null}
    {workspaces.length > 1 ? <label>{text("wizard.workspaceLabel")} <select value={workspace?.id ?? ""} onChange={(event) => setWorkspaceId(event.target.value)}>
      {workspaces.map((item) => <option key={item.id} value={item.id}>{item.displayNameResolved || item.name}</option>)}
    </select></label> : null}
    {connection && workspace ? <NovySpisPanel documentAuthor={local.prefs.documentAuthor} key={workspace.id} connection={connection} workspace={workspace} onOpenSession={navigate} /> : null}
  </LawossLayout>;
}
