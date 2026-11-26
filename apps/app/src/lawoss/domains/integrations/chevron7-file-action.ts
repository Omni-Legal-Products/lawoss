import { useState } from "react";
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query";
import { desktopBridge, openDesktopUrl } from "@/app/lib/desktop";
import { isLoopbackLegalworkServerUrl } from "@/app/lib/legalwork-server";
import { isDesktopRuntime, isMacPlatform } from "@/app/utils";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { openUnsavedArtifact } from "@/react-app/domains/session/artifacts/document-shutdown-navigation";
import { projectFileTab } from "@/react-app/domains/workspace/project-file-tab";
import { CHEVRON7_INSTALL_URL } from "./chevron7-card";

export const chevron7StatusQuery = {
  queryKey: ["lawoss", "chevron7", "status"] as const,
  queryFn: () => desktopBridge.chevron7Status(),
  staleTime: 30_000,
  retry: false,
};

type Selection = { workspaceId: string; serverUrl: string; relativePath: string };

export function isChevron7FileSelection(selection: Selection | null, desktopMac: boolean) {
  if (!desktopMac || !selection?.workspaceId || !isLoopbackLegalworkServerUrl(selection.serverUrl)) return false;
  const path = selection.relativePath;
  return /\.pdf$/i.test(path) && !/^[a-z][a-z\d+.-]*:/i.test(path) && !path.includes("\\") &&
    path.split("/").every(part => part && part !== "." && part !== "..");
}

/** Route to a selected source tab without starting a signing request. */
export function chevron7SourceAction(windowProject: string | undefined, workspaceId: string, path: string, name: string, navigate: (route: string) => void) {
  if (windowProject === workspaceId) return undefined;
  return () => {
    const source = { projectId: workspaceId, workspaceId, path, name };
    openUnsavedArtifact("", workspaceId, projectFileTab(source), navigate);
  };
}

/** A native return may mean the original changed or a separate copy was saved. */
export function refreshChevron7Files(cache: QueryClient, selection: Selection) {
  void cache.invalidateQueries({
    queryKey: ["artifact-panel", selection.workspaceId],
    predicate: query => query.meta?.pdfPath === selection.relativePath && query.queryKey[3] === selection.serverUrl,
  });
  void cache.invalidateQueries({ queryKey: ["workspace-files", selection.workspaceId, selection.serverUrl] });
}

export function useChevron7FileAction(selection: Selection | null, openInSource?: () => void) {
  const cache = useQueryClient();
  const enabled = isChevron7FileSelection(selection, isDesktopRuntime() && isMacPlatform());
  const statusQuery = useQuery({ ...chevron7StatusQuery, enabled: enabled && !openInSource });
  const [busy, setBusy] = useState(false);
  if (!enabled || !selection) return null;
  if (openInSource) return { label: t("lawoss.integrations.chevron7.open_source"), disabled: false, onClick: openInSource };
  const installation = statusQuery.isError ? undefined : statusQuery.data;
  const install = installation?.installed === false;
  const unsupported = installation?.installed === true && installation.signingAvailable === false;
  const labelKey = statusQuery.isPending ? "checking" : !installation ? "retry" : install ? "install" : unsupported ? "unsupported" : "sign";
  const label = t(`lawoss.integrations.chevron7.${labelKey}`);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!installation) {
        if ((await statusQuery.refetch()).isError) toast.error(t("lawoss.integrations.chevron7.unknown"));
        return;
      }
      if (install) return await openDesktopUrl(CHEVRON7_INSTALL_URL);
      const { status } = await desktopBridge.chevron7SignPdf(selection);
      if (status === "cancelled") return;
      if (status === "unavailable") {
        const fresh = await statusQuery.refetch();
        if (!fresh.isError && fresh.data?.installed === false) {
          toast.info(t("lawoss.integrations.chevron7.note"), { action: {
            label: t("lawoss.integrations.chevron7.install"), onClick: () => void openDesktopUrl(CHEVRON7_INSTALL_URL),
          } });
        } else {
          toast.error(t(fresh.isError ? "lawoss.integrations.chevron7.unknown" : "lawoss.integrations.chevron7.failed"));
        }
      } else if (status === "busy" || status === "returned" || status === "interrupted") {
        if (status === "returned" || status === "interrupted") refreshChevron7Files(cache, selection);
        toast.info(t(`lawoss.integrations.chevron7.${status}`));
      } else {
        toast.error(t(status === "invalid-file" ? "lawoss.integrations.chevron7.invalid" : "lawoss.integrations.chevron7.failed"));
      }
    } catch {
      toast.error(t("lawoss.integrations.chevron7.failed"));
    } finally {
      setBusy(false);
    }
  };
  return { label, disabled: busy || statusQuery.isPending || unsupported, onClick };
}
