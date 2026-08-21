/**
 * Deciding whether logging an MCP server out actually did anything.
 *
 * Some remote MCP servers accept an unauthenticated handshake and reject only
 * individual tool calls. The engine reports those as plain `connected`, exactly
 * like an authenticated one — `McpStatusConnected` carries no auth state, and no
 * endpoint reports stored credentials. So a connector that was never signed in
 * shows as Ready, "Log out" clears a credential that does not exist, the badge
 * drops to Paused, and the next launch silently restores Ready. Read as a stale
 * session surviving a logout, and reported that way in issue #86.
 *
 * The signal is to reconnect once the credentials are gone — the same thing the
 * next launch does, only now rather than later. A server that needed them comes
 * back asking to sign in; one that never did comes back connected. Doing it
 * during logout also leaves the badge showing the truth immediately, instead of
 * a Paused state that quietly flips to Ready on restart.
 */

export type McpStatusSnapshot = Record<string, { status?: string } | undefined>;

/** Delays between status reads after the reconnect, in ms. */
export const RECONNECT_PROBE_DELAYS_MS = [250, 500, 1000, 1500];

export type DetectReconnectOptions = {
  /** Server name as the engine knows it. */
  serverName: string;
  /** Ask the engine to reconnect the server (POST /mcp/{name}/connect). */
  reconnect: () => Promise<unknown>;
  /** Read current MCP statuses; return null when unavailable. */
  readStatus: () => Promise<McpStatusSnapshot | null>;
  /** Called with each snapshot read, so callers can keep their UI current. */
  onStatus?: (statuses: McpStatusSnapshot) => void;
  /** Injected for tests; defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
  /** Abort early, e.g. when the store has been disposed. */
  isCancelled?: () => boolean;
  delaysMs?: number[];
};

/**
 * True when the server reconnects successfully after its credentials were
 * removed — meaning it never authenticated and the logout cleared nothing.
 *
 * False for every other outcome, including a failed probe or an unreadable
 * status. This picks which message a user is shown, so an uncertain answer must
 * fall back to the ordinary one rather than accuse a working logout of being a
 * no-op.
 */
export async function detectReconnectWithoutAuth(options: DetectReconnectOptions): Promise<boolean> {
  const {
    serverName,
    reconnect,
    readStatus,
    onStatus,
    wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
    isCancelled,
    delaysMs = RECONNECT_PROBE_DELAYS_MS,
  } = options;

  try {
    await reconnect();
  } catch {
    // The probe is a diagnostic, never a reason to fail the logout itself.
    return false;
  }
  if (isCancelled?.()) return false;

  for (const delay of delaysMs) {
    await wait(delay);
    if (isCancelled?.()) return false;

    let statuses: McpStatusSnapshot | null;
    try {
      statuses = await readStatus();
    } catch {
      return false;
    }
    if (!statuses) return false;
    onStatus?.(statuses);

    const current = statuses[serverName]?.status;
    if (current === "connected") return true;
    // The credentials mattered: the server is asking for them again. Nothing
    // later in the poll can overturn that, so stop.
    if (current === "needs_auth" || current === "needs_client_registration") return false;
  }

  return false;
}
