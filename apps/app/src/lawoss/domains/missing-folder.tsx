/** @jsxImportSource react */
/**
 * Chýbajúci priečinok pracovného priestoru na stránkach LAWOSS (Dnes, Klienti a veci, detail veci).
 * Prepnutie ide cez ten istý `activateLocalWorkspace` ako rozsah kancelárie (lite/office-scope).
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { ADD_FOLDER_PATH } from "../lite/links";
import type { OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { missingFolderAlternatives } from "../okf/missing-folder";
import { OFFICE_SCOPE_RESTORED } from "../okf/read-model";

type Choice = { id: string; name: string };
type Workspace = OkfConnection["workspaces"][number];
/** Najviac toľko priečinkov na prepnutie; ostatné sú v bočnom paneli. */
const MAX_ALTERNATIVES = 3;

const nameOf = (workspace: Workspace): string => workspace.displayNameResolved || workspace.name || workspace.path;

export function MissingFolderView({ locale, name, alternatives, busy, failed = false, onSwitch }: { locale: Language; name: string; alternatives: readonly Choice[]; busy: boolean; failed?: boolean; onSwitch: (id: string) => void }) {
  return (
    <div className="lw-status warn grid gap-2" role="alert" data-lawoss-missing-folder>
      <p>{t("lawoss.lite.folder_missing", locale, { name })}</p>
      <div className="flex flex-wrap gap-2">
        <Link className="lw-btn gold" to={ADD_FOLDER_PATH}>{t("lawoss.lite.folder_missing_choose", locale)}</Link>
        {alternatives.map(choice => (
          <button key={choice.id} type="button" className="lw-btn" disabled={busy} onClick={() => onSwitch(choice.id)}>{t("lawoss.lite.folder_missing_switch", locale, { name: choice.name })}</button>
        ))}
      </div>
      {failed ? <p>{t("lawoss.lite.folder_missing_switch_failed", locale)}</p> : null}
    </div>
  );
}

export function MissingFolder({ connection, missing }: { connection: OkfConnection; missing: Workspace }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const alternatives = missingFolderAlternatives(connection.workspaces, missing).slice(0, MAX_ALTERNATIVES);
  const onSwitch = async (id: string) => {
    const target = alternatives.find(workspace => workspace.id === id);
    if (!target || !connection.client) return;
    setBusy(true); setFailed(false);
    try {
      await activateLocalWorkspace({ ...connection, client: connection.client }, target, connection.workspaces);
      // Stránky načítajú spojenie a pamäť znova, už pre nový priečinok.
      window.dispatchEvent(new CustomEvent(OFFICE_SCOPE_RESTORED));
    } catch (failure) {
      console.warn("LAWOSS: prepnutie na iný priečinok", failure);
      setFailed(true);
    } finally { setBusy(false); }
  };
  return <MissingFolderView locale={locale} name={nameOf(missing)} alternatives={alternatives.map(workspace => ({ id: workspace.id, name: nameOf(workspace) }))} busy={busy} failed={failed} onSwitch={(id) => void onSwitch(id)} />;
}
