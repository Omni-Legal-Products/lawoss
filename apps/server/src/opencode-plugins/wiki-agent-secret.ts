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

/** The engine read these when it started; its children have no use for them. See coordination record. */
const ENGINE_START_ENV = ["OPENCODE_SERVER_USERNAME", "OPENCODE_SERVER_PASSWORD", "OPENCODE_CONFIG"];
// LAWOSS v2: engine 2.x reads its password from OPENCODE_PASSWORD (service mode strips it; this hides it from shells otherwise).
const SHELL_HIDDEN_ENV = [...ENGINE_START_ENV, "OPENCODE_PASSWORD", "OPENCODE_CONFIG_DIR", "OPENCODE_CONFIG_CONTENT", "OPENCODE_DB", "LEGALWORK_CONNECTOR_TOKEN", WIKI_AGENT_TICKET_ENV];

/** For the `shell.env` hook; the engine merges this over its environment. See coordination record. */
export function hideEngineEnvFromShell(output: { env: Record<string, string | undefined> }): void {
  for (const name of SHELL_HIDDEN_ENV) output.env[name] = undefined;
}

/** The engine's config file, for plugin code that keeps its own data next to it. */
export function engineConfigPath(env: Record<string, string | undefined> = process.env): string | undefined {
  return wikiAgentHolder().engineConfig ?? env.OPENCODE_CONFIG?.trim();
}

/**
 * Retries only while the server cannot answer yet (no connection, 503); any other answer is final.
 * The nonce makes a retry of an answer lost on the way the same request, not a second redemption.
 */
async function redeem(state: WikiAgentHolder, ticket: string, base: string, send: typeof fetch): Promise<void> {
  const nonce = crypto.randomUUID();
  for (let attempt = 0; attempt < REDEEM_ATTEMPTS; attempt++) {
    if (attempt > 0) await new Promise(resolve => setTimeout(resolve, 300));
    try {
      const response = await send(`${base}${WIKI_AGENT_TICKET_PATH}`, { method: "POST", redirect: "error",
        headers: { "content-type": "application/json" }, body: JSON.stringify({ ticket, nonce }), signal: AbortSignal.timeout(REDEEM_TIMEOUT_MS) });
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
 * so concurrent callers share one redemption and nothing started later inherits the variables.
 */
export function acquireWikiAgentSecret(env: Record<string, string | undefined> = process.env, send: typeof fetch = globalThis.fetch): Promise<void> {
  const state = wikiAgentHolder();
  const ticket = env[WIKI_AGENT_TICKET_ENV]?.trim();
  delete env[WIKI_AGENT_TICKET_ENV];
  if (ticket) {
    state.engineConfig = env.OPENCODE_CONFIG?.trim();
    for (const name of ENGINE_START_ENV) delete env[name];
  }
  if (ticket) state.pending = redeem(state, ticket, String(env.LEGALWORK_SERVER_URL ?? "").replace(/\/$/, ""), send);
  return state.pending ?? Promise.resolve();
}
