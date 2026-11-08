// LAWOSS: generation-scoped admission for the upstream session-group poller
// (AGENTS.md, "Workspace persistence and recovery"). A project whose folder is
// unavailable pauses only its own generation until an explicit reconnect or a
// root/endpoint change; results of a retired generation are ignored. The
// upstream batch protocol, sync-poke wakeups and migration stay unchanged.
import { useEffect, useRef, useState } from "react";

import { LegalworkServerError } from "@/app/lib/legalwork-server";
import type { ResolvedWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { PROJECT_FOLDER_RECONNECTED_EVENT } from "@/react-app/domains/workspace/project-folder-recovery";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";

/** One admitted poll of one workspace generation. */
export type SessionGroupSyncTicket = { readonly workspaceId: string; readonly key: string; readonly epoch: number };

/** Root and capability changes start a new generation; label-only metadata changes do not. */
export function sessionGroupGenerationKey(workspace: RouteWorkspace, endpoint: ResolvedWorkspaceEndpoint): string {
  return JSON.stringify([workspace.id, workspace.path, endpoint.baseUrl, endpoint.workspaceId, endpoint.token, endpoint.hostToken]);
}

export function isProjectFolderUnavailable(error: unknown): boolean {
  return error instanceof LegalworkServerError && error.code === "project_folder_unavailable";
}

export class SessionGroupSyncAdmission {
  /** workspace id -> paused generation key */
  private readonly paused = new Map<string, string>();
  private epoch = 0;

  constructor(private readonly input: {
    liveKey: (workspaceId: string) => string | undefined;
    onPause?: (workspaceId: string, error: unknown) => void;
  }) {}

  /** Null while the current generation of this workspace is paused or the workspace is gone. */
  admit(workspaceId: string): SessionGroupSyncTicket | null {
    const key = this.input.liveKey(workspaceId);
    if (key === undefined) return null;
    const pausedKey = this.paused.get(workspaceId);
    if (pausedKey === key) return null;
    if (pausedKey !== undefined) this.paused.delete(workspaceId);
    return { workspaceId, key, epoch: this.epoch };
  }

  /** False once the ticket's generation was retired (reconnect, root/endpoint change, removal) or paused. */
  isCurrent(ticket: SessionGroupSyncTicket): boolean {
    return ticket.epoch === this.epoch
      && this.input.liveKey(ticket.workspaceId) === ticket.key
      && this.paused.get(ticket.workspaceId) !== ticket.key;
  }

  /**
   * Pauses current generations that failed with an unavailable folder and
   * drops failures of retired generations; returns the first remaining
   * rejection, which keeps the poller's shared backoff.
   */
  firstUnhandled(
    items: readonly { readonly ticket: SessionGroupSyncTicket }[],
    results: readonly PromiseSettledResult<unknown>[],
  ): PromiseRejectedResult | undefined {
    let unhandled: PromiseRejectedResult | undefined;
    results.forEach((result, index) => {
      if (result.status !== "rejected") return;
      const ticket = items[index]?.ticket;
      if (ticket && !this.isCurrent(ticket)) return;
      if (ticket && isProjectFolderUnavailable(result.reason)) {
        this.paused.set(ticket.workspaceId, ticket.key);
        this.input.onPause?.(ticket.workspaceId, result.reason);
        return;
      }
      unhandled ??= result;
    });
    return unhandled;
  }

  /** Explicit reconnect resumes every paused generation and retires in-flight tickets. */
  reconnect(): void {
    this.paused.clear();
    this.epoch++;
  }

  /** Drops pauses whose root/endpoint changed or whose workspace is gone; true when one resumed. */
  resumeChanged(): boolean {
    let resumed = false;
    for (const [workspaceId, key] of this.paused) {
      const live = this.input.liveKey(workspaceId);
      if (live === key) continue;
      this.paused.delete(workspaceId);
      if (live !== undefined) resumed = true;
    }
    return resumed;
  }
}

/**
 * One admission per mounted hook, so restarting a server poller (a workspace
 * added or removed) keeps unrelated pauses. Call it before the poller effect:
 * generation keys are refreshed in an effect and effects run in order.
 */
export function useSessionGroupSyncAdmission(input: {
  workspaces: RouteWorkspace[];
  endpointForWorkspace: (workspace: RouteWorkspace | null | undefined) => ResolvedWorkspaceEndpoint | null;
  wake: () => void;
}): SessionGroupSyncAdmission {
  const { workspaces, endpointForWorkspace } = input;
  const keys = useRef(new Map<string, string>());
  const wake = useRef(input.wake);
  wake.current = input.wake;
  const [admission] = useState(() => new SessionGroupSyncAdmission({
    liveKey: workspaceId => keys.current.get(workspaceId),
    onPause: (_workspaceId, error) => { console.warn("[session-groups] synchronization paused until the project folder is reconnected", error); },
  }));

  useEffect(() => {
    const next = new Map<string, string>();
    for (const workspace of workspaces) {
      const endpoint = endpointForWorkspace(workspace);
      if (endpoint) next.set(workspace.id, sessionGroupGenerationKey(workspace, endpoint));
    }
    keys.current = next;
    if (admission.resumeChanged()) wake.current();
  }, [admission, workspaces, endpointForWorkspace]);

  useEffect(() => {
    const reconnect = () => { admission.reconnect(); wake.current(); };
    window.addEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, reconnect);
    return () => window.removeEventListener(PROJECT_FOLDER_RECONNECTED_EVENT, reconnect);
  }, [admission]);

  return admission;
}
