import { randomUUID } from "node:crypto";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken, grantWikiAgentSession } from "./agent-access.js";

/** Independent actual server/credential owner, sharing only the fixture's wiki registry and files. */
export async function scopedWikiRuntime(source: ServerConfig, sessionId: string, directory: string) {
  const config: ServerConfig = {
    ...source, token: `synthetic-client-${randomUUID()}`, hostToken: `synthetic-host-${randomUUID()}`,
    approval: { ...source.approval }, workspaces: source.workspaces.map(workspace => ({ ...workspace })),
    authorizedRoots: [...source.authorizedRoots],
  };
  const token = await ensureWikiAgentToken(config);
  await grantWikiAgentSession(config,{ sessionId,directory,scope: "owner" });
  const server = await startServer(config);
  const url = `http://127.0.0.1:${server.port}`;
  const headers = () => ({
    "content-type": "application/json", "x-legalwork-wiki-agent-token": token,
    "x-legalwork-wiki-agent-session": sessionId, "x-legalwork-wiki-agent-directory": encodeURIComponent(directory),
  });
  const run = async <T>(action: () => Promise<T>): Promise<T> => {
    const values = { LEGALWORK_SERVER_URL: url, LEGALWORK_SERVER_TOKEN: config.token, LEGALWORK_WIKI_AGENT_TOKEN: token };
    const previous = Object.fromEntries(Object.keys(values).map(key => [key,process.env[key]]));
    Object.assign(process.env,values);
    try { return await action(); }
    finally { for (const [key,value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
  };
  return { config,url,headers,run,close: async () => { await server.stop(); } };
}
