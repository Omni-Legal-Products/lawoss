/** @jsxImportSource react */
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useEffect, useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { LayoutSection, LayoutSectionDescription, LayoutSectionHeader, LayoutSectionTitle } from "@/react-app/domains/settings/settings-layout";
import { loadOfficeProfile, saveOfficeProfile, type OfficeProfileSnapshot } from "../../okf/office-profile";

const roles: Record<string, string> = {
  inbox: "lawoss.integrations.office.role.inbox", client_documents: "lawoss.integrations.office.role.client_documents", research: "lawoss.integrations.office.role.research",
  drafts: "lawoss.integrations.office.role.drafts", outputs: "lawoss.integrations.office.role.outputs", correspondence: "lawoss.integrations.office.role.correspondence", important_mail: "lawoss.integrations.office.role.important_mail",
};
type Props = { client: LegalworkServerClient | null; workspaceId: string | null; workspacePath: string; workspaceName: string; remote?: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function OfficeProfileView({ client, workspaceId, workspacePath, workspaceName, remote }: Props) {
  const locale = useLocale();
  const [loaded, setLoaded] = useState<{ snapshot: OfficeProfileSnapshot; writable: boolean } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false;
    setLoaded(null); setError("");
    if (!client || !workspaceId || remote || !workspacePath) return;
    Promise.all([loadOfficeProfile(client, workspaceId, workspacePath), client.capabilities()]).then(([snapshot, capabilities]) => {
      if (!cancelled) setLoaded({ snapshot, writable: capabilities.config.write });
    }).catch((failure: unknown) => { if (!cancelled) setError(message(failure)); });
    return () => { cancelled = true; };
  }, [client, workspaceId, workspacePath, remote, reload]);
  return <LayoutSection>
    <LayoutSectionHeader>
      <LayoutSectionTitle>{t("lawoss.integrations.office.title", locale)}</LayoutSectionTitle>
      <LayoutSectionDescription>
        {t("lawoss.integrations.office.description", locale)}
      </LayoutSectionDescription>
    </LayoutSectionHeader>
    {!client || !workspaceId || !workspacePath || remote ? <p>{t("lawoss.integrations.office.select_local", locale)}</p>
      : <>
        <p className="text-sm text-muted-foreground">{workspaceName} — {workspacePath}</p>
        {error ? <div role="alert" className="space-y-2"><p>{error}</p><Button variant="outline" onClick={() => setReload((v) => v + 1)}>{t("lawoss.integrations.retry", locale)}</Button></div>
          : loaded ? <OfficeProfileEditor key={reload} client={client} workspaceId={workspaceId} initial={loaded.snapshot} writable={loaded.writable} onReload={() => setReload((v) => v + 1)} />
            : <p role="status">{t("lawoss.integrations.office.loading", locale)}</p>}
      </>}
  </LayoutSection>;
}

export function OfficeProfileEditor({ client, workspaceId, initial, writable, onReload }: {
  client: Pick<LegalworkServerClient, "statWorkspaceFile" | "readWorkspaceFile" | "writeWorkspaceFile">;
  workspaceId: string; initial: OfficeProfileSnapshot; writable: boolean; onReload: () => void;
}) {
  const locale = useLocale();
  const [snapshot, setSnapshot] = useState(initial);
  const [folders, setFolders] = useState(initial.value.profile.folders.join("\n"));
  const [mapping, setMapping] = useState(initial.value.profile.roles);
  const [naming, setNaming] = useState(initial.value.profile.naming);
  const [clientPath, setClientPath] = useState(initial.value.clientPath);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const choices = folders.split("\n").filter((folder) => folder.trim() !== "");
  const changed = folders !== snapshot.value.profile.folders.join("\n") || naming !== snapshot.value.profile.naming || clientPath !== snapshot.value.clientPath || JSON.stringify(mapping) !== JSON.stringify(snapshot.value.profile.roles);
  async function save() {
    if (!writable || busy) return;
    setBusy(true); setNotice(null);
    try {
      const next = await saveOfficeProfile(client, workspaceId, snapshot, { profile: { folders: choices, roles: mapping, naming }, clientPath });
      setSnapshot(next);
      setNotice({ error: false, text: "" });
    } catch (error) { setNotice({ error: true, text: message(error) }); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="text-sm text-muted-foreground">{snapshot.content === null ? t("lawoss.integrations.office.create", locale) : t("lawoss.integrations.office.edit", locale)}: {snapshot.path}</p>
    {!writable ? <p role="status">{t("lawoss.integrations.office.read_only", locale)}</p> : null}
    <fieldset disabled={!writable || busy} className="space-y-4">
      <label className="block space-y-2"><span className="text-sm font-medium">{t("lawoss.integrations.office.folders", locale)}</span>
        <Textarea value={folders} onChange={(event) => setFolders(event.target.value)} rows={7} aria-describedby="office-folders-help" />
        <span id="office-folders-help" className="block text-xs text-muted-foreground">{t("lawoss.integrations.office.folders_help", locale)}</span>
      </label>
      <div className="grid gap-3 sm:grid-cols-2">
        {[...new Set([...Object.keys(roles), ...Object.keys(mapping)])].map((role) => <label key={role} className="block space-y-1">
          <span className="text-sm">{roles[role] ? t(roles[role], locale) : role}</span>
          <select className="h-9 w-full rounded-md border border-input bg-surface px-3 text-sm" value={mapping[role] ?? ""} onChange={(event) => {
            const value = event.target.value;
            setMapping((previous) => { const next = { ...previous }; if (value) next[role] = value; else delete next[role]; return next; });
          }}>
            <option value="">{t("lawoss.integrations.office.unassigned", locale)}</option>
            {mapping[role] && !choices.includes(mapping[role]) ? <option value={mapping[role]}>{t("lawoss.integrations.missing", locale, { value: mapping[role] })}</option> : null}
            {[...new Set(choices)].map((folder) => <option key={folder} value={folder}>{folder}</option>)}
          </select>
        </label>)}
      </div>
      <label className="block space-y-2"><span className="text-sm font-medium">{t("lawoss.integrations.office.naming", locale)}</span>
        <Input value={naming} onChange={(event) => setNaming(event.target.value)} aria-describedby="office-naming-help" />
        <span id="office-naming-help" className="block text-xs text-muted-foreground">{t("lawoss.integrations.office.naming_help", locale)}</span>
      </label>
      <label className="block space-y-2"><span className="text-sm font-medium">{t("lawoss.integrations.office.client_path", locale)}</span>
        <Input value={clientPath} onChange={(event) => setClientPath(event.target.value)} placeholder="Klienti/*" aria-describedby="office-clients-help" />
        <span id="office-clients-help" className="block text-xs text-muted-foreground">{t("lawoss.integrations.office.client_help", locale)}</span>
      </label>
      <div className="flex gap-2">
        <Button onClick={() => void save()} disabled={busy || !changed && snapshot.content !== null}>{busy ? t("lawoss.integrations.office.saving", locale) : t("lawoss.integrations.office.save", locale)}</Button>
        <Button variant="outline" onClick={onReload}>{t("lawoss.integrations.discard_reload", locale)}</Button>
      </div>
    </fieldset>
    {notice ? <p role={notice.error ? "alert" : "status"}>{notice.error ? notice.text : t("lawoss.integrations.office.saved", locale)}</p> : null}
  </div>;
}
