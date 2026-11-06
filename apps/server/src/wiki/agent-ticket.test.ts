import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ENGINE_CONNECTION_REFUSED, WIKI_AGENT_TICKET_PATH } from "../lawoss/engine-agent-contract.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { authenticateWikiAgentRequest, closeWikiAgentTicketWindow, ensureWikiAgentToken, grantWikiAgentSession, issueWikiAgentTicket, redeemWikiAgentTicket } from "./agent-access.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const stop of cleanup.splice(0).reverse()) await stop(); });

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-agent-ticket-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const a = join(root, "a"), b = join(root, "b");
  await mkdir(a); await mkdir(b);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_a", name: "A", path: a, preset: "starter", workspaceType: "local" }, { id: "ws_b", name: "B", path: b, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  await grantWikiAgentSession(config, { sessionId: "chat_a", directory: a, scope: "collaborator" });
  await grantWikiAgentSession(config, { sessionId: "chat_b", directory: b, scope: "collaborator" });
  const asA = (token: string) => new Request("http://127.0.0.1/workspace/ws_a/files/content?path=x", { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": "chat_a", "x-legalwork-wiki-agent-directory": encodeURIComponent(a) } });
  const asB = (token: string) => new Request("http://127.0.0.1/workspace/ws_b/files/content?path=x", { headers: {
    "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": "chat_b", "x-legalwork-wiki-agent-directory": encodeURIComponent(b) } });
  const works = async (token: string) => expect((await authenticateWikiAgentRequest(config, asA(token)))?.workspaceId).toBe("ws_a");
  const refused = (token: string) => expect(authenticateWikiAgentRequest(config, asA(token))).rejects.toMatchObject({ status: 403, code: "wiki_agent_unauthorized", message: ENGINE_CONNECTION_REFUSED });
  return { config, a, b, asA, asB, works, refused };
}

test("a ticket redeems once for the secret and differs from it", async () => {
  const { config, works } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  expect(secret).toBe(await ensureWikiAgentToken(config));
  expect(ticket).not.toBe(secret);
  await works(secret);
});

test("a ticket is no credential: spent or not, with B's session and directory it is refused", async () => {
  const { config, asB } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  await expect(authenticateWikiAgentRequest(config, asB(ticket))).rejects.toMatchObject({ status: 403, code: "wiki_agent_unauthorized" });
  redeemWikiAgentTicket(config, ticket);
  await expect(authenticateWikiAgentRequest(config, asB(ticket))).rejects.toMatchObject({ status: 403, code: "wiki_agent_unauthorized" });
});

test("while the window is open a replay is refused and replaces the secret: the first holder fails closed", async () => {
  const { config, works, refused } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403, code: "wiki_agent_ticket_refused" }));
  await refused(secret);
  const current = await ensureWikiAgentToken(config);
  expect(current).not.toBe(secret);
  await works(current);
});

test("after the window closes a replay is refused and the secret stays: the running plugin keeps working", async () => {
  const { config, works } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  closeWikiAgentTicketWindow(config);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403, code: "wiki_agent_ticket_refused" }));
  expect(await ensureWikiAgentToken(config)).toBe(secret);
  await works(secret);
});

test("closing the window spends an unredeemed ticket", async () => {
  const { config } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  closeWikiAgentTicketWindow(config);
  const secret = await ensureWikiAgentToken(config);
  expect(() => redeemWikiAgentTicket(config, ticket)).toThrow(expect.objectContaining({ status: 403, code: "wiki_agent_ticket_refused" }));
  expect(await ensureWikiAgentToken(config)).toBe(secret);
});

test("an unknown ticket is refused and changes nothing", async () => {
  const { config, works } = await fixture();
  const ticket = issueWikiAgentTicket(config);
  const secret = redeemWikiAgentTicket(config, ticket);
  expect(() => redeemWikiAgentTicket(config, "not-a-ticket")).toThrow(expect.objectContaining({ status: 403, code: "wiki_agent_ticket_refused" }));
  await works(secret);
});

test("a new engine gets a new ticket and a new secret; the previous pair stops working", async () => {
  const { config, works, refused } = await fixture();
  const first = issueWikiAgentTicket(config);
  const old = redeemWikiAgentTicket(config, first);
  closeWikiAgentTicketWindow(config);
  const second = issueWikiAgentTicket(config);
  expect(second).not.toBe(first);
  const secret = redeemWikiAgentTicket(config, second);
  expect(secret).not.toBe(old);
  await works(secret);
  await refused(old);
  expect(() => redeemWikiAgentTicket(config, first)).toThrow(expect.objectContaining({ status: 403 }));
  await works(secret);
});

test("the server route redeems once, refuses bad input without side effects and never logs the values", async () => {
  const { config, asB } = await fixture();
  const lines: string[] = [];
  const originalLog = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.map(String).join(" ")); };
  cleanup.push(async () => { console.log = originalLog; });
  config.logRequests = true;
  const server = await startServer(config);
  cleanup.push(async () => { await server.stop(); });
  const base = `http://127.0.0.1:${server.port}`;
  const redeem = (body: unknown) => fetch(`${base}${WIKI_AGENT_TICKET_PATH}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const ticket = issueWikiAgentTicket(config);
  expect((await fetch(`${base}${WIKI_AGENT_TICKET_PATH}`)).status).toBe(404);
  expect((await redeem({})).status).toBe(403);
  expect((await redeem({ ticket: "wrong" })).status).toBe(403);
  const response = await redeem({ ticket });
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const secret = String((await response.json()).secret);
  expect(secret).toBe(await ensureWikiAgentToken(config));
  closeWikiAgentTicketWindow(config);
  expect((await redeem({ ticket })).status).toBe(403);
  const forged = await fetch(asB(ticket).url.replace("http://127.0.0.1", base), { headers: asB(ticket).headers });
  expect(forged.status).toBe(403);
  expect((await fetch(asB(secret).url.replace("http://127.0.0.1", base), { headers: asB(secret).headers })).status).not.toBe(403);
  expect(lines.join("\n")).not.toContain(ticket);
  expect(lines.join("\n")).not.toContain(secret);
});
