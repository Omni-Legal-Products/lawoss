// LAWOSS (N-A2-2, 23. 10. 2026): odmietnutý klient dostane od nástroja vysvetlenie servera, nie len „HTTP 403“.
// Pred opravou chat C017 videl „Workspace lookup failed: HTTP 403“ a model radil skontrolovať prístup k priečinku.
import { afterEach, expect, test } from "bun:test";
import { CLIENT_RUNTIME_REQUIRED } from "../wiki/agent-access.js";
import { listWorkspaces } from "./office-plugin-shared.js";

const prior = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_WIKI_AGENT_TOKEN };
const stops: Array<() => void> = [];
afterEach(() => {
  while (stops.length) stops.pop()?.();
  for (const [key, value] of [["LEGALWORK_SERVER_URL", prior.url], ["LEGALWORK_WIKI_AGENT_TOKEN", prior.token]] as const) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function serve(status: number, body: string) {
  const server = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response(body, { status, headers: { "content-type": "application/json" } }) });
  stops.push(() => server.stop(true));
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "synthetic-agent-token";
}
const context = { sessionID: "ses_c017", directory: "/prax/C017" };

test("the client refusal reaches the model with the server's explanation", async () => {
  serve(403, JSON.stringify({ code: "wiki_agent_client_runtime_required", message: CLIENT_RUNTIME_REQUIRED }));
  await expect(listWorkspaces(context)).rejects.toThrow(`Workspace lookup failed: HTTP 403. ${CLIENT_RUNTIME_REQUIRED}`);
});

test("an error without a JSON message keeps the bare status", async () => {
  serve(500, "<html>oops</html>");
  await expect(listWorkspaces(context)).rejects.toThrow(/^Workspace lookup failed: HTTP 500$/);
});
