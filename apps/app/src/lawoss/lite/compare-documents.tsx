/** @jsxImportSource react */
/**
 * Bežný režim (alfa 14): Tabuľková kontrola nie je v strome klienta, otvára sa z Dokumentov akciou
 * „Porovnať dokumenty“. Pokročilý režim ju má v strome ako doteraz, akcia sa tam neukáže.
 */
import { TableProperties } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import { workspaceViewRoute } from "@/react-app/shell/workspace-routes";
import { useUiMode, type UiMode } from "./ui-mode";

/** `projectId`: id priečinka v trase (`/workspace/<id>/…`), nie id servera. */
export function CompareDocumentsAction({ projectId }: { projectId?: string | null }) {
  return <CompareDocumentsActionView projectId={projectId} mode={useUiMode()} />;
}

export function CompareDocumentsActionView({ projectId, mode }: { projectId?: string | null; mode: UiMode }) {
  if (mode !== "lite" || !projectId?.trim()) return null;
  return <Button variant="outline" size="sm" className="shrink-0 gap-2" data-lawoss-compare-documents="" nativeButton={false}
    render={<Link to={workspaceViewRoute(projectId, "reviews")} />}>
    <TableProperties className="size-4" strokeWidth={1.5} />
    {t("lawoss.lite.compare_documents")}
  </Button>;
}
