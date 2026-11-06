// LAWOSS (N-A2-2, 23. 10. 2026): odmietnutý klient dostane od nástroja vysvetlenie servera, nie len „HTTP 403“.
// Pred opravou chat C017 videl „Workspace lookup failed: HTTP 403“ a model radil skontrolovať prístup k priečinku.
import { afterEach, expect, test } from "bun:test";
import { adoptWikiAgentSecret, wikiAgentSecret } from "./wiki-agent-secret.js";
import { CHAT_NOT_REGISTERED } from "../wiki/agent-access.js";
import { listWorkspaces } from "./office-plugin-shared.js";

const prior = { url: process.env.LEGALWORK_SERVER_URL, token: wikiAgentSecret() };
const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
  adoptWikiAgentSecret(prior.token);
  if (prior.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = prior.url;
});

function serve(status: number, body: string) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body, { status, headers: { "content-type": "application/json" } }) });
  stops.push(() => server.stop(true));
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  adoptWikiAgentSecret("synthetic-agent-token");
}
const context = { sessionID: "ses_c017", directory: "/prax/C017" };

test("the client refusal reaches the model with the server's explanation", async () => {
  serve(403, JSON.stringify({ code: "wiki_agent_session_unknown", message: CHAT_NOT_REGISTERED }));
  await expect(listWorkspaces(context)).rejects.toThrow(`Workspace lookup failed: HTTP 403. ${CHAT_NOT_REGISTERED}`);
});

test("an error without a JSON message keeps the bare status", async () => {
  serve(500, "<html>oops</html>");
  await expect(listWorkspaces(context)).rejects.toThrow(/^Workspace lookup failed: HTTP 500$/);
});
