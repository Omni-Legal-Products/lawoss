/** @jsxImportSource react */
/**
 * Pripojené priečinky klienta na Domove (`ClientOverview`) a ich počet v bočnom paneli pod klientom.
 * Dáta a zápis sú natívne povolené priečinky projektu klienta (`listAuthorizedFolders` /
 * `setAuthorizedFolders`), rovnaký zámok firmy ako natívny panel (`tools.permissions`). Model je
 * v `linked-folders.ts`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderSymlink, Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { t, type Language } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SidebarMenuSubButton, SidebarMenuSubItem } from "@/components/ui/sidebar";
import { pickDirectory } from "@/app/lib/desktop";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { isDesktopRuntime } from "@/app/utils";
import { Surface } from "@/react-app/design-system/surface";
import { changeOrgPolicySetting, useOrgPolicy } from "@/react-app/domains/connections/org-policy";
import type { OkfConnection } from "../okf/connection";
import {
  LINK_REFUSAL_TEXT, linkFolder, linkedFolderRows, linkedFoldersPolicy, unlinkFolder,
  type LinkRefusal, type LinkedFolderRow, type LinkScope,
} from "./linked-folders";

type ViewState = "loading" | "ready" | "error";

/** Sekcia „Pripojené priečinky“: zoznam, Pripojiť priečinok, Odpojiť; zamknuté firmou len na čítanie. */
export function LinkedFoldersView(props: {
  locale: Language; state: ViewState; rows: readonly LinkedFolderRow[]; locked: boolean; canLink: boolean;
  busy?: boolean; refusal?: LinkRefusal | null; saveError?: boolean; saved?: boolean;
  onLink?: () => void; onUnlink?: (path: string) => void;
}) {
  const { locale, rows } = props;
  const title = t("lawoss.lite.linked_folders_title", locale);
  return <Surface className="rounded-xl p-4" data-lawoss-linked-folders="" aria-label={title} role="region">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("lawoss.lite.linked_folders_desc", locale)}</p>
      </div>
      {props.locked ? null : <Button type="button" variant="outline" size="sm" className="shrink-0" data-lawoss-linked-folders-link=""
        disabled={!props.canLink || props.busy || props.state !== "ready"} onClick={props.onLink}>
        <Plus aria-hidden className="size-3.5" />{t("lawoss.lite.linked_folders_link", locale)}
      </Button>}
    </div>
    {props.locked ? <p className="mt-2 text-xs text-muted-foreground" data-lawoss-linked-folders-locked="">{t("lawoss.lite.linked_folders_locked", locale)}</p> : null}
    {props.state === "error" ? <p className="mt-2 text-xs text-muted-foreground" role="status">{t("lawoss.lite.linked_folders_error", locale)}</p>
      : props.state === "ready" && rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("lawoss.lite.linked_folders_empty", locale)}</p>
      : <ul className="mt-2 space-y-1">
        {rows.map((row) => <li key={row.path} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60" title={row.path}>
          <FolderSymlink aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{row.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{row.path}</span>
          </span>
          {row.managed ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground" data-lawoss-linked-folder-managed="">{t("lawoss.lite.linked_folders_office", locale)}</span>
            : props.locked ? null
            : <Button type="button" variant="ghost" size="xs" className="shrink-0 text-muted-foreground" data-lawoss-linked-folder-unlink=""
              aria-label={t("lawoss.lite.linked_folders_unlink_named", locale, { name: row.name })} disabled={props.busy} onClick={() => props.onUnlink?.(row.path)}>
              <X aria-hidden className="size-3" />{t("lawoss.lite.linked_folders_unlink", locale)}
            </Button>}
        </li>)}
      </ul>}
    {props.refusal ? <p className="lw-status warn mt-2" role="alert" data-lawoss-linked-folders-refusal={props.refusal}>{t(LINK_REFUSAL_TEXT[props.refusal], locale)}</p> : null}
    {props.saveError ? <p className="lw-status warn mt-2" role="alert">{t("lawoss.lite.linked_folders_save_error", locale)}</p> : null}
    {props.saved ? <p className="mt-2 text-xs text-muted-foreground" role="status">{t("lawoss.lite.linked_folders_reload", locale)}</p> : null}
  </Surface>;
}

/** Položka pod klientom v bočnom paneli: názov a počet; bez pripojených priečinkov sa neukáže. */
export function LinkedFoldersNavView({ locale, count, className, onOpen }: { locale: Language; count: number; className?: string; onOpen?: () => void }) {
  if (count <= 0) return null;
  return <SidebarMenuSubItem>
    <SidebarMenuSubButton className={className} data-lawoss-project-linked-folders="" onClick={onOpen}>
      <FolderSymlink className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.linked_folders_title", locale)}</span>
      <span data-lawoss-project-linked-folders-count="" className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </SidebarMenuSubButton>
  </SidebarMenuSubItem>;
}

/** Koncový bod projektu klienta zo spojenia OKF (lokálny server, id projektu ako ho čaká server). */
function useClientEndpoint(connection: OkfConnection | null, workspaceId: string) {
  const workspace = connection?.workspaces.find((w) => w.id === workspaceId && w.workspaceType !== "remote") ?? null;
  return useMemo(() => connection && workspace ? resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token }) : null,
    [connection?.baseUrl, connection?.token, workspace]);
}

/** Kľúč nesie server, prihlásenie aj projekt: iné spojenie nikdy nevráti cudzí zoznam. */
const linkedFoldersKey = (connection: OkfConnection | null, workspaceId: string) =>
  ["lawoss", "linked-folders", connection?.baseUrl ?? "", connection?.authGeneration ?? 0, workspaceId] as const;

/** Natívny zoznam povolených priečinkov projektu klienta; Domov aj bočný panel zdieľajú jedno čítanie. */
export function useLinkedFolders(connection: OkfConnection | null, workspaceId: string, enabled: boolean) {
  const endpoint = useClientEndpoint(connection, workspaceId);
  return useQuery({
    queryKey: linkedFoldersKey(connection, workspaceId),
    queryFn: async () => {
      if (!endpoint) throw new Error("client_workspace_unavailable");
      return endpoint.client.listAuthorizedFolders(endpoint.workspaceId);
    },
    enabled: enabled && endpoint !== null,
    staleTime: 30_000,
  });
}

const pickedFolder = (selection: unknown): string | null =>
  typeof selection === "string" ? selection : Array.isArray(selection) && typeof selection[0] === "string" ? selection[0] : null;

/** Kontajner sekcie na Domove klienta. */
export function LinkedFolders({ connection, workspaceId, practiceRoot, otherClients, locale }: {
  connection: OkfConnection | null; workspaceId: string; practiceRoot: string | null; otherClients: readonly string[]; locale: Language;
}) {
  const queryClient = useQueryClient();
  const endpoint = useClientEndpoint(connection, workspaceId);
  const query = useLinkedFolders(connection, workspaceId, true);
  const policy = linkedFoldersPolicy(useOrgPolicy("tools.permissions"));
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<LinkRefusal | null>(null);
  const [saveError, setSaveError] = useState(false);
  const [saved, setSaved] = useState(false);
  const linked = query.data?.folders ?? [];
  const clientRoot = connection?.workspaces.find((w) => w.id === workspaceId)?.path ?? "";
  const scope: LinkScope = { clientRoot, practiceRoot, otherClients, linked };

  // Zápis ide cez natívny zoznam; keď ho spravuje firma, cez natívne prevzatie nastavenia (ako panel v Nastaveniach).
  const save = async (folders: string[]) => {
    if (!endpoint) throw new Error("client_workspace_unavailable");
    const write = async () => { await endpoint.client.setAuthorizedFolders(endpoint.workspaceId, folders); };
    let written = true;
    if (policy.managed) written = await changeOrgPolicySetting("tools.permissions", write);
    else await write();
    await queryClient.invalidateQueries({ queryKey: linkedFoldersKey(connection, workspaceId) });
    if (written) setSaved(true);
  };
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setRefusal(null); setSaveError(false); setSaved(false);
    try { await action(); } catch { setSaveError(true); } finally { setBusy(false); }
  };
  const onLink = () => void run(async () => {
    const result = await linkFolder({ pick: async () => pickedFolder(await pickDirectory({ title: t("lawoss.lite.linked_folders_link", locale) })), scope, save });
    if (result.kind === "refused") setRefusal(result.reason);
  });
  const onUnlink = (path: string) => void run(() => unlinkFolder(linked, path, save));

  const state: ViewState = query.isError ? "error" : query.data ? "ready" : "loading";
  return <LinkedFoldersView locale={locale} state={state} rows={linkedFolderRows(linked, practiceRoot)} locked={policy.locked}
    canLink={isDesktopRuntime() && endpoint !== null} busy={busy} refusal={refusal} saveError={saveError} saved={saved} onLink={onLink} onUnlink={onUnlink} />;
}
