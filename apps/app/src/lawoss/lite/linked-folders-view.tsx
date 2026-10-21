/** @jsxImportSource react */
/**
 * Pripojené priečinky klienta na Domove (`ClientOverview`) a ich počet v bočnom paneli pod klientom.
 * Dáta a zápis sú natívne povolené priečinky projektu klienta (`listAuthorizedFolders` /
 * `setAuthorizedFolders`), rovnaký zámok firmy ako natívny panel (`tools.permissions`). Model je
 * v `linked-folders.ts`.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FolderSymlink, Plus, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
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
  LINK_REFUSAL_TEXT, linkFolder, linkedFolderRows, linkedFoldersPolicy, linkedFoldersWriter, serverRefusal, unlinkFolder,
  type LinkRefusal, type LinkedFolderRow, type LinkScope, type SaveResult,
} from "./linked-folders";

/** `unavailable`: projekt klienta nie je na tomto počítači (vzdialený) alebo nie je spojenie. */
export type LinkedFoldersViewState = "loading" | "ready" | "error" | "unavailable";
type Outcome = { kind: "refused"; reason: LinkRefusal } | { kind: SaveResult } | { kind: "failed" } | null;

/** Sekcia „Pripojené priečinky“: zoznam, Pripojiť priečinok, Odpojiť; zamknuté firmou len na čítanie. */
export function LinkedFoldersView(props: {
  locale: Language; state: LinkedFoldersViewState; rows: readonly LinkedFolderRow[]; locked: boolean; canLink: boolean;
  busy?: boolean; outcome?: Outcome; onLink?: () => void; onUnlink?: (path: string) => void;
}) {
  const { locale, rows, outcome } = props;
  const title = t("lawoss.lite.linked_folders_title", locale);
  const editable = !props.locked && props.state !== "unavailable";
  return <Surface className="rounded-xl p-4" data-lawoss-linked-folders="" aria-label={title} role="region">
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t("lawoss.lite.linked_folders_desc", locale)}</p>
      </div>
      {editable ? <Button type="button" variant="outline" size="sm" className="shrink-0" data-lawoss-linked-folders-link=""
        disabled={!props.canLink || props.busy || props.state !== "ready"} onClick={props.onLink}>
        <Plus aria-hidden className="size-3.5" />{t("lawoss.lite.linked_folders_link", locale)}
      </Button> : null}
    </div>
    {props.locked ? <p className="mt-2 text-xs text-muted-foreground" data-lawoss-linked-folders-locked="">{t("lawoss.lite.linked_folders_locked", locale)}</p> : null}
    {props.state === "unavailable" ? <p className="mt-2 text-xs text-muted-foreground" data-lawoss-linked-folders-unavailable="">{t("lawoss.lite.linked_folders_unavailable", locale)}</p>
      : props.state === "error" ? <p className="mt-2 text-xs text-muted-foreground" role="status">{t("lawoss.lite.linked_folders_error", locale)}</p>
      : props.state === "ready" && rows.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">{t("lawoss.lite.linked_folders_empty", locale)}</p>
      : <ul className="mt-2 space-y-1">
        {rows.map((row) => <li key={row.path} className="flex min-w-0 items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-muted/60" title={row.path}>
          <FolderSymlink aria-hidden className="size-4 shrink-0 text-muted-foreground" />
          <span className="min-w-0 flex-1">
            <span className="block truncate">{row.name}</span>
            <span className="block truncate text-xs text-muted-foreground">{row.path}</span>
          </span>
          {row.managed ? <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-2xs text-muted-foreground" data-lawoss-linked-folder-managed="">{t("lawoss.lite.linked_folders_office", locale)}</span>
            : !editable ? null
            : <Button type="button" variant="ghost" size="xs" className="shrink-0 text-muted-foreground" data-lawoss-linked-folder-unlink=""
              aria-label={t("lawoss.lite.linked_folders_unlink_named", locale, { name: row.name })} disabled={props.busy} onClick={() => props.onUnlink?.(row.path)}>
              <X aria-hidden className="size-3" />{t("lawoss.lite.linked_folders_unlink", locale)}
            </Button>}
        </li>)}
      </ul>}
    {outcome?.kind === "refused" ? <p className="lw-status warn mt-2" role="alert" data-lawoss-linked-folders-refusal={outcome.reason}>{t(LINK_REFUSAL_TEXT[outcome.reason], locale)}</p> : null}
    {outcome?.kind === "failed" ? <p className="lw-status warn mt-2" role="alert">{t("lawoss.lite.linked_folders_save_error", locale)}</p> : null}
    {outcome?.kind === "declined" ? <p className="lw-status warn mt-2" role="alert" data-lawoss-linked-folders-declined="">{t("lawoss.lite.linked_folders_declined", locale)}</p> : null}
    {outcome?.kind === "saved" ? <p className="mt-2 text-xs text-muted-foreground" role="status">{t("lawoss.lite.linked_folders_reload", locale)}</p> : null}
  </Surface>;
}

/** Položka pod klientom v bočnom paneli: názov a počet; bez pripojených priečinkov sa neukáže. */
export function LinkedFoldersNavView({ locale, count, active = false, className, onOpen }: {
  locale: Language; count: number; active?: boolean; className?: string; onOpen?: () => void;
}) {
  if (count <= 0) return null;
  return <SidebarMenuSubItem>
    <SidebarMenuSubButton className={className} isActive={active} aria-current={active ? "page" : undefined} data-lawoss-project-linked-folders="" onClick={onOpen}>
      <FolderSymlink className="size-4" strokeWidth={1.5} />
      <span className="min-w-0 flex-1 truncate">{t("lawoss.lite.linked_folders_title", locale)}</span>
      <span data-lawoss-project-linked-folders-count="" className="shrink-0 text-xs tabular-nums text-muted-foreground">{count}</span>
    </SidebarMenuSubButton>
  </SidebarMenuSubItem>;
}

// Klient, ktorého pripojené priečinky si človek otvoril z panela (Domov ich ukáže a položka je aktívna).
let focusedClient: string | null = null;
const focusListeners = new Set<() => void>();
export function focusLinkedFolders(workspaceId: string | null): void {
  if (focusedClient === workspaceId) return;
  focusedClient = workspaceId;
  for (const listener of focusListeners) listener();
}
export function useLinkedFoldersFocus(): string | null {
  return useSyncExternalStore((listener) => { focusListeners.add(listener); return () => { focusListeners.delete(listener); }; }, () => focusedClient, () => focusedClient);
}

/** Koncový bod projektu klienta zo spojenia OKF (lokálny server, id projektu ako ho čaká server); vzdialený = `null`. */
function useClientEndpoint(connection: OkfConnection | null, workspaceId: string) {
  const workspace = connection?.workspaces.find((w) => w.id === workspaceId && w.workspaceType !== "remote") ?? null;
  return useMemo(() => connection && workspace ? resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token }) : null,
    [connection?.baseUrl, connection?.token, workspace]);
}

/** Kľúč nesie server, prihlásenie aj projekt: iné spojenie nikdy nevráti cudzí zoznam. */
export const linkedFoldersKey = (connection: OkfConnection | null, workspaceId: string) =>
  ["lawoss", "linked-folders", connection?.baseUrl ?? "", connection?.authGeneration ?? 0, workspaceId] as const;

/** Natívny zoznam povolených priečinkov projektu klienta; Domov aj bočný panel zdieľajú jedno čítanie. */
export function useLinkedFolders(connection: OkfConnection | null, workspaceId: string, enabled: boolean) {
  const endpoint = useClientEndpoint(connection, workspaceId);
  const query = useQuery({
    queryKey: linkedFoldersKey(connection, workspaceId),
    queryFn: async () => {
      if (!endpoint) throw new Error("client_workspace_unavailable");
      return endpoint.client.listAuthorizedFolders(endpoint.workspaceId);
    },
    enabled: enabled && endpoint !== null,
    staleTime: 30_000,
  });
  return { query, endpoint };
}

const pickedFolder = (selection: unknown): string | null =>
  typeof selection === "string" ? selection : Array.isArray(selection) && typeof selection[0] === "string" ? selection[0] : null;

/** Kontajner sekcie na Domove klienta. */
export function LinkedFolders({ connection, workspaceId, practiceRoot, otherClients, locale }: {
  connection: OkfConnection | null; workspaceId: string; practiceRoot: string | null; otherClients: readonly string[]; locale: Language;
}) {
  const queryClient = useQueryClient();
  const { query, endpoint } = useLinkedFolders(connection, workspaceId, true);
  const policy = linkedFoldersPolicy(useOrgPolicy("tools.permissions"));
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome>(null);
  const focused = useLinkedFoldersFocus() === workspaceId;
  const section = useRef<HTMLDivElement>(null);
  useEffect(() => { if (focused) section.current?.scrollIntoView({ block: "start", behavior: "smooth" }); }, [focused]);
  const linked = query.data?.folders ?? [];
  const clientRoot = connection?.workspaces.find((w) => w.id === workspaceId)?.path ?? "";
  const scope: Omit<LinkScope, "linked"> = { clientRoot, practiceRoot, otherClients };

  const run = async (action: (writer: ReturnType<typeof linkedFoldersWriter>) => Promise<Outcome>) => {
    if (!endpoint) return;
    // Zoznam sa pred zápisom prečíta znova (súbežná zmena v Nastaveniach sa nestratí).
    const writer = linkedFoldersWriter({ client: endpoint.client, workspaceId: endpoint.workspaceId, managed: policy.managed,
      changePolicy: (write) => changeOrgPolicySetting("tools.permissions", write) });
    setBusy(true); setOutcome(null);
    try { setOutcome(await action(writer)); }
    catch (error) {
      const reason = serverRefusal(error);
      setOutcome(reason ? { kind: "refused", reason } : { kind: "failed" });
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: linkedFoldersKey(connection, workspaceId) });
    }
  };
  const onLink = () => void run(async (writer) => {
    const result = await linkFolder({ pick: async () => pickedFolder(await pickDirectory({ title: t("lawoss.lite.linked_folders_link", locale) })), scope, current: writer.current, save: writer.save });
    return result.kind === "cancelled" ? null : result;
  });
  const onUnlink = (path: string) => void run(async (writer) => ({ kind: await unlinkFolder(writer.current, path, writer.save) }));

  const state: LinkedFoldersViewState = !endpoint ? "unavailable" : query.isError ? "error" : query.data ? "ready" : "loading";
  return <div ref={section} data-lawoss-linked-folders-focused={focused ? "" : undefined}>
    <LinkedFoldersView locale={locale} state={state} rows={linkedFolderRows(linked, practiceRoot)} locked={policy.locked}
      canLink={isDesktopRuntime()} busy={busy} outcome={outcome} onLink={onLink} onUnlink={onUnlink} />
  </div>;
}
