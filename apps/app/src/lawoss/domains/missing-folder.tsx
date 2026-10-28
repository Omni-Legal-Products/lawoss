/** @jsxImportSource react */
/**
 * Chýbajúci priečinok pracovného priestoru na stránkach LAWOSS (Dnes, Klienti a veci, detail veci).
 * Prepnutie ide cez ten istý `activateLocalWorkspace` ako rozsah kancelárie (lite/office-scope).
 * „Nájsť presunutý priečinok“ (N-A7-1) prepojí existujúcich klientov na nové miesto namiesto ich nového pridania.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "@/react-app/domains/workspace/project-folder-recovery";
import { ADD_FOLDER_PATH } from "../lite/links";
import type { OkfConnection } from "../okf/connection";
import { activateLocalWorkspace } from "../okf/matter-session";
import { missingFolderAlternatives, switchToWorkspace } from "../okf/missing-folder";
import { lastSegment, previewMovedFolder, reconnectMovedFolder, withReconnectedPaths, type MovedFolderPreview } from "../okf/moved-folder";

type Choice = { id: string; name: string };
type Workspace = OkfConnection["workspaces"][number];
/** Najviac toľko priečinkov na prepnutie; ostatné sú v bočnom paneli. */
const MAX_ALTERNATIVES = 3;

const nameOf = (workspace: Workspace): string => workspace.displayNameResolved || workspace.name || workspace.path;

/** Náhľad prepojenia pre advokáta: kam, koho prepojí a koho nenašiel. */
export type MovedFolderReview = { folder: string; names: readonly string[]; notFound: readonly string[] };

type ViewProps = {
  locale: Language; name: string; alternatives: readonly Choice[]; busy: boolean; failed?: boolean; onSwitch: (id: string) => void;
  /** Bez `onFind` (napr. bez spojenia so serverom) sa ponuka hľadania neukáže. */
  onFind?: () => void; review?: MovedFolderReview | null; notice?: string | null; onConfirm?: () => void; onCancel?: () => void;
};

export function MissingFolderView({ locale, name, alternatives, busy, failed = false, onSwitch, onFind, review, notice, onConfirm, onCancel }: ViewProps) {
  return (
    <div className="lw-status warn grid gap-2" role="alert" data-lawoss-missing-folder>
      <p>{t("lawoss.lite.folder_missing", locale, { name })}</p>
      {review ? (
        <div className="grid gap-2" data-lawoss-moved-folder-review>
          <p>{t("lawoss.lite.folder_missing_review", locale, { folder: review.folder, names: review.names.join(", ") })}</p>
          {review.notFound.length ? <p>{t("lawoss.lite.folder_missing_review_missing", locale, { names: review.notFound.join(", ") })}</p> : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="lw-btn gold" disabled={busy} onClick={onConfirm}>{t("lawoss.lite.folder_missing_connect", locale)}</button>
            <button type="button" className="lw-btn" disabled={busy} onClick={onCancel}>{t("lawoss.lite.folder_missing_cancel", locale)}</button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          {onFind ? <button type="button" className="lw-btn gold" disabled={busy} onClick={onFind}>{t("lawoss.lite.folder_missing_find", locale)}</button> : null}
          <Link className={onFind ? "lw-btn" : "lw-btn gold"} to={ADD_FOLDER_PATH}>{t("lawoss.lite.folder_missing_choose", locale)}</Link>
          {alternatives.map(choice => (
            <button key={choice.id} type="button" className="lw-btn" disabled={busy} onClick={() => onSwitch(choice.id)}>{t("lawoss.lite.folder_missing_switch", locale, { name: choice.name })}</button>
          ))}
        </div>
      )}
      {notice ? <p>{notice}</p> : null}
      {failed ? <p>{t("lawoss.lite.folder_missing_switch_failed", locale)}</p> : null}
    </div>
  );
}

/** Veta k zlyhanému náhľadu: iný priečinok než prax, pôvodný sa medzitým našiel, inak všeobecná. */
export function movedFolderErrorText(error: unknown, locale: Language): string {
  if (error instanceof LegalworkServerError && error.code === "moved_folder_not_practice") return t("lawoss.lite.folder_missing_not_practice", locale);
  return t("lawoss.lite.folder_missing_find_failed", locale);
}

export function MissingFolder({ connection, missing, unavailable }: { connection: OkfConnection; missing: Workspace; unavailable?: ReadonlySet<string> }) {
  const locale = useLocale();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [preview, setPreview] = useState<MovedFolderPreview | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const alternatives = missingFolderAlternatives(connection.workspaces, missing, connection.activeWorkspaceId, unavailable).slice(0, MAX_ALTERNATIVES);
  const activate = (workspaces: Workspace[]) => async (target: Workspace) => {
    if (!connection.client) throw new Error("No server connection.");
    return activateLocalWorkspace({ ...connection, client: connection.client }, target, workspaces);
  };
  const onSwitch = async (id: string) => {
    const target = alternatives.find(workspace => workspace.id === id);
    if (!target || !connection.client) return;
    setBusy(true); setFailed(false);
    // Stránky načítajú spojenie a pamäť znova, už pre nový priečinok.
    const switched = await switchToWorkspace(activate(connection.workspaces), target);
    setFailed(!switched);
    setBusy(false);
  };
  const client = connection.client;
  const onFind = client ? async () => {
    setBusy(true); setFailed(false); setNotice(null);
    try {
      const picked = await client.pickWorkspaceFolder({ title: t("lawoss.lite.folder_missing_find_title", locale), defaultPath: missing.path, existingOnly: true });
      if (!picked.path) return;
      const found = await previewMovedFolder(client, missing.id, picked.path);
      // Nič na prepojenie: povie to a nič nemení (žiadne nové pridanie klientov ako pri „Vybrať iný priečinok“).
      if (!found.matches.length) setNotice(t("lawoss.lite.folder_missing_none", locale));
      else setPreview(found);
    } catch (error) {
      console.warn("LAWOSS: hľadanie presunutého priečinka", error);
      setNotice(movedFolderErrorText(error, locale));
    } finally { setBusy(false); }
  } : undefined;
  const onConfirm = async () => {
    if (!preview || !client) return;
    setBusy(true); setNotice(null);
    const outcome = await reconnectMovedFolder(client, preview);
    setPreview(null);
    if (outcome.failed.length) setNotice(t("lawoss.lite.folder_missing_connect_failed", locale, { names: outcome.failed.map(item => item.name).join(", ") }));
    const target = connection.workspaces.find(workspace => workspace.id === (outcome.reconnected.find(item => item.workspaceId === missing.id) ?? outcome.reconnected[0])?.workspaceId);
    if (target) {
      const workspaces = withReconnectedPaths(connection.workspaces, outcome.reconnected);
      window.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT));
      const switched = await switchToWorkspace(activate(workspaces), workspaces.find(workspace => workspace.id === target.id) ?? target);
      setFailed(!switched);
    }
    setBusy(false);
  };
  const review = preview ? { folder: lastSegment(preview.folderPath), names: preview.matches.map(item => item.name), notFound: preview.notFound.map(item => item.name) } : null;
  return <MissingFolderView locale={locale} name={nameOf(missing)} alternatives={alternatives.map(workspace => ({ id: workspace.id, name: nameOf(workspace) }))} busy={busy} failed={failed} onSwitch={(id) => void onSwitch(id)}
    onFind={onFind ? () => void onFind() : undefined} review={review} notice={notice} onConfirm={() => void onConfirm()} onCancel={() => setPreview(null)} />;
}
