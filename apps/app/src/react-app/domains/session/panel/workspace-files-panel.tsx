/** @jsxImportSource react */
import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertCircle, ChevronRight, Eye, EyeOff, Folder, FolderOpen, RotateCw, X } from "lucide-react";

import type {
  LegalworkServerClient,
  LegalworkWorkspaceDirectoryEntry,
  LegalworkWorkspaceDirectoryList,
} from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn, formatFileSize } from "@/lib/utils";

import { ArtifactIcon } from "../artifacts/artifact-icon";
import { classifyOpenTarget } from "../artifacts/open-target";

type WorkspaceFilesPanelProps = {
  client: LegalworkServerClient | null;
  workspaceId: string | null;
  workspaceRoot: string;
  onOpenFile: (entry: LegalworkWorkspaceDirectoryEntry) => void;
  onClose: () => void;
};

const SKELETON_ROW_WIDTHS = ["56%", "72%", "44%", "64%", "38%", "52%"];

// The panel unmounts whenever the user switches to the preview or another rail
// pane; remember the folder per workspace so reopening lands where they left off.
const lastPathByWorkspace = new Map<string, string>();

function workspaceDisplayName(workspaceRoot: string): string {
  const cleaned = workspaceRoot.trim().replace(/[/\\]+$/, "");
  const name = cleaned.split(/[/\\]/).filter(Boolean).pop();
  return name || "Workspace";
}

export function WorkspaceFilesPanel({
  client,
  workspaceId,
  workspaceRoot,
  onOpenFile,
  onClose,
}: WorkspaceFilesPanelProps) {
  const [path, setPath] = React.useState(() => (workspaceId ? lastPathByWorkspace.get(workspaceId) ?? "" : ""));
  const [showHidden, setShowHidden] = React.useState(false);

  React.useEffect(() => {
    if (workspaceId) {
      lastPathByWorkspace.set(workspaceId, path);
    }
  }, [path, workspaceId]);
  const breadcrumbsRef = React.useRef<HTMLElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const { data, error, isError, isLoading, isFetching, refetch } = useQuery<LegalworkWorkspaceDirectoryList>({
    queryKey: ["workspace-files", workspaceId, path] as const,
    queryFn: async () => {
      if (!client || !workspaceId) {
        throw new Error("Workspace is not connected.");
      }
      return client.listWorkspaceDirectory(workspaceId, path);
    },
    enabled: Boolean(client && workspaceId),
    staleTime: 15_000,
    refetchOnWindowFocus: false,
  });

  const crumbs = React.useMemo(() => {
    const segments = path.split("/").filter(Boolean);
    return [
      { label: workspaceDisplayName(workspaceRoot), path: "" },
      ...segments.map((segment, index) => ({
        label: segment,
        path: segments.slice(0, index + 1).join("/"),
      })),
    ];
  }, [path, workspaceRoot]);

  const visibleEntries = React.useMemo(() => {
    const entries = data?.entries ?? [];
    return showHidden ? entries : entries.filter((entry) => !entry.name.startsWith("."));
  }, [data?.entries, showHidden]);

  const hiddenCount = (data?.entries.length ?? 0) - visibleEntries.length;

  // Deep paths overflow the breadcrumb bar; keep the current folder in view.
  React.useEffect(() => {
    breadcrumbsRef.current?.scrollTo({ left: breadcrumbsRef.current.scrollWidth });
  }, [path]);

  const navigateTo = React.useCallback((nextPath: string) => {
    setPath(nextPath);
    listRef.current?.scrollTo({ top: 0 });
  }, []);

  return (
    <TooltipProvider delay={1000}>
      <div className="flex h-full min-h-0 flex-col bg-background">
        <div className="flex h-10 shrink-0 items-center gap-1 border-b border-border bg-background pe-2 ps-4 mac:bg-background/80 mac:backdrop-blur-2xl mac:backdrop-saturate-150">
          <div className="flex min-w-0 flex-1 items-center gap-1.5">
            <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            <h3 className="truncate text-sm font-medium text-foreground">Files</h3>
          </div>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => setShowHidden((value) => !value)}
                  aria-label={showHidden ? "Hide hidden files" : "Show hidden files"}
                  aria-pressed={showHidden}
                >
                  {showHidden ? <EyeOff /> : <Eye />}
                </Button>
              )}
            />
            <TooltipContent>{showHidden ? "Hide hidden files" : "Show hidden files"}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void refetch()}
                  disabled={isFetching}
                  aria-label="Refresh folder"
                >
                  <RotateCw className={cn(isFetching && "animate-spin")} />
                </Button>
              )}
            />
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close files panel">
                  <X />
                </Button>
              )}
            />
            <TooltipContent>Close</TooltipContent>
          </Tooltip>
        </div>

        <nav
          ref={breadcrumbsRef}
          aria-label="Current folder"
          className="no-scrollbar flex h-9 shrink-0 items-center gap-0.5 overflow-x-auto whitespace-nowrap border-b border-border/60 bg-background px-2.5"
        >
          {crumbs.map((crumb, index) => {
            const current = index === crumbs.length - 1;
            return (
              <React.Fragment key={crumb.path || "__workspace_root__"}>
                {index > 0 ? <ChevronRight className="size-3 shrink-0 text-muted-foreground/50" /> : null}
                <button
                  type="button"
                  onClick={() => navigateTo(crumb.path)}
                  disabled={current}
                  aria-current={current ? "location" : undefined}
                  className={cn(
                    "shrink-0 rounded-md px-1.5 py-0.5 text-xs transition-colors",
                    current
                      ? "font-medium text-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground",
                  )}
                >
                  {crumb.label}
                </button>
              </React.Fragment>
            );
          })}
        </nav>

        <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto p-1.5">
          {isLoading ? (
            <div className="space-y-0.5">
              {SKELETON_ROW_WIDTHS.map((width, index) => (
                <div key={index} className="flex items-center gap-2.5 px-2.5 py-2">
                  <Skeleton className="size-4 shrink-0 rounded" />
                  <Skeleton className="h-3.5 rounded" style={{ width }} />
                </div>
              ))}
            </div>
          ) : isError ? (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
              <AlertCircle className="size-7 text-muted-foreground/50" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">
                {error instanceof Error ? error.message : "Failed to load this folder."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void refetch()}>
                Try again
              </Button>
            </div>
          ) : visibleEntries.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
              <FolderOpen className="size-8 text-muted-foreground/40" strokeWidth={1.5} />
              <p className="text-sm text-muted-foreground">This folder is empty</p>
              {hiddenCount > 0 ? (
                <button
                  type="button"
                  className="text-xs text-muted-foreground/70 underline-offset-2 hover:underline"
                  onClick={() => setShowHidden(true)}
                >
                  Show {hiddenCount} hidden {hiddenCount === 1 ? "item" : "items"}
                </button>
              ) : null}
            </div>
          ) : (
            <>
              {visibleEntries.map((entry) => (
                <button
                  key={entry.path}
                  type="button"
                  onClick={() => (entry.kind === "dir" ? navigateTo(entry.path) : onOpenFile(entry))}
                  title={entry.name}
                  className="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  {entry.kind === "dir" ? (
                    <Folder className="size-4 shrink-0 fill-sky-9/15 text-sky-9" />
                  ) : (
                    <ArtifactIcon type={classifyOpenTarget(entry.name, "file")} className="size-4" />
                  )}
                  <span className="min-w-0 flex-1 truncate text-[13px] text-foreground">{entry.name}</span>
                  {entry.kind === "dir" ? (
                    <ChevronRight className="size-3.5 shrink-0 text-muted-foreground/50 opacity-0 transition-opacity group-hover:opacity-100" />
                  ) : entry.size !== undefined ? (
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {formatFileSize(entry.size)}
                    </span>
                  ) : null}
                </button>
              ))}
              {data?.truncated ? (
                <p className="px-2.5 py-2 text-center text-[11px] text-muted-foreground/70">
                  This folder has more entries than can be shown.
                </p>
              ) : null}
              {!showHidden && hiddenCount > 0 ? (
                <button
                  type="button"
                  className="w-full px-2.5 py-2 text-center text-[11px] text-muted-foreground/70 underline-offset-2 hover:underline"
                  onClick={() => setShowHidden(true)}
                >
                  {hiddenCount} hidden {hiddenCount === 1 ? "item" : "items"}
                </button>
              ) : null}
            </>
          )}
        </div>
      </div>
    </TooltipProvider>
  );
}
