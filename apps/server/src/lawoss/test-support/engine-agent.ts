import type { ServerConfig, TokenScope } from "../../types.js";
import { adoptWikiAgentSecret, wikiAgentSecret } from "../engine-agent-contract.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../../wiki/agent-access.js";

/**
 * Prepares a plugin call the way the managed engine makes it: the plugin holds only the
 * chat-bound credential, and the server learned the chat's directory from the person who
 * prompted it. Returns the tool context and restores the previous credential.
 */
export async function engineAgentSession(config: ServerConfig, input: { sessionID: string; directory: string; scope?: TokenScope }) {
  const previous = wikiAgentSecret();
  adoptWikiAgentSecret(await ensureWikiAgentToken(config));
  await grantWikiAgentSession(config, { sessionId: input.sessionID, directory: input.directory, scope: input.scope ?? "collaborator" });
  return {
    context: { sessionID: input.sessionID, directory: input.directory },
    restore: () => adoptWikiAgentSecret(previous),
  };
}
