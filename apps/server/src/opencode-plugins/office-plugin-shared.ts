/**
 * Shared helpers for the Office tool plugins (legalwork-word-tools,
 * legalwork-excel-tools). Each plugin is bundled standalone by `bun build`,
 * so this module is inlined into every plugin bundle.
 *
 * Execution path for all Office tools: tool call -> legalwork-server relay
 * (/workspace/:id/office-tools/execute) -> the Office task pane long-polling
 * that relay -> Office.js -> result back through the same chain.
 */

import { isAbsolute, relative, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import { z } from "zod";
import { isPathWithin } from "../lawoss/path-within.js";
import { ENGINE_CONNECTION_REFUSED, WIKI_AGENT_LOCATION_HEADER } from "../lawoss/engine-agent-contract.js";
import { acquireWikiAgentSecret, wikiAgentSecret, wikiAgentSecretFailed } from "./wiki-agent-secret.js";

// LAWOSS: finished before the plugin's factory runs, so its tools see the secret and MCP starts after it.
await acquireWikiAgentSecret();

export type OpenCodeContext = {
  agent?: string;
  sessionID?: string;
  messageID?: string;
  directory?: string;
  worktree?: string;
  abort?: AbortSignal;
  ask?: (input: {
    permission: string;
    patterns: string[];
    always: string[];
    metadata: Record<string, unknown>;
  }) => Promise<void>;
};

export const OFFICE_TOOL_TIMEOUT_MS = 45_000;
const PANE_STATUS_CACHE_MS = 5_000;

export function serverUrl(): string {
  return String(process.env.LEGALWORK_SERVER_URL || "").replace(/\/$/, "");
}

/**
 * LAWOSS: the engine has no server-wide token. Each call names its chat; the server
 * accepts it only for the directory it recorded for that chat and its own workspace.
 */
export function serverConnected(context?: OpenCodeContext): boolean {
  // A failed redemption stays "connected" so the tool reaches the lawyer-readable refusal below.
  return Boolean(serverUrl() && (wikiAgentSecret() || wikiAgentSecretFailed()) && context?.sessionID && context.directory);
}

/** For the few server-wide reads that carry no project data (the firm's guard). */
export function engineHeaders(): Record<string, string> {
  const token = wikiAgentSecret();
  return token ? { "x-legalwork-wiki-agent-token": token } : {};
}

export async function workspaceToolHeaders(context?: OpenCodeContext): Promise<Record<string, string>> {
  if (wikiAgentSecretFailed()) throw new Error(ENGINE_CONNECTION_REFUSED);
  const token = wikiAgentSecret(), directory = context?.directory;
  if (!token || !context?.sessionID || !directory) return {};
  return {
    "x-legalwork-wiki-agent-token": token,
    "x-legalwork-wiki-agent-session": context.sessionID,
    // The server resolves and checks this claim itself; an unresolvable path is refused there.
    "x-legalwork-wiki-agent-directory": encodeURIComponent(await realpath(directory).catch(() => resolve(directory))),
  };
}

/**
 * LAWOSS: a location-level read before any chat exists (the native command plugin's `setup`). The server lets it
 * find only this location's own workspace and read its command definitions (`wiki/agent-access.ts`).
 */
export async function locationToolHeaders(directory: string): Promise<Record<string, string>> {
  if (wikiAgentSecretFailed()) throw new Error(ENGINE_CONNECTION_REFUSED);
  const token = wikiAgentSecret();
  if (!token) return {};
  return { "x-legalwork-wiki-agent-token": token,
    [WIKI_AGENT_LOCATION_HEADER]: encodeURIComponent(await realpath(directory).catch(() => resolve(directory))) };
}

/** The server's `message` from a JSON error body, bounded; empty when there is none. */
function refusalMessage(text: string): string {
  try {
    const message: unknown = Reflect.get(Object(JSON.parse(text)), "message");
    return typeof message === "string" && message.trim() ? `. ${message.trim().slice(0, 1000)}` : "";
  } catch { return ""; }
}

const workspaceListSchema = z.object({ items: z.array(z.object({ id: z.string(), path: z.string() })) });

// Not cached: the server lists only the chat's own workspace and applies a revoked
// or downgraded chat at once.

export async function listWorkspaces(context?: OpenCodeContext, options: { location?: boolean } = {}): Promise<Array<{ id: string; path: string }>> {
  const url = serverUrl();
  // LAWOSS: `location` = the location-level credential for `context.directory`, without a chat.
  const headers = options.location && context?.directory ? await locationToolHeaders(context.directory) : await workspaceToolHeaders(context);
  const response = await fetch(`${url}/workspaces`, {
    headers,
    signal: context?.abort ? AbortSignal.any([context.abort, AbortSignal.timeout(8_000)]) : AbortSignal.timeout(8_000),
  });
  // LAWOSS (N-A2-2): a refused client keeps the server's explanation for the user, not only the status.
  if (!response.ok) throw new Error(`Workspace lookup failed: HTTP ${response.status}${refusalMessage(await response.text().catch(() => ""))}`);
  const { items } = workspaceListSchema.parse(await response.json());
  return items;
}

export async function resolveWorkspaceId(context: OpenCodeContext, options: { requireDirectory?: boolean; location?: boolean } = {}): Promise<string> {
  const directory = context.directory?.trim() ?? "";
  const items = await listWorkspaces(context, { location: options.location });
  if (directory) {
    const match = [...items].sort((a, b) => b.path.length - a.path.length).find((item) => {
      if (!item.path) return false;
      const path = relative(resolve(item.path), resolve(directory));
      return path === "" || (!isAbsolute(path) && path !== ".." && !path.startsWith(`..${sep}`));
    });
    if (match) return match.id;
  }
  if (!options.requireDirectory && items.length === 1) return items[0]!.id;
  throw new Error(
    directory
      ? `No LegalWork workspace matches the working directory ${directory}.`
      : "Cannot determine the LegalWork workspace for this session.",
  );
}

export async function callOfficeTool(
  context: OpenCodeContext,
  tool: string,
  args: Record<string, unknown>,
): Promise<string> {
  try {
    const url = serverUrl();
    if (!serverConnected(context)) {
      return JSON.stringify({ ok: false, error: "LegalWork server connection is not configured for this engine." });
    }
    context.abort?.throwIfAborted();
    const workspaceId = await resolveWorkspaceId(context, { requireDirectory: true });
    const response = await fetch(`${url}/workspace/${encodeURIComponent(workspaceId)}/office-tools/execute`, {
      method: "POST",
      headers: {
        ...await workspaceToolHeaders(context),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool, args, timeoutMs: OFFICE_TOOL_TIMEOUT_MS }),
      signal: context.abort ? AbortSignal.any([context.abort, AbortSignal.timeout(OFFICE_TOOL_TIMEOUT_MS + 10_000)]) : AbortSignal.timeout(OFFICE_TOOL_TIMEOUT_MS + 10_000),
    });
    const text = await response.text();
    try {
      return JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return JSON.stringify({ ok: false, error: text || `HTTP ${response.status}` });
    }
  } catch (error) {
    // Cancellation is a native engine control signal, never a successful tool result.
    context.abort?.throwIfAborted();
    return JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error),
      nextStep: "An Office action may already have been delivered. Inspect the live document before retrying a change; do not replay it automatically." });
  }
}

export type OfficePaneInfo = {
  /** Lowercased Office host name reported by the pane ("word", "excel", "powerpoint"). */
  host: string;
  documentUrl: string | null;
};

export type OfficePaneStatus = {
  connected: boolean;
  /** One entry per connected pane — Word and Excel can be open at once. */
  hosts: OfficePaneInfo[];
  /** The server could not be asked: unknown, not disconnected. */
  failed?: true;
};

const paneStatusCache = new Map<string, { at: number; status: OfficePaneStatus }>();

/**
 * Status of the connected Office panes, if any. Checked on each user message
 * and tool result (with a short cache) so a reminder switches the agent to
 * document-first behavior as soon as the user opens a pane in an Office host.
 */
export async function officePaneStatus(context: OpenCodeContext = {}): Promise<OfficePaneStatus> {
  const normalizedDirectory = context.directory?.trim() ?? "";
  const cacheKey = `${serverUrl()}\0${context.sessionID ?? ""}\0${normalizedDirectory}`;
  const cached = paneStatusCache.get(cacheKey);
  // A disconnected result can become stale as soon as an Office pane starts
  // polling. Cache only positive detection so a just-opened pane is visible to
  // the next system transform or safety check immediately.
  if (
    cached?.status.connected &&
    Date.now() - cached.at < PANE_STATUS_CACHE_MS
  ) {
    return cached.status;
  }
  let status: OfficePaneStatus = { connected: false, hosts: [] };
  try {
    const url = serverUrl();
    if (serverConnected(context)) {
      const headers = await workspaceToolHeaders(context);
      const items = await listWorkspaces(context);
      const candidates = normalizedDirectory
        ? items.filter((item) => isPathWithin(item.path, normalizedDirectory)).sort((a, b) => b.path.length - a.path.length).slice(0, 1)
        : items.slice(0, 5);
      for (const item of candidates) {
        const response = await fetch(
          `${url}/workspace/${encodeURIComponent(item.id)}/office-tools/status`,
          { headers, signal: AbortSignal.timeout(3_000) },
        );
        if (!response.ok) {
          status = { connected: false, hosts: [], failed: true };
          continue;
        }
        const payload = z.object({ connected: z.boolean(), hosts: z.array(z.unknown()) }).parse(await response.json());
        if (payload.connected) {
          const hosts = payload.hosts.flatMap((entry) => {
            if (!entry || typeof entry !== "object") return [];
            const host: unknown = Reflect.get(entry, "host");
            const documentUrl: unknown = Reflect.get(entry, "documentUrl");
            return typeof host === "string" && host
              ? [{ host: host.toLowerCase(), documentUrl: typeof documentUrl === "string" && documentUrl ? documentUrl : null }]
              : [];
          });
          if (hosts.length > 0) {
            status = { connected: true, hosts };
            break;
          }
        }
      }
    }
  } catch {
    status = { connected: false, hosts: [], failed: true };
  }
  paneStatusCache.set(cacheKey, { at: Date.now(), status });
  return status;
}

/** The connected pane for a specific host, if any. */
export async function officePaneForHost(host: string, context?: OpenCodeContext): Promise<OfficePaneInfo | null> {
  const status = await officePaneStatus(context);
  return status.hosts.find((entry) => entry.host === host) ?? null;
}

/** The connected pane for a host, null without one, undefined when the server could not be asked. */
export async function officePaneIfKnown(host: string, context?: OpenCodeContext): Promise<OfficePaneInfo | null | undefined> {
  const status = await officePaneStatus(context);
  return status.failed ? undefined : status.hosts.find((entry) => entry.host === host) ?? null;
}

export function describeOpenDocument(documentUrl: string | null): string {
  if (!documentUrl) {
    return "The open document has not been saved yet (untitled).";
  }
  const name = documentUrl.split(/[\\/]/).pop() || documentUrl;
  return `The open document is "${name}" (${documentUrl}).`;
}
