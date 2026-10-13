import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { LegalworkServerError, type LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { projectErrorMessage } from "./project-errors";
import { PROJECT_FOLDER_RECONNECTED_EVENT, ProjectFolderActivationError, recoverProjectFolder } from "./project-folder-recovery";

export function ProjectFolderRecoveryAction({ client, workspaceId, error }: { client: LegalworkServerClient; workspaceId: string; error: unknown }) {
  const available = error instanceof LegalworkServerError && error.code === "project_folder_unavailable";
  const queryClient = useQueryClient();
  const registry = useQuery({ queryKey: ["project-recovery-registry", workspaceId], queryFn: () => client.listWorkspaces(), enabled: available });
  const workspace = registry.data?.items.find(item => item.id === workspaceId);
  const [busy, setBusy] = useState(false);
  const [typed, setTyped] = useState<string | null>(null);
  const [failure, setFailure] = useState<unknown>(null);
  if (!available || !workspace || workspace.workspaceType === "remote") return null;
  const recover = async () => {
    setBusy(true); setFailure(null);
    try {
      await recoverProjectFolder({ client, workspaceId, expectedPath: workspace.path, pick: async () => {
        if (typed !== null) return typed.trim() || null;
        const result = await client.pickWorkspaceFolder({ title: t("projects.reconnect_folder"), defaultPath: workspace.path, existingOnly: true });
        if (!result.supported) setTyped("");
        return result.path;
      }, refresh: async () => { try { await queryClient.invalidateQueries(); } finally { window.dispatchEvent(new Event(PROJECT_FOLDER_RECONNECTED_EVENT)); } } });
    } catch (error) {
      if (error instanceof ProjectFolderActivationError) toast.warning(t("projects.folder_reconnected_activation_failed"));
      else setFailure(error);
    }
    finally { setBusy(false); }
  };
  return <div className="space-y-2">
    <p className="break-all text-sm text-muted-foreground">{workspace.path}</p>
    {typed !== null ? <Input aria-label={t("projects.reconnect_path")} value={typed} onChange={event => setTyped(event.target.value)} /> : null}
    <Button variant="outline" size="sm" disabled={busy || (typed !== null && !typed.trim())} onClick={() => void recover()}>{t("projects.reconnect_folder")}</Button>
    {failure ? <p role="alert" className="text-sm text-destructive">{projectErrorMessage(failure)}</p> : null}
  </div>;
}
