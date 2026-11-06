import { wikiAgentHolder, WIKI_AGENT_TICKET_ENV, WIKI_AGENT_TICKET_PATH, type WikiAgentHolder } from "../lawoss/engine-agent-contract.js";

export { adoptWikiAgentSecret, wikiAgentSecret, wikiAgentSecretFailed } from "../lawoss/engine-agent-contract.js";

/**
 * LAWOSS: the managed engine's chat-bound agent secret. The engine's environment carries only a
 * single-use ticket; the first plugin to load redeems it once and removes it from the environment.
 * The secret stays on `globalThis`, because plugin bundles are separate modules and each engine
 * instance runs their factories again. See coordination record.
 */
const REDEEM_TIMEOUT_MS = 10_000;
const REDEEM_ATTEMPTS = 5;

/** Retries only while the server cannot answer yet (no connection, 503); any other answer is final. */
async function redeem(state: WikiAgentHolder, ticket: string, base: string, send: typeof fetch): Promise<void> {
  for (let attempt = 0; attempt < REDEEM_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const response = await send(`${base}${WIKI_AGENT_TICKET_PATH}`, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket }), signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS) });
      if (response.status === 503) continue;
      const secret: unknown = response.ok ? Reflect.get(Object(await response.json()), "secret") : "";
      if (typeof secret === "string" && secret) state.secret = secret;
      break;
    } catch { /* Next attempt. */ }
  }
  if (state.secret) return;
  state.failed = true;
  console.error("[lawoss] The engine's connection to LAWOSS could not be confirmed.");
}

/**
 * Safe from every bundle and every instance. Reads and deletes the ticket before its first await,
 * so concurrent callers share one redemption and nothing started later inherits the variable.
 */
export function acquireWikiAgentSecret(env: Record<string, string | undefined> = process.env, send: typeof fetch = globalThis.fetch): Promise<void> {
  const state = wikiAgentHolder();
  const ticket = env[WIKI_AGENT_TICKET_ENV]?.trim();
  delete env[WIKI_AGENT_TICKET_ENV];
  if (ticket) state.pending = redeem(state, ticket, String(env.LEGALWORK_SERVER_URL ?? "").replace(/\/$/, ""), send);
  return state.pending ?? Promise.resolve();
}
