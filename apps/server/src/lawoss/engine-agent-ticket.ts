import { mkdir } from "node:fs/promises";
import type { ServerConfig } from "../types.js";
import { closeWikiAgentTicketWindow } from "../wiki/agent-access.js";

/** A cold instance installs and loads plugins first; the first run on a slow disk can take minutes. */
const PROBE_TIMEOUT_MS = 300_000;
const PROBE_ATTEMPTS = 6;

/**
 * Right after the engine starts: opens a scratch instance, which loads the plugins and redeems the
 * ticket, then closes the redemption window and releases the instance. `/path` starts no MCP, and
 * the scratch folder holds no client's configuration. The probe waits for the engine, so it is
 * asked again at once, a bounded number of times; after the last attempt the window ends at its
 * own limit (`redeemWikiAgentTicket`).
 */
export async function settleEngineAgentTicket(config: ServerConfig, engine: { url: string; username: string; password: string }, directory: string, stop?: AbortSignal): Promise<void> {
  await mkdir(directory, { recursive: true });
  const scope = new URLSearchParams({ directory }).toString();
  const headers = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };
  const deadline = () => AbortSignal.any([AbortSignal.timeout(PROBE_TIMEOUT_MS), ...(stop ? [stop] : [])]);
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(new URL(`/path?${scope}`, engine.url), { headers, signal: deadline() });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`Engine readiness probe failed: HTTP ${response.status}`);
      break;
    } catch (error) {
      if (stop?.aborted || attempt >= PROBE_ATTEMPTS) throw error;
    }
  }
  closeWikiAgentTicketWindow(config);
  await fetch(new URL(`/instance/dispose?${scope}`, engine.url), { method: "POST", headers, signal: deadline() }).then(result => result.arrayBuffer());
}
