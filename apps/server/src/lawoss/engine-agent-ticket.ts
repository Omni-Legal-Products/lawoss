import type { ServerConfig } from "../types.js";
import { closeWikiAgentTicketWindow } from "../wiki/agent-access.js";

/** A cold location installs and loads plugins first; the first run on a slow disk can take minutes. */
const PROBE_TIMEOUT_MS = 300_000;
const PROBE_ATTEMPTS = 6;

/**
 * Right after the engine starts: waits until the engine's plugins have loaded once, which redeems
 * the ticket, then closes the redemption window. Engine v2 loads plugins and MCP servers per
 * location (`makeLocationNode`), so the probe asks the location of the client the app opens anyway
 * (RAM 2 GB: MCP only for the opened client) and never a scratch folder, which would start every
 * shared MCP. `GET /api/model` waits for the location's plugin activation. The probe waits for the
 * engine, so it is asked again at once, a bounded number of times; after the last attempt the
 * window ends at its own limit (`redeemWikiAgentTicket`).
 */
export async function settleEngineAgentTicket(config: ServerConfig, engine: { url: string; username: string; password: string }, directory: string, stop?: AbortSignal): Promise<void> {
  const scope = new URLSearchParams({ "location[directory]": directory }).toString();
  const headers = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` };
  const deadline = () => AbortSignal.any([AbortSignal.timeout(PROBE_TIMEOUT_MS), ...(stop ? [stop] : [])]);
  // The opened client's location enters the MCP budget like any other location request (server.ts).
  const release = await config.lawossEngineMcpAdmission?.({ method: "GET", path: "/api/model", directory });
  try {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(new URL(`/api/model?${scope}`, engine.url), { headers, signal: deadline() });
      await response.arrayBuffer();
      if (!response.ok) throw new Error(`Engine plugin readiness probe failed: HTTP ${response.status}`);
      break;
    } catch (error) {
      if (stop?.aborted || attempt >= PROBE_ATTEMPTS) throw error;
    }
  }
  } finally { release?.(); }
  closeWikiAgentTicketWindow(config);
}
