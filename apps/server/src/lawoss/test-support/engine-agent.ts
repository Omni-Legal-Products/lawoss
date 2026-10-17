import type { ServerConfig, TokenScope } from "../../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "../../wiki/agent-access.js";

/**
 * Prepares a plugin call the way the managed engine makes it: the engine knows only the
 * chat-bound credential, and the server learned the chat's directory from the person who
 * prompted it. Returns the tool context and restores the previous environment.
 */
export async function engineAgentSession(config: ServerConfig, input: { sessionID: string; directory: string; scope?: TokenScope }) {
  const previous = process.env.LEGALWORK_WIKI_AGENT_TOKEN;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config, { sessionId: input.sessionID, directory: input.directory, scope: input.scope ?? "collaborator" });
  return {
    context: { sessionID: input.sessionID, directory: input.directory },
    restore: () => {
      if (previous === undefined) delete process.env.LEGALWORK_WIKI_AGENT_TOKEN;
      else process.env.LEGALWORK_WIKI_AGENT_TOKEN = previous;
    },
  };
}
